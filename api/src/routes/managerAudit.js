const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makeManagerAuditRouter = () => {
  const r = express.Router();

  const resolveBranchId = (req) => {
    const role = String(req.auth?.role || '');
    const fromToken = String(req.auth?.branchId || '');
    const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

    if (role === 'Cafe Owner' && (!fromToken || fromToken === 'global')) return q || '';
    return fromToken;
  };

  const requireManagerOrOwner = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const role = String(req.auth?.role || '');
    if (role !== 'Branch Manager' && role !== 'Cafe Owner') {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  r.get('/manager/audit/list', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));
      const branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      let q = db().from({ a: 'audit_log' }).where({ 'a.tenant_id': req.tenant.id }).andWhere('a.branch_id', branchId);

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

      return res.json({ ok: true, branchId, audit });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerAuditRouter };
