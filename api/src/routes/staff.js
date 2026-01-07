const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { resolveBranchId, resolveBranchIdFromBody, requireBranchId, requireBranchIdFromBody } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const makeStaffRouter = () => {
  const r = express.Router();

  r.get('/staff/shifts', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), requireBranchId(), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const role = String(req.auth?.role || '');
      if (role !== 'Branch Manager' && role !== 'Cafe Owner') return res.status(403).json({ error: 'forbidden' });

      const branchId = req.branchId || resolveBranchId(req);

      const status = typeof req.query?.status === 'string' ? req.query.status.trim().toLowerCase() : '';
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));

      let q = db()
        .from({ sl: 'shift_logs' })
        .leftJoin({ s: 'staff' }, function joinStaff() {
          this.on('s.id', '=', 'sl.staff_id').andOn('s.tenant_id', '=', 'sl.tenant_id');
        })
        .where({ 'sl.tenant_id': req.tenant.id, 'sl.branch_id': branchId });

      if (status === 'open') q = q.whereNull('sl.clock_out_at');
      if (status === 'closed') q = q.whereNotNull('sl.clock_out_at');

      const rows = await q
        .select(['sl.id', 'sl.staff_id', 'sl.clock_in_at', 'sl.clock_out_at', 's.name as staff_name', 's.role_name as staff_role'])
        .orderBy('sl.clock_in_at', 'desc')
        .limit(limit);

      const shifts = rows.map((x) => ({
        id: String(x.id),
        staffId: String(x.staff_id),
        staffName: String(x.staff_name || ''),
        staffRole: String(x.staff_role || ''),
        clockInAt: x.clock_in_at ? new Date(x.clock_in_at).toISOString() : null,
        clockOutAt: x.clock_out_at ? new Date(x.clock_out_at).toISOString() : null,
        status: x.clock_out_at ? 'closed' : 'open',
      }));

      const openCount = shifts.reduce((acc, s) => acc + (s.status === 'open' ? 1 : 0), 0);
      return res.json({ ok: true, branchId, openCount, shifts });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/staff/shifts', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), requireBranchIdFromBody(), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const role = String(req.auth?.role || '');
      if (role !== 'Branch Manager' && role !== 'Cafe Owner') return res.status(403).json({ error: 'forbidden' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const action = typeof body?.action === 'string' ? body.action.trim() : '';
      const staffId = typeof body?.staffId === 'string' ? body.staffId.trim() : '';
      if (!staffId) return res.status(400).json({ error: 'staff_id_required' });
      if (action !== 'clock_in' && action !== 'clock_out') return res.status(400).json({ error: 'invalid_action' });

      const branchId = req.branchId || resolveBranchIdFromBody(req, body);

      const b = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
      if (!b) return res.status(404).json({ error: 'branch_not_found' });

      const s = await db().select(['id', 'branch_id']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
      if (!s) return res.status(404).json({ error: 'staff_not_found' });
      if (String(s.branch_id || '') !== String(branchId)) return res.status(403).json({ error: 'forbidden' });

      const at = new Date().toISOString();

      if (action === 'clock_in') {
        const open = await db()
          .select(['id'])
          .from('shift_logs')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, staff_id: staffId })
          .whereNull('clock_out_at')
          .first();
        if (open) return res.status(409).json({ error: 'shift_already_open' });

        const rec = {
          id: makeId('shift'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          staff_id: staffId,
          clock_in_at: at,
          clock_out_at: null,
        };
        await db().from('shift_logs').insert(rec);

        return res.status(201).json({ ok: true, branchId, log: { id: rec.id, staffId, clockInAt: at } });
      }

      const open = await db()
        .select(['id', 'clock_in_at'])
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, staff_id: staffId })
        .whereNull('clock_out_at')
        .orderBy('clock_in_at', 'desc')
        .first();
      if (!open) return res.status(409).json({ error: 'no_open_shift' });

      await db().from('shift_logs').where({ tenant_id: req.tenant.id, id: String(open.id) }).update({ clock_out_at: at });

      return res.json({ ok: true, branchId, log: { id: String(open.id), staffId, clockInAt: new Date(open.clock_in_at).toISOString(), clockOutAt: at } });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeStaffRouter };
