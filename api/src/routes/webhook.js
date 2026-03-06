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
const jwt = require('jsonwebtoken');
const net = require('net');
const { db } = require('../db');
const { verifyPayment } = require('../services/invoiceService');
const { makeId } = require('../utils/ids');
const { getGatewayConfig, verifyPaymentGateway, getTenantPosGatewayConfig } = require('../services/paymentGatewayService');
const { handleStandingOrderWebhook } = require('../services/telebirrStandingOrderService');
const { appendPaymentEvent } = require('../services/paymentEventsService');
const { logger } = require('../utils/logger');

const log = logger.child({ service: 'webhooks' });

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        const parsed = JSON.parse(String(raw));
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

const safeAppendPaymentEvent = async (args) => {
    try {
        await appendPaymentEvent(args);
    } catch {
        // ignore (allows code deploy before migrations)
    }
};

const normalizeHeaderValue = (v) => {
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) return String(v[0] || '').trim();
    return '';
};

const timingSafeEqualHex = (a, b) => {
    const aa = String(a || '').trim();
    const bb = String(b || '').trim();
    if (!aa || !bb) return false;
    if (aa.length !== bb.length) return false;
    if ((aa.length % 2) !== 0) return false;
    if (!/^[0-9a-fA-F]+$/.test(aa) || !/^[0-9a-fA-F]+$/.test(bb)) return false;
    try {
        const ba = Buffer.from(aa, 'hex');
        const bb2 = Buffer.from(bb, 'hex');
        if (ba.length !== bb2.length) return false;
        return crypto.timingSafeEqual(ba, bb2);
    } catch {
        return false;
    }
};

const recordWebhookEvent = async ({ gateway, eventKey }) => {
    const g = String(gateway || '').trim().toLowerCase();
    const k = String(eventKey || '').trim();
    if (!g || !k) return { ok: true, duplicate: false };

    try {
        const nowIso = new Date().toISOString();
        await db().from('webhook_events').insert({ gateway: g, event_key: k, created_at: nowIso });
        return { ok: true, duplicate: false };
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        const code = String(e && e.code ? e.code : '');
        const isDup = code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT' || msg.toLowerCase().includes('duplicate');
        if (isDup) return { ok: true, duplicate: true };
        return { ok: false, duplicate: false };
    }
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

const syncRestaurantTableForOrder = async ({ tenantId, branchId, tableId, orderId, nextStatus, nowIso }) => {
    try {
        const tid = String(tenantId || '').trim();
        const bid = String(branchId || '').trim();
        const tbl = String(tableId || '').trim();
        const oid = String(orderId || '').trim();
        const st = String(nextStatus || '').trim();
        if (!tid || !bid || !tbl || !oid) return;

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

const makeWebhookRouter = () => {
    const r = express.Router();

    r.post('/chapa', async (req, res) => {
        const sig = String(req.headers['chapa-signature'] || '').trim();
        if (!sig) return res.status(401).send('Missing Signature');
        return res.status(200).send('OK');
    });

    r.post('/telebirr', async (_req, res) => res.status(200).send('OK'));
    r.post('/santimpay', async (_req, res) => res.status(200).send('OK'));

    // =========================================================================
    // TELEBIRR STANDING ORDER WEBHOOK
    // =========================================================================
    r.post('/telebirr/standing-order-notify', async (req, res) => {
        // Telebirr expects fast ACK.
        res.status(200).json({ resultCode: '0000', resultMsg: 'success' });

        const requestId = req.requestId || makeId('whk');
        try {
            const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
            const key = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 48);
            const seen = await recordWebhookEvent({ gateway: 'telebirr_standing_order', eventKey: key });
            if (seen.ok && seen.duplicate) return;

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
            const signature = normalizeHeaderValue(req.headers['x-chapa-signature'] || req.headers['chapa-signature']);

            // Resolve webhook secret by scope:
            // - POS payments: tenant-owned secret from tenant_pos_payment_gateways
            // - Subscription invoices: platform secret from platform_payment_config / env
            const txRef0 = String(req.body?.tx_ref || req.body?.txRef || '').trim();

            let secret = '';
            if (txRef0) {
                const posTx = await db().select(['tenant_id']).from('pos_payment_gateway_transactions').where({ tx_ref: txRef0, gateway: 'chapa' }).first();
                const tenantId = posTx?.tenant_id ? String(posTx.tenant_id).trim() : '';
                if (tenantId) {
                    const tcfg = await getTenantPosGatewayConfig(tenantId, 'chapa');
                    secret = String(tcfg?.config?.webhookSecret || '').trim();
                }
            }

            // Fallback to platform webhook secret for subscription billing
            if (!secret) {
                const config = await getGatewayConfig('chapa');
                secret = String(process.env.CHAPA_WEBHOOK_SECRET || config?.webhookSecret || '').trim();
            }

            if (!secret) {
                log.error({ requestId }, 'Chapa webhook secret not configured');
                return res.status(500).send('Configuration Error');
            }

            // Verify signature - Chapa signs the request body
            const bodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
            const hash = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

            if (!timingSafeEqualHex(hash, signature)) {
                log.warn({
                    requestId,
                    received: signature?.substring(0, 20) + '...',
                    computed: hash.substring(0, 20) + '...',
                    bodyLength: bodyStr.length
                }, 'Chapa webhook signature mismatch');
                return res.status(400).send('Invalid Signature');
            }

            const statusRaw = String(req.body?.status || '').trim();
            const txRefKey = txRef0 ? `tx_ref:${txRef0}|status:${statusRaw || '-'}` : `body:${hash.slice(0, 48)}`;
            const seen = await recordWebhookEvent({ gateway: 'chapa', eventKey: txRefKey });
            if (seen.ok && seen.duplicate) return res.status(200).send('OK');

            await safeAppendPaymentEvent({
                tenantId: txRef0 ? (await db().select(['tenant_id']).from('pos_payment_gateway_transactions').where({ tx_ref: txRef0, gateway: 'chapa' }).first())?.tenant_id || null : null,
                branchId: null,
                domain: 'webhook',
                paymentRef: txRef0 ? `webhook:chapa:${txRef0}` : `webhook:chapa:${hash.slice(0, 16)}`,
                orderId: null,
                invoiceId: null,
                operation: 'webhook.chapa',
                eventType: 'webhook.received',
                fromState: null,
                toState: null,
                amount: req.body?.amount != null ? Number(req.body.amount) : null,
                currency: req.body?.currency || null,
                paymentMethod: null,
                gateway: 'chapa',
                providerPaymentId: txRef0 || null,
                providerEventId: String(req.body?.reference || '').trim() || null,
                idempotencyKey: null,
                requestHash: hash,
                actorType: 'webhook',
                actorId: null,
                payload: req.body || null,
                nowIso: new Date().toISOString(),
            });

            const { tx_ref, status, amount, currency, reference } = req.body;
            log.info({ requestId, tx_ref, status, amount, currency }, 'Chapa webhook payload');

            if (status === 'success') {
                const txRef = String(tx_ref || '').trim();

                const posTx = txRef
                    ? await db()
                        .select(['*'])
                        .from('pos_payment_gateway_transactions')
                        .where({ tx_ref: txRef, gateway: 'chapa' })
                        .first()
                    : null;

                if (posTx?.id) {
                    const tenantId = String(posTx.tenant_id || '').trim();
                    const branchId = String(posTx.branch_id || '').trim();
                    const orderId = String(posTx.order_id || '').trim();

                    if (!tenantId || !branchId || !orderId) {
                        log.warn({ requestId, txRef, tenantId, branchId, orderId }, 'POS Chapa tx missing scope');
                        return res.status(200).send('OK');
                    }

                    const orderRow = await db()
                        .from('orders')
                        .where({ tenant_id: tenantId, branch_id: branchId, id: orderId })
                        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload', 'created_at'])
                        .first();

                    if (!orderRow) {
                        log.warn({ requestId, tenantId, branchId, orderId, txRef }, 'Order not found for POS Chapa tx');
                        return res.status(200).send('OK');
                    }

                    if (String(orderRow.status || '') === 'Paid') {
                        await db()
                            .from('pos_payment_gateway_transactions')
                            .where({ id: posTx.id })
                            .update({
                                status: 'completed',
                                state: 'captured',
                                paid_at: orderRow.paid_at || new Date().toISOString(),
                                captured_at: orderRow.paid_at || new Date().toISOString(),
                                webhook_payload_json: JSON.stringify(req.body),
                                updated_at: new Date().toISOString(),
                            });

                        log.info({ requestId, tenantId, branchId, orderId, txRef }, 'Order already paid (idempotent)');
                        return res.status(200).send('Already Paid');
                    }

                    const nowIso = new Date().toISOString();
                    const payload = safeJsonParse(orderRow.payload, {});
                    payload.paidAt = nowIso;
                    payload.paymentMethod = 'Mobile Money';
                    payload.paymentReference = txRef;
                    payload.chapaWebhook = req.body;

                    await db().from('orders').where({ tenant_id: tenantId, branch_id: branchId, id: orderId }).update({
                        status: 'Paid',
                        paid_at: nowIso,
                        payload: JSON.stringify(payload),
                    });

                    try {
                        const tableId = typeof payload?.tableId === 'string' ? payload.tableId.trim() : '';
                        if (tableId) {
                            await syncRestaurantTableForOrder({ tenantId, branchId, tableId, orderId, nextStatus: 'Paid', nowIso });
                        }
                    } catch {
                        // ignore
                    }

                    await db().from('pos_payment_gateway_transactions').where({ id: posTx.id }).update({
                        status: 'completed',
                        state: 'captured',
                        paid_at: nowIso,
                        captured_at: nowIso,
                        webhook_payload_json: JSON.stringify(req.body),
                        updated_at: nowIso,
                    });

                    await safeAppendPaymentEvent({
                        tenantId,
                        branchId,
                        domain: 'pos',
                        paymentRef: `pos:pgt:${String(posTx.id)}`,
                        orderId,
                        invoiceId: null,
                        operation: 'pos.capture',
                        eventType: 'payment.capture.succeeded',
                        fromState: String(posTx.state || 'pending_authorization'),
                        toState: 'captured',
                        amount: Number(orderRow.total || 0) || 0,
                        currency: 'ETB',
                        paymentMethod: 'Mobile Money',
                        gateway: 'chapa',
                        providerPaymentId: String(txRef),
                        providerEventId: String(reference || '').trim() || null,
                        idempotencyKey: null,
                        requestHash: hash,
                        actorType: 'webhook',
                        actorId: null,
                        payload: req.body || null,
                        nowIso,
                    });

                    try {
                        const branchRaw = await loadBranchSettings({ tenantId, branchId });
                        const enabled = branchRaw?.receipt?.autoPrintReceipts === true || branchRaw?.autoPrintReceipts === true;
                        const deviceId = String(branchRaw?.defaultReceiptPrinterId || '').trim();
                        if (enabled && deviceId) {
                            const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];
                            const device = devices.find((d) => String(d?.id || '') === deviceId);
                            if (device && String(device?.connection || '') === 'LAN') {
                                const host = String(device?.ip || '').trim();
                                const port = String(device?.port || '9100').trim();
                                const orderRow2 = await db()
                                    .from('orders')
                                    .where({ tenant_id: tenantId, branch_id: branchId, id: orderId })
                                    .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'created_at', 'payload'])
                                    .first();

                                if (orderRow2) {
                                    const printPayload = makeReceiptPayloadFromOrder({ orderRow: orderRow2 });
                                    await sendTcp({ host, port, data: printPayload, timeoutMs: 8000 });
                                }
                            }
                        }
                    } catch (printErr) {
                        log.error({ requestId, tenantId, branchId, orderId, error: String(printErr?.message || printErr || '') }, 'Auto-print receipt failed for POS Chapa payment');
                    }

                    const duration = Date.now() - startTime;
                    log.info({ requestId, tenantId, branchId, orderId, txRef, amount, duration }, 'POS Chapa payment processed successfully');
                    return res.status(200).send('OK');
                }

                // tx_ref format: invoiceId_timestamp
                const [invoiceId] = (txRef || '').split('_');

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
                    .where({ invoice_id: invoiceId, reference: reference || txRef })
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
                    state: 'captured',
                    amount_etb: amount,
                    currency: currency || 'ETB',
                    reference: reference || txRef,
                    gateway_response_json: JSON.stringify(req.body),
                    gateway_tx_id: reference,
                    provider: 'chapa',
                    provider_payment_id: reference || txRef,
                    authorized_amount: 0,
                    captured_amount: Number(amount || 0) || 0,
                    refunded_amount: 0,
                    last_idempotency_key: null,
                    verified_by: 'system',
                    verified_at: nowIso,
                    created_at: nowIso,
                    updated_at: nowIso
                });

                await safeAppendPaymentEvent({
                    tenantId: invoice.tenant_id,
                    branchId: null,
                    domain: 'billing',
                    paymentRef: `billing:payment:${String(paymentId)}`,
                    orderId: null,
                    invoiceId,
                    operation: 'billing.capture',
                    eventType: 'payment.capture.succeeded',
                    fromState: 'pending_authorization',
                    toState: 'captured',
                    amount: Number(amount || 0) || 0,
                    currency: currency || 'ETB',
                    paymentMethod: 'chapa',
                    gateway: 'chapa',
                    providerPaymentId: String(reference || txRef || ''),
                    providerEventId: String(reference || '').trim() || null,
                    idempotencyKey: null,
                    requestHash: hash,
                    actorType: 'webhook',
                    actorId: null,
                    payload: req.body || null,
                    nowIso,
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
    // SANTIMPAY WEBHOOK (POS + SUBSCRIPTIONS)
    // =========================================================================
    r.post('/payment/santimpay', async (req, res) => {
        const requestId = req.requestId || makeId('whk');
        try {
            const signedTokenHeader = req.headers['signed-token'] || req.headers['Signed-Token'] || req.headers['Signed-token'];
            const signedToken = typeof signedTokenHeader === 'string' ? signedTokenHeader.trim() : Array.isArray(signedTokenHeader) ? String(signedTokenHeader[0] || '').trim() : '';

            // SantimPay callback includes:
            // - txnId: SantimPay transaction id
            // - thirdPartyId: merchant-provided id (our reference)
            // Some payloads may also use clientReference.
            const merchantRef = String(req.body?.thirdPartyId || req.body?.thirdPartyID || req.body?.clientReference || req.body?.id || '').trim();
            const txnId = String(req.body?.txnId || '').trim();
            if (!merchantRef && !txnId) return res.status(400).send('Missing reference');

            const status = String(req.body?.Status || req.body?.status || '').trim().toUpperCase();

            const dedupeKey = txnId
                ? `txn:${txnId}|status:${status || '-'}`
                : merchantRef
                    ? `ref:${merchantRef}|status:${status || '-'}`
                    : '';
            const seen = await recordWebhookEvent({ gateway: 'santimpay', eventKey: dedupeKey });
            if (seen.ok && seen.duplicate) return res.status(200).send('OK');

            const posTx = merchantRef
                ? await db().select(['*']).from('pos_payment_gateway_transactions').where({ tx_ref: merchantRef, gateway: 'santimpay' }).first()
                : null;

            const isPos = Boolean(posTx?.id);

            const tenantId = isPos ? String(posTx.tenant_id || '').trim() : '';
            const branchId = isPos ? String(posTx.branch_id || '').trim() : '';
            const orderId = isPos ? String(posTx.order_id || '').trim() : '';

            await safeAppendPaymentEvent({
                tenantId: tenantId || null,
                branchId: branchId || null,
                domain: isPos ? 'pos' : 'billing',
                paymentRef: merchantRef ? `webhook:santimpay:${merchantRef}` : `webhook:santimpay:${txnId}`,
                orderId: isPos ? orderId : null,
                invoiceId: null,
                operation: 'webhook.santimpay',
                eventType: 'webhook.received',
                fromState: null,
                toState: null,
                amount: req.body?.totalAmount != null ? Number(req.body.totalAmount) : null,
                currency: 'ETB',
                paymentMethod: null,
                gateway: 'santimpay',
                providerPaymentId: merchantRef || null,
                providerEventId: txnId || null,
                idempotencyKey: null,
                requestHash: merchantRef ? crypto.createHash('sha256').update(merchantRef).digest('hex') : null,
                actorType: 'webhook',
                actorId: null,
                payload: req.body || null,
                nowIso: new Date().toISOString(),
            });

            const publicKey = (() => {
                if (isPos && tenantId) {
                    return getTenantPosGatewayConfig(tenantId, 'santimpay').then((tcfg) => String(tcfg?.config?.publicKey || '').trim());
                }
                return Promise.resolve(String(process.env.SANTIMPAY_PUBLIC_KEY || '').trim());
            })();

            if (!signedToken) {
                log.warn({ requestId, merchantRef, scope: isPos ? 'pos' : 'subscription' }, 'SantimPay missing Signed-Token header');
                return res.status(400).send('Missing Signed-Token');
            }

            try {
                const pk = await publicKey;
                if (!pk) {
                    log.error({ requestId, scope: isPos ? 'pos' : 'subscription' }, 'SantimPay public key not configured');
                    return res.status(500).send('Configuration Error');
                }
                jwt.verify(signedToken, pk, { algorithms: ['ES256'] });
            } catch (e) {
                log.warn({ requestId, merchantRef, err: String(e?.message || e || '') }, 'SantimPay Signed-Token verification failed');
                return res.status(400).send('Invalid Signature');
            }

            // POS path
            if (isPos) {
                if (status !== 'COMPLETED') {
                    await db().from('pos_payment_gateway_transactions').where({ id: posTx.id }).update({
                        webhook_payload_json: JSON.stringify(req.body),
                        updated_at: new Date().toISOString(),
                    });
                    return res.status(200).send('OK');
                }

                const orderRow = await db()
                    .from('orders')
                    .where({ tenant_id: tenantId, branch_id: branchId, id: orderId })
                    .select(['id', 'status', 'paid_at', 'payload'])
                    .first();
                if (!orderRow) return res.status(200).send('OK');

                const nowIso = new Date().toISOString();
                if (String(orderRow.status || '') !== 'Paid') {
                    const payload = safeJsonParse(orderRow.payload, {});
                    payload.paidAt = nowIso;
                    payload.paymentMethod = 'SantimPay';
                    payload.santimpayWebhook = req.body;

                    await db().from('orders').where({ tenant_id: tenantId, branch_id: branchId, id: orderId }).update({
                        status: 'Paid',
                        paid_at: nowIso,
                        payload: JSON.stringify(payload),
                    });

                    try {
                        const tableId = typeof payload?.tableId === 'string' ? payload.tableId.trim() : '';
                        if (tableId) {
                            await syncRestaurantTableForOrder({ tenantId, branchId, tableId, orderId, nextStatus: 'Paid', nowIso });
                        }
                    } catch {
                        // ignore
                    }
                }

                await db().from('pos_payment_gateway_transactions').where({ id: posTx.id }).update({
                    status: 'completed',
                    state: 'captured',
                    paid_at: orderRow.paid_at || nowIso,
                    captured_at: orderRow.paid_at || nowIso,
                    webhook_payload_json: JSON.stringify(req.body),
                    updated_at: nowIso,
                });

                await safeAppendPaymentEvent({
                    tenantId,
                    branchId,
                    domain: 'pos',
                    paymentRef: `pos:pgt:${String(posTx.id)}`,
                    orderId,
                    invoiceId: null,
                    operation: 'pos.capture',
                    eventType: 'payment.capture.succeeded',
                    fromState: String(posTx.state || 'pending_authorization'),
                    toState: 'captured',
                    amount: Number(posTx.amount || 0) || 0,
                    currency: String(posTx.currency || 'ETB'),
                    paymentMethod: 'SantimPay',
                    gateway: 'santimpay',
                    providerPaymentId: merchantRef,
                    providerEventId: txnId || null,
                    idempotencyKey: null,
                    requestHash: null,
                    actorType: 'webhook',
                    actorId: null,
                    payload: req.body || null,
                    nowIso,
                });

                return res.status(200).send('OK');
            }

            // Subscription path
            if (!merchantRef) return res.status(200).send('OK');
            const invoiceId = String(merchantRef).split('_')[0] || '';
            if (!invoiceId) return res.status(200).send('OK');

            const invoice = await db().select('*').from('invoices').where({ id: invoiceId }).first();
            if (!invoice) return res.status(200).send('OK');

            if (String(invoice.status || '') === 'paid') {
                return res.status(200).send('Already Paid');
            }

            if (status !== 'COMPLETED') {
                return res.status(200).send('OK');
            }

            const existingPayment = await db()
                .select(['id'])
                .from('payments')
                .where({ invoice_id: invoiceId, reference: merchantRef })
                .first();
            if (existingPayment?.id) {
                return res.status(200).send('Already Processed');
            }

            const paymentId = makeId('pay');
            const nowIso = new Date().toISOString();
            const amt = Number(req.body?.totalAmount || req.body?.amount || invoice.total_etb || 0) || Number(invoice.total_etb || 0) || 0;

            await db().from('payments').insert({
                id: paymentId,
                invoice_id: invoiceId,
                tenant_id: invoice.tenant_id,
                method: 'santimpay',
                status: 'verified',
                state: 'captured',
                amount_etb: amt,
                currency: 'ETB',
                reference: merchantRef,
                gateway_response_json: JSON.stringify(req.body),
                gateway_tx_id: txnId || null,
                provider: 'santimpay',
                provider_payment_id: txnId || merchantRef,
                authorized_amount: 0,
                captured_amount: amt,
                refunded_amount: 0,
                last_idempotency_key: null,
                verified_by: 'system',
                verified_at: nowIso,
                created_at: nowIso,
                updated_at: nowIso,
            });

            await safeAppendPaymentEvent({
                tenantId: invoice.tenant_id,
                branchId: null,
                domain: 'billing',
                paymentRef: `billing:payment:${String(paymentId)}`,
                orderId: null,
                invoiceId,
                operation: 'billing.capture',
                eventType: 'payment.capture.succeeded',
                fromState: 'pending_authorization',
                toState: 'captured',
                amount: amt,
                currency: 'ETB',
                paymentMethod: 'santimpay',
                gateway: 'santimpay',
                providerPaymentId: String(txnId || merchantRef || ''),
                providerEventId: String(txnId || ''),
                idempotencyKey: null,
                requestHash: null,
                actorType: 'webhook',
                actorId: null,
                payload: req.body || null,
                nowIso,
            });

            await verifyPayment({ paymentId, verifiedBy: 'system' });

            return res.status(200).send('OK');
        } catch (e) {
            log.error({ requestId, error: e.message, stack: e.stack }, 'SantimPay webhook error');
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

            const seen = await recordWebhookEvent({ gateway: 'telebirr', eventKey: `ref:${reference}|status:${statusRaw || '-'}` });
            if (seen.ok && seen.duplicate) return res.status(200).send('OK');

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
    // HEALTH CHECK
    // =========================================================================
    r.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'webhooks' });
    });

    return r;
};

module.exports = { makeWebhookRouter };
