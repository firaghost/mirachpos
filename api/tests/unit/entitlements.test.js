jest.unmock('../../src/services/entitlements');

describe('services/entitlements', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    require('../../src/db');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.plans = [];
    state.tables.tenant_subscription = [];
    state.tables.tenant_addon_subscriptions = [];
    state.tables.addon_packages = [];
    state.tables.feature_flags = [];
    state.tables.tenant_entitlements = [];
  });

  describe('normalizeTier', () => {
    it('normalizes trial tier', () => {
      const { normalizeTier } = require('../../src/services/entitlements');
      expect(normalizeTier('trial')).toBe('Trial');
      expect(normalizeTier('TRIAL')).toBe('Trial');
      expect(normalizeTier('')).toBe('Trial');
    });

    it('normalizes starter tier', () => {
      const { normalizeTier } = require('../../src/services/entitlements');
      expect(normalizeTier('starter')).toBe('Starter');
      expect(normalizeTier('basic')).toBe('Starter');
      expect(normalizeTier('STARTER')).toBe('Starter');
    });

    it('normalizes growth tier', () => {
      const { normalizeTier } = require('../../src/services/entitlements');
      expect(normalizeTier('growth')).toBe('Growth');
      expect(normalizeTier('GROWTH')).toBe('Growth');
    });

    it('normalizes pro tier', () => {
      const { normalizeTier } = require('../../src/services/entitlements');
      expect(normalizeTier('pro')).toBe('Pro');
      expect(normalizeTier('enterprise')).toBe('Pro');
      expect(normalizeTier('PRO')).toBe('Pro');
    });

    it('returns original for unknown tier', () => {
      const { normalizeTier } = require('../../src/services/entitlements');
      expect(normalizeTier('custom')).toBe('custom');
    });
  });

  describe('normalizeModules', () => {
    it('normalizes owner dashboard variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['owner-dashboard'])).toEqual(['owner_dashboard']);
      expect(normalizeModules(['ownerdashboard'])).toEqual(['owner_dashboard']);
      expect(normalizeModules(['owner_dash'])).toEqual(['owner_dashboard']);
    });

    it('normalizes branch variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['branch'])).toEqual(['branches']);
      expect(normalizeModules(['branch_management'])).toEqual(['branches']);
    });

    it('normalizes report variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['report'])).toEqual(['reports']);
      expect(normalizeModules(['reporting'])).toEqual(['reports']);
    });

    it('normalizes inventory variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['inventory_management'])).toEqual(['inventory']);
    });

    it('normalizes menu variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['menu_management'])).toEqual(['menu']);
    });

    it('normalizes guest variants', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['guest'])).toEqual(['guests']);
      expect(normalizeModules(['customer'])).toEqual(['guests']);
      expect(normalizeModules(['customers'])).toEqual(['guests']);
    });

    it('deduplicates modules', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['pos', 'pos', 'orders'])).toEqual(['pos', 'orders']);
    });

    it('filters out empty strings', () => {
      const { normalizeModules } = require('../../src/services/entitlements');
      expect(normalizeModules(['pos', '', 'orders'])).toEqual(['pos', 'orders']);
    });
  });

  describe('normalizeFeatures', () => {
    it('normalizes feature keys', () => {
      const { normalizeFeatures } = require('../../src/services/entitlements');
      expect(normalizeFeatures(['Feature One', 'feature_two'])).toEqual(['feature_one', 'feature_two']);
    });

    it('deduplicates features', () => {
      const { normalizeFeatures } = require('../../src/services/entitlements');
      expect(normalizeFeatures(['feature', 'feature'])).toEqual(['feature']);
    });

    it('filters out empty strings', () => {
      const { normalizeFeatures } = require('../../src/services/entitlements');
      expect(normalizeFeatures(['feature', ''])).toEqual(['feature']);
    });
  });

  describe('readGlobalFeatureFlags', () => {
    it('returns enabled feature flags from DB', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.feature_flags = [
        { id: 'feature_a', enabled: 1 },
        { id: 'feature_b', enabled: 1 },
        { id: 'feature_c', enabled: 0 },
      ];

      const { readGlobalFeatureFlags } = require('../../src/services/entitlements');
      const features = await readGlobalFeatureFlags();

      expect(features).toContain('feature_a');
      expect(features).toContain('feature_b');
    });

    it('returns empty array when no enabled flags', async () => {
      const { readGlobalFeatureFlags } = require('../../src/services/entitlements');
      const features = await readGlobalFeatureFlags();

      expect(features).toEqual([]);
    });
  });

  describe('getOrCreateTenantSubscription', () => {
    it('returns existing subscription', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.tenant_subscription = [
        {
          tenant_id: 't1',
          tier: 'Growth',
          modules_json: JSON.stringify(['pos', 'orders']),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: '2026-12-01',
          amount_etb: 100,
          grace_ends_at: '2026-12-01',
          updated_at: new Date().toISOString(),
        },
      ];

      const { getOrCreateTenantSubscription } = require('../../src/services/entitlements');
      const sub = await getOrCreateTenantSubscription({ id: 't1' });

      expect(sub.tier).toBe('Growth');
      expect(sub.tenant_id).toBe('t1');
    });

    it('auto-corrects tier to Trial during active trial period', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.tenant_subscription = [
        {
          tenant_id: 't1',
          tier: 'Starter',
          modules_json: JSON.stringify(['pos']),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: new Date().toISOString(),
          amount_etb: 0,
          grace_ends_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      state.tables.plans = [
        { tier: 'Trial', modules_json: JSON.stringify(['pos', 'orders']), limits_json: JSON.stringify({ branchLimit: 1 }), price_monthly_etb: 0, price_yearly_etb: 0 },
      ];

      const { getOrCreateTenantSubscription } = require('../../src/services/entitlements');
      const sub = await getOrCreateTenantSubscription({
        id: 't1',
        trial_ends_at: futureDate.toISOString(),
      });

      expect(sub.tier).toBe('Trial');
    });

    it('creates new subscription for tenant without one', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Trial', modules_json: JSON.stringify(['pos', 'orders']), limits_json: JSON.stringify({ branchLimit: 1 }), price_monthly_etb: 0, price_yearly_etb: 0 },
      ];

      const { getOrCreateTenantSubscription } = require('../../src/services/entitlements');
      const sub = await getOrCreateTenantSubscription({
        id: 't2',
        trial_ends_at: futureDate.toISOString(),
      });

      expect(sub.tenant_id).toBe('t2');
      expect(sub.tier).toBe('Trial');
    });

    it('returns null for empty tenant id', async () => {
      const { getOrCreateTenantSubscription } = require('../../src/services/entitlements');
      const sub = await getOrCreateTenantSubscription({ id: '' });

      expect(sub).toBeNull();
    });

    it('infers Starter tier when trial expired and no plan set', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Starter', modules_json: JSON.stringify(['pos', 'orders']), limits_json: JSON.stringify({ branchLimit: 1 }), price_monthly_etb: 100, price_yearly_etb: 1000 },
      ];

      const { getOrCreateTenantSubscription } = require('../../src/services/entitlements');
      const sub = await getOrCreateTenantSubscription({
        id: 't3',
        trial_ends_at: pastDate.toISOString(),
      });

      expect(sub.tier).toBe('Starter');
    });
  });

  describe('computeTenantEntitlements', () => {
    it('returns null for empty tenant id', async () => {
      const { computeTenantEntitlements } = require('../../src/services/entitlements');
      const result = await computeTenantEntitlements({ tenant: { id: '' } });

      expect(result).toBeNull();
    });

    it('computes entitlements with subscription row provided', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Growth', modules_json: JSON.stringify(['pos', 'orders']), limits_json: JSON.stringify({ branchLimit: 3, staffLimit: 100 }), price_monthly_etb: 200, price_yearly_etb: 2000 },
      ];
      state.tables.feature_flags = [{ id: 'new_feature', enabled: 1 }];

      const { computeTenantEntitlements } = require('../../src/services/entitlements');
      const result = await computeTenantEntitlements({
        tenant: { id: 't1', features_json: JSON.stringify(['custom_feature']) },
        subscriptionRow: {
          tenant_id: 't1',
          tier: 'Growth',
          modules_json: JSON.stringify(['pos', 'orders', 'tables']),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: '2026-12-01',
          amount_etb: 200,
          grace_ends_at: '2026-12-01',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.tenantId).toBe('t1');
      expect(result.subscription.tier).toBe('Growth');
      expect(result.limits.branchLimit).toBe(3);
      expect(result.features).toContain('new_feature');
      expect(result.features).toContain('custom_feature');
    });

    it('computes entitlements without addons', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Trial', modules_json: JSON.stringify(['pos']), limits_json: JSON.stringify({ branchLimit: 1 }), price_monthly_etb: 0, price_yearly_etb: 0 },
      ];

      const { computeTenantEntitlements } = require('../../src/services/entitlements');
      const result = await computeTenantEntitlements({
        tenant: { id: 't1' },
        subscriptionRow: {
          tenant_id: 't1',
          tier: 'Trial',
          modules_json: JSON.stringify(['pos']),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: '2026-12-01',
          amount_etb: 0,
          grace_ends_at: '2026-12-01',
        },
      });

      expect(result.subscription.modules).toContain('pos');
      expect(result.limits.branchLimit).toBe(1);
    });

    it('applies module override when provided', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Pro', modules_json: JSON.stringify(['pos', 'orders', 'tables', 'inventory']), limits_json: JSON.stringify({ branchLimit: 999 }), price_monthly_etb: 500, price_yearly_etb: 5000 },
      ];

      const { computeTenantEntitlements } = require('../../src/services/entitlements');
      const result = await computeTenantEntitlements({
        tenant: {
          id: 't1',
          enabled_modules_json: JSON.stringify(['pos', 'orders']),
        },
        subscriptionRow: {
          tenant_id: 't1',
          tier: 'Pro',
          modules_json: JSON.stringify(['pos', 'orders', 'tables', 'inventory']),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: '2026-12-01',
          amount_etb: 500,
          grace_ends_at: '2026-12-01',
        },
      });

      expect(result.subscription.modules).toEqual(['pos', 'orders']);
    });

    it('includes billing information', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      state.tables.plans = [
        { tier: 'Starter', modules_json: JSON.stringify(['pos']), limits_json: JSON.stringify({ branchLimit: 1 }), price_monthly_etb: 100, price_yearly_etb: 1000 },
      ];

      const { computeTenantEntitlements } = require('../../src/services/entitlements');
      const result = await computeTenantEntitlements({
        tenant: { id: 't1' },
        subscriptionRow: {
          tenant_id: 't1',
          tier: 'Starter',
          modules_json: JSON.stringify(['pos']),
          cycle: 'Yearly',
          status: 'active',
          method: 'telebirr',
          next_bill_at: '2026-12-01T00:00:00.000Z',
          amount_etb: 1000,
          grace_ends_at: '2026-12-15T00:00:00.000Z',
        },
      });

      expect(result.billing.cycle).toBe('Yearly');
      expect(result.billing.status).toBe('active');
      expect(result.billing.method).toBe('telebirr');
      expect(result.billing.amountEtb).toBe(1000);
      expect(result.billing.nextBillAt).toBe('2026-12-01T00:00:00.000Z');
      expect(result.billing.graceEndsAt).toBe('2026-12-15T00:00:00.000Z');
    });
  });

  describe('upsertTenantEntitlementsSnapshot', () => {
    it('upserts entitlements snapshot', async () => {
      const state = global.__MIRACHPOS_DB_MOCK__?.state;

      const { upsertTenantEntitlementsSnapshot } = require('../../src/services/entitlements');
      await upsertTenantEntitlementsSnapshot({
        tenantId: 't1',
        entitlements: {
          subscription: { tier: 'Growth', modules: ['pos', 'orders'] },
          limits: { branchLimit: 3 },
          billing: { status: 'active', graceEndsAt: '2026-12-15' },
        },
      });

      expect(state.tables.tenant_entitlements).toHaveLength(1);
      expect(state.tables.tenant_entitlements[0].tenant_id).toBe('t1');
      expect(state.tables.tenant_entitlements[0].tier).toBe('Growth');
    });

    it('does nothing for empty tenant id', async () => {
      const { upsertTenantEntitlementsSnapshot } = require('../../src/services/entitlements');
      await upsertTenantEntitlementsSnapshot({
        tenantId: '',
        entitlements: { subscription: { tier: 'Growth' } },
      });

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      expect(state.tables.tenant_entitlements).toHaveLength(0);
    });

    it('does nothing for null entitlements', async () => {
      const { upsertTenantEntitlementsSnapshot } = require('../../src/services/entitlements');
      await upsertTenantEntitlementsSnapshot({
        tenantId: 't1',
        entitlements: null,
      });

      const state = global.__MIRACHPOS_DB_MOCK__?.state;
      expect(state.tables.tenant_entitlements).toHaveLength(0);
    });
  });
});
