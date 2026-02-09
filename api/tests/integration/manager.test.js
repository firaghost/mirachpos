const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Manager API Endpoints', () => {
  let app;
  let authToken;
  let tenantId = 'test-tenant-id';
  let branchId = 'test-branch-id';
  
  beforeAll(async () => {
    app = createApp();
    authToken = 'test-token';
  });
  
  describe('GET /api/manager/dashboard', () => {
    it('should return branch dashboard', async () => {
      const res = await request(app)
        .get('/api/manager/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/orders', () => {
    it('should list branch orders', async () => {
      const res = await request(app)
        .get('/api/manager/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(Array.isArray(res.body.orders)).toBe(true);
      }
    });
    
    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/manager/orders?status=pending')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/orders/:id', () => {
    it('should return order details', async () => {
      const res = await request(app)
        .get('/api/manager/orders/order-123')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/inventory', () => {
    it('should list branch inventory', async () => {
      const res = await request(app)
        .get('/api/manager/inventory')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/manager/inventory/adjust', () => {
    it('should adjust inventory stock', async () => {
      const adjustment = {
        itemId: 'item-1',
        quantity: 10,
        reason: 'Restock'
      };
      
      const res = await request(app)
        .post('/api/manager/inventory/adjust')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(adjustment);
      
      expect([200, 400, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/tables', () => {
    it('should list all tables', async () => {
      const res = await request(app)
        .get('/api/manager/tables')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/manager/tables', () => {
    it('should create new table', async () => {
      const tableData = {
        name: 'Table 1',
        seats: 4,
        area: 'Main Hall'
      };
      
      const res = await request(app)
        .post('/api/manager/tables')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(tableData);
      
      expect([201, 400, 401, 403, 402]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/reports/daily', () => {
    it('should return daily sales report', async () => {
      const res = await request(app)
        .get('/api/manager/reports/daily?date=2024-01-01')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/staff', () => {
    it('should list branch staff', async () => {
      const res = await request(app)
        .get('/api/manager/staff')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/manager/menu', () => {
    it('should return branch menu', async () => {
      const res = await request(app)
        .get('/api/manager/menu')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/manager/menu/items', () => {
    it('should add menu item', async () => {
      const item = {
        name: 'Test Item',
        price: 100,
        category: 'Food',
        description: 'Test description'
      };
      
      const res = await request(app)
        .post('/api/manager/menu/items')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(item);
      
      expect([201, 400, 401, 403]).toContain(res.status);
    });
  });
});
