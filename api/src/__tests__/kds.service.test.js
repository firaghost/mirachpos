const {
    TICKET_STATUS,
    EVENT_TYPE,
    isTransitionAllowed,
    projectTicketFromEvents,
    createOrFireTicketForOrder,
    transitionTicket,
    listBoard,
} = require('../services/kdsService');

const getDbState = () => {
    const s = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!s) throw new Error('db_mock_state_missing');
    s.tables.kds_tickets = Array.isArray(s.tables.kds_tickets) ? s.tables.kds_tickets : [];
    s.tables.kds_events = Array.isArray(s.tables.kds_events) ? s.tables.kds_events : [];
    s.tables.kds_ticket_items = Array.isArray(s.tables.kds_ticket_items) ? s.tables.kds_ticket_items : [];
    s.tables.order_items = Array.isArray(s.tables.order_items) ? s.tables.order_items : [];
    s.tables.orders = Array.isArray(s.tables.orders) ? s.tables.orders : [];
    return s;
};

const resetKdsTables = () => {
    const s = getDbState();
    s.tables.kds_tickets = [];
    s.tables.kds_events = [];
    s.tables.kds_ticket_items = [];
    s.tables.orders = [];
    s.tables.order_items = [];
};

const seedOrder = ({ tenantId, branchId, orderId, createdAt, tableId = 'tbl_1', tableName = 'T1', displayNumber = 12, status = 'OPEN' }) => {
    const s = getDbState();
    s.tables.orders.push({
        tenant_id: tenantId,
        branch_id: branchId,
        id: orderId,
        created_at: createdAt,
        table_id: tableId,
        table_name: tableName,
        display_number: displayNumber,
        status,
    });
};

const seedOrderItem = ({ tenantId, branchId, orderId, id, name = 'Burger', qty = 1, voidedQty = 0, note = null }) => {
    const s = getDbState();
    s.tables.order_items.push({
        tenant_id: tenantId,
        branch_id: branchId,
        order_id: orderId,
        id,
        product_id: 'p_1',
        name,
        qty,
        voided_qty: voidedQty,
        note,
    });
};

