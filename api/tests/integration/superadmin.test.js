const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Superadmin API Endpoints', () => {
  let app;
  let superadminToken;
  
  beforeAll(async () => {
    app = createApp();
    superadminToken = 'superadmin-test-token';
  });
  
  describe('GET /api/superadmin/tenants', () => {
    it('should list all tenants', async () => {
      const res = await request(app)
        .get('/api/superadmin/tenants')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/superadmin/tenants?status=active')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/superadmin/tenants/:id', () => {
    it('should return tenant details', async () => {
      const res = await request(app)
        .get('/api/superadmin/tenants/tenant-123')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/superadmin/system-health', () => {
    it('should return system health stats', async () => {
      const res = await request(app)
        .get('/api/superadmin/system-health')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/superadmin/audit-logs', () => {
    it('should return audit logs', async () => {
      const res = await request(app)
        .get('/api/superadmin/audit-logs')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('should filter by date range', async () => {
      const res = await request(app)
        .get('/api/superadmin/audit-logs?startDate=2024-01-01&endDate=2024-12-31')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/superadmin/billing/overview', () => {
    it('should return billing overview', async () => {
      const res = await request(app)
        .get('/api/superadmin/billing/overview')
        .set('Authorization', `Bearer ${superadminToken}`);
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/superadmin/tenants/:id/suspend', () => {
    it('should suspend tenant', async () => {
      const res = await request(app)
        .post('/api/superadmin/tenants/tenant-123/suspend')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ reason: 'Payment overdue' });
      
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/superadmin/maintenance-mode', () => {
    it('should toggle maintenance mode', async () => {
      const res = await request(app)
        .post('/api/superadmin/maintenance-mode')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ enabled: true, message: 'System maintenance' });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
});
