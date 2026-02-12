const { runDailyCron } = require('../../src/services/cronService');

describe('services/cronService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenants = [];
  });

  it('runDailyCron suspends tenants with expired trials', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Yesterday

    state.tables.tenants = [
      { id: 't_1', status: 'active', trial_ends_at: pastDate, plan_ends_at: null },
      { id: 't_2', status: 'active', trial_ends_at: null, plan_ends_at: null }, // No expiration
    ];

    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(1);
    expect(state.tables.tenants[0].status).toBe('suspended');
    expect(state.tables.tenants[1].status).toBe('active');
  });

  it('runDailyCron suspends tenants with expired plan', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenants = [
      { id: 't_1', status: 'active', trial_ends_at: null, plan_ends_at: pastDate },
    ];

    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(1);
    expect(state.tables.tenants[0].status).toBe('suspended');
  });

  it('runDailyCron does not suspend already suspended tenants', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenants = [
      { id: 't_1', status: 'suspended', trial_ends_at: pastDate, plan_ends_at: null },
    ];

    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(0); // Already suspended
  });

  it('runDailyCron handles tenants with no expiration dates', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenants = [
      { id: 't_1', status: 'active', trial_ends_at: null, plan_ends_at: null },
      { id: 't_2', status: 'active', trial_ends_at: null, plan_ends_at: null },
    ];

    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(0);
    expect(state.tables.tenants[0].status).toBe('active');
    expect(state.tables.tenants[1].status).toBe('active');
  });

  it('runDailyCron handles empty tenant list', async () => {
    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(0);
  });

  it('runDailyCron handles future expiration dates', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow

    state.tables.tenants = [
      { id: 't_1', status: 'active', trial_ends_at: futureDate, plan_ends_at: null },
      { id: 't_2', status: 'active', trial_ends_at: null, plan_ends_at: futureDate },
    ];

    const result = await runDailyCron();
    expect(result.ok).toBe(true);
    expect(result.suspended).toBe(0);
    expect(state.tables.tenants[0].status).toBe('active');
    expect(state.tables.tenants[1].status).toBe('active');
  });
});
