const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');

const normalizeIso = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const makeManagerCustomersRouter = () => {
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

  const mapCustomer = (row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    loyaltyPoints: Number(row.loyalty_points ?? row.loyaltyPoints ?? 0) || 0,
    loyaltyBalance: Number(row.loyalty_balance ?? row.loyaltyBalance ?? 0) || 0,
    status: String(row.status || 'Active'),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  });

  r.get('/manager/customers', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      let query = db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (q) {
        query = query.andWhere((b) => {
          b.whereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(phone) LIKE ?', [`%${q}%`]).orWhere('id', 'like', `%${q}%`);
        });
      }

      const rows = await query.select(['id', 'name', 'phone', 'loyalty_points', 'loyalty_balance', 'status', 'created_at', 'updated_at']).orderBy('updated_at', 'desc').limit(limit);
      return res.json({ ok: true, branchId, customers: rows.map(mapCustomer) });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/customers', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const name = String(req.body?.name || '').trim();
      const phone = String(req.body?.phone || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!phone) return res.status(400).json({ error: 'phone_required' });

      const loyaltyPoints = Number(req.body?.loyaltyPoints ?? 0) || 0;
      const loyaltyBalance = Number(req.body?.loyaltyBalance ?? 0) || 0;
      const status = String(req.body?.status || 'Active').trim() || 'Active';

      const id = uid('cus');
      const nowIso = new Date().toISOString();

      await db().from('customers').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        phone,
        loyalty_points: loyaltyPoints,
        loyalty_balance: loyaltyBalance,
        status,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      // Unique constraint (tenant_id, branch_id, phone)
      if (String(e?.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'phone_in_use' });
      }
      return next(e);
    }
  });

  r.put('/manager/customers/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const patch = { updated_at: new Date().toISOString() };
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.phone === 'string') patch.phone = req.body.phone.trim();
      if (typeof req.body?.status === 'string') patch.status = req.body.status.trim();
      if (req.body?.loyaltyPoints != null) patch.loyalty_points = Number(req.body.loyaltyPoints || 0) || 0;
      if (req.body?.loyaltyBalance != null) patch.loyalty_balance = Number(req.body.loyaltyBalance || 0) || 0;
      if (typeof req.body?.updatedAt === 'string') {
        const iso = normalizeIso(req.body.updatedAt);
        if (iso) patch.updated_at = iso;
      }

      const updated = await db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
      if (!updated) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'phone_in_use' });
      }
      return next(e);
    }
  });

  r.delete('/manager/customers/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerCustomersRouter };
