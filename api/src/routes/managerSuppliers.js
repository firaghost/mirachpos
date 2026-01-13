const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makeManagerSuppliersRouter = () => {
  const r = express.Router();

  const branchIdAliases = (branchId) => {
    const bid = String(branchId || '').trim();
    if (!bid) return [];
    if (bid.startsWith('br_')) return [bid, `b_${bid.slice(3)}`];
    if (bid.startsWith('b_') && !bid.startsWith('br_')) return [bid, `br_${bid.slice(2)}`];
    return [bid];
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

  const mapSupplier = (row) => {
    const sj = safeJsonParse(row.supplier_json, {});
    return {
      id: String(row.id),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      email: String(row.email || ''),
      address: String(row.address || ''),
      status: String(row.status || 'Active'),
      notes: String(sj?.notes || ''),
      branchId: String(row.branch_id || ''),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  };

  r.get('/manager/suppliers', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Vary', 'Origin, Authorization, X-Tenant');
      } catch {
        // ignore
      }

      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAliases(branchId);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));

      let base = db().from('suppliers').where({ tenant_id: req.tenant.id }).whereIn('branch_id', branchIds);
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('email', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`));

      const rows = await base.select(['id', 'branch_id', 'name', 'phone', 'email', 'address', 'status', 'supplier_json', 'updated_at']).orderBy('updated_at', 'desc').limit(limit);
      return res.json({ ok: true, branchId, suppliers: rows.map(mapSupplier) });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/suppliers', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });

      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const address = typeof body?.address === 'string' ? body.address.trim() : '';
      const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
      const status = typeof body?.status === 'string' ? body.status.trim() : 'Active';

      const id = makeId('sup');
      const nowIso = new Date().toISOString();

      await db().from('suppliers').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        status: status || 'Active',
        supplier_json: JSON.stringify({ notes }),
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/suppliers/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().from('suppliers').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).select(['id', 'supplier_json']).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const patch = {};

      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.phone === 'string') patch.phone = body.phone.trim() || null;
      if (typeof body?.email === 'string') patch.email = body.email.trim() || null;
      if (typeof body?.address === 'string') patch.address = body.address.trim() || null;
      if (typeof body?.status === 'string') patch.status = body.status.trim() || 'Active';

      const prevJson = safeJsonParse(existing.supplier_json, {});
      const nextJson = { ...prevJson };
      if (typeof body?.notes === 'string') nextJson.notes = body.notes.trim();
      patch.supplier_json = JSON.stringify(nextJson);

      patch.updated_at = new Date().toISOString();

      await db().from('suppliers').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/suppliers/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('suppliers').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerSuppliersRouter };
