const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');

const { loadEntitlements, requireModule, enforceBranchLimit } = require('../middleware/entitlements');
const { makeId } = require('../utils/ids');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { validateBranchCreate, validateBranchUpdate, validateBranchEvent, validateIdParam } = require('../middleware/validators');
const { logAudit } = require('../utils/logger');

const makeBranchesRouter = () => {
  const r = express.Router();

  r.get(
    '/branches',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager', 'Waiter'),
    loadEntitlements,
    async (req, res, next) => {
    try {
      const role = String(req.auth?.role || '').trim();
      const staffBranchId = req.auth?.branchId ? String(req.auth.branchId) : '';

      const rows = await db()
        .select(['b.id', 'b.name', 'b.status', 'b.city', 'b.address', 'b.phone', 'b.manager_name', 'b.region', 'b.rating'])
        .from({ b: 'branches' })
        .where({ 'b.tenant_id': req.tenant.id })
        .orderBy('b.name', 'asc');

      const visibleRows = (() => {
        if (role === 'Cafe Owner') return rows;
        if (!staffBranchId || staffBranchId === 'global') return [];
        return rows.filter((b) => String(b.id) === staffBranchId);
      })();

      const staffCounts = await db()
        .select(['branch_id'])
        .count({ c: '*' })
        .from('staff')
        .where({ tenant_id: req.tenant.id })
        .groupBy('branch_id');

      const countByBranch = new Map();
      for (const r0 of staffCounts) {
        const bid = r0.branch_id ? String(r0.branch_id) : 'global';
        const c = Number(r0.c ?? r0.count ?? r0['count(*)'] ?? 0) || 0;
        countByBranch.set(bid, c);
      }

      const branches = visibleRows.map((b) => ({
        id: String(b.id),
        name: String(b.name || ''),
        status: String(b.status || 'Open'),
        city: String(b.city || ''),
        region: String(b.region || b.city || ''),
        address: String(b.address || ''),
        phone: String(b.phone || ''),
        managerName: String(b.manager_name || ''),
        staffCount: Number(countByBranch.get(String(b.id)) || 0) || 0,
        rating: Number(b.rating || 0) || 4.6,
      }));

      return res.json({ ok: true, branches });
    } catch (e) {
      return next(e);
    }
  });

  // Owner creates new branch (used by OwnerBranches screen)
  r.post(
    '/branches/register',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('branches'),
    requireRole('Cafe Owner'),
    requirePermission('branches.create'),
    enforceBranchLimit,
    validateBranchCreate,
    async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name_required' });

      const nowIso = new Date().toISOString();
      const id = makeId('br');

      const status = body?.status === 'Closed' || body?.status === 'Maintenance' ? body.status : 'Open';
      const rating = Number(body?.rating);
      const safeRating = Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 4.6;

      await db().from('branches').insert({
        id,
        tenant_id: req.tenant.id,
        name,
        status,
        city: typeof body?.city === 'string' ? body.city.trim() : null,
        address: typeof body?.address === 'string' ? body.address.trim() : null,
        phone: typeof body?.phone === 'string' ? body.phone.trim() : null,
        manager_name: typeof body?.managerName === 'string' ? body.managerName.trim() : null,
        region: typeof body?.region === 'string' ? body.region.trim() : null,
        rating: safeRating,
        created_at: nowIso,
        updated_at: nowIso,
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: id,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.branch.created',
        summary: `Created branch ${name}`,
        payload: { id, name, status },
        requestId: req.requestId,
      });

      return res.status(201).json({ ok: true, branch: { id, name, status, rating: safeRating } });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.put(
    '/branches/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('branches'),
    requireRole('Cafe Owner'),
    requirePermission('branches.update'),
    validateIdParam,
    validateBranchUpdate,
    async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const branchId = String(id || '').trim();
      if (!branchId) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id', 'name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};

      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.status === 'string') patch.status = body.status === 'Closed' || body.status === 'Maintenance' ? body.status : 'Open';
      if (typeof body?.city === 'string') patch.city = body.city.trim();
      if (typeof body?.address === 'string') patch.address = body.address.trim();
      if (typeof body?.phone === 'string') patch.phone = body.phone.trim();
      if (typeof body?.managerName === 'string') patch.manager_name = body.managerName.trim();
      if (typeof body?.region === 'string') patch.region = body.region.trim();
      if (body?.rating != null) {
        const rating = Number(body.rating);
        if (!Number.isFinite(rating)) return res.status(400).json({ error: 'invalid_rating' });
        patch.rating = Math.min(5, Math.max(0, rating));
      }
      patch.updated_at = new Date().toISOString();

      await db().from('branches').where({ tenant_id: req.tenant.id, id: branchId }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.branch.updated',
        summary: `Updated branch ${String(existing?.name || branchId)}`,
        payload: { id: branchId, patch },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.delete(
    '/branches/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('branches'),
    requireRole('Cafe Owner'),
    requirePermission('branches.delete'),
    validateIdParam,
    async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const branchId = String(id || '').trim();
      if (!branchId) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id', 'name', 'status']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      // Soft delete: close branch (preserve historical integrity)
      await db().from('branches').where({ tenant_id: req.tenant.id, id: branchId }).update({ status: 'Closed', updated_at: new Date().toISOString() });

      await logAudit({
        tenantId: req.tenant.id,
        branchId,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.branch.deleted',
        summary: `Closed branch ${String(existing?.name || branchId)}`,
        payload: { id: branchId, status: 'Closed', prevStatus: String(existing?.status || '') },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.post(
    '/branches/:id/events',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('inventory'),
    requirePermission('inventory.update'),
    validateIdParam,
    validateBranchEvent,
    async (req, res, next) => {
    try {
      if (!req.auth?.staffId) return res.status(401).json({ error: 'unauthorized' });

      const { id } = req.validatedParams || req.params;
      const branchId = String(id || '').trim();
      if (!branchId) return res.status(400).json({ error: 'invalid_branch_id' });

      const branch = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
      if (!branch) return res.status(404).json({ error: 'branch_not_found' });

      const body = req.validatedBody || req.body;
      const type = typeof body?.type === 'string' ? body.type.trim() : '';
      const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
      if (!type) return res.status(400).json({ error: 'type_required' });

      const actorStaffId = req.auth?.staffId ? String(req.auth.staffId) : null;
      const actorRole = req.auth?.role ? String(req.auth.role) : null;

      const summary = (() => {
        if (type === 'po_created') return 'Created purchase order';
        if (type === 'transfer_requested') return 'Requested inventory transfer';
        if (type === 'inventory_count') return 'Logged inventory count';
        return `Inventory event: ${type}`;
      })();

      await logAudit({
        tenantId: req.tenant.id,
        branchId,
        actorStaffId,
        actorRole,
        type: `inventory.${type}`,
        summary,
        payload: { ...payload, branchId },
        requestId: req.requestId,
      });

      const nowIso = new Date().toISOString();
      await db().from('events').insert({
        id: makeId('ev'),
        tenant_id: req.tenant.id,
        branch_id: branchId,
        type,
        payload: JSON.stringify(payload),
        at: nowIso,
      });

      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeBranchesRouter };
