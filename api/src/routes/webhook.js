/**
 * Webhook Routes
 * 
 * Handles payment gateway callbacks with:
 * - Signature verification
 * - Structured logging
 * - Idempotent processing
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { verifyPayment } = require('../services/invoiceService');
const { makeId } = require('../utils/ids');
const { getGatewayConfig, verifyPaymentGateway } = require('../services/paymentGatewayService');
const { handleStandingOrderWebhook } = require('../services/telebirrStandingOrderService');
const { logger } = require('../utils/logger');

const log = logger.child({ service: 'webhooks' });

const makeWebhookRouter = () => {
    const r = express.Router();

    // =========================================================================
    // TELEBIRR STANDING ORDER WEBHOOK
    // =========================================================================
    r.post('/telebirr/standing-order-notify', async (req, res) => {
        // Telebirr expects fast ACK.
        res.status(200).json({ resultCode: '0000', resultMsg: 'success' });

        const requestId = req.requestId || makeId('whk');
        try {
            await handleStandingOrderWebhook({
                body: req.body,
                rawBody: req.rawBody ? req.rawBody.toString('utf8') : null,
            });

            log.info({ requestId }, 'Standing-order webhook processed');
        } catch (e) {
            log.error({ requestId, error: e.message, stack: e.stack }, 'Standing-order webhook processing failed');
        }
    });

    // =========================================================================
    // CHAPA WEBHOOK
    // =========================================================================
    r.post('/payment/chapa', async (req, res) => {
        const startTime = Date.now();
        const requestId = req.requestId || makeId('whk');

        log.info({ requestId, gateway: 'chapa', event: 'webhook_received' }, 'Chapa webhook received');

        try {
            const signature = req.headers['x-chapa-signature'] || req.headers['chapa-signature'];
            const config = await getGatewayConfig('chapa');

            // Get secret from env or DB
            const secret = process.env.CHAPA_WEBHOOK_SECRET || config?.webhookSecret;

            if (!secret) {
                log.error({ requestId }, 'Chapa webhook secret not configured');
                return res.status(500).send('Configuration Error');
            }

            // Verify signature - Chapa signs the request body
            const bodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
            const hash = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

            if (hash !== signature) {
                log.warn({
                    requestId,
                    received: signature?.substring(0, 20) + '...',
                    computed: hash.substring(0, 20) + '...',
                    bodyLength: bodyStr.length
                }, 'Chapa webhook signature mismatch');
                return res.status(400).send('Invalid Signature');
            }

            const { tx_ref, status, amount, currency, reference } = req.body;
            log.info({ requestId, tx_ref, status, amount, currency }, 'Chapa webhook payload');

            if (status === 'success') {
                // tx_ref format: invoiceId_timestamp
                const [invoiceId] = (tx_ref || '').split('_');

                if (!invoiceId) {
                    log.warn({ requestId, tx_ref }, 'Invalid tx_ref format');
                    return res.status(400).send('Invalid tx_ref');
                }

                const invoice = await db().select('*').from('invoices').where({ id: invoiceId }).first();
                if (!invoice) {
                    log.warn({ requestId, invoiceId }, 'Invoice not found');
                    return res.status(404).send('Invoice not found');
                }

                // Idempotency check - if already paid, return OK
                if (invoice.status === 'paid') {
                    log.info({ requestId, invoiceId }, 'Invoice already paid (idempotent)');
                    return res.status(200).send('Already Paid');
                }

                // Check for existing payment with same reference (idempotency)
                const existingPayment = await db()
                    .select(['id'])
                    .from('payments')
                    .where({ invoice_id: invoiceId, reference: reference || tx_ref })
                    .first();

                if (existingPayment) {
                    log.info({ requestId, invoiceId, paymentId: existingPayment.id }, 'Duplicate payment detected');
                    return res.status(200).send('Already Processed');
                }

                // Create Payment Record (System Verified)
                const paymentId = makeId('pay');
                const nowIso = new Date().toISOString();

                await db().from('payments').insert({
                    id: paymentId,
                    invoice_id: invoiceId,
                    tenant_id: invoice.tenant_id,
                    method: 'chapa',
                    status: 'verified',
                    amount_etb: amount,
                    currency: currency || 'ETB',
                    reference: reference || tx_ref,
                    gateway_response_json: JSON.stringify(req.body),
                    gateway_tx_id: reference,
                    verified_by: 'system',
                    verified_at: nowIso,
                    created_at: nowIso,
                    updated_at: nowIso
                });

                // Trigger Verification Logic (Activates Subscription)
                await verifyPayment({ paymentId, verifiedBy: 'system' });

                const duration = Date.now() - startTime;
                log.info({
                    requestId,
                    invoiceId,
                    paymentId,
                    amount,
                    duration
                }, 'Chapa payment verified successfully');
            }

            return res.status(200).send('OK');
        } catch (e) {
            const duration = Date.now() - startTime;
            log.error({
                requestId,
                error: e.message,
                stack: e.stack,
                duration
            }, 'Chapa webhook error');
            return res.status(500).send('Internal Server Error');
        }
    });

    // =========================================================================
    // TELEBIRR WEBHOOK (Placeholder - requires production integration)
    // =========================================================================
    r.post('/payment/telebirr', async (req, res) => {
        const startTime = Date.now();
        const requestId = req.requestId || makeId('whk');
        log.info({ requestId, gateway: 'telebirr', event: 'webhook_received' }, 'Telebirr webhook received');

        try {
            const { outTradeNo, tradeNo, totalAmount, tradeStatus } = req.body || {};
            const reference = String(outTradeNo || '').trim();
            const statusRaw = String(tradeStatus || '').trim().toUpperCase();

            if (!reference) return res.status(400).send('Missing outTradeNo');

            const [invoiceId] = reference.split('_');
            if (!invoiceId) return res.status(400).send('Invalid outTradeNo');

            const invoice = await db().select('*').from('invoices').where({ id: invoiceId }).first();
            if (!invoice) return res.status(404).send('Invoice not found');

            if (invoice.status === 'paid') {
                log.info({ requestId, invoiceId }, 'Invoice already paid (idempotent)');
                return res.status(200).send('Already Paid');
            }

            // Some integrations may send SUCCESS before settlement; we still verify against Telebirr API.
            if (statusRaw && statusRaw !== 'SUCCESS' && statusRaw !== 'COMPLETED' && statusRaw !== 'PAY_SUCCESS') {
                log.info({ requestId, invoiceId, statusRaw }, 'Telebirr webhook received non-success status');
                return res.status(200).send('OK');
            }

            const verify = await verifyPaymentGateway('telebirr', reference);
            if (!verify?.success) {
                log.warn({ requestId, invoiceId, reference, verify }, 'Telebirr verification failed');
                return res.status(200).send('OK');
            }

            const existingPayment = await db()
                .select(['id'])
                .from('payments')
                .where({ invoice_id: invoiceId, reference })
                .first();

            if (existingPayment) {
                log.info({ requestId, invoiceId, paymentId: existingPayment.id }, 'Duplicate payment detected');
                return res.status(200).send('Already Processed');
            }

            const paymentId = makeId('pay');
            const nowIso = new Date().toISOString();
            const amt = Number(totalAmount || invoice.total_etb || invoice.totalEtb || 0) || Number(invoice.total_etb || 0) || 0;

            await db().from('payments').insert({
                id: paymentId,
                invoice_id: invoiceId,
                tenant_id: invoice.tenant_id,
                method: 'telebirr',
                status: 'verified',
                amount_etb: amt,
                currency: 'ETB',
                reference,
                gateway_response_json: JSON.stringify({ webhook: req.body, verify }),
                gateway_tx_id: tradeNo || null,
                verified_by: 'system',
                verified_at: nowIso,
                created_at: nowIso,
                updated_at: nowIso,
            });

            await verifyPayment({ paymentId, verifiedBy: 'system' });

            const duration = Date.now() - startTime;
            log.info({ requestId, invoiceId, paymentId, reference, duration }, 'Telebirr payment verified successfully');
            return res.status(200).send('OK');
        } catch (e) {
            log.error({ requestId, error: e.message, stack: e.stack }, 'Telebirr webhook error');
            return res.status(500).send('Internal Server Error');
        }
    });

    // =========================================================================
    // CBE BIRR WEBHOOK (Placeholder - requires bank agreement)
    // =========================================================================
    r.post('/payment/cbe_birr', async (req, res) => {
        const requestId = req.requestId || makeId('whk');
        log.info({ requestId, gateway: 'cbe_birr', body: req.body }, 'CBE Birr webhook received');

        try {
            // TODO: Implement CBE Birr webhook verification
            // This requires:
            // 1. Verify signature/HMAC
            // 2. Extract transaction details
            // 3. Process payment

            return res.status(200).json({ ok: true, message: 'Received' });
        } catch (e) {
            log.error({ requestId, error: e.message }, 'CBE Birr webhook error');
            return res.status(500).send('Internal Server Error');
        }
    });

    // =========================================================================
    // HEALTH CHECK
    // =========================================================================
    r.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'webhooks' });
    });

    return r;
};

module.exports = { makeWebhookRouter };
