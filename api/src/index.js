const { config } = require('./config');
const { createApp } = require('./app');
const { startScheduler } = require('./services/schedulerService');
const { startJobWorker } = require('./services/jobService');
const { initInvoiceJobs } = require('./jobs/invoiceJobs');
const { initTelebirrStandingOrderJobs } = require('./jobs/telebirrStandingOrderJobs');

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error(reason);
});

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
});

const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`mirachpos-api listening on ${config.port}`);
  startScheduler();

  // Job System
  initInvoiceJobs();
  initTelebirrStandingOrderJobs();
  startJobWorker();
});
