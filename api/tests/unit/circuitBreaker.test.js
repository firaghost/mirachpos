jest.mock('../../src/config', () => ({
  config: {
    breakerFailureThreshold: 2,
    breakerRecoveryMs: 50,
    breakerHalfOpenSuccesses: 1,
  },
}));

jest.mock('../../src/utils/redisClient', () => ({
  getRedisClient: jest.fn(async () => null),
}));

describe('utils/circuitBreaker', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('opens circuit after failure threshold and throws ServiceUnavailableError', async () => {
    const { withCircuitBreaker } = require('../../src/utils/circuitBreaker');

    await expect(withCircuitBreaker('svc', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withCircuitBreaker('svc', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    await expect(withCircuitBreaker('svc', async () => 1)).rejects.toMatchObject({ message: 'svc_unavailable' });
  });

  it('allows through after recovery window and resets after success', async () => {
    const { withCircuitBreaker } = require('../../src/utils/circuitBreaker');

    await expect(withCircuitBreaker('svc2', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withCircuitBreaker('svc2', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    await new Promise((r) => setTimeout(r, 60));

    await expect(withCircuitBreaker('svc2', async () => 123)).resolves.toBe(123);
    await expect(withCircuitBreaker('svc2', async () => 456)).resolves.toBe(456);
  });
});
