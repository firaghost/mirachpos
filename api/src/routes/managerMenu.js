const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId, uid } = require('../utils/ids');
const { publish } = require('../services/realtimeHub');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { logAudit } = require('../utils/logger');
const {
  validateIdParam,
  validateManagerMenuProductCreate,
  validateManagerMenuProductUpdate,
  validateManagerMenuProductsQuery,
  validateManagerMenuRecipesQuery,
  validateProductIdParam,
  validateManagerMenuRecipeUpsert,
} = require('../middleware/validators');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

const makeManagerMenuRouter = () => {
  const r = express.Router();

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

  const normalizeCode = (raw, name) => {
    const base = String(raw || '').trim();
    if (base) return base;
    const n = String(name || '').trim();
    if (!n) return '';
    return n
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
  };

  const mapProduct = (row) => {
    const pj = safeJsonParse(row.product_json, {});
    return {
      id: String(row.id),
      code: String(pj?.code || ''),
      name: String(row.name || ''),
      price: Number(row.price || 0) || 0,
      category: String(row.category || 'Uncategorized'),
      image: String(pj?.image || ''),
      description: String(pj?.description || ''),
      stock: Number(pj?.stock ?? 500) || 500,
      status: String(row.status || 'Active'),
      branchId: row.branch_id ? String(row.branch_id) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  };

  const mapModifierGroup = (row) => {
    return {
      id: String(row.id),
      name: String(row.name || ''),
      min: Number(row.min_select ?? 0) || 0,
      max: Number(row.max_select ?? 0) || 0,
      sortOrder: Number(row.sort_order ?? 0) || 0,
      branchId: row.branch_id ? String(row.branch_id) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  };

  const mapModifierOption = (row) => {
    return {
      id: String(row.id),
      groupId: String(row.group_id),
      name: String(row.name || ''),
      priceDelta: Number(row.price_delta ?? 0) || 0,
      sortOrder: Number(row.sort_order ?? 0) || 0,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  };

  const normalizeRecipe = (raw) => {
    const r0 = raw && typeof raw === 'object' ? raw : {};
    const ings = Array.isArray(r0.ingredients) ? r0.ingredients : [];
    const ingredients = ings
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        ingredientId: String(x.ingredientId || ''),
        name: String(x.name || ''),
        quantity: Number(x.quantity ?? 0) || 0,
        cost: Number(x.cost ?? 0) || 0,
      }))
      .filter((x) => x.ingredientId && x.name && x.quantity >= 0);

    const totalCost = Number(r0.totalCost ?? 0) || 0;
    return { ingredients, totalCost };
  };

  // Products
  r.get('/manager/menu/products', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateManagerMenuProductsQuery, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const branchIds = branchIdAlternates(branchId);

      const queryParams = req.validatedQuery || req.query;
      const q = typeof queryParams?.q === 'string' ? queryParams.q.trim().toLowerCase() : '';
      const category = typeof queryParams?.category === 'string' ? queryParams.category.trim() : '';
      const status = typeof queryParams?.status === 'string' ? queryParams.status.trim() : '';
      const limit = Math.max(1, Math.min(500, Number(queryParams?.limit || 200) || 200));

      let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
      base = base.andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds));
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
      if (category) base = base.andWhere('category', category);
      if (status && status !== 'All') base = base.andWhere('status', status);

      const rows = await base
        .clone()
        .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(limit);

      const products = rows.map(mapProduct);

      const categoriesRows = await db()
        .from('menu_products')
        .where({ tenant_id: req.tenant.id })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .distinct('category as c');

      const categories = Array.from(new Set(categoriesRows.map((x) => String(x.c || 'Uncategorized'))))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      return res.json({ ok: true, branchId, products, categories });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/products', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateManagerMenuProductCreate, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.validatedBody || req.body;
      const name = String(body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });

      const id = uid('prd');
      const category = String(body?.category || 'Uncategorized').trim() || 'Uncategorized';
      const status = body?.status === 'Inactive' ? 'Inactive' : 'Active';
      const price = Number(body?.price || 0) || 0;
      const code = normalizeCode(body?.code, name);
      const image = String(body?.image || '').trim();
      const description = String(body?.description || '').trim();

      const nowIso = new Date().toISOString();
      await db().from('menu_products').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        category,
        status,
        price,
        product_json: JSON.stringify({ code, image, description }),
        created_at: nowIso,
        updated_at: nowIso,
      });

      try {
        await logAudit({
          tenantId: req.tenant.id,
          branchId,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.created',
          summary: `Created menu item: ${name}`,
          payload: { id, name, category, price, status, code },
          requestId: req.requestId,
        });
      } catch {
        // ignore audit failures
      }

      try {
        publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'menu.product.created', data: { productId: String(id) } });
      } catch {
        // ignore
      }

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/products/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, validateManagerMenuProductUpdate, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const { id } = req.validatedParams || req.params;
      const productId = String(id || '').trim();
      if (!productId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_products')
        .where({ tenant_id: req.tenant.id, id: productId })
        .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      // Allow editing global products + branch products; but enforce that branch managers can't change other branches' branch-specific products.
      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const body = req.validatedBody || req.body;
      const patch = { updated_at: new Date().toISOString() };
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim() || 'Uncategorized';
      if (typeof body?.status === 'string') patch.status = body.status === 'Inactive' ? 'Inactive' : 'Active';
      if (body?.price != null) patch.price = Number(body.price || 0) || 0;

      const prevJson = safeJsonParse(existing.product_json, {});
      const nextJson = { ...prevJson };
      if (typeof body?.code === 'string') nextJson.code = normalizeCode(body.code, String(patch.name || '')) || nextJson.code;
      if (typeof body?.image === 'string') nextJson.image = body.image.trim();
      if (typeof body?.description === 'string') nextJson.description = body.description.trim();
      patch.product_json = JSON.stringify(nextJson);

      await db().from('menu_products').where({ tenant_id: req.tenant.id, id: productId }).update(patch);

      try {
        const prevJson2 = safeJsonParse(existing.product_json, {});
        await logAudit({
          tenantId: req.tenant.id,
          branchId,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.updated',
          summary: `Updated menu item: ${String(patch.name || existing.name || productId)}`,
          payload: {
            id: productId,
            before: {
              name: String(existing.name || ''),
              category: String(existing.category || ''),
              price: Number(existing.price || 0) || 0,
              status: String(existing.status || ''),
              code: String(prevJson2?.code || ''),
            },
            after: {
              name: String(patch.name ?? existing.name ?? ''),
              category: String(patch.category ?? existing.category ?? ''),
              price: patch.price != null ? Number(patch.price || 0) || 0 : Number(existing.price || 0) || 0,
              status: String(patch.status ?? existing.status ?? ''),
              code: String(nextJson?.code || prevJson2?.code || ''),
            },
          },
          requestId: req.requestId,
        });
      } catch {
        // ignore audit failures
      }

      try {
        publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'menu.product.updated', data: { productId: String(productId) } });
      } catch {
        // ignore
      }
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Modifier Groups
  r.get('/manager/menu/modifier-groups', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const rows = await db()
        .from('menu_modifier_groups')
        .where({ tenant_id: req.tenant.id })
        .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
        .select(['id', 'branch_id', 'name', 'min_select', 'max_select', 'sort_order', 'updated_at'])
        .orderBy('sort_order', 'asc')
        .orderBy('updated_at', 'desc')
        .limit(500);

      return res.json({ ok: true, branchId, groups: rows.map(mapModifierGroup) });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/modifier-groups', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      const min = Math.max(0, Number(req.body?.min ?? 0) || 0);
      const max = Math.max(0, Number(req.body?.max ?? 0) || 0);
      const sortOrder = Math.max(0, Number(req.body?.sortOrder ?? 0) || 0);

      const id = uid('mgrp');
      const now = nowIso();
      await db().from('menu_modifier_groups').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        min_select: min,
        max_select: max,
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/modifier-groups/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const { id } = req.validatedParams || req.params;
      const groupId = String(id || '').trim();
      if (!groupId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_modifier_groups')
        .where({ tenant_id: req.tenant.id, id: groupId })
        .select(['id', 'branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const patch = { updated_at: nowIso() };
      if (typeof req.body?.name === 'string') patch.name = String(req.body.name).trim();
      if (req.body?.min != null) patch.min_select = Math.max(0, Number(req.body.min ?? 0) || 0);
      if (req.body?.max != null) patch.max_select = Math.max(0, Number(req.body.max ?? 0) || 0);
      if (req.body?.sortOrder != null) patch.sort_order = Math.max(0, Number(req.body.sortOrder ?? 0) || 0);

      await db().from('menu_modifier_groups').where({ tenant_id: req.tenant.id, id: groupId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Modifier Options
  r.get('/manager/menu/modifier-groups/:id/options', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const { id } = req.validatedParams || req.params;
      const groupId = String(id || '').trim();
      if (!groupId) return res.status(400).json({ error: 'id_required' });

      const rows = await db()
        .from('menu_modifier_options')
        .where({ tenant_id: req.tenant.id, group_id: groupId })
        .select(['id', 'group_id', 'name', 'price_delta', 'sort_order', 'updated_at'])
        .orderBy('sort_order', 'asc')
        .orderBy('updated_at', 'desc')
        .limit(500);

      return res.json({ ok: true, groupId, options: rows.map(mapModifierOption) });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/modifier-groups/:id/options', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const { id } = req.validatedParams || req.params;
      const groupId = String(id || '').trim();
      if (!groupId) return res.status(400).json({ error: 'id_required' });

      const g = await db()
        .from('menu_modifier_groups')
        .where({ tenant_id: req.tenant.id, id: groupId })
        .select(['id', 'branch_id'])
        .first();
      if (!g) return res.status(404).json({ error: 'group_not_found' });

      const existingBranchId = g.branch_id ? String(g.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      const priceDelta = Number(req.body?.priceDelta ?? 0) || 0;
      const sortOrder = Math.max(0, Number(req.body?.sortOrder ?? 0) || 0);

      const id2 = uid('mopt');
      const now = nowIso();
      await db().from('menu_modifier_options').insert({
        id: id2,
        tenant_id: req.tenant.id,
        group_id: groupId,
        name,
        price_delta: priceDelta,
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
      });
      return res.status(201).json({ ok: true, id: id2 });
    } catch (e) {
      return next(e);
    }
  });

  // Product -> Modifier Groups mapping
  r.get('/manager/menu/products/:id/modifier-groups', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const { id } = req.validatedParams || req.params;
      const productId = String(id || '').trim();
      if (!productId) return res.status(400).json({ error: 'id_required' });

      const rows = await db()
        .from('menu_product_modifier_groups')
        .where({ tenant_id: req.tenant.id })
        .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
        .andWhere('product_id', productId)
        .select(['id', 'branch_id', 'product_id', 'group_id', 'sort_order', 'updated_at'])
        .orderBy('sort_order', 'asc')
        .orderBy('updated_at', 'desc')
        .limit(200);

      return res.json({ ok: true, branchId, productId, mappings: rows.map((r0) => ({ id: String(r0.id), groupId: String(r0.group_id), sortOrder: Number(r0.sort_order ?? 0) || 0 })) });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/products/:id/modifier-groups', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const { id } = req.validatedParams || req.params;
      const productId = String(id || '').trim();
      if (!productId) return res.status(400).json({ error: 'id_required' });

      const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
      const groupIds = groups
        .map((g) => (g && typeof g === 'object' ? String(g.groupId || '').trim() : ''))
        .filter(Boolean)
        .slice(0, 50);

      const now = nowIso();
      await db().transaction(async (trx) => {
        await trx('menu_product_modifier_groups')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, product_id: productId })
          .del();

        const rows = groupIds.map((gid, idx) => ({
          id: makeId('mpmg', `${productId}:${gid}:${idx}:${now}`),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          product_id: productId,
          group_id: gid,
          sort_order: idx,
          created_at: now,
          updated_at: now,
        }));
        if (rows.length) await trx('menu_product_modifier_groups').insert(rows);
      });

      return res.json({ ok: true, productId, groupIds });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/products/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const { id } = req.validatedParams || req.params;
      const productId = String(id || '').trim();
      if (!productId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().from('menu_products').where({ tenant_id: req.tenant.id, id: productId }).select(['id', 'branch_id', 'name']).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (!existingBranchId) return res.status(403).json({ error: 'forbidden' });
      if (existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      await db().from('menu_products').where({ tenant_id: req.tenant.id, id: productId }).del();
      await db().from('menu_recipes').where({ tenant_id: req.tenant.id, branch_id: branchId, product_id: productId }).del();

      try {
        await logAudit({
          tenantId: req.tenant.id,
          branchId,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.deleted',
          summary: `Deleted menu item: ${existing?.name ? String(existing.name) : productId}`,
          payload: { id: productId, name: existing?.name ? String(existing.name) : '' },
          requestId: req.requestId,
        });
      } catch {
        // ignore audit failures
      }

      try {
        publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'menu.product.deleted', data: { productId: String(productId) } });
      } catch {
        // ignore
      }
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Recipes
  r.get('/manager/menu/recipes', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateManagerMenuRecipesQuery, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const branchIds = branchIdAlternates(branchId);

      const queryParams = req.validatedQuery || req.query;
      const productId = typeof queryParams?.productId === 'string' ? queryParams.productId.trim() : '';
      const productIdsRaw = typeof queryParams?.productIds === 'string' ? queryParams.productIds.trim() : '';
      const productIds = productIdsRaw
        ? productIdsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      let q = db()
        .from('menu_recipes')
        .where({ tenant_id: req.tenant.id })
        .whereIn('branch_id', branchIds);
      if (productId) q = q.andWhere({ product_id: productId });
      if (productIds.length) q = q.whereIn('product_id', productIds);

      let rows;
      try {
        rows = await q.select(['product_id', 'recipe_json', 'updated_at']).limit(500);
      } catch (e) {
        // If migrations haven't been run yet, treat as empty instead of 500.
        if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146)) {
          return res.json({ ok: true, branchId, recipes: [] });
        }
        throw e;
      }
      const recipes = rows.map((row) => {
        const recipe = normalizeRecipe(safeJsonParse(row.recipe_json, {}));
        return {
          productId: String(row.product_id),
          recipe,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
        };
      });

      return res.json({ ok: true, branchId, recipes });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/recipes/:productId', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateProductIdParam, validateManagerMenuRecipeUpsert, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const branchIds = branchIdAlternates(branchId);

      const { productId: productIdRaw } = req.validatedParams || req.params;
      const productId = String(productIdRaw || '').trim();
      if (!productId) return res.status(400).json({ error: 'product_id_required' });

      // Must exist as a menu product visible to this branch (global or branch item)
      const prod = await db()
        .from('menu_products')
        .where({ tenant_id: req.tenant.id, id: productId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id'])
        .first();
      if (!prod) return res.status(404).json({ error: 'product_not_found' });

      const body = req.validatedBody || req.body;
      const incoming = body?.recipe;
      if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'recipe_required' });

      const normalized = normalizeRecipe(incoming);

      const nowIso = new Date().toISOString();
      const id = makeId('mr');

      await db()
        .from('menu_recipes')
        .insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: branchId,
          product_id: productId,
          recipe_json: JSON.stringify(normalized),
          created_at: nowIso,
          updated_at: nowIso,
        })
        .onConflict(['tenant_id', 'branch_id', 'product_id'])
        .merge({ recipe_json: JSON.stringify(normalized), updated_at: nowIso });

      try {
        await logAudit({
          tenantId: req.tenant.id,
          branchId,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_recipe.upserted',
          summary: `Updated recipe for product: ${productId}`,
          payload: { productId, recipe: normalized },
          requestId: req.requestId,
        });
      } catch {
        // ignore audit failures
      }

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/recipes/:productId', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateProductIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const branchIds = branchIdAlternates(branchId);

      const { productId: productIdRaw } = req.validatedParams || req.params;
      const productId = String(productIdRaw || '').trim();
      if (!productId) return res.status(400).json({ error: 'product_id_required' });

      const deleted = await db()
        .from('menu_recipes')
        .where({ tenant_id: req.tenant.id, product_id: productId })
        .whereIn('branch_id', branchIds)
        .del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      try {
        await logAudit({
          tenantId: req.tenant.id,
          branchId,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_recipe.deleted',
          summary: `Deleted recipe for product: ${productId}`,
          payload: { productId },
          requestId: req.requestId,
        });
      } catch {
        // ignore audit failures
      }

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/manager/menu/rule-sets', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const rows = await db()
        .from('menu_rule_sets')
        .where({ tenant_id: req.tenant.id })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id', 'name', 'status', 'priority', 'starts_at', 'ends_at', 'schedule_json', 'order_types_json', 'updated_at'])
        .orderBy([{ column: 'priority', order: 'desc' }, { column: 'updated_at', order: 'desc' }])
        .limit(500);

      const ruleSets = rows.map((x) => ({
        id: String(x.id),
        branchId: x.branch_id ? String(x.branch_id) : null,
        name: String(x.name || ''),
        status: String(x.status || 'active'),
        priority: Number(x.priority || 0) || 0,
        startsAt: x.starts_at ? new Date(x.starts_at).toISOString() : null,
        endsAt: x.ends_at ? new Date(x.ends_at).toISOString() : null,
        schedule: safeJsonParse(x.schedule_json, null),
        orderTypes: safeJsonParse(x.order_types_json, null),
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, branchId, ruleSets });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/rule-sets', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);
      const body = req.body || {};

      const name = String(body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });

      const status = String(body?.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
      const priority = Number(body?.priority ?? 0) || 0;

      const startsAt = body?.startsAt ? new Date(String(body.startsAt)) : null;
      const endsAt = body?.endsAt ? new Date(String(body.endsAt)) : null;
      const schedule = body?.schedule && typeof body.schedule === 'object' ? body.schedule : null;
      const orderTypes = body?.orderTypes && typeof body.orderTypes === 'object' ? body.orderTypes : null;

      const id = uid('mrs');
      const now = nowIso();
      await db().from('menu_rule_sets').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        status,
        priority,
        starts_at: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : null,
        ends_at: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
        schedule_json: schedule ? JSON.stringify(schedule) : null,
        order_types_json: orderTypes ? JSON.stringify(orderTypes) : null,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/rule-sets/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleSetId = String(id || '').trim();
      if (!ruleSetId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_rule_sets')
        .where({ tenant_id: req.tenant.id, id: ruleSetId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const body = req.body || {};
      const patch = { updated_at: nowIso() };
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.status === 'string') patch.status = body.status.trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
      if (body?.priority != null) patch.priority = Number(body.priority ?? 0) || 0;

      if (body?.startsAt !== undefined) {
        const d = body.startsAt ? new Date(String(body.startsAt)) : null;
        patch.starts_at = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      }
      if (body?.endsAt !== undefined) {
        const d = body.endsAt ? new Date(String(body.endsAt)) : null;
        patch.ends_at = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      }
      if (body?.schedule !== undefined) {
        patch.schedule_json = body.schedule && typeof body.schedule === 'object' ? JSON.stringify(body.schedule) : null;
      }
      if (body?.orderTypes !== undefined) {
        patch.order_types_json = body.orderTypes && typeof body.orderTypes === 'object' ? JSON.stringify(body.orderTypes) : null;
      }

      await db().from('menu_rule_sets').where({ tenant_id: req.tenant.id, id: ruleSetId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/rule-sets/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleSetId = String(id || '').trim();
      if (!ruleSetId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_rule_sets')
        .where({ tenant_id: req.tenant.id, id: ruleSetId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (!existingBranchId) return res.status(403).json({ error: 'forbidden' });
      if (existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      await db().from('menu_rules').where({ tenant_id: req.tenant.id, rule_set_id: ruleSetId }).del();
      await db().from('menu_rule_sets').where({ tenant_id: req.tenant.id, id: ruleSetId }).del();
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/manager/menu/rule-sets/:id/rules', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleSetId = String(id || '').trim();
      if (!ruleSetId) return res.status(400).json({ error: 'id_required' });

      const ruleSet = await db()
        .from('menu_rule_sets')
        .where({ tenant_id: req.tenant.id, id: ruleSetId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!ruleSet) return res.status(404).json({ error: 'rule_set_not_found' });

      const rows = await db()
        .from('menu_rules')
        .where({ tenant_id: req.tenant.id, rule_set_id: ruleSetId })
        .select(['id', 'kind', 'match_json', 'effect_json', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const rules = rows.map((x) => ({
        id: String(x.id),
        kind: String(x.kind || ''),
        match: safeJsonParse(x.match_json, {}),
        effect: safeJsonParse(x.effect_json, {}),
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, branchId, ruleSetId, rules });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/rule-sets/:id/rules', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleSetId = String(id || '').trim();
      if (!ruleSetId) return res.status(400).json({ error: 'id_required' });

      const ruleSet = await db()
        .from('menu_rule_sets')
        .where({ tenant_id: req.tenant.id, id: ruleSetId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!ruleSet) return res.status(404).json({ error: 'rule_set_not_found' });

      const existingBranchId = ruleSet.branch_id ? String(ruleSet.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const body = req.body || {};
      const kind = String(body?.kind || '').trim();
      if (!kind) return res.status(400).json({ error: 'kind_required' });
      const match = body?.match && typeof body.match === 'object' ? body.match : {};
      const effect = body?.effect && typeof body.effect === 'object' ? body.effect : {};

      const id2 = uid('mrl');
      const now = nowIso();
      await db().from('menu_rules').insert({
        id: id2,
        tenant_id: req.tenant.id,
        rule_set_id: ruleSetId,
        kind,
        match_json: JSON.stringify(match),
        effect_json: JSON.stringify(effect),
        created_at: now,
        updated_at: now,
      });
      return res.status(201).json({ ok: true, id: id2 });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/rules/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleId = String(id || '').trim();
      if (!ruleId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_rules as r')
        .join('menu_rule_sets as rs', 'rs.id', 'r.rule_set_id')
        .where('r.tenant_id', req.tenant.id)
        .andWhere('r.id', ruleId)
        .andWhere((b) => b.whereNull('rs.branch_id').orWhereIn('rs.branch_id', branchIds))
        .select(['r.id', 'r.rule_set_id', 'rs.branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const body = req.body || {};
      const patch = { updated_at: nowIso() };
      if (typeof body?.kind === 'string') patch.kind = body.kind.trim();
      if (body?.match !== undefined) patch.match_json = body.match && typeof body.match === 'object' ? JSON.stringify(body.match) : JSON.stringify({});
      if (body?.effect !== undefined) patch.effect_json = body.effect && typeof body.effect === 'object' ? JSON.stringify(body.effect) : JSON.stringify({});

      await db().from('menu_rules').where({ tenant_id: req.tenant.id, id: ruleId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/rules/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const ruleId = String(id || '').trim();
      if (!ruleId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_rules as r')
        .join('menu_rule_sets as rs', 'rs.id', 'r.rule_set_id')
        .where('r.tenant_id', req.tenant.id)
        .andWhere('r.id', ruleId)
        .andWhere((b) => b.whereNull('rs.branch_id').orWhereIn('rs.branch_id', branchIds))
        .select(['r.id', 'rs.branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      await db().from('menu_rules').where({ tenant_id: req.tenant.id, id: ruleId }).del();
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/manager/menu/availability', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const rows = await db()
        .from('menu_availability')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .select(['id', 'target_type', 'target_id', 'state', 'reason', 'expires_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const items = rows.map((x) => ({
        id: String(x.id),
        targetType: String(x.target_type || ''),
        targetId: String(x.target_id || ''),
        state: String(x.state || 'available'),
        reason: x.reason ? String(x.reason) : '',
        expiresAt: x.expires_at ? new Date(x.expires_at).toISOString() : null,
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : '',
      }));
      return res.json({ ok: true, branchId, items });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/availability', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const body = req.body || {};

      const targetType = String(body?.targetType || '').trim();
      const targetId = String(body?.targetId || '').trim();
      if (!targetType) return res.status(400).json({ error: 'target_type_required' });
      if (!targetId) return res.status(400).json({ error: 'target_id_required' });

      const state = String(body?.state || 'unavailable').trim().toLowerCase() === 'available' ? 'available' : 'unavailable';
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 255) : '';
      const expiresAt = body?.expiresAt ? new Date(String(body.expiresAt)) : null;

      const id = uid('mav');
      const now = nowIso();
      await db()
        .from('menu_availability')
        .insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: branchId,
          target_type: targetType,
          target_id: targetId,
          state,
          reason: reason || null,
          expires_at: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
          created_at: now,
          updated_at: now,
        })
        .onConflict(['tenant_id', 'branch_id', 'target_type', 'target_id'])
        .merge({ state, reason: reason || null, expires_at: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null, updated_at: now });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/availability/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const { id } = req.validatedParams || req.params;
      const rowId = String(id || '').trim();
      if (!rowId) return res.status(400).json({ error: 'id_required' });

      const n = await db().from('menu_availability').where({ tenant_id: req.tenant.id, branch_id: branchId, id: rowId }).del();
      if (!n) return res.status(404).json({ error: 'not_found' });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/manager/menu/bundles', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const rows = await db()
        .from('menu_bundles')
        .where({ tenant_id: req.tenant.id })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id', 'name', 'status', 'priority', 'bundle_json', 'updated_at'])
        .orderBy([{ column: 'priority', order: 'desc' }, { column: 'updated_at', order: 'desc' }])
        .limit(500);

      const bundles = rows.map((x) => ({
        id: String(x.id),
        branchId: x.branch_id ? String(x.branch_id) : null,
        name: String(x.name || ''),
        status: String(x.status || 'active'),
        priority: Number(x.priority || 0) || 0,
        bundle: safeJsonParse(x.bundle_json, {}),
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, branchId, bundles });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/menu/bundles', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const body = req.body || {};

      const name = String(body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      const status = String(body?.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
      const priority = Number(body?.priority ?? 0) || 0;
      const bundle = body?.bundle && typeof body.bundle === 'object' ? body.bundle : {};

      const id = uid('mbd');
      const now = nowIso();
      await db().from('menu_bundles').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        status,
        priority,
        bundle_json: JSON.stringify(bundle),
        created_at: now,
        updated_at: now,
      });
      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/menu/bundles/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const bundleId = String(id || '').trim();
      if (!bundleId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_bundles')
        .where({ tenant_id: req.tenant.id, id: bundleId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (existingBranchId && existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      const body = req.body || {};
      const patch = { updated_at: nowIso() };
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.status === 'string') patch.status = body.status.trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
      if (body?.priority != null) patch.priority = Number(body.priority ?? 0) || 0;
      if (body?.bundle !== undefined) patch.bundle_json = body.bundle && typeof body.bundle === 'object' ? JSON.stringify(body.bundle) : JSON.stringify({});

      await db().from('menu_bundles').where({ tenant_id: req.tenant.id, id: bundleId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/menu/bundles/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('menu'), requireBranchId(), validateIdParam, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);
      const branchIds = branchIdAlternates(branchId);

      const { id } = req.validatedParams || req.params;
      const bundleId = String(id || '').trim();
      if (!bundleId) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('menu_bundles')
        .where({ tenant_id: req.tenant.id, id: bundleId })
        .andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds))
        .select(['id', 'branch_id'])
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const existingBranchId = existing.branch_id ? String(existing.branch_id) : '';
      if (!existingBranchId) return res.status(403).json({ error: 'forbidden' });
      if (existingBranchId !== branchId) return res.status(403).json({ error: 'forbidden' });

      await db().from('menu_bundles').where({ tenant_id: req.tenant.id, id: bundleId }).del();
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerMenuRouter };
