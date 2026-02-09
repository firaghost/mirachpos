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
      .select(['chapa_config_json', 'telebirr_config_json', 'cbe_birr_config_json'])
      .where({ id: 1 })
      .first();

    const chapa = safeJsonParse(row?.chapa_config_json, {});
    const telebirr = safeJsonParse(row?.telebirr_config_json, {});
    const cbeBirr = safeJsonParse(row?.cbe_birr_config_json, {});

    return {
      chapaEnabled: chapa?.enabledForPos === true,
      telebirrEnabled: telebirr?.enabledForPos === true,
      cbeBirrEnabled: cbeBirr?.enabled === true,
    };
  } catch {
    return { chapaEnabled: false, telebirrEnabled: false, cbeBirrEnabled: false };
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
    cbe_birr: ['cbe_birr'],
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
    // Explicit Tenant Override takes precedence
    // If tenant enabled it (true), we enable 'chapa' AND 'mobile_money' (legacy support)
    const enabled = chapaOverride === true;
    patchEnabled('chapa', enabled);
  } else {
    // No tenant override: fallback to platform
    // If platform says enabled, we enable. If platform says disabled (or null), we disable.
    // BUT user says "not from the payment config".
    // If user implies that "Platform Config" (Subscription) shouldn't control POS connectivity?
    // "payment config ... is for the subscription ... not where they collect thier sells money"
    // This implies that if Platform is DISABLED, Tenant should still be able to ENABLE it?
    // Yes, that is covered by `if (byGateway.has('chapa'))` above.
    // If Platform is ENABLED, does that mean ALL tenants get it? 
    // Usually yes, unless they strictly disable it.
    // But if Platform is DISABLED, can a tenant enable it? Yes, via Override.
    // So the only question is: what is the DEFAULT if no override?
    // If Platform Enabled -> Default Enabled.
    // If Platform Disabled -> Default Disabled.
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

  // CBE Birr
  const cbeOverride = byGateway.get('cbe_birr');
  const cbePlatform = platform && platform.cbeBirrEnabled === true;
  if (byGateway.has('cbe_birr')) {
    patchEnabled('cbe_birr', cbeOverride === true);
  } else {
    patchEnabled('cbe_birr', Boolean(cbePlatform));
  }

  // SantimPay - Purely tenant based usually, but let's follow pattern if platform has flag (it doesn't currently)
  if (byGateway.has('santimpay')) {
    patchEnabled('santimpay', byGateway.get('santimpay') === true);
  } else {
    // Default? usually disabled if not configured.
    // If checking `standardMethods` didn't catch it (it's in methodIdsByGateway but not standardMethods)
    // We should probably ensure it's disabled if not explicitly enabled?
    // But we don't want to break existing setups.
    // Safe default for Santim is: if not in override, leave it alone (owner settings)?
    // But we want Superadmin to be able to disable it.
    // If Superadmin has NOT touched it, it's not in `gatewayRows`.
    // So we assume Owner controls it.
  }

  // Mobile Money (Legacy)
  // If we mapped `mobile_money` to Chapa above, we might have already patched it.
  // But strictly speaking, if there is a 'mobile_money' generic gateway override:
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
      vatEnabled: typeof taxes.vatEnabled === 'boolean' ? taxes.vatEnabled : true,
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

const resolveBranchId = async (req) => {
  const fromToken = String(req.auth?.branchId || '').trim();
  const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

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

  const sanitizeChapaText = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    return s
      .replace(/[^A-Za-z0-9\-_. ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    });

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

  r.post(
    '/pos/shifts/start',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (_req, res) => res.status(201).json({ ok: true }),
  );

  r.post(
    '/pos/shifts/end',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (_req, res) => res.json({ ok: true }),
  );

  r.get(
    '/pos/shifts/current',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (_req, res) => res.status(404).json({ error: 'not_found' }),
  );

  r.post(
    '/pos/print/queue/retry',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const queueId = String(req.body?.queueId || '').trim();
        if (!queueId) return res.status(400).json({ error: 'queue_id_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];

        const row = await db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: queueId })
          .select(['id', 'order_id', 'device_id', 'fallback_device_id', 'status', 'payload_json', 'attempts'])
          .first();
        if (!row) return res.status(404).json({ error: 'queue_item_not_found' });

        const status = String(row.status || '').trim().toLowerCase();
        if (status === 'printed') return res.json({ ok: true, status: 'printed' });

        const attempts = Number(row.attempts || 0) || 0;
        if (attempts >= 3) return res.status(409).json({ error: 'retry_limit_reached' });

        const currentFallbackId = String(branchRaw?.fallbackKitchenPrinterId || '').trim();
        const storedFallbackId = String(row.fallback_device_id || '').trim();
        if (storedFallbackId && currentFallbackId && storedFallbackId !== currentFallbackId) {
          return res.status(409).json({ error: 'fallback_printer_changed' });
        }

        const deviceId = String(row.device_id || '').trim();
        const device = devices.find((d) => String(d?.id || '') === deviceId);
        if (!device) return res.status(404).json({ error: 'device_not_found' });
        if (String(device?.connection || '') !== 'LAN') return res.status(400).json({ error: 'lan_only' });

        const host = String(device?.ip || '').trim();
        const port = String(device?.port || '9100').trim();

        const orderId = String(row.order_id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'paid_at',
            'created_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
          ])
          .first();
        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const itemRows = await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitRows = await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitItemRows = await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const paymentRows = await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });

        const basePayload = hydratePayloadFromNormalized({ orderRow, payloadFallback: safeJsonParse(orderRow?.payload, {}), itemRows, splitRows, splitItemRows, paymentRows });
        const patchedOrderRow = { ...orderRow, payload: JSON.stringify(basePayload) };

        const meta = safeJsonParse(row?.payload_json, {});
        const lines = Array.isArray(meta?.lines) ? meta.lines : null;
        const beep = meta?.beep === true;
        const title = typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : 'Kitchen Ticket';
        const payload = makeKitchenTicketPayload({ title, orderRow: patchedOrderRow, lines, beep });

        const nowIso = new Date().toISOString();
        try {
          await sendTcp({ host, port, data: payload, timeoutMs: 8000 });
          await db().from('print_queue').where({ id: row.id }).update({ status: 'printed', last_error: null, last_attempt_at: nowIso, updated_at: nowIso });
          return res.json({ ok: true, status: 'printed' });
        } catch (e) {
          const mapped = mapPrintError(e);
          const nextAttempts = attempts + 1;
          const nextAt = new Date(Date.now() + 10000).toISOString();
          const nextStatus = nextAttempts >= 3 ? 'failed' : 'pending';
          await db().from('print_queue').where({ id: row.id }).update({
            status: nextStatus,
            error: mapped.error,
            last_error: mapped.error,
            attempts: nextAttempts,
            last_attempt_at: nowIso,
            next_attempt_at: nextAt,
            updated_at: nowIso,
          });
          return res.status(502).json({ ok: false, error: mapped.error, attempts: nextAttempts, nextAttemptAt: nextAt, status: nextStatus });
        }
      } catch (e) {
        return next(e);
      }
    },
  );

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
    '/pos/print/receipt/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const deviceId = String(req.body?.deviceId || branchRaw?.defaultReceiptPrinterId || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_required' });

        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];
        const device = devices.find((d) => String(d?.id || '') === deviceId);
        if (!device) return res.status(404).json({ error: 'device_not_found' });

        if (String(device?.connection || '') !== 'LAN') return res.status(400).json({ error: 'lan_only' });

        const host = String(device?.ip || '').trim();
        const port = String(device?.port || '9100').trim();

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'paid_at',
            'created_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
          ])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const itemRows = await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitRows = await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitItemRows = await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const paymentRows = await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const p = hydratePayloadFromNormalized({ orderRow, payloadFallback: safeJsonParse(orderRow.payload, {}), itemRows, splitRows, splitItemRows, paymentRows });
          const createdBy = typeof p?.createdByStaffId === 'string' ? String(p.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        let operatorName = '';
        if (staffId) {
          try {
            const staff = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
            operatorName = String(staff?.name || '').trim();
          } catch {
            operatorName = '';
          }
        }

        // Build a runtime payload from normalized tables, then inject business info.
        let patchedOrderRow = orderRow;
        try {
          const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
          const basePayload = hydratePayloadFromNormalized({ orderRow, payloadFallback: safeJsonParse(orderRow?.payload, {}), itemRows, splitRows, splitItemRows, paymentRows });
          const businessName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';
          const address = typeof settings?.business?.address === 'string' ? String(settings.business.address).trim() : '';
          const phone = typeof settings?.business?.phone === 'string' ? String(settings.business.phone).trim() : '';
          const tin = typeof settings?.business?.tin === 'string' ? String(settings.business.tin).trim() : '';
          const showTin = settings?.receipt?.showTin !== false;
          const nextPayload = {
            ...(basePayload && typeof basePayload === 'object' ? basePayload : {}),
            businessName: businessName || (basePayload && typeof basePayload === 'object' ? (basePayload.businessName || basePayload.branchName) : ''),
            address: address || (basePayload && typeof basePayload === 'object' ? basePayload.address : ''),
            phone: phone || (basePayload && typeof basePayload === 'object' ? basePayload.phone : ''),
            tin: showTin ? (tin || (basePayload && typeof basePayload === 'object' ? basePayload.tin : '')) : '',
            receiptFooterBrand: '',
          };
          patchedOrderRow = { ...orderRow, payload: JSON.stringify(nextPayload) };
        } catch {
          // ignore
        }

        const payload = makeReceiptPayloadFromOrder({ orderRow: patchedOrderRow, operatorName });
        try {
          await sendTcp({ host, port, data: payload, timeoutMs: 8000 });
        } catch (e) {
          const mapped = mapPrintError(e);
          return res.status(mapped.status).json({ error: mapped.error });
        }

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/orders/:id/refund',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('orders.refund'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const staffId = String(req.auth?.staffId || '').trim();
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const amount = Number(body?.amount ?? 0) || 0;
        const reason = String(body?.reason || '').trim();
        const pin = body?.pin;
        const approveAsStaffId = String(body?.approveAsStaffId || body?.approveAs || '').trim();

        if (!(amount > 0)) return res.status(400).json({ error: 'amount_required' });
        if (!reason) return res.status(400).json({ error: 'reason_required' });

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const requireManagerApproval = settings?.policies?.refundsRequireManager === true;
        const requirePin = settings?.security?.requirePinForRefunds === true;
        let authorizedByStaffId = staffId;
        if (requirePin || requireManagerApproval) {
          if (!approveAsStaffId) return res.status(400).json({ error: 'approver_required' });

          const approver = await db()
            .from('staff')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: approveAsStaffId })
            .select(['id', 'role_name'])
            .first();
          const approverRole = String(approver?.role_name || '').trim();
          if (approverRole !== 'Branch Manager' && approverRole !== 'Cafe Owner') return res.status(403).json({ error: 'forbidden' });

          const ok = await verifyStaffPin({ tenantId: req.tenant.id, branchId, staffId: approveAsStaffId, pin });
          if (!ok) return res.status(401).json({ error: 'pin_required' });
          authorizedByStaffId = approveAsStaffId;
        }

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload'])
          .first();
        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
        const status = String(orderRow.status || '').trim();
        if (status !== 'Paid') return res.status(400).json({ error: 'only_paid_orders_can_refund' });

        const nowIso = new Date().toISOString();
        const payload = safeJsonParse(orderRow.payload, {});
        const paymentMethod = String(payload?.paymentMethod || '').trim();
        const paymentReference = String(payload?.paymentReference || '').trim();

        await db().transaction(async (trx) => {
          await trx
            .from('orders')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
            .update({ status: 'Refunded' });

          await trx.from('finance_ledger').insert({
            id: uid('fin'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            category: 'refund',
            type: 'refund',
            amount: -Math.abs(amount),
            currency: 'ETB',
            memo: `Refund for order ${id}`,
            payload_json: JSON.stringify({ orderId: id, amount, reason, paymentMethod, paymentReference, authorizedBy: authorizedByStaffId, performedBy: staffId }),
            at: nowIso,
            created_at: nowIso,
          });

          await trx.from('void_refund_log').insert({
            id: uid('vr'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            order_id: id,
            type: 'refund',
            product_id: null,
            product_name: null,
            qty: 1,
            amount_etb: Math.abs(amount),
            reason,
            authorized_by: authorizedByStaffId,
            performed_by: staffId,
            occurred_at: nowIso,
            created_at: nowIso,
          });

          await trx.from('audit_log').insert({
            id: uid('aud'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            actor_staff_id: staffId,
            actor_role: String(req.auth?.role || ''),
            type: 'payment.refunded',
            summary: `Refunded order ${id}`,
            payload_json: JSON.stringify({ action: 'payment.refunded', meta: { orderId: id, amount, reason, paymentMethod, paymentReference, authorizedBy: authorizedByStaffId, performedBy: staffId } }),
            created_at: nowIso,
          });
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/print/kitchen/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const deviceId = String(req.body?.deviceId || branchRaw?.defaultKitchenPrinterId || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_required' });

        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];
        const device = devices.find((d) => String(d?.id || '') === deviceId);
        if (!device) return res.status(404).json({ error: 'device_not_found' });
        if (String(device?.connection || '') !== 'LAN') return res.status(400).json({ error: 'lan_only' });

        const host = String(device?.ip || '').trim();
        const port = String(device?.port || '9100').trim();

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'paid_at',
            'created_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
          ])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const itemRows = await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitRows = await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitItemRows = await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const paymentRows = await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });

        const basePayload = hydratePayloadFromNormalized({ orderRow, payloadFallback: safeJsonParse(orderRow?.payload, {}), itemRows, splitRows, splitItemRows, paymentRows });
        const patchedOrderRow = { ...orderRow, payload: JSON.stringify(basePayload) };

        const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
        const beep = req.body?.beep === true;
        const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Kitchen Ticket';
        const payload = makeKitchenTicketPayload({ title, orderRow: patchedOrderRow, lines, beep });
        try {
          await sendTcp({ host, port, data: payload, timeoutMs: 8000 });
        } catch (e) {
          const fallbackId = String(branchRaw?.fallbackKitchenPrinterId || '').trim();
          const fallback = fallbackId ? devices.find((d) => String(d?.id || '') === fallbackId) : null;
          if (fallback && String(fallback?.connection || '') === 'LAN') {
            const fbHost = String(fallback?.ip || '').trim();
            const fbPort = String(fallback?.port || '9100').trim();
            try {
              await sendTcp({ host: fbHost, port: fbPort, data: payload, timeoutMs: 8000 });
              return res.json({ ok: true, fallbackUsed: true });
            } catch (fallbackErr) {
              const mapped = mapPrintError(fallbackErr);
              const nowIso = new Date().toISOString();
              await db().from('print_queue').insert({
                id: uid('prq'),
                tenant_id: req.tenant.id,
                branch_id: branchId,
                order_id: orderId,
                profile: 'Kitchen',
                device_id: deviceId,
                fallback_device_id: fallbackId || null,
                status: 'pending',
                error: mapped.error,
                last_error: mapped.error,
                attempts: 0,
                last_attempt_at: null,
                next_attempt_at: new Date(Date.now() + 10000).toISOString(),
                payload_json: JSON.stringify({ title, lines, beep }),
                created_at: nowIso,
                updated_at: nowIso,
              });
              return res.status(202).json({ ok: false, queued: true, error: mapped.error });
            }
          }
          const mapped = mapPrintError(e);
          const nowIso = new Date().toISOString();
          await db().from('print_queue').insert({
            id: uid('prq'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            order_id: orderId,
            profile: 'Kitchen',
            device_id: deviceId,
            fallback_device_id: fallbackId || null,
            status: 'pending',
            error: mapped.error,
            last_error: mapped.error,
            attempts: 0,
            last_attempt_at: null,
            next_attempt_at: new Date(Date.now() + 10000).toISOString(),
            payload_json: JSON.stringify({ title, lines, beep }),
            created_at: nowIso,
            updated_at: nowIso,
          });
          return res.status(202).json({ ok: false, queued: true, error: mapped.error });
        }

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/print/bar/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const deviceId = String(req.body?.deviceId || branchRaw?.defaultBarPrinterId || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_required' });

        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];
        const device = devices.find((d) => String(d?.id || '') === deviceId);
        if (!device) return res.status(404).json({ error: 'device_not_found' });
        if (String(device?.connection || '') !== 'LAN') return res.status(400).json({ error: 'lan_only' });

        const host = String(device?.ip || '').trim();
        const port = String(device?.port || '9100').trim();

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'paid_at',
            'created_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
          ])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const itemRows = await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitRows = await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const splitItemRows = await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });
        const paymentRows = await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId });

        const basePayload = hydratePayloadFromNormalized({ orderRow, payloadFallback: safeJsonParse(orderRow?.payload, {}), itemRows, splitRows, splitItemRows, paymentRows });
        const patchedOrderRow = { ...orderRow, payload: JSON.stringify(basePayload) };

        const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
        const beep = req.body?.beep === true;
        const payload = makeKitchenTicketPayload({ title: 'Bar Ticket', orderRow: patchedOrderRow, lines, beep });
        try {
          await sendTcp({ host, port, data: payload, timeoutMs: 8000 });
        } catch (e) {
          const mapped = mapPrintError(e);
          return res.status(mapped.status).json({ error: mapped.error });
        }

        return res.json({ ok: true });
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

  r.get(
    '/pos/tables',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        setNoStore(res);

        await backfillRestaurantTablesFromLegacyState({ tenantId: req.tenant.id, branchId });

        const rows = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .select(['id', 'name', 'area', 'status', 'seats', 'open_order_id', 'last_order_id', 'assigned_staff_id', 'assigned_staff_name', 'updated_at'])
          .orderBy('name', 'asc');

        // Derive open orders from the orders table so stale open_order_id never points at a Paid order.
        // We intentionally keep this dialect-safe by parsing payload JSON in JS.
        const openOrders = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .whereNotIn('status', ['Paid', 'Voided', 'Refunded'])
          .select(['id', 'status', 'created_at', 'payload'])
          .orderBy('created_at', 'desc')
          .limit(1000);

        const openByTableId = new Map();
        for (const o of openOrders || []) {
          const p = safeJsonParse(o?.payload, null);
          const tId = typeof p?.tableId === 'string' ? p.tableId.trim() : typeof p?.table_id === 'string' ? p.table_id.trim() : '';
          if (!tId) continue;
          if (openByTableId.has(tId)) continue; // already have newest due to desc order
          openByTableId.set(tId, { id: String(o?.id || ''), status: String(o?.status || '').trim() });
        }

        const effective = (rows || []).map((r) => {
          const tId = String(r?.id || '').trim();
          if (!tId) return r;
          const open = openByTableId.get(tId);
          if (!open || !open.id) {
            return {
              ...r,
              status: 'Free',
              open_order_id: null,
            };
          }
          return {
            ...r,
            status: mapTableStatusFromOrderStatus(open.status),
            open_order_id: open.id,
            last_order_id: open.id,
          };
        });

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, tables: effective.map(mapRestaurantTableRow).filter(Boolean) });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/tables',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name_required' });

        let id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : '';
        if (!id) {
          const existingByName = await db()
            .from('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, name })
            .select(['id'])
            .first();
          id = existingByName?.id ? String(existingByName.id) : uid('tbl');
        }

        const nowIso = new Date().toISOString();
        await db()
          .from('restaurant_tables')
          .insert({
            tenant_id: req.tenant.id,
            branch_id: branchId,
            id,
            name,
            area: typeof body?.area === 'string' && body.area.trim() ? body.area.trim() : null,
            status: typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Free',
            seats: Number.isFinite(Number(body?.seats)) ? Number(body.seats) : 4,
            open_order_id: null,
            last_order_id: null,
            assigned_staff_id: typeof body?.assignedStaffId === 'string' && body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null,
            assigned_staff_name: typeof body?.assignedStaffName === 'string' && body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null,
            updated_at: nowIso,
          })
          .onConflict(['tenant_id', 'branch_id', 'id'])
          .merge({
            name,
            area: typeof body?.area === 'string' && body.area.trim() ? body.area.trim() : null,
            status: typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Free',
            seats: Number.isFinite(Number(body?.seats)) ? Number(body.seats) : 4,
            assigned_staff_id: typeof body?.assignedStaffId === 'string' && body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null,
            assigned_staff_name: typeof body?.assignedStaffName === 'string' && body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null,
            updated_at: nowIso,
          });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.upserted', data: { tableId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    });

  r.put(
    '/pos/tables/:id/assign',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const patch = {};

        if (typeof body?.assignedStaffId === 'string') {
          patch.assigned_staff_id = body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null;
        }
        if (typeof body?.assignedStaffName === 'string') {
          patch.assigned_staff_name = body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null;
        }

        const nowIso = new Date().toISOString();
        patch.updated_at = nowIso;

        const updated = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update(patch);
        if (!updated) return res.status(404).json({ error: 'table_not_found' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.updated', data: { tableId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.delete(
    '/pos/tables/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });
        if (!row) return res.status(404).json({ error: 'table_not_found' });
        if (row.open_order_id) return res.status(409).json({ error: 'table_has_open_order' });

        await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .del();

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.deleted', data: { tableId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, deleted: true });
      } catch (e) {
        return next(e);
      }
    });

  r.put(
    '/pos/tables/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const patch = {};
        if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim();
        if (body?.area == null) patch.area = null;
        if (typeof body?.area === 'string' && body.area.trim()) patch.area = body.area.trim();
        if (typeof body?.status === 'string' && body.status.trim()) patch.status = body.status.trim();
        if (Number.isFinite(Number(body?.seats))) patch.seats = Number(body.seats);

        if (typeof body?.assignedStaffId === 'string') {
          patch.assigned_staff_id = body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null;
        }
        if (typeof body?.assignedStaffName === 'string') {
          patch.assigned_staff_name = body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null;
        }
        if (typeof body?.openOrderId === 'string') {
          patch.open_order_id = body.openOrderId.trim() ? body.openOrderId.trim() : null;
        }
        if (typeof body?.lastOrderId === 'string') {
          patch.last_order_id = body.lastOrderId.trim() ? body.lastOrderId.trim() : null;
        }

        const nowIso = new Date().toISOString();
        patch.updated_at = nowIso;

        const updated = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update(patch);
        if (!updated) return res.status(404).json({ error: 'table_not_found' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.updated', data: { tableId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        setNoStore(res);

        const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 100) || 100));
        const light = (() => {
          const raw = String(req.query?.light || '').trim().toLowerCase();
          return raw === '1' || raw === 'true' || raw === 'yes';
        })();

        let q = db()
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'created_at',
            'paid_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
            'updated_at',
          ])
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId });
        if (status) q = q.andWhere({ status });
        q = q.orderBy('created_at', 'desc').limit(limit);

        const rows = await q;

        const orderIds = rows.map((r0) => String(r0.id || '')).filter(Boolean);
        const itemRows = !light && orderIds.length
          ? await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId }).whereIn('order_id', orderIds)
          : [];
        const splitRows = !light && orderIds.length
          ? await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId }).whereIn('order_id', orderIds)
          : [];
        const splitItemRows = !light && orderIds.length
          ? await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId }).whereIn('order_id', orderIds)
          : [];
        const paymentRows = !light && orderIds.length
          ? await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId }).whereIn('order_id', orderIds)
          : [];

        const itemsByOrder = new Map();
        for (const it of itemRows) {
          const oid = String(it.order_id || '').trim();
          if (!oid) continue;
          const list = itemsByOrder.get(oid) || [];
          list.push(it);
          itemsByOrder.set(oid, list);
        }
        const splitsByOrder = new Map();
        for (const s of splitRows) {
          const oid = String(s.order_id || '').trim();
          if (!oid) continue;
          const list = splitsByOrder.get(oid) || [];
          list.push(s);
          splitsByOrder.set(oid, list);
        }
        const splitItemsByOrder = new Map();
        for (const si of splitItemRows) {
          const oid = String(si.order_id || '').trim();
          if (!oid) continue;
          const list = splitItemsByOrder.get(oid) || [];
          list.push(si);
          splitItemsByOrder.set(oid, list);
        }
        const paymentsByOrder = new Map();
        for (const p0 of paymentRows) {
          const oid = String(p0.order_id || '').trim();
          if (!oid) continue;
          const list = paymentsByOrder.get(oid) || [];
          list.push(p0);
          paymentsByOrder.set(oid, list);
        }

        const orders = rows.map((row) => {
          const payloadFallback = safeJsonParse(row.payload, null);
          const discountPct = (() => {
            const v = payloadFallback?.discountPct;
            return v == null ? 0 : Number(v || 0) || 0;
          })();
          return {
            id: row.id,
            status: row.status,
            total: Number(row.total || 0) || 0,
            tax: Number(row.tax || 0) || 0,
            tip: Number(row.tip || 0) || 0,
            discount: Number(row.discount || 0) || 0,
            discountPct,
            createdAt: row.created_at,
            paidAt: row.paid_at,
            payload: light
              ? payloadFallback
              : hydratePayloadFromNormalized({
                orderRow: row,
                payloadFallback,
                itemRows: itemsByOrder.get(String(row.id)) || [],
                splitRows: splitsByOrder.get(String(row.id)) || [],
                splitItemRows: splitItemsByOrder.get(String(row.id)) || [],
                paymentRows: paymentsByOrder.get(String(row.id)) || [],
              }),
          };
        });

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, orders });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        setNoStore(res);

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const beforeRow = await db()
          .select(['status', 'payload'])
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .first();
        if (!beforeRow) return res.status(404).json({ error: 'order_not_found' });
        const beforeStatus = String(beforeRow.status || '').trim();

        const row = await db()
          .select([
            'id',
            'status',
            'total',
            'tax',
            'tip',
            'discount',
            'created_at',
            'paid_at',
            'payload',
            'display_number',
            'table_id',
            'table_name',
            'created_by_staff_id',
            'created_by_name',
            'paid_by_staff_id',
            'paid_by_name',
            'payment_method',
            'payment_reference',
            'tendered_amount',
            'notes',
            'updated_at',
          ])
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .first();

        if (!row) return res.status(404).json({ error: 'order_not_found' });

        const itemRows = await db().from('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id });
        const splitRows = await db().from('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id });
        const splitItemRows = await db().from('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id });
        const paymentRows = await db().from('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id });

        const order = {
          id: row.id,
          status: row.status,
          total: Number(row.total || 0) || 0,
          tax: Number(row.tax || 0) || 0,
          tip: Number(row.tip || 0) || 0,
          discount: Number(row.discount || 0) || 0,
          discountPct: (() => {
            const p = safeJsonParse(row.payload, null);
            const v = p?.discountPct;
            return v == null ? 0 : Number(v || 0) || 0;
          })(),
          createdAt: row.created_at,
          paidAt: row.paid_at,
          payload: hydratePayloadFromNormalized({ orderRow: row, payloadFallback: safeJsonParse(row.payload, null), itemRows, splitRows, splitItemRows, paymentRows }),
        };

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, order });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders/:id/receipt-link',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).select(['id']).first();
        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const nowIso = new Date().toISOString();
        const existing = await db()
          .from('pos_public_order_links')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, purpose: 'receipt' })
          .andWhere((b) => b.whereNull('expires_at').orWhere('expires_at', '>', nowIso))
          .orderBy('created_at', 'desc')
          .select(['token'])
          .first();

        const baseUrl = req.protocol + '://' + req.get('host');
        if (existing?.token) {
          return res.json({ ok: true, receiptUrl: `${baseUrl}/r/${encodeURIComponent(String(existing.token))}` });
        }

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        const receiptToken = uid('rcp');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db().from('pos_public_order_links').insert({
          id: uid('pol'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: id,
          token: receiptToken,
          purpose: 'receipt',
          expires_at: expiresAt,
          meta_json: JSON.stringify({ createdByRole: role, createdByStaffId: staffId || null }),
          created_at: nowIso,
          updated_at: nowIso,
        });

        return res.json({ ok: true, receiptUrl: `${baseUrl}/r/${encodeURIComponent(receiptToken)}` });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/orders/:id/display-link',
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

        const orderRow = await db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).select(['id']).first();
        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        const nowIso = new Date().toISOString();
        const existing = await db()
          .from('pos_public_order_links')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, purpose: 'display' })
          .andWhere((b) => b.whereNull('expires_at').orWhere('expires_at', '>', nowIso))
          .orderBy('created_at', 'desc')
          .select(['id', 'token', 'order_id', 'meta_json'])
          .first();

        const baseUrl = publicBaseUrlFromReq(req);
        if (existing?.token) {
          const existingOrderId = String(existing.order_id || '').trim();
          if (existingOrderId !== id) {
            const meta = safeJsonParse(existing.meta_json, {});
            const nextMeta = { ...(meta && typeof meta === 'object' ? meta : {}), mode: 'payment' };
            await db().from('pos_public_order_links').where({ id: existing.id }).update({
              order_id: id,
              meta_json: JSON.stringify(nextMeta),
              updated_at: nowIso,
            });
          }
          return res.json({ ok: true, displayUrl: `${baseUrl}/d/${encodeURIComponent(String(existing.token))}` });
        }

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        const displayToken = shortToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db().from('pos_public_order_links').insert({
          id: uid('pol'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: id,
          token: displayToken,
          purpose: 'display',
          expires_at: expiresAt,
          meta_json: JSON.stringify({ createdByRole: role, createdByStaffId: staffId || null, mode: 'payment' }),
          created_at: nowIso,
          updated_at: nowIso,
        });

        return res.json({ ok: true, displayUrl: `${baseUrl}/d/${encodeURIComponent(displayToken)}` });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/notifications',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 100) || 100));

        const rows = await db()
          .from({ a: 'audit_log' })
          .leftJoin({ nr: 'notification_reads' }, function joinReads() {
            this.on('nr.notification_id', '=', 'a.id')
              .andOn('nr.tenant_id', '=', 'a.tenant_id')
              .andOn('nr.staff_id', '=', db().raw('?', [staffId]));
          })
          .where({ 'a.tenant_id': req.tenant.id, 'a.branch_id': branchId })
          .select(['a.id', 'a.type', 'a.summary', 'a.payload_json', 'a.created_at', 'nr.read_at'])
          .orderBy('a.created_at', 'desc')
          .limit(limit);

        const raw = rows
          .map((r0) => {
            const n = mapAuditToNotification(r0);
            if (!n) return null;
            return { ...n, read: !!r0.read_at };
          })
          .filter(Boolean);

        // De-dupe: collapse repeated notifications so one action doesn't spam the feed.
        // Strategy:
        // - For status updates: keep only the most recent per (orderId + status)
        // - For payments: keep only the most recent per (orderId + paymentRef/splitId/paymentMethod)
        // - For voids: keep only the most recent per orderId
        const deduped = [];
        const seen = new Set();
        for (const n of raw) {
          const action = String(n.action || '').trim();
          const orderId = String(n.orderId || '').trim();
          const meta = n.meta && typeof n.meta === 'object' ? n.meta : {};

          let key = n.id;
          if (action === 'order.status_changed') {
            key = `order.status_changed:${orderId}:${String(meta?.status || '').trim()}`;
          } else if (action === 'payment.recorded') {
            key = `payment.recorded:${orderId}:${String(meta?.splitId || '').trim()}:${String(meta?.paymentReference || '').trim()}:${String(meta?.paymentMethod || '').trim()}`;
          } else if (action === 'order.voided') {
            key = `order.voided:${orderId}`;
          } else if (action === 'order.item_voided') {
            key = `order.item_voided:${orderId}:${String(meta?.productId || '').trim()}:${String(meta?.qty || '').trim()}:${String(meta?.reason || '').trim()}`;
          } else if (action === 'order.placed') {
            key = `order.placed:${orderId}`;
          }

          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          deduped.push(n);
        }

        const notifications = deduped.filter((n) => n && n.id && n.createdAt);

        return res.json({ ok: true, branchId, notifications });
      } catch (e) {
        return next(e);
      }
    });

  r.put(
    '/pos/notifications/:id/read',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const notificationId = String(req.params?.id || '').trim();
        if (!notificationId) return res.status(400).json({ error: 'id_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : null;
        const read = body?.read === false ? false : true;

        if (!read) {
          await db().from('notification_reads').where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId }).del();
          return res.json({ ok: true, read: false });
        }

        const nowIso = new Date().toISOString();
        const existing = await db()
          .from('notification_reads')
          .where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId })
          .select(['id'])
          .first();

        if (existing && existing.id) {
          await db().from('notification_reads').where({ tenant_id: req.tenant.id, id: String(existing.id) }).update({ read_at: nowIso });
          return res.json({ ok: true, read: true });
        }

        await db().from('notification_reads').insert({ id: uid('nr'), tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId, read_at: nowIso });
        return res.json({ ok: true, read: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/notifications/read_all',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 200) || 200));

        const ids = await db()
          .from('audit_log')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .select(['id'])
          .orderBy('created_at', 'desc')
          .limit(limit);

        const nowIso = new Date().toISOString();
        for (const r0 of ids) {
          const notificationId = String(r0?.id || '').trim();
          if (!notificationId) continue;
          const exists = await db()
            .from('notification_reads')
            .where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId })
            .select(['id'])
            .first();
          if (exists && exists.id) continue;
          await db().from('notification_reads').insert({ id: uid('nr'), tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId, read_at: nowIso });
        }

        return res.json({ ok: true, read: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/orders',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    validateCreateOrderBody,
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.create'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const body = req.posOrderBody || (req.body && typeof req.body === 'object' ? req.body : null);
        const payload = req.posOrderPayload || {};
        const status = typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Pending';

        const tableIdFromPayload =
          typeof payload?.tableId === 'string'
            ? payload.tableId.trim()
            : typeof payload?.table_id === 'string'
              ? payload.table_id.trim()
              : '';

        let resolvedTableRow = null;

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });

          const tableId = tableIdFromPayload;
          if (!tableId) return res.status(400).json({ error: 'table_required' });

          await backfillRestaurantTablesFromLegacyState({ tenantId: req.tenant.id, branchId });
          let table = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId });
          if (!table) return res.status(404).json({ error: 'table_not_found' });
          resolvedTableRow = table;

          const assigned = table?.assigned_staff_id ? String(table.assigned_staff_id) : '';
          if (assigned && assigned !== staffId) return res.status(403).json({ error: 'table_assigned_to_other' });

          const staffRow = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId }).first();
          const waiterName = staffRow?.name ? String(staffRow.name) : '';

          payload.tableId = tableId;
          if (!payload.tableName && table?.name) payload.tableName = String(table.name);
          payload.createdByStaffId = staffId;
          payload.createdByName = waiterName || payload.createdByName || null;
        }

        const tip = Number(body?.tip || 0) || 0;
        const discount = Number(body?.discount || 0) || 0;
        const discountPct = body?.discountPct != null ? Number(body.discountPct) : undefined;

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });

        const thresholdPct = Math.max(0, Math.min(90, Number(settings?.policies?.maxDiscountPctWithoutApproval ?? 10) || 0));
        const hasPct = Number.isFinite(Number(discountPct));
        const requestedPct = hasPct ? Math.max(0, Math.min(90, Number(discountPct))) : 0;
        const needsApproval = hasPct ? requestedPct > thresholdPct : discount > 0 ? discount > (Number.isFinite(Number(payload?.subtotal)) ? Number(payload.subtotal) : 0) * (thresholdPct / 100) : false;
        const requireApprovalPin = needsApproval && settings?.security?.requirePinForDiscounts;

        if (requireApprovalPin) {
          const ok = await verifyManagerOrOwnerPin({ tenantId: req.tenant.id, branchId, pin: body?.pin });
          if (!ok) return res.status(401).json({ error: 'pin_required' });
        }

        const splits = Array.isArray(payload?.splits) ? payload.splits : null;
        if (splits && splits.length > 0 && !settings.payments.allowSplitPayments) {
          return res.status(402).json({ error: 'split_payments_disabled' });
        }

        const computed = computeOrderTotalsFromPayload({ payload, tip, discount, discountPct, settings, allowOverMax: requireApprovalPin });
        const total = computed.total;
        const tax = computed.tax;

        const nextPayload = {
          ...(payload && typeof payload === 'object' ? payload : {}),
          subtotal: computed.subtotal,
          tax: computed.tax,
          serviceCharge: computed.serviceCharge,
          discount: computed.discount,
          discountPct: computed.discountPct,
          tip: computed.tip,
          total: computed.total,
        };

        // Deduct inventory when creating a paid order (idempotent via payload.inventoryDeductedAt).
        if (status === 'Paid' && !nextPayload.inventoryDeductedAt) {
          try {
            await applyInventoryDeductionForOrder({ tenantId: req.tenant.id, branchId, payload: nextPayload });
            nextPayload.inventoryDeductedAt = new Date().toISOString();
          } catch {
            // ignore inventory deduction failures (do not block payment)
          }
        }

        // Enforce enabled payment method when marking paid.
        if (status === 'Paid') {
          const pm = methodToSettingId(nextPayload?.paymentMethod);
          if (pm) {
            const list = Array.isArray(settings.payments.methods) ? settings.payments.methods : [];
            const enabled = list.find((x) => x && typeof x === 'object' && String(x.id) === pm)?.enabled;
            if (enabled === false) return res.status(402).json({ error: 'payment_method_disabled', method: pm });

            if (referenceRequiredForMethod(settings, pm)) {
              const ref = normalizePaymentReference(nextPayload?.paymentReference);
              if (!ref) return res.status(400).json({ error: 'payment_reference_required', method: pm });
              nextPayload.paymentReference = ref;
            } else if (typeof nextPayload?.paymentReference === 'string' && nextPayload.paymentReference.trim()) {
              nextPayload.paymentReference = normalizePaymentReference(nextPayload.paymentReference);
            }
          }
        }

        const requestedId = typeof body?.id === 'string' ? body.id.trim() : '';
        const id = requestedId || uid('ord');
        const nowIso = new Date().toISOString();

        const normalizedCols = normalizeOrderColsFromPayload({ payload: nextPayload, status, nowIso });
        const orderItemRows = normalizeItemsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, payload: nextPayload, nowIso });
        const splitRows = normalizeSplitsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, payload: nextPayload, nowIso });
        const splitItemRows = normalizeSplitItemsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, splitRows, orderItemRows, payload: nextPayload, nowIso });
        const paymentRows = normalizePaymentsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, status, payload: nextPayload, nowIso });

        const redeemAmount = status === 'Paid'
          ? computeLoyaltyRedeemAmount({ payload: nextPayload, paymentMethod: nextPayload?.paymentMethod, computed })
          : 0;
        if (status === 'Paid' && redeemAmount > 0) {
          const customerId = String(nextPayload?.customer?.id || '').trim();
          if (!customerId) return res.status(400).json({ error: 'customer_required' });
          const row = await db()
            .from('customers')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
            .select(['loyalty_balance'])
            .first();
          if (!row) return res.status(404).json({ error: 'customer_not_found' });
          const balance = Number(row?.loyalty_balance ?? 0) || 0;
          if (balance + 1e-9 < redeemAmount) return res.status(402).json({ error: 'insufficient_loyalty_balance' });
        }

        const tableId = tableIdFromPayload;
        const tableNameForEnsure = (() => {
          if (resolvedTableRow?.name) return String(resolvedTableRow.name);
          if (typeof payload?.tableName === 'string' && payload.tableName.trim()) return payload.tableName.trim();
          return tableId;
        })();

        await db().transaction(async (trx) => {
          await trx
            .from('orders')
            .insert({
              id,
              tenant_id: req.tenant.id,
              branch_id: branchId,
              status,
              total,
              tax,
              tip,
              discount: computed.discount,
              created_at: nowIso,
              paid_at: status === 'Paid' ? nowIso : null,
              display_number: normalizedCols.display_number,
              table_id: normalizedCols.table_id,
              table_name: normalizedCols.table_name,
              created_by_staff_id: normalizedCols.created_by_staff_id,
              created_by_name: normalizedCols.created_by_name,
              paid_by_staff_id: normalizedCols.paid_by_staff_id,
              paid_by_name: normalizedCols.paid_by_name,
              payment_method: normalizedCols.payment_method,
              payment_reference: normalizedCols.payment_reference,
              tendered_amount: normalizedCols.tendered_amount,
              notes: normalizedCols.notes,
              updated_at: nowIso,
              payload: JSON.stringify(nextPayload),
            })
            .onConflict(['id'])
            .merge({
              status,
              total,
              tax,
              tip,
              discount: computed.discount,
              paid_at: status === 'Paid' ? nowIso : null,
              display_number: normalizedCols.display_number,
              table_id: normalizedCols.table_id,
              table_name: normalizedCols.table_name,
              created_by_staff_id: normalizedCols.created_by_staff_id,
              created_by_name: normalizedCols.created_by_name,
              paid_by_staff_id: normalizedCols.paid_by_staff_id,
              paid_by_name: normalizedCols.paid_by_name,
              payment_method: normalizedCols.payment_method,
              payment_reference: normalizedCols.payment_reference,
              tendered_amount: normalizedCols.tendered_amount,
              notes: normalizedCols.notes,
              updated_at: nowIso,
              payload: JSON.stringify(nextPayload),
            });

          if (status === 'Paid') {
            await applyLoyaltyForPaidOrder({
              trx,
              tenantId: req.tenant.id,
              branchId,
              orderId: id,
              total: computed.total,
              paymentMethod: nextPayload?.paymentMethod,
              customer: nextPayload?.customer,
              loyaltySettings: settings?.loyalty,
              nowIso,
              redeemAmount,
            });
          }

          // Dual-write: normalized tables (best-effort; do not fail order creation if missing tables during rollout)
          try {
            await trx('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
            await trx('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
            await trx('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
            await trx('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();

            if (orderItemRows.length) await trx('order_items').insert(orderItemRows);
            if (splitRows.length) await trx('order_splits').insert(splitRows);
            if (splitItemRows.length) await trx('order_split_items').insert(splitItemRows);
            if (paymentRows.length) await trx('order_payments').insert(paymentRows);
          } catch {
            // ignore
          }

          const tableId = typeof nextPayload?.tableId === 'string' ? nextPayload.tableId.trim() : '';
          if (tableId) {
            await ensureRestaurantTableRow({ trx, tenantId: req.tenant.id, branchId, tableId, name: tableNameForEnsure, nowIso });
            const terminal = status === 'Paid' || status === 'Voided' || status === 'Refunded';
            const patch = terminal
              ? { status: 'Free', open_order_id: null, last_order_id: id, updated_at: nowIso }
              : { status: mapTableStatusFromOrderStatus(status), open_order_id: id, last_order_id: id, updated_at: nowIso };
            await trx('restaurant_tables')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, id: tableId })
              .update(patch);
          }
        });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.order.created', data: { orderId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, id, createdAt: nowIso });
      } catch (e) {
        return next(e);
      }
    });

  r.put(
    '/pos/orders/:id',
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

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const beforeRow = await db()
          .select(['status', 'payload'])
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .first();
        if (!beforeRow) return res.status(404).json({ error: 'order_not_found' });
        const beforeStatus = String(beforeRow.status || '').trim();

        const body = req.body && typeof req.body === 'object' ? req.body : null;
        const patch = {};

        let existingPayload = null;
        let waiterIsOwner = true;
        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });

          existingPayload = safeJsonParse(beforeRow?.payload, {});

          const existingOwner = typeof existingPayload?.createdByStaffId === 'string' ? String(existingPayload.createdByStaffId) : '';
          waiterIsOwner = Boolean(existingOwner && existingOwner === staffId);
        }

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });

        if (typeof body?.status === 'string' && body.status.trim()) {
          patch.status = body.status.trim();
          if (patch.status === 'Paid') patch.paid_at = new Date().toISOString();
        }

        // If a waiter is not the creator of the order, only allow status-only updates for KDS flow.
        // Prevent cross-waiter modifications of payload, discounts, or payment-related fields.
        if (role === 'Waiter' && !waiterIsOwner) {
          const incomingPayload = body?.payload && typeof body.payload === 'object' ? body.payload : null;
          const hasNonStatusMutation =
            Boolean(incomingPayload) ||
            body?.tip != null ||
            body?.discount != null ||
            body?.discountPct != null ||
            body?.pin != null ||
            body?.paymentReference != null ||
            body?.paymentMethod != null ||
            body?.tenderedAmount != null;

          const nextStatus = typeof patch.status === 'string' ? patch.status : '';
          const allowedStatusOnly = nextStatus === 'Cooking' || nextStatus === 'Ready' || nextStatus === 'Served' || nextStatus === 'Paid';

          if (hasNonStatusMutation || !allowedStatusOnly) {
            return res.status(403).json({ error: 'forbidden' });
          }
        }

        const incomingPayload = body?.payload && typeof body.payload === 'object' ? body.payload : null;
        const tip = body?.tip != null ? Number(body.tip || 0) || 0 : 0;
        const discount = body?.discount != null ? Number(body.discount || 0) || 0 : 0;
        const discountPct = body?.discountPct != null ? Number(body.discountPct) : undefined;

        const thresholdPct = Math.max(0, Math.min(90, Number(settings?.policies?.maxDiscountPctWithoutApproval ?? 10) || 0));
        const hasPct = Number.isFinite(Number(discountPct));
        const requestedPct = hasPct ? Math.max(0, Math.min(90, Number(discountPct))) : 0;
        const needsApproval = hasPct ? requestedPct > thresholdPct : false;
        const requireApprovalPin = needsApproval && settings?.security?.requirePinForDiscounts;

        if (requireApprovalPin) {
          const ok = await verifyManagerOrOwnerPin({ tenantId: req.tenant.id, branchId, pin: body?.pin });
          if (!ok) return res.status(401).json({ error: 'pin_required' });
        }

        if (incomingPayload) {
          if (role === 'Waiter') {
            const nextTableId = typeof incomingPayload?.tableId === 'string' ? incomingPayload.tableId.trim() : typeof incomingPayload?.table_id === 'string' ? incomingPayload.table_id.trim() : '';
            const existingTableId = typeof existingPayload?.tableId === 'string' ? String(existingPayload.tableId).trim() : '';
            if (nextTableId && existingTableId && nextTableId !== existingTableId) return res.status(403).json({ error: 'forbidden' });

            const effectiveTableId = existingTableId || nextTableId;
            if (!effectiveTableId) return res.status(400).json({ error: 'table_required' });

            const tableRow = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: effectiveTableId });
            if (!tableRow) return res.status(404).json({ error: 'table_not_found' });
            const assigned = tableRow?.assigned_staff_id ? String(tableRow.assigned_staff_id) : '';
            if (assigned && assigned !== staffId) return res.status(403).json({ error: 'table_assigned_to_other' });

            const staffRow = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId }).first();
            const waiterName = staffRow?.name ? String(staffRow.name) : '';

            incomingPayload.createdByStaffId = staffId;
            incomingPayload.createdByName = waiterName || incomingPayload.createdByName || null;
            if (existingTableId) incomingPayload.tableId = existingTableId;
            if (tableRow?.name && !incomingPayload.tableName) incomingPayload.tableName = String(tableRow.name);
          }

          // Normalize reference early so it is persisted into payload JSON.
          if (typeof incomingPayload?.paymentReference === 'string' && incomingPayload.paymentReference.trim()) {
            incomingPayload.paymentReference = normalizePaymentReference(incomingPayload.paymentReference);
          }

          const splits = Array.isArray(incomingPayload?.splits) ? incomingPayload.splits : null;
          if (splits && splits.length > 0 && !settings.payments.allowSplitPayments) {
            return res.status(402).json({ error: 'split_payments_disabled' });
          }

          computed = computeOrderTotalsFromPayload({ payload: incomingPayload, tip, discount, discountPct, settings, allowOverMax: requireApprovalPin });
          patch.total = computed.total;
          patch.tax = computed.tax;
          patch.tip = computed.tip;
          patch.discount = computed.discount;
          const payloadWithTotals = {
            ...incomingPayload,
            subtotal: computed.subtotal,
            tax: computed.tax,
            serviceCharge: computed.serviceCharge,
            discount: computed.discount,
            discountPct: computed.discountPct,
            tip: computed.tip,
            total: computed.total,
          };

          const nextStatus = typeof patch.status === 'string' ? patch.status : '';
          const redeemAmount = nextStatus === 'Paid'
            ? computeLoyaltyRedeemAmount({ payload: payloadWithTotals, paymentMethod: payloadWithTotals?.paymentMethod, computed })
            : 0;
          if (nextStatus === 'Paid' && redeemAmount > 0) {
            const customerId = String(payloadWithTotals?.customer?.id || '').trim();
            if (!customerId) return res.status(400).json({ error: 'customer_required' });
            const row = await db()
              .from('customers')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, id: customerId })
              .select(['loyalty_balance'])
              .first();
            if (!row) return res.status(404).json({ error: 'customer_not_found' });
            const balance = Number(row?.loyalty_balance ?? 0) || 0;
            if (balance + 1e-9 < redeemAmount) return res.status(402).json({ error: 'insufficient_loyalty_balance' });
          }
          if (nextStatus === 'Paid') {
            const pm = methodToSettingId(incomingPayload?.paymentMethod);
            if (pm) {
              const list = Array.isArray(settings.payments.methods) ? settings.payments.methods : [];
              const enabled = list.find((x) => x && typeof x === 'object' && String(x.id) === pm)?.enabled;
              if (enabled === false) return res.status(402).json({ error: 'payment_method_disabled', method: pm });

              if (referenceRequiredForMethod(settings, pm)) {
                const ref = normalizePaymentReference(incomingPayload?.paymentReference);
                if (!ref) return res.status(400).json({ error: 'payment_reference_required', method: pm });
                incomingPayload.paymentReference = ref;
              }
            }

            // Deduct inventory once when transitioning to Paid.
            if (!payloadWithTotals.inventoryDeductedAt) {
              try {
                await applyInventoryDeductionForOrder({ tenantId: req.tenant.id, branchId, payload: payloadWithTotals });
                payloadWithTotals.inventoryDeductedAt = new Date().toISOString();
              } catch {
                // ignore inventory deduction failures (do not block payment)
              }
            }
          }

          // Rebuild payload after enforcing required reference, so DB stores correct value.
          patch.payload = JSON.stringify(payloadWithTotals);

          // POS v2 dual-write (normalized tables/cols)
          try {
            const nowIso = new Date().toISOString();
            const effectiveStatus = typeof patch.status === 'string' ? String(patch.status) : beforeStatus;

            const normalizedCols = normalizeOrderColsFromPayload({ payload: payloadWithTotals, status: effectiveStatus, nowIso });
            patch.display_number = normalizedCols.display_number;
            patch.table_id = normalizedCols.table_id;
            patch.table_name = normalizedCols.table_name;
            patch.created_by_staff_id = normalizedCols.created_by_staff_id;
            patch.created_by_name = normalizedCols.created_by_name;
            patch.paid_by_staff_id = normalizedCols.paid_by_staff_id;
            patch.paid_by_name = normalizedCols.paid_by_name;
            patch.payment_method = normalizedCols.payment_method;
            patch.payment_reference = normalizedCols.payment_reference;
            patch.tendered_amount = normalizedCols.tendered_amount;
            patch.notes = normalizedCols.notes;
            patch.updated_at = nowIso;
          } catch {
            // ignore
          }
        }

        if (Object.keys(patch).length === 0) return res.json({ ok: true });

        const updated = await db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
        if (!updated) return res.status(404).json({ error: 'order_not_found' });

        // Dual-write normalized tables only when we received a payload (so we can rebuild items/splits).
        if (incomingPayload && typeof patch.payload === 'string' && patch.payload.trim()) {
          try {
            const nowIso = new Date().toISOString();
            const effectiveStatus = typeof patch.status === 'string' ? String(patch.status) : beforeStatus;
            const payloadObj = safeJsonParse(patch.payload, {}) || {};

            const orderItemRows = normalizeItemsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, payload: payloadObj, nowIso });
            const splitRows = normalizeSplitsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, payload: payloadObj, nowIso });
            const splitItemRows = normalizeSplitItemsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, splitRows, orderItemRows, payload: payloadObj, nowIso });
            const paymentRows = normalizePaymentsFromPayload({ tenantId: req.tenant.id, branchId, orderId: id, status: effectiveStatus, payload: payloadObj, nowIso });

            await db().transaction(async (trx) => {
              await trx('order_payments').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
              await trx('order_split_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
              await trx('order_splits').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();
              await trx('order_items').where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id }).del();

              if (orderItemRows.length) await trx('order_items').insert(orderItemRows);
              if (splitRows.length) await trx('order_splits').insert(splitRows);
              if (splitItemRows.length) await trx('order_split_items').insert(splitItemRows);
              if (paymentRows.length) await trx('order_payments').insert(paymentRows);
            });
          } catch {
            // ignore
          }
        }

        const afterStatus = typeof patch.status === 'string' ? String(patch.status) : beforeStatus;
        const afterPayload = (() => {
          if (typeof patch.payload === 'string' && patch.payload.trim()) return safeJsonParse(patch.payload, {});
          return safeJsonParse(beforeRow?.payload, {});
        })();
        const tableId = typeof afterPayload?.tableId === 'string' ? afterPayload.tableId.trim() : '';
        if (tableId && afterStatus !== beforeStatus) {
          await syncRestaurantTableForOrder({ tenantId: req.tenant.id, branchId, tableId, orderId: id, nextStatus: afterStatus, nowIso: new Date().toISOString() });
        }

        if (afterStatus === 'Paid') {
          const loyaltyTotal = Number(patch.total ?? computed?.total ?? afterPayload?.total ?? 0) || 0;
          const loyaltyCustomer = incomingPayload?.customer ?? afterPayload?.customer;
          const loyaltyMethod = incomingPayload?.paymentMethod ?? afterPayload?.paymentMethod;
          const loyaltyComputed = computed || (() => {
            try {
              return computeOrderTotalsFromPayload({
                payload: afterPayload,
                tip: Number(afterPayload?.tip ?? 0) || 0,
                discount: Number(afterPayload?.discount ?? 0) || 0,
                discountPct: afterPayload?.discountPct,
                settings,
              });
            } catch {
              return null;
            }
          })();
          const redeemAmount = computeLoyaltyRedeemAmount({ payload: afterPayload, paymentMethod: loyaltyMethod, computed: loyaltyComputed });
          try {
            await applyLoyaltyForPaidOrder({
              trx: db(),
              tenantId: req.tenant.id,
              branchId,
              orderId: id,
              total: loyaltyTotal,
              paymentMethod: loyaltyMethod,
              customer: loyaltyCustomer,
              loyaltySettings: settings?.loyalty,
              nowIso: new Date().toISOString(),
              redeemAmount,
            });
          } catch (e) {
            if (String(e?.code || '') === 'insufficient_loyalty_balance' || String(e?.message || '') === 'insufficient_loyalty_balance') {
              return res.status(402).json({ error: 'insufficient_loyalty_balance' });
            }
          }
        }

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.order.updated', data: { orderId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/pos/orders/:id/pay-telebirr',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('payments.process'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
        if (orderRow.status === 'Paid') return res.status(400).json({ error: 'order_already_paid' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        const baseUrl = req.protocol + '://' + req.get('host');
        const notifyUrl = `${baseUrl}/api/webhooks/payment/telebirr`;
        const returnUrl = `${baseUrl}/waiter/pos?orderId=${id}&telebirr=success`;

        const result = await paymentGatewayService.telebirrInitialize({
          amount: orderRow.total,
          outTradeNo: id,
          subject: `Order ${id} Payment`,
          notifyUrl,
          returnUrl,
        });

        return res.json({
          ok: true,
          checkoutUrl: result.checkoutUrl,
          outTradeNo: result.outTradeNo,
        });
      } catch (e) {
        console.error('POS Telebirr pay error:', e);
        return res.status(400).json({ error: 'gateway_error', message: e.message });
      }
    });

  r.post(
    '/pos/orders/:id/pay-chapa',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('payments.process'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
        if (orderRow.status === 'Paid') return res.status(400).json({ error: 'order_already_paid' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        const staff = staffId
          ? await db().select(['name', 'email']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first()
          : null;

        const email = (() => {
          const e = String(staff?.email || '').trim();
          if (e) return e;
          const slug = String(req.tenant?.slug || '').trim().toLowerCase();
          const tid = String(req.tenant?.id || '').trim().toLowerCase();
          const hint = slug || (tid ? tid.slice(0, 8) : 'tenant');
          return `pos-${hint}@mirachpos.local`;
        })();

        const fullName = String(staff?.name || '').trim();
        const firstName = fullName ? fullName.split(' ')[0] : 'Customer';
        const lastName = fullName ? fullName.split(' ').slice(1).join(' ') || 'Customer' : 'Customer';

        const baseUrl = req.protocol + '://' + req.get('host');
        const callbackUrl = `${baseUrl}/api/webhooks/payment/chapa`;
        const returnUrl = `${baseUrl}/waiter/pos?orderId=${id}&chapa=success`;

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const orderPayload = safeJsonParse(orderRow.payload, {});
        const orderNumber = typeof orderPayload?.number === 'string' && orderPayload.number.trim() ? String(orderPayload.number).trim() : '';
        const cafeName = typeof settings?.business?.businessName === 'string' && settings.business.businessName.trim() ? String(settings.business.businessName).trim() : '';

        // Chapa requires tx_ref <= 50 characters.
        // Keep it deterministic enough to associate to the order, but compact.
        const shortOrder = String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || String(id).slice(0, 12);
        const rand = Math.random().toString(16).slice(2, 10);
        const txRef = `pos_${shortOrder}_${rand}`;
        const init = await paymentGatewayService.chapaInitializeForTenantPos({
          tenantId: req.tenant.id,
          amount: orderRow.total,
          currency: 'ETB',
          email,
          firstName,
          lastName,
          txRef,
          callbackUrl,
          returnUrl,
          customization: {
            title: sanitizeChapaText(cafeName) || 'MirachPOS',
            description:
              sanitizeChapaText(orderNumber ? `Order ${orderNumber}` : `Order ${id}`) +
              ' . Powered by MirachPOS',
          },
        });

        const nowIso = new Date().toISOString();
        const expiryMs = 5 * 60 * 1000;
        const expiresAt = new Date(Date.now() + expiryMs).toISOString();

        await db().from('pos_payment_gateway_transactions').insert({
          id: uid('pgt'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: id,
          gateway: 'chapa',
          method: 'mobile_money',
          tx_ref: txRef,
          gateway_tx_id: null,
          checkout_url: init.checkoutUrl,
          amount: orderRow.total,
          currency: 'ETB',
          status: 'pending',
          expires_at: expiresAt,
          paid_at: null,
          init_response_json: JSON.stringify(init),
          verify_response_json: null,
          webhook_payload_json: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        return res.json({ ok: true, checkoutUrl: init.checkoutUrl, txRef });
      } catch (e) {
        const err = String(e?.message || e || '').trim();
        if (err === 'tenant_chapa_not_configured') {
          return res.status(400).json({ error: 'tenant_chapa_not_configured', message: 'This cafe has not configured Chapa for POS payments.' });
        }
        console.error('POS Chapa pay error:', e);
        const msg = (() => {
          const raw = e && typeof e === 'object' ? e.message : '';
          if (typeof raw === 'string' && raw.trim()) return raw;
          try {
            return JSON.stringify(raw);
          } catch {
            try {
              return String(raw || 'gateway_error');
            } catch {
              return 'gateway_error';
            }
          }
        })();
        return res.status(400).json({ error: 'gateway_error', message: msg });
      }
    });

  r.post(
    '/pos/orders/:id/pay-santimpay',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('payments.process'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
        if (orderRow.status === 'Paid') return res.status(400).json({ error: 'order_already_paid' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const orderPayload = safeJsonParse(orderRow.payload, {});
        const orderNumber = typeof orderPayload?.number === 'string' && orderPayload.number.trim() ? String(orderPayload.number).trim() : '';
        const cafeName = typeof settings?.business?.businessName === 'string' && settings.business.businessName.trim() ? String(settings.business.businessName).trim() : '';

        const baseUrl = req.protocol + '://' + req.get('host');
        const notifyUrl = `${baseUrl}/api/webhooks/payment/santimpay`;
        const successRedirectUrl = `${baseUrl}/waiter/pos?orderId=${id}&santimpay=success`;
        const failureRedirectUrl = `${baseUrl}/waiter/pos?orderId=${id}&santimpay=failed`;

        const shortOrder = String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || String(id).slice(0, 12);
        const rand = Math.random().toString(16).slice(2, 10);
        const txRef = `pos_${shortOrder}_${rand}`;

        const init = await paymentGatewayService.santimpayInitializeForTenantPos({
          tenantId: req.tenant.id,
          id: txRef,
          amount: orderRow.total,
          reason: `${cafeName || 'MirachPOS'} ${orderNumber ? `Order ${orderNumber}` : `Order ${id}`}`,
          notifyUrl,
          successRedirectUrl,
          failureRedirectUrl,
          cancelRedirectUrl: failureRedirectUrl,
        });

        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        await db().from('pos_payment_gateway_transactions').insert({
          id: uid('pgt'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: id,
          gateway: 'santimpay',
          method: 'mobile_money',
          tx_ref: txRef,
          gateway_tx_id: null,
          checkout_url: init.checkoutUrl,
          amount: orderRow.total,
          currency: 'ETB',
          status: 'pending',
          expires_at: expiresAt,
          paid_at: null,
          init_response_json: JSON.stringify(init),
          verify_response_json: null,
          webhook_payload_json: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        return res.json({ ok: true, checkoutUrl: init.checkoutUrl, txRef });
      } catch (e) {
        const err = String(e?.message || e || '').trim();
        if (err === 'tenant_santimpay_not_configured') {
          return res.status(400).json({ error: 'tenant_santimpay_not_configured', message: 'This cafe has not configured SantimPay for POS payments.' });
        }
        if (err === 'tenant_santimpay_invalid_private_key') {
          return res.status(400).json({ error: 'tenant_santimpay_invalid_private_key', message: 'SantimPay private key is invalid (expected PEM format).' });
        }
        console.error('POS SantimPay pay error:', e);
        return res.status(400).json({ error: 'gateway_error', message: err || 'gateway_error' });
      }
    });

  r.post(
    '/pos/orders/:id/pay-chapa-link',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('payments.process'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload', 'paid_at'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
        if (orderRow.status === 'Paid') return res.status(400).json({ error: 'order_already_paid' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        const settings = await resolveEffectivePosSettings({ tenantId: req.tenant.id, branchId });
        const orderPayload = safeJsonParse(orderRow.payload, {});
        const orderNumber = typeof orderPayload?.number === 'string' && orderPayload.number.trim() ? String(orderPayload.number).trim() : '';
        const cafeName = typeof settings?.business?.businessName === 'string' && settings.business.businessName.trim() ? String(settings.business.businessName).trim() : '';

        const baseUrl = publicBaseUrlFromReq(req);

        const payerToken = shortToken();
        const receiptToken = shortToken();
        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await db().from('pos_public_order_links').insert([
          {
            id: uid('pol'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            order_id: id,
            token: payerToken,
            purpose: 'payer',
            expires_at: expiresAt,
            meta_json: JSON.stringify({ createdByRole: role, createdByStaffId: staffId || null }),
            created_at: nowIso,
            updated_at: nowIso,
          },
          {
            id: uid('pol'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            order_id: id,
            token: receiptToken,
            purpose: 'receipt',
            expires_at: expiresAt,
            meta_json: JSON.stringify({ createdByRole: role, createdByStaffId: staffId || null }),
            created_at: nowIso,
            updated_at: nowIso,
          },
        ]);

        return res.json({
          ok: true,
          payerUrl: `${baseUrl}/p/${encodeURIComponent(payerToken)}`,
          receiptUrl: `${baseUrl}/r/${encodeURIComponent(receiptToken)}`,
          cafeName: cafeName || 'MirachPOS',
          orderNumber: orderNumber || id,
        });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders/:id/payment-status',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'total', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        if (orderRow.status === 'Paid') {
          return res.json({ ok: true, paid: true });
        }

        // Check with gateway if not already paid in DB
        try {
          const verify = await paymentGatewayService.telebirrVerify(id);
          if (verify.success) {
            // Update order to Paid
            const nowIso = new Date().toISOString();
            const payload = safeJsonParse(orderRow.payload, {});
            payload.paidAt = nowIso;
            payload.paymentMethod = 'Telebirr';
            if (req.auth?.staffId && !payload.paidByStaffId) payload.paidByStaffId = String(req.auth.staffId);
            if (req.auth?.staffName && !payload.paidByName) payload.paidByName = String(req.auth.staffName);
            payload.telebirrVerifyResponse = verify.rawResponse;

            await db()
              .from('orders')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
              .update({
                status: 'Paid',
                paid_at: nowIso,
                payload: JSON.stringify(payload),
              });

            const tableId = typeof payload?.tableId === 'string' ? payload.tableId.trim() : '';
            if (tableId) {
              await syncRestaurantTableForOrder({ tenantId: req.tenant.id, branchId, tableId, orderId: id, nextStatus: 'Paid', nowIso });
            }

            return res.json({ ok: true, paid: true });
          }
        } catch (verifyError) {
          console.error('Telebirr verify error in POS route:', verifyError);
        }

        return res.json({ ok: true, paid: false });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders/:id/payment-status-santimpay',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        if (orderRow.status === 'Paid') {
          return res.json({ ok: true, paid: true });
        }

        const tx = await db()
          .from('pos_payment_gateway_transactions')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, gateway: 'santimpay' })
          .orderBy('created_at', 'desc')
          .select(['tx_ref', 'status', 'expires_at', 'paid_at'])
          .first();

        if (!tx?.tx_ref) return res.json({ ok: true, paid: false });
        if (String(tx.status || '') === 'completed') return res.json({ ok: true, paid: true });

        try {
          const verify = await paymentGatewayService.santimpayVerifyForTenantPos({ tenantId: req.tenant.id, id: String(tx.tx_ref) });
          if (verify?.success) {
            const nowIso = new Date().toISOString();
            const payload = safeJsonParse(orderRow.payload, {});
            payload.paidAt = nowIso;
            payload.paymentMethod = 'SantimPay';
            if (req.auth?.staffId && !payload.paidByStaffId) payload.paidByStaffId = String(req.auth.staffId);
            if (req.auth?.staffName && !payload.paidByName) payload.paidByName = String(req.auth.staffName);
            payload.santimpayTxRef = String(tx.tx_ref);
            payload.santimpayVerifyResponse = verify.raw;

            await db()
              .from('orders')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
              .update({
                status: 'Paid',
                paid_at: nowIso,
                payload: JSON.stringify(payload),
              });

            await db()
              .from('pos_payment_gateway_transactions')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, gateway: 'santimpay', tx_ref: String(tx.tx_ref) })
              .update({
                status: 'completed',
                paid_at: nowIso,
                verify_response_json: JSON.stringify(verify),
                updated_at: nowIso,
              });

            return res.json({ ok: true, paid: true });
          }
        } catch (e) {
          const err = String(e?.message || e || '').trim();
          if (err === 'tenant_santimpay_not_configured') {
            return res.status(400).json({ ok: false, error: 'tenant_santimpay_not_configured', message: 'This cafe has not configured SantimPay for POS payments.' });
          }
        }

        return res.json({ ok: true, paid: false });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/pos/orders/:id/payment-status-chapa',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const orderRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'payload'])
          .first();

        if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

        if (role === 'Waiter') {
          if (!staffId) return res.status(401).json({ error: 'unauthorized' });
          const payload = safeJsonParse(orderRow.payload, {});
          const createdBy = typeof payload?.createdByStaffId === 'string' ? String(payload.createdByStaffId) : '';
          if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
        }

        if (orderRow.status === 'Paid') {
          return res.json({ ok: true, paid: true });
        }

        const tx = await db()
          .from('pos_payment_gateway_transactions')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, gateway: 'chapa' })
          .orderBy('created_at', 'desc')
          .select(['tx_ref', 'status', 'expires_at', 'paid_at'])
          .first();

        if (!tx?.tx_ref) return res.json({ ok: true, paid: false });
        if (String(tx.status || '') === 'completed') return res.json({ ok: true, paid: true });

        try {
          const verify = await paymentGatewayService.chapaVerifyForTenantPos({ tenantId: req.tenant.id, txRef: String(tx.tx_ref) });
          if (verify?.success && String(verify?.status || '').toLowerCase() === 'success') {
            // Update order + transaction (webhook may not reach localhost in dev)
            const nowIso = new Date().toISOString();
            const payload = safeJsonParse(orderRow.payload, {});
            payload.paidAt = nowIso;
            payload.paymentMethod = 'Mobile Pay';
            if (req.auth?.staffId && !payload.paidByStaffId) payload.paidByStaffId = String(req.auth.staffId);
            if (req.auth?.staffName && !payload.paidByName) payload.paidByName = String(req.auth.staffName);
            payload.chapaTxRef = String(tx.tx_ref);
            payload.chapaVerifyResponse = verify.rawResponse;

            await db()
              .from('orders')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
              .update({
                status: 'Paid',
                paid_at: nowIso,
                payload: JSON.stringify(payload),
              });

            await db()
              .from('pos_payment_gateway_transactions')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: id, gateway: 'chapa', tx_ref: String(tx.tx_ref) })
              .update({
                status: 'completed',
                paid_at: nowIso,
                verify_response_json: JSON.stringify(verify),
                updated_at: nowIso,
              });

            return res.json({ ok: true, paid: true });
          }
        } catch (e) {
          const err = String(e?.message || e || '').trim();
          if (err === 'tenant_chapa_not_configured') {
            return res.status(400).json({ ok: false, error: 'tenant_chapa_not_configured', message: 'This cafe has not configured Chapa for POS payments.' });
          }
        }

        return res.json({ ok: true, paid: false });
      } catch (e) {
        return next(e);
      }
    });

  return r;
};

module.exports = { makePosRouter };
