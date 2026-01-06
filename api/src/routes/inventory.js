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

const normalizeBranchId = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === 'global') return '';
  if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
  return s;
};

const branchIdAlternates = (id) => {
  const s = String(id || '').trim();
  if (!s) return [];
  if (s.startsWith('br_')) return [s, `b_${s.slice(3)}`];
  if (s.startsWith('b_')) return [s, `br_${s.slice(2)}`];
  return [s];
};

const resolveBranchId = async (req) => {
  const fromToken = normalizeBranchId(req.auth?.branchId);
  const q = typeof req.query?.branchId === 'string' ? normalizeBranchId(req.query.branchId) : '';

  const role = String(req.auth?.role || '');
  const isOwnerGlobal = role === 'Cafe Owner' && (!fromToken || fromToken === 'global');
  if (!isOwnerGlobal) return fromToken;

  if (q) return q;

  try {
    const row = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc').first();
    return row?.id ? normalizeBranchId(row.id) : '';
  } catch {
    return '';
  }
};

const makeInventoryRouter = () => {
  const r = express.Router();

  r.get('/inventory/items', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const branchIds = branchIdAlternates(branchId);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));

      let base = db().from('inventory_items').where({ tenant_id: req.tenant.id });
      base = base.andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds));
      if (category) base = base.andWhere({ category });
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));

      const rows = await base
        .select(['id', 'branch_id', 'name', 'category', 'status', 'on_hand', 'reorder_level', 'unit', 'item_json', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(limit);

      const items = rows.map((x) => {
        const itemJson = safeJsonParse(x.item_json, {});
        const price = Number(itemJson?.cost ?? itemJson?.unitCost ?? itemJson?.price ?? 0) || 0;
        const stock = Number(x.on_hand || 0) || 0;
        const minStock = Number(x.reorder_level || 0) || 0;
        const status = stock <= 0 ? 'Critical' : stock < minStock ? 'Low Stock' : 'In Stock';
        return {
          id: String(x.id),
          name: String(x.name || ''),
          category: String(x.category || ''),
          stock,
          unit: String(x.unit || itemJson?.unit || ''),
          minStock,
          price,
          status,
          branchId: x.branch_id ? String(x.branch_id) : null,
          updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : null,
        };
      });

      return res.json({ ok: true, branchId, items });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/inventory/items', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};

      const id = String(body?.id || '').trim();
      const name = String(body?.name || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const category = String(body?.category || '').trim();
      const unit = String(body?.unit || '').trim();
      const stock = Number(body?.stock ?? 0);
      const minStock = Number(body?.minStock ?? 0);
      const price = Number(body?.price ?? 0);
      if (![stock, minStock, price].every((n) => Number.isFinite(n) && n >= 0)) return res.status(400).json({ error: 'invalid_numbers' });

      const nowIso = new Date().toISOString();
      await db().from('inventory_items').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: null,
        name,
        category: category || null,
        status: 'Active',
        on_hand: stock,
        reorder_level: minStock,
        unit: unit || null,
        item_json: JSON.stringify({ cost: price, unit }),
        created_at: nowIso,
        updated_at: nowIso,
      });

      try {
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'inventory_item.created',
          summary: `Created inventory item: ${name}`,
          payload_json: JSON.stringify({ id, name, category: category || null, stock, unit: unit || null, minStock, price }),
          created_at: nowIso,
        });
      } catch {
        // ignore audit failures
      }

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/inventory/items/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .select(['id', 'name', 'category', 'on_hand', 'reorder_level', 'unit', 'item_json'])
        .from('inventory_items')
        .where({ tenant_id: req.tenant.id, id })
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const patch = {};

      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim() || null;
      if (typeof body?.unit === 'string') patch.unit = body.unit.trim() || null;
      if (body?.stock != null) {
        const v = Number(body.stock);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_stock' });
        patch.on_hand = v;
      }
      if (body?.minStock != null) {
        const v = Number(body.minStock);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_minStock' });
        patch.reorder_level = v;
      }

      const prevJson = safeJsonParse(existing.item_json, {});
      const nextJson = { ...prevJson };
      if (body?.price != null) {
        const v = Number(body.price);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_price' });
        nextJson.cost = v;
      }
      if (typeof body?.unit === 'string') nextJson.unit = body.unit.trim();
      patch.item_json = JSON.stringify(nextJson);

      patch.updated_at = new Date().toISOString();

      await db().from('inventory_items').where({ tenant_id: req.tenant.id, id }).update(patch);

      try {
        const prevJson = safeJsonParse(existing.item_json, {});
        const prevPrice = Number(prevJson?.cost ?? prevJson?.unitCost ?? prevJson?.price ?? 0) || 0;
        const nextJsonObj = safeJsonParse(patch.item_json, prevJson);
        const nextPrice = Number(nextJsonObj?.cost ?? nextJsonObj?.unitCost ?? nextJsonObj?.price ?? prevPrice) || 0;
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'inventory_item.updated',
          summary: `Updated inventory item: ${String(patch.name || existing.name || id)}`,
          payload_json: JSON.stringify({
            id,
            before: {
              name: String(existing.name || ''),
              category: existing.category ? String(existing.category) : null,
              stock: Number(existing.on_hand || 0) || 0,
              unit: existing.unit ? String(existing.unit) : '',
              minStock: Number(existing.reorder_level || 0) || 0,
              price: prevPrice,
            },
            after: {
              name: String(patch.name ?? existing.name ?? ''),
              category: patch.category ?? (existing.category ? String(existing.category) : null),
              stock: patch.on_hand ?? (Number(existing.on_hand || 0) || 0),
              unit: patch.unit ?? (existing.unit ? String(existing.unit) : ''),
              minStock: patch.reorder_level ?? (Number(existing.reorder_level || 0) || 0),
              price: nextPrice,
            },
          }),
          created_at: patch.updated_at,
        });
      } catch {
        // ignore audit failures
      }
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/inventory/items/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'name']).from('inventory_items').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('inventory_items').where({ tenant_id: req.tenant.id, id }).delete();

      try {
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'inventory_item.deleted',
          summary: `Deleted inventory item: ${existing?.name ? String(existing.name) : id}`,
          payload_json: JSON.stringify({ id, name: existing?.name ? String(existing.name) : '' }),
          created_at: new Date().toISOString(),
        });
      } catch {
        // ignore audit failures
      }
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeInventoryRouter };
