jest.mock('bcryptjs', () => ({ compare: jest.fn(async () => true) }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(() => 'tok') }));
jest.mock('../../src/services/entitlements', () => ({
  computeTenantEntitlements: jest.fn(async () => ({
    subscription: { tier: 'Trial', modules: [] },
    billing: { cycle: 'Monthly', status: 'active', method: 'manual', nextBillAt: '', amountEtb: 0, graceEndsAt: '' },
    limits: { maxStaff: 1 },
  })),
  upsertTenantEntitlementsSnapshot: jest.fn(async () => undefined),
}));

const auth = require('../../src/services/authService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ent = require('../../src/services/entitlements');

describe('services/authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('tok');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenants = [
      { id: 't_ok', slug: 'ok', name: 'OK', status: 'active', trial_ends_at: null, plan: null, created_at: new Date().toISOString() },
      { id: 't_susp', slug: 'susp', name: 'S', status: 'suspended', trial_ends_at: null, plan: null, created_at: new Date().toISOString() },
    ];

    state.tables.branches = [{ tenant_id: 't_ok', id: 'br_1', name: 'Main' }];
    state.tables.staff = [];
    state.tables.roles = [];
    state.tables.tenant_subscription = [];
    state.tables.plans = [];
    state.tables.tenant_entitlements_snapshots = [];
  });

  it('loginWithEmailPassword returns tenant_not_found when tenant missing', async () => {
    const res = await auth.loginWithEmailPassword({
      tenantId: 't_missing',
      email: 'a@b.com',
      password: 'pw',
      jwtSecret: 'secret',
    });

    expect(res).toEqual({ ok: false, error: 'tenant_not_found' });
  });

  it('loginWithEmailPassword returns tenant_suspended for suspended tenant', async () => {
    const res = await auth.loginWithEmailPassword({
      tenantId: 't_susp',
      email: 'a@b.com',
      password: 'pw',
      jwtSecret: 'secret',
    });

    expect(res).toEqual({ ok: false, error: 'tenant_suspended' });
  });

  it('loginWithEmailPassword returns invalid_credentials when password does not match', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Cashier',
        name: 'N',
        email: 'a@b.com',
        password_hash: 'hash',
        code: 'C',
        pin_hash: '',
      },
    ];

    bcrypt.compare.mockResolvedValue(false);

    const res = await auth.loginWithEmailPassword({
      tenantId: 't_ok',
      email: 'a@b.com',
      password: 'wrong',
      jwtSecret: 'secret',
    });

    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('loginWithEmailPassword returns token + permissions + branch info', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Cashier',
        name: 'N',
        email: 'a@b.com',
        password_hash: 'hash',
        code: 'C',
        pin_hash: 'pinHash',
      },
    ];

    state.tables.roles = [
      {
        tenant_id: 't_ok',
        name: 'Cashier',
        permissions: '["orders.read","",2]',
      },
    ];

    const res = await auth.loginWithEmailPassword({
      tenantId: 't_ok',
      email: 'A@B.COM',
      password: 'pw',
      jwtSecret: 'secret',
    });

    expect(res.ok).toBe(true);
    expect(res.token).toBe('tok');
    expect(jwt.sign).toHaveBeenCalledTimes(1);

    expect(res.permissions).toEqual(['orders.read', '2']);
    expect(res.branchId).toBe('br_1');
    expect(res.branch).toEqual({ id: 'br_1', name: 'Main' });
    expect(res.staffCode).toBe('C');
    expect(res.hasPin).toBe(true);

    expect(ent.upsertTenantEntitlementsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('loginWithCodePin forbids non-waiter roles', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Cashier',
        name: 'N',
        email: 'a@b.com',
        pin_hash: 'hash',
        code: 'C',
      },
    ];

    const res = await auth.loginWithCodePin({ tenantId: 't_ok', code: 'C', pin: '1111', jwtSecret: 'secret' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('loginWithCodePin returns invalid_credentials for missing staff', async () => {
    const res = await auth.loginWithCodePin({ tenantId: 't_ok', code: 'X', pin: '1111', jwtSecret: 'secret' });
    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('loginWithCodePin returns invalid_credentials when pin_hash is missing', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Waiter',
        name: 'N',
        email: 'a@b.com',
        pin_hash: '',
        code: 'W',
      },
    ];

    const res = await auth.loginWithCodePin({ tenantId: 't_ok', code: 'W', pin: '1111', jwtSecret: 'secret' });
    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('loginWithCodePin returns invalid_credentials when pin does not match', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Waiter',
        name: 'N',
        email: 'a@b.com',
        pin_hash: 'hash',
        code: 'W',
      },
    ];

    bcrypt.compare.mockResolvedValue(false);

    const res = await auth.loginWithCodePin({ tenantId: 't_ok', code: 'W', pin: 'wrong', jwtSecret: 'secret' });
    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('loginWithCodePin returns token for valid waiter', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff = [
      {
        id: 's1',
        tenant_id: 't_ok',
        branch_id: 'br_1',
        role_name: 'Waiter',
        name: 'N',
        email: 'a@b.com',
        pin_hash: 'hash',
        code: 'W',
      },
    ];

    bcrypt.compare.mockResolvedValue(true);

    const res = await auth.loginWithCodePin({ tenantId: 't_ok', code: 'W', pin: '1111', jwtSecret: 'secret' });

    expect(res.ok).toBe(true);
    expect(res.token).toBe('tok');
    expect(res.role).toBe('Waiter');
    expect(jwt.sign).toHaveBeenCalledTimes(1);
  });

  it('loginWithEmailPassword returns invalid_credentials when staff not found', async () => {
    const res = await auth.loginWithEmailPassword({
      tenantId: 't_ok',
      email: 'nonexistent@b.com',
      password: 'pw',
      jwtSecret: 'secret',
    });

    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
  });
});
