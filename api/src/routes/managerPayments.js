const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { requirePermission } = require('../middleware/permissions');
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

const normalizeItems = (payload) => {
  const raw = payload && typeof payload === 'object' ? payload.items : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      const productId = typeof it.productId === 'string' ? it.productId : typeof it.product_id === 'string' ? it.product_id : '';
      const name = typeof it.name === 'string' ? it.name : '';
      const qty = Number(it.qty ?? it.quantity ?? 0) || 0;
      const unitPrice = Number(it.unitPrice ?? it.unit_price ?? 0) || 0;
      if (!productId && !name) return null;
      if (!Number.isFinite(qty) || qty <= 0) return null;
      return { productId: String(productId || ''), name: String(name || productId || ''), qty, unitPrice };
    })
    .filter(Boolean);
};

const isoDateTime = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const makeManagerPaymentsRouter = () => {
  const r = express.Router();

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

  r.get(
    '/manager/payments',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('payments.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const from = isoDateTime(req.query?.from);
      const to = isoDateTime(req.query?.to);
      const method = typeof req.query?.method === 'string' ? req.query.method.trim() : '';
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));

      let q = db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' });
      if (from) q = q.andWhere('paid_at', '>=', from);
      if (to) q = q.andWhere('paid_at', '<', to);

      const rows = await q
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'paid_at', 'payload'])
        .orderBy('paid_at', 'desc')
        .limit(limit);

      const payments = rows
        .map((row) => {
          const payload = safeJsonParse(row.payload, {});
          const paymentMethod = typeof payload?.paymentMethod === 'string' ? payload.paymentMethod : '';
          if (method && paymentMethod !== method) return null;

          const paymentReference = typeof payload?.paymentReference === 'string' ? payload.paymentReference : '';
          const tenderedAmount = payload?.tenderedAmount != null ? Number(payload.tenderedAmount || 0) || 0 : null;
          const discountPct = payload?.discountPct != null ? Number(payload.discountPct || 0) || 0 : 0;

          const createdByStaffId = typeof payload?.createdByStaffId === 'string' ? payload.createdByStaffId : '';
          const createdByName = typeof payload?.createdByName === 'string' ? payload.createdByName : '';
          const number = typeof payload?.number === 'string' ? payload.number : '';
          const tableName = typeof payload?.tableName === 'string' ? payload.tableName : '';
          const items = normalizeItems(payload);

          return {
            id: String(row.id),
            number: number || '',
            tableName: tableName || '',
            createdByStaffId: createdByStaffId || '',
            createdByName: createdByName || '',
            items,
            total: Number(row.total || 0) || 0,
            tax: Number(row.tax || 0) || 0,
            tip: Number(row.tip || 0) || 0,
            discount: Number(row.discount || 0) || 0,
            discountPct,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
            paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
            method: paymentMethod || 'Unknown',
            reference: paymentReference || '',
            tenderedAmount,
          };
        })
        .filter(Boolean);

      return res.json({ ok: true, branchId, payments });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerPaymentsRouter };
