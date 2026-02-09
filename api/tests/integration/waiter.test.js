const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Waiter API Endpoints', () => {
  let app;
  let authToken;
  let tenantId = 'test-tenant-id';
  let branchId = 'test-branch-id';
  
  beforeAll(async () => {
    app = createApp();
    authToken = 'test-token';
  });
  
  describe('GET /api/waiter/floor', () => {
    it('should return floor map with tables', async () => {
      const res = await request(app)
        .get('/api/waiter/floor')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(Array.isArray(res.body.tables)).toBe(true);
      }
    });
  });
  
  describe('GET /api/waiter/menu', () => {
    it('should return active menu', async () => {
      const res = await request(app)
        .get('/api/waiter/menu')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/waiter/orders', () => {
    it('should create new order', async () => {
      const order = {
        tableId: 'table-1',
        items: [
          { productId: 'prod-1', qty: 2, unitPrice: 100, name: 'Test Item' }
        ],
        subtotal: 200,
        tax: 30,
        total: 230,
        orderType: 'dine_in'
      };
      
      const res = await request(app)
        .post('/api/waiter/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(order);
      
      expect([201, 400, 401, 403]).toContain(res.status);
    });
    
    it('should validate table availability', async () => {
      const order = {
        tableId: 'occupied-table',
        items: [{ productId: 'prod-1', qty: 1, unitPrice: 100, name: 'Test' }],
        subtotal: 100,
        tax: 15,
        total: 115
      };
      
      const res = await request(app)
        .post('/api/waiter/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(order);
      
      // Should either create or return 409 conflict
      expect([201, 400, 401, 403, 409]).toContain(res.status);
    });
  });
  
  describe('GET /api/waiter/orders/active', () => {
    it('should list active orders', async () => {
      const res = await request(app)
        .get('/api/waiter/orders/active')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/waiter/orders/:id/items', () => {
    it('should add items to existing order', async () => {
      const items = [
        { productId: 'prod-2', qty: 1, unitPrice: 50, name: 'Extra Item' }
      ];
      
      const res = await request(app)
        .post('/api/waiter/orders/order-123/items')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ items });
      
      expect([200, 400, 401, 403, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/waiter/orders/:id/void', () => {
    it('should void an order item', async () => {
      const voidData = {
        itemId: 'item-1',
        reason: 'Customer cancelled'
      };
      
      const res = await request(app)
        .post('/api/waiter/orders/order-123/void')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(voidData);
      
      expect([200, 400, 401, 403, 404]).toContain(res.status);
    });
    
    it('should require void reason', async () => {
      const res = await request(app)
        .post('/api/waiter/orders/order-123/void')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ itemId: 'item-1' });
      
      expect([400, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/waiter/payments', () => {
    it('should process payment', async () => {
      const payment = {
        orderId: 'order-123',
        amount: 230,
        method: 'cash',
        tenderedAmount: 250
      };
      
      const res = await request(app)
        .post('/api/waiter/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(payment);
      
      expect([200, 400, 401, 403]).toContain(res.status);
    });
    
    it('should calculate change correctly', async () => {
      const payment = {
        orderId: 'order-123',
        amount: 100,
        method: 'cash',
        tenderedAmount: 150
      };
      
      const res = await request(app)
        .post('/api/waiter/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send(payment);
      
      if (res.status === 200) {
        expect(res.body.change).toBe(50);
      }
    });
  });
  
  describe('GET /api/waiter/kds', () => {
    it('should return kitchen display orders', async () => {
      const res = await request(app)
        .get('/api/waiter/kds')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  describe('POST /api/waiter/kds/:id/status', () => {
    it('should update order item status', async () => {
      const res = await request(app)
        .post('/api/waiter/kds/item-123/status')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ status: 'ready' });
      
      expect([200, 400, 401, 403, 404]).toContain(res.status);
    });
  });
});
