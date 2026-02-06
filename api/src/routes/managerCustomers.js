const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');
const { sanitizeLikeInput } = require('../utils/sanitize');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole } = require('../middleware/permissions');
const { validateManagerCustomerCreate, validateManagerCustomerUpdate, validateManagerCustomersQuery, validateIdParam } = require('../middleware/validators');

const normalizeIso = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const makeManagerCustomersRouter = () => {
  const r = express.Router();

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

  r.get(
    '/manager/customers',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('guests'),
    requireBranchId(),
    validateManagerCustomersQuery,
    async (req, res, next) => {
    try {
      const branchId = req.branchId || resolveBranchId(req);

      const queryParams = req.validatedQuery || req.query;
      const page = Math.max(1, Number(queryParams?.page || 1) || 1);
      const pageSize = Math.max(1, Math.min(200, Number(queryParams?.pageSize || queryParams?.limit || 50) || 50));
      const offset = (page - 1) * pageSize;
      const q = sanitizeLikeInput(queryParams?.q, { lower: true, maxLen: 80 });

      let query = db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (q) {
        query = query.andWhere((b) => {
          b.whereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(phone) LIKE ?', [`%${q}%`]).orWhere('id', 'like', `%${q}%`);
        });
      }

      const totalRow = await query.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await query
        .select(['id', 'name', 'phone', 'loyalty_points', 'loyalty_balance', 'status', 'created_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      return res.json({ ok: true, branchId, page, pageSize, total, customers: rows.map(mapCustomer) });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/manager/customers',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('guests'),
    requireBranchId(),
    validateManagerCustomerCreate,
    async (req, res, next) => {
    try {
      const branchId = req.branchId || resolveBranchId(req);

      const body = req.validatedBody || req.body;
      const name = String(body?.name || '').trim();
      const phone = String(body?.phone || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!phone) return res.status(400).json({ error: 'phone_required' });

      const loyaltyPoints = Number(body?.loyaltyPoints ?? 0) || 0;
      const loyaltyBalance = Number(body?.loyaltyBalance ?? 0) || 0;
      const status = String(body?.status || 'Active').trim() || 'Active';

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

  r.put(
    '/manager/customers/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('guests'),
    requireBranchId(),
    validateIdParam,
    validateManagerCustomerUpdate,
    async (req, res, next) => {
    try {
      const branchId = req.branchId || resolveBranchId(req);

      const { id } = req.validatedParams || req.params;
      const customerId = String(id || '').trim();
      if (!customerId) return res.status(400).json({ error: 'id_required' });

      const body = req.validatedBody || req.body;
      const patch = { updated_at: new Date().toISOString() };
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.phone === 'string') patch.phone = body.phone.trim();
      if (typeof body?.status === 'string') patch.status = body.status.trim();
      if (body?.loyaltyPoints != null) patch.loyalty_points = Number(body.loyaltyPoints || 0) || 0;
      if (body?.loyaltyBalance != null) patch.loyalty_balance = Number(body.loyaltyBalance || 0) || 0;
      if (typeof body?.updatedAt === 'string') {
        const iso = normalizeIso(body.updatedAt);
        if (iso) patch.updated_at = iso;
      }

      const updated = await db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId }).update(patch);
      if (!updated) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'phone_in_use' });
      }
      return next(e);
    }
  });

  r.delete(
    '/manager/customers/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('guests'),
    requireBranchId(),
    validateIdParam,
    async (req, res, next) => {
    try {
      const branchId = req.branchId || resolveBranchId(req);

      const { id } = req.validatedParams || req.params;
      const customerId = String(id || '').trim();
      if (!customerId) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('customers').where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerCustomersRouter };
