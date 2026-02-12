const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Smoke (Strict 200)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  it('GET / returns 200', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it('GET /metrics returns 200', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toMatch(/text\/plain/);
  });

  it('GET /api/webhooks/health returns 200', async () => {
    const res = await request(app).get('/api/webhooks/health');
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});
