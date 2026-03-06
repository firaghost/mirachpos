const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { evaluateMenuCart } = require('../../services/menuEvaluationService');

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

const makePosMenuRouter = ({ resolveBranchId }) => {
  const r = express.Router();

  r.get(
    '/pos/menu/products',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const atRaw = String(req.query?.at || '').trim();
        const at = atRaw ? new Date(atRaw) : new Date();
        if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'invalid_at' });

        const orderType = String(req.query?.orderType || '').trim();

        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });
        const category = sanitizeText(req.query?.category, { maxLen: 60 });
        const status = sanitizeText(req.query?.status, { maxLen: 40 });
        const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 500) || 500));

        let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
        base = base.andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId));
        if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
        if (category) base = base.andWhere('category', category);
        if (status && status !== 'All') base = base.andWhere('status', status);

        const rows = await base
          .clone()
          .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at'])
          .orderBy('updated_at', 'desc')
          .limit(limit);

        const products = rows.map((row) => {
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
        });

        let evaluated = null;
        try {
          const items = products.map((p) => ({ productId: p.id, qty: 1, modifiers: [] }));
          evaluated = await evaluateMenuCart({
            db: db(),
            tenantId: req.tenant.id,
            branchId,
            at,
            orderType,
            items,
          });
        } catch {
          evaluated = null;
        }

        const effectivePriceByProductId = evaluated?.effectivePriceByProductId instanceof Map ? evaluated.effectivePriceByProductId : null;
        const unavailableByProductId = evaluated?.unavailableByProductId instanceof Map ? evaluated.unavailableByProductId : null;

        const decoratedProducts = products.map((p) => {
          const pid = String(p.id);
          const unavailable = unavailableByProductId ? unavailableByProductId.get(pid) : null;
          const effectivePrice = effectivePriceByProductId ? Number(effectivePriceByProductId.get(pid) || 0) || 0 : null;
          return {
            ...p,
            price: effectivePrice != null ? effectivePrice : p.price,
            available: !unavailable,
            unavailableReason: unavailable ? String(unavailable.reason || '') : '',
          };
        });

        const categoriesRows = await db()
          .from('menu_products')
          .where({ tenant_id: req.tenant.id })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
          .distinct('category as c');

        const categories = Array.from(new Set(categoriesRows.map((x) => String(x.c || 'Uncategorized'))))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, at: at.toISOString(), orderType, products: decoratedProducts, categories });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/menu/evaluate',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const atRaw = String(req.body?.at || '').trim();
        const at = atRaw ? new Date(atRaw) : new Date();
        if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'invalid_at' });

        const orderType = String(req.body?.orderType || '').trim();
        const cart = req.body?.cart && typeof req.body.cart === 'object' ? req.body.cart : {};

        const out = await evaluateMenuCart({
          db: db(),
          tenantId: req.tenant.id,
          branchId,
          at,
          orderType,
          items: cart.items,
        });

        if (out.violations.length) {
          const v0 = out.violations[0] || null;
          if (v0?.type === 'product_not_found') return res.status(400).json({ error: 'product_not_found', productIds: v0.productIds || [] });
          return res.status(400).json({ error: 'cart_invalid', violations: out.violations });
        }

        const lines = out.items.map((it) => {
          const unit = Number(out.effectivePriceByProductId.get(it.productId) || 0) || 0;
          const total = unit * it.qty;
          return { productId: it.productId, qty: it.qty, unitPrice: unit, totalPrice: total };
        });
        const rawSubtotal = lines.reduce((sum, x) => sum + (Number(x.totalPrice || 0) || 0), 0);
        const subtotal = out?.bundleSubtotal != null ? Number(out.bundleSubtotal || 0) || 0 : rawSubtotal;
        const total = subtotal;

        return res.json({
          ok: true,
          branchId,
          at: at.toISOString(),
          orderType,
          cart: { items: out.items },
          products: out.products,
          constraints: out.constraintsByProductId,
          availability: Object.fromEntries(Array.from(out.unavailableByProductId.entries()).map(([k, v]) => [k, { available: false, ...v }])),
          pricing: { subtotal, total, currency: 'ETB', lines },
          trace: out.trace,
          bundleApplied: out.bundleApplied || null,
          evaluatedAt: nowIso(),
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/menu/products/:id/modifier-groups',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const productId = String(req.params?.id || '').trim();
        if (!productId) return res.status(400).json({ error: 'id_required' });

        const mappingRows = await db()
          .from('menu_product_modifier_groups')
          .where({ tenant_id: req.tenant.id })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
          .andWhere('product_id', productId)
          .select(['group_id', 'sort_order'])
          .orderBy('sort_order', 'asc')
          .limit(50);

        const groupIds = mappingRows.map((r0) => String(r0.group_id || '').trim()).filter(Boolean);
        if (!groupIds.length) return res.json({ ok: true, productId, groups: [] });

        const groupRows = await db()
          .from('menu_modifier_groups')
          .where({ tenant_id: req.tenant.id })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
          .whereIn('id', groupIds)
          .select(['id', 'name', 'min_select', 'max_select', 'sort_order', 'updated_at'])
          .limit(100);

        const optionRows = await db()
          .from('menu_modifier_options')
          .where({ tenant_id: req.tenant.id })
          .whereIn('group_id', groupIds)
          .select(['id', 'group_id', 'name', 'price_delta', 'sort_order', 'updated_at'])
          .orderBy('sort_order', 'asc')
          .orderBy('updated_at', 'desc')
          .limit(500);

        const optionsByGroupId = new Map();
        for (const o of optionRows) {
          const gid = String(o.group_id || '').trim();
          if (!gid) continue;
          const arr = optionsByGroupId.get(gid) || [];
          arr.push({
            id: String(o.id),
            name: String(o.name || ''),
            priceDelta: Number(o.price_delta ?? 0) || 0,
          });
          optionsByGroupId.set(gid, arr);
        }

        const orderById = new Map(mappingRows.map((m) => [String(m.group_id), Number(m.sort_order ?? 0) || 0]));
        const groups = groupRows
          .map((g) => {
            const gid = String(g.id);
            return {
              id: gid,
              name: String(g.name || ''),
              min: Number(g.min_select ?? 0) || 0,
              max: Number(g.max_select ?? 0) || 0,
              options: optionsByGroupId.get(gid) || [],
              sortOrder: orderById.get(gid) ?? (Number(g.sort_order ?? 0) || 0),
            };
          })
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        return res.json({ ok: true, productId, groups });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosMenuRouter };
