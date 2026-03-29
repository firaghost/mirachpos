const express = require('express');
const net = require('net');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { safeJsonStringify } = require('../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../utils/sanitize');
const { uid } = require('../utils/ids');
const { makeInitialPosState } = require('./posInitPreset');
const paymentGatewayService = require('../services/paymentGatewayService');
const { config } = require('../config');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { publish } = require('../services/realtimeHub');
const { makePosShiftsRouter } = require('./pos/shifts');
const { makePosCustomerDisplayRouter } = require('./pos/customerDisplay');
const { makePosPrintQueueRouter } = require('./pos/printQueue');
const { makePosMenuRouter } = require('./pos/menu');
const { makePosLoyaltyRouter } = require('./pos/loyalty');
const { makePosTablesRouter } = require('./pos/tables');
const { makePosNotificationsRouter } = require('./pos/notifications');
const { makePosOrdersRouter } = require('./pos/orders');
const { makePosKdsRouter } = require('./pos/kds');
const { makePosHardwareRouter } = require('./pos/hardware');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const validateCreateOrderBody = (req, res, next) => {
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  const rawPayload = body?.payload && typeof body.payload === 'object' ? body.payload : null;
  const legacyPayload = !rawPayload && body && typeof body === 'object' ? body : null;
  const payload = rawPayload || legacyPayload || {};

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return res.status(400).json({ error: 'items_required' });

  for (const it of items) {
    if (!it || typeof it !== 'object') return res.status(400).json({ error: 'invalid_items' });
    const productId = typeof it.productId === 'string' ? it.productId.trim() : '';
    const qty = Number(it.qty);
    if (!productId) return res.status(400).json({ error: 'invalid_items' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'invalid_items' });
  }

  req.posOrderPayload = payload;
  req.posOrderBody = body;
  return next();
};

const normalizeLoyaltySettings = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const loyalty = src?.loyalty && typeof src.loyalty === 'object' ? src.loyalty : {};
  const earnRate = Number(loyalty?.earnRate ?? 0) || 0;
  const expiryDaysRaw = Number(loyalty?.expiryDays);
  const expiryDays = Number.isFinite(expiryDaysRaw) && expiryDaysRaw > 0 ? Math.trunc(expiryDaysRaw) : null;
  return { earnRate, expiryDays };
};

const computeLoyaltyExpiry = (nowIso, expiryDays) => {
  if (!expiryDays || expiryDays <= 0) return null;
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;
  const next = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  return next.toISOString();
};

const computeLoyaltyRedeemBase = (computed) => {
  const subtotal = Number(computed?.subtotal ?? 0) || 0;
  const discount = Number(computed?.discount ?? 0) || 0;
  return Math.max(0, subtotal - discount);
};

const computeLoyaltyRedeemAmount = ({ payload, paymentMethod, computed }) => {
  const base = computeLoyaltyRedeemBase(computed);
  if (base <= 0) return 0;

  const p = payload && typeof payload === 'object' ? payload : {};
  const splits = Array.isArray(p?.splits) ? p.splits : [];
  let sum = 0;

  for (const s of splits) {
    const method = String(s?.paymentMethod || '').trim().toLowerCase();
    if (method !== 'loyalty') continue;

    const status = String(s?.status || '').trim().toLowerCase();
    if (status && status !== 'paid') continue;

    const amt = s?.paidAmount != null ? num(s.paidAmount, 0) : s?.amount != null ? num(s.amount, 0) : num(s?.total, 0);
    if (amt > 0) sum += amt;
  }

  if (sum > 0) return Math.min(base, sum);

  const method = String(paymentMethod || '').trim().toLowerCase();
  if (method === 'loyalty') return base;

  return 0;
};

const LOYALTY_CONVERSION = {
  pointsStep: 100,
  etbPerStep: 10,
};

const computeBalanceFromPoints = (points) => {
  const p = Math.max(0, Math.floor(Number(points || 0) || 0));
  if (p <= 0) return 0;
  const steps = Math.floor(p / LOYALTY_CONVERSION.pointsStep);
  return steps * LOYALTY_CONVERSION.etbPerStep;
};

const applyLoyaltyForPaidOrder = async ({ trx, tenantId, branchId, orderId, total, paymentMethod, customer, loyaltySettings, nowIso, redeemAmount }) => {
  const customerId = String(customer?.id || '').trim();
  if (!customerId) return { ok: false, skipped: 'no_customer' };

  const totalAmt = Number(total || 0) || 0;
  const redeemAmt = Math.max(0, Number(redeemAmount || 0) || 0);
  const isLoyaltyPayment = redeemAmt > 0;

  const earnRate = Number(loyaltySettings?.earnRate ?? 0) || 0;
  const expiryDays = Number(loyaltySettings?.expiryDays ?? 0) || 0;

  if (!isLoyaltyPayment && earnRate <= 0) return { ok: false, skipped: 'disabled' };

  if (isLoyaltyPayment && redeemAmt <= 0) return { ok: false, skipped: 'no_redeem' };
  if (!isLoyaltyPayment && totalAmt <= 0) return { ok: false, skipped: 'no_total' };

  const txType = isLoyaltyPayment ? 'redeem' : 'earn';
  const existing = await trx
    .from('loyalty_transactions')
    .where({ tenant_id: tenantId, branch_id: branchId, order_id: orderId, customer_id: customerId, type: txType })
    .first();
  if (existing) return { ok: true, skipped: 'already_applied' };

  const customerRow = await trx
    .from('customers')
    .where({ tenant_id: tenantId, branch_id: branchId, id: customerId })
    .select(['id', 'loyalty_points', 'loyalty_balance', 'loyalty_points_expires_at'])
    .first();
  if (!customerRow) return { ok: false, skipped: 'customer_missing' };

  const now = nowIso || new Date().toISOString();
  const pointsExpiry = customerRow.loyalty_points_expires_at ? new Date(customerRow.loyalty_points_expires_at).getTime() : 0;
  const expired = pointsExpiry && Number.isFinite(pointsExpiry) && pointsExpiry < Date.now();

  let points = Number(customerRow.loyalty_points ?? 0) || 0;
  let balance = Number(customerRow.loyalty_balance ?? 0) || 0;

  if (expired) {
    points = 0;
  }

  if (isLoyaltyPayment) {
    if (balance + 1e-9 < redeemAmt) {
      const err = new Error('insufficient_loyalty_balance');
      err.code = 'insufficient_loyalty_balance';
      throw err;
    }
    const nextBalance = Math.max(0, balance - redeemAmt);
    await trx
      .from('customers')
      .where({ tenant_id: tenantId, branch_id: branchId, id: customerId })
      .update({ loyalty_balance: nextBalance, updated_at: now, loyalty_points_updated_at: now });

    await trx.from('loyalty_transactions').insert({
      id: uid('lty'),
      tenant_id: tenantId,
      branch_id: branchId,
      customer_id: customerId,
      order_id: orderId,
      type: 'redeem',
      points_delta: 0,
      balance_delta: -Math.abs(redeemAmt),
      earn_rate: earnRate || null,
      expiry_days: expiryDays || null,
      expires_at: null,
      meta_json: JSON.stringify({ paymentMethod: String(paymentMethod || '').trim(), redeemedAmount: redeemAmt, redeemBase: redeemAmt }),
      created_at: now,
    });

    return { ok: true };
  }

  const pointsEarned = Math.max(0, Math.floor(totalAmt * Math.max(0, earnRate)));
  if (pointsEarned <= 0) return { ok: true, skipped: 'no_points' };

  const nextPoints = points + pointsEarned;
  const expiresAt = computeLoyaltyExpiry(now, expiryDays);

  await trx
    .from('customers')
    .where({ tenant_id: tenantId, branch_id: branchId, id: customerId })
    .update({
      loyalty_points: nextPoints,
      loyalty_points_expires_at: expiresAt,
      loyalty_points_updated_at: now,
      updated_at: now,
    });

  await trx.from('loyalty_transactions').insert({
    id: uid('lty'),
    tenant_id: tenantId,
    branch_id: branchId,
    customer_id: customerId,
    order_id: orderId,
    type: 'earn',
    points_delta: pointsEarned,
    balance_delta: 0,
    earn_rate: earnRate,
    expiry_days: expiryDays || null,
    expires_at: expiresAt,
    meta_json: JSON.stringify({ paymentMethod: String(paymentMethod || '').trim() }),
    created_at: now,
  });

  return { ok: true };
};

const normalizePublicBaseUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/\/+$/, '');
};

const publicBaseUrlFromReq = (req) => {
  const configured = normalizePublicBaseUrl(config?.app?.publicLinksUrl);
  if (configured) return configured;
  const xfProto = String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const proto = xfProto || req.protocol;
  return proto + '://' + req.get('host');
};

const shortToken = () => {
  // Opaque short token (no descriptive prefix). Stored in DB as unique.
  // 12 hex chars (~48 bits) is compact while keeping collision probability negligible.
  try {
    return crypto.randomBytes(6).toString('hex');
  } catch {
    return Math.random().toString(16).slice(2, 14);
  }
};

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const toIso = (v, fallback = null) => {
  if (!v) return fallback;
  try {
    const d = new Date(v);
    const t = d.getTime();
    if (!Number.isFinite(t)) return fallback;
    return d.toISOString();
  } catch {
    return fallback;
  }
};

const normalizeOrderColsFromPayload = ({ payload, status, nowIso }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  return {
    display_number: typeof p?.number === 'string' && p.number.trim() ? String(p.number).trim() : null,
    table_id: typeof p?.tableId === 'string' && p.tableId.trim() ? String(p.tableId).trim() : null,
    table_name: typeof p?.tableName === 'string' && p.tableName.trim() ? String(p.tableName).trim() : null,
    created_by_staff_id: typeof p?.createdByStaffId === 'string' && p.createdByStaffId.trim() ? String(p.createdByStaffId).trim() : null,
    created_by_name: typeof p?.createdByName === 'string' && p.createdByName.trim() ? String(p.createdByName).trim() : null,
    paid_by_staff_id: typeof p?.paidByStaffId === 'string' && p.paidByStaffId.trim() ? String(p.paidByStaffId).trim() : null,
    paid_by_name: typeof p?.paidByName === 'string' && p.paidByName.trim() ? String(p.paidByName).trim() : null,
    payment_method: typeof p?.paymentMethod === 'string' && p.paymentMethod.trim() ? String(p.paymentMethod).trim() : null,
    payment_reference: typeof p?.paymentReference === 'string' && p.paymentReference.trim() ? String(p.paymentReference).trim() : null,
    tendered_amount: p?.tenderedAmount != null ? num(p.tenderedAmount, null) : null,
    notes: typeof p?.notes === 'string' && p.notes.trim() ? String(p.notes).trim() : null,
    updated_at: nowIso,
    paid_at: status === 'Paid' ? nowIso : null,
  };
};

const normalizeItemsFromPayload = ({ tenantId, branchId, orderId, payload, nowIso }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const items = Array.isArray(p?.items) ? p.items : [];
  return items
    .map((it) => {
      const qty = num(it?.qty, 0);
      const unitPrice = num(it?.unitPrice ?? it?.price, 0);
      const name = String(it?.name || '').trim();
      if (!name || qty <= 0) return null;
      return {
        id: uid('oit'),
        tenant_id: tenantId,
        branch_id: branchId,
        order_id: orderId,
        product_id: it?.productId ? String(it.productId) : null,
        product_code: it?.code ? String(it.code) : null,
        name,
        unit_price: unitPrice,
        qty,
        tax_amount: num(it?.taxAmount, 0),
        discount_amount: num(it?.discountAmount, 0),
        note: typeof it?.note === 'string' && it.note.trim() ? String(it.note).trim() : null,
        voided_qty: num(it?.voidedQty, 0),
        void_reason: typeof it?.voidReason === 'string' && it.voidReason.trim() ? String(it.voidReason).trim() : null,
        created_at: nowIso,
        updated_at: nowIso,
      };
    })
    .filter(Boolean);
};

const normalizeSplitsFromPayload = ({ tenantId, branchId, orderId, payload, nowIso }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const splits = Array.isArray(p?.splits) ? p.splits : [];

  const out = [];
  for (const s of splits) {
    const splitId = s?.id ? String(s.id).trim() : uid('spl');
    const hasItemAlloc = Array.isArray(s?.items) && s.items.length > 0;
    const hasAmount = s?.amount != null && Number.isFinite(Number(s.amount));
    const mode = hasItemAlloc && hasAmount ? 'mixed' : hasItemAlloc ? 'items' : 'amount';

    out.push({
      id: splitId,
      tenant_id: tenantId,
      branch_id: branchId,
      order_id: orderId,
      mode,
      target_amount: hasAmount ? num(s.amount, 0) : null,
      label: typeof s?.label === 'string' && s.label.trim() ? String(s.label).trim() : null,
      status: typeof s?.status === 'string' && s.status.trim() ? String(s.status).trim() : 'open',
      subtotal: num(s?.subtotal, 0),
      tax: num(s?.tax, 0),
      tip: num(s?.tip, 0),
      discount: num(s?.discount, 0),
      total: num(s?.total, 0),
      created_at: nowIso,
      updated_at: nowIso,
    });
  }
  return out;
};

const hydratePayloadFromNormalized = ({ orderRow, payloadFallback, itemRows, splitRows, splitItemRows, paymentRows }) => {
  const p = payloadFallback && typeof payloadFallback === 'object' ? { ...payloadFallback } : {};

  const number = orderRow?.display_number ? String(orderRow.display_number) : '';
  if (number) p.number = number;
  const tableId = orderRow?.table_id ? String(orderRow.table_id) : '';
  if (tableId) p.tableId = tableId;
  const tableName = orderRow?.table_name ? String(orderRow.table_name) : '';
  if (tableName) p.tableName = tableName;

  const createdByStaffId = orderRow?.created_by_staff_id ? String(orderRow.created_by_staff_id) : '';
  const createdByName = orderRow?.created_by_name ? String(orderRow.created_by_name) : '';
  if (createdByStaffId) p.createdByStaffId = createdByStaffId;
  if (createdByName) p.createdByName = createdByName;

  const paidByStaffId = orderRow?.paid_by_staff_id ? String(orderRow.paid_by_staff_id) : '';
  const paidByName = orderRow?.paid_by_name ? String(orderRow.paid_by_name) : '';
  if (paidByStaffId) p.paidByStaffId = paidByStaffId;
  if (paidByName) p.paidByName = paidByName;

  const pm = orderRow?.payment_method ? String(orderRow.payment_method) : '';
  const pref = orderRow?.payment_reference ? String(orderRow.payment_reference) : '';
  if (pm) p.paymentMethod = pm;
  if (pref) p.paymentReference = pref;
  if (orderRow?.tendered_amount != null) p.tenderedAmount = Number(orderRow.tendered_amount);

  const notes = orderRow?.notes ? String(orderRow.notes) : '';
  if (notes) p.notes = notes;

  if (Array.isArray(itemRows) && itemRows.length > 0) {
    p.items = itemRows.map((r) => ({
      productId: r.product_id ? String(r.product_id) : null,
      code: r.product_code ? String(r.product_code) : null,
      name: String(r.name || ''),
      unitPrice: Number(r.unit_price || 0) || 0,
      qty: Number(r.qty || 0) || 0,
      taxAmount: Number(r.tax_amount || 0) || 0,
      discountAmount: Number(r.discount_amount || 0) || 0,
      note: r.note ? String(r.note) : '',
      voidedQty: Number(r.voided_qty || 0) || 0,
      voidReason: r.void_reason ? String(r.void_reason) : null,
    }));
  }

  if (Array.isArray(splitRows) && splitRows.length > 0) {
    const itemsBySplit = new Map();
    if (Array.isArray(splitItemRows) && splitItemRows.length > 0) {
      for (const si of splitItemRows) {
        const sid = String(si.split_id || '').trim();
        if (!sid) continue;
        const list = itemsBySplit.get(sid) || [];
        list.push(si);
        itemsBySplit.set(sid, list);
      }
    }

    p.splits = splitRows.map((s) => {
      const sid = String(s.id || '').trim();
      const list = itemsBySplit.get(sid) || [];
      return {
        id: sid,
        label: s.label ? String(s.label) : null,
        status: String(s.status || 'open'),
        mode: String(s.mode || 'amount'),
        amount: s.target_amount != null ? Number(s.target_amount) : null,
        subtotal: Number(s.subtotal || 0) || 0,
        tax: Number(s.tax || 0) || 0,
        tip: Number(s.tip || 0) || 0,
        discount: Number(s.discount || 0) || 0,
        total: Number(s.total || 0) || 0,
        items: list.map((x) => ({ orderItemId: String(x.order_item_id || ''), qty: Number(x.qty || 0) || 0 })),
      };
    });
  }

  if (Array.isArray(paymentRows) && paymentRows.length > 0) {
    // Best-effort: set top-level payment method/reference from the most recent payment.
    const last = paymentRows
      .slice()
      .sort((a, b) => String(b.paid_at || b.created_at || '').localeCompare(String(a.paid_at || a.created_at || '')))[0];
    if (last) {
      if (last.method) p.paymentMethod = String(last.method);
      if (last.reference) p.paymentReference = String(last.reference);
    }
  }

  return p;
};

