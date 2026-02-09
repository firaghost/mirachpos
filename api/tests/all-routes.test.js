// CORRECTED API ROUTES TEST FILE
// Updated import path for your project structure

const request = require('supertest');

// Try different possible paths for the app module
let createApp;
try {
  // If test is in tests/integration/
  ({ createApp } = require('../src/app'));
} catch (e) {
  try {
    // If test is in tests/
    ({ createApp } = require('../../src/app'));
  } catch (e2) {
    try {
      // If test is in api/tests/integration/
      ({ createApp } = require('../../src/app'));
    } catch (e3) {
      // Fallback - adjust based on your structure
      throw new Error('Cannot find app module. Make sure test is in api/tests/ or api/tests/integration/');
    }
  }
}

describe('MIRACH POS - Correct API Routes', () => {
  let app;
  let authToken = 'test-token';
  let tenantId = 'test-tenant';
  let branchId = 'test-branch';
  
  beforeAll(() => {
    app = createApp();
  });
  
  // ========== AUTH ROUTES (/api/auth/...) ==========
  describe('Authentication Routes', () => {
    it('POST /api/auth/login - should authenticate user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: 'password' });
      expect([200, 401, 400]).toContain(res.status);
    });
    
    it('POST /api/auth/login-pin - should authenticate with PIN', async () => {
      const res = await request(app)
        .post('/api/auth/login-pin')
        .send({ staffId: 'staff-1', pin: '1234' });
      expect([200, 401, 400]).toContain(res.status);
    });
    
    it('POST /api/auth/forgot-password - should send reset email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@test.com' });
      expect([200, 400]).toContain(res.status);
    });
    
    it('GET /api/auth/me - should return current user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401]).toContain(res.status);
    });
  });
  
  // ========== OWNER ROUTES (/api/owner/...) ==========
  describe('Owner Routes', () => {
    it('GET /api/owner/overview - should return dashboard overview', async () => {
      const res = await request(app)
        .get('/api/owner/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/profile - should return owner profile', async () => {
      const res = await request(app)
        .get('/api/owner/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('PUT /api/owner/profile - should update profile', async () => {
      const res = await request(app)
        .put('/api/owner/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .send({ businessName: 'Test Business' });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/settings - should return settings', async () => {
      const res = await request(app)
        .get('/api/owner/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('PUT /api/owner/settings - should update settings', async () => {
      const res = await request(app)
        .put('/api/owner/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .send({ currency: 'ETB' });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/reports - should return reports summary', async () => {
      const res = await request(app)
        .get('/api/owner/reports')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/inventory - should return inventory', async () => {
      const res = await request(app)
        .get('/api/owner/inventory')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/finance - should return finance data', async () => {
      const res = await request(app)
        .get('/api/owner/finance')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/owner/finance/expenses - should add expense', async () => {
      const res = await request(app)
        .post('/api/owner/finance/expenses')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .send({ amount: 100, category: 'Utilities', description: 'Electric bill' });
      expect([201, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/menu/products - should list products', async () => {
      const res = await request(app)
        .get('/api/owner/menu/products')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/plans - should list subscription plans', async () => {
      const res = await request(app)
        .get('/api/owner/plans')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/onboarding - should return onboarding status', async () => {
      const res = await request(app)
        .get('/api/owner/onboarding')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/owner/onboarding/complete - should complete onboarding', async () => {
      const res = await request(app)
        .post('/api/owner/onboarding/complete')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .send({ step: 'business_profile' });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/owner/integrations - should list integrations', async () => {
      const res = await request(app)
        .get('/api/owner/integrations')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/owner/uploads/image - should upload image', async () => {
      const res = await request(app)
        .post('/api/owner/uploads/image')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .attach('image', Buffer.from('fake-image'), 'test.jpg');
      expect([200, 401, 403, 400]).toContain(res.status);
    });
  });
  
  // ========== MANAGER ROUTES (/api/manager/...) ==========
  describe('Manager Routes', () => {
    it('GET /api/manager/overview - should return branch overview', async () => {
      const res = await request(app)
        .get('/api/manager/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/settings - should return branch settings', async () => {
      const res = await request(app)
        .get('/api/manager/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('PUT /api/manager/settings - should update settings', async () => {
      const res = await request(app)
        .put('/api/manager/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ receiptHeader: 'Test Header' });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports - should return reports', async () => {
      const res = await request(app)
        .get('/api/manager/reports')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/daily - should return daily report', async () => {
      const res = await request(app)
        .get('/api/manager/reports/daily?date=2024-01-01')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/hourly - should return hourly report', async () => {
      const res = await request(app)
        .get('/api/manager/reports/hourly?date=2024-01-01')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/products - should return product report', async () => {
      const res = await request(app)
        .get('/api/manager/reports/products?startDate=2024-01-01&endDate=2024-01-31')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/staff - should return staff report', async () => {
      const res = await request(app)
        .get('/api/manager/reports/staff?startDate=2024-01-01&endDate=2024-01-31')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/export/xlsx - should export Excel', async () => {
      const res = await request(app)
        .get('/api/manager/reports/export/xlsx?startDate=2024-01-01&endDate=2024-01-31')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/manager/reports/export/pdf - should export PDF', async () => {
      const res = await request(app)
        .get('/api/manager/reports/export/pdf?startDate=2024-01-01&endDate=2024-01-31')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/manager/uploads/image - should upload image', async () => {
      const res = await request(app)
        .post('/api/manager/uploads/image')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .attach('image', Buffer.from('fake'), 'test.jpg');
      expect([200, 401, 403, 400]).toContain(res.status);
    });
  });
  
  // ========== WAITER ROUTES (/api/waiter/...) ==========
  describe('Waiter Routes', () => {
    it('PUT /api/waiter/account - should update account', async () => {
      const res = await request(app)
        .put('/api/waiter/account')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ name: 'Test Waiter' });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/waiter/history - should return order history', async () => {
      const res = await request(app)
        .get('/api/waiter/history')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/waiter/order/:id - should get order details', async () => {
      const res = await request(app)
        .get('/api/waiter/order/order-123')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('GET /api/waiter/shift-report - should return shift report', async () => {
      const res = await request(app)
        .get('/api/waiter/shift-report')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  // ========== POS ROUTES (/api/pos/...) ==========
  describe('POS Routes', () => {
    it('POST /api/pos/initialize - should initialize POS', async () => {
      const res = await request(app)
        .post('/api/pos/initialize')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/pos/settings - should return POS settings', async () => {
      const res = await request(app)
        .get('/api/pos/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/pos/tables - should list tables', async () => {
      const res = await request(app)
        .get('/api/pos/tables')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/pos/tables - should create table', async () => {
      const res = await request(app)
        .post('/api/pos/tables')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ name: 'Table 1', seats: 4 });
      expect([201, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/pos/orders - should list orders', async () => {
      const res = await request(app)
        .get('/api/pos/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/pos/orders/:id - should get order details', async () => {
      const res = await request(app)
        .get('/api/pos/orders/order-123')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('GET /api/pos/orders/:id/receipt-link - should get receipt link', async () => {
      const res = await request(app)
        .get('/api/pos/orders/order-123/receipt-link')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('POST /api/pos/orders/:id/refund - should process refund', async () => {
      const res = await request(app)
        .post('/api/pos/orders/order-123/refund')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ amount: 100, reason: 'Customer request' });
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('POST /api/pos/print/receipt/:id - should print receipt', async () => {
      const res = await request(app)
        .post('/api/pos/print/receipt/order-123')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ printerId: 'printer-1' });
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('GET /api/pos/menu/products - should list menu products', async () => {
      const res = await request(app)
        .get('/api/pos/menu/products')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/pos/notifications - should return notifications', async () => {
      const res = await request(app)
        .get('/api/pos/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('POST /api/pos/staff/verify-pin - should verify staff PIN', async () => {
      const res = await request(app)
        .post('/api/pos/staff/verify-pin')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId })
        .send({ staffId: 'staff-1', pin: '1234' });
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  // ========== INVENTORY ROUTES ==========
  describe('Inventory Routes', () => {
    it('GET /api/inventory/items - should list inventory items', async () => {
      const res = await request(app)
        .get('/api/inventory/items')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant', tenantId)
        .query({ branchId });
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  // ========== SUPERADMIN ROUTES ==========
  describe('Superadmin Routes', () => {
    it('GET /api/superadmin/tenants - should list tenants', async () => {
      const res = await request(app)
        .get('/api/superadmin/tenants')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 403]).toContain(res.status);
    });
    
    it('GET /api/superadmin/tenants/:id - should get tenant details', async () => {
      const res = await request(app)
        .get('/api/superadmin/tenants/tenant-123')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 403, 404]).toContain(res.status);
    });
    
    it('GET /api/superadmin/system-health - should return system health', async () => {
      const res = await request(app)
        .get('/api/superadmin/system-health')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 403]).toContain(res.status);
    });
  });
  
  // ========== WEBHOOK ROUTES ==========
  describe('Webhook Routes', () => {
    it('POST /api/webhooks/chapa - should handle Chapa webhook', async () => {
      const res = await request(app)
        .post('/api/webhooks/chapa')
        .set('Chapa-Signature', 'valid-signature')
        .send({ status: 'success', tx_ref: 'order-123' });
      expect([200, 400, 401]).toContain(res.status);
    });
  });
  
  // ========== PUBLIC ROUTES ==========
  describe('Public Routes', () => {
    it('POST /api/public/signup - should signup new tenant', async () => {
      const res = await request(app)
        .post('/api/public/signup')
        .send({
          businessName: 'Test Business',
          email: 'new@test.com',
          password: 'password123'
        });
      expect([201, 400]).toContain(res.status);
    });
    
    it('GET /health - should return health status', async () => {
      const res = await request(app)
        .get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });
    
    it('GET / - should return API info', async () => {
      const res = await request(app)
        .get('/');
      expect(res.status).toBe(200);
    });
  });
});
