const express = require('express');
const net = require('net');
const bcrypt = require('bcryptjs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');
const { makeInitialPosState } = require('./posInitPreset');
const paymentGatewayService = require('../services/paymentGatewayService');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
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

const makeReceiptPayloadFromOrder = ({ orderRow }) => {
  const payload = safeJsonParse(orderRow?.payload, {});
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const number = String(payload?.number || payload?.orderNumber || orderRow?.id || '').trim();
  const tableName = String(payload?.tableName || payload?.table || '').trim();
  const cashier = String(payload?.createdByName || payload?.cashierName || '').trim();

  const total = Number(orderRow?.total || 0) || 0;
  const tax = Number(orderRow?.tax || 0) || 0;
  const discount = Number(orderRow?.discount || 0) || 0;
  const tip = Number(orderRow?.tip || 0) || 0;

  const paidAt = orderRow?.paid_at ? new Date(orderRow.paid_at) : null;

  const lines = [];
  lines.push(escInit);
  lines.push(escAlignCenter);
  lines.push(escBoldOn);
  lines.push(txt('CASH INVOICE'));
  lines.push(escBoldOff);
  lines.push(nl());
  lines.push(nl());

  lines.push(escAlignLeft);
  lines.push(txt(`Order: ${number || String(orderRow?.id || '')}`));
  lines.push(nl());
  if (tableName) {
    lines.push(txt(`Table: ${tableName}`));
    lines.push(nl());
  }
  if (cashier) {
    lines.push(txt(`Cashier: ${cashier}`));
    lines.push(nl());
  }
  if (paidAt) {
    lines.push(txt(`Paid: ${paidAt.toLocaleString()}`));
    lines.push(nl());
  }
  lines.push(nl());

  lines.push(txt('Item            Qty   Price'));
  lines.push(nl());
  lines.push(txt('----------------------------'));
  lines.push(nl());

  for (const it of items.slice(0, 200)) {
    const name = String(it?.name || it?.productName || it?.productId || '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    const unitPrice = Number(it?.unitPrice ?? it?.price ?? 0) || 0;
    const line = `${name}`.slice(0, 14).padEnd(14) + String(qty).slice(0, 3).padStart(4) + String(unitPrice.toFixed(2)).slice(0, 8).padStart(8);
    lines.push(txt(line));
    lines.push(nl());
  }

  lines.push(txt('----------------------------'));
  lines.push(nl());
  lines.push(txt(`Subtotal            ${(total - tax - tip + discount).toFixed(2)}`));
  lines.push(nl());
  if (discount > 0.0001) {
    lines.push(txt(`Discount            ${discount.toFixed(2)}`));
    lines.push(nl());
  }
  if (tax > 0.0001) {
    lines.push(txt(`Tax                 ${tax.toFixed(2)}`));
    lines.push(nl());
  }
  if (tip > 0.0001) {
    lines.push(txt(`Tip                 ${tip.toFixed(2)}`));
    lines.push(nl());
  }
  lines.push(escBoldOn);
  lines.push(txt(`TOTAL               ${total.toFixed(2)}`));
  lines.push(escBoldOff);
  lines.push(nl());
  lines.push(nl());

  lines.push(escAlignCenter);
  lines.push(txt('Powered by Mirach POS'));
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

const normalizeSettingsForPos = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  const taxes = s.taxes && typeof s.taxes === 'object' ? s.taxes : {};
  const general = s.general && typeof s.general === 'object' ? s.general : {};
  const business = s.business && typeof s.business === 'object' ? s.business : {};
  const payments = s.payments && typeof s.payments === 'object' ? s.payments : {};
  const policies = s.policies && typeof s.policies === 'object' ? s.policies : {};
  const security = s.security && typeof s.security === 'object' ? s.security : {};
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
  };
};

const resolveEffectivePosSettings = async ({ tenantId, branchId }) => {
  const ownerRaw = await loadOwnerSettings(tenantId);
  const branchRaw = await loadBranchSettings({ tenantId, branchId });

  const owner = normalizeSettingsForPos(ownerRaw);
  const branch = normalizeSettingsForPos(branchRaw);

  return {
    general: { ...owner.general, ...branch.general },
    taxes: { ...owner.taxes, ...branch.taxes },
    payments: owner.payments,
    policies: owner.policies,
    security: owner.security,
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
  const total = taxableBase + vat + serviceCharge + tipAmt;

  return {
    subtotal,
    discountPct: hasPct ? pctApplied : 0,
    discount: discountApplied,
    tax: vat,
    serviceCharge,
    tip: tipAmt,
    total,
  };
};

const resolveBranchId = async (req) => {
  const fromToken = String(req.auth?.branchId || '').trim();
  const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

  const role = String(req.auth?.role || '');
  const isOwnerGlobal = role === 'Cafe Owner' && (!fromToken || fromToken === 'global');
  if (!isOwnerGlobal) return fromToken;

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
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('orders.read'),
    async (req, res, next) => {
    try {
      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
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

  r.get(
    '/pos/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('settings'),
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
      const existingRow = await db().select(['state_json']).from('pos_state').where({ tenant_id: req.tenant.id, branch_id: branchId }).first();
      const existing = safeJsonParse(existingRow?.state_json, null);
      const hasExisting = existing && typeof existing === 'object' && (Array.isArray(existing.tables) || Array.isArray(existing.products));

      if (hasExisting && !force) {
        return res.json({ ok: true, alreadyInitialized: true, tenantId: req.tenant.id, branchId });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const count = Number(body?.tablesCount || 12);
      const seats = Number(body?.defaultSeats || 4);
      const area = typeof body?.defaultArea === 'string' ? body.defaultArea : 'Main Hall';

      const nextState = makeInitialPosState({ count, seats, area });
      const nowIso = new Date().toISOString();
      const id = `pos_${req.tenant.id}_${branchId}`;

      await db()
        .from('pos_state')
        .insert({ id, tenant_id: req.tenant.id, branch_id: branchId, state_json: JSON.stringify(nextState), updated_at: nowIso })
        .onConflict(['tenant_id', 'branch_id'])
        .merge({ state_json: JSON.stringify(nextState), updated_at: nowIso });

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, initialized: true, updatedAt: nowIso });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/pos/print/receipt/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
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
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'created_at', 'payload'])
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      if (role === 'Waiter') {
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });
        const p = safeJsonParse(orderRow.payload, {});
        const createdBy = typeof p?.createdByStaffId === 'string' ? String(p.createdByStaffId) : '';
        if (!createdBy || createdBy !== staffId) return res.status(403).json({ error: 'forbidden' });
      }

      const payload = makeReceiptPayloadFromOrder({ orderRow });
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
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
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
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'created_at', 'payload'])
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
      const beep = req.body?.beep === true;
      const payload = makeKitchenTicketPayload({ title: 'Kitchen Ticket', orderRow, lines, beep });
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
    '/pos/print/bar/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
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
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'created_at', 'payload'])
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
      const beep = req.body?.beep === true;
      const payload = makeKitchenTicketPayload({ title: 'Bar Ticket', orderRow, lines, beep });
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

  r.get(
    '/pos/state',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
    try {
      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const row = await db()
        .select(['state_json', 'updated_at'])
        .from('pos_state')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .first();

      const state = safeJsonParse(row?.state_json, null);
      return res.json({ ok: true, tenantId: req.tenant.id, branchId, state: state && typeof state === 'object' ? state : null, updatedAt: row?.updated_at || null });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/pos/state',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.update'),
    async (req, res, next) => {
    try {
      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const incoming = req.body && typeof req.body === 'object' ? req.body.state : null;
      if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'invalid_state' });

      const nowIso = new Date().toISOString();
      const id = `pos_${req.tenant.id}_${branchId}`;
      await db()
        .from('pos_state')
        .insert({ id, tenant_id: req.tenant.id, branch_id: branchId, state_json: JSON.stringify(incoming), updated_at: nowIso })
        .onConflict(['tenant_id', 'branch_id'])
        .merge({ state_json: JSON.stringify(incoming), updated_at: nowIso });

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, updatedAt: nowIso });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/pos/orders',
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

      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 100) || 100));

      let q = db().select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'paid_at', 'payload']).from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) q = q.andWhere({ status });
      q = q.orderBy('created_at', 'desc').limit(limit);

      const rows = await q;
      const orders = rows.map((row) => ({
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
        payload: safeJsonParse(row.payload, null),
      }));

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, orders });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/pos/orders/:id',
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

      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const row = await db()
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'paid_at', 'payload'])
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
        .first();

      if (!row) return res.status(404).json({ error: 'order_not_found' });

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
        payload: safeJsonParse(row.payload, null),
      };

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, order });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/pos/notifications',
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
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.create'),
    async (req, res, next) => {
    try {
      const branchId = await resolveBranchId(req);
      if (!branchId) return res.status(400).json({ error: 'branch_required' });

      const role = String(req.auth?.role || '').trim();
      const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
      const status = typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Pending';

      if (role === 'Waiter') {
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const tableId = typeof payload?.tableId === 'string' ? payload.tableId.trim() : typeof payload?.table_id === 'string' ? payload.table_id.trim() : '';
        if (!tableId) return res.status(400).json({ error: 'table_required' });

        const stateRow = await db().select(['state_json']).from('pos_state').where({ tenant_id: req.tenant.id, branch_id: branchId }).first();
        const state = safeJsonParse(stateRow?.state_json, null);
        const tables = Array.isArray(state?.tables) ? state.tables : [];
        const table = tables.find((t) => t && String(t.id || '') === tableId) || null;
        if (!table) return res.status(404).json({ error: 'table_not_found' });

        const assigned = typeof table?.assignedStaffId === 'string' ? String(table.assignedStaffId) : '';
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

      await db()
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
          payload: JSON.stringify(nextPayload),
        });

      return res.json({ ok: true, id, createdAt: nowIso });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/pos/orders/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
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

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const patch = {};

      let existingPayload = null;
      let waiterIsOwner = true;
      if (role === 'Waiter') {
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const existingRow = await db().select(['payload']).from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).first();
        if (!existingRow) return res.status(404).json({ error: 'order_not_found' });
        existingPayload = safeJsonParse(existingRow?.payload, {});

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
        const allowedStatusOnly = nextStatus === 'Cooking' || nextStatus === 'Ready' || nextStatus === 'Served';

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

          const stateRow = await db().select(['state_json']).from('pos_state').where({ tenant_id: req.tenant.id, branch_id: branchId }).first();
          const state = safeJsonParse(stateRow?.state_json, null);
          const tables = Array.isArray(state?.tables) ? state.tables : [];
          const table = tables.find((t) => t && String(t.id || '') === (existingTableId || nextTableId)) || null;
          if (!table) return res.status(404).json({ error: 'table_not_found' });
          const assigned = typeof table?.assignedStaffId === 'string' ? String(table.assignedStaffId) : '';
          if (assigned && assigned !== staffId) return res.status(403).json({ error: 'table_assigned_to_other' });

          const staffRow = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId }).first();
          const waiterName = staffRow?.name ? String(staffRow.name) : '';

          incomingPayload.createdByStaffId = staffId;
          incomingPayload.createdByName = waiterName || incomingPayload.createdByName || null;
          if (existingTableId) incomingPayload.tableId = existingTableId;
          if (table?.name && !incomingPayload.tableName) incomingPayload.tableName = String(table.name);
        }

        // Normalize reference early so it is persisted into payload JSON.
        if (typeof incomingPayload?.paymentReference === 'string' && incomingPayload.paymentReference.trim()) {
          incomingPayload.paymentReference = normalizePaymentReference(incomingPayload.paymentReference);
        }

        const splits = Array.isArray(incomingPayload?.splits) ? incomingPayload.splits : null;
        if (splits && splits.length > 0 && !settings.payments.allowSplitPayments) {
          return res.status(402).json({ error: 'split_payments_disabled' });
        }

        const computed = computeOrderTotalsFromPayload({ payload: incomingPayload, tip, discount, discountPct, settings, allowOverMax: requireApprovalPin });
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
      }

      if (Object.keys(patch).length === 0) return res.json({ ok: true });

      const updated = await db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
      if (!updated) return res.status(404).json({ error: 'order_not_found' });

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

  r.get(
    '/pos/orders/:id/payment-status',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
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
          payload.telebirrVerifyResponse = verify.rawResponse;

          await db()
            .from('orders')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
            .update({
              status: 'Paid',
              paid_at: nowIso,
              payload: JSON.stringify(payload),
            });

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

  return r;
};

module.exports = { makePosRouter };
