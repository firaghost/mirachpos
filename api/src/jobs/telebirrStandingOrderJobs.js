const { registerHandler } = require('../services/jobService');
const { logger } = require('../utils/logger');
const { createSubscription } = require('../services/telebirrStandingOrderService');

const JOB_TYPE = 'telebirr_standing_retry';

const initTelebirrStandingOrderJobs = () => {
  registerHandler(JOB_TYPE, async (payload, { jobId }) => {
    logger.info({ jobId, payload: { tenantId: payload?.tenantId } }, 'Telebirr standing-order retry job started');

    // Idempotency: caller should supply idempotency-key at first attempt.
    // Here we use retryKey as a best-effort dedupe.
    await createSubscription({
      tenantId: payload.tenantId,
      userId: payload.userId || null,
      phone: payload.phone,
      planAmount: payload.planAmount,
      cycle: payload.cycle,
      executeDay: payload.executeDay,
      validityMonths: payload.validityMonths,
      idempotencyKey: payload.retryKey || null,
      notifyUrl: payload.notifyUrl,
    });

    logger.info({ jobId }, 'Telebirr standing-order retry job completed');
  });
};

module.exports = { initTelebirrStandingOrderJobs };
