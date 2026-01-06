const express = require('express');
const crypto = require('crypto');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { enqueueJob } = require('../services/jobService');
const {
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
} = require('../services/telebirrStandingOrderService');

const makeTelebirrStandingOrderRouter = () => {
  const r = express.Router();

  // 3-click subscribe: Select plan -> Phone -> Confirm
  r.post('/telebirr/subscribe', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const phone = String(req.body?.phone || '').trim();
      const planAmount = Number(req.body?.plan_amount || req.body?.planAmount || 0);
      const cycle = String(req.body?.cycle || 'MONTHLY').trim();
      const executeDay = Number(req.body?.execute_day || req.body?.executeDay || 1);
      const validityMonths = Number(req.body?.validity_months || req.body?.validityMonths || 12);

      const baseUrl = req.protocol + '://' + req.get('host');
      const notifyUrl = `${baseUrl}/api/webhooks/telebirr/standing-order-notify`;

      const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || null;

      try {
        const result = await createSubscription({
          tenantId: req.tenant.id,
          userId: req.auth?.staffId ? String(req.auth.staffId) : null,
          phone,
          planAmount,
          cycle,
          executeDay,
          validityMonths,
          idempotencyKey,
          notifyUrl,
        });

        return res.json(result);
      } catch (e) {
        // enqueue a retry job if the setup failed due to upstream issues
        const retryKey = `telebirr_standing_retry_${req.tenant.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await enqueueJob({
          type: 'telebirr_standing_retry',
          payload: {
            tenantId: req.tenant.id,
            userId: req.auth?.staffId ? String(req.auth.staffId) : null,
            phone,
            planAmount,
            cycle,
            executeDay,
            validityMonths,
            notifyUrl,
            retryKey,
          },
          runAt: new Date(Date.now() + 60 * 1000),
        });

        return res.status(502).json({
          error: 'telebirr_unavailable',
          message: e.message || 'Telebirr unavailable. We will retry automatically.',
          retryScheduled: true,
        });
      }
    } catch (e) {
      return next(e);
    }
  });

  r.get('/telebirr/subscription/status', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });
      return res.json(await getSubscriptionStatus({ tenantId: req.tenant.id }));
    } catch (e) {
      return next(e);
    }
  });

  r.post('/telebirr/subscription/:id/cancel', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      return res.json(await cancelSubscription({ tenantId: req.tenant.id, subscriptionId: id }));
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeTelebirrStandingOrderRouter };
