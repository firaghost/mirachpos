/**
 * Payment Gateway Service
 * 
 * Integrates with Ethiopian payment gateways:
 * - Chapa (https://chapa.co)
 * - Telebirr (Ethio Telecom)
 * - CBE Birr (Commercial Bank of Ethiopia)
 */

const { db } = require('../db');
const { config } = require('../config');
const { withCache } = require('../utils/cache');
const { withCircuitBreaker } = require('../utils/circuitBreaker');
const telebirrTools = require('../utils/telebirr/tools');
const jwt = require('jsonwebtoken');
const { decryptConfigFields } = require('../utils/secretEncryption');

const getTelebirrDispatcher = () => {
    try {
        if (process.env.TELEBIRR_INSECURE_TLS !== 'true') return undefined;
        const { Agent } = require('undici');
        return new Agent({ connect: { rejectUnauthorized: false } });
    } catch {
        return undefined;
    }
};

const normalizePem = (v) => {
    let s = String(v || '');
    if (!s.trim()) return '';

    // Allow env/DB value with literal \n
    s = s.replace(/\\n/g, '\n');
    // Normalize Windows newlines
    s = s.replace(/\r\n/g, '\n');
    s = s.replace(/\r/g, '\n');

    // Some inputs include leading newlines or other characters before BEGIN.
    const beginIdx = s.indexOf('-----BEGIN');
    if (beginIdx >= 0) s = s.slice(beginIdx);

    // Trim trailing junk after END
    const endIdx = s.indexOf('-----END');
    if (endIdx >= 0) {
        const endLineIdx = s.indexOf('-----', endIdx + 5);
        if (endLineIdx >= 0) {
            // Keep until end of END header line and following footer if present.
            // Best-effort: just trim overall whitespace after END block.
        }
    }

    return s.trim();
};

const preferEnvOrDb = (envVal, dbVal, { requirePem = false } = {}) => {
    const envNorm = normalizePem(envVal);
    const dbNorm = normalizePem(dbVal);

    if (requirePem) {
        if (envNorm && envNorm.includes('-----BEGIN')) return envNorm;
        if (dbNorm && dbNorm.includes('-----BEGIN')) return dbNorm;
        return envNorm || dbNorm || '';
    }

    return envNorm || dbNorm || '';
};

const sanitizeTelebirrTitle = (v) => {
    const s = String(v || '').trim();
    if (!s) return 'MirachPOS';
    // Telebirr sandbox enforces a restrictive pattern for `title` (rejects many punctuation chars).
    // Keep only letters, digits and spaces.
    return s
        .replace(/[^A-Za-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 64) || 'MirachPOS';
};

const normalizeTelebirrTradeType = (v) => {
    const s = String(v || '').trim();
    if (!s) return 'WebCheckout';
    const lower = s.toLowerCase();
    if (lower === 'web' || lower === 'webcheckout' || lower === 'h5' || lower === 'checkout') return 'WebCheckout';
    if (lower === 'inapp' || lower === 'nativeapp') return 'InApp';
    if (lower === 'qrcode' || lower === 'qr') return 'QrCode';
    // Pass-through for other official enum values.
    return s;
};

const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutMs = Number(config.gatewayRequestTimeoutMs || 0) || 0;
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const telebirrFetch = async (url, options) => {
    try {
        return await withCircuitBreaker('telebirr', async () => fetchWithTimeout(url, options));
    } catch (e) {
        const msg = String(e?.message || e || '');
        // Some Node fetch implementations don't support undici `dispatcher` option.
        if (msg.toLowerCase().includes('not supported argument') && options && Object.prototype.hasOwnProperty.call(options, 'dispatcher')) {
            const { dispatcher, ...rest } = options;
            return await withCircuitBreaker('telebirr', async () => fetchWithTimeout(url, rest));
        }
        throw e;
    }
};

const chapaFetch = async (url, options) => withCircuitBreaker('chapa', async () => fetchWithTimeout(url, options));

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const normalizeGateway = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'cbe' || s === 'cbebirr' || s === 'cbe-birr') return 'cbe_birr';
    return s;
};

const TENANT_POS_SECRET_FIELDS_BY_GATEWAY = {
    chapa: ['secretKey', 'webhookSecret', 'publicKey'],
    telebirr: ['fabricAppId', 'merchantAppId', 'merchantCode', 'privateKey'],
    cbe_birr: ['merchantId', 'privateKey', 'publicKey'],
    santimpay: ['merchantId', 'privateKey', 'publicKey'],
};

const getTenantPosGatewayConfig = async (tenantId, gateway) => {
    const tid = String(tenantId || '').trim();
    const g = normalizeGateway(gateway);
    if (!tid || !g) return null;

    const row = await db()
        .select(['enabled', 'config_json', 'updated_at'])
        .from('tenant_pos_payment_gateways')
        .where({ tenant_id: tid, gateway: g })
        .first();

    if (!row) return null;
    const cfg0 = safeJsonParse(row.config_json, {});
    const fields = Array.isArray(TENANT_POS_SECRET_FIELDS_BY_GATEWAY[g]) ? TENANT_POS_SECRET_FIELDS_BY_GATEWAY[g] : [];
    const cfg = decryptConfigFields(cfg0, fields);
    return {
        enabled: Boolean(row.enabled),
        config: cfg && typeof cfg === 'object' ? cfg : {},
        updatedAt: row.updated_at || null,
    };
};

// =============================================================================
// SANTIMPAY (SERVICESPAYMENT) - TENANT SCOPED (POS ONLY)
// Docs: https://docs.servicespayment.net/payment
// =============================================================================

const SANTIMPAY_API_BASE = 'https://services.santimpay.com/api/v1/gateway';

const signSantimPayToken = ({ merchantId, privateKeyPem, payload }) => {
    const time = Math.floor(Date.now() / 1000);
    const body = {
        ...payload,
        merchantId,
        generated: time,
    };

    // SantimPay docs specify ES256 signing.
    return jwt.sign(body, privateKeyPem, { algorithm: 'ES256' });
};

const signSantimPayStatusToken = ({ merchantId, privateKeyPem, id }) => {
    const time = Math.floor(Date.now() / 1000);
    // Docs: signing body uses `merId` (not merchantId) for fetch-transaction-status.
    const body = {
        id: String(id),
        merId: String(merchantId),
        generated: time,
    };
    return jwt.sign(body, privateKeyPem, { algorithm: 'ES256' });
};

const getSantimPayPlatformConfig = () => {
    const enabled = process.env.SANTIMPAY_ENABLED === 'true';
    const merchantId = String(process.env.SANTIMPAY_MERCHANT_ID || '').trim();
    const privateKey = String(process.env.SANTIMPAY_PRIVATE_KEY || '').trim();
    const publicKey = String(process.env.SANTIMPAY_PUBLIC_KEY || '').trim();
    return { enabled, merchantId, privateKey, publicKey };
};

const santimpayInitializeForTenantPos = async ({
    tenantId,
    id,
    amount,
    reason,
    notifyUrl,
    successRedirectUrl,
    failureRedirectUrl,
    cancelRedirectUrl,
}) => {
    const tcfg = await getTenantPosGatewayConfig(tenantId, 'santimpay');
    const enabled = Boolean(tcfg?.enabled);
    const merchantId = String(tcfg?.config?.merchantId || '').trim();
    const privateKey = String(tcfg?.config?.privateKey || '').trim();

    if (!enabled || !merchantId || !privateKey) {
        throw new Error('tenant_santimpay_not_configured');
    }

    // Expect PEM content (EC private key). The API will fail otherwise.
    if (!privateKey.includes('BEGIN')) {
        throw new Error('tenant_santimpay_invalid_private_key');
    }

    const token = signSantimPayToken({
        merchantId,
        privateKeyPem: privateKey,
        payload: {
            amount: Number(amount),
            paymentReason: String(reason || '').trim() || 'POS Payment',
        },
    });

    const payload = {
        id: String(id),
        amount: Number(amount),
        reason: String(reason || '').trim() || 'POS Payment',
        merchantId,
        signedToken: token,
        successRedirectUrl: String(successRedirectUrl || '').trim() || notifyUrl,
        failureRedirectUrl: String(failureRedirectUrl || '').trim() || notifyUrl,
        cancelRedirectUrl: String(cancelRedirectUrl || '').trim() || String(failureRedirectUrl || '').trim() || notifyUrl,
        notifyUrl: String(notifyUrl || '').trim(),
    };

    const response = await fetch(`${SANTIMPAY_API_BASE}/initiate-payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `SantimPay initiate-payment failed (${response.status})`;
        throw new Error(msg);
    }

    // Docs show a generated payment URL. Be liberal in parsing.
    const checkoutUrl =
        (typeof data?.checkoutUrl === 'string' && data.checkoutUrl.trim())
            ? data.checkoutUrl.trim()
            : (typeof data?.url === 'string' && data.url.trim())
                ? data.url.trim()
                : (typeof data?.data === 'string' && data.data.trim())
                    ? data.data.trim()
                    : (typeof data?.data?.url === 'string' && data.data.url.trim())
                        ? data.data.url.trim()
                        : null;

    if (!checkoutUrl) {
        throw new Error('SantimPay initiate-payment did not return checkout URL');
    }

    return {
        success: true,
        checkoutUrl,
        txRef: String(id),
        rawResponse: data,
    };
};

const santimpayFetchTransactionStatus = async ({ merchantId, privateKey, id, fullParams = true }) => {
    const m = String(merchantId || '').trim();
    const priv = String(privateKey || '').trim();
    const txId = String(id || '').trim();
    if (!m || !priv || !txId) throw new Error('santimpay_not_configured');
    if (!priv.includes('BEGIN')) throw new Error('santimpay_invalid_private_key');

    const token = signSantimPayStatusToken({ merchantId: m, privateKeyPem: priv, id: txId });
    const payload = { id: txId, merchantId: m, signedToken: token, fullParams: Boolean(fullParams) };

    const response = await fetch(`${SANTIMPAY_API_BASE}/fetch-transaction-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `SantimPay fetch-transaction-status failed (${response.status})`;
        throw new Error(msg);
    }

    const status = String(data?.Status || data?.status || '').trim().toUpperCase();
    return { success: status === 'COMPLETED', status, raw: data };
};

const santimpayVerifyForTenantPos = async ({ tenantId, id }) => {
    const tcfg = await getTenantPosGatewayConfig(tenantId, 'santimpay');
    const enabled = Boolean(tcfg?.enabled);
    const merchantId = String(tcfg?.config?.merchantId || '').trim();
    const privateKey = String(tcfg?.config?.privateKey || '').trim();
    if (!enabled || !merchantId || !privateKey) throw new Error('tenant_santimpay_not_configured');
    return await santimpayFetchTransactionStatus({ merchantId, privateKey, id });
};

const santimpayInitializeForPlatform = async ({ id, amount, reason, notifyUrl, successRedirectUrl, failureRedirectUrl, cancelRedirectUrl }) => {
    const cfg = getSantimPayPlatformConfig();
    if (!cfg.enabled || !cfg.merchantId || !cfg.privateKey) throw new Error('santimpay_not_configured');
    if (!cfg.privateKey.includes('BEGIN')) throw new Error('santimpay_invalid_private_key');

    const token = signSantimPayToken({
        merchantId: cfg.merchantId,
        privateKeyPem: cfg.privateKey,
        payload: {
            amount: Number(amount),
            paymentReason: String(reason || '').trim() || 'Subscription Payment',
        },
    });

    const payload = {
        id: String(id),
        amount: Number(amount),
        reason: String(reason || '').trim() || 'Subscription Payment',
        merchantId: cfg.merchantId,
        signedToken: token,
        successRedirectUrl: String(successRedirectUrl || '').trim() || notifyUrl,
        failureRedirectUrl: String(failureRedirectUrl || '').trim() || notifyUrl,
        cancelRedirectUrl: String(cancelRedirectUrl || '').trim() || String(failureRedirectUrl || '').trim() || notifyUrl,
        notifyUrl: String(notifyUrl || '').trim(),
    };

    const response = await fetch(`${SANTIMPAY_API_BASE}/initiate-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `SantimPay initiate-payment failed (${response.status})`;
        throw new Error(msg);
    }

    const checkoutUrl = typeof data?.url === 'string' ? data.url.trim() : (typeof data?.checkoutUrl === 'string' ? data.checkoutUrl.trim() : '');
    if (!checkoutUrl) throw new Error('SantimPay initiate-payment did not return checkout URL');

    return { success: true, checkoutUrl, txRef: String(id), rawResponse: data };
};

const santimpayVerifyPlatform = async ({ id }) => {
    const cfg = getSantimPayPlatformConfig();
    if (!cfg.enabled || !cfg.merchantId || !cfg.privateKey) throw new Error('santimpay_not_configured');
    return await santimpayFetchTransactionStatus({ merchantId: cfg.merchantId, privateKey: cfg.privateKey, id });
};

// Get gateway configuration
const getGatewayConfig = async (gateway) => {
    const row = await withCache(
        'platform_gateway_config_v1',
        config.cacheDefaultTtlSeconds,
        async () => db()
            .select(['chapa_config_json', 'telebirr_config_json', 'cbe_birr_config_json'])
            .from('platform_payment_config')
            .where({ id: 1 })
            .first(),
    );

    // Default empty objects if DB row missing
    const dbConfigs = {
        chapa: safeJsonParse(row?.chapa_config_json, { enabled: false }),
        telebirr: safeJsonParse(row?.telebirr_config_json, { enabled: false }),
        cbe_birr: safeJsonParse(row?.cbe_birr_config_json, { enabled: false }),
    };

    // Overlay Environment Variables (Security Priority)

    // Chapa Env Overrides
    if (process.env.CHAPA_SECRET_KEY) {
        dbConfigs.chapa.secretKey = process.env.CHAPA_SECRET_KEY;
        dbConfigs.chapa.webhookSecret = process.env.CHAPA_WEBHOOK_SECRET;
        // If Env key is present, assume enabled unless explicitly disabled in basic config? 
        // Or user must set CHAPA_ENABLED=true
        if (process.env.CHAPA_ENABLED === 'true') {
            dbConfigs.chapa.enabled = true;
        } else if (process.env.CHAPA_ENABLED === 'false') {
            dbConfigs.chapa.enabled = false;
        } else {
            // Fallback to DB enabled status, but key is from Env
            // If DB says disabled but Key is in Env, we might want to respect DB for on/off switch.
        }
    }

    if (gateway && dbConfigs[gateway]) {
        return dbConfigs[gateway];
    }
    return null;
};

// =============================================================================
// CHAPA INTEGRATION
// Docs: https://developer.chapa.co/docs
// =============================================================================

const CHAPA_API_URL = 'https://api.chapa.co/v1';

const safeErrMsg = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    try {
        return JSON.stringify(val);
    } catch {
        return String(val);
    }
};

const chapaInitialize = async ({
    amount,
    currency = 'ETB',
    email,
    firstName,
    lastName,
    txRef,
    callbackUrl,
    returnUrl,
    customization = {},
}) => {
    const config = await getGatewayConfig('chapa');
    if (!config?.enabled || !config?.secretKey) {
        throw new Error('Chapa is not configured');
    }

    const payload = {
        amount: String(amount),
        currency,
        email,
        first_name: firstName,
        last_name: lastName,
        tx_ref: txRef,
        callback_url: callbackUrl,
        return_url: returnUrl,
        customization: {
            title: customization.title || 'MirachPOS Subscription',
            description: customization.description || 'Subscription Payment',
        },
    };

    try {
        const response = await chapaFetch(`${CHAPA_API_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || data?.status !== 'success') {
            const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `Chapa initialization failed (${response.status})`;
            throw new Error(msg);
        }

        return {
            success: true,
            checkoutUrl: data.data.checkout_url,
            txRef,
        };
    } catch (error) {

        throw error;
    }
};

// =============================================================================
// TENANT-SCOPED CHAPA (POS ONLY)
// =============================================================================

