const crypto = require('crypto');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { logger } = require('../utils/logger');
const telebirrTools = require('../utils/telebirr/tools');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    return JSON.parse(String(raw)) ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizePhone = (raw) => {
  const s = String(raw || '').trim();
  // Accept 09xxxxxxxx, 2519xxxxxxxx
  const digits = s.replace(/\D/g, '');
  if (digits.startsWith('251')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `251${digits.slice(1)}`;
  return digits;
};

const computeNextChargeDate = ({ executeDay = 1, cycle = 'MONTHLY' }) => {
  const day = Math.min(28, Math.max(1, Number(executeDay || 1) || 1));
  const now = new Date();

  if (String(cycle).toUpperCase() === 'DAILY') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  if (String(cycle).toUpperCase() === 'YEARLY') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(day);
    return d.toISOString().slice(0, 10);
  }

  // MONTHLY default
  const d = new Date(now);
  d.setMonth(d.getMonth() + 1);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
};

const getTelebirrStandingOrderConfig = async () => {
  // Demo-aligned mandate flow uses Fabric token + preOrder with signature.
  // For production, keep secrets in env and optionally mirror into DB config.
  return {
    enabled: process.env.TELEBIRR_STANDING_ENABLED === 'true',
    baseUrl: process.env.TELEBIRR_BASE_URL || process.env.TELEBIRR_STANDING_BASE_URL || '',
    fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID || '',
    appSecret: process.env.TELEBIRR_APP_SECRET || '',
    merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID || '',
    merchantCode: process.env.TELEBIRR_MERCHANT_CODE || '',
    privateKey: process.env.TELEBIRR_PRIVATE_KEY || '',
    mandateTemplateId: process.env.TELEBIRR_MANDATE_TEMPLATE_ID || '103001',
  };
};

const applyFabricToken = async (config) => {
  const response = await fetch(`${config.baseUrl}/payment/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-APP-Key': config.fabricAppId,
    },
    body: JSON.stringify({ appSecret: config.appSecret }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.msg || `Telebirr token HTTP ${response.status}`);
  if (data.code !== '0' && data.code !== 0) throw new Error(data.msg || 'Failed to get fabric token');
  return data.token;
};

const createMandatePreorder = async ({ config, fabricToken, title, amountEtb, outSubscriptionNo, notifyUrl, executeDateIso }) => {
  const reqObject = {
    timestamp: telebirrTools.createTimeStamp(),
    nonce_str: telebirrTools.createNonceStr(),
    method: 'payment.preorder',
    version: '1.0',
    biz_content: {
      notify_url: notifyUrl,
      trade_type: 'InApp',
      appid: config.merchantAppId,
      merch_code: config.merchantCode,
      merch_order_id: outSubscriptionNo,
      title: title,
      total_amount: String(amountEtb.toFixed(2)),
      trans_currency: 'ETB',
      timeout_express: '120m',
      payee_identifier: config.merchantCode,
      payee_identifier_type: '04',
      payee_type: '5000',
      mandate_data: {
        mctContractNo: outSubscriptionNo,
        mandateTemplateId: String(config.mandateTemplateId || '103001'),
        executeTime: executeDateIso,
      },
    },
  };

  reqObject.sign = telebirrTools.signRequestObject(reqObject, config.privateKey);
  reqObject.sign_type = 'SHA256WithRSA';

  const response = await fetch(`${config.baseUrl}/payment/v1/merchant/preOrder`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-APP-Key': config.fabricAppId,
      'Authorization': fabricToken,
    },
    body: JSON.stringify(reqObject),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.msg || `Telebirr preOrder HTTP ${response.status}`);
  if (data.code !== '0' && data.code !== 0) throw new Error(data.msg || 'Telebirr preOrder failed');
  const prepayId = data?.biz_content?.prepay_id;
  if (!prepayId) throw new Error('Telebirr preOrder missing prepay_id');

  const rawMap = {
    appid: config.merchantAppId,
    merch_code: config.merchantCode,
    nonce_str: telebirrTools.createNonceStr(),
    prepay_id: prepayId,
    timestamp: telebirrTools.createTimeStamp(),
  };
  const rawSign = telebirrTools.signRequestObject(rawMap, config.privateKey);
  const rawRequest = [
    `appid=${rawMap.appid}`,
    `merch_code=${rawMap.merch_code}`,
    `nonce_str=${rawMap.nonce_str}`,
    `prepay_id=${rawMap.prepay_id}`,
    `timestamp=${rawMap.timestamp}`,
    `sign=${rawSign}`,
    'sign_type=SHA256WithRSA',
  ].join('&');

  return { prepayId, rawRequest };
};

const createSubscription = async ({ tenantId, userId, phone, planAmount, cycle, executeDay, validityMonths, idempotencyKey, notifyUrl }) => {
  const cfg = await getTelebirrStandingOrderConfig();
  if (!cfg.enabled) throw new Error('Telebirr standing order is disabled');
  if (!cfg.baseUrl || !cfg.fabricAppId || !cfg.appSecret || !cfg.merchantAppId || !cfg.merchantCode || !cfg.privateKey) throw new Error('Telebirr standing order config incomplete');

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error('phone_required');

  const amt = Number(planAmount || 0);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('plan_amount_invalid');

  const nowIso = new Date().toISOString();
  const subId = makeId('tso');
  const outSubscriptionNo = `TSO_${tenantId}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  // Basic idempotency protection: if key already exists and stored response is available, return it.
  if (idempotencyKey) {
    const existing = await db().select(['response_json']).from('idempotency_keys').where({ key: idempotencyKey }).first();
    if (existing?.response_json) {
      return safeJsonParse(existing.response_json, null);
    }
  }

  const nextChargeDate = computeNextChargeDate({ executeDay, cycle });

  // Demo mandate requires executeTime as YYYY-MM-DD
  const executeDateIso = String(nextChargeDate);

  await db().from('telebirr_subscriptions').insert({
    id: subId,
    tenant_id: tenantId,
    user_id: userId || null,
    phone_number: normalizedPhone,
    plan_amount: amt.toFixed(2),
    out_subscription_no: outSubscriptionNo,
    telebirr_subscription_id: null,
    status: 'pending',
    next_charge_date: nextChargeDate,
    cycle: String(cycle || 'MONTHLY').toUpperCase(),
    execute_day: Number(executeDay || 1) || 1,
    validity_months: Number(validityMonths || 12) || 12,
    last_webhook_at: null,
    webhook_count: 0,
    failure_count: 0,
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  let preorder;
  try {
    const fabricToken = await applyFabricToken(cfg);
    preorder = await createMandatePreorder({
      config: cfg,
      fabricToken,
      title: 'MirachPOS Subscription',
      amountEtb: amt,
      outSubscriptionNo,
      notifyUrl,
      executeDateIso,
    });
  } catch (e) {
    await db().from('telebirr_subscriptions').where({ id: subId }).update({
      status: 'failed',
      failure_count: 1,
      last_error: String(e.message || e).slice(0, 1000),
      updated_at: new Date().toISOString(),
    });
    throw e;
  }

  // Important: mandate setup still requires Telebirr user authorization. Mark as pending until webhook confirms.
  await db().from('telebirr_subscriptions').where({ id: subId }).update({
    status: 'pending',
    updated_at: new Date().toISOString(),
    last_error: null,
  });

  const result = {
    ok: true,
    subscription: {
      id: subId,
      outSubscriptionNo,
      telebirrSubscriptionId: null,
      status: 'pending',
      phoneNumber: normalizedPhone,
      planAmount: amt,
      cycle: String(cycle || 'MONTHLY').toUpperCase(),
      executeDay: Number(executeDay || 1) || 1,
      nextChargeDate,
    },
    checkout: {
      rawRequest: preorder.rawRequest,
      prepayId: preorder.prepayId,
    },
  };

  if (idempotencyKey) {
    const nowIso2 = new Date().toISOString();
    await db().from('idempotency_keys').insert({
      id: crypto.randomBytes(16).toString('hex'),
      key: idempotencyKey,
      path: '/api/telebirr/subscribe',
      response_json: JSON.stringify(result),
      created_at: nowIso2,
    }).onConflict('key').ignore();
  }

  return result;
};

const handleStandingOrderWebhook = async ({ body, rawBody }) => {
  // Demo notify_url posts plain JSON. Treat webhook as truth.
  const payload = body && typeof body === 'object' ? body : safeJsonParse(rawBody, null);
  const outSubscriptionNo = String(payload?.outSubscriptionNo || payload?.mctContractNo || payload?.biz_content?.mctContractNo || payload?.biz_content?.merch_order_id || '').trim();
  if (!outSubscriptionNo) throw new Error('outSubscriptionNo_missing');

  // Find subscription
  const sub = await db().select(['id', 'tenant_id', 'status', 'webhook_count']).from('telebirr_subscriptions').where({ out_subscription_no: outSubscriptionNo }).first();
  if (!sub) throw new Error('subscription_not_found');

  const tradeStatus = String(payload?.status || payload?.tradeStatus || payload?.biz_content?.trade_status || '').trim().toUpperCase();
  const statusRaw = tradeStatus || 'UNKNOWN';
  const amount = Number(payload?.amount || payload?.totalAmount || payload?.biz_content?.total_amount || 0) || 0;
  const orderSn = String(payload?.orderSn || payload?.biz_content?.order_sn || payload?.telebirr_order_sn || '').trim() || null;

  // Idempotency: unique(subscription_id, out_subscription_no) + status success guard
  const existingSuccess = await db()
    .select(['id'])
    .from('subscription_transactions')
    .where({ subscription_id: sub.id, out_subscription_no: outSubscriptionNo, status: 'success' })
    .first();
  if (existingSuccess) return { ok: true, deduped: true };

  const txId = makeId('stx');
  const nowIso = new Date().toISOString();

  await db().transaction(async (trx) => {
    await trx('subscription_transactions').insert({
      id: txId,
      subscription_id: sub.id,
      out_subscription_no: outSubscriptionNo,
      telebirr_order_sn: orderSn,
      amount: amount.toFixed(2),
      status: (statusRaw === 'SUCCESS' || statusRaw === 'COMPLETED') ? 'success' : 'failed',
      raw_payload_json: JSON.stringify({ payload, rawBody }),
      processed_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    });

    await trx('telebirr_subscriptions').where({ id: sub.id }).update({
      last_webhook_at: nowIso,
      webhook_count: Number(sub.webhook_count || 0) + 1,
      status: (statusRaw === 'SUCCESS' || statusRaw === 'COMPLETED') ? 'active' : 'failed',
      failure_count: statusRaw === 'SUCCESS' ? 0 : trx.raw('failure_count + 1'),
      updated_at: nowIso,
    });
  });

  return { ok: true };
};

const getSubscriptionStatus = async ({ tenantId }) => {
  const rows = await db()
    .select(['id', 'phone_number', 'plan_amount', 'status', 'cycle', 'execute_day', 'next_charge_date', 'telebirr_subscription_id', 'out_subscription_no', 'created_at', 'updated_at'])
    .from('telebirr_subscriptions')
    .where({ tenant_id: tenantId })
    .orderBy('created_at', 'desc')
    .limit(20);

  return {
    ok: true,
    subscriptions: rows.map((r) => ({
      id: r.id,
      phoneNumber: r.phone_number,
      planAmount: Number(r.plan_amount || 0),
      status: r.status,
      cycle: r.cycle,
      executeDay: r.execute_day,
      nextChargeDate: r.next_charge_date,
      telebirrSubscriptionId: r.telebirr_subscription_id,
      outSubscriptionNo: r.out_subscription_no,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  };
};

const cancelSubscription = async ({ tenantId, subscriptionId }) => {
  const cfg = await getTelebirrStandingOrderConfig();
  if (!cfg.enabled) throw new Error('Telebirr standing order is disabled');

  const sub = await db()
    .select(['id', 'out_subscription_no', 'telebirr_subscription_id', 'status'])
    .from('telebirr_subscriptions')
    .where({ id: subscriptionId, tenant_id: tenantId })
    .first();

  if (!sub) throw new Error('not_found');
  if (String(sub.status).toLowerCase() === 'cancelled') return { ok: true };

  // NOTE: actual Telebirr cancel payload depends on merchant agreement.
  // We implement a best-effort cancel and always update locally.
  try {
    const payload = {
      appId: cfg.appId,
      appKey: cfg.appKey,
      shortCode: cfg.shortCode,
      outSubscriptionNo: sub.out_subscription_no,
      subscriptionId: sub.telebirr_subscription_id || '',
      timestamp: Date.now().toString(),
    };

    const signStr = buildSignString(payload);
    const signature = signStringPssBase64(signStr, cfg.privateKey);
    const encryptedData = rsaEncryptBase64(JSON.stringify(payload), cfg.publicKey);

    if (!cfg.cancelEndpoint) throw new Error('TELEBIRR_STANDING_CANCEL_ENDPOINT not configured');

    await fetch(cfg.cancelEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptedData, signature, signType: 'RSA' }),
    }).then((r) => r.json().catch(() => ({})));
  } catch (e) {
    logger.warn({ subscriptionId, err: e.message }, 'Telebirr cancel call failed (local cancel still applied)');
  }

  await db().from('telebirr_subscriptions').where({ id: subscriptionId, tenant_id: tenantId }).update({
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  });

  return { ok: true };
};

module.exports = {
  getTelebirrStandingOrderConfig,
  createSubscription,
  handleStandingOrderWebhook,
  getSubscriptionStatus,
  cancelSubscription,
};
