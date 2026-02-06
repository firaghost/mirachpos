const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId, uid } = require('../utils/ids');
const { publish } = require('../services/realtimeHub');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
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
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.created',
          summary: `Created menu item: ${name}`,
          payload_json: JSON.stringify({ id, name, category, price, status, code }),
          created_at: nowIso,
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
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.updated',
          summary: `Updated menu item: ${String(patch.name || existing.name || productId)}`,
          payload_json: JSON.stringify({
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
          }),
          created_at: patch.updated_at,
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
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_product.deleted',
          summary: `Deleted menu item: ${existing?.name ? String(existing.name) : productId}`,
          payload_json: JSON.stringify({ id: productId, name: existing?.name ? String(existing.name) : '' }),
          created_at: new Date().toISOString(),
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
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_recipe.upserted',
          summary: `Updated recipe for product: ${productId}`,
          payload_json: JSON.stringify({ productId, recipe: normalized }),
          created_at: nowIso,
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
        await db().from('audit_log').insert({
          id: makeId('aud'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          actor_staff_id: req.auth?.staffId ? String(req.auth.staffId) : null,
          actor_role: req.auth?.role ? String(req.auth.role) : null,
          type: 'menu_recipe.deleted',
          summary: `Deleted recipe for product: ${productId}`,
          payload_json: JSON.stringify({ productId }),
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

module.exports = { makeManagerMenuRouter };
