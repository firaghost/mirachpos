const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

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

        const categoriesRows = await db()
          .from('menu_products')
          .where({ tenant_id: req.tenant.id })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
          .distinct('category as c');

        const categories = Array.from(new Set(categoriesRows.map((x) => String(x.c || 'Uncategorized'))))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, products, categories });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosMenuRouter };
