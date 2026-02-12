const knexLib = require('knex');
const { logger } = require('./utils/logger');

const makeKnex = () => {
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  // eslint-disable-next-line global-require
  const knexfile = require('../knexfile');
  const knex = knexLib(knexfile[env]);

  const slowQueryMs = () => Number(process.env.SLOW_QUERY_MS || 0) || 0;
  const queryStarts = new Map();

  knex.on('query', (q) => {
    const threshold = slowQueryMs();
    if (threshold <= 0) return;
    if (!q?.__knexQueryUid) return;
    queryStarts.set(q.__knexQueryUid, Date.now());
  });

  const onQueryDone = (q) => {
    const threshold = slowQueryMs();
    if (threshold <= 0) return;
    const uid = q?.__knexQueryUid;
    if (!uid) return;
    const start = queryStarts.get(uid);
    queryStarts.delete(uid);
    if (!start) return;

    const duration = Date.now() - start;
    if (duration < threshold) return;

    const sql = typeof q?.sql === 'string' ? q.sql : undefined;
    const bindings = Array.isArray(q?.bindings) ? q.bindings.slice(0, 50) : undefined;

    logger.warn(
      {
        type: 'slow_query',
        duration,
        slowQueryMs: threshold,
        sql,
        bindings,
      },
      'Slow DB query',
    );
  };

  knex.on('query-response', (_response, q) => onQueryDone(q));
  knex.on('query-error', (_err, q) => onQueryDone(q));

  return knex;
};

let knex;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryOptions = () => ({
  attempts: process.env.DB_RETRY_ATTEMPTS ? Number(process.env.DB_RETRY_ATTEMPTS) : 8,
  baseDelayMs: process.env.DB_RETRY_DELAY_MS ? Number(process.env.DB_RETRY_DELAY_MS) : 500,
  maxDelayMs: process.env.DB_RETRY_MAX_DELAY_MS ? Number(process.env.DB_RETRY_MAX_DELAY_MS) : 8000,
});

const initDb = async () => {
  if (knex) return knex;
  knex = makeKnex();

  const { attempts, baseDelayMs, maxDelayMs } = getRetryOptions();
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await knex.raw('SELECT 1');
      return knex;
    } catch (err) {
      lastError = err;
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** i));
      await sleep(delay);
    }
  }

  throw lastError;
};

const db = () => {
  if (!knex) knex = makeKnex();
  return knex;
};

const closeDb = async () => {
  if (!knex) return;
  const k = knex;
  knex = undefined;
  await k.destroy();
};

module.exports = { db, initDb, closeDb };
