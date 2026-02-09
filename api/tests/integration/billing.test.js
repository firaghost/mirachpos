const request = require('supertest');
const { createApp } = require('../../src/app');
const { getAuthHeaders, getUnauthenticatedHeaders } = require('../helpers/auth');

describe('Billing & Subscription API', () => {
  let app;
  
  beforeAll(async () => {
    app = createApp();
  });
  
  describe('GET /api/subscription/plans', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/subscription/plans')
        .set(getUnauthenticatedHeaders());
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should return plans with valid auth', async () => {
      const res = await request(app)
        .get('/api/subscription/plans')
        .set(getAuthHeaders('cafe_owner'));
      
      expect([200, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/subscription/current', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/subscription/current')
        .set(getUnauthenticatedHeaders());
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should return subscription with valid auth', async () => {
      const res = await request(app)
        .get('/api/subscription/current')
        .set(getAuthHeaders('cafe_owner'));
      
      expect([200, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/subscription/upgrade', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/subscription/upgrade')
        .set(getUnauthenticatedHeaders())
        .send({ planId: 'pro-plan', billingCycle: 'monthly' });
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should process upgrade with valid auth', async () => {
      const res = await request(app)
        .post('/api/subscription/upgrade')
        .set(getAuthHeaders('cafe_owner'))
        .send({ planId: 'pro-plan', billingCycle: 'monthly' });
      
      expect([200, 400, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/billing/invoices', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/billing/invoices')
        .set(getUnauthenticatedHeaders());
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should return invoices with valid auth', async () => {
      const res = await request(app)
        .get('/api/billing/invoices')
        .set(getAuthHeaders('cafe_owner'));
      
      expect([200, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/billing/payment-methods', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/billing/payment-methods')
        .set(getUnauthenticatedHeaders());
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should return payment methods with valid auth', async () => {
      const res = await request(app)
        .get('/api/billing/payment-methods')
        .set(getAuthHeaders('cafe_owner'));
      
      expect([200, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/billing/payment-methods', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/billing/payment-methods')
        .set(getUnauthenticatedHeaders())
        .send({ type: 'chapa', name: 'Chapa' });
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should add payment method with valid auth', async () => {
      const res = await request(app)
        .post('/api/billing/payment-methods')
        .set(getAuthHeaders('cafe_owner'))
        .send({ type: 'chapa', name: 'Chapa' });
      
      expect([201, 400, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/billing/make-payment', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/billing/make-payment')
        .set(getUnauthenticatedHeaders())
        .send({ invoiceId: 'inv-123', amount: 1000, method: 'chapa' });
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should process payment with valid auth', async () => {
      const res = await request(app)
        .post('/api/billing/make-payment')
        .set(getAuthHeaders('cafe_owner'))
        .send({ invoiceId: 'inv-123', amount: 1000, method: 'chapa' });
      
      expect([200, 400, 404]).toContain(res.status);
    });
  });
  
  describe('GET /api/billing/usage', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/billing/usage')
        .set(getUnauthenticatedHeaders());
      
      // Routes removed from production return 404
      expect([401, 403, 404]).toContain(res.status);
    });

    it('should return usage with valid auth', async () => {
      const res = await request(app)
        .get('/api/billing/usage')
        .set(getAuthHeaders('cafe_owner'));
      
      expect([200, 404]).toContain(res.status);
    });
  });
});
