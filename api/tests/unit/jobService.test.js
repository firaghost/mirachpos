const jobService = require('../../src/services/jobService');

describe('services/jobService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.jobs = [];
  });

  it('enqueueJob inserts a pending job row and returns id', async () => {
    const id = await jobService.enqueueJob({ type: 't1', payload: { a: 1 }, runAt: new Date('2099-01-01T00:00:00.000Z') });

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const rows = state.tables.jobs;

    expect(typeof id).toBe('string');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('t1');
    expect(rows[0].status).toBe('pending');
  });

  it('processJobs marks job failed when no handler registered', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'unhandled',
        payload_json: '{}',
        status: 'pending',
        attempts: 0,
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await jobService.processJobs();

    expect(state.tables.jobs[0].status).toBe('failed');
    expect(state.tables.jobs[0].last_error).toBe('No handler registered');
  });

  it('processJobs runs handler and marks job completed', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'handled',
        payload_json: JSON.stringify({ x: 1 }),
        status: 'pending',
        attempts: 0,
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const handler = jest.fn(async () => undefined);
    jobService.registerHandler('handled', handler);

    await jobService.processJobs();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.tables.jobs[0].status).toBe('completed');
    expect(state.tables.jobs[0].completed_at).toBeTruthy();
    expect(state.tables.jobs[0].last_error).toBe(null);
  });

  it('processJobs retries failed job (attempts < 3) and reschedules', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'flaky',
        payload_json: '{}',
        status: 'pending',
        attempts: 0,
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    jobService.registerHandler('flaky', async () => {
      throw new Error('boom');
    });

    await jobService.processJobs();

    expect(state.tables.jobs[0].status).toBe('pending');
    expect(state.tables.jobs[0].last_error).toBe('boom');
    expect(state.tables.jobs[0].run_at).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('processJobs marks job as failed after max retries exceeded', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'flaky',
        payload_json: '{}',
        status: 'pending',
        attempts: 3, // Already at max retries
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    jobService.registerHandler('flaky', async () => {
      throw new Error('final failure');
    });

    await jobService.processJobs();

    expect(state.tables.jobs[0].status).toBe('failed');
    expect(state.tables.jobs[0].last_error).toBe('final failure');
  });

  it('processJobs does nothing when no pending jobs', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.jobs = [];

    await jobService.processJobs();

    expect(state.tables.jobs).toHaveLength(0);
  });

  it('processJobs skips jobs with future run_at', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'future',
        payload_json: '{}',
        status: 'pending',
        attempts: 0,
        run_at: futureDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const handler = jest.fn();
    jobService.registerHandler('future', handler);

    await jobService.processJobs();

    // Job should remain pending and not processed
    expect(state.tables.jobs[0].status).toBe('pending');
    expect(handler).not.toHaveBeenCalled();
  });

  it('processJobs parses payload_json and passes to handler', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'data',
        payload_json: JSON.stringify({ foo: 'bar', num: 42 }),
        status: 'pending',
        attempts: 0,
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const handler = jest.fn(async () => undefined);
    jobService.registerHandler('data', handler);

    await jobService.processJobs();

    expect(handler).toHaveBeenCalledWith({ foo: 'bar', num: 42 }, { jobId: 'job_1' });
  });

  it('registerHandler adds handler to registry', async () => {
    const handler = jest.fn();
    jobService.registerHandler('testType', handler);

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.jobs = [
      {
        id: 'job_1',
        type: 'testType',
        payload_json: '{}',
        status: 'pending',
        attempts: 0,
        run_at: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await jobService.processJobs();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
