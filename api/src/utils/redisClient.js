const { config } = require('../config');
const { logger } = require('./logger');

let client;
let connecting;

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
        client = createClient({ url });
        client.on('error', (err) => logger.error({ err }, 'Redis client error'));
        await client.connect();
        logger.info({ url }, 'Redis connected');
        return client;
      } catch (err) {
        logger.error({ err }, 'Failed to connect to Redis');
        client = null;
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
