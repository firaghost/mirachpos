describe('paymentIdempotency', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('checkIdempotency returns exists=false when key not found', async () => {
    const { checkIdempotency } = require('../../src/middleware/paymentIdempotency');
    const res = await checkIdempotency('k_missing');
    expect(res).toEqual({ exists: false });
  });

  it('storeIdempotency persists and checkIdempotency can read it back', async () => {
    const { storeIdempotency, checkIdempotency } = require('../../src/middleware/paymentIdempotency');

    await storeIdempotency('k1', '/p', { ok: true, n: 1 });

    const res = await checkIdempotency('k1');
    expect(res.exists).toBe(true);
    expect(res.response).toEqual({ ok: true, n: 1 });
  });

  it('paymentIdempotency returns cached response when key exists', async () => {
    const mod = require('../../src/middleware/paymentIdempotency');

    await mod.storeIdempotency('k2', '/pay', { ok: true, cached: true });

    const req = {
      method: 'POST',
      path: '/pay',
      headers: { 'x-idempotency-key': 'k2' },
      body: { a: 1 },
      auth: { tenantId: 't_test' },
    };

    const res = { json: jest.fn(), statusCode: 200 };
    const next = jest.fn();

    await mod.paymentIdempotency(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ ok: true, cached: true });
    expect(next).not.toHaveBeenCalled();
  });
});
