const { validateEnv } = require('./validateEnv');
const { initDb } = require('./db');
const { logger } = require('./utils/logger');
const { sendCriticalAlert } = require('./utils/alerting');
const { runDailyCron } = require('./services/cronService');

process.on('unhandledRejection', (reason) => {
  try {
    logger.error({ reason }, 'Cron: unhandled promise rejection');
  } catch {
    // ignore
  }
  void sendCriticalAlert({
    key: 'cron_unhandled_rejection',
    subject: 'MirachPOS Cron: Unhandled Rejection',
    message: String(reason || 'Unhandled promise rejection'),
  });
});

process.on('uncaughtException', (err) => {
  try {
    logger.error({ err }, 'Cron: uncaught exception');
  } catch {
    // ignore
  }
  void sendCriticalAlert({
    key: 'cron_uncaught_exception',
    subject: 'MirachPOS Cron: Uncaught Exception',
    message: err?.message || 'Uncaught exception',
  });
});

const boot = async () => {
  validateEnv();
  await initDb();

  const startedAt = Date.now();
  const res = await runDailyCron();
  const durationMs = Date.now() - startedAt;

  try {
    logger.info({ type: 'cron_daily_done', durationMs, result: res }, 'Cron: daily job completed');
  } catch {
    // ignore
  }

  return { ...res, durationMs };
};

boot()
  .then(() => process.exit(0))
  .catch((err) => {
    try {
      logger.error({ err }, 'Cron: daily job failed');
    } catch {
      // ignore
    }
    void sendCriticalAlert({
      key: 'cron_daily_failure',
      subject: 'MirachPOS Cron: Daily job failure',
      message: err?.message || 'Daily cron job failed',
    });
    process.exit(1);
  });
