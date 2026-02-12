jest.mock('../../src/utils/circuitBreaker', () => ({ withCircuitBreaker: async (_key, fn) => fn() }));
jest.mock('../../src/utils/cache', () => ({ withCache: async (_key, _ttl, fn) => fn() }));
jest.mock('../../src/config', () => ({ config: { gatewayRequestTimeoutMs: 0, cacheDefaultTtlSeconds: 0 } }));

// Avoid pulling telebirr-specific heavy utilities for this suite.
jest.mock('../../src/utils/telebirr/tools', () => ({}));

jest.unmock('../../src/services/paymentGatewayService');

describe('services/paymentGatewayService - Chapa', () => {
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
        chapa_config_json: JSON.stringify({ enabled: true, secretKey: 'sk_test' }),
        telebirr_config_json: JSON.stringify({ enabled: false }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { checkout_url: 'https://chapa.checkout' } }),
    }));
  });

  afterEach(() => {
    delete global.fetch;
    process.env = prevEnv;
  });

  it('throws when Chapa is not configured', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        chapa_config_json: JSON.stringify({ enabled: false }),
        telebirr_config_json: JSON.stringify({ enabled: false }),
      },
    ];

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.chapaInitialize({
        amount: 10,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        txRef: 'tx_1',
        callbackUrl: 'https://cb',
        returnUrl: 'https://ret',
      }),
    ).rejects.toThrow('Chapa is not configured');
  });

  it('chapaInitialize returns checkoutUrl when API succeeds', async () => {
    const svc = require('../../src/services/paymentGatewayService');

    const res = await svc.chapaInitialize({
      amount: 10,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      txRef: 'tx_1',
      callbackUrl: 'https://cb',
      returnUrl: 'https://ret',
      customization: { title: 'T', description: 'D' },
    });

    expect(res).toEqual({ success: true, checkoutUrl: 'https://chapa.checkout', txRef: 'tx_1' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/transaction/initialize');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk_test');

    const payload = JSON.parse(options.body);
    expect(payload.tx_ref).toBe('tx_1');
    expect(payload.callback_url).toBe('https://cb');
    expect(payload.return_url).toBe('https://ret');
  });

  it('chapaInitialize throws when API returns non-success status', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', message: 'nope' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.chapaInitialize({
        amount: 10,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        txRef: 'tx_1',
        callbackUrl: 'https://cb',
        returnUrl: 'https://ret',
      }),
    ).rejects.toThrow('nope');
  });

  it('chapaVerify returns normalized result', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          status: 'success',
          amount: '10.00',
          currency: 'ETB',
          tx_ref: 'tx_1',
          reference: 'ref_1',
          payment_method: 'card',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.chapaVerify('tx_1');

    expect(res.success).toBe(true);
    expect(res.txRef).toBe('tx_1');
    expect(res.reference).toBe('ref_1');

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/transaction/verify/tx_1');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer sk_test');
  });

  it('chapaVerify throws when API returns non-ok response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'server_error' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');

    await expect(svc.chapaVerify('tx_1')).rejects.toThrow('server_error');
  });

  it('chapaInitializeForTenantPos throws when tenant config missing/disabled', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [];

    const svc = require('../../src/services/paymentGatewayService');

    await expect(
      svc.chapaInitializeForTenantPos({
        tenantId: 't1',
        amount: 10,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        txRef: 'tx_1',
        callbackUrl: 'https://cb',
        returnUrl: 'https://ret',
      }),
    ).rejects.toThrow('tenant_chapa_not_configured');
  });

  it('chapaInitializeForTenantPos returns checkoutUrl when configured', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'chapa',
        enabled: 1,
        config_json: JSON.stringify({ secretKey: 'sk_tenant' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { checkout_url: 'https://chapa.tenant.checkout' } }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.chapaInitializeForTenantPos({
      tenantId: 't1',
      amount: 10,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      txRef: 'tx_1',
      callbackUrl: 'https://cb',
      returnUrl: 'https://ret',
    });

    expect(res).toEqual({ success: true, checkoutUrl: 'https://chapa.tenant.checkout', txRef: 'tx_1' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/transaction/initialize');
    expect(options.headers.Authorization).toBe('Bearer sk_tenant');
  });

  it('chapaVerifyForTenantPos throws when tenant config missing/disabled', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [];

    const svc = require('../../src/services/paymentGatewayService');
    await expect(svc.chapaVerifyForTenantPos({ tenantId: 't1', txRef: 'tx_1' })).rejects.toThrow('tenant_chapa_not_configured');
  });

  it('chapaVerifyForTenantPos returns normalized result', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'chapa',
        enabled: 1,
        config_json: JSON.stringify({ secretKey: 'sk_tenant' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          status: 'success',
          amount: '10.00',
          currency: 'ETB',
          tx_ref: 'tx_1',
          reference: 'ref_1',
          payment_method: 'card',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.chapaVerifyForTenantPos({ tenantId: 't1', txRef: 'tx_1' });

    expect(res.success).toBe(true);
    expect(res.txRef).toBe('tx_1');

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/transaction/verify/tx_1');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer sk_tenant');
  });

  it('chapaVerifyForTenantPos throws when API returns non-ok response', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'chapa',
        enabled: 1,
        config_json: JSON.stringify({ secretKey: 'sk_tenant' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'verify_failed' }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    await expect(svc.chapaVerifyForTenantPos({ tenantId: 't1', txRef: 'tx_1' })).rejects.toThrow('verify_failed');
  });

  it('chapaVerifyForTenantPos returns success=false when status is not success', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenant_pos_payment_gateways = [
      {
        tenant_id: 't1',
        gateway: 'chapa',
        enabled: 1,
        config_json: JSON.stringify({ secretKey: 'sk_tenant' }),
      },
    ];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'error',
        data: {
          status: 'failed',
          tx_ref: 'tx_1',
        },
      }),
    }));

    const svc = require('../../src/services/paymentGatewayService');
    const res = await svc.chapaVerifyForTenantPos({ tenantId: 't1', txRef: 'tx_1' });

    expect(res.success).toBe(false);
    expect(res.txRef).toBe('tx_1');
  });
});
