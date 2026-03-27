const { db } = require('../db');
const { uid } = require('../utils/ids');

const TICKET_STATUS = {
  NEW: 'NEW',
  FIRED: 'FIRED',
  IN_PREP: 'IN_PREP',
  READY: 'READY',
  BUMPED: 'BUMPED',
  RECALLED: 'RECALLED',
  CANCELLED: 'CANCELLED',
};

const EVENT_TYPE = {
  TICKET_CREATED: 'kds.ticket.created',
  TICKET_FIRED: 'kds.ticket.fired',
  TICKET_READY: 'kds.ticket.ready',
  TICKET_BUMPED: 'kds.ticket.bumped',
  TICKET_RECALLED: 'kds.ticket.recalled',
};

const isTransitionAllowed = ({ from, to }) => {
  const f = String(from || '').trim();
  const t = String(to || '').trim();
  if (!f || !t) return false;
  if (f === t) return true;

  const allowed = new Map([
    [TICKET_STATUS.NEW, new Set([TICKET_STATUS.FIRED, TICKET_STATUS.CANCELLED])],
    [TICKET_STATUS.FIRED, new Set([TICKET_STATUS.IN_PREP, TICKET_STATUS.READY, TICKET_STATUS.CANCELLED])],
    [TICKET_STATUS.IN_PREP, new Set([TICKET_STATUS.READY, TICKET_STATUS.CANCELLED])],
    [TICKET_STATUS.READY, new Set([TICKET_STATUS.BUMPED, TICKET_STATUS.CANCELLED])],
    [TICKET_STATUS.BUMPED, new Set([TICKET_STATUS.RECALLED])],
    [TICKET_STATUS.RECALLED, new Set([TICKET_STATUS.IN_PREP, TICKET_STATUS.READY, TICKET_STATUS.CANCELLED])],
    [TICKET_STATUS.CANCELLED, new Set([])],
  ]);

  const next = allowed.get(f);
  if (!next) return false;
  return next.has(t);
};

const getTicket = async ({ tenantId, branchId, ticketId, trx }) => {
  const q = trx || db();
  return await q
    .from('kds_tickets')
    .where({ tenant_id: tenantId, branch_id: branchId, id: ticketId })
    .first();
};

const getExistingActionEvent = async ({ tenantId, actionId, trx }) => {
  if (!actionId) return null;
  const q = trx || db();
  const row = await q
    .from('kds_events')
    .where({ tenant_id: tenantId, action_id: actionId })
    .select(['id', 'ticket_id', 'event_type', 'created_at'])
    .first();
  return row || null;
};

const appendEvent = async ({
  trx,
  tenantId,
  branchId,
  ticketId,
  eventType,
  actionId,
  actorStaffId,
  actorRole,
  payload,
  nowIso,
}) => {
  const row = {
    id: uid('kde'),
    tenant_id: tenantId,
    branch_id: branchId,
    ticket_id: ticketId,
    event_type: eventType,
    action_id: actionId || null,
    actor_staff_id: actorStaffId || null,
    actor_role: actorRole || null,
    payload_json: payload != null ? JSON.stringify(payload) : null,
    created_at: nowIso,
  };

  await trx.from('kds_events').insert(row);
  return row;
};

const projectTicketFromEvents = (events) => {
  const sorted = Array.isArray(events) ? events.slice() : [];
  sorted.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const state = {
    status: null,
    firedAt: null,
    readyAt: null,
    bumpedAt: null,
  };

  for (const e of sorted) {
    const type = String(e?.event_type || '').trim();
    const at = e?.created_at ? String(e.created_at) : null;

    if (type === EVENT_TYPE.TICKET_CREATED) {
      if (!state.status) state.status = TICKET_STATUS.NEW;
    } else if (type === EVENT_TYPE.TICKET_FIRED) {
      state.status = TICKET_STATUS.FIRED;
      state.firedAt = at;
    } else if (type === EVENT_TYPE.TICKET_READY) {
      state.status = TICKET_STATUS.READY;
      state.readyAt = at;
    } else if (type === EVENT_TYPE.TICKET_BUMPED) {
      state.status = TICKET_STATUS.BUMPED;
      state.bumpedAt = at;
    } else if (type === EVENT_TYPE.TICKET_RECALLED) {
      state.status = TICKET_STATUS.RECALLED;
    }
  }

  return state;
};

