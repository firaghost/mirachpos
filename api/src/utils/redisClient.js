const { config } = require('../config');
const { logger } = require('./logger');

let client;
let connecting;
let circuitBreakerTrippedUntil = 0;

const buildRedisUrl = () => {
  if (config.redisUrl) return config.redisUrl;
  const host = String(config.redisHost || '').trim();
  const port = Number(config.redisPort || 0) || 0;
  if (!host || !port) return '';
  const auth = String(config.redisPassword || '').trim();
  const db = Number(config.redisDb ?? 0) || 0;
  const credentials = auth ? `:${encodeURIComponent(auth)}@` : '';
  return `redis://${credentials}${host}:${port}/${db}`;
};

const getRedisClient = async () => {
  if (client) return client;
  
  // If we recently failed, don't try again immediately to avoid 5s delays on every single DB/cache operation
  if (Date.now() < circuitBreakerTrippedUntil) {
    return null;
  }

  const url = buildRedisUrl();
  if (!url) return null;

  if (!connecting) {
    connecting = (async () => {
      try {
        let createClient;
        try {
          ({ createClient } = require('redis'));
        } catch (err) {
          logger.warn({ err }, 'Redis module not installed. Circuit breaker will use in-memory state.');
          return null;
        }
        client = createClient({
          url,
          socket: {
            connectTimeout: 3000,
            reconnectStrategy: (retries) => {
              if (retries >= 2) {
                return new Error('Max retries reached');
              }
              return Math.min(retries * 500, 1000);
            },
          },
        });
        client.on('error', (err) => {
          // Prevent flooding logs with reconnect errors if we've already decided it failed
          if (!client) return; 
          logger.error({ err }, 'Redis client error');
        });
        await client.connect();
        logger.info({ url }, 'Redis connected');
        // Reset circuit breaker on success
        circuitBreakerTrippedUntil = 0;
        return client;
      } catch (err) {
        logger.error({ err }, 'Failed to connect to Redis, tripping circuit breaker for 30s');
        client = null;
        connecting = null;
        // Trip circuit breaker for 30 seconds before trying again
        circuitBreakerTrippedUntil = Date.now() + 30000;
        return null;
      }
    })();
  }

  return connecting;
};

const closeRedisClient = async () => {
  if (!connecting) return;
  try {
    const c = await connecting;
    if (!c) return;
    await c.quit();
  } catch (err) {
    try {
      logger.warn({ err }, 'Failed to close Redis');
    } catch {
      // ignore
    }
  } finally {
    client = undefined;
    connecting = undefined;
  }
};

module.exports = { getRedisClient, closeRedisClient };
