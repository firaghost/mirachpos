/**
 * Subscription Plan Enforcement Module
 * Enforces limits based on customer's subscription tier
 */

const { db } = require('../db');

const isMissingTableError = (e) => {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'ER_NO_SUCH_TABLE') return true;
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes("doesn't exist") || msg.includes('no such table');
};

let hasSubscriptionsTablePromise = null;

const hasSubscriptionsTable = async () => {
  try {
    if (!hasSubscriptionsTablePromise) {
      hasSubscriptionsTablePromise = (async () => {
        const has = await db().schema.hasTable('subscriptions');
        return !!has;
      })();
    }
    return await hasSubscriptionsTablePromise;
  } catch {
    return false;
  }
};

// Plan configuration with limits
const PLAN_LIMITS = {
  starter: {
    maxCashierStations: 1,
    maxDevices: 3,
    maxTables: 5,
    maxBranches: 1,
    maxStaff: 2,
    features: {
      inventory: false,
      kds: false,
      qrOrdering: false,
      analytics: false,
      apiAccess: false,
      multiLocation: false,
      whiteLabel: false
    }
  },
  growth: {
    maxCashierStations: 3,
    maxDevices: 10,
    maxTables: 20,
    maxBranches: 1,
    maxStaff: 15,
    features: {
      inventory: true,
      kds: true,
      qrOrdering: true,
      analytics: true,
      apiAccess: false,
      multiLocation: false,
      whiteLabel: false
    }
  },
  pro: {
    maxCashierStations: 10,
    maxDevices: 50,
    maxTables: 100,
    maxBranches: 10,
    maxStaff: 100,
    features: {
      inventory: true,
      kds: true,
      qrOrdering: true,
      analytics: true,
      apiAccess: true,
      multiLocation: true,
      whiteLabel: true
    }
  }
};

/**
 * Get current subscription for a tenant
 */
async function getTenantSubscription(tenantId) {
  if (!(await hasSubscriptionsTable())) return null;
  try {
    const subscription = await db()
      .from('subscriptions')
      .where({ tenant_id: tenantId, status: 'active' })
      .where('current_period_end', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!subscription) {
      const trial = await db()
        .from('subscriptions')
        .where({ tenant_id: tenantId, status: 'trialing' })
        .where('trial_end', '>', new Date())
        .first();

      if (trial) return { ...trial, isTrial: true };
      return null;
    }

    return subscription;
  } catch (e) {
    if (isMissingTableError(e)) return null;
    throw e;
  }
}

/**
 * Get current usage for a tenant
 */
async function getTenantUsage(tenantId, branchId = null) {
  const [devices, staff, tables, branches] = await Promise.all([
    // Count active devices/sessions
    db()
      .from('device_sessions')
      .where({ tenant_id: tenantId })
      .where('last_seen', '>', db().raw('datetime("now", "-1 hour")'))
      .count('id as count')
      .first(),
    
    // Count staff members
    db()
      .from('staff')
      .where({ tenant_id: tenantId, status: 'active' })
      .count('id as count')
      .first(),
    
    // Count tables
    db()
      .from('tables')
      .where({ tenant_id: tenantId, ...(branchId && { branch_id: branchId }) })
      .count('id as count')
      .first(),
    
    // Count branches
    db()
      .from('branches')
      .where({ tenant_id: tenantId, status: 'active' })
      .count('id as count')
      .first()
  ]);
  
  return {
    devices: parseInt(devices.count) || 0,
    staff: parseInt(staff.count) || 0,
    tables: parseInt(tables.count) || 0,
    branches: parseInt(branches.count) || 0
  };
}

/**
 * Check if tenant is within plan limits
 */
async function checkPlanLimits(tenantId, resourceType, branchId = null) {
  if (!(await hasSubscriptionsTable())) {
    return {
      allowed: true,
      plan: 'pro',
      isTrial: false,
      limits: PLAN_LIMITS.pro,
      usage: await getTenantUsage(tenantId, branchId),
      checks: null,
      bypassed: true,
    };
  }

  let subscription;
  try {
    subscription = await getTenantSubscription(tenantId);
  } catch (e) {
    if (isMissingTableError(e)) {
      return { allowed: true, plan: 'pro', isTrial: false, limits: PLAN_LIMITS.pro, usage: await getTenantUsage(tenantId, branchId), checks: null, bypassed: true };
    }
    throw e;
  }
  
  if (!subscription) {
    // Local/dev safety: if subscriptions table is missing we already bypassed above.
    // If table exists but tenant has no subscription, block as before.
    return {
      allowed: false,
      error: 'NO_SUBSCRIPTION',
      message: 'No active subscription. Please subscribe to continue.',
      upgradeUrl: '/billing',
    };
  }
  
  const plan = subscription.plan_id || 'starter';
  const limits = PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.starter;
  const usage = await getTenantUsage(tenantId, branchId);
  
  const checks = {
    devices: {
      current: usage.devices,
      limit: limits.maxDevices,
      allowed: usage.devices < limits.maxDevices
    },
    staff: {
      current: usage.staff,
      limit: limits.maxStaff,
      allowed: usage.staff < limits.maxStaff
    },
    tables: {
      current: usage.tables,
      limit: limits.maxTables,
      allowed: usage.tables < limits.maxTables
    },
    branches: {
      current: usage.branches,
      limit: limits.maxBranches,
      allowed: usage.branches < limits.maxBranches
    }
  };
  
  if (resourceType && checks[resourceType]) {
    const check = checks[resourceType];
    if (!check.allowed) {
      return {
        allowed: false,
        error: 'PLAN_LIMIT_EXCEEDED',
        resource: resourceType,
        current: check.current,
        limit: check.limit,
        message: `You've reached the ${plan} plan limit of ${check.limit} ${resourceType}. Upgrade to add more.`,
        upgradeUrl: '/billing',
        plan,
        isTrial: subscription.isTrial
      };
    }
  }
  
  return {
    allowed: true,
    plan,
    isTrial: subscription.isTrial,
    limits,
    usage,
    checks
  };
}

