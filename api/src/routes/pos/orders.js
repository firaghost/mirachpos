const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { db } = require('../../db');
const { safeJsonStringify } = require('../../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { uid } = require('../../utils/ids');
const {
  readIdempotencyKey,
  computeRequestHash,
  findIdempotentEvent,
  assertIdempotencyOrThrow,
  appendPaymentEvent,
} = require('../../services/paymentEventsService');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { logAudit } = require('../../utils/logger');
const { createOrFireTicketForOrder, EVENT_TYPE } = require('../../services/kdsService');
const { evaluateMenuCart } = require('../../services/menuEvaluationService');

const isMissingTableError = (e) => {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'ER_NO_SUCH_TABLE') return true;
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes("doesn't exist") || msg.includes('no such table');
};

const makePosOrdersRouter = ({
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
}) => {
  const r = express.Router();

  r.post(
    '/pos/print/receipt/:id',
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

        const role = String(req.auth?.role || '').trim();
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];

        const preferredDeviceId = String(req.body?.deviceId || branchRaw?.defaultReceiptPrinterId || '').trim();
        const fallbackLanDevice = devices.find((d) => String(d?.connection || '') === 'LAN' && String(d?.ip || '').trim());
        const resolvedDeviceId = preferredDeviceId || (fallbackLanDevice ? String(fallbackLanDevice.id || '') : '');
        if (!resolvedDeviceId) return res.status(400).json({ error: 'device_required' });

        const device = devices.find((d) => String(d?.id || '') === resolvedDeviceId) || fallbackLanDevice;
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
          const nowIso = new Date().toISOString();
          try {
            await db().from('print_queue').insert({
              id: uid('prq'),
              tenant_id: req.tenant.id,
              branch_id: branchId,
              order_id: orderId,
              profile: 'Receipt',
              device_id: String(resolvedDeviceId || ''),
              fallback_device_id: null,
              status: 'pending',
              error: mapped.error,
              last_error: mapped.error,
              attempts: 0,
              last_attempt_at: null,
              next_attempt_at: new Date(Date.now() + 10000).toISOString(),
              payload_json: JSON.stringify({ operatorName }),
              created_at: nowIso,
              updated_at: nowIso,
            });
            return res.status(202).json({ ok: false, queued: true, error: mapped.error });
          } catch {
            return res.status(mapped.status).json({ error: mapped.error });
          }
        }

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

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

        const idempotencyKey = readIdempotencyKey(req);
        const requestHash = computeRequestHash({ method: req.method, path: req.path, body });
        if (idempotencyKey) {
          const existing = await findIdempotentEvent({ tenantId: req.tenant.id, operation: 'pos.refund', idempotencyKey });
          assertIdempotencyOrThrow({ existing, requestHash });
          if (existing) return res.json({ ok: true, idempotent: true });
        }

        const nowIso = new Date().toISOString();
        const payload = safeJsonParse(orderRow.payload, {});
        const paymentMethod = String(payload?.paymentMethod || '').trim();
        const paymentReference = String(payload?.paymentReference || '').trim();

        const prevRefunded = Number(payload?.refundTotal ?? 0) || 0;
        const orderTotal = Number(orderRow.total || 0) || 0;
        const nextRefunded = prevRefunded + Math.abs(amount);
        const isFullRefund = nextRefunded + 1e-9 >= orderTotal;

        await db().transaction(async (trx) => {
          await trx
            .from('orders')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
            .update({ status: isFullRefund ? 'Refunded' : 'Paid', payload: JSON.stringify({
              ...(payload && typeof payload === 'object' ? payload : {}),
              refundTotal: nextRefunded,
              refunds: Array.isArray(payload?.refunds) ? [...payload.refunds, { at: nowIso, amount: Math.abs(amount), reason, performedBy: staffId, authorizedBy: authorizedByStaffId }] : [{ at: nowIso, amount: Math.abs(amount), reason, performedBy: staffId, authorizedBy: authorizedByStaffId }],
            }) });

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

          await logAudit({
            tenantId: req.tenant.id,
            branchId,
            actorStaffId: staffId,
            actorRole: String(req.auth?.role || ''),
            type: 'payment.refunded',
            summary: `Refunded order ${id}`,
            payload: { action: 'payment.refunded', meta: { orderId: id, amount, reason, paymentMethod, paymentReference, authorizedBy: authorizedByStaffId, performedBy: staffId } },
            requestId: req.requestId,
          });

          await appendPaymentEvent({
            trx,
            tenantId: req.tenant.id,
            branchId,
            domain: 'pos',
            paymentRef: `pos:order:${String(id)}`,
            orderId: String(id),
            invoiceId: null,
            operation: 'pos.refund',
            eventType: 'payment.refund.succeeded',
            fromState: 'captured',
            toState: isFullRefund ? 'refunded_full' : 'refunded_partial',
            amount: Math.abs(amount),
            currency: 'ETB',
            paymentMethod: paymentMethod || null,
            gateway: null,
            providerPaymentId: null,
            providerEventId: null,
            idempotencyKey: idempotencyKey || null,
            requestHash,
            actorType: 'staff',
            actorId: staffId,
            payload: { reason, authorizedBy: authorizedByStaffId, paymentReference },
            nowIso,
          });
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/print/kitchen/:id',
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

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];

        const preferredDeviceId = String(req.body?.deviceId || branchRaw?.defaultKitchenPrinterId || '').trim();
        const fallbackLanDevice = devices.find((d) => String(d?.connection || '') === 'LAN' && String(d?.ip || '').trim());
        const resolvedDeviceId = preferredDeviceId || (fallbackLanDevice ? String(fallbackLanDevice.id || '') : '');
        if (!resolvedDeviceId) return res.status(400).json({ error: 'device_required' });

        const device = devices.find((d) => String(d?.id || '') === resolvedDeviceId) || fallbackLanDevice;
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
    },
  );

  r.post(
    '/pos/print/bar/:id',
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

        const orderId = String(req.params?.id || '').trim();
        if (!orderId) return res.status(400).json({ error: 'order_required' });

        const branchRaw = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
        const devices = Array.isArray(branchRaw?.devices) ? branchRaw.devices : [];

        const preferredDeviceId = String(req.body?.deviceId || branchRaw?.defaultBarPrinterId || '').trim();
        const fallbackLanDevice = devices.find((d) => String(d?.connection || '') === 'LAN' && String(d?.ip || '').trim());
        const resolvedDeviceId = preferredDeviceId || (fallbackLanDevice ? String(fallbackLanDevice.id || '') : '');
        if (!resolvedDeviceId) return res.status(400).json({ error: 'device_required' });

        const device = devices.find((d) => String(d?.id || '') === resolvedDeviceId) || fallbackLanDevice;
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
    },
  );

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
    },
  );

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
    },
  );

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

        const modules = Array.isArray(req.entitlements?.subscription?.modules) ? req.entitlements.subscription.modules : [];
        const menuEnabled = modules.map((m) => String(m || '').trim().toLowerCase()).includes('menu');
        if (menuEnabled) {
          const out = await evaluateMenuCart({
            db: db(),
            tenantId: req.tenant.id,
            branchId,
            at: new Date(),
            orderType: String(nextPayload?.orderType || nextPayload?.order_type || ''),
            items: nextPayload?.items,
          });
          if (out.violations.length) return res.status(400).json({ error: 'cart_invalid', violations: out.violations });
        }

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
              // Reference is optional - only normalize if provided
              if (ref) nextPayload.paymentReference = ref;
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

        try {
          const actor = {
            staffId: req.auth?.staffId ? String(req.auth.staffId) : null,
            role: req.auth?.role ? String(req.auth.role) : null,
          };

          const actionId = `kds:auto_fire:${String(id)}`;
          const out = await createOrFireTicketForOrder({
            tenantId: String(req.tenant.id),
            branchId: String(branchId),
            orderId: String(id),
            station: 'kitchen',
            courseNo: 1,
            priority: 0,
            slaMs: null,
            actionId,
            actor,
            nowIso,
            reqLog: req.log,
          });

          if (out?.ticket?.id) {
            try {
              publish({
                tenantId: String(req.tenant.id),
                branchId: String(branchId),
                type: 'pos.kds.ticket',
                data: { ticketId: String(out.ticket.id), eventType: EVENT_TYPE.TICKET_FIRED, orderId: String(id) },
              });
            } catch {
              // ignore
            }
          }
        } catch (e) {
          if (!isMissingTableError(e)) {
            try {
              req.log?.warn({ type: 'kds_auto_fire_failed', orderId: String(id), err: String(e?.message || e) }, 'KDS auto-fire failed');
            } catch {
              // ignore
            }
          }
        }

        return res.json({ ok: true, id, createdAt: nowIso });
      } catch (e) {
        return next(e);
      }
    },
  );

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

        let computed;
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
          const modules = Array.isArray(req.entitlements?.subscription?.modules) ? req.entitlements.subscription.modules : [];
          const menuEnabled = modules.map((m) => String(m || '').trim().toLowerCase()).includes('menu');
          if (menuEnabled) {
            let removedUnavailableProductIds = [];
            const evalOnce = async () => {
              return evaluateMenuCart({
                db: db(),
                tenantId: req.tenant.id,
                branchId,
                at: new Date(),
                orderType: String(incomingPayload?.orderType || incomingPayload?.order_type || ''),
                items: incomingPayload?.items,
              });
            };

            let out = await evalOnce();
            if (out.violations.length) {
              const unavailableIds = out.violations
                .filter((v) => v && typeof v === 'object' && String(v.type || '').trim() === 'unavailable')
                .map((v) => String(v.productId || '').trim())
                .filter(Boolean);

              const hasOnlyUnavailable = unavailableIds.length > 0 && out.violations.every((v) => String(v?.type || '').trim() === 'unavailable');

              if (hasOnlyUnavailable) {
                const prevItems = Array.isArray(incomingPayload?.items) ? incomingPayload.items : [];
                incomingPayload.items = prevItems.filter((it) => !unavailableIds.includes(String(it?.productId || it?.product_id || '').trim()));
                removedUnavailableProductIds = unavailableIds;
                out = await evalOnce();
              }

              if (out.violations.length) return res.status(400).json({ error: 'cart_invalid', violations: out.violations });
            }

            req._removedUnavailableProductIds = removedUnavailableProductIds;
          }

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
                // Reference is optional - only normalize if provided
                if (ref) incomingPayload.paymentReference = ref;
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

        const removedUnavailableProductIds = Array.isArray(req._removedUnavailableProductIds) ? req._removedUnavailableProductIds : [];
        return res.json({ ok: true, removedUnavailableProductIds });
      } catch (e) {
        return next(e);
      }
    },
  );

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

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const idempotencyKey = readIdempotencyKey(req);
        const requestHash = computeRequestHash({ method: req.method, path: req.path, body });
        if (idempotencyKey) {
          const existing = await findIdempotentEvent({ tenantId: req.tenant.id, operation: 'pos.telebirr.init', idempotencyKey });
          assertIdempotencyOrThrow({ existing, requestHash });
          if (existing?.payload?.checkoutUrl && existing?.payload?.txRef) {
            return res.json({ ok: true, checkoutUrl: existing.payload.checkoutUrl, txRef: existing.payload.txRef, idempotent: true });
          }
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

        const shortOrder = String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || String(id).slice(0, 12);
        const rand = Math.random().toString(16).slice(2, 10);
        const txRef = `pos_tel_${shortOrder}_${rand}`;

        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const pgtId = uid('pgt');

        await db().transaction(async (trx) => {
          await trx.from('pos_payment_gateway_transactions').insert({
            id: pgtId,
            tenant_id: req.tenant.id,
            branch_id: branchId,
            order_id: id,
            gateway: 'telebirr',
            method: 'mobile_money',
            tx_ref: txRef,
            gateway_tx_id: null,
            checkout_url: result.checkoutUrl,
            amount: orderRow.total,
            currency: 'ETB',
            status: 'pending',
            state: 'pending_authorization',
            idempotency_key: idempotencyKey || null,
            request_hash: requestHash,
            captured_at: null,
            refunded_amount: 0,
            voided_at: null,
            expires_at: expiresAt,
            paid_at: null,
            init_response_json: JSON.stringify({ outTradeNo: result.outTradeNo || id, checkoutUrl: result.checkoutUrl }),
            verify_response_json: null,
            webhook_payload_json: null,
            created_at: nowIso,
            updated_at: nowIso,
          });

          await appendPaymentEvent({
            trx,
            tenantId: req.tenant.id,
            branchId,
            domain: 'pos',
            paymentRef: `pos:pgt:${String(pgtId)}`,
            orderId: id,
            invoiceId: null,
            operation: 'pos.telebirr.init',
            eventType: 'payment.gateway.initiated',
            fromState: 'initialized',
            toState: 'pending_authorization',
            amount: Number(orderRow.total || 0) || 0,
            currency: 'ETB',
            paymentMethod: 'Telebirr',
            gateway: 'telebirr',
            providerPaymentId: String(result.outTradeNo || id),
            providerEventId: null,
            idempotencyKey: idempotencyKey || null,
            requestHash,
            actorType: 'staff',
            actorId: staffId || null,
            payload: { checkoutUrl: result.checkoutUrl, txRef, outTradeNo: result.outTradeNo || id },
            nowIso,
          });
        });

        return res.json({ ok: true, checkoutUrl: result.checkoutUrl, outTradeNo: result.outTradeNo, txRef });
      } catch (e) {
        console.error('POS Telebirr pay error:', e);
        return res.status(400).json({ error: 'gateway_error', message: e.message });
      }
    },
  );

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
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const idempotencyKey = readIdempotencyKey(req);
        const requestHash = computeRequestHash({ method: req.method, path: req.path, body });
        if (idempotencyKey) {
          const existing = await findIdempotentEvent({ tenantId: req.tenant.id, operation: 'pos.chapa.init', idempotencyKey });
          assertIdempotencyOrThrow({ existing, requestHash });
          if (existing?.payload?.checkoutUrl && existing?.payload?.txRef) {
            return res.json({ ok: true, checkoutUrl: existing.payload.checkoutUrl, txRef: existing.payload.txRef, idempotent: true });
          }
        }

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

        const pgtId = uid('pgt');
        await db().transaction(async (trx) => {
          await trx.from('pos_payment_gateway_transactions').insert({
            id: pgtId,
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
            state: 'pending_authorization',
            idempotency_key: idempotencyKey || null,
            request_hash: requestHash,
            captured_at: null,
            refunded_amount: 0,
            voided_at: null,
            expires_at: expiresAt,
            paid_at: null,
            init_response_json: JSON.stringify(init),
            verify_response_json: null,
            webhook_payload_json: null,
            created_at: nowIso,
            updated_at: nowIso,
          });

          await appendPaymentEvent({
            trx,
            tenantId: req.tenant.id,
            branchId,
            domain: 'pos',
            paymentRef: `pos:pgt:${String(pgtId)}`,
            orderId: id,
            invoiceId: null,
            operation: 'pos.chapa.init',
            eventType: 'payment.gateway.initiated',
            fromState: 'initialized',
            toState: 'pending_authorization',
            amount: Number(orderRow.total || 0) || 0,
            currency: 'ETB',
            paymentMethod: 'Mobile Money',
            gateway: 'chapa',
            providerPaymentId: null,
            providerEventId: null,
            idempotencyKey: idempotencyKey || null,
            requestHash,
            actorType: 'staff',
            actorId: staffId || null,
            payload: { checkoutUrl: init.checkoutUrl, txRef },
            nowIso,
          });
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
    },
  );

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
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const idempotencyKey = readIdempotencyKey(req);
        const requestHash = computeRequestHash({ method: req.method, path: req.path, body });
        if (idempotencyKey) {
          const existing = await findIdempotentEvent({ tenantId: req.tenant.id, operation: 'pos.santimpay.init', idempotencyKey });
          assertIdempotencyOrThrow({ existing, requestHash });
          if (existing?.payload?.checkoutUrl && existing?.payload?.txRef) {
            return res.json({ ok: true, checkoutUrl: existing.payload.checkoutUrl, txRef: existing.payload.txRef, idempotent: true });
          }
        }

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

        const pgtId = uid('pgt');
        await db().transaction(async (trx) => {
          await trx.from('pos_payment_gateway_transactions').insert({
            id: pgtId,
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
            state: 'pending_authorization',
            idempotency_key: idempotencyKey || null,
            request_hash: requestHash,
            captured_at: null,
            refunded_amount: 0,
            voided_at: null,
            expires_at: expiresAt,
            paid_at: null,
            init_response_json: JSON.stringify(init),
            verify_response_json: null,
            webhook_payload_json: null,
            created_at: nowIso,
            updated_at: nowIso,
          });

          await appendPaymentEvent({
            trx,
            tenantId: req.tenant.id,
            branchId,
            domain: 'pos',
            paymentRef: `pos:pgt:${String(pgtId)}`,
            orderId: id,
            invoiceId: null,
            operation: 'pos.santimpay.init',
            eventType: 'payment.gateway.initiated',
            fromState: 'initialized',
            toState: 'pending_authorization',
            amount: Number(orderRow.total || 0) || 0,
            currency: 'ETB',
            paymentMethod: 'SantimPay',
            gateway: 'santimpay',
            providerPaymentId: null,
            providerEventId: null,
            idempotencyKey: idempotencyKey || null,
            requestHash,
            actorType: 'staff',
            actorId: staffId || null,
            payload: { checkoutUrl: init.checkoutUrl, txRef },
            nowIso,
          });
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
    },
  );

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
    },
  );

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
    },
  );

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
    },
  );

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
    },
  );

  r.get(
    '/pos/orders/:id/payment-timeline',
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

        const paymentRef = `pos:order:${String(id)}`;
        const events = await db()
          .from('payment_events')
          .where({ tenant_id: req.tenant.id, payment_ref: paymentRef })
          .orWhere(function () {
            this.where({ tenant_id: req.tenant.id, order_id: id });
          })
          .orderBy('created_at', 'asc')
          .select([
            'id',
            'event_type',
            'operation',
            'from_state',
            'to_state',
            'amount',
            'currency',
            'payment_method',
            'gateway',
            'provider_payment_id',
            'provider_event_id',
            'actor_type',
            'actor_id',
            'payload_json',
            'created_at',
          ]);

        const normalized = events.map((e) => ({
          id: e.id,
          eventType: e.event_type,
          operation: e.operation,
          fromState: e.from_state,
          toState: e.to_state,
          amount: e.amount,
          currency: e.currency,
          paymentMethod: e.payment_method,
          gateway: e.gateway,
          providerPaymentId: e.provider_payment_id,
          providerEventId: e.provider_event_id,
          actorType: e.actor_type,
          actorId: e.actor_id,
          payload: (() => {
            try {
              return e.payload_json ? JSON.parse(String(e.payload_json)) : null;
            } catch {
              return null;
            }
          })(),
          createdAt: e.created_at,
        }));

        return res.json({ ok: true, events: normalized });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/reports/reconciliation/payments',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('reports.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const day = String(req.query.day || '').trim();
        const method = String(req.query.method || '').trim();

        const startOfDay = day ? `${day}T00:00:00.000Z` : null;
        const endOfDay = day ? `${day}T23:59:59.999Z` : null;

        const query = db()
          .from('payment_events')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .whereIn('event_type', ['payment.capture.succeeded', 'payment.refund.succeeded']);

        if (startOfDay && endOfDay) {
          query.whereBetween('created_at', [startOfDay, endOfDay]);
        }

        if (method) {
          query.where({ payment_method: method });
        }

        const rows = await query.select([
          'event_type',
          'payment_method',
          'gateway',
          'amount',
          'currency',
          'created_at',
        ]);

        const totals = {
          captures: { count: 0, amount: 0 },
          refunds: { count: 0, amount: 0 },
          byMethod: {},
        };

        for (const r of rows) {
          const isCapture = r.event_type === 'payment.capture.succeeded';
          const isRefund = r.event_type === 'payment.refund.succeeded';
          const amt = Number(r.amount || 0) || 0;
          const key = String(r.payment_method || r.gateway || 'unknown');

          if (isCapture) {
            totals.captures.count += 1;
            totals.captures.amount += amt;
          } else if (isRefund) {
            totals.refunds.count += 1;
            totals.refunds.amount += amt;
          }

          if (!totals.byMethod[key]) {
            totals.byMethod[key] = { captures: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 } };
          }
          if (isCapture) {
            totals.byMethod[key].captures.count += 1;
            totals.byMethod[key].captures.amount += amt;
          } else if (isRefund) {
            totals.byMethod[key].refunds.count += 1;
            totals.byMethod[key].refunds.amount += amt;
          }
        }

        const net = totals.captures.amount - totals.refunds.amount;

        return res.json({
          ok: true,
          day: day || null,
          method: method || null,
          totals: {
            grossCaptures: totals.captures,
            grossRefunds: totals.refunds,
            net: { amount: net, currency: rows[0]?.currency || 'ETB' },
            byMethod: totals.byMethod,
          },
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosOrdersRouter };
