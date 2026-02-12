jest.mock('../../src/utils/circuitBreaker', () => ({ withCircuitBreaker: async (_key, fn) => fn() }));
jest.mock('../../src/utils/cache', () => ({ withCache: async (_key, _ttl, fn) => fn() }));
jest.mock('../../src/config', () => ({ config: { gatewayRequestTimeoutMs: 0, cacheDefaultTtlSeconds: 0 } }));
const mockTelebirrTools = {
  createTimeStamp: jest.fn(() => '1700000000'),
  createNonceStr: jest.fn(() => 'nonce'),
  signRequestObject: jest.fn(() => 'sig'),
};

jest.mock('../../src/utils/telebirr/tools', () => mockTelebirrTools);

const mockJwtSign = jest.fn(() => 'signed');
jest.mock('jsonwebtoken', () => ({ sign: (...args) => mockJwtSign(...args) }));

jest.unmock('../../src/services/paymentGatewayService');

describe('services/paymentGatewayService - dispatchers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJwtSign.mockReturnValue('signed');
    require('../../src/db');

    global.__MIRACHPOS_DB_MOCK__?.reset?.();
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: true, secretKey: 'sk_test' }),
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
      if (u.includes('/transaction/initialize')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', data: { checkout_url: 'https://chapa.checkout' } }),
        };
      }

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

    process.env.SANTIMPAY_ENABLED = 'true';
    process.env.SANTIMPAY_MERCHANT_ID = 'm_env';
    process.env.SANTIMPAY_PRIVATE_KEY = '-----BEGIN KEY-----\nabc\n-----END KEY-----';
  });

  afterEach(() => {
    delete global.fetch;
    delete process.env.SANTIMPAY_ENABLED;
    delete process.env.SANTIMPAY_MERCHANT_ID;
    delete process.env.SANTIMPAY_PRIVATE_KEY;
  });

  it('initializePayment routes chapa gateway', async () => {
    const svc = require('../../src/services/paymentGatewayService');

    const res = await svc.initializePayment({
      gateway: 'chapa',
      invoiceId: 'inv1',
      tenantId: 't1',
      amount: 10,
      email: 'a@b.com',
      phone: 'x',
      firstName: 'A',
      lastName: 'B',
      callbackUrl: 'https://cb',
      returnUrl: 'https://ret',
    });

    expect(res.success).toBe(true);
    expect(global.fetch).toHaveBeenCalled();

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.tx_ref).toContain('inv1_');
  });

  it('verifyPaymentGateway routes santimpay gateway', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'COMPLETED' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.verifyPaymentGateway('santimpay', 'ref_1');

    expect(res.status).toBe('COMPLETED');
    expect(global.fetch).toHaveBeenCalled();
    expect(mockJwtSign).toHaveBeenCalled();
  });

  it('throws on unknown gateway', async () => {
    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.initializePayment({
        gateway: 'nope',
        invoiceId: 'inv1',
        tenantId: 't1',
        amount: 10,
      }),
    ).rejects.toThrow('Unknown payment gateway: nope');

    await expect(svc.verifyPaymentGateway('nope', 'x')).rejects.toThrow('Unknown payment gateway: nope');
  });

  it('initializePayment routes telebirr gateway and sanitizes Telebirr txRef', async () => {
    const svc = require('../../src/services/paymentGatewayService');

    const res = await svc.initializePayment({
      gateway: 'telebirr',
      invoiceId: 'inv-###-001',
      tenantId: 't1',
      amount: 10,
      email: 'a@b.com',
      phone: 'x',
      firstName: 'A',
      lastName: 'B',
      callbackUrl: 'https://cb',
      returnUrl: 'https://ret',
    });

    expect(res.success).toBe(true);
    expect(global.fetch).toHaveBeenCalled();

    const preOrderCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/payment/v1/merchant/preOrder'));
    expect(preOrderCall).toBeTruthy();

    const [, options] = preOrderCall;
    const body = JSON.parse(options.body);

    const merchOrderId = body?.biz_content?.merch_order_id;
    const nonceStr = body?.nonce_str;

    expect(typeof merchOrderId).toBe('string');
    expect(typeof nonceStr).toBe('string');
    expect(merchOrderId).toMatch(/^[A-Za-z0-9]+$/);
    expect(nonceStr).toMatch(/^[A-Za-z0-9]+$/);
    expect(merchOrderId.length).toBeLessThanOrEqual(64);
    expect(nonceStr.length).toBeLessThanOrEqual(64);
  });

  it('initializePayment truncates Telebirr txRef to 64 chars for long invoiceId', async () => {
    const svc = require('../../src/services/paymentGatewayService');
    const longInvoiceId = 'INV' + 'X'.repeat(200);

    await svc.initializePayment({
      gateway: 'telebirr',
      invoiceId: longInvoiceId,
      tenantId: 't1',
      amount: 10,
      callbackUrl: 'https://cb',
      returnUrl: 'https://ret',
    });

    const preOrderCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/payment/v1/merchant/preOrder'));
    const [, options] = preOrderCall;
    const body = JSON.parse(options.body);
    const merchOrderId = body?.biz_content?.merch_order_id;

    expect(typeof merchOrderId).toBe('string');
    expect(merchOrderId).toMatch(/^[A-Za-z0-9]+$/);
    expect(merchOrderId.length).toBeLessThanOrEqual(64);
  });
});
