jest.mock('../../src/utils/circuitBreaker', () => ({ withCircuitBreaker: async (_key, fn) => fn() }));
jest.mock('../../src/utils/cache', () => ({ withCache: async (_key, _ttl, fn) => fn() }));
jest.mock('../../src/config', () => ({ config: { gatewayRequestTimeoutMs: 0, cacheDefaultTtlSeconds: 0 } }));

const mockTelebirrTools = {
  createTimeStamp: jest.fn(() => '1700000000'),
  createNonceStr: jest.fn(() => 'nonce'),
  signRequestObject: jest.fn(() => 'sig'),
};

jest.mock('../../src/utils/telebirr/tools', () => mockTelebirrTools);

jest.unmock('../../src/services/paymentGatewayService');

describe('services/paymentGatewayService - Telebirr', () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();

    require('../../src/db');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: false }),
        telebirr_config_json: JSON.stringify({
          enabled: true,
          baseUrl: 'https://telebirr.example',
          fabricAppId: 'fab_1',
          appSecret: 'sec_1',
          merchantAppId: 'mapp_1',
          merchantCode: 'mcode_1',
          privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
          checkoutMode: 'paygate',
          tradeType: 'WebCheckout',
        }),
      },
    ];

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'Bearer token' }),
        };
      }

      if (u.includes('/payment/v1/merchant/preOrder')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ biz_content: { prepay_id: 'pp_1', toPayUrl: 'https://h5.telebirr/checkout' } }),
        };
      }

      throw new Error(`unexpected_fetch:${u}`);
    });
  });

  afterEach(() => {
    delete global.fetch;
    process.env = prevEnv;
  });

  it('telebirrInitialize returns checkoutUrl and prepayId and signs requests', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    const svc = require('../../src/services/paymentGatewayService');

    const res = await svc.telebirrInitialize({
      amount: 10,
      nonce: 'n',
      outTradeNo: 'ORDER1',
      subject: 'My Shop!',
      receiveName: 'MirachPOS',
      notifyUrl: 'https://notify',
      returnUrl: 'https://return',
    });

    expect(res.success).toBe(true);
    expect(res.checkoutUrl).toBe('https://h5.telebirr/checkout');
    expect(res.outTradeNo).toBe('ORDER1');
    expect(res.telebirr.prepayId).toBe('pp_1');

    expect(mockTelebirrTools.signRequestObject).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('telebirrInitialize throws on invalid private key (non-PEM) when config key is not PEM', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: false }),
        telebirr_config_json: JSON.stringify({
          enabled: true,
          baseUrl: 'https://telebirr.example',
          fabricAppId: 'fab_1',
          appSecret: 'sec_1',
          merchantAppId: 'mapp_1',
          merchantCode: 'mcode_1',
          privateKey: 'not-pem',
          checkoutMode: 'paygate',
          tradeType: 'WebCheckout',
        }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.telebirrInitialize({
        amount: 10,
        nonce: 'n',
        outTradeNo: 'ORDER1',
        subject: 'My Shop!',
        receiveName: 'MirachPOS',
        notifyUrl: 'https://notify',
        returnUrl: 'https://return',
      }),
    ).rejects.toThrow('Telebirr private key is invalid (expected PEM format)');
  });

  it('telebirrInitialize throws when configuration is incomplete', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: false }),
        telebirr_config_json: JSON.stringify({ enabled: true }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.telebirrInitialize({
        amount: 10,
        nonce: 'n',
        outTradeNo: 'ORDER1',
        subject: 'My Shop!',
        receiveName: 'MirachPOS',
        notifyUrl: 'https://notify',
        returnUrl: 'https://return',
      }),
    ).rejects.toThrow('Telebirr is missing configuration (Fabric App ID, Secret, Merchant ID, Code, Private Key)');
  });

  it('telebirrInitialize throws friendly error when token endpoint fails with fetch failed', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        throw new Error('fetch failed');
      }
      throw new Error(`unexpected_fetch:${u}`);
    });

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.telebirrInitialize({
        amount: 10,
        nonce: 'n',
        outTradeNo: 'ORDER1',
        subject: 'My Shop!',
        receiveName: 'MirachPOS',
        notifyUrl: 'https://notify',
        returnUrl: 'https://return',
      }),
    ).rejects.toThrow('Unable to reach Telebirr token endpoint');
  });

  it('telebirrInitialize throws when preOrder response is missing prepay_id', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'Bearer token' }),
        };
      }

      if (u.includes('/payment/v1/merchant/preOrder')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ code: '0', biz_content: { toPayUrl: 'https://h5.telebirr/checkout' } }),
        };
      }

      throw new Error(`unexpected_fetch:${u}`);
    });

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.telebirrInitialize({
        amount: 10,
        nonce: 'n',
        outTradeNo: 'ORDER1',
        subject: 'My Shop!',
        receiveName: 'MirachPOS',
        notifyUrl: 'https://notify',
        returnUrl: 'https://return',
      }),
    ).rejects.toThrow(/missing prepay_id/i);
  });

  it('telebirrInitialize builds checkoutUrl from relative toPayUrl using TELEBIRR_CHECKOUT_BASE_URL', async () => {
    process.env.TELEBIRR_ENABLED = 'true';
    process.env.TELEBIRR_CHECKOUT_BASE_URL = 'https://h5.telebirr.example/';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'Bearer token' }),
        };
      }
      if (u.includes('/payment/v1/merchant/preOrder')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ biz_content: { prepay_id: 'pp_1', toPayUrl: '/checkout/pp_1' } }),
        };
      }
      throw new Error(`unexpected_fetch:${u}`);
    });

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.telebirrInitialize({
      amount: 10,
      nonce: 'n',
      outTradeNo: 'ORDER1',
      subject: 'My Shop!',
      receiveName: 'MirachPOS',
      notifyUrl: 'https://notify',
      returnUrl: 'https://return',
    });

    expect(res.success).toBe(true);
    expect(res.checkoutUrl).toBe('https://h5.telebirr.example/checkout/pp_1');
  });

  it('telebirrInitialize falls back to paygate checkout URL when no toPayUrl is returned', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'Bearer token' }),
        };
      }
      if (u.includes('/payment/v1/merchant/preOrder')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ biz_content: { prepay_id: 'pp_1' } }),
        };
      }
      throw new Error(`unexpected_fetch:${u}`);
    });

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.telebirrInitialize({
      amount: 10,
      nonce: 'n',
      outTradeNo: 'ORDER1',
      subject: 'My Shop!',
      receiveName: 'MirachPOS',
      notifyUrl: 'https://notify',
      returnUrl: 'https://return',
    });

    expect(res.success).toBe(true);
    expect(res.checkoutUrl).toContain('/payment/web/paygate?');
    expect(res.checkoutUrl).toContain('prepay_id=pp_1');
  });

  it('telebirrVerify returns success=true for COMPLETED trade_status', async () => {
    process.env.TELEBIRR_ENABLED = 'true';

    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/payment/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'Bearer token' }),
        };
      }
      if (u.includes('/payment/v1/merchant/queryOrder')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: '0', biz_content: { trade_status: 'COMPLETED' } }),
        };
      }
      throw new Error(`unexpected_fetch:${u}`);
    });

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.telebirrVerify('ORDER1');

    expect(res.success).toBe(true);
    expect(res.status).toBe('COMPLETED');
  });
});
