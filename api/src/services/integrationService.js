/**
 * Integration Service
 * 
 * Handles actual integration logic for third-party services
 * - Slack notifications
 * - Telegram notifications
 * - Webhook forwarding
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { logger } = require('../utils/logger');

const OUTBOUND_TIMEOUT_MS = 8000;

const isPrivateIpv4 = (host) => {
    const m = String(host || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    const parts = [a, b, c, d];
    if (parts.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return false;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;
    return false;
};

const validateOutboundUrl = (rawUrl, { allowHttp = false, allowHosts = null } = {}) => {
    const s = String(rawUrl || '').trim();
    if (!s) {
        const err = new Error('Webhook URL not configured');
        err.code = 'INTEGRATION_URL_MISSING';
        throw err;
    }

    let u;
    try {
        u = new URL(s);
    } catch {
        const err = new Error('Webhook URL is invalid');
        err.code = 'INTEGRATION_URL_INVALID';
        throw err;
    }

    const protocol = String(u.protocol || '').toLowerCase();
    if (protocol !== 'https:' && !(allowHttp && protocol === 'http:')) {
        const err = new Error('Webhook URL must be https');
        err.code = 'INTEGRATION_URL_INSECURE';
        throw err;
    }

    const host = String(u.hostname || '').trim().toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        const err = new Error('Webhook host is not allowed');
        err.code = 'INTEGRATION_HOST_BLOCKED';
        throw err;
    }
    if (isPrivateIpv4(host)) {
        const err = new Error('Webhook host is not allowed');
        err.code = 'INTEGRATION_HOST_BLOCKED';
        throw err;
    }

    if (Array.isArray(allowHosts) && allowHosts.length) {
        const ok = allowHosts.some((h) => host === String(h).toLowerCase() || host.endsWith(`.${String(h).toLowerCase()}`));
        if (!ok) {
            const err = new Error('Webhook host is not allowed');
            err.code = 'INTEGRATION_HOST_BLOCKED';
            throw err;
        }
    }

    if (u.username || u.password) {
        const err = new Error('Webhook URL must not include credentials');
        err.code = 'INTEGRATION_URL_CREDENTIALS';
        throw err;
    }

    return u;
};

const pickSafeHeaders = (headers) => {
    if (!headers || typeof headers !== 'object') return {};
    const out = {};
    const entries = Object.entries(headers);
    for (let i = 0; i < entries.length && i < 20; i++) {
        const [k0, v0] = entries[i];
        const key = String(k0 || '').trim();
        if (!key) continue;
        const lower = key.toLowerCase();
        if (lower === 'host' || lower === 'connection' || lower === 'transfer-encoding' || lower === 'content-length') continue;
        if (key.length > 64) continue;
        const val = typeof v0 === 'string' ? v0 : (v0 == null ? '' : String(v0));
        const v = val.trim();
        if (!v) continue;
        if (v.length > 512) continue;
        out[key] = v;
    }
    return out;
};

const fetchJsonWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
    } finally {
        clearTimeout(timeout);
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

// Send Slack notification
const sendSlackNotification = async ({ webhookUrl, message, channel, username = 'MirachPOS' }) => {
    try {
        validateOutboundUrl(webhookUrl, { allowHosts: ['hooks.slack.com'] });

        const payload = {
            text: message,
            username,
            icon_emoji: ':shopping_cart:',
        };

        if (channel) payload.channel = channel;

        const response = await fetchJsonWithTimeout(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Slack API error: ${error}`);
        }

        return { ok: true };
    } catch (e) {
        logger.error({ error: e.message }, 'Slack notification failed');
        return { ok: false, error: e.message };
    }
};

// Send Telegram notification
const sendTelegramNotification = async ({ botToken, chatId, message, parseMode = 'HTML' }) => {
    try {
        if (!botToken || !chatId) throw new Error('Telegram bot token or chat ID not configured');

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        const response = await fetchJsonWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode,
            }),
        });

        const data = await response.json();

        if (!data.ok) {
            throw new Error(`Telegram API error: ${data.description}`);
        }

        return { ok: true };
    } catch (e) {
        logger.error({ error: e.message }, 'Telegram notification failed');
        return { ok: false, error: e.message };
    }
};

// Forward webhook to external URL
const forwardWebhook = async ({ url, payload, headers = {} }) => {
    try {
        validateOutboundUrl(url);
        const safeHeaders = pickSafeHeaders(headers);

        const response = await fetchJsonWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...safeHeaders,
            },
            body: JSON.stringify(payload),
        });

        const responseText = await response.text();

        return {
            ok: response.ok,
            status: response.status,
            response: responseText,
        };
    } catch (e) {
        logger.error({ error: e.message, url }, 'Webhook forward failed');
        return { ok: false, error: e.message };
    }
};

// Test integration connection
const testIntegration = async ({ integrationCode, config }) => {
    const testMessage = `🧪 Test notification from MirachPOS\nIntegration: ${integrationCode}\nTime: ${new Date().toISOString()}`;

    switch (integrationCode) {
        case 'slack':
            return await sendSlackNotification({
                webhookUrl: config.webhookUrl,
                message: testMessage,
                channel: config.channel,
            });

        case 'telegram':
            return await sendTelegramNotification({
                botToken: config.botToken,
                chatId: config.chatId,
                message: testMessage,
            });

        case 'webhook':
            return await forwardWebhook({
                url: config.url,
                payload: { test: true, message: testMessage },
                headers: config.headers,
            });

        default:
            return { ok: false, error: `Unknown integration: ${integrationCode}` };
    }
};

// Send order notification via configured integrations
const sendOrderNotification = async ({ tenantId, branchId, order, eventType }) => {
    try {
        // Get tenant integrations
        const integrations = await db()
            .from('tenant_integrations')
            .where({ tenant_id: tenantId, status: 'active' })
            .select(['id', 'integration_id', 'config_json']);

        if (!integrations.length) return { ok: true, sent: 0 };

        // Get integration details from catalog
        const integrationIds = integrations.map(i => i.integration_id);
        const catalog = await db()
            .from('integrations_catalog')
            .whereIn('id', integrationIds)
            .select(['id', 'code']);

        const codeById = {};
        for (const item of catalog) {
            codeById[item.id] = item.code;
        }

        let sent = 0;
        const results = [];

        for (const integration of integrations) {
            const code = codeById[integration.integration_id];
            const config = safeJsonParse(integration.config_json, {});

            if (!code) continue;

            const message = formatOrderMessage({ order, eventType, code });
            let result;

            switch (code) {
                case 'slack':
                    result = await sendSlackNotification({
                        webhookUrl: config.webhookUrl,
                        message,
                        channel: config.channel,
                    });
                    break;

                case 'telegram':
                    result = await sendTelegramNotification({
                        botToken: config.botToken,
                        chatId: config.chatId,
                        message,
                    });
                    break;

                case 'webhook':
                    result = await forwardWebhook({
                        url: config.url,
                        payload: { event: eventType, order, tenantId, branchId },
                        headers: config.headers,
                    });
                    break;

                default:
                    continue;
            }

            results.push({ integrationId: integration.id, code, result });
            if (result.ok) sent++;
        }

        return { ok: true, sent, results };
    } catch (e) {
        logger.error({ error: e.message, tenantId, orderId: order?.id }, 'Order notification failed');
        return { ok: false, error: e.message };
    }
};

// Format order message for different integrations
const formatOrderMessage = ({ order, eventType, code }) => {
    const payload = safeJsonParse(order?.payload, {});
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const itemList = items.map(i => `• ${i.name || i.productName} x${i.qty || 1}`).join('\n');

    const emoji = {
        created: '🆕',
        paid: '💰',
        voided: '❌',
        updated: '📝',
    }[eventType] || '📦';

    if (code === 'telegram') {
        return `<b>${emoji} Order ${eventType.toUpperCase()}</b>\n\n` +
            `<b>Order #:</b> ${payload?.number || order?.id?.slice(-6)}\n` +
            `<b>Table:</b> ${payload?.tableName || 'N/A'}\n` +
            `<b>Total:</b> ETB ${order?.total || 0}\n\n` +
            `<b>Items:</b>\n${itemList || 'No items'}`;
    }

    // Slack and webhook default format
    return `${emoji} *Order ${eventType.toUpperCase()}*\n\n` +
        `*Order #:* ${payload?.number || order?.id?.slice(-6)}\n` +
        `*Table:* ${payload?.tableName || 'N/A'}\n` +
        `*Total:* ETB ${order?.total || 0}\n\n` +
        `*Items:*\n${itemList || 'No items'}`;
};

module.exports = {
    sendSlackNotification,
    sendTelegramNotification,
    forwardWebhook,
    testIntegration,
    sendOrderNotification,
};