const createOrFireTicketForOrder = async ({
  tenantId,
  branchId,
  orderId,
  station,
  courseNo,
  priority,
  slaMs,
  actionId,
  actor,
  nowIso,
  reqLog,
}) => {
  const stationKey = String(station || '').trim();
  const course = Number(courseNo || 1) || 1;

  return await db().transaction(async (trx) => {
    const existingAction = await getExistingActionEvent({ tenantId, actionId, trx });
    if (existingAction) {
      const t = await getTicket({ tenantId, branchId, ticketId: String(existingAction.ticket_id), trx });
      return { ok: true, idempotent: true, ticket: t || null };
    }

    const orderRow = await trx
      .from('orders')
      .where({ tenant_id: tenantId, branch_id: branchId, id: orderId })
      .select(['id', 'created_at', 'table_id', 'table_name', 'display_number', 'status'])
      .first();
    if (!orderRow) {
      const err = new Error('order_not_found');
      err.code = 'order_not_found';
      throw err;
    }

    const orderItems = await trx
      .from('order_items')
      .where({ tenant_id: tenantId, branch_id: branchId, order_id: orderId })
      .select(['id', 'product_id', 'name', 'qty', 'voided_qty', 'note']);

    const ticketId = uid('kdt');
    const dueAt = slaMs && Number(slaMs) > 0 ? new Date(Date.now() + Number(slaMs)).toISOString() : null;

    const ticketRow = {
      id: ticketId,
      tenant_id: tenantId,
      branch_id: branchId,
      order_id: orderId,
      station: stationKey,
      course_no: course,
      status: TICKET_STATUS.FIRED,
      priority: Number(priority || 0) || 0,
      created_at: nowIso,
      updated_at: nowIso,
      fired_at: nowIso,
      ready_at: null,
      bumped_at: null,
      sla_ms: slaMs && Number(slaMs) > 0 ? Number(slaMs) : null,
      sla_due_at: dueAt,
      meta_json: JSON.stringify({ tableId: orderRow.table_id || null, tableName: orderRow.table_name || null, number: orderRow.display_number || null }),
    };

    await trx.from('kds_tickets').insert(ticketRow);

    const itemRows = (Array.isArray(orderItems) ? orderItems : []).map((it) => ({
      id: uid('kdi'),
      tenant_id: tenantId,
      branch_id: branchId,
      ticket_id: ticketId,
      order_item_id: String(it.id),
      product_id: it.product_id ? String(it.product_id) : null,
      name: String(it.name || ''),
      qty: Number(it.qty || 0) || 0,
      voided_qty: Number(it.voided_qty || 0) || 0,
      notes: it.note ? String(it.note) : null,
      allergens_json: null,
      station: stationKey,
      course_no: course,
      prep_state: 'FIRED',
      created_at: nowIso,
      updated_at: nowIso,
    }));

    if (itemRows.length > 0) {
      await trx.from('kds_ticket_items').insert(itemRows);
    }

    await appendEvent({
      trx,
      tenantId,
      branchId,
      ticketId,
      eventType: EVENT_TYPE.TICKET_CREATED,
      actionId: null,
      actorStaffId: actor?.staffId || null,
      actorRole: actor?.role || null,
      payload: { orderId, station: stationKey, courseNo: course },
      nowIso,
    });

    await appendEvent({
      trx,
      tenantId,
      branchId,
      ticketId,
      eventType: EVENT_TYPE.TICKET_FIRED,
      actionId,
      actorStaffId: actor?.staffId || null,
      actorRole: actor?.role || null,
      payload: { orderId, station: stationKey, courseNo: course, slaMs: ticketRow.sla_ms },
      nowIso,
    });

    if (reqLog?.info) reqLog.info({ type: 'kds_ticket_fired', ticketId, orderId, station: stationKey, courseNo: course, actionId }, 'KDS ticket fired');

    const ticket = await getTicket({ tenantId, branchId, ticketId, trx });
    return { ok: true, idempotent: false, ticket };
  });
};

const transitionTicket = async ({ tenantId, branchId, ticketId, toStatus, eventType, actionId, actor, nowIso, reqLog }) => {
  return await db().transaction(async (trx) => {
    const existingAction = await getExistingActionEvent({ tenantId, actionId, trx });
    if (existingAction) {
      const t = await getTicket({ tenantId, branchId, ticketId: String(existingAction.ticket_id), trx });
      return { ok: true, idempotent: true, ticket: t || null };
    }

    const ticket = await getTicket({ tenantId, branchId, ticketId, trx });
    if (!ticket) {
      const err = new Error('ticket_not_found');
      err.code = 'ticket_not_found';
      throw err;
    }

    const fromStatus = String(ticket.status || '').trim();
    if (!isTransitionAllowed({ from: fromStatus, to: toStatus })) {
      const err = new Error('illegal_transition');
      err.code = 'illegal_transition';
      err.meta = { from: fromStatus, to: toStatus };
      throw err;
    }

    const patch = { status: toStatus, updated_at: nowIso };
    if (toStatus === TICKET_STATUS.READY) patch.ready_at = nowIso;
    if (toStatus === TICKET_STATUS.BUMPED) patch.bumped_at = nowIso;
    if (toStatus === TICKET_STATUS.FIRED) patch.fired_at = nowIso;

    await trx.from('kds_tickets').where({ tenant_id: tenantId, branch_id: branchId, id: ticketId }).update(patch);

    await appendEvent({
      trx,
      tenantId,
      branchId,
      ticketId,
      eventType,
      actionId,
      actorStaffId: actor?.staffId || null,
      actorRole: actor?.role || null,
      payload: { from: fromStatus, to: toStatus },
      nowIso,
    });

    if (reqLog?.info) reqLog.info({ type: 'kds_ticket_transition', ticketId, from: fromStatus, to: toStatus, actionId }, 'KDS ticket transition');

    const nextTicket = await getTicket({ tenantId, branchId, ticketId, trx });
    return { ok: true, idempotent: false, ticket: nextTicket };
  });
};

const listBoard = async ({ tenantId, branchId, station, status, limit }) => {
  const st = typeof station === 'string' ? station.trim() : '';
  const statusKey = typeof status === 'string' ? status.trim() : '';
  const lim = Math.max(1, Math.min(400, Number(limit || 200) || 200));

  let q = db()
    .from('kds_tickets')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .select([
      'id',
      'order_id',
      'station',
      'course_no',
      'status',
      'priority',
      'created_at',
      'updated_at',
      'fired_at',
      'ready_at',
      'bumped_at',
      'sla_ms',
      'sla_due_at',
      'meta_json',
    ]);

  if (st) q = q.andWhere({ station: st });
  if (statusKey) q = q.andWhere({ status: statusKey });
  q = q.orderBy('created_at', 'desc').limit(lim);

  const tickets = await q;
  const ids = tickets.map((t) => String(t.id || '')).filter(Boolean);

  const eventRows = ids.length
    ? await db()
        .from('kds_events')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .whereIn('ticket_id', ids)
        .select(['ticket_id', 'event_type', 'created_at'])
    : [];

  const eventsByTicket = new Map();
  for (const e of eventRows) {
    const tid = String(e.ticket_id || '').trim();
    if (!tid) continue;
    const list = eventsByTicket.get(tid) || [];
    list.push(e);
    eventsByTicket.set(tid, list);
  }

  const items = ids.length
    ? await db()
        .from('kds_ticket_items')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .whereIn('ticket_id', ids)
        .select(['id', 'ticket_id', 'order_item_id', 'product_id', 'name', 'qty', 'voided_qty', 'notes', 'station', 'course_no', 'prep_state', 'created_at', 'updated_at'])
    : [];

  const itemsByTicket = new Map();
  for (const it of items) {
    const tid = String(it.ticket_id || '').trim();
    if (!tid) continue;
    const list = itemsByTicket.get(tid) || [];
    list.push(it);
    itemsByTicket.set(tid, list);
  }

  return tickets.map((t) => ({
    ...t,
    ...(eventsByTicket.has(String(t.id))
      ? (() => {
          const proj = projectTicketFromEvents(eventsByTicket.get(String(t.id)) || []);
          const patch = {};
          if (proj.status) patch.status = proj.status;
          if (proj.firedAt) patch.fired_at = proj.firedAt;
          if (proj.readyAt) patch.ready_at = proj.readyAt;
          if (proj.bumpedAt) patch.bumped_at = proj.bumpedAt;
          return patch;
        })()
      : {}),
    meta: (() => {
      try {
        return t.meta_json ? JSON.parse(String(t.meta_json)) : {};
      } catch {
        return {};
      }
    })(),
    items: itemsByTicket.get(String(t.id)) || [],
  }));
};

module.exports = {
  TICKET_STATUS,
  EVENT_TYPE,
  isTransitionAllowed,
  projectTicketFromEvents,
  createOrFireTicketForOrder,
  transitionTicket,
  listBoard,
};
