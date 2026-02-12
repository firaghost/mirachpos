const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makePosPrintQueueRouter = ({
  resolveBranchId,
  loadBranchSettings,
  hydratePayloadFromNormalized,
  makeKitchenTicketPayload,
  sendTcp,
  mapPrintError,
}) => {
  const r = express.Router();

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

        const basePayload = hydratePayloadFromNormalized({
          orderRow,
          payloadFallback: safeJsonParse(orderRow?.payload, {}),
          itemRows,
          splitRows,
          splitItemRows,
          paymentRows,
        });
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

  return r;
};

module.exports = { makePosPrintQueueRouter };
