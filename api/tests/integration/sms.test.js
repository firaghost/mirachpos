const request = require('supertest');
const { createApp } = require('../../src/app');
const { getSuperadminHeaders } = require('../helpers/auth');

describe('SMS Integration (Superadmin)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    try {
      global.__MIRACHPOS_DB_MOCK__?.reset?.();
    } catch {
      // ignore
    }
  });

  it('POST /api/superadmin/sms/test returns 200 when sms is enabled', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (state?.tables) {
      state.tables.superadmins = [{ id: 'sa_1', status: 'Active' }];
      state.tables.platform_payment_config = [
        {
          id: 1,
          sms_config_json: JSON.stringify({
            enabled: true,
            provider: 'africas_talking',
            username: 'test-user',
            apiKey: 'test-api-key',
            senderId: 'MIRACH',
          }),
        },
      ];
    }

    const res = await request(app)
      .post('/api/superadmin/sms/test')
      .set(getSuperadminHeaders('sa_1'))
      .send({ to: '+251900000000', message: 'Hello from tests' });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.provider).toBe('africas_talking');
    expect(res.body?.messageId).toBeTruthy();
  });

  it('POST /api/superadmin/sms/test returns 409 when sms is disabled', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (state?.tables) {
      state.tables.superadmins = [{ id: 'sa_1', status: 'Active' }];
      state.tables.platform_payment_config = [
        {
          id: 1,
          sms_config_json: JSON.stringify({ enabled: false }),
        },
      ];
    }

    const res = await request(app)
      .post('/api/superadmin/sms/test')
      .set(getSuperadminHeaders('sa_1'))
      .send({ to: '+251900000000', message: 'Hello from tests' });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe('sms_disabled');
  });
});
