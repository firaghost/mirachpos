const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { config } = require('../config');
const { loginWithEmailPassword } = require('../services/authService');

const makePublicRouter = () => {
  const r = express.Router();

  r.get('/public/platform-settings', async (_req, res, next) => {
    try {
      const row = await db().select(['settings_json']).from('platform_settings').where({ id: 1 }).first();
      const settings = (() => {
        try {
          return row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          return {};
        }
      })();
      return res.json({ ok: true, settings });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/demo-requests', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const company = typeof body?.company === 'string' ? body.company.trim() : '';
      const country = typeof body?.country === 'string' ? body.country.trim() : '';
      const source = typeof body?.source === 'string' ? body.source.trim() : '';
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });

      const id = makeId('demo');
      const nowIso = new Date().toISOString();

      const meta = {
        ip: typeof req.ip === 'string' ? req.ip : '',
        userAgent: typeof req.header('user-agent') === 'string' ? req.header('user-agent') : '',
        referer: typeof req.header('referer') === 'string' ? req.header('referer') : '',
      };

      await db().from('demo_requests').insert({
        id,
        status: 'New',
        name,
        email,
        phone: phone || null,
        company: company || null,
        country: country || null,
        source: source || null,
        message: message || null,
        meta_json: JSON.stringify(meta),
        provisioned_tenant_id: null,
        processed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, requestId: id });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/accept-invite', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body?.password === 'string' ? body.password : '';

      if (!code) return res.status(400).json({ error: 'invite_code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });
      if (!password || password.length < 6) return res.status(400).json({ error: 'password_too_short' });

      const inv = await db()
        .select(['id', 'tenant_id', 'role_name', 'branch_id', 'expires_at', 'used_at'])
        .from('owner_invites')
        .where({ code })
        .first();
      if (!inv) return res.status(404).json({ error: 'invite_not_found' });
      if (inv.used_at) return res.status(409).json({ error: 'invite_already_used' });

      const exp = inv.expires_at ? new Date(inv.expires_at).getTime() : 0;
      if (exp && Number.isFinite(exp) && Date.now() > exp) return res.status(410).json({ error: 'invite_expired' });

      const tenantId = String(inv.tenant_id || '');
      if (!tenantId) return res.status(400).json({ error: 'invite_invalid_tenant' });

      const roleName = String(inv.role_name || '').trim();
      const allowed = new Set(['Branch Manager', 'Waiter']);
      if (!allowed.has(roleName)) return res.status(400).json({ error: 'invite_invalid_role' });

      const tenant = await db().select(['id', 'slug', 'name']).from('tenants').where({ id: tenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const existing = await db().select(['id']).from('staff').where({ tenant_id: tenantId, email }).first();
      if (existing) return res.status(409).json({ error: 'email_in_use' });

      const branchId = inv.branch_id ? String(inv.branch_id) : '';
      const branch = branchId ? await db().select(['id', 'name']).from('branches').where({ tenant_id: tenantId, id: branchId }).first() : null;
      if (branchId && !branch) return res.status(400).json({ error: 'invite_invalid_branch' });

      const staffId = makeId('stf');
      const nowIso = new Date().toISOString();
      const passwordHash = await bcrypt.hash(password, 10);

      await db().transaction(async (trx) => {
        await trx.from('staff').insert({
          id: staffId,
          tenant_id: tenantId,
          branch_id: branchId || null,
          role_id: null,
          role_name: roleName,
          name,
          email,
          phone: null,
          code: null,
          password_hash: passwordHash,
          pin_hash: null,
          status: 'Active',
          last_login_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx
          .from('owner_invites')
          .where({ id: String(inv.id) })
          .update({ used_at: nowIso, used_by_staff_id: staffId });
      });

      const out = await loginWithEmailPassword({ tenantId, email, password, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(401).json({ error: out.error });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/contact-admin', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const id = makeId('demo');
      const nowIso = new Date().toISOString();
      const meta = {
        ip: typeof req.ip === 'string' ? req.ip : '',
        userAgent: typeof req.header('user-agent') === 'string' ? req.header('user-agent') : '',
        referer: typeof req.header('referer') === 'string' ? req.header('referer') : '',
        type: 'contact_admin',
      };

      await db().from('demo_requests').insert({
        id,
        status: 'New',
        name,
        email,
        phone: phone || null,
        company: null,
        country: null,
        source: 'contact_admin',
        message,
        meta_json: JSON.stringify(meta),
        provisioned_tenant_id: null,
        processed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, requestId: id });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makePublicRouter };
