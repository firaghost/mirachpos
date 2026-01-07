const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const normalizeIso = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const resolveBranchId = async (req) => {
  const fromToken = String(req.auth?.branchId || '').trim();
  const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

  const role = String(req.auth?.role || '');
  const isOwnerGlobal = role === 'Cafe Owner' && (!fromToken || fromToken === 'global');
  if (!isOwnerGlobal) return fromToken;

  if (q) return q;

  try {
    const row = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc').first();
    return row?.id ? String(row.id) : '';
  } catch {
    return '';
  }
};

const makePosCustomersRouter = () => {
  const r = express.Router();

  const mapCustomer = (row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    loyaltyPoints: Number(row.loyalty_points ?? 0) || 0,
    loyaltyBalance: Number(row.loyalty_balance ?? 0) || 0,
    status: String(row.status || 'Active'),
  });

  // Lightweight customer search for POS flows
  r.get('/pos/customers', tenantMiddleware, requireAuth, loadEntitlements, requireModule('guests'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      let query = db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Active' });
      if (q) {
        query = query.andWhere((b) => {
          b.whereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(phone) LIKE ?', [`%${q}%`]).orWhere('id', 'like', `%${q}%`);
        });
      }

      const rows = await query.select(['id', 'name', 'phone', 'loyalty_points', 'loyalty_balance', 'status']).orderBy('updated_at', 'desc').limit(limit);
      return res.json({ ok: true, branchId, customers: rows.map(mapCustomer) });
    } catch (e) {
      return next(e);
    }
  });

  // Create customer (POS)
  r.post('/pos/customers', tenantMiddleware, requireAuth, loadEntitlements, requireModule('guests'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const name = String(req.body?.name || '').trim();
      const phone = String(req.body?.phone || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!phone) return res.status(400).json({ error: 'phone_required' });

      const id = uid('cus');
      const nowIso = new Date().toISOString();

      await db().from('customers').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        phone,
        loyalty_points: 0,
        loyalty_balance: 0,
        status: 'Active',
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'phone_in_use' });
      }
      return next(e);
    }
  });

  // Update loyalty or profile (POS)
  r.put('/pos/customers/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('guests'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const patch = { updated_at: new Date().toISOString() };
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.phone === 'string') patch.phone = req.body.phone.trim();
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

  return r;
};

module.exports = { makePosCustomersRouter };
