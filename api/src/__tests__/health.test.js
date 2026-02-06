const request = require('supertest');

const { createApp } = require('../app');

describe('health', () => {
    beforeEach(() => {
        if (global.__MIRACHPOS_DB_MOCK__?.reset) global.__MIRACHPOS_DB_MOCK__.reset();
    });

    it('GET /health returns ok', async () => {
        const app = createApp();
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('db');
    });
});