describe('kdsService', () => {
    const tenantId = 't_test';
    const branchId = 'b_1';

    beforeEach(() => {
        resetKdsTables();
    });

    describe('isTransitionAllowed', () => {
        test('allows known legal transitions', () => {
            expect(isTransitionAllowed({ from: TICKET_STATUS.NEW, to: TICKET_STATUS.FIRED })).toBe(true);
            expect(isTransitionAllowed({ from: TICKET_STATUS.FIRED, to: TICKET_STATUS.IN_PREP })).toBe(true);
            expect(isTransitionAllowed({ from: TICKET_STATUS.IN_PREP, to: TICKET_STATUS.READY })).toBe(true);
            expect(isTransitionAllowed({ from: TICKET_STATUS.READY, to: TICKET_STATUS.BUMPED })).toBe(true);
            expect(isTransitionAllowed({ from: TICKET_STATUS.BUMPED, to: TICKET_STATUS.RECALLED })).toBe(true);
        });

        test('blocks illegal transitions', () => {
            expect(isTransitionAllowed({ from: TICKET_STATUS.NEW, to: TICKET_STATUS.READY })).toBe(false);
            expect(isTransitionAllowed({ from: TICKET_STATUS.FIRED, to: TICKET_STATUS.BUMPED })).toBe(false);
            expect(isTransitionAllowed({ from: TICKET_STATUS.CANCELLED, to: TICKET_STATUS.FIRED })).toBe(false);
        });

        test('treats same-status as idempotent', () => {
            expect(isTransitionAllowed({ from: TICKET_STATUS.READY, to: TICKET_STATUS.READY })).toBe(true);
        });
    });

    describe('projectTicketFromEvents', () => {
        test('projects final status with stable ordering by created_at', () => {
            const events = [
                { event_type: EVENT_TYPE.TICKET_READY, created_at: '2026-01-01T10:00:10.000Z' },
                { event_type: EVENT_TYPE.TICKET_CREATED, created_at: '2026-01-01T10:00:00.000Z' },
                { event_type: EVENT_TYPE.TICKET_FIRED, created_at: '2026-01-01T10:00:05.000Z' },
            ];

            const state = projectTicketFromEvents(events);
            expect(state.status).toBe(TICKET_STATUS.READY);
            expect(state.firedAt).toBe('2026-01-01T10:00:05.000Z');
            expect(state.readyAt).toBe('2026-01-01T10:00:10.000Z');
        });

        test('handles bump + recall and preserves bumpedAt', () => {
            const events = [
                { event_type: EVENT_TYPE.TICKET_CREATED, created_at: '2026-01-01T10:00:00.000Z' },
                { event_type: EVENT_TYPE.TICKET_FIRED, created_at: '2026-01-01T10:00:05.000Z' },
                { event_type: EVENT_TYPE.TICKET_READY, created_at: '2026-01-01T10:00:10.000Z' },
                { event_type: EVENT_TYPE.TICKET_BUMPED, created_at: '2026-01-01T10:00:20.000Z' },
                { event_type: EVENT_TYPE.TICKET_RECALLED, created_at: '2026-01-01T10:00:30.000Z' },
            ];

            const state = projectTicketFromEvents(events);
            expect(state.status).toBe(TICKET_STATUS.RECALLED);
            expect(state.bumpedAt).toBe('2026-01-01T10:00:20.000Z');
        });
    });

    describe('createOrFireTicketForOrder', () => {
        test('is idempotent for same actionId', async () => {
            const nowIso = '2026-01-01T10:00:00.000Z';
            seedOrder({ tenantId, branchId, orderId: 'o_1', createdAt: nowIso });
            seedOrderItem({ tenantId, branchId, orderId: 'o_1', id: 'oi_1' });

            const r1 = await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_1',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: 5 * 60 * 1000,
                actionId: 'act_1',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const r2 = await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_1',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: 5 * 60 * 1000,
                actionId: 'act_1',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const s = getDbState();
            expect(r1.ok).toBe(true);
            expect(r2.ok).toBe(true);
            expect(r2.idempotent).toBe(true);
            expect(s.tables.kds_tickets.length).toBe(1);
            expect(s.tables.kds_events.filter((e) => String(e.action_id || '') === 'act_1').length).toBe(1);
        });

        test('creates ticket items from order_items', async () => {
            const nowIso = '2026-01-01T10:00:00.000Z';
            seedOrder({ tenantId, branchId, orderId: 'o_2', createdAt: nowIso });
            seedOrderItem({ tenantId, branchId, orderId: 'o_2', id: 'oi_21', name: 'Pizza', qty: 2, note: 'No olives' });
            seedOrderItem({ tenantId, branchId, orderId: 'o_2', id: 'oi_22', name: 'Salad', qty: 1 });

            await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_2',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: null,
                actionId: 'act_2',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const s = getDbState();
            expect(s.tables.kds_tickets.length).toBe(1);
            expect(s.tables.kds_ticket_items.length).toBe(2);
            expect(s.tables.kds_ticket_items.every((it) => String(it.ticket_id || ''))).toBe(true);
        });
    });

    describe('transitionTicket', () => {
        test('is idempotent for same actionId', async () => {
            const nowIso = '2026-01-01T10:00:00.000Z';
            seedOrder({ tenantId, branchId, orderId: 'o_3', createdAt: nowIso });
            seedOrderItem({ tenantId, branchId, orderId: 'o_3', id: 'oi_31' });

            const fired = await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_3',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: null,
                actionId: 'act_3_fire',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const ticketId = String(fired.ticket?.id || '');
            expect(ticketId).toBeTruthy();

            const r1 = await transitionTicket({
                tenantId,
                branchId,
                ticketId,
                toStatus: TICKET_STATUS.READY,
                eventType: EVENT_TYPE.TICKET_READY,
                actionId: 'act_3_ready',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso: '2026-01-01T10:05:00.000Z',
                reqLog: null,
            });

            const r2 = await transitionTicket({
                tenantId,
                branchId,
                ticketId,
                toStatus: TICKET_STATUS.READY,
                eventType: EVENT_TYPE.TICKET_READY,
                actionId: 'act_3_ready',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso: '2026-01-01T10:05:00.000Z',
                reqLog: null,
            });

            const s = getDbState();
            expect(r1.ok).toBe(true);
            expect(r2.ok).toBe(true);
            expect(r2.idempotent).toBe(true);
            expect(s.tables.kds_events.filter((e) => String(e.action_id || '') === 'act_3_ready').length).toBe(1);

            const row = s.tables.kds_tickets.find((t) => String(t.id) === ticketId);
            expect(row?.status).toBe(TICKET_STATUS.READY);
            expect(row?.ready_at).toBe('2026-01-01T10:05:00.000Z');
        });

        test('blocks illegal transition', async () => {
            const nowIso = '2026-01-01T10:00:00.000Z';
            seedOrder({ tenantId, branchId, orderId: 'o_4', createdAt: nowIso });
            seedOrderItem({ tenantId, branchId, orderId: 'o_4', id: 'oi_41' });

            const fired = await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_4',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: null,
                actionId: 'act_4_fire',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const ticketId = String(fired.ticket?.id || '');

            await expect(
                transitionTicket({
                    tenantId,
                    branchId,
                    ticketId,
                    toStatus: TICKET_STATUS.BUMPED,
                    eventType: EVENT_TYPE.TICKET_BUMPED,
                    actionId: 'act_4_bump',
                    actor: { staffId: 's_1', role: 'kitchen' },
                    nowIso: '2026-01-01T10:01:00.000Z',
                    reqLog: null,
                }),
            ).rejects.toMatchObject({ code: 'illegal_transition' });
        });
    });

    describe('listBoard', () => {
        test('returns tickets with items and meta, and applies event projection', async () => {
            const nowIso = '2026-01-01T10:00:00.000Z';
            seedOrder({ tenantId, branchId, orderId: 'o_5', createdAt: nowIso });
            seedOrderItem({ tenantId, branchId, orderId: 'o_5', id: 'oi_51', name: 'Pasta' });

            const fired = await createOrFireTicketForOrder({
                tenantId,
                branchId,
                orderId: 'o_5',
                station: 'KITCHEN',
                courseNo: 1,
                priority: 0,
                slaMs: null,
                actionId: 'act_5_fire',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso,
                reqLog: null,
            });

            const ticketId = String(fired.ticket?.id || '');

            await transitionTicket({
                tenantId,
                branchId,
                ticketId,
                toStatus: TICKET_STATUS.READY,
                eventType: EVENT_TYPE.TICKET_READY,
                actionId: 'act_5_ready',
                actor: { staffId: 's_1', role: 'kitchen' },
                nowIso: '2026-01-01T10:05:00.000Z',
                reqLog: null,
            });

            const board = await listBoard({ tenantId, branchId, station: 'KITCHEN', status: '', limit: 50 });
            expect(Array.isArray(board)).toBe(true);
            expect(board.length).toBe(1);

            const t = board[0];
            expect(t.id).toBe(ticketId);
            expect(t.status).toBe(TICKET_STATUS.READY);
            expect(t.ready_at).toBe('2026-01-01T10:05:00.000Z');
            expect(t.meta).toMatchObject({ tableId: 'tbl_1', tableName: 'T1', number: 12 });
            expect(Array.isArray(t.items)).toBe(true);
            expect(t.items.length).toBe(1);
            expect(t.items[0]).toMatchObject({ name: 'Pasta', qty: 1 });
        });
    });
});
