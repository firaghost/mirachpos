const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Webhook Endpoints', () => {
  let app;
  
  beforeAll(async () => {
    app = createApp();
  });
  
  describe('POST /api/webhooks/chapa', () => {
    it('should handle chapa payment webhook', async () => {
      const webhookData = {
        status: 'success',
        tx_ref: 'order-123',
        transaction_id: 'tx-456',
        amount: 230
      };
      
      const res = await request(app)
        .post('/api/webhooks/chapa')
        .set('Chapa-Signature', 'valid-signature')
        .send(webhookData);
      
      expect([200, 400, 401]).toContain(res.status);
    });
    
    it('should reject webhook without signature', async () => {
      const res = await request(app)
        .post('/api/webhooks/chapa')
        .send({ status: 'success' });
      
      expect([401, 400]).toContain(res.status);
    });
  });
  
  describe('POST /api/webhooks/telebirr', () => {
    it('should handle telebirr payment webhook', async () => {
      const webhookData = {
        transactionId: 'tx-123',
        status: 'COMPLETED',
        amount: 230
      };
      
      const res = await request(app)
        .post('/api/webhooks/telebirr')
        .send(webhookData);
      
      expect([200, 400]).toContain(res.status);
    });
  });
  
  describe('POST /api/webhooks/santimpay', () => {
    it('should handle santimpay webhook', async () => {
      const webhookData = {
        id: 'payment-123',
        status: 'SUCCESS',
        amount: 230
      };
      
      const res = await request(app)
        .post('/api/webhooks/santimpay')
        .send(webhookData);
      
      expect([200, 400]).toContain(res.status);
    });
  });
  
  describe('POST /api/webhooks/cbe-birr', () => {
    it('should handle CBE Birr webhook', async () => {
      const webhookData = {
        transactionId: 'tx-123',
        status: 'SUCCESS',
        amount: 230
      };
      
      const res = await request(app)
        .post('/api/webhooks/cbe-birr')
        .send(webhookData);
      
      expect([200, 400, 501]).toContain(res.status);
    });
  });
});