const chapaInitializeForTenantPos = async ({
    tenantId,
    amount,
    currency = 'ETB',
    email,
    firstName,
    lastName,
    txRef,
    callbackUrl,
    returnUrl,
    customization = {},
}) => {
    const tcfg = await getTenantPosGatewayConfig(tenantId, 'chapa');
    const secretKey = String(tcfg?.config?.secretKey || '').trim();
    const enabled = Boolean(tcfg?.enabled);

    if (!enabled || !secretKey) {
        throw new Error('tenant_chapa_not_configured');
    }

    const payload = {
        amount: String(amount),
        currency,
        email,
        first_name: firstName,
        last_name: lastName,
        tx_ref: txRef,
        callback_url: callbackUrl,
        return_url: returnUrl,
        customization: {
            title: customization.title || 'MirachPOS',
            description: customization.description || 'POS Payment',
        },
    };

    const response = await chapaFetch(`${CHAPA_API_URL}/transaction/initialize`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== 'success') {
        const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `Chapa initialization failed (${response.status})`;
        throw new Error(msg);
    }

    return {
        success: true,
        checkoutUrl: data.data.checkout_url,
        txRef,
    };
};

const chapaVerifyForTenantPos = async ({ tenantId, txRef }) => {
    const tcfg = await getTenantPosGatewayConfig(tenantId, 'chapa');
    const secretKey = String(tcfg?.config?.secretKey || '').trim();
    const enabled = Boolean(tcfg?.enabled);

    if (!enabled || !secretKey) {
        throw new Error('tenant_chapa_not_configured');
    }

    const response = await chapaFetch(`${CHAPA_API_URL}/transaction/verify/${encodeURIComponent(String(txRef || '').trim())}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${secretKey}`,
        },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `Chapa verification failed (${response.status})`;
        throw new Error(msg);
    }

    return {
        success: data.status === 'success',
        status: data.data?.status,
        amount: data.data?.amount,
        currency: data.data?.currency,
        txRef: data.data?.tx_ref,
        reference: data.data?.reference,
        paymentMethod: data.data?.payment_method,
        createdAt: data.data?.created_at,
        rawResponse: data,
    };
};

const chapaVerify = async (txRef) => {
    const config = await getGatewayConfig('chapa');
    if (!config?.enabled || !config?.secretKey) {
        throw new Error('Chapa is not configured');
    }

    try {
        const response = await chapaFetch(`${CHAPA_API_URL}/transaction/verify/${txRef}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.secretKey}`,
            },
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            const msg = safeErrMsg(data?.message) || safeErrMsg(data) || `Chapa verification failed (${response.status})`;
            throw new Error(msg);
        }

        return {
            success: data.status === 'success',
            status: data.data?.status, // success, failed, pending
            amount: data.data?.amount,
            currency: data.data?.currency,
            txRef: data.data?.tx_ref,
            reference: data.data?.reference,
            paymentMethod: data.data?.payment_method,
            createdAt: data.data?.created_at,
            rawResponse: data,
        };
    } catch (error) {

        throw error;
    }
};

// =============================================================================
// TELEBIRR INTEGRATION
// Note: Telebirr API requires merchant registration and sandbox access
// =============================================================================

const TELEBIRR_API_URL = 'https://api.ethiotelecom.et'; // Production URL



const applyFabricToken = async (config) => {
    try {
        const fabricAppId = process.env.TELEBIRR_FABRIC_APP_ID || config.fabricAppId;
        const appSecret = process.env.TELEBIRR_APP_SECRET || config.appSecret;
        const baseUrl = process.env.TELEBIRR_BASE_URL || config.baseUrl;

        const dispatcher = getTelebirrDispatcher();

        const response = await telebirrFetch(`${baseUrl}/payment/v1/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-APP-Key': fabricAppId,
            },
            body: JSON.stringify({
                appSecret: appSecret,
            }),
            dispatcher,
        });
        const data = await response.json().catch(() => ({}));

        // Telebirr sandbox commonly returns: { token: "Bearer ...", effectiveDate, expirationDate }
        if (data && typeof data.token === 'string' && data.token.trim()) {
            return data.token.trim();
        }

        // Some environments return: { code: 0, msg, token }
        if (data?.code !== undefined && data.code !== '0' && data.code !== 0) {
            throw new Error(data.msg || 'Failed to get fabric token');
        }

        throw new Error(data?.msg || 'Failed to get fabric token');
    } catch (error) {
        const msg = String(error?.message || error || 'Telebirr token request failed');
        if (msg.toLowerCase().includes('fetch failed') || msg.toLowerCase().includes('certificate')) {
            throw new Error('Unable to reach Telebirr token endpoint. Check TELEBIRR_BASE_URL and network/TLS settings (set TELEBIRR_INSECURE_TLS=true for sandbox/self-signed).');
        }
        throw error;
    }
};

const telebirrInitialize = async ({
    amount,
    nonce, // This is usually unique, can be used as local txRef
    outTradeNo,
    subject,
    receiveName,
    notifyUrl,
    returnUrl,
}) => {
    const dbConfig = await getGatewayConfig('telebirr');
    const telebirrDebug = process.env.TELEBIRR_DEBUG === 'true';
    const config = {
        enabled: process.env.TELEBIRR_ENABLED === 'true' || (process.env.TELEBIRR_ENABLED === undefined && dbConfig?.enabled),
        baseUrl: preferEnvOrDb(process.env.TELEBIRR_BASE_URL, dbConfig?.baseUrl),
        fabricAppId: preferEnvOrDb(process.env.TELEBIRR_FABRIC_APP_ID, dbConfig?.fabricAppId),
        appSecret: preferEnvOrDb(process.env.TELEBIRR_APP_SECRET, dbConfig?.appSecret),
        merchantAppId: preferEnvOrDb(process.env.TELEBIRR_MERCHANT_APP_ID, dbConfig?.merchantAppId),
        merchantCode: preferEnvOrDb(process.env.TELEBIRR_MERCHANT_CODE, dbConfig?.merchantCode),
        privateKey: preferEnvOrDb(process.env.TELEBIRR_PRIVATE_KEY, dbConfig?.privateKey, { requirePem: true }),
        checkoutBaseUrl: preferEnvOrDb(process.env.TELEBIRR_CHECKOUT_BASE_URL, dbConfig?.checkoutBaseUrl),
        checkoutMode: preferEnvOrDb(process.env.TELEBIRR_CHECKOUT_MODE, dbConfig?.checkoutMode) || 'paygate',
        tradeType: normalizeTelebirrTradeType(preferEnvOrDb(process.env.TELEBIRR_TRADE_TYPE, dbConfig?.tradeType)),
    };

    if (config.privateKey && !config.privateKey.includes('BEGIN')) {
        throw new Error('Telebirr private key is invalid (expected PEM format)');
    }

    if (!config.enabled || !config.fabricAppId || !config.appSecret || !config.merchantAppId || !config.merchantCode || !config.privateKey) {
        throw new Error('Telebirr is missing configuration (Fabric App ID, Secret, Merchant ID, Code, Private Key)');
    }

    // 1. Get Auth Token
    const fabricToken = await applyFabricToken(config);

    // 2. Create Pre-Order
    // Timestamp, Nonce
    const timestamp = telebirrTools.createTimeStamp();
    const nonceStr = telebirrTools.createNonceStr();

    const safeTitle = sanitizeTelebirrTitle(subject);

    const reqObject = {
        timestamp: timestamp,
        nonce_str: nonceStr,
        method: 'payment.preorder',
        version: '1.0',
        biz_content: {
            notify_url: notifyUrl,
            trade_type: config.tradeType,
            appid: config.merchantAppId,
            merch_code: config.merchantCode,
            merch_order_id: outTradeNo,
            title: safeTitle,
            total_amount: String(amount),
            trans_currency: 'ETB',
            timeout_express: '120m',
            payee_identifier: config.merchantCode,
            payee_identifier_type: '04',
            payee_type: '5000',
            redirect_url: returnUrl || notifyUrl,
        }
    };

    reqObject.sign = telebirrTools.signRequestObject(reqObject, config.privateKey);
    reqObject.sign_type = 'SHA256WithRSA';

    let prepayId = null;
    let toPayUrl = null;
    let preOrderDebug = null;
    try {
        const dispatcher = getTelebirrDispatcher();
        const response = await telebirrFetch(`${config.baseUrl}/payment/v1/merchant/preOrder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-APP-Key': config.fabricAppId,
                'Authorization': fabricToken,
            },
            body: JSON.stringify(reqObject),
            dispatcher,
        });
        const rawText = await response.text();
        const data = safeJsonParse(rawText, {});

        if (telebirrDebug) {
            preOrderDebug = {
                status: response.status,
                rawText: rawText ? String(rawText).slice(0, 4000) : '',
                parsed: data,
                request: {
                    biz_content: reqObject?.biz_content,
                },
            };
        }

        toPayUrl =
            data?.toPayUrl ||
            data?.data?.toPayUrl ||
            data?.biz_content?.toPayUrl ||
            data?.biz_content?.to_pay_url ||
            data?.data?.to_pay_url ||
            data?.to_pay_url ||
            null;

        // Some Telebirr environments respond without `code`, but include biz_content.prepay_id.
        const maybePrepayId =
            data?.biz_content?.prepay_id ||
            data?.biz_content?.prepayId ||
            data?.prepay_id ||
            data?.prepayId ||
            data?.biz_content?.prepayID ||
            data?.prepayID;
        if (maybePrepayId) {
            prepayId = maybePrepayId;
        } else {
            // If explicit error code is present and not success, fail.
            if (data?.code !== undefined && data.code !== '0' && data.code !== 0) {
                console.error('Telebirr preOrder failed:', data);
                throw new Error(data.msg || 'Telebirr preOrder failed');
            }

            // No prepay_id and no clear code -> still fail with best available message.
            console.error('Telebirr preOrder missing prepay_id:', { status: response.status, data });
            const upstreamMsg = data?.msg || data?.message || data?.error || '';
            const debugSnippet = rawText ? String(rawText).slice(0, 400) : '';
            throw new Error(upstreamMsg || `Telebirr preOrder missing prepay_id (status ${response.status}): ${debugSnippet}`);
        }


    } catch (error) {
        const msg = String(error?.message || error || 'Telebirr preOrder failed');
        if (msg.toLowerCase().includes('fetch failed') || msg.toLowerCase().includes('certificate')) {
            throw new Error('Unable to reach Telebirr preOrder endpoint. Check TELEBIRR_BASE_URL and network/TLS settings (set TELEBIRR_INSECURE_TLS=true for sandbox/self-signed).');
        }
        throw error;
    }

    // 3. Create Raw Request for Redirect
    const rawMap = {
        appid: config.merchantAppId,
        merch_code: config.merchantCode,
        nonce_str: telebirrTools.createNonceStr(),
        prepay_id: prepayId,
        timestamp: telebirrTools.createTimeStamp(),
    };
    const rawSign = telebirrTools.signRequestObject(rawMap, config.privateKey);
    const rawRequest = [
        "appid=" + rawMap.appid,
        "merch_code=" + rawMap.merch_code,
        "nonce_str=" + rawMap.nonce_str,
        "prepay_id=" + rawMap.prepay_id,
        "timestamp=" + rawMap.timestamp,
        "sign=" + rawSign,
        "sign_type=SHA256WithRSA",
    ].join("&");

    const checkoutBaseUrl = config.checkoutBaseUrl;
    const normalizedBase = checkoutBaseUrl ? String(checkoutBaseUrl).replace(/\/+$/, '') : '';

    let derivedWebBaseUrl = '';
    try {
        const baseOrigin = new URL(String(config.baseUrl || '')).origin;
        derivedWebBaseUrl = `${baseOrigin}/payment/web/paygate?`;
    } catch {
        derivedWebBaseUrl = '';
    }

    const configuredWebBaseUrl = process.env.TELEBIRR_WEB_BASE_URL
        ? String(process.env.TELEBIRR_WEB_BASE_URL).trim()
        : '';
    const webBaseUrl = configuredWebBaseUrl || derivedWebBaseUrl;

    if (telebirrDebug) {
        console.info('[Telebirr] checkout config', {
            checkoutMode: String(config.checkoutMode || ''),
            tradeType: String(config.tradeType || ''),
            configuredWebBaseUrl: configuredWebBaseUrl || null,
            derivedWebBaseUrl: derivedWebBaseUrl || null,
            webBaseUrl: webBaseUrl || null,
            checkoutBaseUrl: normalizedBase || null,
        });
    }

    // Guardrail: the API base URL is NOT a checkout page.
    // If misconfigured, strip to just the origin (scheme+host+port) so we can still build a redirect in payid/paygate modes.
    let safeNormalizedBase = normalizedBase;
    if (safeNormalizedBase && safeNormalizedBase.includes('/apiaccess/payment/gateway')) {
        try {
            const origin = new URL(safeNormalizedBase).origin;
            console.warn('[Telebirr] TELEBIRR_CHECKOUT_BASE_URL points to the API gateway path (/apiaccess/payment/gateway). Using only its origin for checkout.', {
                provided: safeNormalizedBase,
                using: origin,
            });
            safeNormalizedBase = origin;
        } catch {
            console.warn('[Telebirr] TELEBIRR_CHECKOUT_BASE_URL points to the API gateway path (/apiaccess/payment/gateway) but could not parse it as a URL. Ignoring it for checkout and relying on Telebirr toPayUrl.');
            safeNormalizedBase = '';
        }
    }

    // Prefer Telebirr-provided H5 redirect URL when available.
    let checkoutUrl = null;
    if (toPayUrl && typeof toPayUrl === 'string') {
        const v = toPayUrl.trim();
        if (v.startsWith('http://') || v.startsWith('https://')) {
            checkoutUrl = v;
        } else if (v.startsWith('//')) {
            checkoutUrl = `https:${v}`;
        } else if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?\/.*$/.test(v)) {
            // Looks like a host/path but missing scheme.
            checkoutUrl = `https://${v}`;
        } else if (safeNormalizedBase) {
            checkoutUrl = `${safeNormalizedBase}${v.startsWith('/') ? '' : '/'}${v}`;
        } else {
            throw new Error(`Telebirr returned relative toPayUrl but no valid H5 checkout base is configured. Set TELEBIRR_CHECKOUT_BASE_URL to the Telebirr H5 host (NOT the API base), or adjust trade_type so Telebirr returns an absolute toPayUrl. toPayUrl=${v}`);
        }
    }

    if (!checkoutUrl) {
        const mode = String(config.checkoutMode || 'paygate').toLowerCase();

        if (mode === 'paygate') {
            if (!webBaseUrl) {
                throw new Error('Telebirr checkout URL is not available. Telebirr did not return toPayUrl, and TELEBIRR_WEB_BASE_URL could not be derived. Ensure TELEBIRR_BASE_URL is a valid URL, or set TELEBIRR_WEB_BASE_URL explicitly.');
            }

            const otherParams = `&version=1.0&trade_type=${encodeURIComponent(String(config.tradeType || 'Checkout'))}`;
            checkoutUrl = `${webBaseUrl}${rawRequest}${otherParams}`;
        } else {
            // Legacy fallback (not recommended): requires an H5 base host.
            if (!safeNormalizedBase) {
                throw new Error('Telebirr checkout URL is not available. Telebirr did not return toPayUrl, and no H5 checkout base is configured. Set TELEBIRR_WEB_BASE_URL (recommended) or TELEBIRR_CHECKOUT_BASE_URL.');
            }
            checkoutUrl = `${safeNormalizedBase}/payId=${encodeURIComponent(String(prepayId))}`;
        }
    }

    // Final guard: never return a relative URL to the frontend (would navigate under localhost).
    if (checkoutUrl && !(checkoutUrl.startsWith('http://') || checkoutUrl.startsWith('https://'))) {
        const v = String(checkoutUrl).trim();
        if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?\/.*$/.test(v)) {
            checkoutUrl = `https://${v}`;
        }
    }

    console.info('[Telebirr] computed checkoutUrl', { checkoutUrl });

    return {
        success: true,
        checkoutUrl,
        outTradeNo,
        txRef: outTradeNo,
        telebirr: {
            prepayId,
            toPayUrl,
            ...(telebirrDebug ? { preOrder: preOrderDebug } : {}),
        },
    };
};

