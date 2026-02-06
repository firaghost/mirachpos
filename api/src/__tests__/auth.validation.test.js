const request = require('supertest');

const { createApp } = require('../app');

describe('auth validation', () => {
    beforeEach(() => {
        if (global.__MIRACHPOS_DB_MOCK__?.reset) global.__MIRACHPOS_DB_MOCK__.reset();
    });

    it('POST /api/login rejects invalid body', async () => {
        const app = createApp();
        const res = await request(app).post('/api/login').set('X-Tenant', 'test').send({});
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'validation_error');
        expect(res.body).toHaveProperty('details');
    });

    it('POST /api/login-pin rejects invalid body', async () => {
        const app = createApp();
        const res = await request(app).post('/api/login-pin').set('X-Tenant', 'test').send({});
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'validation_error');
        expect(res.body).toHaveProperty('details');
    });
});
