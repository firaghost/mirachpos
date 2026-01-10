const express = require('express');
const bcrypt = require('bcryptjs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');

const makeWaiterRouter = () => {
  const r = express.Router();

  const resolveBranchId = (req) => {
    const role = String(req.auth?.role || '').trim();
    const fromToken = String(req.auth?.branchId || '').trim();
    const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

    if (role === 'Waiter Manager') {
      if (fromToken && fromToken !== 'global') return fromToken;
      if (q && q !== 'global') return q;
      return '';
    }

    return fromToken;
  };

  const requireWaiter = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const branchId = resolveBranchId(req);
    if (!branchId || branchId === 'global') {
      res.status(400).json({ error: 'branch_required' });
      return false;
    }
    return true;
  };

  r.put(
    '/waiter/account',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const staffId = String(req.auth?.staffId || '');
      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      const currentPin = typeof body?.currentPin === 'string' ? body.currentPin : '';
      const newPin = typeof body?.newPin === 'string' ? body.newPin : '';

      if (!newPassword && !newPin) return res.status(400).json({ error: 'no_changes' });
      if (newPassword && newPassword.length < 4) return res.status(400).json({ error: 'password_too_short' });
      if (newPin && newPin.length < 3) return res.status(400).json({ error: 'pin_too_short' });

      const staff = await db()
        .select(['id', 'tenant_id', 'branch_id', 'role_name', 'password_hash', 'pin_hash'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: staffId, branch_id: branchId })
        .first();

      if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      if (role === 'Waiter' && String(staff.role_name || '') !== 'Waiter') return res.status(403).json({ error: 'forbidden' });

      if (newPassword) {
        const match = await bcrypt.compare(String(currentPassword || ''), String(staff.password_hash || ''));
        if (!match) return res.status(401).json({ error: 'invalid_credentials' });
      }

      if (newPin) {
        const pinHash = String(staff.pin_hash || '');
        if (pinHash) {
          const match = await bcrypt.compare(String(currentPin || ''), pinHash);
          if (!match) return res.status(401).json({ error: 'invalid_credentials' });
        }
      }

      const patch = {};
      if (newPassword) patch.password_hash = await bcrypt.hash(String(newPassword), 10);
      if (newPin) patch.pin_hash = await bcrypt.hash(String(newPin), 10);
      if (Object.keys(patch).length === 0) return res.json({ ok: true });

      await db().from('staff').where({ tenant_id: req.tenant.id, id: staffId }).update({ ...patch, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const fromRaw = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
      const toRaw = typeof req.query?.to === 'string' ? req.query.to.trim() : '';
      const page = Math.max(1, Number(req.query?.page || 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(req.query?.pageSize || 25) || 25));

      const parseIsoDateTime = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const d = new Date(v);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString();
      };

      const parseIsoDate = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
        if (!m) return null;
        const d = new Date(`${v}T00:00:00.000Z`);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };

      const fromDateOnly = parseIsoDate(fromRaw);
      const toDateOnly = parseIsoDate(toRaw);
      const fromIso = fromDateOnly ? `${fromDateOnly}T00:00:00.000Z` : parseIsoDateTime(fromRaw);
      const toIso = toDateOnly ? `${toDateOnly}T23:59:59.999Z` : parseIsoDateTime(toRaw);

      const base = db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) {
        if (status === 'Open') {
          base.whereNotIn('status', ['Paid', 'Voided']);
        } else {
          base.andWhere({ status });
        }
      }

      if (fromIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '>=', fromIso).orWhere('paid_at', '>=', fromIso);
        });
      }
      if (toIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '<=', toIso).orWhere('paid_at', '<=', toIso);
        });
      }

      const rows0 = await base
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'paid_at', 'payload'])
        .orderBy('created_at', 'desc');

      const enriched = rows0
        .map((o) => {
          const payload = o.payload ? (() => {
            try {
              return JSON.parse(String(o.payload));
            } catch {
              return {};
            }
          })() : {};
          return {
            id: String(o.id),
            number: String(payload?.number || ''),
            tableName: String(payload?.tableName || ''),
            timeLabel: String(payload?.timeLabel || ''),
            createdByName: String(payload?.createdByName || ''),
            createdByStaffId: String(payload?.createdByStaffId || ''),
            items: Array.isArray(payload?.items) ? payload.items : [],
            status: String(o.status || ''),
            total: Number(o.total || 0),
            createdAt: o.created_at ? new Date(o.created_at).toISOString() : '',
            paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : '',
          };
        })
        .filter((o) => {
          if (role === 'Waiter Manager') return true;
          const createdBy = String(o.createdByStaffId || '').trim();
          return createdBy && createdBy === staffId;
        })
        .filter((o) => {
          if (!q) return true;
          return String(o.number || '').toLowerCase().includes(q) || String(o.tableName || '').toLowerCase().includes(q);
        });

      const total = enriched.length;
      const start = (page - 1) * pageSize;
      const items = enriched.slice(start, start + pageSize);

      return res.json({ ok: true, orders: items, page, pageSize, total, branchId });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/order/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const orderId = String(req.params?.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'order_id_required' });

      const row = await db()
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'payload'])
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .first();

      if (!row) return res.status(404).json({ error: 'not_found' });

      const payload = row.payload
        ? (() => {
            try {
              return JSON.parse(String(row.payload));
            } catch {
              return {};
            }
          })()
        : {};

      const order = {
        id: String(row.id),
        number: String(payload?.number || ''),
        tableName: String(payload?.tableName || ''),
        timeLabel: String(payload?.timeLabel || ''),
        createdByName: String(payload?.createdByName || ''),
        createdByStaffId: String(payload?.createdByStaffId || ''),
        items: Array.isArray(payload?.items) ? payload.items : [],
        status: String(row.status || ''),
        total: Number(row.total || 0),
        tax: Number(row.tax || 0),
        tip: Number(row.tip || 0),
        discount: Number(row.discount || 0),
        discountPct: payload?.discountPct == null ? 0 : Number(payload.discountPct || 0) || 0,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        payload,
      };

      if (role !== 'Waiter Manager' && String(order.createdByStaffId || '').trim() !== staffId) return res.status(403).json({ error: 'forbidden' });

      return res.json({ ok: true, branchId, order });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/shift-report',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      if (role === 'Waiter Manager') {
        const staff = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
        if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      }

      const logs = await db()
        .select(['id', 'staff_id', 'clock_in_at', 'clock_out_at'])
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, staff_id: staffId })
        .orderBy('clock_in_at', 'desc')
        .limit(500);

      const staff = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
      const staffName = staff ? String(staff.name || '') : '';

      const shiftLogs = logs.map((l) => ({
        id: String(l.id),
        staffId: String(l.staff_id),
        staffName,
        clockInAt: new Date(l.clock_in_at).toISOString(),
        clockOutAt: l.clock_out_at ? new Date(l.clock_out_at).toISOString() : undefined,
      }));

      return res.json({ ok: true, branchId, staffId, shiftLogs });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeWaiterRouter };
