/**
 * Payment Gateway Service
 * 
 * Integrates with Ethiopian payment gateways:
 * - Chapa (https://chapa.co)
 * - Telebirr (Ethio Telecom)
 * - CBE Birr (Commercial Bank of Ethiopia)
 */

const { db } = require('../db');
const telebirrTools = require('../utils/telebirr/tools');

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

const telebirrFetch = async (url, options) => {
    try {
        return await fetch(url, options);
    } catch (e) {
        const msg = String(e?.message || e || '');
        // Some Node fetch implementations don't support undici `dispatcher` option.
        if (msg.toLowerCase().includes('not supported argument') && options && Object.prototype.hasOwnProperty.call(options, 'dispatcher')) {
            const { dispatcher, ...rest } = options;
            return await fetch(url, rest);
        }
        throw e;
    }
};

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

// Get gateway configuration
const getGatewayConfig = async (gateway) => {
    const row = await db()
        .select(['chapa_config_json', 'telebirr_config_json', 'cbe_birr_config_json'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

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
        const response = await fetch(`${CHAPA_API_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Chapa initialization failed');
        }

        return {
            success: true,
            checkoutUrl: data.data.checkout_url,
            txRef,
        };
    } catch (error) {
        console.error('Chapa initialize error:', error);
        throw error;
    }
};

const chapaVerify = async (txRef) => {
    const config = await getGatewayConfig('chapa');
    if (!config?.enabled || !config?.secretKey) {
        throw new Error('Chapa is not configured');
    }

    try {
        const response = await fetch(`${CHAPA_API_URL}/transaction/verify/${txRef}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.secretKey}`,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Chapa verification failed');
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
        console.error('Chapa verify error:', error);
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

        console.info('[Telebirr] preOrder response', {
            status: response.status,
            prepayId,
            toPayUrl,
            ...(telebirrDebug ? { debug: { hasToPayUrl: Boolean(toPayUrl) } } : {}),
        });
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
    };
};

module.exports = {
    getGatewayConfig,
    chapaInitialize,
    chapaVerify,
    telebirrInitialize,
    telebirrVerify,
    cbeBirrInitialize,
    cbeBirrVerify,
    initializePayment,
    verifyPaymentGateway,
    getAvailablePaymentMethods,
};
