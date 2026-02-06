const { config } = require('../config');
const { getRedisClient } = require('./redisClient');
const { ServiceUnavailableError } = require('./errors');

const memoryState = new Map();

const getDefaults = () => ({
  failureThreshold: Number(config.breakerFailureThreshold || 5) || 5,
  recoveryMs: Number(config.breakerRecoveryMs || 30000) || 30000,
  halfOpenSuccesses: Number(config.breakerHalfOpenSuccesses || 2) || 2,
});

const loadState = async (name) => {
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(`cb:${name}`);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null;
  }
  return memoryState.get(name) || null;
};

const saveState = async (name, state) => {
  const redis = await getRedisClient();
  if (redis) {
    const ttlSeconds = Math.max(60, Math.ceil((state.recoveryMs || 30000) / 1000) * 10);
    await redis.set(`cb:${name}`, JSON.stringify(state), { EX: ttlSeconds });
    return;
  }
  memoryState.set(name, state);
};

const resetState = async (name, defaults) => {
  const state = {
    status: 'closed',
    failures: 0,
    lastFailureAt: 0,
    halfOpenSuccesses: 0,
    recoveryMs: defaults.recoveryMs,
  };
  await saveState(name, state);
  return state;
};

const withCircuitBreaker = async (name, fn) => {
  const defaults = getDefaults();
  const now = Date.now();
  const state = (await loadState(name)) || (await resetState(name, defaults));

  if (state.status === 'open') {
    if (now - state.lastFailureAt < defaults.recoveryMs) {
      throw new ServiceUnavailableError(`${name}_unavailable`);
    }
    state.status = 'half_open';
    state.halfOpenSuccesses = 0;
  }

  try {
    const result = await fn();
    if (state.status === 'half_open') {
      state.halfOpenSuccesses += 1;
      if (state.halfOpenSuccesses >= defaults.halfOpenSuccesses) {
        await resetState(name, defaults);
      } else {
        await saveState(name, state);
      }
    } else if (state.failures !== 0) {
      await resetState(name, defaults);
    }
    return result;
  } catch (err) {
    state.failures = Number(state.failures || 0) + 1;
    state.lastFailureAt = now;
    state.recoveryMs = defaults.recoveryMs;

    if (state.status === 'half_open' || state.failures >= defaults.failureThreshold) {
      state.status = 'open';
      state.halfOpenSuccesses = 0;
    }

    await saveState(name, state);
    throw err;
  }
};

module.exports = { withCircuitBreaker };
