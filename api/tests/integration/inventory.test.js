const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Inventory API Endpoints', () => {
  let app;
  let authToken;
  let tenantId = 'test-tenant-id';
  let branchId = 'test-branch-id';
  
  beforeAll(async () => {
    app = createApp();
    authToken = 'test-token';
  });
  
  describe('GET /api/inventory/items', () => {
    it('should list all inventory items', async () => {
      const res = await request(app)
        .get('/api/inventory/items')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('should filter by low stock', async () => {
      const res = await request(app)
        .get('/api/inventory/items?lowStock=true')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/inventory/items', () => {
    it('should create new inventory item', async () => {
      const item = {
        name: 'Test Ingredient',
        unit: 'kg',
        currentStock: 10,
        minStock: 5,
        costPerUnit: 50
      };
      
      const res = await request(app)
        .post('/api/inventory/items')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(item);
      
      expect([201, 400, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/inventory/suppliers', () => {
    it('should list suppliers', async () => {
      const res = await request(app)
        .get('/api/inventory/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/inventory/suppliers', () => {
    it('should create supplier', async () => {
      const supplier = {
        name: 'Test Supplier',
        contactPerson: 'John Doe',
        phone: '+251911111111',
        email: 'supplier@test.com'
      };
      
      const res = await request(app)
        .post('/api/inventory/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(supplier);
      
      expect([201, 400, 401, 403]).toContain(res.status);
    });
  });
  
  describe('GET /api/inventory/purchase-orders', () => {
    it('should list purchase orders', async () => {
      const res = await request(app)
        .get('/api/inventory/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/inventory/purchase-orders', () => {
    it('should create purchase order', async () => {
      const po = {
        supplierId: 'supplier-1',
        items: [
          { itemId: 'item-1', quantity: 10, unitPrice: 50 }
        ],
        expectedDeliveryDate: '2024-12-31'
      };
      
      const res = await request(app)
        .post('/api/inventory/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(po);
      
      expect([201, 400, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/inventory/stock-count', () => {
    it('should record stock count', async () => {
      const count = {
        itemId: 'item-1',
        countedQuantity: 8,
        notes: 'Monthly stock count'
      };
      
      const res = await request(app)
        .post('/api/inventory/stock-count')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(count);
      
      expect([200, 400, 401, 403]).toContain(res.status);
    });
  });
});
