const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validators');
const { config } = require('../config');
const { db } = require('../db');
const { loginWithEmailPassword, loginWithCodePin } = require('../services/authService');

const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');

const safeIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizePermissions = (raw) => {
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
};

const readRolePermissions = async ({ tenantId, roleName }) => {
  const tn = String(tenantId || '').trim();
  const rn = String(roleName || '').trim();
  if (!tn || !rn) return [];
  const row = await db().select(['permissions']).from('roles').where({ tenant_id: tn, name: rn }).first();
  if (!row) return [];
  return normalizePermissions(row.permissions);
};

const maybeDowngradeDueSubscription = async (tenantId) => {
  const sub = await db().select(['tenant_id', 'tier', 'status', 'next_bill_at']).from('tenant_subscription').where({ tenant_id: tenantId }).first();
  if (!sub) return;
  const status = String(sub.status || 'active').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'active') return;

  const nextBillIso = safeIso(sub.next_bill_at);
  if (!nextBillIso) return;
  const nextBillMs = new Date(nextBillIso).getTime();
  if (!Number.isFinite(nextBillMs)) return;
  if (Date.now() < nextBillMs) return;

  const curTier = String(sub.tier || 'Trial');
  if (curTier === 'Basic') return;

  const plan = await db().select(['modules_json', 'price_monthly_etb']).from('plans').where({ tier: 'Basic' }).first();
  const nowIso = new Date().toISOString();
  const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({
    tier: 'Basic',
    cycle: 'Monthly',
    modules_json: String(plan?.modules_json || '[]'),
    amount_etb: Number(plan?.price_monthly_etb || 0) || 0,
    status: 'past_due',
    grace_ends_at: graceEndsAt,
    updated_at: nowIso,
  });
};

const makeAuthRouter = () => {
  const r = express.Router();

  const handler = async (req, res, next) => {
    try {
      // Use validated data from Zod middleware
      const { email, password } = req.validatedBody || req.body;

      const out = await loginWithEmailPassword({
        tenantId: req.tenant.id,
        email,
        password,
        jwtSecret: config.jwtSecret,
      });

      if (!out.ok) return res.status(401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }

  };

  // New API - with validation
  r.post('/login', tenantMiddleware, validateLogin, handler);
  // Backward-compatible: existing frontend calls /api/auth/login
  r.post('/auth/login', tenantMiddleware, validateLogin, handler);

  r.post('/login-pin', tenantMiddleware, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
      const out = await loginWithCodePin({ tenantId: req.tenant.id, code, pin, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(out.error === 'forbidden' ? 403 : 401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/auth/login-pin', tenantMiddleware, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
      const out = await loginWithCodePin({ tenantId: req.tenant.id, code, pin, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(out.error === 'forbidden' ? 403 : 401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  });

  const meHandler = async (req, res, next) => {
    try {
      if (!req.auth?.tenantId) return res.status(401).json({ error: 'unauthorized' });

      const tenant = await db()
        .select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at'])
        .from('tenants')
        .where({ id: String(req.auth.tenantId) })
        .first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
      if (String(tenant.status) === 'suspended') return res.status(403).json({ error: 'tenant_suspended' });

      await maybeDowngradeDueSubscription(String(tenant.id));

      const staffId = typeof req.auth?.staffId === 'string' ? req.auth.staffId : '';
      const role = typeof req.auth?.role === 'string' ? req.auth.role : '';
      const branchId = typeof req.auth?.branchId === 'string' ? req.auth.branchId : 'global';

      let staffName = '';
      if (staffId) {
        const staff = await db().select(['id', 'name']).from('staff').where({ tenant_id: tenant.id, id: staffId }).first();
        staffName = staff?.name ? String(staff.name) : '';
      }

      const branch = await (async () => {
        if (!branchId || branchId === 'global') return { id: 'global', name: 'Global' };
        const b = await db().select(['id', 'name']).from('branches').where({ tenant_id: tenant.id, id: branchId }).first();
        if (!b) return { id: String(branchId), name: '' };
        return { id: String(b.id), name: String(b.name || '') };
      })();

      const ent = await computeTenantEntitlements({ tenant });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: tenant.id, entitlements: ent });

      const permissions = role ? await readRolePermissions({ tenantId: tenant.id, roleName: role }) : [];

      return res.json({
        ok: true,
        me: {
          tenantId: String(tenant.id),
          branchId,
          staffId,
          role,
          staffName,
          permissions,
        },
        tenant: { id: String(tenant.id), slug: String(tenant.slug || ''), name: String(tenant.name || '') },
        branch,
        subscription: ent?.subscription || { tier: 'Trial', modules: [] },
        billing: ent?.billing || { cycle: 'Monthly', status: 'active', method: 'manual', nextBillAt: '', amountEtb: 0, graceEndsAt: '' },
        limits: ent?.limits || {},
      });
    } catch (e) {
      return next(e);
    }
  };

  r.get('/auth/me', requireAuth, meHandler);
  r.get('/me', requireAuth, meHandler);

  return r;
};

module.exports = { makeAuthRouter };
