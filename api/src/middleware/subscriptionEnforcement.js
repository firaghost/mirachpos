/**
 * Enforcement middleware for routes
 * Apply these to specific routes to enforce subscription limits
 */

const { 
  requireSubscription, 
  requireFeature,
  checkPlanLimits 
} = require('../services/subscriptionEnforcement');
const { trackDeviceSession } = require('./deviceTracking');

/**
 * Enforce device limit when adding new devices
 */
const enforceDeviceLimit = [
  trackDeviceSession,
  requireSubscription('devices')
];

/**
 * Enforce staff limit when adding new staff
 */
const enforceStaffLimit = [
  requireSubscription('staff')
];

/**
 * Enforce table limit when creating tables
 */
const enforceTableLimit = [
  requireSubscription('tables')
];

/**
 * Enforce branch limit when creating branches
 */
const enforceBranchLimit = [
  requireSubscription('branches')
];

/**
 * Enforce feature: Inventory
 */
const requireInventoryFeature = requireFeature('inventory');

/**
 * Enforce feature: KDS (Kitchen Display System)
 */
const requireKdsFeature = requireFeature('kds');

/**
 * Enforce feature: QR Ordering
 */
const requireQrOrderingFeature = requireFeature('qrOrdering');

/**
 * Enforce feature: Analytics/Reports
 */
const requireAnalyticsFeature = requireFeature('analytics');

/**
 * Enforce feature: API Access
 */
const requireApiAccessFeature = requireFeature('apiAccess');

/**
 * Enforce feature: Multi-location
 */
const requireMultiLocationFeature = requireFeature('multiLocation');

/**
 * Check subscription status (soft check - warns but doesn't block)
 */
async function checkSubscriptionMiddleware(req, res, next) {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) {
      return next();
    }

    const result = await checkPlanLimits(tenantId, null);
    
    // Add subscription info to response headers
    if (result.allowed) {
      res.set('X-Subscription-Plan', result.plan);
      res.set('X-Subscription-Trial', result.isTrial ? 'true' : 'false');
      
      // Add warnings if near limits
      if (result.checks) {
        const warnings = Object.entries(result.checks)
          .filter(([_, check]) => !check.allowed || (check.current / check.limit) > 0.8)
          .map(([resource, check]) => `${resource}:${check.current}/${check.limit}`);
        
        if (warnings.length > 0) {
          res.set('X-Subscription-Warnings', warnings.join(', '));
        }
      }
    }
    
    req.subscription = result;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  enforceDeviceLimit,
  enforceStaffLimit,
  enforceTableLimit,
  enforceBranchLimit,
  requireInventoryFeature,
  requireKdsFeature,
  requireQrOrderingFeature,
  requireAnalyticsFeature,
  requireApiAccessFeature,
  requireMultiLocationFeature,
  checkSubscriptionMiddleware,
  trackDeviceSession
};
