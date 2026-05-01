const { config } = require('../config');
const { getRedisClient } = require('./redisClient');

const memoryCache = new Map();

const nowMs = () => Date.now();

const getTtlSeconds = (ttlSeconds) => {
  const fallback = Number(config.cacheDefaultTtlSeconds || 60) || 60;
  const n = Number(ttlSeconds || 0) || 0;
  return n > 0 ? n : fallback;
};

const normalizeKey = (key) => {
  const prefix = String(config.cacheKeyPrefix || '').trim();
  const k = String(key || '').trim();
  if (!k) return '';
  if (!prefix) return k;
  if (k.startsWith(prefix)) return k;
  return `${prefix}${k}`;
};

const getMemory = (key) => {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= nowMs()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
};

const setMemory = (key, value, ttlSeconds) => {
  const ttl = getTtlSeconds(ttlSeconds);
  memoryCache.set(key, { value, expiresAt: nowMs() + ttl * 1000 });
};

const getCachedJson = async (key) => {
  if (config.cacheDisabled) return null;
  const k = normalizeKey(key);
  if (!k) return null;
  const redis = await getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(k);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    } catch (err) {
      return getMemory(k);
    }
  }
  return getMemory(k);
};

const deleteCachedKey = async (key) => {
  const k = normalizeKey(key);
  if (!k) return;
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.del(k);
      return;
    } catch (err) {
      // fallback to memory below
    }
  }
  memoryCache.delete(k);
};

const deleteCachedKeys = async (keys) => {
  const list = Array.isArray(keys) ? keys : [];
  const normalized = list
    .map((k) => normalizeKey(k))
    .filter(Boolean);
  if (!normalized.length) return;

  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.del(normalized);
      return;
    } catch (err) {
      // fallback to memory below
    }
  }

  for (const k of normalized) {
    memoryCache.delete(k);
  }
};

const deleteCachedPrefix = async (prefix) => {
  const raw = String(prefix || '').trim();
  if (!raw) return;

  const normalizedPrefix = normalizeKey(raw);
  if (!normalizedPrefix) return;

  const redis = await getRedisClient();
  if (redis) {
    const pattern = `${normalizedPrefix}*`;
    const keys = [];

    if (typeof redis.scanIterator === 'function') {
      for await (const k of redis.scanIterator({ MATCH: pattern, COUNT: 500 })) {
        if (k) keys.push(k);
        if (keys.length >= 500) {
          await redis.del(keys.splice(0));
        }
      }
    } else {
      let cursor = '0';
      do {
        const res = await redis.scan(cursor, { MATCH: pattern, COUNT: 500 });
        const nextCursor = Array.isArray(res) ? res[0] : '0';
        const batch = Array.isArray(res) ? res[1] : [];
        for (const k of batch || []) keys.push(k);
        cursor = String(nextCursor);
        if (keys.length >= 500) {
          await redis.del(keys.splice(0));
        }
      } while (cursor !== '0');
    }

    if (keys.length) {
      await redis.del(keys);
    }
    return;
  }

  for (const k of Array.from(memoryCache.keys())) {
    if (k.startsWith(normalizedPrefix)) memoryCache.delete(k);
  }
};

const invalidateOwnerReports = async ({ tenantId, branchId }) => {
  if (!tenantId) return;
  const t = String(tenantId);
  const b = branchId ? String(branchId) : null;
  if (b) {
    await deleteCachedPrefix(`reports:owner:v1:${t}:${b}:`);
  } else {
    await deleteCachedPrefix(`reports:owner:v1:${t}:`);
  }
};

const setCachedJson = async (key, value, ttlSeconds) => {
  if (config.cacheDisabled) return;
  const k = normalizeKey(key);
  if (!k) return;
  const ttl = getTtlSeconds(ttlSeconds);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.set(k, JSON.stringify(value), { EX: ttl });
      return;
    } catch (err) {
      // fallback to memory below
    }
  }
  setMemory(k, value, ttl);
};

const withCache = async (key, ttlSeconds, fetcher) => {
  if (config.cacheDisabled) return await fetcher();
  const cached = await getCachedJson(key);
  if (cached !== null) return cached;
  const value = await fetcher();
  await setCachedJson(key, value, ttlSeconds);
  return value;
};

module.exports = {
  getCachedJson,
  setCachedJson,
  deleteCachedKey,
  deleteCachedKeys,
  deleteCachedPrefix,
  withCache,
  invalidateOwnerReports,
};
