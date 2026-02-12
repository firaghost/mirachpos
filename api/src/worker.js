const { validateEnv } = require('./validateEnv');
const { logger } = require('./utils/logger');
const { sendCriticalAlert } = require('./utils/alerting');
const { startScheduler, stopScheduler } = require('./services/schedulerService');
const { startJobWorker, stopJobWorker } = require('./services/jobService');
const { initInvoiceJobs } = require('./jobs/invoiceJobs');
const { initTelebirrStandingOrderJobs } = require('./jobs/telebirrStandingOrderJobs');
const { db, initDb, closeDb } = require('./db');
const { closeRedisClient } = require('./utils/redisClient');

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  void sendCriticalAlert({
    key: 'unhandled_rejection',
    subject: 'MirachPOS Worker: Unhandled Rejection',
    message: String(reason || 'Unhandled promise rejection'),
  });
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  void sendCriticalAlert({
    key: 'uncaught_exception',
    subject: 'MirachPOS Worker: Uncaught Exception',
    message: err?.message || 'Uncaught exception',
  });
});

validateEnv();

const cleanupTestJobs = async () => {
  try {
    const hasJobs = await db().schema.hasTable('jobs');
    if (!hasJobs) return;
    const nowIso = new Date().toISOString();
    await db()
      .from('jobs')
      .where({ type: 'test_job', status: 'failed' })
      .update({ status: 'completed', last_error: null, completed_at: nowIso, updated_at: nowIso });
  } catch {
    // ignore
  }
};

const boot = async () => {
  await initDb();

  startScheduler();
  void cleanupTestJobs();

  initInvoiceJobs();
  initTelebirrStandingOrderJobs();
  startJobWorker();

  logger.info({ type: 'worker_start' }, 'mirachpos-worker started');

  const shutdown = async (signal) => {
    try {
      logger.warn({ signal }, 'Shutting down worker');
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(1), 10000).unref();

    try {
      stopScheduler();
    } catch {
      // ignore
    }

    try {
      stopJobWorker();
    } catch {
      // ignore
    }

    await closeRedisClient();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

boot().catch((err) => {
  logger.error({ err }, 'Failed to start worker');
  void sendCriticalAlert({
    key: 'worker_boot_failure',
    subject: 'MirachPOS Worker: Boot Failure',
    message: err?.message || 'Failed to start worker',
  });
  process.exit(1);
});
