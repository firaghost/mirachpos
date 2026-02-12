const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { safeJsonParse } = require('../../utils/errors');
const { sanitizeText, sanitizeLikeInput } = require('../../utils/sanitize');

const makeOwnerInventoryRouter = ({ requireOwnerAuth }) => {
  const r = express.Router();

  r.get(
    '/owner/inventory',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('inventory'),
    requirePermission('inventory.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

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

        const branchId = sanitizeText(req.query?.branchId, { maxLen: 64 }) ? normalizeBranchId(req.query.branchId) : '';
        const category = sanitizeText(req.query?.category, { maxLen: 60 });
        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });

        const branches = await db().select(['id', 'name', 'status']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc');

        let base = db().from('inventory_items').where({ tenant_id: req.tenant.id });
        if (branchId) {
          const branchIds = branchIdAlternates(branchId);
          base = base.andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds));
        }
        if (category) base = base.andWhere('category', category);
        if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));

        const rows = await base.select(['id', 'branch_id', 'name', 'category', 'status', 'on_hand', 'reorder_level', 'unit', 'item_json']).orderBy('name', 'asc');

        const categories = Array.from(new Set(rows.map((r) => String(r.category || 'Uncategorized')))).sort((a, b) => a.localeCompare(b));

        const bySku = new Map();
        for (const r of rows) {
          const sku = String(r.id);
          const itemJson = safeJsonParse(r.item_json, {});
          const cost = Number(itemJson?.cost ?? itemJson?.unitCost ?? 0) || 0;
          const qty = Number(r.on_hand || 0) || 0;
          const minQty = Number(r.reorder_level || 0) || 0;
          const unit = String(r.unit || itemJson?.unit || '') || '';
          const cat = String(r.category || 'Uncategorized');
          const name = String(r.name || '');
          const bId = r.branch_id ? String(r.branch_id) : 'global';

          const prev = bySku.get(sku) || {
            sku,
            name,
            category: cat,
            unit,
            minQty,
            cost,
            globalQty: 0,
            globalValue: 0,
            status: 'In Stock',
            byBranch: {},
          };

          prev.globalQty += qty;
          prev.globalValue += qty * cost;
          prev.byBranch[bId] = (prev.byBranch[bId] ?? 0) + qty;
          prev.cost = cost;
          prev.minQty = minQty;
          prev.unit = unit;
          prev.name = name;
          prev.category = cat;
          bySku.set(sku, prev);
        }

        const items = Array.from(bySku.values()).map((it) => {
          const min = Number(it.minQty || 0) || 0;
          const qty = Number(it.globalQty || 0) || 0;
          const status = qty <= 0 ? 'Critical' : qty < min ? 'Low' : 'In Stock';
          return {
            ...it,
            globalQty: Number(it.globalQty || 0) || 0,
            globalValue: Number(it.globalValue || 0) || 0,
            status,
          };
        });

        const totalValue = items.reduce((acc, it) => acc + (Number(it.globalValue) || 0), 0);
        const lowStockCount = items.filter((it) => it.status === 'Low').length;
        const criticalCount = items.filter((it) => it.status === 'Critical').length;

        return res.json({
          kpis: { totalSkus: items.length, totalValue, lowStockCount, criticalCount },
          categories,
          branches: branches.map((b) => ({ id: String(b.id), name: String(b.name || ''), status: String(b.status || '') })),
          items,
          meta: { generatedAt: new Date().toISOString() },
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerInventoryRouter };
