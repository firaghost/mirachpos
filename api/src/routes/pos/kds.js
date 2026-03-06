const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { requireKdsFeature } = require('../../middleware/subscriptionEnforcement');
const { publish } = require('../../services/realtimeHub');
const { db } = require('../../db');
const {
  createOrFireTicketForOrder,
  transitionTicket,
  listBoard,
  TICKET_STATUS,
  EVENT_TYPE,
} = require('../../services/kdsService');

const {
  validateBody,
  validateQuery,
  validateParams,
  kdsFireSchema,
  kdsTicketActionSchema,
  kdsBoardQuerySchema,
  idParamSchema,
} = require('../../middleware/validators');

const isMissingTableError = (e) => {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'ER_NO_SUCH_TABLE') return true;
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes("doesn't exist") || msg.includes('no such table');
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

const safeJsonParse = (raw, fallback) => {
  try {
    if (raw == null) return fallback;
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
};

const syncOrderAndTableStatus = async ({ tenantId, branchId, orderId, nextStatus, nowIso }) => {
  const tid = String(tenantId || '').trim();
  const bid = String(branchId || '').trim();
  const oid = String(orderId || '').trim();
  const st = String(nextStatus || '').trim();
  if (!tid || !bid || !oid || !st) return;

  const row = await db()
    .from('orders')
    .where({ tenant_id: tid, branch_id: bid, id: oid })
    .select(['status', 'payload'])
    .first();
  if (!row) return;

  const cur = String(row.status || '').trim();
  if (cur === 'Paid' || cur === 'Voided' || cur === 'Refunded') return;

  if (cur !== st) {
    await db().from('orders').where({ tenant_id: tid, branch_id: bid, id: oid }).update({ status: st, updated_at: nowIso });
  }

  const payload = safeJsonParse(row.payload, null);
  const tableId =
    typeof payload?.tableId === 'string'
      ? payload.tableId.trim()
      : typeof payload?.table_id === 'string'
        ? payload.table_id.trim()
        : '';
  if (!tableId) return;

  await db()
    .from('restaurant_tables')
    .where({ tenant_id: tid, branch_id: bid, id: tableId })
    .update({ status: mapTableStatusFromOrderStatus(st), open_order_id: oid, last_order_id: oid, updated_at: nowIso });
};

const makePosKdsRouter = ({ resolveBranchId } = {}) => {
  const r = express.Router();

  const requirePosRole = requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager');

  r.post(
    '/pos/kds/tickets/fire',
    tenantMiddleware,
    requireAuth,
    requirePosRole,
    loadEntitlements,
    requireModule('pos'),
    requireKdsFeature,
    requirePermission('orders.update'),
    validateBody(kdsFireSchema),
    async (req, res, next) => {
      try {
        const branchId = resolveBranchId ? await resolveBranchId(req) : String(req.query?.branchId || '').trim();
        if (!branchId) return res.status(400).json({ error: 'branch_required', requestId: req.requestId });

        const body = req.validatedBody;
        const nowIso = new Date().toISOString();

        const actor = {
          staffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          role: req.auth?.role ? String(req.auth.role) : null,
        };

        const out = await createOrFireTicketForOrder({
          tenantId: String(req.tenant.id),
          branchId,
          orderId: String(body.orderId),
          station: String(body.station),
          courseNo: body.courseNo,
          priority: body.priority,
          slaMs: body.slaMs,
          actionId: String(body.actionId),
          actor,
          nowIso,
          reqLog: req.log,
        });

        try {
          await syncOrderAndTableStatus({
            tenantId: String(req.tenant.id),
            branchId,
            orderId: String(body.orderId),
            nextStatus: 'Cooking',
            nowIso,
          });
        } catch {
          // ignore
        }

        try {
          if (out?.ticket?.id) {
            publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.kds.ticket', data: { ticketId: String(out.ticket.id), eventType: EVENT_TYPE.TICKET_FIRED } });
          }
        } catch {
          // ignore
        }

        return res.status(out.idempotent ? 200 : 201).json({ ok: true, ticket: out.ticket, idempotent: out.idempotent });
      } catch (e) {
        if (e?.code === 'order_not_found') return res.status(404).json({ error: 'order_not_found', requestId: req.requestId });
        return next(e);
      }
    },
  );

  const ticketIdParamsSchema = idParamSchema;

  r.post(
    '/pos/kds/tickets/:id/ready',
    tenantMiddleware,
    requireAuth,
    requirePosRole,
    loadEntitlements,
    requireModule('pos'),
    requireKdsFeature,
    requirePermission('orders.update'),
    validateParams(ticketIdParamsSchema),
    validateBody(kdsTicketActionSchema),
    async (req, res, next) => {
      try {
        const branchId = resolveBranchId ? await resolveBranchId(req) : String(req.query?.branchId || '').trim();
        if (!branchId) return res.status(400).json({ error: 'branch_required', requestId: req.requestId });

        const ticketId = String(req.validatedParams.id);
        const body = req.validatedBody;
        const nowIso = new Date().toISOString();

        const actor = {
          staffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          role: req.auth?.role ? String(req.auth.role) : null,
        };

        const out = await transitionTicket({
          tenantId: String(req.tenant.id),
          branchId,
          ticketId,
          toStatus: TICKET_STATUS.READY,
          eventType: EVENT_TYPE.TICKET_READY,
          actionId: String(body.actionId),
          actor,
          nowIso,
          reqLog: req.log,
        });

        try {
          const orderId = out?.ticket?.order_id ? String(out.ticket.order_id) : '';
          if (orderId) {
            await syncOrderAndTableStatus({
              tenantId: String(req.tenant.id),
              branchId,
              orderId,
              nextStatus: 'Ready',
              nowIso,
            });
          }
        } catch {
          // ignore
        }

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.kds.ticket', data: { ticketId, eventType: EVENT_TYPE.TICKET_READY } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, ticket: out.ticket, idempotent: out.idempotent });
      } catch (e) {
        if (e?.code === 'ticket_not_found') return res.status(404).json({ error: 'ticket_not_found', requestId: req.requestId });
        if (e?.code === 'illegal_transition') return res.status(409).json({ error: 'illegal_transition', meta: e.meta || null, requestId: req.requestId });
        return next(e);
      }
    },
  );

  r.post(
    '/pos/kds/tickets/:id/bump',
    tenantMiddleware,
    requireAuth,
    requirePosRole,
    loadEntitlements,
    requireModule('pos'),
    requireKdsFeature,
    requirePermission('orders.update'),
    validateParams(ticketIdParamsSchema),
    validateBody(kdsTicketActionSchema),
    async (req, res, next) => {
      try {
        const branchId = resolveBranchId ? await resolveBranchId(req) : String(req.query?.branchId || '').trim();
        if (!branchId) return res.status(400).json({ error: 'branch_required', requestId: req.requestId });

        const ticketId = String(req.validatedParams.id);
        const body = req.validatedBody;
        const nowIso = new Date().toISOString();

        const actor = {
          staffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          role: req.auth?.role ? String(req.auth.role) : null,
        };

        const out = await transitionTicket({
          tenantId: String(req.tenant.id),
          branchId,
          ticketId,
          toStatus: TICKET_STATUS.BUMPED,
          eventType: EVENT_TYPE.TICKET_BUMPED,
          actionId: String(body.actionId),
          actor,
          nowIso,
          reqLog: req.log,
        });

        try {
          const orderId = out?.ticket?.order_id ? String(out.ticket.order_id) : '';
          if (orderId) {
            await syncOrderAndTableStatus({
              tenantId: String(req.tenant.id),
              branchId,
              orderId,
              nextStatus: 'Served',
              nowIso,
            });
          }
        } catch {
          // ignore
        }

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.kds.ticket', data: { ticketId, eventType: EVENT_TYPE.TICKET_BUMPED } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, ticket: out.ticket, idempotent: out.idempotent });
      } catch (e) {
        if (e?.code === 'ticket_not_found') return res.status(404).json({ error: 'ticket_not_found', requestId: req.requestId });
        if (e?.code === 'illegal_transition') return res.status(409).json({ error: 'illegal_transition', meta: e.meta || null, requestId: req.requestId });
        return next(e);
      }
    },
  );

  r.post(
    '/pos/kds/tickets/:id/recall',
    tenantMiddleware,
    requireAuth,
    requirePosRole,
    loadEntitlements,
    requireModule('pos'),
    requireKdsFeature,
    requirePermission('orders.update'),
    validateParams(ticketIdParamsSchema),
    validateBody(kdsTicketActionSchema),
    async (req, res, next) => {
      try {
        const branchId = resolveBranchId ? await resolveBranchId(req) : String(req.query?.branchId || '').trim();
        if (!branchId) return res.status(400).json({ error: 'branch_required', requestId: req.requestId });

        const ticketId = String(req.validatedParams.id);
        const body = req.validatedBody;
        const nowIso = new Date().toISOString();

        const actor = {
          staffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          role: req.auth?.role ? String(req.auth.role) : null,
        };

        const out = await transitionTicket({
          tenantId: String(req.tenant.id),
          branchId,
          ticketId,
          toStatus: TICKET_STATUS.RECALLED,
          eventType: EVENT_TYPE.TICKET_RECALLED,
          actionId: String(body.actionId),
          actor,
          nowIso,
          reqLog: req.log,
        });

        try {
          const orderId = out?.ticket?.order_id ? String(out.ticket.order_id) : '';
          if (orderId) {
            await syncOrderAndTableStatus({
              tenantId: String(req.tenant.id),
              branchId,
              orderId,
              nextStatus: 'Cooking',
              nowIso,
            });
          }
        } catch {
          // ignore
        }

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.kds.ticket', data: { ticketId, eventType: EVENT_TYPE.TICKET_RECALLED } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, ticket: out.ticket, idempotent: out.idempotent });
      } catch (e) {
        if (e?.code === 'ticket_not_found') return res.status(404).json({ error: 'ticket_not_found', requestId: req.requestId });
        if (e?.code === 'illegal_transition') return res.status(409).json({ error: 'illegal_transition', meta: e.meta || null, requestId: req.requestId });
        return next(e);
      }
    },
  );

  r.get(
    '/pos/kds/board',
    tenantMiddleware,
    requireAuth,
    requirePosRole,
    loadEntitlements,
    requireModule('pos'),
    requireKdsFeature,
    requirePermission('orders.read'),
    validateQuery(kdsBoardQuerySchema),
    async (req, res, next) => {
      try {
        const branchId = resolveBranchId ? await resolveBranchId(req) : String(req.query?.branchId || '').trim();
        if (!branchId) return res.status(400).json({ error: 'branch_required', requestId: req.requestId });

        const q = req.validatedQuery;
        const board = await listBoard({
          tenantId: String(req.tenant.id),
          branchId,
          station: q.station || '',
          status: q.status || '',
          limit: q.limit,
        });

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, board });
      } catch (e) {
        if (isMissingTableError(e)) {
          try {
            req.log?.warn(
              { type: 'kds_board_missing_tables', requestId: req.requestId, tenantId: req.tenant?.id, branchId: req.query?.branchId || null },
              'KDS tables missing; returning empty board',
            );
          } catch {
            // ignore
          }
          return res.json({ ok: true, tenantId: req.tenant.id, branchId: String(req.query?.branchId || '') || null, board: [] });
        }
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosKdsRouter };
