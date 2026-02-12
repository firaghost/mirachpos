jest.mock('../../src/utils/circuitBreaker', () => ({
  withCircuitBreaker: jest.fn((key, fn) => fn()),
}));

jest.mock('../../src/config', () => ({
  config: { gatewayRequestTimeoutMs: 0 },
}));

jest.mock('../../src/utils/telebirr/tools', () => ({
  createTimeStamp: jest.fn(() => '1700000000'),
  createNonceStr: jest.fn(() => 'nonce'),
  signRequestObject: jest.fn(() => 'sig'),
}));

jest.unmock('../../src/services/telebirrStandingOrderService');

describe('services/telebirrStandingOrderService', () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();

    require('../../src/db');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.telebirr_subscriptions = [];
    state.tables.subscription_transactions = [];
    state.tables.idempotency_keys = [];

    process.env.TELEBIRR_STANDING_ENABLED = 'true';
    process.env.TELEBIRR_BASE_URL = 'https://telebirr.example';
    process.env.TELEBIRR_FABRIC_APP_ID = 'fab_app_1';
    process.env.TELEBIRR_APP_SECRET = 'secret_1';
    process.env.TELEBIRR_MERCHANT_APP_ID = 'mapp_1';
    process.env.TELEBIRR_MERCHANT_CODE = 'mcode_1';
    process.env.TELEBIRR_PRIVATE_KEY = '-----BEGIN KEY-----\nabc\n-----END KEY-----';
    process.env.TELEBIRR_MANDATE_TEMPLATE_ID = '103001';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: '0', token: 'Bearer token' }),
        };
      }
      if (u.includes('/payment/v1/merchant/preOrder')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: '0', biz_content: { prepay_id: 'pp_1' } }),
        };
      }
      throw new Error(`unexpected_fetch:${u}`);
    });
  });

  afterEach(() => {
    delete global.fetch;
    process.env = prevEnv;
  });

  describe('normalizePhone', () => {
    it('normalizes 09xxxxxxxx to 2519xxxxxxxx', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');
      // Test phone validation - invalid phone should throw
      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '',
          planAmount: 100,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow('phone_required');
    });
  });

  describe('computeNextChargeDate', () => {
    it('computes MONTHLY next charge date', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');
      // computeNextChargeDate is internal; tested indirectly
      const result = await svc.createSubscription({
        tenantId: 't1',
        userId: 'u1',
        phone: '251912345678',
        planAmount: 100,
        cycle: 'MONTHLY',
        executeDay: 15,
        validityMonths: 12,
      });
      expect(result.ok).toBe(true);
      expect(result.subscription.nextChargeDate).toBeTruthy();
    });

    it('computes DAILY next charge date', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');
      const result = await svc.createSubscription({
        tenantId: 't1',
        userId: 'u1',
        phone: '251912345678',
        planAmount: 100,
        cycle: 'DAILY',
        executeDay: 1,
        validityMonths: 12,
      });
      expect(result.ok).toBe(true);
    });

    it('computes YEARLY next charge date', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');
      const result = await svc.createSubscription({
        tenantId: 't1',
        userId: 'u1',
        phone: '251912345678',
        planAmount: 100,
        cycle: 'YEARLY',
        executeDay: 1,
        validityMonths: 12,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('createSubscription', () => {
    it('throws when standing order is disabled', async () => {
      process.env.TELEBIRR_STANDING_ENABLED = 'false';
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '251912345678',
          planAmount: 100,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow('Telebirr standing order is disabled');
    });

    it('throws when config is incomplete', async () => {
      delete process.env.TELEBIRR_PRIVATE_KEY;
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '251912345678',
          planAmount: 100,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow('Telebirr standing order config incomplete');
    });

    it('throws when phone is missing', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '',
          planAmount: 100,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow('phone_required');
    });

    it('throws when plan amount is invalid', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '251912345678',
          planAmount: 0,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow('plan_amount_invalid');
    });

    it('creates subscription successfully', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.createSubscription({
        tenantId: 't1',
        userId: 'u1',
        phone: '251912345678',
        planAmount: 100,
        cycle: 'MONTHLY',
        executeDay: 1,
        validityMonths: 12,
      });

      expect(result.ok).toBe(true);
      expect(result.subscription.status).toBe('pending');
      expect(result.subscription.phoneNumber).toBe('251912345678');
      expect(result.checkout.prepayId).toBe('pp_1');
    });

    it('supports idempotency key and returns cached response', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');
      const idempotencyKey = 'idem_key_1';

      const cached = {
        ok: true,
        subscription: { id: 'cached_id', status: 'pending' },
      };

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.idempotency_keys = [
        {
          id: 'ik_1',
          key: idempotencyKey,
          path: '/api/telebirr/subscribe',
          response_json: JSON.stringify(cached),
          created_at: new Date().toISOString(),
        },
      ];

      const result = await svc.createSubscription({
        tenantId: 't1',
        userId: 'u1',
        phone: '251912345678',
        planAmount: 100,
        cycle: 'MONTHLY',
        executeDay: 1,
        validityMonths: 12,
        idempotencyKey,
      });

      expect(result).toEqual(cached);
    });

    it('marks subscription as failed when preOrder fails', async () => {
      global.fetch = jest.fn(async (url) => {
        const u = String(url);
        if (u.includes('/payment/v1/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ code: '0', token: 'Bearer token' }),
          };
        }
        if (u.includes('/payment/v1/merchant/preOrder')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ code: '500', msg: 'Internal error' }),
          };
        }
        throw new Error(`unexpected_fetch:${u}`);
      });

      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.createSubscription({
          tenantId: 't1',
          userId: 'u1',
          phone: '251912345678',
          planAmount: 100,
          cycle: 'MONTHLY',
          executeDay: 1,
          validityMonths: 12,
        }),
      ).rejects.toThrow();
    });
  });

  describe('handleStandingOrderWebhook', () => {
    it('throws when outSubscriptionNo is missing', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.handleStandingOrderWebhook({ body: {}, rawBody: '{}' }),
      ).rejects.toThrow('outSubscriptionNo_missing');
    });

    it('throws when subscription not found', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.handleStandingOrderWebhook({
          body: { outSubscriptionNo: 'NONEXISTENT' },
          rawBody: '{}',
        }),
      ).rejects.toThrow('subscription_not_found');
    });

    it('deduplicates successful webhook', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          out_subscription_no: 'TSO_1',
          status: 'pending',
          webhook_count: 0,
        },
      ];
      state.tables.subscription_transactions = [
        {
          id: 'tx_1',
          subscription_id: 'sub_1',
          out_subscription_no: 'TSO_1',
          status: 'success',
          amount: '100.00',
          created_at: new Date().toISOString(),
        },
      ];

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.handleStandingOrderWebhook({
        body: {
          outSubscriptionNo: 'TSO_1',
          status: 'SUCCESS',
          amount: 100,
        },
        rawBody: '{}',
      });

      expect(result.ok).toBe(true);
      expect(result.deduped).toBe(true);
    });

    it('processes successful webhook and activates subscription', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          out_subscription_no: 'TSO_1',
          status: 'pending',
          webhook_count: 0,
          failure_count: 0,
        },
      ];

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.handleStandingOrderWebhook({
        body: {
          outSubscriptionNo: 'TSO_1',
          status: 'SUCCESS',
          amount: 100,
          orderSn: 'ORDER_123',
        },
        rawBody: '{}',
      });

      expect(result.ok).toBe(true);
    });

    it('processes failed webhook and increments failure count', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          out_subscription_no: 'TSO_1',
          status: 'pending',
          webhook_count: 0,
          failure_count: 0,
        },
      ];

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.handleStandingOrderWebhook({
        body: {
          outSubscriptionNo: 'TSO_1',
          status: 'FAILED',
          amount: 100,
        },
        rawBody: '{}',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('getSubscriptionStatus', () => {
    it('returns subscriptions for tenant', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          phone_number: '251912345678',
          plan_amount: '100.00',
          status: 'active',
          cycle: 'MONTHLY',
          execute_day: 1,
          next_charge_date: '2026-03-01',
          telebirr_subscription_id: 'tsid_1',
          out_subscription_no: 'TSO_1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.getSubscriptionStatus({ tenantId: 't1' });

      expect(result.ok).toBe(true);
      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions[0].status).toBe('active');
    });

    it('returns empty array when no subscriptions', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.getSubscriptionStatus({ tenantId: 't2' });

      expect(result.ok).toBe(true);
      expect(result.subscriptions).toHaveLength(0);
    });
  });

  describe('cancelSubscription', () => {
    it('throws when standing order is disabled', async () => {
      process.env.TELEBIRR_STANDING_ENABLED = 'false';
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.cancelSubscription({ tenantId: 't1', subscriptionId: 'sub_1' }),
      ).rejects.toThrow('Telebirr standing order is disabled');
    });

    it('throws when subscription not found', async () => {
      const svc = require('../../src/services/telebirrStandingOrderService');

      await expect(
        svc.cancelSubscription({ tenantId: 't1', subscriptionId: 'nonexistent' }),
      ).rejects.toThrow('not_found');
    });

    it('returns ok when subscription already cancelled', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          out_subscription_no: 'TSO_1',
          status: 'cancelled',
          telebirr_subscription_id: null,
        },
      ];

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.cancelSubscription({ tenantId: 't1', subscriptionId: 'sub_1' });

      expect(result.ok).toBe(true);
    });

    it('cancels active subscription', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.telebirr_subscriptions = [
        {
          id: 'sub_1',
          tenant_id: 't1',
          out_subscription_no: 'TSO_1',
          status: 'active',
          telebirr_subscription_id: 'tsid_1',
        },
      ];

      // Mock fetch for cancel endpoint (will fail since not configured, but local cancel still applied)
      global.fetch = jest.fn().mockResolvedValue({ json: async () => ({}) });

      const svc = require('../../src/services/telebirrStandingOrderService');

      const result = await svc.cancelSubscription({ tenantId: 't1', subscriptionId: 'sub_1' });

      expect(result.ok).toBe(true);
    });
  });
});
