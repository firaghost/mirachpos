const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makeAuditRouter = () => {
  const r = express.Router();

  r.post('/audit/log', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const type = typeof body?.type === 'string' ? body.type.trim() : '';
      const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
      const payload = body && Object.prototype.hasOwnProperty.call(body, 'payload') ? body.payload : null;
      const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : '';

      if (!type) return res.status(200).json({ ok: true, ignored: true });

      const id = makeId('aud');
      const nowIso = new Date().toISOString();

      await db().from('audit_log').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId || (req.auth?.branchId ? String(req.auth.branchId) : null) || null,
        actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
        actor_role: req.auth?.role ? String(req.auth.role) : null,
        type,
        summary: summary || null,
        payload_json: payload != null ? JSON.stringify(payload) : null,
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/audit/list', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));
      const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
      const includeSystem = String(req.query?.includeSystem || '').trim() === '1';

      let q = db().from({ a: 'audit_log' }).where({ 'a.tenant_id': req.tenant.id });
      if (branchId) q = q.andWhere('branch_id', branchId);
      if (!includeSystem) q = q.andWhereNot({ 'a.actor_role': 'superadmin' });

      const rows = await q
        .leftJoin({ s: 'staff' }, function joinStaff() {
          this.on('s.id', '=', 'a.actor_staff_id').andOn('s.tenant_id', '=', 'a.tenant_id');
        })
        .select([
          'a.id',
          'a.branch_id',
          'a.actor_staff_id',
          'a.actor_role',
          'a.type',
          'a.summary',
          'a.payload_json',
          'a.created_at',
          's.name as actor_name',
          's.email as actor_email',
        ])
        .orderBy('a.created_at', 'desc')
        .limit(limit);

      const audit = rows.map((x) => ({
        id: String(x.id),
        branchId: x.branch_id ? String(x.branch_id) : 'global',
        actorStaffId: x.actor_staff_id ? String(x.actor_staff_id) : '',
        actorName: x.actor_name ? String(x.actor_name) : '',
        actorEmail: x.actor_email ? String(x.actor_email) : '',
        actorRole: x.actor_role ? String(x.actor_role) : '',
        type: String(x.type || ''),
        summary: String(x.summary || ''),
        payload: safeJsonParse(x.payload_json, null),
        at: x.created_at ? new Date(x.created_at).toISOString() : '',
      }));

      return res.json({ ok: true, audit });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeAuditRouter };
