const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { uid } = require('../../utils/ids');
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

const makePosLoyaltyRouter = ({
  resolveBranchId,
  toIso,
  computeLoyaltyExpiry,
  LOYALTY_CONVERSION,
  computeBalanceFromPoints,
  resolveEffectivePosSettings,
}) => {
  const r = express.Router();

  r.get(
    '/pos/loyalty/customers/:id/points',
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

        const customerId = String(req.params?.id || '').trim();
        if (!customerId) return res.status(400).json({ error: 'customer_required' });

        const row = await db()
          .from('customers')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
          .select(['id', 'loyalty_points', 'loyalty_balance', 'loyalty_points_expires_at'])
          .first();
        if (!row) return res.status(404).json({ error: 'customer_not_found' });

        const expiry = row.loyalty_points_expires_at ? new Date(row.loyalty_points_expires_at).getTime() : 0;
        const expired = expiry && Number.isFinite(expiry) && expiry < Date.now();
        const points = expired ? 0 : Math.max(0, Math.floor(Number(row.loyalty_points ?? 0) || 0));
        const balance = Math.max(0, Number(row.loyalty_balance ?? 0) || 0);

        return res.json({ ok: true, customerId, points, balance, pointsExpiresAt: toIso(row.loyalty_points_expires_at) });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/loyalty/customers/:id/award',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const customerId = String(req.params?.id || '').trim();
        if (!customerId) return res.status(400).json({ error: 'customer_required' });

        const points = Math.max(0, Math.floor(Number(req.body?.points ?? 0) || 0));
        if (!points) return res.status(400).json({ error: 'points_required' });

        const reason = String(req.body?.reason || '').trim();
        if (!reason) return res.status(400).json({ error: 'reason_required' });

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const expiryDays = Number(settings?.loyalty?.expiryDays ?? 0) || 0;
        const nowIso = new Date().toISOString();
        const expiresAt = computeLoyaltyExpiry(nowIso, expiryDays);

        await db().transaction(async (trx) => {
          const row = await trx
            .from('customers')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
            .select(['loyalty_points', 'loyalty_points_expires_at'])
            .first();
          if (!row) {
            const err = new Error('customer_not_found');
            err.code = 'customer_not_found';
            throw err;
          }

          const expiry = row.loyalty_points_expires_at ? new Date(row.loyalty_points_expires_at).getTime() : 0;
          const expired = expiry && Number.isFinite(expiry) && expiry < Date.now();
          const prevPoints = expired ? 0 : Math.max(0, Math.floor(Number(row.loyalty_points ?? 0) || 0));
          const nextPoints = prevPoints + points;

          await trx
            .from('customers')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
            .update({ loyalty_points: nextPoints, loyalty_points_expires_at: expiresAt, loyalty_points_updated_at: nowIso, updated_at: nowIso });

          await trx.from('loyalty_transactions').insert({
            id: uid('lty'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            customer_id: customerId,
            order_id: null,
            type: 'award',
            points_delta: points,
            balance_delta: 0,
            earn_rate: null,
            expiry_days: expiryDays || null,
            expires_at: expiresAt,
            meta_json: JSON.stringify({ reason }),
            created_at: nowIso,
          });
        });

        return res.json({ ok: true });
      } catch (e) {
        if (String(e?.code || '') === 'customer_not_found' || String(e?.message || '') === 'customer_not_found') {
          return res.status(404).json({ error: 'customer_not_found' });
        }
        return next(e);
      }
    },
  );

  r.post(
    '/pos/orders/:id/redeem-loyalty',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'id_required' });

        const customerId = String(req.body?.customerId || '').trim();
        if (!customerId) return res.status(400).json({ error: 'customer_required' });

        const pointsReq = Math.max(0, Math.floor(Number(req.body?.pointsToRedeem ?? 0) || 0));
        if (!pointsReq) return res.status(400).json({ error: 'points_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .select(['id'])
          .first();
        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const nowIso = new Date().toISOString();

        const result = await db().transaction(async (trx) => {
          const customerRow = await trx
            .from('customers')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
            .select(['loyalty_points', 'loyalty_balance', 'loyalty_points_expires_at'])
            .first();
          if (!customerRow) {
            const err = new Error('customer_not_found');
            err.code = 'customer_not_found';
            throw err;
          }

          const expiry = customerRow.loyalty_points_expires_at ? new Date(customerRow.loyalty_points_expires_at).getTime() : 0;
          const expired = expiry && Number.isFinite(expiry) && expiry < Date.now();
          const pointsAvailable = expired ? 0 : Math.max(0, Math.floor(Number(customerRow.loyalty_points ?? 0) || 0));
          const balance = Math.max(0, Number(customerRow.loyalty_balance ?? 0) || 0);

          const maxConvertible = Math.floor(pointsAvailable / LOYALTY_CONVERSION.pointsStep) * LOYALTY_CONVERSION.pointsStep;
          const requestedConvertible = Math.floor(pointsReq / LOYALTY_CONVERSION.pointsStep) * LOYALTY_CONVERSION.pointsStep;
          const pointsToConvert = Math.min(maxConvertible, requestedConvertible);
          if (!pointsToConvert) {
            const err = new Error('insufficient_loyalty_points');
            err.code = 'insufficient_loyalty_points';
            throw err;
          }

          const etbToAdd = computeBalanceFromPoints(pointsToConvert);
          const nextPoints = pointsAvailable - pointsToConvert;
          const nextBalance = Math.round((balance + etbToAdd) * 100) / 100;

          await trx
            .from('customers')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
            .update({ loyalty_points: nextPoints, loyalty_balance: nextBalance, loyalty_points_updated_at: nowIso, updated_at: nowIso });

          await trx.from('loyalty_transactions').insert({
            id: uid('lty'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            customer_id: customerId,
            order_id: orderId,
            type: 'convert',
            points_delta: -Math.abs(pointsToConvert),
            balance_delta: Math.abs(etbToAdd),
            earn_rate: null,
            expiry_days: null,
            expires_at: null,
            meta_json: JSON.stringify({ pointsToConvert, etbToAdd }),
            created_at: nowIso,
          });

          return { pointsToConvert, etbToAdd, nextPoints, nextBalance };
        });

        return res.json({ ok: true, ...result });
      } catch (e) {
        const code = String(e?.code || e?.message || '').trim();
        if (code === 'customer_not_found') return res.status(404).json({ error: 'customer_not_found' });
        if (code === 'insufficient_loyalty_points') return res.status(402).json({ error: 'insufficient_loyalty_points' });
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosLoyaltyRouter };
