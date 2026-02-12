const mockJwtSign = jest.fn();
jest.mock('jsonwebtoken', () => ({ sign: (...args) => mockJwtSign(...args) }));

const mockDecryptConfigFields = jest.fn((cfg) => cfg);
jest.mock('../../src/utils/secretEncryption', () => ({ decryptConfigFields: (...args) => mockDecryptConfigFields(...args) }));

jest.mock('../../src/utils/circuitBreaker', () => ({ withCircuitBreaker: async (_key, fn) => fn() }));
jest.mock('../../src/utils/cache', () => ({ withCache: async (_key, _ttl, fn) => fn() }));
jest.mock('../../src/config', () => ({ config: { gatewayRequestTimeoutMs: 0 } }));

// Telebirr tools not needed for SantimPay test paths
jest.mock('../../src/utils/telebirr/tools', () => ({}));

jest.unmock('../../src/services/paymentGatewayService');

describe('services/paymentGatewayService - SantimPay', () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();
    mockJwtSign.mockReturnValue('signed');

    require('../../src/db');

    global.__MIRACHPOS_DB_MOCK__?.reset?.();
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenant_pos_payment_gateways = [];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ checkoutUrl: 'https://checkout.example' }),
    }));
  });

  afterEach(() => {
    delete global.fetch;
    process.env = prevEnv;
  });

  it('throws tenant_santimpay_not_configured when tenant config missing', async () => {
    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForTenantPos({
        tenantId: 't1',
        id: 'tx_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('tenant_santimpay_not_configured');
  });

  it('throws tenant_santimpay_invalid_private_key when key is not PEM', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: 'not-pem' }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForTenantPos({
        tenantId: 't1',
        id: 'tx_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('tenant_santimpay_invalid_private_key');
  });

  it('throws API error message when initiate-payment fails', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad_request' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForTenantPos({
        tenantId: 't1',
        id: 'tx_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('bad_request');
  });

  it('throws when initiate-payment does not return checkoutUrl', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForTenantPos({
        tenantId: 't1',
        id: 'tx_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('SantimPay initiate-payment did not return checkout URL');
  });

  it('returns checkoutUrl and txRef on success and signs request token', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');

    const res = await svc.santimpayInitializeForTenantPos({
      tenantId: 't1',
      id: 'tx_1',
      amount: 10,
      reason: 'R',
      notifyUrl: 'https://notify',
      successRedirectUrl: '',
      failureRedirectUrl: '',
      cancelRedirectUrl: '',
    });

    expect(res).toEqual({
      success: true,
      checkoutUrl: 'https://checkout.example',
      txRef: 'tx_1',
      rawResponse: { checkoutUrl: 'https://checkout.example' },
    });

    expect(mockJwtSign).toHaveBeenCalledTimes(1);
    const [body, pem, opts] = mockJwtSign.mock.calls[0];
    expect(pem).toContain('BEGIN');
    expect(opts).toEqual({ algorithm: 'ES256' });
    expect(body.merchantId).toBe('m1');
    expect(body.generated).toEqual(expect.any(Number));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/initiate-payment');
    expect(options.headers.Authorization).toBe('Bearer signed');

    const parsed = JSON.parse(options.body);
    expect(parsed.id).toBe('tx_1');
    expect(parsed.merchantId).toBe('m1');
    expect(parsed.signedToken).toBe('signed');
    expect(parsed.notifyUrl).toBe('https://notify');
  });

  it('getTenantPosGatewayConfig returns decrypted config with enabled/updatedAt', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ];

    mockDecryptConfigFields.mockImplementation((cfg, fields) => ({ ...cfg, _fields: fields }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.getTenantPosGatewayConfig('t1', 'santimpay');

    expect(res.enabled).toBe(true);
    expect(res.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(res.config.merchantId).toBe('m1');
    expect(res.config._fields).toEqual(['merchantId', 'privateKey', 'publicKey']);
  });

  it('santimpayVerifyForTenantPos returns success=true when status COMPLETED', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ Status: 'COMPLETED' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.santimpayVerifyForTenantPos({ tenantId: 't1', id: 'tx_1' });

    expect(res).toEqual({ success: true, status: 'COMPLETED', raw: { Status: 'COMPLETED' } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/fetch-transaction-status');
    const body = JSON.parse(options.body);
    expect(body.id).toBe('tx_1');
    expect(body.merchantId).toBe('m1');
    expect(body.signedToken).toBe('signed');

    const [jwtBody, _pem, opts] = mockJwtSign.mock.calls[0];
    expect(opts).toEqual({ algorithm: 'ES256' });
    expect(jwtBody.merId).toBe('m1');
    expect(jwtBody.id).toBe('tx_1');
  });

  it('santimpayVerifyForTenantPos returns success=false when status is not COMPLETED', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'PENDING' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.santimpayVerifyForTenantPos({ tenantId: 't1', id: 'tx_1' });

    expect(res.success).toBe(false);
    expect(res.status).toBe('PENDING');
  });

  it('santimpayVerifyForTenantPos throws when fetch-transaction-status returns non-ok', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ message: 'upstream_bad_gateway' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');

    await expect(svc.santimpayVerifyForTenantPos({ tenantId: 't1', id: 'tx_1' })).rejects.toThrow('upstream_bad_gateway');
  });

  it('santimpayVerifyForTenantPos returns success=false when upstream does not provide status', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'santimpay',
        enabled: 1,
        config_json: JSON.stringify({ merchantId: 'm1', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.santimpayVerifyForTenantPos({ tenantId: 't1', id: 'tx_1' });

    expect(res.success).toBe(false);
    expect(res.status).toBe('');
  });

  it('santimpayInitializeForPlatform throws santimpay_not_configured when env missing', async () => {
    delete process.env.SANTIMPAY_ENABLED;
    delete process.env.SANTIMPAY_MERCHANT_ID;
    delete process.env.SANTIMPAY_PRIVATE_KEY;

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForPlatform({
        id: 'inv_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('santimpay_not_configured');
  });

  it('santimpayInitializeForPlatform throws santimpay_invalid_private_key for non-PEM env key', async () => {
    process.env.SANTIMPAY_ENABLED = 'true';
    process.env.SANTIMPAY_MERCHANT_ID = 'm1';
    process.env.SANTIMPAY_PRIVATE_KEY = 'nope';

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.santimpayInitializeForPlatform({
        id: 'inv_1',
        amount: 10,
        reason: 'R',
        notifyUrl: 'https://notify',
      }),
    ).rejects.toThrow('santimpay_invalid_private_key');
  });

  it('santimpayInitializeForPlatform returns checkoutUrl on success (url field)', async () => {
    process.env.SANTIMPAY_ENABLED = 'true';
    process.env.SANTIMPAY_MERCHANT_ID = 'm1';
    process.env.SANTIMPAY_PRIVATE_KEY = '-----BEGIN KEY-----\nabc\n-----END KEY-----';

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://platform.checkout' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.santimpayInitializeForPlatform({
      id: 'inv_1',
      amount: 10,
      reason: 'R',
      notifyUrl: 'https://notify',
    });

    expect(res.success).toBe(true);
    expect(res.checkoutUrl).toBe('https://platform.checkout');
    expect(res.txRef).toBe('inv_1');
    expect(mockJwtSign).toHaveBeenCalledTimes(1);
  });

  it('santimpayVerifyPlatform returns success based on fetched status and signs status token', async () => {
    process.env.SANTIMPAY_ENABLED = 'true';
    process.env.SANTIMPAY_MERCHANT_ID = 'm_env';
    process.env.SANTIMPAY_PRIVATE_KEY = '-----BEGIN KEY-----\nabc\n-----END KEY-----';

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'COMPLETED' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.santimpayVerifyPlatform({ id: 'inv_1' });

    expect(res.success).toBe(true);
    expect(res.status).toBe('COMPLETED');

    const [jwtBody, _pem, opts] = mockJwtSign.mock.calls[0];
    expect(opts).toEqual({ algorithm: 'ES256' });
    expect(jwtBody.merId).toBe('m_env');
    expect(jwtBody.id).toBe('inv_1');
  });

  it('getAvailablePaymentMethods enables bankTransfer and santimpay when configured', async () => {
    process.env.SANTIMPAY_ENABLED = 'true';
    process.env.SANTIMPAY_MERCHANT_ID = 'm_env';
    process.env.SANTIMPAY_PRIVATE_KEY = '-----BEGIN KEY-----\nabc\n-----END KEY-----';

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: false }),
        telebirr_config_json: JSON.stringify({ enabled: false }),
        bank_details_json: JSON.stringify({ bankName: 'X', accountNumber: '123', accountName: 'A' }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.getAvailablePaymentMethods();

    expect(res.bankTransfer.enabled).toBe(true);
    expect(res.santimpay.enabled).toBe(true);
    expect(res.chapa.enabled).toBe(false);
    expect(res.telebirr.enabled).toBe(false);
  });
});
