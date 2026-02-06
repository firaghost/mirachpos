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
    const raw = await redis.get(k);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return getMemory(k);
};

const setCachedJson = async (key, value, ttlSeconds) => {
  if (config.cacheDisabled) return;
  const k = normalizeKey(key);
  if (!k) return;
  const ttl = getTtlSeconds(ttlSeconds);
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(k, JSON.stringify(value), { EX: ttl });
    return;
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

module.exports = { getCachedJson, setCachedJson, withCache };