const telebirrVerify = async (outTradeNo) => {
    const dbConfig = await getGatewayConfig('telebirr');
    const config = {
        enabled: process.env.TELEBIRR_ENABLED === 'true' || (process.env.TELEBIRR_ENABLED === undefined && dbConfig?.enabled),
        baseUrl: preferEnvOrDb(process.env.TELEBIRR_BASE_URL, dbConfig?.baseUrl),
        fabricAppId: preferEnvOrDb(process.env.TELEBIRR_FABRIC_APP_ID, dbConfig?.fabricAppId),
        appSecret: preferEnvOrDb(process.env.TELEBIRR_APP_SECRET, dbConfig?.appSecret),
        merchantAppId: preferEnvOrDb(process.env.TELEBIRR_MERCHANT_APP_ID, dbConfig?.merchantAppId),
        merchantCode: preferEnvOrDb(process.env.TELEBIRR_MERCHANT_CODE, dbConfig?.merchantCode),
        privateKey: preferEnvOrDb(process.env.TELEBIRR_PRIVATE_KEY, dbConfig?.privateKey, { requirePem: true }),
    };

    if (config.privateKey && !config.privateKey.includes('BEGIN')) {
        return { success: false, message: 'Telebirr private key is invalid (expected PEM format)' };
    }

    if (!config.enabled || !config.fabricAppId || !config.appSecret || !config.merchantAppId || !config.merchantCode || !config.privateKey) {
        return { success: false, message: 'Telebirr configuration incomplete' };
    }

    // 1. Get Auth Token
    const fabricToken = await applyFabricToken(config);

    // 2. Query Order
    const timestamp = telebirrTools.createTimeStamp();
    const nonceStr = telebirrTools.createNonceStr();

    const reqObject = {
        timestamp: timestamp,
        nonce_str: nonceStr,
        method: 'payment.query',
        version: '1.0',
        biz_content: {
            appid: config.merchantAppId,
            merch_code: config.merchantCode,
            merch_order_id: outTradeNo,
        }
    };

    reqObject.sign = telebirrTools.signRequestObject(reqObject, config.privateKey);
    reqObject.sign_type = 'SHA256WithRSA';

    try {
        const dispatcher = getTelebirrDispatcher();
        const response = await telebirrFetch(`${config.baseUrl}/payment/v1/merchant/queryOrder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-APP-Key': config.fabricAppId,
                'Authorization': fabricToken,
            },
            body: JSON.stringify(reqObject),
            dispatcher,
        });

        const data = await response.json();

        // Based on typical Telebirr responses
        const isSuccess = data?.code === '0' &&
            (data?.biz_content?.trade_status === 'COMPLETED' ||
                data?.biz_content?.trade_status === 'SUCCESS' ||
                data?.biz_content?.trade_status === 'PAY_SUCCESS');

        return {
            success: isSuccess,
            status: data?.biz_content?.trade_status || (data?.code === '0' ? 'SUCCESS' : 'PENDING'),
            raw: data,
        };
    } catch (error) {
        const msg = String(error?.message || error || 'Telebirr verification failed');
        if (msg.toLowerCase().includes('fetch failed') || msg.toLowerCase().includes('certificate')) {
            return { success: false, message: 'Unable to reach Telebirr query endpoint. Check TELEBIRR_BASE_URL and network/TLS settings (set TELEBIRR_INSECURE_TLS=true for sandbox/self-signed).' };
        }
        return { success: false, message: error.message || 'Telebirr verification failed' };
    }
};

// ... rest of the code remains the same ...
// Commercial Bank of Ethiopia mobile money
// =============================================================================

const cbeBirrInitialize = async ({
    amount,
    phoneNumber,
    reference,
    description,
}) => {
    const config = await getGatewayConfig('cbe_birr');
    if (!config?.enabled || !config?.merchantId || !config?.apiKey) {
        throw new Error('CBE Birr is not configured');
    }

    // CBE Birr API integration
    // Note: Real implementation requires CBE merchant agreement

    console.log('CBE Birr payment request:', { amount, phoneNumber, reference });

    return {
        success: true,
        reference,
        message: 'CBE Birr integration requires production credentials',
    };
};

const cbeBirrVerify = async (reference) => {
    const config = await getGatewayConfig('cbe_birr');
    if (!config?.enabled) {
        throw new Error('CBE Birr is not configured');
    }

    return {
        success: false,
        message: 'CBE Birr verification requires production integration',
    };
};

// =============================================================================
// UNIFIED PAYMENT INTERFACE
// =============================================================================

const initializePayment = async ({
    gateway, // 'chapa', 'telebirr', 'cbe_birr'
    invoiceId,
    tenantId,
    amount,
    email,
    phone,
    firstName,
    lastName,
    callbackUrl,
    returnUrl,
}) => {
    const baseTxRef = `${invoiceId}_${Date.now()}`;

    // Telebirr requires merch_order_id to be strictly alphanumeric: ^[A-Za-z0-9]+$
    const telebirrRef = String(baseTxRef)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 64) || `T${Date.now()}`;

    switch (gateway) {
        case 'chapa':
            return chapaInitialize({
                amount,
                email,
                firstName,
                lastName,
                txRef: baseTxRef,
                callbackUrl,
                returnUrl,
                customization: {
                    title: 'MirachPOS Subscription',
                    description: `Invoice Payment - ${invoiceId}`,
                },
            });

        case 'telebirr':
            return telebirrInitialize({
                amount,
                nonce: telebirrRef,
                outTradeNo: telebirrRef,
                subject: `MirachPOS Invoice - ${invoiceId}`,
                receiveName: 'MirachPOS',
                notifyUrl: callbackUrl,
                returnUrl,
            });

        case 'cbe_birr':
            return cbeBirrInitialize({
                amount,
                phoneNumber: phone,
                reference: baseTxRef,
                description: `Invoice Payment - ${invoiceId}`,
            });

        case 'santimpay':
            return santimpayInitializeForPlatform({
                id: baseTxRef,
                amount,
                reason: `Invoice Payment - ${invoiceId}`,
                notifyUrl: callbackUrl,
                successRedirectUrl: returnUrl,
                failureRedirectUrl: returnUrl,
                cancelRedirectUrl: returnUrl,
            });

        default:
            throw new Error(`Unknown payment gateway: ${gateway}`);
    }
};

const verifyPaymentGateway = async (gateway, reference) => {
    switch (gateway) {
        case 'chapa':
            return chapaVerify(reference);
        case 'telebirr':
            return telebirrVerify(reference);
        case 'cbe_birr':
            return cbeBirrVerify(reference);
        case 'santimpay':
            return santimpayVerifyPlatform({ id: reference });
        default:
            throw new Error(`Unknown payment gateway: ${gateway}`);
    }
};

// Get available payment methods
const getAvailablePaymentMethods = async () => {
    const row = await db()
        .select(['chapa_config_json', 'telebirr_config_json', 'cbe_birr_config_json', 'bank_details_json'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

    if (!row) {
        return {
            bankTransfer: { enabled: false },
            chapa: { enabled: false },
            telebirr: { enabled: false },
            cbeBirr: { enabled: false },
        };
    }

    const bankDetails = safeJsonParse(row.bank_details_json, {});

    // Overlay ENV secrets because Super Admin saves gateway secrets into ENV.
    const chapa = safeJsonParse(row.chapa_config_json, { enabled: false });
    if (process.env.CHAPA_SECRET_KEY) chapa.secretKey = process.env.CHAPA_SECRET_KEY;
    if (process.env.CHAPA_ENABLED) chapa.enabled = process.env.CHAPA_ENABLED === 'true';

    const telebirr = safeJsonParse(row.telebirr_config_json, { enabled: false });
    if (process.env.TELEBIRR_FABRIC_APP_ID) telebirr.fabricAppId = process.env.TELEBIRR_FABRIC_APP_ID;
    if (process.env.TELEBIRR_MERCHANT_APP_ID) telebirr.merchantAppId = process.env.TELEBIRR_MERCHANT_APP_ID;
    if (process.env.TELEBIRR_MERCHANT_CODE) telebirr.merchantCode = process.env.TELEBIRR_MERCHANT_CODE;
    if (process.env.TELEBIRR_PRIVATE_KEY) telebirr.privateKey = process.env.TELEBIRR_PRIVATE_KEY;
    if (process.env.TELEBIRR_ENABLED) telebirr.enabled = process.env.TELEBIRR_ENABLED === 'true';

    const cbeBirr = safeJsonParse(row.cbe_birr_config_json, { enabled: false });

    const santim = getSantimPayPlatformConfig();

    return {
        bankTransfer: {
            enabled: Boolean(bankDetails.accountNumber),
            bankName: bankDetails.bankName || '',
            accountNumber: bankDetails.accountNumber || '',
            accountName: bankDetails.accountName || '',
            instructions: bankDetails.instructions || '',
        },
        chapa: {
            enabled: Boolean(chapa.enabled && chapa.secretKey),
            name: 'Chapa',
            description: 'Pay with Chapa (Card, Mobile Money)',
        },
        telebirr: {
            enabled: Boolean(
                telebirr.enabled &&
                (telebirr.fabricAppId || telebirr.appId) &&
                (telebirr.merchantAppId || telebirr.merchantCode) &&
                telebirr.privateKey
            ),
            name: 'Telebirr',
            description: 'Pay with Telebirr Mobile Money',
        },
        cbeBirr: {
            enabled: Boolean(cbeBirr.enabled && cbeBirr.merchantId),
            name: 'CBE Birr',
            description: 'Pay with CBE Birr Mobile Banking',
        },
        santimpay: {
            enabled: Boolean(santim.enabled && santim.merchantId && santim.privateKey),
            name: 'SantimPay',
            description: 'Pay with SantimPay (Telebirr, CBE Birr, Banks)',
        },
    };
};

module.exports = {
    getGatewayConfig,
    getTenantPosGatewayConfig,
    chapaInitialize,
    chapaVerify,
    chapaInitializeForTenantPos,
    chapaVerifyForTenantPos,
    santimpayInitializeForTenantPos,
    santimpayVerifyForTenantPos,
    santimpayInitializeForPlatform,
    santimpayVerifyPlatform,
    telebirrInitialize,
    telebirrVerify,
    cbeBirrInitialize,
    cbeBirrVerify,
    initializePayment,
    verifyPaymentGateway,
    getAvailablePaymentMethods,
};
