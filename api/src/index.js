const { config } = require('./config');
const { validateEnv } = require('./validateEnv');
const { createApp } = require('./app');
const { logger } = require('./utils/logger');
const { sendCriticalAlert } = require('./utils/alerting');
const { startScheduler } = require('./services/schedulerService');
const { startJobWorker } = require('./services/jobService');
const { initInvoiceJobs } = require('./jobs/invoiceJobs');
const { initTelebirrStandingOrderJobs } = require('./jobs/telebirrStandingOrderJobs');
const { db, initDb } = require('./db');
const cluster = require('cluster');
const os = require('os');

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  void sendCriticalAlert({
    key: 'unhandled_rejection',
    subject: 'MirachPOS API: Unhandled Rejection',
    message: String(reason || 'Unhandled promise rejection'),
  });
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  void sendCriticalAlert({
    key: 'uncaught_exception',
    subject: 'MirachPOS API: Uncaught Exception',
    message: err?.message || 'Uncaught exception',
  });
});

validateEnv();

const app = createApp();

const cleanupTestJobs = async () => {
  try {
    const hasJobs = await db().schema.hasTable('jobs');
    if (!hasJobs) return;
    const nowIso = new Date().toISOString();
    const updated = await db()
      .from('jobs')
      .where({ type: 'test_job', status: 'failed' })
      .update({ status: 'completed', last_error: null, completed_at: nowIso, updated_at: nowIso });
    if (updated) {
      // eslint-disable-next-line no-console
      console.log(`[Scheduler] Cleaned ${updated} test_job rows`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Scheduler] Failed to clean test_job rows', e);
  }
};

const isBackgroundDisabled = () => {
  const raw = String(process.env.BACKGROUND_DISABLED || process.env.DISABLE_BACKGROUND || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const isClusterEnabled = () => {
  const raw = String(process.env.CLUSTER_MODE || process.env.USE_CLUSTER || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const resolveWorkerCount = () => {
  const raw = process.env.CLUSTER_WORKERS || process.env.WEB_CONCURRENCY || '';
  const parsed = raw ? Number(raw) : 0;
  const n = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
  if (n > 0) return n;
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  return Math.max(1, cpuCount);
};

const startBackgroundServices = () => {
  if (isBackgroundDisabled()) {
    logger.info({ type: 'background_disabled' }, 'Background services disabled');
    return;
  }
  startScheduler();
  cleanupTestJobs();
  initInvoiceJobs();
  initTelebirrStandingOrderJobs();
  startJobWorker();
};

const startHttpServer = async () => {
  const skipDbInitOnBoot = String(process.env.SKIP_DB_INIT_ON_BOOT || '').trim() === '1';

  if (!skipDbInitOnBoot) {
    await initDb();
  }
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`mirachpos-api listening on ${config.port}`);
  });

  const shutdown = async (signal) => {
    try {
      logger.warn({ signal }, 'Shutting down');
    } catch {
      // ignore
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

const boot = async () => {
  if (!isClusterEnabled() || !cluster.isPrimary) {
    if (!isClusterEnabled()) startBackgroundServices();
    return startHttpServer();
  }

  await initDb();
  startBackgroundServices();

  const workers = resolveWorkerCount();
  for (let i = 0; i < workers; i += 1) {
    cluster.fork();
  }

  const shutdownPrimary = async (signal) => {
    try {
      logger.warn({ signal }, 'Shutting down (primary)');
    } catch {
      // ignore
    }

    const ids = Object.keys(cluster.workers || {});
    for (const id of ids) {
      try {
        cluster.workers[id]?.process?.kill('SIGTERM');
      } catch {
        // ignore
      }
    }

    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on('SIGTERM', () => shutdownPrimary('SIGTERM'));
  process.on('SIGINT', () => shutdownPrimary('SIGINT'));

  cluster.on('exit', (worker) => {
    try {
      logger.warn({ pid: worker?.process?.pid }, 'Worker exited');
    } catch {
      // ignore
    }
    cluster.fork();
  });
};

boot().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  void sendCriticalAlert({
    key: 'boot_failure',
    subject: 'MirachPOS API: Boot Failure',
    message: err?.message || 'Failed to start server',
  });
  process.exit(1);
});
