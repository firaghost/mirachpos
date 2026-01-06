
const { registerHandler } = require('../services/jobService');
const { checkDueInvoices } = require('../services/invoiceService');
const { logger } = require('../utils/logger');

const JOB_TYPE = 'check_due_invoices';

const initInvoiceJobs = () => {
    registerHandler(JOB_TYPE, async (payload, { jobId }) => {
        logger.info({ jobId }, 'Starting invoice due check job');
        const result = await checkDueInvoices();
        logger.info({
            jobId,
            overdueCount: result.overdue.length,
            dueTomorrowCount: result.dueTomorrow.length
        }, 'Invoice due check completed');
    });
};

module.exports = {
    initInvoiceJobs
};
