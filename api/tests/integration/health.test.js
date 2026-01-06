
const request = require('supertest');
const { createApp } = require('../../src/app');
const { db } = require('../../src/db');

describe('Health Check Endpoint', () => {
    let app;

    beforeAll(() => {
        app = createApp();
    });

    afterAll(async () => {
        await db().destroy();
    });

    it('should return 200 and DB status up', async () => {
        const res = await request(app).get('/health');

        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('db', 'up');
        expect(res.body).toHaveProperty('uptime');
    });
});
