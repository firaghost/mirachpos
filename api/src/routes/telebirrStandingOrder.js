const express = require('express');
const crypto = require('crypto');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { enqueueJob } = require('../services/jobService');
const { requireRole, requirePermission } = require('../middleware/permissions');
const {
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
} = require('../services/telebirrStandingOrderService');
const { validateTelebirrSubscribe, validateTelebirrCancelParam } = require('../middleware/validators');

const makeTelebirrStandingOrderRouter = () => {
  const r = express.Router();

  // 3-click subscribe: Select plan -> Phone -> Confirm
  r.post('/telebirr/subscribe', tenantMiddleware, requireAuth, requireRole('Cafe Owner'), requirePermission('settings.manage'), validateTelebirrSubscribe, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const phone = String(body?.phone || '').trim();
      const planAmount = Number(body?.plan_amount || body?.planAmount || 0);
      const cycle = String(body?.cycle || 'MONTHLY').trim();
      const executeDay = Number(body?.execute_day || body?.executeDay || 1);
      const validityMonths = Number(body?.validity_months || body?.validityMonths || 12);

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

  r.get('/telebirr/subscription/status', tenantMiddleware, requireAuth, requireRole('Cafe Owner'), requirePermission('settings.manage'), async (req, res, next) => {
    try {
      return res.json(await getSubscriptionStatus({ tenantId: req.tenant.id }));
    } catch (e) {
      return next(e);
    }
  });

  r.post('/telebirr/subscription/:id/cancel', tenantMiddleware, requireAuth, requireRole('Cafe Owner'), requirePermission('settings.manage'), validateTelebirrCancelParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      if (!id) return res.status(400).json({ error: 'id_required' });

      return res.json(await cancelSubscription({ tenantId: req.tenant.id, subscriptionId: id }));
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeTelebirrStandingOrderRouter };
