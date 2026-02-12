const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { safeJsonParse } = require('../../utils/errors');
const { uid } = require('../../utils/ids');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { logAudit } = require('../../utils/logger');

const slugCode = (name) => {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  return s.slice(0, 8);
};

const ensureUniqueMenuCode = async (tenantId, desired, fallbackName) => {
  const base = slugCode(desired) || slugCode(fallbackName) || 'ITEM';
  const rows = await db().select(['id', 'product_json']).from('menu_products').where({ tenant_id: tenantId });
  const used = new Set();
  for (const r of rows) {
    const pj = safeJsonParse(r.product_json, {});
    const c = String(pj?.code || '').trim().toUpperCase();
    if (c) used.add(c);
  }
  if (!used.has(base)) return base;
  for (let i = 2; i <= 999; i++) {
    const cand = `${base}${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${base}${String(uid('c')).slice(-6).toUpperCase()}`;
};

const makeOwnerMenuRouter = ({ requireOwnerAuth, clampInt, publish }) => {
  const r = express.Router();

  r.get(
    '/owner/menu/products',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });
        const category = sanitizeText(req.query?.category, { maxLen: 60 });
        const status = sanitizeText(req.query?.status, { maxLen: 40 });
        const page = clampInt(req.query?.page, 1, 100000, 1);
        const pageSize = clampInt(req.query?.pageSize, 1, 50, 10);
        const offset = (page - 1) * pageSize;

        let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
        if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
        if (category) base = base.andWhere('category', category);
        if (status && status !== 'All') base = base.andWhere('status', status);

        const totalRow = await base.clone().count({ c: '*' }).first();
        const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

        const rows = await base
          .clone()
          .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at'])
          .orderBy('updated_at', 'desc')
          .limit(pageSize)
          .offset(offset);

        const windowDays = Math.max(1, Math.min(365, Number(req.query?.salesWindowDays || 30) || 30));
        const toSalesIso = new Date().toISOString();
        const fromSalesIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
        const visibleIds = rows.map((r0) => String(r0.id || '')).filter(Boolean);
        const salesByProduct = new Map();

        if (visibleIds.length) {
          const orderRows = await db()
            .select(['payload'])
            .from('orders')
            .where({ tenant_id: req.tenant.id, status: 'Paid' })
            .andWhere('paid_at', '>=', fromSalesIso)
            .andWhere('paid_at', '<=', toSalesIso)
            .orderBy('paid_at', 'desc')
            .limit(1500);

          const allow = new Set(visibleIds);
          for (const or0 of orderRows) {
            const payload = safeJsonParse(or0.payload, {});
            const items = Array.isArray(payload?.items) ? payload.items : [];
            for (const it of items) {
              const pid = String(it?.productId || it?.product_id || '').trim();
              if (!pid || !allow.has(pid)) continue;
              const qty = Number(it?.qty ?? 0) || 0;
              const voided = Number(it?.voidedQty ?? it?.voided_qty ?? 0) || 0;
              const netQty = Math.max(0, qty - voided);
              if (netQty <= 0) continue;
              const unit = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0;
              const prev = salesByProduct.get(pid) || { units: 0, revenue: 0 };
              prev.units += netQty;
              prev.revenue += netQty * unit;
              salesByProduct.set(pid, prev);
            }
          }
        }

        const allCats = await db().from('menu_products').where({ tenant_id: req.tenant.id }).distinct('category as c');
        const categories = Array.from(new Set(allCats.map((x) => String(x.c || 'Uncategorized'))))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const products = rows.map((row) => {
          const pj = safeJsonParse(row.product_json, {});
          const cost = Number(pj?.cost ?? 0) || 0;
          const price = Number(row.price || 0) || 0;
          const marginPct = price > 0 ? Number((((price - cost) / price) * 100).toFixed(1)) : 0;
          const s = salesByProduct.get(String(row.id)) || { units: 0, revenue: 0 };
          return {
            id: String(row.id),
            branchId: row.branch_id ? String(row.branch_id) : null,
            code: String(pj?.code || ''),
            name: String(row.name || ''),
            category: String(row.category || 'Uncategorized'),
            price,
            cost,
            marginPct,
            status: row.status === 'Inactive' ? 'Inactive' : 'Active',
            image: String(pj?.image || ''),
            description: String(pj?.description || ''),
            product_json: pj,
            soldUnits: Number(s.units || 0) || 0,
            soldRevenue: Number(s.revenue || 0) || 0,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
          };
        });

        return res.json({ products, categories, page, pageSize, total });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/owner/menu/kpis',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });
        const category = sanitizeText(req.query?.category, { maxLen: 60 });
        const status = sanitizeText(req.query?.status, { maxLen: 40 });

        let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
        if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
        if (category) base = base.andWhere('category', category);
        if (status && status !== 'All') base = base.andWhere('status', status);

        const rows = await base.select(['id', 'category', 'status', 'price', 'product_json']);
        const categories = Array.from(new Set(rows.map((r0) => String(r0.category || 'Uncategorized'))))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const totalItems = rows.length;
        const activeItems = rows.filter((r0) => String(r0.status || '') === 'Active').length;
        const margins = rows.map((r0) => {
          const pj = safeJsonParse(r0.product_json, {});
          const cost = Number(pj?.cost ?? 0) || 0;
          const price = Number(r0.price || 0) || 0;
          return price > 0 ? ((price - cost) / price) * 100 : 0;
        });
        const avgMarginPct = margins.length ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1)) : 0;

        const windowDays = Math.max(1, Math.min(365, Number(req.query?.salesWindowDays || 30) || 30));
        const toSalesIso = new Date().toISOString();
        const fromSalesIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
        const salesByProduct = new Map();
        const allow = new Set(rows.map((r0) => String(r0.id || '')).filter(Boolean));

        if (allow.size) {
          const orderRows = await db()
            .select(['payload'])
            .from('orders')
            .where({ tenant_id: req.tenant.id, status: 'Paid' })
            .andWhere('paid_at', '>=', fromSalesIso)
            .andWhere('paid_at', '<=', toSalesIso)
            .orderBy('paid_at', 'desc')
            .limit(2000);

          for (const or0 of orderRows) {
            const payload = safeJsonParse(or0.payload, {});
            const items = Array.isArray(payload?.items) ? payload.items : [];
            for (const it of items) {
              const pid = String(it?.productId || it?.product_id || '').trim();
              if (!pid || !allow.has(pid)) continue;
              const qty = Number(it?.qty ?? 0) || 0;
              const voided = Number(it?.voidedQty ?? it?.voided_qty ?? 0) || 0;
              const netQty = Math.max(0, qty - voided);
              if (netQty <= 0) continue;
              const unit = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0;
              const prev = salesByProduct.get(pid) || { units: 0, revenue: 0 };
              prev.units += netQty;
              prev.revenue += netQty * unit;
              salesByProduct.set(pid, prev);
            }
          }
        }

        let topId = '';
        let topRevenue = 0;
        let topUnits = 0;
        for (const [pid, v] of salesByProduct.entries()) {
          const rev = Number(v?.revenue || 0) || 0;
          if (rev > topRevenue) {
            topRevenue = rev;
            topId = String(pid);
            topUnits = Number(v?.units || 0) || 0;
          }
        }
        const topName = topId ? String(rows.find((r0) => String(r0.id || '') === topId)?.name || '') : '';

        return res.json({
          kpis: {
            totalItems,
            activeItems,
            avgMarginPct,
            topSeller: { id: topId || '', name: topName || '—', revenue: topRevenue || 0, units: topUnits || 0 },
          },
          categories,
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/owner/menu/products',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const id = String(req.body?.id || '').trim() || uid('prd');
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name_required' });

        const category = String(req.body?.category || 'Uncategorized').trim() || 'Uncategorized';
        const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
        const price = Number(req.body?.price || 0) || 0;
        const cost = Number(req.body?.cost || 0) || 0;
        const code = await ensureUniqueMenuCode(req.tenant.id, String(req.body?.code || '').trim(), name);
        const image = String(req.body?.image || '').trim();
        const description = String(req.body?.description || '').trim();

        const nowIso = new Date().toISOString();
        await db().from('menu_products').insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: null,
          name,
          category,
          status,
          price,
          product_json: JSON.stringify({ code, cost, image, description }),
          created_at: nowIso,
          updated_at: nowIso,
        });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.menu.product.created',
          summary: `Created menu product ${name}`,
          payload: { productId: id, code },
        });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: '', type: 'menu.product.created', data: { productId: String(id) } });
        } catch {
          // ignore
        }

        return res.status(201).json({ ok: true, product: { id } });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/owner/menu/products/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const existing = await db().select(['id', 'product_json']).from('menu_products').where({ tenant_id: req.tenant.id, id }).first();
        if (!existing) return res.status(404).json({ error: 'not_found' });

        const prevJson = safeJsonParse(existing.product_json, {});
        const patch = {};
        if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
        if (typeof req.body?.category === 'string') patch.category = req.body.category.trim() || 'Uncategorized';
        if (typeof req.body?.status === 'string') patch.status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';
        if (req.body?.price != null) patch.price = Number(req.body.price || 0) || 0;

        const nextJson = { ...prevJson };
        if (typeof req.body?.code === 'string') {
          const desired = req.body.code.trim();
          if (desired) nextJson.code = desired;
          else nextJson.code = await ensureUniqueMenuCode(req.tenant.id, '', String(patch.name || prevJson?.name || ''));
        }
        if (req.body?.cost != null) nextJson.cost = Number(req.body.cost || 0) || 0;
        if (typeof req.body?.image === 'string') nextJson.image = req.body.image.trim();
        if (typeof req.body?.description === 'string') nextJson.description = req.body.description.trim();
        if (req.body?.recipe && typeof req.body.recipe === 'object') nextJson.recipe = req.body.recipe;
        patch.product_json = JSON.stringify(nextJson);
        patch.updated_at = new Date().toISOString();

        await db().from('menu_products').where({ tenant_id: req.tenant.id, id }).update(patch);

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.menu.product.updated',
          summary: 'Updated menu product',
          payload: { productId: id },
        });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: '', type: 'menu.product.updated', data: { productId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.delete(
    '/owner/menu/products/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const deleted = await db().from('menu_products').where({ tenant_id: req.tenant.id, id }).del();
        if (!deleted) return res.status(404).json({ error: 'not_found' });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.menu.product.deleted',
          summary: 'Deleted menu product',
          payload: { productId: id },
        });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: '', type: 'menu.product.deleted', data: { productId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/owner/menu/products/bulk',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        const action = String(req.body?.action || '').trim();
        if (!ids.length) return res.status(400).json({ error: 'ids_required' });
        if (!action) return res.status(400).json({ error: 'action_required' });

        const nowIso = new Date().toISOString();
        let updated = 0;

        if (action === 'set_status') {
          const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
          updated = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).update({ status, updated_at: nowIso });
        } else if (action === 'set_price') {
          const price = Number(req.body?.price);
          if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'invalid_price' });
          updated = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).update({ price, updated_at: nowIso });
        } else if (action === 'set_cost' || action === 'adjust_cost_pct' || action === 'adjust_price_pct') {
          const rows = await db().select(['id', 'price', 'product_json']).from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids);
          const pct = Number(req.body?.pct);
          const cost = Number(req.body?.cost);
          const price = Number(req.body?.price);
          for (const r0 of rows) {
            const pj = safeJsonParse(r0.product_json, {});
            const next = { ...pj };
            const patch = { updated_at: nowIso };
            if (action === 'set_cost') {
              if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'invalid_cost' });
              next.cost = cost;
            }
            if (action === 'adjust_cost_pct') {
              if (!Number.isFinite(pct)) return res.status(400).json({ error: 'invalid_pct' });
              const cur = Number(next.cost || 0) || 0;
              next.cost = Math.max(0, cur + (cur * pct) / 100);
            }
            if (action === 'adjust_price_pct') {
              if (!Number.isFinite(pct)) return res.status(400).json({ error: 'invalid_pct' });
              const cur = Number(r0.price || 0) || 0;
              patch.price = Math.max(0, cur + (cur * pct) / 100);
            }
            patch.product_json = JSON.stringify(next);
            // eslint-disable-next-line no-await-in-loop
            await db().from('menu_products').where({ tenant_id: req.tenant.id, id: String(r0.id) }).update(patch);
            updated += 1;
          }
        } else {
          return res.status(400).json({ error: 'invalid_action' });
        }

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.menu.product.bulk',
          summary: `Bulk menu update: ${action}`,
          payload: { action, ids, updated },
        });

        try {
          publish({
            tenantId: String(req.tenant.id),
            branchId: '',
            type: 'menu.product.bulk',
            data: { action: String(action), ids: ids.map(String), updated: Number(updated || 0) || 0 },
          });
        } catch {
          // ignore
        }

        return res.json({ ok: true, updated });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerMenuRouter };
