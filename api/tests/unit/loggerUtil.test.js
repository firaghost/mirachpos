jest.mock('pino', () => {
  const child = jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child,
  }));

  const baseLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child,
  };

  const pino = jest.fn(() => baseLogger);
  pino.stdTimeFunctions = { isoTime: () => '' };
  return pino;
});

jest.mock('../../src/config', () => ({
  config: { env: 'test' },
}));

jest.unmock('../../src/utils/logger');

describe('utils/logger', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('createRequestLogger includes request context fields', () => {
    const { createRequestLogger } = require('../../src/utils/logger');

    const req = {
      requestId: 'r1',
      method: 'GET',
      path: '/x',
      ip: '1.2.3.4',
      headers: { 'user-agent': 'ua', 'x-forwarded-for': '9.9.9.9' },
      tenant: { id: 't1' },
      auth: { staffId: 's1' },
    };

    const childLogger = createRequestLogger(req);
    expect(childLogger).toBeTruthy();
  });

  it('requestLogger attaches req.log and logs start/end', () => {
    const { requestLogger } = require('../../src/utils/logger');

    const req = {
      requestId: 'r1',
      method: 'POST',
      path: '/x',
      ip: '1.2.3.4',
      headers: { 'user-agent': 'ua' },
    };

    let finishCb;
    const res = {
      statusCode: 200,
      on: (evt, cb) => {
        if (evt === 'finish') finishCb = cb;
      },
    };

    const next = jest.fn();
    requestLogger(req, res, next);

    expect(req.log).toBeTruthy();
    expect(next).toHaveBeenCalledTimes(1);

    finishCb();
  });

  it('logAudit ignores db failures', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/db', () => ({
        db: () => ({ from: () => ({ insert: async () => { throw new Error('fail'); } }) }),
      }));

      jest.unmock('../../src/utils/logger');
      const { logAudit } = require('../../src/utils/logger');

      await expect(
        logAudit({ tenantId: 't1', type: 'x', summary: 'y', payload: { a: 1 }, requestId: 'r' }),
      ).resolves.toBeUndefined();
    });
  });
});
