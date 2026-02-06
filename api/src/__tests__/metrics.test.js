const request = require('supertest');

const { createApp } = require('../app');

describe('metrics', () => {
    beforeEach(() => {
        if (global.__MIRACHPOS_DB_MOCK__?.reset) global.__MIRACHPOS_DB_MOCK__.reset();
    });

    it('GET /metrics returns prometheus text format', async () => {
        const app = createApp();
        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        expect(String(res.headers['content-type'] || '')).toMatch(/text\/plain/);
        expect(String(res.text || '')).toMatch(/http_requests_total|process_cpu_user_seconds_total/);
    });
});
