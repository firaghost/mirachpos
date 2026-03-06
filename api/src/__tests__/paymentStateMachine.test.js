/**
 * Payment State Machine Tests
 * Tests for idempotency, webhook replay safety, and reconciliation totals
 */

const { db } = require('../db');
const { uid } = require('../utils/ids');
const { appendPaymentEvent } = require('../services/paymentEventsService');

const TEST_TENANT_ID = 'test_tenant_' + Date.now();
const TEST_BRANCH_ID = 'test_branch_' + Date.now();

const cleanTable = async (tableName) => {
  try {
    await db().from(tableName).where({ tenant_id: TEST_TENANT_ID }).del();
  } catch {
    // table may not exist yet
  }
};

const setupTestData = async () => {
  const orderId = uid('ord');
  const now = new Date().toISOString();

  await db().from('orders').insert({
    id: orderId,
    tenant_id: TEST_TENANT_ID,
    branch_id: TEST_BRANCH_ID,
    status: 'Paid',
    total: 100.00,
    tax: 0,
    tip: 0,
    discount: 0,
    created_at: now,
    paid_at: now,
    payload: JSON.stringify({ number: 'TEST-001' }),
  });

  return { orderId };
};

describe('Payment State Machine', () => {
  beforeAll(async () => {
    await cleanTable('payment_events');
    await cleanTable('pos_payment_gateway_transactions');
    await cleanTable('orders');
  });

  afterAll(async () => {
    await cleanTable('payment_events');
    await cleanTable('pos_payment_gateway_transactions');
    await cleanTable('orders');
  });

  describe('Idempotency', () => {
    test('duplicate idempotency key with same request returns existing event', async () => {
      const idempotencyKey = `test_key_${Date.now()}`;
      const requestHash = 'abc123';
      const paymentRef = `pos:order:${uid('ord')}`;

      const first = await appendPaymentEvent({
        tenantId: TEST_TENANT_ID,
        branchId: TEST_BRANCH_ID,
        domain: 'pos',
        paymentRef,
        orderId: null,
        invoiceId: null,
        operation: 'pos.refund',
        eventType: 'payment.refund.succeeded',
        fromState: 'captured',
        toState: 'refunded_full',
        amount: 100.0,
        currency: 'ETB',
        paymentMethod: null,
        gateway: null,
        providerPaymentId: null,
        providerEventId: null,
        idempotencyKey,
        requestHash,
        actorType: 'staff',
        actorId: null,
        payload: null,
        nowIso: new Date().toISOString(),
      });
      expect(first.ok).toBe(true);
      expect(first.duplicate).toBe(false);

      const second = await appendPaymentEvent({
        tenantId: TEST_TENANT_ID,
        branchId: TEST_BRANCH_ID,
        domain: 'pos',
        paymentRef,
        orderId: null,
        invoiceId: null,
        operation: 'pos.refund',
        eventType: 'payment.refund.succeeded',
        fromState: 'captured',
        toState: 'refunded_full',
        amount: 100.0,
        currency: 'ETB',
        paymentMethod: null,
        gateway: null,
        providerPaymentId: null,
        providerEventId: null,
        idempotencyKey,
        requestHash,
        actorType: 'staff',
        actorId: null,
        payload: null,
        nowIso: new Date().toISOString(),
      });
      expect(second.ok).toBe(true);
      expect(second.duplicate).toBe(true);

      // Verify only one event exists
      const events = await db()
        .from('payment_events')
        .where({ tenant_id: TEST_TENANT_ID, idempotency_key: idempotencyKey })
        .select('*');

      expect(events).toHaveLength(1);
    });

    test('same idempotency key with different request hash should be rejected', async () => {
      const idempotencyKey = `test_conflict_${Date.now()}`;

      const paymentRef = `pos:order:${uid('ord')}`;
      await appendPaymentEvent({
        tenantId: TEST_TENANT_ID,
        branchId: TEST_BRANCH_ID,
        domain: 'pos',
        paymentRef,
        orderId: null,
        invoiceId: null,
        operation: 'pos.capture',
        eventType: 'payment.capture.succeeded',
        fromState: 'pending_authorization',
        toState: 'captured',
        amount: 50.0,
        currency: 'ETB',
        paymentMethod: null,
        gateway: null,
        providerPaymentId: null,
        providerEventId: null,
        idempotencyKey,
        requestHash: 'hash_v1',
        actorType: 'webhook',
        actorId: null,
        payload: null,
        nowIso: new Date().toISOString(),
      });

      await expect(
        appendPaymentEvent({
          tenantId: TEST_TENANT_ID,
          branchId: TEST_BRANCH_ID,
          domain: 'pos',
          paymentRef,
          orderId: null,
          invoiceId: null,
          operation: 'pos.capture',
          eventType: 'payment.capture.succeeded',
          fromState: 'pending_authorization',
          toState: 'captured',
          amount: 100.0,
          currency: 'ETB',
          paymentMethod: null,
          gateway: null,
          providerPaymentId: null,
          providerEventId: null,
          idempotencyKey,
          requestHash: 'hash_v2',
          actorType: 'webhook',
          actorId: null,
          payload: null,
          nowIso: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'idempotency_key_conflict', status: 409 });
    });
  });

  describe('Webhook Replay Safety', () => {
    test('duplicate webhook event_id is no-op', async () => {
      const providerEventId = `webhook_${Date.now()}`;
      const gateway = 'chapa';

      const first = await appendPaymentEvent({
        tenantId: TEST_TENANT_ID,
        branchId: TEST_BRANCH_ID,
        domain: 'webhook',
        paymentRef: `webhook:${gateway}:${providerEventId}`,
        orderId: null,
        invoiceId: null,
        operation: 'webhook.chapa',
        eventType: 'webhook.received',
        fromState: null,
        toState: null,
        amount: 100.0,
        currency: 'ETB',
        paymentMethod: null,
        gateway,
        providerPaymentId: null,
        providerEventId,
        idempotencyKey: null,
        requestHash: null,
        actorType: 'webhook',
        actorId: null,
        payload: null,
        nowIso: new Date().toISOString(),
      });
      expect(first.ok).toBe(true);
      expect(first.duplicate).toBe(false);

      const second = await appendPaymentEvent({
        tenantId: TEST_TENANT_ID,
        branchId: TEST_BRANCH_ID,
        domain: 'webhook',
        paymentRef: `webhook:${gateway}:${providerEventId}_retry`,
        orderId: null,
        invoiceId: null,
        operation: 'webhook.chapa',
        eventType: 'webhook.received',
        fromState: null,
        toState: null,
        amount: 100.0,
        currency: 'ETB',
        paymentMethod: null,
        gateway,
        providerPaymentId: null,
        providerEventId,
        idempotencyKey: null,
        requestHash: null,
        actorType: 'webhook',
        actorId: null,
        payload: null,
        nowIso: new Date().toISOString(),
      });
      expect(second.ok).toBe(true);
      expect(second.duplicate).toBe(true);

      // Verify only one webhook event exists for this provider_event_id
      const events = await db()
        .from('payment_events')
        .where({ tenant_id: TEST_TENANT_ID, provider_event_id: providerEventId })
        .select('*');

      expect(events).toHaveLength(1);
    });
  });

  describe('Reconciliation Totals', () => {
    beforeEach(async () => {
      await cleanTable('payment_events');
    });

    test('reconciliation totals match events', async () => {
      const now = new Date().toISOString();
      const dayPrefix = now.slice(0, 10); // YYYY-MM-DD

      // Insert capture events
      await db().from('payment_events').insert([
        {
          id: uid('pev'),
          tenant_id: TEST_TENANT_ID,
          branch_id: TEST_BRANCH_ID,
          domain: 'pos',
          payment_ref: `pos:pgt:${uid('pgt')}`,
          operation: 'pos.capture',
          event_type: 'payment.capture.succeeded',
          from_state: 'pending_authorization',
          to_state: 'captured',
          amount: 100.00,
          currency: 'ETB',
          payment_method: 'Mobile Money',
          gateway: 'chapa',
          created_at: now,
        },
        {
          id: uid('pev'),
          tenant_id: TEST_TENANT_ID,
          branch_id: TEST_BRANCH_ID,
          domain: 'pos',
          payment_ref: `pos:pgt:${uid('pgt')}`,
          operation: 'pos.capture',
          event_type: 'payment.capture.succeeded',
          from_state: 'pending_authorization',
          to_state: 'captured',
          amount: 150.00,
          currency: 'ETB',
          payment_method: 'SantimPay',
          gateway: 'santimpay',
          created_at: now,
        },
      ]);

      // Insert refund event
      await db().from('payment_events').insert({
        id: uid('pev'),
        tenant_id: TEST_TENANT_ID,
        branch_id: TEST_BRANCH_ID,
        domain: 'pos',
        payment_ref: `pos:order:${uid('ord')}`,
        operation: 'pos.refund',
        event_type: 'payment.refund.succeeded',
        from_state: 'captured',
        to_state: 'refunded_full',
        amount: 50.00,
        currency: 'ETB',
        payment_method: 'Mobile Money',
        gateway: 'chapa',
        created_at: now,
      });

      // Query reconciliation totals
      const rows = await db()
        .from('payment_events')
        .where({ tenant_id: TEST_TENANT_ID, branch_id: TEST_BRANCH_ID })
        .whereIn('event_type', ['payment.capture.succeeded', 'payment.refund.succeeded'])
        .whereBetween('created_at', [`${dayPrefix}T00:00:00.000Z`, `${dayPrefix}T23:59:59.999Z`])
        .select(['event_type', 'payment_method', 'gateway', 'amount', 'currency']);

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

      // Verify totals
      expect(totals.captures.count).toBe(2);
      expect(totals.captures.amount).toBe(250.00);
      expect(totals.refunds.count).toBe(1);
      expect(totals.refunds.amount).toBe(50.00);
      expect(net).toBe(200.00);

      // Verify by method
      expect(totals.byMethod['Mobile Money'].captures.amount).toBe(100.00);
      expect(totals.byMethod['Mobile Money'].refunds.amount).toBe(50.00);
      expect(totals.byMethod['SantimPay'].captures.amount).toBe(150.00);
    });
  });

  describe('State Transitions', () => {
    test('valid transitions are allowed', async () => {
      const pgtId = uid('pgt');
      const now = new Date().toISOString();

      // Insert initial pending transaction
      await db().from('pos_payment_gateway_transactions').insert({
        id: pgtId,
        tenant_id: TEST_TENANT_ID,
        branch_id: TEST_BRANCH_ID,
        order_id: uid('ord'),
        gateway: 'chapa',
        method: 'mobile_money',
        tx_ref: `pos_test_${Date.now()}`,
        amount: 100.00,
        currency: 'ETB',
        status: 'pending',
        state: 'pending_authorization',
        created_at: now,
        updated_at: now,
      });

      // Update to captured
      await db()
        .from('pos_payment_gateway_transactions')
        .where({ id: pgtId })
        .update({
          state: 'captured',
          status: 'completed',
          captured_at: now,
          updated_at: now,
        });

      const updated = await db()
        .from('pos_payment_gateway_transactions')
        .where({ id: pgtId })
        .first();

      expect(updated.state).toBe('captured');
      expect(updated.status).toBe('completed');
      expect(updated.captured_at).toBe(now);
    });
  });
});
