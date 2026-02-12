const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
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

const makePosCustomerDisplayRouter = ({ resolveBranchId }) => {
  const r = express.Router();

  r.get(
    '/pos/customer-display/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const row = await db()
          .select(['settings_json'])
          .from('manager_settings')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .first();

        const settings = safeJsonParse(row?.settings_json, {});
        const modeRaw = String(settings?.customerDisplay?.mode || '').trim().toLowerCase();
        const mode = ['auto', 'menu', 'payment', 'receipt'].includes(modeRaw) ? modeRaw : 'auto';

        return res.json({ ok: true, branchId, mode });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/pos/customer-display/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const modeRaw = String(req.body?.mode || '').trim().toLowerCase();
        if (!['auto', 'menu', 'payment', 'receipt'].includes(modeRaw)) {
          return res.status(400).json({ error: 'invalid_mode' });
        }

        const row = await db()
          .select(['settings_json'])
          .from('manager_settings')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .first();

        const prev = safeJsonParse(row?.settings_json, {});
        const nextSettings = {
          ...(prev && typeof prev === 'object' ? prev : {}),
          customerDisplay: {
            ...(prev?.customerDisplay && typeof prev.customerDisplay === 'object' ? prev.customerDisplay : {}),
            mode: modeRaw,
          },
        };

        const nowIso = new Date().toISOString();
        await db()
          .from('manager_settings')
          .insert({ tenant_id: req.tenant.id, branch_id: branchId, settings_json: JSON.stringify(nextSettings), updated_at: nowIso })
          .onConflict(['tenant_id', 'branch_id'])
          .merge({ settings_json: JSON.stringify(nextSettings), updated_at: nowIso });

        return res.json({ ok: true, branchId, mode: modeRaw });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/orders/:id/display-mode',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const modeRaw = String(req.body?.mode || '').trim().toLowerCase();
        if (!['menu', 'payment', 'receipt'].includes(modeRaw)) return res.status(400).json({ error: 'invalid_mode' });

        const paymentMethodRaw = String(req.body?.paymentMethod || '').trim();
        const paymentUrlRaw = String(req.body?.paymentUrl || '').trim();

        const linkRow = await db()
          .from('pos_public_order_links')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, purpose: 'display' })
          .orderBy('created_at', 'desc')
          .select(['id', 'meta_json'])
          .first();
        if (!linkRow) return res.status(404).json({ error: 'display_link_not_found' });

        const meta = safeJsonParse(linkRow.meta_json, {});
        const nextMeta = {
          ...(meta && typeof meta === 'object' ? meta : {}),
          mode: modeRaw,
          ...(paymentMethodRaw ? { paymentMethod: paymentMethodRaw } : {}),
          ...(paymentUrlRaw ? { paymentUrl: paymentUrlRaw } : {}),
        };
        const nowIso = new Date().toISOString();

        await db().from('pos_public_order_links').where({ id: linkRow.id }).update({
          meta_json: JSON.stringify(nextMeta),
          updated_at: nowIso,
        });

        return res.json({ ok: true, mode: modeRaw });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosCustomerDisplayRouter };
