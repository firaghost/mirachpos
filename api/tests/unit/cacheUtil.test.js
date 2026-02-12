jest.mock('../../src/config', () => ({
  config: {
    cacheDisabled: false,
    cacheDefaultTtlSeconds: 60,
    cacheKeyPrefix: 'p:',
  },
}));

jest.mock('../../src/utils/redisClient', () => ({
  getRedisClient: jest.fn(async () => null),
}));

describe('utils/cache', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('withCache caches values in memory when redis is not available', async () => {
    const { withCache } = require('../../src/utils/cache');

    const fetcher = jest.fn(async () => ({ ok: true }));

    const a = await withCache('k1', 10, fetcher);
    const b = await withCache('k1', 10, fetcher);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns fetcher result when cacheDisabled=true', async () => {
    jest.doMock('../../src/config', () => ({
      config: { cacheDisabled: true, cacheDefaultTtlSeconds: 60, cacheKeyPrefix: 'p:' },
    }));

    const { withCache } = require('../../src/utils/cache');
    const fetcher = jest.fn(async () => 123);

    const v = await withCache('k2', 10, fetcher);
    expect(v).toBe(123);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deleteCachedKeys removes multiple keys from memory cache', async () => {
    jest.doMock('../../src/config', () => ({
      config: { cacheDisabled: false, cacheDefaultTtlSeconds: 60, cacheKeyPrefix: '' },
    }));

    const { withCache, deleteCachedKeys } = require('../../src/utils/cache');

    const f1 = jest.fn(async () => 1);
    const f2 = jest.fn(async () => 2);

    expect(await withCache('a', 60, f1)).toBe(1);
    expect(await withCache('b', 60, f2)).toBe(2);

    await deleteCachedKeys(['a', 'b']);

    expect(await withCache('a', 60, f1)).toBe(1);
    expect(await withCache('b', 60, f2)).toBe(2);

    expect(f1).toHaveBeenCalledTimes(2);
    expect(f2).toHaveBeenCalledTimes(2);
  });

  it('deleteCachedPrefix removes keys by prefix from memory cache', async () => {
    jest.doMock('../../src/config', () => ({
      config: { cacheDisabled: false, cacheDefaultTtlSeconds: 60, cacheKeyPrefix: '' },
    }));

    const { withCache, deleteCachedPrefix } = require('../../src/utils/cache');

    const f1 = jest.fn(async () => 1);
    const f2 = jest.fn(async () => 2);
    const f3 = jest.fn(async () => 3);

    expect(await withCache('reports:x:1', 60, f1)).toBe(1);
    expect(await withCache('reports:x:2', 60, f2)).toBe(2);
    expect(await withCache('other:1', 60, f3)).toBe(3);

    await deleteCachedPrefix('reports:');

    expect(await withCache('reports:x:1', 60, f1)).toBe(1);
    expect(await withCache('reports:x:2', 60, f2)).toBe(2);
    expect(await withCache('other:1', 60, f3)).toBe(3);

    expect(f1).toHaveBeenCalledTimes(2);
    expect(f2).toHaveBeenCalledTimes(2);
    expect(f3).toHaveBeenCalledTimes(1);
  });
});
