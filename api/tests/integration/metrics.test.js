
const request = require('supertest');
const { createApp } = require('../../src/app');
const { db } = require('../../src/db');
const { config } = require('../../src/config');
const jwt = require('jsonwebtoken');

describe('Metrics Endpoint', () => {
    let app;
    let token;
    let tempAdminId = 'test_admin_' + Date.now();

    beforeAll(async () => {
        app = createApp();

        const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Create temp superadmin
        await db().from('superadmins').insert({
            id: tempAdminId,
            email: 'test@example.com',
            password_hash: 'ignore',
            name: 'Test Admin',
            status: 'Active',
            created_at: nowIso,
            updated_at: nowIso,
        });

        // Generate token
        token = jwt.sign(
            { superadminId: tempAdminId, kind: 'superadmin' },
            config.jwtSecret
        );
    });

    afterAll(async () => {
        // Cleanup
        await db().from('superadmins').where({ id: tempAdminId }).del();
        await db().destroy(); // Close DB connection to allow jest to exit
    });

    it('should return 401 if no token provided', async () => {
        const res = await request(app).get('/api/superadmin/metrics');
        expect(res.statusCode).toEqual(401);
    });

    it('should return 200 and metrics with valid token', async () => {
        const res = await request(app)
            .get('/api/superadmin/metrics')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('system');
        expect(res.body.system).toHaveProperty('uptimeSeconds');
        expect(res.body).toHaveProperty('jobs');
        expect(res.body.jobs).toHaveProperty('pending');
    });
});
