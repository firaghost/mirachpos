const {
  checkPlanLimits,
  checkFeatureAccess,
  requireSubscription,
  requireFeature,
  __resetForTest,
} = require('../../src/services/subscriptionEnforcement');

describe('services/subscriptionEnforcement', () => {
  beforeEach(() => {
    __resetForTest();
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (state?.tables) {
      state.tables.subscriptions = [];
      state.tables.device_sessions = [];
      state.tables.staff = [];
      state.tables.tables = [];
      state.tables.branches = [{ tenant_id: 't_test', status: 'active' }];
    }
  });

  it('returns NO_SUBSCRIPTION when tenant has no active or trial subscription', async () => {
    const res = await checkPlanLimits('t_test', 'devices');

    expect(res.allowed).toBe(false);
    expect(res.error).toBe('NO_SUBSCRIPTION');
  });

  it('uses active subscription when within period and returns allowed=true', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'pro',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    const res = await checkPlanLimits('t_test', null);

    expect(res.allowed).toBe(true);
    expect(res.plan).toBe('pro');
    expect(res.usage).toEqual({ devices: 0, staff: 0, tables: 0, branches: 1 });
    expect(res.checks.devices.allowed).toBe(true);
  });

  it('returns PLAN_LIMIT_EXCEEDED when usage hits resource limit', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'starter',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    state.tables.staff = [
      { tenant_id: 't_test', id: 's1', status: 'active' },
      { tenant_id: 't_test', id: 's2', status: 'active' },
    ];

    const res = await checkPlanLimits('t_test', 'staff');

    expect(res.allowed).toBe(false);
    expect(res.error).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.resource).toBe('staff');
    expect(res.limit).toBe(2);
    expect(res.current).toBe(2);
  });

  it('checkFeatureAccess returns FEATURE_NOT_AVAILABLE when plan lacks feature', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'starter',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    const res = await checkFeatureAccess('t_test', 'inventory');

    expect(res.allowed).toBe(false);
    expect(res.error).toBe('FEATURE_NOT_AVAILABLE');
    expect(res.feature).toBe('inventory');
  });

  it('requireSubscription middleware 400s when tenant cannot be identified', async () => {
    const mw = requireSubscription('devices');
    const req = { tenant: null, user: null, branch: null };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Tenant not identified' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireFeature middleware passes when feature is available', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'pro',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    const mw = requireFeature('inventory');
    const req = { tenant: { id: 't_test' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses trial subscription when no active subscription exists', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'trialing',
        plan_id: 'growth',
        trial_end: future,
        current_period_end: null,
        created_at: new Date().toISOString(),
      },
    ];

    const res = await checkPlanLimits('t_test', null);

    expect(res.allowed).toBe(true);
    expect(res.plan).toBe('growth');
    expect(res.isTrial).toBe(true);
  });

  it('checkFeatureAccess returns allowed for pro plan features', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'pro',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    const res = await checkFeatureAccess('t_test', 'apiAccess');

    expect(res.allowed).toBe(true);
    expect(res.feature).toBe('apiAccess');
    expect(res.plan).toBe('pro');
  });

  it('requireSubscription middleware 403s when plan limit exceeded', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'starter',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    state.tables.staff = [
      { tenant_id: 't_test', id: 's1', status: 'active' },
      { tenant_id: 't_test', id: 's2', status: 'active' },
    ];

    const mw = requireSubscription('staff');
    const req = { tenant: { id: 't_test' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'PLAN_LIMIT_EXCEEDED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('requireFeature middleware 403s when feature not available', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'starter',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    const mw = requireFeature('inventory');
    const req = { tenant: { id: 't_test' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FEATURE_NOT_AVAILABLE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('checkPlanLimits counts devices correctly', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'starter',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    state.tables.device_sessions = [
      { tenant_id: 't_test', id: 'd1', last_seen: new Date().toISOString() },
      { tenant_id: 't_test', id: 'd2', last_seen: new Date().toISOString() },
      { tenant_id: 't_test', id: 'd3', last_seen: new Date().toISOString() },
    ];

    const res = await checkPlanLimits('t_test', 'devices');

    expect(res.allowed).toBe(false);
    expect(res.error).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.resource).toBe('devices');
    expect(res.current).toBe(3);
    expect(res.limit).toBe(3);
  });

  it('checkPlanLimits counts tables with branch filter', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    state.tables.subscriptions = [
      {
        tenant_id: 't_test',
        status: 'active',
        plan_id: 'growth',
        current_period_end: future,
        created_at: new Date().toISOString(),
      },
    ];

    state.tables.tables = [
      { tenant_id: 't_test', branch_id: 'b1', id: 't1' },
      { tenant_id: 't_test', branch_id: 'b1', id: 't2' },
      { tenant_id: 't_test', branch_id: 'b2', id: 't3' },
    ];

    const res = await checkPlanLimits('t_test', 'tables', 'b1');

    expect(res.allowed).toBe(true);
    expect(res.usage.tables).toBe(2);
  });
});