const normalizeSplitItemsFromPayload = ({ tenantId, branchId, orderId, splitRows, orderItemRows, payload, nowIso }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const splits = Array.isArray(p?.splits) ? p.splits : [];

  const bySplitId = new Map();
  for (const r of splitRows) bySplitId.set(String(r.id), r);

  const out = [];
  for (const s of splits) {
    const splitId = s?.id ? String(s.id).trim() : '';
    if (!splitId) continue;
    if (!bySplitId.has(splitId)) continue;

    const items = Array.isArray(s?.items) ? s.items : [];
    for (const it of items) {
      const qty = num(it?.qty, 0);
      if (qty <= 0) continue;
      const productId = it?.productId ? String(it.productId) : '';
      const name = String(it?.name || '').trim();
      const match = orderItemRows.find((r) => {
        const pid = r.product_id ? String(r.product_id) : '';
        if (productId && pid && productId === pid) return true;
        if (name && r.name && name === r.name) return true;
        return false;
      });
      if (!match) continue;

      out.push({
        id: uid('spi'),
        tenant_id: tenantId,
        branch_id: branchId,
        order_id: orderId,
        split_id: splitId,
        order_item_id: match.id,
        qty,
        created_at: nowIso,
      });
    }
  }
  return out;
};

const normalizePaymentsFromPayload = ({ tenantId, branchId, orderId, status, payload, nowIso }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];

  if (status === 'Paid') {
    const splits = Array.isArray(p?.splits) ? p.splits : [];
    const hasSplits = splits.length > 0;

    if (hasSplits) {
      for (const s of splits) {
        const st = String(s?.status || '').trim();
        if (st && st !== 'Paid' && st !== 'paid') continue;

        const splitId = s?.id ? String(s.id).trim() : null;
        const method = typeof s?.paymentMethod === 'string' && s.paymentMethod.trim() ? String(s.paymentMethod).trim() : typeof p?.paymentMethod === 'string' ? String(p.paymentMethod).trim() : '';
        if (!method) continue;

        const amt = s?.paidAmount != null ? num(s.paidAmount, 0) : s?.amount != null ? num(s.amount, 0) : num(s?.total, 0);
        if (!(amt > 0)) continue;

        out.push({
          id: uid('pay'),
          tenant_id: tenantId,
          branch_id: branchId,
          order_id: orderId,
          split_id: splitId,
          method,
          amount: amt,
          currency: 'ETB',
          reference: typeof s?.paymentReference === 'string' && s.paymentReference.trim() ? String(s.paymentReference).trim() : typeof p?.paymentReference === 'string' && p.paymentReference.trim() ? String(p.paymentReference).trim() : null,
          status: 'confirmed',
          paid_at: toIso(s?.paidAt, nowIso) || nowIso,
          paid_by_staff_id: typeof p?.paidByStaffId === 'string' && p.paidByStaffId.trim() ? String(p.paidByStaffId).trim() : null,
          paid_by_name: typeof p?.paidByName === 'string' && p.paidByName.trim() ? String(p.paidByName).trim() : null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    } else {
      const method = typeof p?.paymentMethod === 'string' && p.paymentMethod.trim() ? String(p.paymentMethod).trim() : '';
      if (method) {
        const amt = num(p?.total, 0);
        if (amt > 0) {
          out.push({
            id: uid('pay'),
            tenant_id: tenantId,
            branch_id: branchId,
            order_id: orderId,
            split_id: null,
            method,
            amount: amt,
            currency: 'ETB',
            reference: typeof p?.paymentReference === 'string' && p.paymentReference.trim() ? String(p.paymentReference).trim() : null,
            status: 'confirmed',
            paid_at: nowIso,
            paid_by_staff_id: typeof p?.paidByStaffId === 'string' && p.paidByStaffId.trim() ? String(p.paidByStaffId).trim() : null,
            paid_by_name: typeof p?.paidByName === 'string' && p.paidByName.trim() ? String(p.paidByName).trim() : null,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      }
    }
  }

  return out;
};

const stripTablesFromPosState = (state) => {
  if (!state || typeof state !== 'object') return null;
  // eslint-disable-next-line no-unused-vars
  const { tables, ...rest } = state;
  return rest;
};

const backfillRestaurantTablesFromLegacyState = async ({ tenantId, branchId }) => {
  try {
    const existing = await db()
      .from('restaurant_tables')
      .where({ tenant_id: tenantId, branch_id: branchId })
      .select(['id'])
      .limit(1);
    if (existing && existing.length > 0) return;

    // Legacy backfill from pos_state has been removed.
    // restaurant_tables are now the authoritative source of tables.
    // If restaurant_tables are missing for a branch, call /api/pos/initialize to seed them.
  } catch {
    // ignore
  }
};

const loadRestaurantTable = async ({ tenantId, branchId, tableId }) => {
  try {
    const row = await db()
      .from('restaurant_tables')
      .where({ tenant_id: tenantId, branch_id: branchId, id: String(tableId || '').trim() })
      .select(['id', 'name', 'area', 'status', 'seats', 'open_order_id', 'last_order_id', 'assigned_staff_id', 'assigned_staff_name', 'updated_at'])
      .first();
    return row || null;
  } catch {
    return null;
  }
};

const mapRestaurantTableRow = (row) => {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    area: row.area == null ? null : String(row.area || ''),
    status: String(row.status || ''),
    seats: Number(row.seats || 0) || 0,
    openOrderId: row.open_order_id ? String(row.open_order_id) : null,
    lastOrderId: row.last_order_id ? String(row.last_order_id) : null,
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
    assignedStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
    updatedAt: row.updated_at || null,
  };
};

const mapTableStatusFromOrderStatus = (orderStatus) => {
  const st = String(orderStatus || '').trim();
  if (!st) return 'Occupied';
  if (st === 'Paid' || st === 'Voided' || st === 'Refunded') return 'Free';
  if (st === 'Served') return 'Payment';
  if (st === 'Ready') return 'Ready';
  if (st === 'Cooking') return 'Cooking';
  if (st === 'Pending') return 'Pending';
  return 'Occupied';
};

const ensureRestaurantTableRow = async ({ trx, tenantId, branchId, tableId, name, nowIso }) => {
  try {
    const tid = String(tenantId || '').trim();
    const bid = String(branchId || '').trim();
    const tbl = String(tableId || '').trim();
    if (!tid || !bid || !tbl) return;

    const nm = String(name || '').trim() || tbl;
    const at = String(nowIso || '').trim() || new Date().toISOString();
    const q = trx || db();

    await q('restaurant_tables')
      .insert({
        tenant_id: tid,
        branch_id: bid,
        id: tbl,
        name: nm,
        area: null,
        status: 'Free',
        seats: 4,
        open_order_id: null,
        last_order_id: null,
        assigned_staff_id: null,
        assigned_staff_name: null,
        updated_at: at,
      })
      .onConflict(['tenant_id', 'branch_id', 'id'])
      .merge({ updated_at: at });
  } catch {
    // ignore
  }
};

const syncRestaurantTableForOrder = async ({ tenantId, branchId, tableId, orderId, nextStatus, nowIso }) => {
  try {
    const tid = String(tenantId || '').trim();
    const bid = String(branchId || '').trim();
    const tbl = String(tableId || '').trim();
    const oid = String(orderId || '').trim();
    const st = String(nextStatus || '').trim();
    if (!tid || !bid || !tbl || !oid) return;

    await ensureRestaurantTableRow({ tenantId: tid, branchId: bid, tableId: tbl, name: tbl, nowIso });

    const terminal = st === 'Paid' || st === 'Voided' || st === 'Refunded';

    if (!terminal) {
      await db().transaction(async (trx) => {
        const trow = await trx('restaurant_tables')
          .where({ tenant_id: tid, branch_id: bid, id: tbl })
          .select(['open_order_id'])
          .first();
        const curOpen = trow?.open_order_id ? String(trow.open_order_id) : '';

        if (curOpen && curOpen !== oid) {
          const curOrder = await trx('orders')
            .where({ tenant_id: tid, branch_id: bid, id: curOpen })
            .select(['created_at'])
            .first();
          const nextOrder = await trx('orders')
            .where({ tenant_id: tid, branch_id: bid, id: oid })
            .select(['created_at'])
            .first();
          const curAt = curOrder?.created_at ? String(curOrder.created_at) : '';
          const nextAt = nextOrder?.created_at ? String(nextOrder.created_at) : '';
          if (curAt && nextAt && nextAt < curAt) return;
        }

        await trx('restaurant_tables')
          .where({ tenant_id: tid, branch_id: bid, id: tbl })
          .update({ status: mapTableStatusFromOrderStatus(st), open_order_id: oid, last_order_id: oid, updated_at: nowIso });
      });
      return;
    }

    // When finalizing an order, only clear open_order_id if it still points at this order.
    // This avoids clobbering a newer open order if staff created another order quickly.
    await db().transaction(async (trx) => {
      const row = await trx('restaurant_tables')
        .where({ tenant_id: tid, branch_id: bid, id: tbl })
        .select(['open_order_id'])
        .first();
      const curOpen = row?.open_order_id ? String(row.open_order_id) : '';

      const patch = {
        status: curOpen && curOpen !== oid ? undefined : 'Free',
        open_order_id: curOpen && curOpen !== oid ? undefined : null,
        last_order_id: oid,
        updated_at: nowIso,
      };

      const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      await trx('restaurant_tables')
        .where({ tenant_id: tid, branch_id: bid, id: tbl })
        .update(filtered);
    });
  } catch {
    // ignore
  }
};

const verifyStaffPin = async ({ tenantId, branchId, staffId, pin }) => {
  const p = String(pin || '').trim();
  if (!p) return false;
  if (!staffId) return false;
  const row = await db()
    .from('staff')
    .where({ tenant_id: tenantId, id: staffId, branch_id: branchId })
    .select(['pin_hash'])
    .first();
  const hash = row?.pin_hash ? String(row.pin_hash) : '';
  if (!hash) return false;
  try {
    return await bcrypt.compare(p, hash);
  } catch {
    return false;
  }
};

const verifyManagerOrOwnerPin = async ({ tenantId, branchId, pin }) => {
  const p = String(pin || '').trim();
  if (!p) return false;

  const rows = await db()
    .from('staff')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .whereIn('role_name', ['Branch Manager', 'Cafe Owner'])
    .select(['pin_hash'])
    .limit(25);

  for (const r of rows) {
    const hash = r?.pin_hash ? String(r.pin_hash) : '';
    if (!hash) continue;
    try {
      // Accept the first match.
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(p, hash)) return true;
    } catch {
      // ignore
    }
  }
  return false;
};

const mapAuditToNotification = (row) => {
  const type = String(row?.type || '').trim();
  const summary = String(row?.summary || '').trim();
  const payload = safeJsonParse(row?.payload_json, null) || {};
  const action = String(payload?.action || type || '').trim();

  const orderId = payload?.entity_type === 'order' ? String(payload?.entity_id || '') : String(payload?.meta?.orderId || payload?.meta?.order_id || '');
  const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};

  // Professional feed: only show actionable items to waiter/branch users.
  // (We intentionally drop internal spam like printing triggers, draft imports, etc.)
  const allowed = new Set([
    'order.placed',
    'order.status_changed',
    'order.voided',
    'order.item_voided',
    'payment.recorded',
  ]);
  if (!allowed.has(action)) return null;

  let notifType = 'System';
  let title = 'System Alert';
  let message = summary || action || 'Update';

  if (action === 'payment.recorded') {
    notifType = 'Payments';
    title = 'Payment Confirmed';
    const pm = String(meta?.paymentMethod || '').trim();
    message = pm ? `Payment recorded via ${pm}` : 'Payment recorded';
  } else if (action === 'order.status_changed') {
    notifType = 'Kitchen';
    title = 'Order Status Updated';
    const st = String(meta?.status || '').trim();
    message = st ? `Order status changed to ${st}` : message;
  } else if (action === 'order.placed') {
    notifType = 'Kitchen';
    title = 'New Order';
    message = summary || 'New order placed';
  } else if (action === 'order.voided') {
    notifType = 'System';
    title = 'Order Voided';
    const reason = String(meta?.reason || '').trim();
    message = reason ? `Order voided: ${reason}` : summary || 'Order voided';
  } else if (action === 'order.item_voided') {
    notifType = 'System';
    title = 'Item Voided';
    const reason = String(meta?.reason || '').trim();
    message = reason ? `Item voided: ${reason}` : summary || 'Item voided';
  }

  return {
    id: String(row?.id || ''),
    type: notifType,
    title,
    message,
    orderId: orderId || undefined,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : '',
    meta: meta || null,
    action,
  };
};

const applyInventoryDeductionForOrder = async ({ tenantId, branchId, payload }) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.inventoryDeductedAt) return { ok: true, alreadyDeducted: true };

  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { ok: true, empty: true };

  const productIds = Array.from(
    new Set(
      items
        .map((it) => String(it?.productId || it?.product_id || '').trim())
        .filter(Boolean),
    ),
  );
  if (productIds.length === 0) return { ok: true, empty: true };

  // Load recipes for products in this order.
  const recipeRows = await db()
    .from('menu_recipes')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .whereIn('product_id', productIds)
    .select(['product_id', 'recipe_json']);

  const recipeByProduct = new Map();
  for (const r of recipeRows) {
    recipeByProduct.set(String(r.product_id || ''), safeJsonParse(r.recipe_json, null));
  }

  // Aggregate ingredient usage: ingredientId -> qtyUsed
  const usage = new Map();
  for (const it of items) {
    const productId = String(it?.productId || it?.product_id || '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    if (!productId || qty <= 0) continue;

    const recipe = recipeByProduct.get(productId);
    const ings = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    for (const ing of ings) {
      if (!ing || typeof ing !== 'object') continue;
      const ingredientId = String(ing.ingredientId || '').trim();
      const perUnit = Number(ing.quantity ?? 0) || 0;
      if (!ingredientId || perUnit <= 0) continue;
      const used = perUnit * qty;
      usage.set(ingredientId, (Number(usage.get(ingredientId) || 0) || 0) + used);
    }
  }

  if (usage.size === 0) {
    // Nothing to deduct (no recipes / no ingredients).
    return { ok: true, noRecipes: true };
  }

  await db().transaction(async (trx) => {
    for (const [ingredientId, usedQty] of usage.entries()) {
      const used = Number(usedQty || 0) || 0;
      if (used <= 0) continue;

      const row = await trx
        .from('inventory_items')
        .where({ tenant_id: tenantId, id: ingredientId })
        .select(['id', 'on_hand'])
        .first();

      if (!row) continue;

      const cur = Number(row.on_hand || 0) || 0;
      const next = Math.max(0, cur - used);
      await trx.from('inventory_items').where({ tenant_id: tenantId, id: ingredientId }).update({ on_hand: next, updated_at: new Date().toISOString() });
    }
  });

  return { ok: true, deducted: true };
};

const makeKitchenTicketPayload = ({ title, orderRow, lines, beep }) => {
  const payload = safeJsonParse(orderRow?.payload, {});
  const number = String(payload?.number || payload?.orderNumber || orderRow?.id || '').trim();
  const tableName = String(payload?.tableName || payload?.table || '').trim();
  const placedBy = String(payload?.createdByName || payload?.createdByStaffId || '').trim();
  const notes = String(payload?.notes || '').trim();
  const createdAt = payload?.createdAt || orderRow?.created_at || null;
  const t = createdAt ? new Date(createdAt) : new Date();

  const list = Array.isArray(lines) ? lines : [];

  const out = [];
  out.push(escInit);
  if (beep) {
    // Basic BEL beep (works on some printers; safe no-op on others).
    out.push(Buffer.from([0x07]));
  }
  out.push(escAlignCenter);
  out.push(escBoldOn);
  out.push(txt(String(title || 'Kitchen Ticket').toUpperCase()));
  out.push(escBoldOff);
  out.push(nl());
  out.push(nl());

  out.push(escAlignLeft);
  out.push(escBoldOn);
  out.push(txt(`${tableName || 'Table'}  ${number || String(orderRow?.id || '')}`));
  out.push(escBoldOff);
  out.push(nl());
  out.push(txt(`Time: ${t.toLocaleString()}`));
  out.push(nl());
  if (placedBy) {
    out.push(txt(`By: ${placedBy}`));
    out.push(nl());
  }
  if (notes) {
    out.push(nl());
    out.push(txt(`NOTE: ${notes}`));
    out.push(nl());
  }

  out.push(nl());
  out.push(txt('----------------------------'));
  out.push(nl());

  for (const l of list.slice(0, 200)) {
    if (!l) continue;
    const name = String(l?.name || '').trim();
    const qty = Number(l?.qty ?? 0) || 0;
    const note = String(l?.note || '').trim();
    if (!name || qty <= 0) continue;
    out.push(escBoldOn);
    out.push(txt(`${qty}x ${name}`));
    out.push(escBoldOff);
    out.push(nl());
    if (note) {
      out.push(txt(`  - ${note}`));
      out.push(nl());
    }
  }

  out.push(txt('----------------------------'));
  out.push(nl());
  out.push(nl());
  out.push(nl());
  out.push(escCut);

  return Buffer.concat(out);
};

const escInit = Buffer.from([0x1b, 0x40]);
const escAlignCenter = Buffer.from([0x1b, 0x61, 0x01]);
const escAlignLeft = Buffer.from([0x1b, 0x61, 0x00]);
const escBoldOn = Buffer.from([0x1b, 0x45, 0x01]);
const escBoldOff = Buffer.from([0x1b, 0x45, 0x00]);
const escCut = Buffer.from([0x1d, 0x56, 0x00]);

const txt = (s) => Buffer.from(String(s ?? ''), 'utf8');
const nl = () => Buffer.from('\n', 'utf8');

const sendTcp = async ({ host, port, data, timeoutMs }) => {
  const p = Number(port);
  if (!host || !Number.isFinite(p) || p <= 0 || p > 65535) throw new Error('invalid_printer_address');

  return await new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    const t = setTimeout(() => finish(new Error('printer_timeout')), Math.max(500, Number(timeoutMs) || 7000));

    sock.once('error', (e) => {
      clearTimeout(t);
      finish(e);
    });

    sock.connect(p, host, () => {
      sock.write(data, (e) => {
        clearTimeout(t);
        if (e) return finish(e);
        try {
          sock.end();
        } catch {
          // ignore
        }
        finish();
      });
    });
  });
};

