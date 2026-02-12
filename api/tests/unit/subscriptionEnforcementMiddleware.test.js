jest.mock('../../src/services/subscriptionEnforcement', () => ({
  requireSubscription: (m) => (req, res, next) => {
    req.__requiredModule = m;
    next();
  },
  requireFeature: (f) => (req, res, next) => {
    req.__requiredFeature = f;
    next();
  },
  checkPlanLimits: jest.fn(async () => ({
    allowed: true,
    plan: 'pro',
    isTrial: false,
    checks: { staff: { allowed: true, current: 1, limit: 10 } },
  })),
}));

const {
  enforceDeviceLimit,
  requireInventoryFeature,
  checkSubscriptionMiddleware,
} = require('../../src/middleware/subscriptionEnforcement');

describe('subscriptionEnforcement middleware exports', () => {
  it('enforceDeviceLimit is an array of middleware', () => {
    expect(Array.isArray(enforceDeviceLimit)).toBe(true);
    expect(enforceDeviceLimit.length).toBe(2);
  });

  it('requireInventoryFeature runs requireFeature wrapper', () => {
    const req = {};
    const next = jest.fn();

    requireInventoryFeature(req, {}, next);

    expect(req.__requiredFeature).toBe('inventory');
    expect(next).toHaveBeenCalled();
  });

  it('checkSubscriptionMiddleware sets subscription headers when allowed', async () => {
    const req = { tenant: { id: 't_test' } };
    const res = { set: jest.fn() };
    const next = jest.fn();

    await checkSubscriptionMiddleware(req, res, next);

    expect(res.set).toHaveBeenCalledWith('X-Subscription-Plan', 'pro');
    expect(res.set).toHaveBeenCalledWith('X-Subscription-Trial', 'false');
    expect(req.subscription).toBeTruthy();
    expect(next).toHaveBeenCalled();
  });
});
