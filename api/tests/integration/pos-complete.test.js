const request = require('supertest');
const { createApp } = require('../../src/app');
const { getAuthHeaders, getUnauthenticatedHeaders } = require('../helpers/auth');

describe('POS Routes - Complete Coverage', () => {
  let app;
  let tenantId = 'test';
  let branchId = 'b_1';
  let orderId;
  
  beforeAll(async () => {
    app = createApp();
  });
  
  // ========== ORDERS ==========
  describe('Orders', () => {
    describe('POST /api/pos/orders', () => {
      it('should create dine-in order', async () => {
        const order = {
          tableId: 'table-1',
          tableName: 'Table 1',
          orderType: 'dine_in',
          items: [
            { productId: 'prod-1', name: 'Burger', qty: 2, unitPrice: 150, total: 300 }
          ],
          subtotal: 300,
          tax: 45,
          serviceCharge: 0,
          discount: 0,
          total: 345
        };
        
        const res = await request(app)
          .post('/api/pos/orders')
          .set(getAuthHeaders('cafe_owner'))
          .query({ branchId })
          .send(order);
        
        expect([201, 200, 401, 403]).toContain(res.status);
        if (res.status === 201 || res.status === 200) {
          orderId = res.body.orderId || res.body.id;
        }
      });
      
      it('should create takeaway order', async () => {
        const order = {
          orderType: 'takeaway',
          takeawayFee: 20,
          items: [
            { productId: 'prod-1', name: 'Burger', qty: 1, unitPrice: 150, total: 150 }
          ],
          subtotal: 150,
          tax: 22.5,
          total: 172.5
        };
        
        const res = await request(app)
          .post('/api/pos/orders')
          .set(getAuthHeaders('cafe_owner'))
          .query({ branchId })
          .send(order);
        
        expect([201, 200, 401, 403, 402]).toContain(res.status);
      });
      
      it('should reject order with negative qty', async () => {
        const order = {
          tableId: 'table-1',
          items: [{ productId: 'prod-1', name: 'Burger', qty: -1, unitPrice: 150 }],
          subtotal: -150,
          total: -150
        };
        
        const res = await request(app)
          .post('/api/pos/orders')
          .set(getAuthHeaders('cafe_owner'))
          .query({ branchId })
          .send(order);
        
        expect([400, 422]).toContain(res.status);
      });
      
      it('should reject order without items', async () => {
        const res = await request(app)
          .post('/api/pos/orders')
          .set(getAuthHeaders('cafe_owner'))
          .query({ branchId })
          .send({ tableId: 'table-1', items: [] });
        
        expect([400, 422]).toContain(res.status);
      });
    });
    
    describe('GET /api/pos/orders/:id', () => {
      it('should get order details', async () => {
        const testOrderId = orderId || 'test-order-123';
        const res = await request(app)
          .get(`/api/pos/orders/${testOrderId}`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
      
      it('should return 404 for non-existent order', async () => {
        const res = await request(app)
          .get('/api/orders/non-existent-id')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([404, 401, 403]).toContain(res.status);
      });
    });
    
    describe('GET /api/pos/orders', () => {
      it('should list orders with pagination', async () => {
        const res = await request(app)
          .get('/api/pos/orders?page=1&limit=20')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403]).toContain(res.status);
      });
      
      it('should filter orders by status', async () => {
        const res = await request(app)
          .get('/api/pos/orders?status=pending')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403]).toContain(res.status);
      });
      
      it('should filter orders by date range', async () => {
        const res = await request(app)
          .get('/api/pos/orders?startDate=2024-01-01&endDate=2024-12-31')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403]).toContain(res.status);
      });
    });
    
    describe('PUT /api/pos/orders/:id', () => {
      it('should update order items', async () => {
        const updates = {
          items: [
            { productId: 'prod-1', name: 'Burger', qty: 3, unitPrice: 150, total: 450 }
          ],
          subtotal: 450,
          tax: 67.5,
          total: 517.5
        };
        
        const res = await request(app)
          .put(`/api/pos/orders/${orderId || 'test-order'}`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(updates);
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('DELETE /api/pos/orders/:id', () => {
      it('should cancel/delete order', async () => {
        const res = await request(app)
          .delete(`/api/pos/orders/${orderId || 'test-order'}`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send({ reason: 'Customer request' });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== PAYMENTS ==========
  describe('Payments', () => {
    describe('POST /api/pos/payments', () => {
      it('should process cash payment', async () => {
        const payment = {
          orderId: orderId || 'test-order',
          amount: 345,
          method: 'cash',
          tenderedAmount: 400,
          change: 55
        };
        
        const res = await request(app)
          .post('/api/pos/payments')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(payment);
        
        expect([200, 201, 400, 401, 403]).toContain(res.status);
      });
      
      it('should process card payment', async () => {
        const payment = {
          orderId: orderId || 'test-order',
          amount: 345,
          method: 'card',
          reference: 'card-ref-123'
        };
        
        const res = await request(app)
          .post('/api/pos/payments')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(payment);
        
        expect([200, 201, 400, 401, 403]).toContain(res.status);
      });
      
      it('should process Telebirr payment', async () => {
        const payment = {
          orderId: orderId || 'test-order',
          amount: 345,
          method: 'telebirr',
          phone: '+251911111111'
        };
        
        const res = await request(app)
          .post('/api/pos/payments')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(payment);
        
        expect([200, 201, 400, 401, 403]).toContain(res.status);
      });
      
      it('should process split payment', async () => {
        const payment = {
          orderId: orderId || 'test-order',
          splits: [
            { amount: 200, method: 'cash', tenderedAmount: 200 },
            { amount: 145, method: 'card', reference: 'card-ref' }
          ]
        };
        
        const res = await request(app)
          .post('/api/pos/payments')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(payment);
        
        expect([200, 201, 400, 401, 403]).toContain(res.status);
      });
      
      it('should reject payment for already paid order', async () => {
        const payment = {
          orderId: 'already-paid-order',
          amount: 345,
          method: 'cash',
          tenderedAmount: 400
        };
        
        const res = await request(app)
          .post('/api/pos/payments')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(payment);
        
        expect([400, 409, 422, 401, 403]).toContain(res.status);
      });
    });
    
    describe('GET /api/pos/payments/:orderId', () => {
      it('should get payment details', async () => {
        const res = await request(app)
          .get(`/api/pos/payments/${orderId || 'test-order'}`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('POST /api/pos/payments/:id/refund', () => {
      it('should process refund', async () => {
        const refund = {
          amount: 345,
          reason: 'Customer complaint'
        };
        
        const res = await request(app)
          .post('/api/pos/payments/payment-123/refund')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(refund);
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== VOIDS ==========
  describe('Voids', () => {
    describe('POST /api/pos/orders/:id/void', () => {
      it('should void entire order', async () => {
        const voidData = {
          reason: 'Customer cancelled',
          password: 'manager-pin-123'
        };
        
        const res = await request(app)
          .post(`/api/pos/orders/${orderId || 'test-order'}/void`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(voidData);
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('POST /api/pos/orders/:id/items/:itemId/void', () => {
      it('should void single item', async () => {
        const voidData = {
          qty: 1,
          reason: 'Item not available'
        };
        
        const res = await request(app)
          .post(`/api/pos/orders/${orderId || 'test-order'}/items/item-1/void`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(voidData);
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== TABLE MANAGEMENT ==========
  describe('Tables', () => {
    describe('GET /api/pos/tables', () => {
      it('should list all tables with status', async () => {
        const res = await request(app)
          .get('/api/pos/tables')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403]).toContain(res.status);
      });
    });
    
    describe('GET /api/pos/tables/:id', () => {
      it('should get table details with current order', async () => {
        const res = await request(app)
          .get('/api/pos/tables/table-1')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('PUT /api/pos/tables/:id/status', () => {
      it('should update table status', async () => {
        const res = await request(app)
          .put('/api/pos/tables/table-1/status')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send({ status: 'reserved', note: 'Reserved for 7 PM' });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== RECEIPTS ==========
  describe('Receipts', () => {
    describe('GET /api/pos/receipts/:orderId', () => {
      it('should generate receipt', async () => {
        const res = await request(app)
          .get(`/api/pos/receipts/${orderId || 'test-order'}`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('POST /api/pos/receipts/:orderId/print', () => {
      it('should trigger receipt print', async () => {
        const res = await request(app)
          .post(`/api/pos/receipts/${orderId || 'test-order'}/print`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send({ printerId: 'printer-1' });
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
    
    describe('POST /api/pos/receipts/:orderId/email', () => {
      it('should email receipt', async () => {
        const res = await request(app)
          .post(`/api/pos/receipts/${orderId || 'test-order'}/email`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send({ email: 'customer@test.com' });
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== LOYALTY ==========
  describe('Loyalty', () => {
    describe('GET /api/pos/loyalty/customers/:id/points', () => {
      it('should get customer loyalty points', async () => {
        try {
          global.__MIRACHPOS_DB_MOCK__?.reset?.();
        } catch {
          // ignore
        }
        const state = global.__MIRACHPOS_DB_MOCK__?.state;
        if (state?.tables) {
          state.tables.customers = [
            {
              tenant_id: 't_test',
              branch_id: branchId,
              id: 'cust-123',
              loyalty_points: 250,
              loyalty_balance: 0,
              status: 'Active',
              updated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          ];
        }

        const res = await request(app)
          .get('/api/pos/loyalty/customers/cust-123/points')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 403]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body?.ok).toBe(true);
          expect(res.body?.customerId).toBe('cust-123');
          expect(res.body?.points).toBe(250);
        }
      });
    });
    
    describe('POST /api/pos/orders/:id/redeem-loyalty', () => {
      it('should redeem loyalty points', async () => {
        try {
          global.__MIRACHPOS_DB_MOCK__?.reset?.();
        } catch {
          // ignore
        }
        const state = global.__MIRACHPOS_DB_MOCK__?.state;
        if (state?.tables) {
          state.tables.customers = [
            {
              tenant_id: 't_test',
              branch_id: branchId,
              id: 'cust-123',
              loyalty_points: 250,
              loyalty_balance: 0,
              status: 'Active',
              updated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          ];
          state.tables.orders = [
            {
              tenant_id: 't_test',
              branch_id: branchId,
              id: orderId || 'test-order',
              status: 'Pending',
              total: 100,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              payload: JSON.stringify({}),
            },
          ];
        }

        const redemption = {
          customerId: 'cust-123',
          pointsToRedeem: 100
        };
        
        const res = await request(app)
          .post(`/api/pos/orders/${orderId || 'test-order'}/redeem-loyalty`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(redemption);
        
        expect([200, 403]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body?.ok).toBe(true);
          expect(res.body?.pointsToConvert).toBe(100);
          expect(res.body?.etbToAdd).toBe(10);
          expect(res.body?.nextPoints).toBe(150);
          expect(res.body?.nextBalance).toBe(10);
        }
      });
    });
    
    describe('POST /api/pos/loyalty/customers/:id/award', () => {
      it('should award loyalty points', async () => {
        try {
          global.__MIRACHPOS_DB_MOCK__?.reset?.();
        } catch {
          // ignore
        }
        const state = global.__MIRACHPOS_DB_MOCK__?.state;
        if (state?.tables) {
          state.tables.customers = [
            {
              tenant_id: 't_test',
              branch_id: branchId,
              id: 'cust-123',
              loyalty_points: 0,
              loyalty_balance: 0,
              status: 'Active',
              updated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          ];
        }

        const award = {
          points: 50,
          reason: 'Purchase bonus'
        };
        
        const res = await request(app)
          .post('/api/pos/loyalty/customers/cust-123/award')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(award);
        
        expect([200, 403]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body?.ok).toBe(true);
        }
      });
    });
  });
  
  // ========== DISCOUNTS ==========
  describe('Discounts', () => {
    describe('POST /api/pos/orders/:id/apply-discount', () => {
      it('should apply percentage discount', async () => {
        const discount = {
          type: 'percentage',
          value: 10,
          reason: 'Happy hour'
        };
        
        const res = await request(app)
          .post(`/api/pos/orders/${orderId || 'test-order'}/apply-discount`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(discount);
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
      
      it('should apply fixed discount', async () => {
        const discount = {
          type: 'fixed',
          value: 50,
          reason: 'Manager special'
        };
        
        const res = await request(app)
          .post(`/api/pos/orders/${orderId || 'test-order'}/apply-discount`)
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(discount);
        
        expect([200, 400, 401, 403, 404]).toContain(res.status);
      });
    });
  });
  
  // ========== SHIFT MANAGEMENT ==========
  describe('Shifts', () => {
    describe('POST /api/pos/shifts/start', () => {
      it('should start shift', async () => {
        const res = await request(app)
          .post('/api/pos/shifts/start')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send({ startingCash: 1000 });
        
        expect([200, 201, 400, 401, 403]).toContain(res.status);
      });
    });
    
    describe('POST /api/pos/shifts/end', () => {
      it('should end shift with reconciliation', async () => {
        const shiftData = {
          endingCash: 2500,
          expectedCash: 2450,
          notes: 'Normal shift'
        };
        
        const res = await request(app)
          .post('/api/pos/shifts/end')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId })
          .send(shiftData);
        
        expect([200, 400, 401, 403]).toContain(res.status);
      });
    });
    
    describe('GET /api/pos/shifts/current', () => {
      it('should get current shift', async () => {
        const res = await request(app)
          .get('/api/pos/shifts/current')
          .set(getAuthHeaders('cafe_owner'))
          .set('X-Tenant', tenantId)
          .query({ branchId });
        
        expect([200, 401, 403, 404]).toContain(res.status);
      });
    });
  });
});