const mapPrintError = (e) => {
  const msg = String(e?.message || '').trim().toLowerCase();
  const code = String(e?.code || '').trim().toUpperCase();

  if (msg.includes('invalid_printer_address')) {
    return { status: 400, error: 'invalid_printer_address' };
  }
  if (msg.includes('printer_timeout') || code === 'ETIMEDOUT') {
    return { status: 408, error: 'printer_timeout' };
  }
  if (code === 'ECONNREFUSED') {
    return { status: 502, error: 'printer_refused' };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { status: 502, error: 'printer_unreachable' };
  }
  if (code === 'ENOTFOUND') {
    return { status: 400, error: 'printer_host_not_found' };
  }
  return { status: 500, error: 'print_failed' };
};

const makeReceiptPayloadFromOrder = ({ orderRow, operatorName }) => {
  const payload = safeJsonParse(orderRow?.payload, {});
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const number = String(payload?.number || payload?.orderNumber || orderRow?.id || '').trim();
  const tableName = String(payload?.tableName || payload?.table || '').trim();
  const waiterName = String(payload?.createdByName || payload?.cashierName || '').trim();
  const operator = String(payload?.paidByName || operatorName || payload?.paidByStaffId || '').trim();

  const orderType = String(payload?.orderType || payload?.order_type || '').trim().toLowerCase();
  const takeawayFee = Math.max(0, Number(payload?.takeawayFee ?? payload?.takeaway_fee ?? 0) || 0);
  const serviceChargeRaw = Math.max(0, Number(payload?.serviceCharge ?? payload?.service_charge ?? 0) || 0);
  const payloadSubtotal = Math.max(0, Number(payload?.subtotal ?? 0) || 0);

  const total = Number(orderRow?.total || 0) || 0;
  const tax = Number(orderRow?.tax || 0) || 0;
  const discount = Number(orderRow?.discount || 0) || 0;
  const discountPct = Number(payload?.discountPct ?? payload?.discount_pct ?? 0) || 0;
  const tip = Number(orderRow?.tip || 0) || 0;

  const derivedServiceCharge = Math.max(0, total - Math.max(0, payloadSubtotal - discount) - tax - tip - takeawayFee);
  const serviceCharge = serviceChargeRaw > 0.0001 ? serviceChargeRaw : derivedServiceCharge;

  const paymentMethod = String(payload?.paymentMethod || payload?.payment_method || orderRow?.payment_method || '').trim();
  const tenderedAmount = Number(payload?.tenderedAmount ?? payload?.tendered_amount ?? 0) || 0;
  const changeDue = Math.max(0, tenderedAmount - total);

  const paidAt = orderRow?.paid_at ? new Date(orderRow.paid_at) : null;

  const cols = 32;
  const padR = (s, n) => {
    const t = String(s ?? '');
    if (t.length >= n) return t.slice(0, n);
    return t + ' '.repeat(n - t.length);
  };
  const padL = (s, n) => {
    const t = String(s ?? '');
    if (t.length >= n) return t.slice(t.length - n);
    return ' '.repeat(n - t.length) + t;
  };
  const center = (s, n) => {
    const t = String(s ?? '').trim();
    if (!t) return '';
    if (t.length >= n) return t.slice(0, n);
    const left = Math.floor((n - t.length) / 2);
    const right = n - t.length - left;
    return ' '.repeat(left) + t + ' '.repeat(right);
  };
  const twoCol = (a, b) => {
    const left = String(a ?? '').trim();
    const right = String(b ?? '').trim();
    if (!right) return padR(left, cols);
    const maxLeft = Math.max(0, cols - right.length - 1);
    return padR(left.slice(0, maxLeft), maxLeft) + ' ' + padL(right, cols - maxLeft - 1);
  };
  const dash = '-'.repeat(cols);
  const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00');
  const wrap = (s, width) => {
    const t = String(s ?? '').trim();
    if (!t) return [''];
    const out = [];
    for (let i = 0; i < t.length; i += width) out.push(t.slice(i, i + width));
    return out;
  };

  const lines = [];
  lines.push(escInit);
  lines.push(escAlignCenter);
  const header1 = String(payload?.businessName || payload?.branchName || '').trim();
  const header2 = String(payload?.address || '').trim();
  const header3 = String(payload?.phone || '').trim();
  const headerTin = String(payload?.tin || '').trim();

  if (headerTin) lines.push(txt(center(`TIN: ${headerTin}`, cols)));
  if (header1) lines.push(txt(center(header1, cols)));
  if (header2) lines.push(txt(center(header2, cols)));
  if (header3) lines.push(txt(center(`TEL: ${header3}`, cols)));
  lines.push(nl());

  lines.push(escAlignLeft);
  const dateStr = paidAt
    ? paidAt.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : new Date(orderRow?.created_at || Date.now()).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = paidAt
    ? paidAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : new Date(orderRow?.created_at || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  lines.push(txt(twoCol(dateStr, timeStr)));
  lines.push(nl());
  lines.push(nl());

  lines.push(txt(padR(`Order: ${number || String(orderRow?.id || '')}`, cols)));
  const ref = String(payload?.paymentReference || payload?.ref || '').trim();
  if (ref) {
    lines.push(nl());
    lines.push(txt(padR(`Ref: ${ref}`, cols)));
  }
  if (paymentMethod) {
    lines.push(nl());
    lines.push(txt(padR(`Payment: ${String(paymentMethod).toUpperCase()}`, cols)));
  }
  if (operator) {
    lines.push(nl());
    lines.push(txt(padR(`Operator: ${operator}`, cols)));
  }
  if (waiterName) {
    lines.push(nl());
    lines.push(txt(padR(`Waiter: ${waiterName}`, cols)));
  }
  if (tableName) {
    lines.push(nl());
    lines.push(txt(padR(`Table: ${tableName}`, cols)));
  }
  if (orderType === 'takeaway') {
    lines.push(nl());
    lines.push(txt(padR('Order Type: TAKEAWAY', cols)));
  }

  lines.push(nl());
  lines.push(txt(dash));
  lines.push(nl());
  lines.push(txt(twoCol('Description', 'Amount')));
  lines.push(nl());
  lines.push(txt(dash));
  lines.push(nl());

  for (const it of items.slice(0, 200)) {
    const name = String(it?.name || it?.productName || it?.productId || '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    const unitPrice = Number(it?.unitPrice ?? it?.price ?? 0) || 0;
    const lineTotal = qty * unitPrice;

    for (const w of wrap(name || '-', cols)) {
      lines.push(txt(padR(w, cols)));
      lines.push(nl());
    }
    lines.push(txt(twoCol(`${qty} x ${fmt(unitPrice)}`, fmt(lineTotal))));
    lines.push(nl());
  }

  lines.push(txt(dash));
  lines.push(nl());
  lines.push(txt(twoCol('SUBTOTAL', fmt(payloadSubtotal || Math.max(0, total - tax - tip + discount - serviceCharge - takeawayFee)))));
  lines.push(nl());
  if (discount > 0.0001 || discountPct > 0.0001) {
    const lab = discountPct > 0.0001 ? `DISCOUNT ${Math.round(discountPct)}%` : 'DISCOUNT';
    lines.push(txt(twoCol(lab, fmt(discount))));
    lines.push(nl());
  }
  if (serviceCharge > 0.0001) {
    lines.push(txt(twoCol('SERVICE', fmt(serviceCharge))));
    lines.push(nl());
  }
  if (tax > 0.0001) {
    lines.push(txt(twoCol('TAX', fmt(tax))));
    lines.push(nl());
  }
  if (takeawayFee > 0.0001) {
    lines.push(txt(twoCol('TAKEAWAY FEE', fmt(takeawayFee))));
    lines.push(nl());
  }
  if (tip > 0.0001) {
    lines.push(txt(twoCol('TIP', fmt(tip))));
    lines.push(nl());
  }
  lines.push(txt(dash));
  lines.push(nl());
  lines.push(escBoldOn);
  lines.push(txt(twoCol('TOTAL', fmt(total))));
  lines.push(escBoldOff);
  lines.push(nl());
  if (String(paymentMethod || '').trim().toLowerCase() === 'cash' && tenderedAmount > 0.0001) {
    lines.push(txt(twoCol('Tendered', fmt(tenderedAmount))));
    lines.push(nl());
    lines.push(txt(twoCol('Change', fmt(changeDue))));
    lines.push(nl());
  }
  lines.push(nl());

  lines.push(escAlignCenter);
  const footerBrand = String(payload?.receiptFooterBrand || '').trim();
  if (footerBrand) lines.push(txt(footerBrand));
  lines.push(nl());
  lines.push(nl());
  lines.push(nl());
  lines.push(escCut);

  return Buffer.concat(lines);
};

const loadOwnerSettings = async (tenantId) => {
  try {
    const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: tenantId }).first();
    const parsed = safeJsonParse(row?.settings_json, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const loadBranchSettings = async ({ tenantId, branchId }) => {
  try {
    if (!branchId) return {};
    const row = await db().select(['settings_json']).from('manager_settings').where({ tenant_id: tenantId, branch_id: branchId }).first();
    const parsed = safeJsonParse(row?.settings_json, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const loadTenantPosGateways = async (tenantId) => {
  try {
    const tid = String(tenantId || '').trim();
    if (!tid) return [];
    const rows = await db()
      .from('tenant_pos_payment_gateways')
      .select(['gateway', 'enabled'])
      .where({ tenant_id: tid });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

const loadPlatformGatewayFlags = async () => {
  try {
    const row = await db()
      .from('platform_payment_config')
      .select(['chapa_config_json', 'telebirr_config_json'])
      .where({ id: 1 })
      .first();

    const chapa = safeJsonParse(row?.chapa_config_json, {});
    const telebirr = safeJsonParse(row?.telebirr_config_json, {});

    return {
      chapaEnabled: chapa?.enabledForPos === true,
      telebirrEnabled: telebirr?.enabledForPos === true,
    };
  } catch {
    return { chapaEnabled: false, telebirrEnabled: false };
  }
};

const applyTenantGatewayTogglesToPaymentMethods = (methods, gatewayRows, platformFlags) => {
  const list = Array.isArray(methods) ? methods : [];
  const gw = Array.isArray(gatewayRows) ? gatewayRows : [];
  const platform = platformFlags && typeof platformFlags === 'object' ? platformFlags : null;

  const byGateway = new Map();
  for (const r of gw) {
    const g = String(r?.gateway || '').trim().toLowerCase();
    if (!g) continue;
    // Database might return 1/0 or true/false. Convert to strict boolean.
    // If it is 1 or true, it is enabled. If 0 or false, it is disabled.
    const isEnabled = r?.enabled === 1 || r?.enabled === true;
    byGateway.set(g, isEnabled);
  }

  const methodIdsByGateway = {
    chapa: ['chapa'],
    telebirr: ['telebirr'],
    santimpay: ['santimpay'],
    cash: ['cash'],
    bank_transfer: ['bank_transfer'],
    check: ['check'],
    mobile_money: ['mobile_money'],
    credit_card: ['credit_card'],
    other: ['other'],
  };

  const patchEnabled = (id, enabled) => {
    const mid = String(id || '').trim();
    if (!mid) return;
    const idx = list.findIndex((m) => m && typeof m === 'object' && String(m.id || '').trim() === mid);
    if (idx >= 0) {
      list[idx] = { ...list[idx], enabled };
      return;
    }
    // Only add if explicitly enabling via override/default logic, otherwise respect original list
    // However, for consistency we push if missing so overrides work even if owner didn't add it
    list.push({ id: mid, enabled, label: mid });
  };

  // Standard methods that should be ENABLED by default if not strictly disabled by tenant override
  const standardMethods = new Set(['cash', 'bank_transfer', 'check', 'credit_card', 'other']);

  for (const [gateway, methodIds] of Object.entries(methodIdsByGateway)) {
    // If tenant has an explicit override (true/false), use it.
    if (byGateway.has(gateway)) {
      const enabled = byGateway.get(gateway) !== false;
      for (const id of methodIds) patchEnabled(id, enabled);
      continue;
    }

    // If no tenant override...
    if (standardMethods.has(gateway)) {
      // Standard methods: Leave them as is (don't disable), or ensure they are present if they were missing?
      // Actually, standard behavior is: if owner enabled it, it's enabled.
      // But if we want Superadmin to be able to FORCE disable it, we rely on byGateway.has(gateway) above.
      // If byGateway DOES NOT have it, we revert to default behavior (owner settings).
      // So we do NOTHING here.
      continue;
    }
  }

  // Special logic for Integrations (Chapa, Telebirr, etc.):
  // Rule: Tenant Override > Platform Flag > Default (Disabled)

  // Chapa
  const chapaOverride = byGateway.get('chapa');
  const chapaPlatform = platform && platform.chapaEnabled === true;

  if (byGateway.has('chapa')) {
    const enabled = chapaOverride === true;
    patchEnabled('chapa', enabled);
  } else {
    if (chapaPlatform) {
      patchEnabled('chapa', true);
    } else {
      patchEnabled('chapa', false);
    }
  }

  // Telebirr
  const telebirrOverride = byGateway.get('telebirr');
  const telebirrPlatform = platform && platform.telebirrEnabled === true;

  if (byGateway.has('telebirr')) {
    const enabled = telebirrOverride === true;
    patchEnabled('telebirr', enabled);
  } else {
    if (telebirrPlatform) {
      patchEnabled('telebirr', true);
    } else {
      patchEnabled('telebirr', false);
    }
  }

  // SantimPay - Purely tenant based usually, but let's follow pattern if platform has flag (it doesn't currently)
  if (byGateway.has('santimpay')) {
    patchEnabled('santimpay', byGateway.get('santimpay') === true);
  } else {
  }
  if (byGateway.has('mobile_money')) {
    const enabled = byGateway.get('mobile_money') !== false;
    patchEnabled('mobile_money', enabled);
  }
  return list;
};

const normalizeSettingsForPos = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  const taxes = s.taxes && typeof s.taxes === 'object' ? s.taxes : {};
  const general = s.general && typeof s.general === 'object' ? s.general : {};
  const business = s.business && typeof s.business === 'object' ? s.business : {};
  const payments = s.payments && typeof s.payments === 'object' ? s.payments : {};
  const policies = s.policies && typeof s.policies === 'object' ? s.policies : {};
  const security = s.security && typeof s.security === 'object' ? s.security : {};
  const loyalty = normalizeLoyaltySettings(s);
  return {
    general: {
      currency: typeof general.currency === 'string' && general.currency.trim() ? general.currency.trim().toUpperCase() : 'ETB',
      timezone:
        typeof business.timezone === 'string' && business.timezone.trim() ? business.timezone.trim() : 'Africa/Addis_Ababa',
    },
    taxes: {
      // Tax is disabled by default - must be explicitly enabled by manager/owner
      vatEnabled: typeof taxes.vatEnabled === 'boolean' ? taxes.vatEnabled : false,
      vatRate: Number.isFinite(Number(taxes.vatRate)) ? Number(taxes.vatRate) : 15,
      serviceChargeEnabled: typeof taxes.serviceChargeEnabled === 'boolean' ? taxes.serviceChargeEnabled : false,
      serviceChargeRate: Number.isFinite(Number(taxes.serviceChargeRate)) ? Number(taxes.serviceChargeRate) : 0,
    },
    payments: {
      allowSplitPayments: typeof payments.allowSplitPayments === 'boolean' ? payments.allowSplitPayments : false,
      methods: Array.isArray(payments.methods) ? payments.methods : [],
    },
    policies: {
      maxDiscountPctWithoutApproval: Number.isFinite(Number(policies.maxDiscountPctWithoutApproval)) ? Number(policies.maxDiscountPctWithoutApproval) : 10,
    },
    security: {
      requirePinForRefunds: typeof security.requirePinForRefunds === 'boolean' ? security.requirePinForRefunds : false,
      requirePinForDiscounts: typeof security.requirePinForDiscounts === 'boolean' ? security.requirePinForDiscounts : false,
      sessionTimeoutMins: Number.isFinite(Number(security.sessionTimeoutMins)) ? Math.trunc(Number(security.sessionTimeoutMins)) : 30,
    },
    loyalty,
  };
};

const resolveEffectivePosSettings = async ({ tenantId, branchId }) => {
  const ownerRaw = await loadOwnerSettings(tenantId);
  const branchRaw = await loadBranchSettings({ tenantId, branchId });
  const gateways = await loadTenantPosGateways(tenantId);
  const platformFlags = await loadPlatformGatewayFlags();

  const owner = normalizeSettingsForPos(ownerRaw);
  const branch = normalizeSettingsForPos(branchRaw);

  const payments = {
    ...owner.payments,
    methods: applyTenantGatewayTogglesToPaymentMethods(owner.payments?.methods, gateways, platformFlags),
  };

  return {
    general: { ...owner.general, ...branch.general },
    taxes: { ...owner.taxes, ...branch.taxes },
    payments,
    policies: owner.policies,
    security: owner.security,
    loyalty: { ...owner.loyalty, ...branch.loyalty },
    branchPayments: {
      qrCodes: (() => {
        const p = branchRaw?.payments && typeof branchRaw.payments === 'object' ? branchRaw.payments : {};
        const q = p?.qrCodes && typeof p.qrCodes === 'object' ? p.qrCodes : {};
        return {
          telebirr: typeof q.telebirr === 'string' ? String(q.telebirr) : '',
          bank_transfer: typeof q.bank_transfer === 'string' ? String(q.bank_transfer) : '',
          card: typeof q.card === 'string' ? String(q.card) : '',
        };
      })(),
      qrDetails: (() => {
        const p = branchRaw?.payments && typeof branchRaw.payments === 'object' ? branchRaw.payments : {};
        const qd = p?.qrDetails && typeof p.qrDetails === 'object' ? p.qrDetails : {};
        const legacy = p?.qrCodes && typeof p.qrCodes === 'object' ? p.qrCodes : {};

        const normalize = (v) => (typeof v === 'string' ? String(v) : '');
        const normalizeObj = (rawObj, legacyImage) => {
          const o = rawObj && typeof rawObj === 'object' ? rawObj : {};
          return {
            image: normalize(o.image) || normalize(legacyImage),
            accountName: normalize(o.accountName),
            phone: normalize(o.phone),
            merchantId: normalize(o.merchantId),
            accountNumber: normalize(o.accountNumber),
            bankName: normalize(o.bankName),
            note: normalize(o.note),
          };
        };

        return {
          telebirr: normalizeObj(qd.telebirr, legacy.telebirr),
          bank_transfer: normalizeObj(qd.bank_transfer, legacy.bank_transfer),
          card: normalizeObj(qd.card, legacy.card),
        };
      })(),
      requireReferenceForMethods: (() => {
        const p = branchRaw?.payments && typeof branchRaw.payments === 'object' ? branchRaw.payments : {};
        const list = Array.isArray(p.requireReferenceForMethods) ? p.requireReferenceForMethods : null;
        const normalized = (list || ['mobile_money', 'bank_transfer', 'card']).map((x) => String(x || '').trim()).filter(Boolean);
        return normalized;
      })(),
    },
    printers: {
      autoPrintReceipts: (() => {
        const prefs = branchRaw?.printerPrefs && typeof branchRaw.printerPrefs === 'object' ? branchRaw.printerPrefs : {};
        return prefs?.autoPrintReceipts === true;
      })(),
      defaultReceiptPrinterId: (() => {
        const v = branchRaw?.defaultReceiptPrinterId;
        return v == null ? null : String(v || '').trim() || null;
      })(),
      defaultKitchenPrinterId: (() => {
        const v = branchRaw?.defaultKitchenPrinterId;
        return v == null ? null : String(v || '').trim() || null;
      })(),
      fallbackKitchenPrinterId: (() => {
        const v = branchRaw?.fallbackKitchenPrinterId;
        return v == null ? null : String(v || '').trim() || null;
      })(),
    },
    receipt: {
      header:
        typeof branchRaw?.receipt?.header === 'string'
          ? String(branchRaw.receipt.header)
          : typeof ownerRaw?.receipt?.header === 'string'
            ? String(ownerRaw.receipt.header)
            : '',
      footer1:
        typeof branchRaw?.receipt?.footer1 === 'string'
          ? String(branchRaw.receipt.footer1)
          : typeof ownerRaw?.receipt?.footer1 === 'string'
            ? String(ownerRaw.receipt.footer1)
            : '',
      footer2:
        typeof branchRaw?.receipt?.footer2 === 'string'
          ? String(branchRaw.receipt.footer2)
          : typeof ownerRaw?.receipt?.footer2 === 'string'
            ? String(ownerRaw.receipt.footer2)
            : '',
      showTin:
        typeof branchRaw?.receipt?.showTin === 'boolean'
          ? branchRaw.receipt.showTin
          : typeof ownerRaw?.receipt?.showTin === 'boolean'
            ? ownerRaw.receipt.showTin
            : true,
      showBranchName:
        typeof branchRaw?.receipt?.showBranchName === 'boolean'
          ? branchRaw.receipt.showBranchName
          : typeof ownerRaw?.receipt?.showBranchName === 'boolean'
            ? ownerRaw.receipt.showBranchName
            : false,
      logoDataUrl:
        typeof branchRaw?.receipt?.logoDataUrl === 'string'
          ? String(branchRaw.receipt.logoDataUrl)
          : typeof ownerRaw?.receipt?.logoDataUrl === 'string'
            ? String(ownerRaw.receipt.logoDataUrl)
            : '',
    },
    business: {
      businessName: typeof ownerRaw?.business?.businessName === 'string' ? String(ownerRaw.business.businessName) : '',
      legalName: '',
      tin:
        typeof branchRaw?.branchInfo?.tin === 'string'
          ? String(branchRaw.branchInfo.tin)
          : typeof ownerRaw?.business?.tin === 'string'
            ? String(ownerRaw.business.tin)
            : '',
      phone:
        typeof branchRaw?.branchInfo?.phone === 'string'
          ? String(branchRaw.branchInfo.phone)
          : typeof ownerRaw?.business?.phone === 'string'
            ? String(ownerRaw.business.phone)
            : '',
      email: '',
      address:
        typeof branchRaw?.branchInfo?.address === 'string'
          ? String(branchRaw.branchInfo.address)
          : typeof ownerRaw?.business?.address === 'string'
            ? String(ownerRaw.business.address)
            : '',
    },
  };
};

const methodToSettingId = (m) => {
  const v = String(m || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'cash') return 'cash';
  if (v === 'card') return 'card';
  if (v === 'telebirr' || v === 'mobile_money' || v === 'mobile money' || v === 'qr') return 'mobile_money';
  if (v === 'bank_transfer' || v === 'bank transfer') return 'bank_transfer';
  if (v === 'loyalty') return 'loyalty';
  return v;
};

const setNoStore = (res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    try {
      res.removeHeader('ETag');
      res.removeHeader('Last-Modified');
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
};

const normalizePaymentReference = (v) => {
  const s = String(v || '').trim();
  return s ? s.toUpperCase() : '';
};

const referenceRequiredForMethod = (settings, pmId) => {
  const list = Array.isArray(settings?.branchPayments?.requireReferenceForMethods) ? settings.branchPayments.requireReferenceForMethods : [];
  return list.includes(pmId);
};

const computeOrderTotalsFromPayload = ({ payload, tip, discount, discountPct, settings, allowOverMax }) => {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const subtotal = items.reduce((sum, it) => {
    const qty = Number(it?.qty) || 0;
    const unit = Number(it?.unitPrice) || 0;
    if (qty <= 0 || unit < 0) return sum;
    return sum + qty * unit;
  }, 0);

  const orderType = String(payload?.orderType || payload?.order_type || '').trim().toLowerCase();
  const takeawayFeeRaw = Number(payload?.takeawayFee ?? payload?.takeaway_fee ?? 0) || 0;
  const takeawayFee = orderType === 'takeaway' ? Math.max(0, takeawayFeeRaw) : 0;

  const maxPct = Number(settings?.policies?.maxDiscountPctWithoutApproval ?? 10) || 0;
  const maxPctClamped = Math.max(0, Math.min(90, maxPct));
  const canOverride = allowOverMax === true;

  const incomingPct = Number(discountPct);
  const hasPct = Number.isFinite(incomingPct);
  const pctRequested = hasPct ? Math.max(0, Math.min(90, incomingPct)) : 0;
  const pctApplied = hasPct ? (canOverride ? pctRequested : Math.min(pctRequested, maxPctClamped)) : 0;
  const discountFromPct = subtotal * (pctApplied / 100);

  const hardCapPct = canOverride ? 90 : maxPctClamped;
  const maxDiscount = Math.max(0, subtotal * (hardCapPct / 100));
  const discountFromAmount = Math.max(0, Math.min(Number(discount || 0) || 0, maxDiscount));
  const discountApplied = hasPct ? Math.max(0, Math.min(discountFromPct, maxDiscount)) : discountFromAmount;

  const taxableBase = Math.max(0, subtotal - discountApplied);
  const vatRate = Math.max(0, Math.min(40, Number(settings?.taxes?.vatRate ?? 0) || 0));
  const svcRate = Math.max(0, Math.min(40, Number(settings?.taxes?.serviceChargeRate ?? 0) || 0));

  const vat = settings?.taxes?.vatEnabled ? taxableBase * (vatRate / 100) : 0;
  const serviceCharge = settings?.taxes?.serviceChargeEnabled ? taxableBase * (svcRate / 100) : 0;

  const tipAmt = Math.max(0, Number(tip || 0) || 0);
  const total = taxableBase + vat + serviceCharge + tipAmt + takeawayFee;

  return {
    subtotal,
    discountPct: hasPct ? pctApplied : 0,
    discount: discountApplied,
    tax: vat,
    serviceCharge,
    tip: tipAmt,
    takeawayFee,
    orderType: orderType === 'takeaway' ? 'takeaway' : 'dine_in',
    total,
  };
};

const normalizeBranchId = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === 'global') return '';
  if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
  return s;
};

const resolveBranchId = async (req) => {
  const fromToken = normalizeBranchId(req.auth?.branchId);
  const q = typeof req.query?.branchId === 'string' ? normalizeBranchId(req.query.branchId) : '';

  const role = String(req.auth?.role || '');
  const isOwnerGlobal = role === 'Cafe Owner' && (!fromToken || fromToken === 'global');
  const isWaiterManagerGlobal = role === 'Waiter Manager' && (!fromToken || fromToken === 'global');
  if (!isOwnerGlobal && !isWaiterManagerGlobal) return fromToken;

  if (q) return q;

  // Option B: Auto-select the first branch for the tenant.
  try {
    const row = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc').first();
    return row?.id ? String(row.id) : '';
  } catch {
    return '';
  }
};

const makePosRouter = () => {
  const r = express.Router();

  r.use(makePosShiftsRouter());
  r.use(makePosCustomerDisplayRouter({ resolveBranchId }));
  r.use(makePosPrintQueueRouter({ resolveBranchId, loadBranchSettings, hydratePayloadFromNormalized, makeKitchenTicketPayload, sendTcp, mapPrintError }));
  r.use(makePosHardwareRouter({ resolveBranchId, sendTcp }));
  r.use(makePosMenuRouter({ resolveBranchId }));
  r.use(makePosLoyaltyRouter({ resolveBranchId, toIso, computeLoyaltyExpiry, LOYALTY_CONVERSION, computeBalanceFromPoints, resolveEffectivePosSettings }));
  r.use(makePosTablesRouter({ resolveBranchId, setNoStore, backfillRestaurantTablesFromLegacyState, mapTableStatusFromOrderStatus, mapRestaurantTableRow, loadRestaurantTable, publish }));
  r.use(makePosNotificationsRouter({ resolveBranchId, mapAuditToNotification }));
  r.use(makePosKdsRouter({ resolveBranchId }));

  const sanitizeChapaText = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    return s
      .replace(/\r/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 95);
  };

  r.use(
    makePosOrdersRouter({
      resolveBranchId,
      loadBranchSettings,
      validateCreateOrderBody,
      safeJsonParse,
      hydratePayloadFromNormalized,
      resolveEffectivePosSettings,
      makeReceiptPayloadFromOrder,
      sendTcp,
      mapPrintError,
      makeKitchenTicketPayload,
      mapTableStatusFromOrderStatus,
      setNoStore,
      backfillRestaurantTablesFromLegacyState,
      loadRestaurantTable,
      ensureRestaurantTableRow,
      syncRestaurantTableForOrder,
      verifyStaffPin,
      verifyManagerOrOwnerPin,
      computeOrderTotalsFromPayload,
      normalizeOrderColsFromPayload,
      normalizeItemsFromPayload,
      normalizeSplitsFromPayload,
      normalizeSplitItemsFromPayload,
      normalizePaymentsFromPayload,
      applyLoyaltyForPaidOrder,
      computeLoyaltyRedeemAmount,
      applyInventoryDeductionForOrder,
      methodToSettingId,
      referenceRequiredForMethod,
      normalizePaymentReference,
      paymentGatewayService,
      publicBaseUrlFromReq,
      shortToken,
      sanitizeChapaText,
      publish,
    }),
  );

  r.post(
    '/pos/payments',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (_req, res) => res.json({ ok: true }),
  );

  r.get(
    '/pos/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const eff = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const branch = await db().select(['id', 'name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
        return res.json({
          ok: true,
          tenantId: req.tenant.id,
          branchId,
          branch: branch ? { id: String(branch.id), name: String(branch.name || '') } : { id: String(branchId), name: '' },
          general: eff.general,
          taxes: eff.taxes,
          security: eff.security,
          payments: eff.payments,
          branchPayments: eff.branchPayments,
          printers: eff.printers,
          loyalty: eff.loyalty,
          receipt: eff.receipt,
          business: eff.business,
        });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/initialize',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const force = String(req.query?.force || '').trim() === '1' || String(req.query?.force || '').trim().toLowerCase() === 'true';

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const count = Number(body?.tablesCount || 12);
        const seats = Number(body?.defaultSeats || 4);
        const area = typeof body?.defaultArea === 'string' ? body.defaultArea : 'Main Hall';

        const pad2 = (x) => String(x).padStart(2, '0');
        const n = Math.max(1, Math.min(200, Number(count) || 0));
        const s = Math.max(1, Math.min(20, Number(seats) || 4));
        const a = typeof area === 'string' && area.trim() ? area.trim() : 'Main Hall';

        const nowIso = new Date().toISOString();

        // Seed restaurant_tables
        const existingTables = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .select(['id'])
          .limit(1);

        if (force || !existingTables || existingTables.length === 0) {
          if (force) {
            await db().from('restaurant_tables').where({ tenant_id: req.tenant.id, branch_id: branchId }).del();
          }

          const inserts = Array.from({ length: n }).map((_, i) => {
            const name = `T-${pad2(i + 1)}`;
            return {
              tenant_id: req.tenant.id,
              branch_id: branchId,
              id: uid('tbl'),
              name,
              area: a,
              status: 'Free',
              seats: s,
              open_order_id: null,
              last_order_id: null,
              assigned_staff_id: null,
              assigned_staff_name: null,
              updated_at: nowIso,
            };
          });
          if (inserts.length) await db().from('restaurant_tables').insert(inserts);
        }

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, initialized: true, updatedAt: nowIso });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/staff/verify-pin',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const staffId = String(body?.staffId || body?.waiterId || '').trim();
        const pin = typeof body?.pin === 'string' ? body.pin : '';
        if (!staffId) return res.status(400).json({ error: 'staff_required' });
        if (!pin.trim()) return res.status(401).json({ error: 'pin_required' });

        const staffRow = await db()
          .from('staff')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId })
          .select(['id', 'name', 'role_name'])
          .first();

        if (!staffRow) return res.status(404).json({ error: 'staff_not_found' });
        if (String(staffRow.role_name || '').trim() !== 'Waiter') return res.status(403).json({ error: 'forbidden' });

        const ok = await verifyStaffPin({ tenantId: req.tenant.id, branchId, staffId, pin });
        if (!ok) return res.status(401).json({ error: 'pin_required' });

        return res.json({ ok: true, staff: { id: String(staffRow.id), name: String(staffRow.name || ''), roleName: String(staffRow.role_name || '') } });
      } catch (e) {
        return next(e);
      }
    });

  return r;
};

module.exports = { makePosRouter };
