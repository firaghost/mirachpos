const { getTenantBySlug } = require('../../src/services/tenantService');

describe('services/tenantService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenants = [
      { id: 't_1', slug: 'test-tenant', name: 'Test Tenant', status: 'active', trial_ends_at: null, plan: 'Basic', plan_ends_at: null },
      { id: 't_2', slug: 'another-tenant', name: 'Another', status: 'suspended', trial_ends_at: '2025-01-01T00:00:00.000Z', plan: 'Pro', plan_ends_at: '2025-12-31T00:00:00.000Z' },
    ];
  });

  it('getTenantBySlug returns tenant by slug (case insensitive)', async () => {
    const tenant = await getTenantBySlug('TEST-TENANT');
    expect(tenant).toMatchObject({
      id: 't_1',
      slug: 'test-tenant',
      name: 'Test Tenant',
      status: 'active',
    });
  });

  it('getTenantBySlug returns null for non-existent slug', async () => {
    const tenant = await getTenantBySlug('non-existent');
    expect(tenant).toBeNull();
  });

  it('getTenantBySlug returns null for empty/blank slug', async () => {
    expect(await getTenantBySlug('')).toBeNull();
    expect(await getTenantBySlug('   ')).toBeNull();
    expect(await getTenantBySlug(null)).toBeNull();
    expect(await getTenantBySlug(undefined)).toBeNull();
  });

  it('getTenantBySlug returns correct tenant with trial/plan dates', async () => {
    const tenant = await getTenantBySlug('another-tenant');
    expect(tenant).toMatchObject({
      id: 't_2',
      slug: 'another-tenant',
      name: 'Another',
      status: 'suspended',
      trial_ends_at: '2025-01-01T00:00:00.000Z',
      plan: 'Pro',
      plan_ends_at: '2025-12-31T00:00:00.000Z',
    });
  });
});
