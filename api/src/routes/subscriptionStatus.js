/**
 * Subscription API Routes
 * Endpoints for checking subscription status and limits
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { 
  getSubscriptionStatus, 
  checkPlanLimits,
  checkFeatureAccess,
  PLAN_LIMITS 
} = require('../services/subscriptionEnforcement');

function makeSubscriptionStatusRouter() {
  const router = express.Router();

  // Get current subscription status and limits
  router.get('/subscription/status', requireAuth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const status = await getSubscriptionStatus(tenantId);
      res.json(status);
    } catch (err) {
      console.error('Get subscription status error:', err);
      res.status(500).json({ error: 'Failed to get subscription status' });
    }
  });

  // Check specific resource limit
  router.get('/subscription/check/:resource', requireAuth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { resource } = req.params;
      const branchId = req.query.branchId || req.user.branch_id;
      
      const result = await checkPlanLimits(tenantId, resource, branchId);
      res.json(result);
    } catch (err) {
      console.error('Check limit error:', err);
      res.status(500).json({ error: 'Failed to check limit' });
    }
  });

  // Check feature availability
  router.get('/subscription/feature/:feature', requireAuth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const { feature } = req.params;
      
      const result = await checkFeatureAccess(tenantId, feature);
      res.json(result);
    } catch (err) {
      console.error('Check feature error:', err);
      res.status(500).json({ error: 'Failed to check feature' });
    }
  });

  // Get plan comparison (for upgrade page)
  router.get('/subscription/plans', async (req, res) => {
    res.json({
      plans: [
        {
          id: 'starter',
          name: 'Starter',
          price: 1500,
          billingPeriod: 'month',
          limits: PLAN_LIMITS.starter,
          description: 'For small cafés (≤5 tables)'
        },
        {
          id: 'growth',
          name: 'Growth',
          price: 3500,
          billingPeriod: 'month',
          limits: PLAN_LIMITS.growth,
          description: 'For mid-size restaurants (5-20 tables)',
          popular: true
        },
        {
          id: 'pro',
          name: 'Pro',
          price: 7000,
          billingPeriod: 'month',
          limits: PLAN_LIMITS.pro,
          description: 'For chains and high-volume venues'
        }
      ]
    });
  });

  return router;
}

module.exports = { makeSubscriptionStatusRouter };