/**
 * Check if feature is available in current plan
 */
async function checkFeatureAccess(tenantId, featureName) {
  if (!(await hasSubscriptionsTable())) {
    return { allowed: true, plan: 'pro', feature: featureName, bypassed: true };
  }

  let subscription;
  try {
    subscription = await getTenantSubscription(tenantId);
  } catch (e) {
    if (isMissingTableError(e)) {
      return { allowed: true, plan: 'pro', feature: featureName, bypassed: true };
    }
    throw e;
  }

  if (!subscription) {
    return {
      allowed: false,
      error: 'NO_SUBSCRIPTION',
      message: 'Subscribe to access this feature.',
      upgradeUrl: '/billing',
    };
  }
  
  const plan = subscription.plan_id || 'starter';
  const limits = PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.starter;
  
  if (!limits.features[featureName]) {
    const requiredPlan = featureName === 'inventory' || featureName === 'kds' ? 'Growth' : 'Pro';
    return {
      allowed: false,
      error: 'FEATURE_NOT_AVAILABLE',
      feature: featureName,
      message: `${featureName} is not available on your ${plan} plan. Upgrade to ${requiredPlan} to unlock.`,
      upgradeUrl: '/billing',
      currentPlan: plan,
      requiredPlan
    };
  }
  
  return {
    allowed: true,
    plan,
    feature: featureName
  };
}

/**
 * Middleware to enforce subscription
 */
function requireSubscription(resourceType = null) {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenant?.id || req.user?.tenant_id;
      
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant not identified' });
      }
      
      const result = await checkPlanLimits(tenantId, resourceType, req.branch?.id);
      
      if (!result.allowed) {
        return res.status(403).json({
          error: result.error,
          message: result.message,
          upgradeUrl: result.upgradeUrl,
          current: result.current,
          limit: result.limit,
          plan: result.plan,
          isTrial: result.isTrial
        });
      }
      
      // Attach subscription info to request
      req.subscription = result;
      next();
    } catch (err) {
      console.error('Subscription check error:', err);
      next(err);
    }
  };
}

/**
 * Middleware to check feature access
 */
function requireFeature(featureName) {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenant?.id || req.user?.tenant_id;
      
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant not identified' });
      }
      
      const result = await checkFeatureAccess(tenantId, featureName);
      
      if (!result.allowed) {
        return res.status(403).json({
          error: result.error,
          message: result.message,
          upgradeUrl: result.upgradeUrl,
          currentPlan: result.currentPlan,
          requiredPlan: result.requiredPlan
        });
      }
      
      next();
    } catch (err) {
      console.error('Feature check error:', err);
      next(err);
    }
  };
}

/**
 * Get subscription status for frontend
 */
async function getSubscriptionStatus(tenantId) {
  const subscription = await getTenantSubscription(tenantId);
  const usage = await getTenantUsage(tenantId);
  
  if (!subscription) {
    return {
      active: false,
      status: 'inactive',
      message: 'No active subscription',
      upgradeRequired: true
    };
  }
  
  const plan = subscription.plan_id || 'starter';
  const limits = PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.starter;
  
  // Calculate usage percentages
  const usagePercentages = {
    devices: Math.round((usage.devices / limits.maxDevices) * 100),
    staff: Math.round((usage.staff / limits.maxStaff) * 100),
    tables: Math.round((usage.tables / limits.maxTables) * 100),
    branches: Math.round((usage.branches / limits.maxBranches) * 100)
  };
  
  return {
    active: true,
    status: subscription.status,
    plan,
    isTrial: subscription.isTrial || false,
    trialEndsAt: subscription.trial_end,
    currentPeriodEndsAt: subscription.current_period_end,
    limits,
    usage,
    usagePercentages,
    features: limits.features,
    warnings: Object.entries(usagePercentages)
      .filter(([_, pct]) => pct >= 80)
      .map(([resource, pct]) => ({
        resource,
        percentage: pct,
        message: `You're using ${pct}% of your ${resource} limit`
      }))
  };
}

module.exports = {
  PLAN_LIMITS,
  getTenantSubscription,
  getTenantUsage,
  checkPlanLimits,
  checkFeatureAccess,
  requireSubscription,
  requireFeature,
  getSubscriptionStatus
};
