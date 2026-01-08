const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');

const { loadEntitlements, requireModule, enforceBranchLimit } = require('../middleware/entitlements');
const { makeId } = require('../utils/ids');
const { requireRole, requirePermission } = require('../middleware/permissions');

const makeBranchesRouter = () => {
  const r = express.Router();

  const logAudit = async ({ tenantId, branchId, actorStaffId, actorRole, type, summary, payload }) => {
    try {
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: tenantId,
        branch_id: branchId || null,
        actor_staff_id: actorStaffId || null,
        actor_role: actorRole || null,
        type,
        summary: summary || null,
        payload_json: payload != null ? JSON.stringify(payload) : null,
        created_at: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  };

  r.get(
    '/branches',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('branches'),
    requirePermission('branches.read'),
    async (req, res, next) => {
    try {
      const rows = await db()
        .select(['b.id', 'b.name', 'b.status', 'b.city', 'b.address', 'b.phone', 'b.manager_name', 'b.region', 'b.rating'])
        .from({ b: 'branches' })
        .where({ 'b.tenant_id': req.tenant.id })
        .orderBy('b.name', 'asc');

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

      const branches = rows.map((b) => ({
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
    async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
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
    async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id', 'name']).from('branches').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
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

      await db().from('branches').where({ tenant_id: req.tenant.id, id }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId: id,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.branch.updated',
        summary: `Updated branch ${String(existing?.name || id)}`,
        payload: { id, patch },
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
    async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id', 'name', 'status']).from('branches').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      // Soft delete: close branch (preserve historical integrity)
      await db().from('branches').where({ tenant_id: req.tenant.id, id }).update({ status: 'Closed', updated_at: new Date().toISOString() });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: id,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.branch.deleted',
        summary: `Closed branch ${String(existing?.name || id)}`,
        payload: { id, status: 'Closed', prevStatus: String(existing?.status || '') },
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
    async (req, res, next) => {
    try {
      if (!req.auth?.staffId) return res.status(401).json({ error: 'unauthorized' });

      const branchId = String(req.params?.id || '').trim();
      if (!branchId) return res.status(400).json({ error: 'invalid_branch_id' });

      const branch = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
      if (!branch) return res.status(404).json({ error: 'branch_not_found' });

      const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
      const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
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
