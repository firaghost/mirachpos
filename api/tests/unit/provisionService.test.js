jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed_pw'),
}));

const mockMakeId = jest.fn();
jest.mock('../../src/utils/ids', () => ({
  makeId: (...args) => mockMakeId(...args),
}));

jest.unmock('../../src/services/provisionService');

describe('services/provisionService', () => {
  const RealDate = Date;

  beforeEach(() => {
    jest.clearAllMocks();

    const fixedNow = new RealDate('2026-02-11T00:00:00.000Z');
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length) return new RealDate(...args);
        return fixedNow;
      }

      static now() {
        return fixedNow.getTime();
      }
    };

    require('../../src/db');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenants = [];
    state.tables.tenant_profile = [];
    state.tables.tenant_subscription = [];
    state.tables.branches = [];
    state.tables.roles = [];
    state.tables.staff = [];
    state.tables.events = [];
    state.tables.plans = [];

    mockMakeId
      .mockReturnValueOnce('t_1')
      .mockReturnValueOnce('b_1')
      .mockReturnValueOnce('r_owner_1')
      .mockReturnValueOnce('r_manager_1')
      .mockReturnValueOnce('r_waiter_1')
      .mockReturnValueOnce('s_owner_1')
      .mockReturnValueOnce('evt_1');
  });

  afterEach(() => {
    global.Date = RealDate;
  });

  it('returns invalid_slug when slug fails validation', async () => {
    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: '!!',
      name: 'Cafe',
      ownerEmail: 'a@b.com',
      ownerPassword: 'secret1',
    });

    expect(res).toEqual({ ok: false, error: 'invalid_slug' });
  });

  it('returns name_required when name missing', async () => {
    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-1',
      name: '',
      ownerEmail: 'a@b.com',
      ownerPassword: 'secret1',
    });

    expect(res).toEqual({ ok: false, error: 'name_required' });
  });

  it('returns owner_email_required when email invalid', async () => {
    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-1',
      name: 'Cafe',
      ownerEmail: 'bad',
      ownerPassword: 'secret1',
    });

    expect(res).toEqual({ ok: false, error: 'owner_email_required' });
  });

  it('returns owner_password_too_short when password too short', async () => {
    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-1',
      name: 'Cafe',
      ownerEmail: 'a@b.com',
      ownerPassword: '123',
    });

    expect(res).toEqual({ ok: false, error: 'owner_password_too_short' });
  });

  it('returns slug_in_use when slug already exists', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenants = [{ id: 't_existing', slug: 'cafe-1' }];

    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-1',
      name: 'Cafe',
      ownerEmail: 'a@b.com',
      ownerPassword: 'secret1',
    });

    expect(res).toEqual({ ok: false, error: 'slug_in_use' });
  });

  it('provisions a tenant with default plan fallback and inserts expected records', async () => {
    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-1',
      name: 'My Cafe',
      trialDays: 4,
      ownerName: 'Owner',
      ownerEmail: 'Owner@Email.com',
      ownerPassword: 'secret1',
      branchName: 'Main',
      ownerPhone: '0912345678',
      city: 'Addis',
      address1: 'Bole',
    });

    expect(res.ok).toBe(true);
    expect(res.tenant).toEqual({
      id: 't_1',
      slug: 'cafe-1',
      name: 'My Cafe',
      status: 'trial',
      trialEndsAt: expect.any(String),
    });
    expect(res.owner).toEqual({ id: 's_owner_1', email: 'owner@email.com' });
    expect(res.defaultBranch).toEqual({ id: 'b_1', name: 'Main' });

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    expect(state.tables.tenants).toHaveLength(1);
    expect(state.tables.tenant_profile).toHaveLength(1);
    expect(state.tables.tenant_subscription).toHaveLength(1);
    expect(state.tables.branches).toHaveLength(1);
    expect(state.tables.roles).toHaveLength(3);
    expect(state.tables.staff).toHaveLength(1);
    expect(state.tables.events).toHaveLength(1);

    expect(state.tables.tenant_subscription[0].tier).toBe('Pro');
    expect(state.tables.tenant_subscription[0].cycle).toBe('Monthly');
    expect(state.tables.staff[0].password_hash).toBe('hashed_pw');
  });

  it('uses Pro plan config from DB when available', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.plans = [
      {
        tier: 'Pro',
        modules_json: JSON.stringify(['pos', 'orders']),
        price_monthly_etb: 999,
      },
    ];

    const { provisionTenant } = require('../../src/services/provisionService');

    const res = await provisionTenant({
      slug: 'cafe-2',
      name: 'My Cafe 2',
      trialDays: 4,
      ownerName: 'Owner',
      ownerEmail: 'a@b.com',
      ownerPassword: 'secret1',
    });

    expect(res.ok).toBe(true);

    const sub = state.tables.tenant_subscription[0];
    expect(sub.amount_etb).toBe(999);
    expect(sub.modules_json).toBe(JSON.stringify(['pos', 'orders']));
  });
});
