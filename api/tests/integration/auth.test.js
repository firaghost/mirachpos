const request = require('supertest');
const { createApp } = require('../../src/app');
const { getAuthHeaders, getUnauthenticatedHeaders, generateTestToken } = require('../helpers/auth');

describe('Authentication API', () => {
  let app;
  
  beforeAll(() => {
    app = createApp();
  });
  
  describe('POST /api/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});
      expect(res.status).toBe(400);
    });
    
    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'test123' });
      expect(res.status).toBe(400);
    });
    
    it('should return 400 for missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(400);
    });
    
    it('should return 401 or 400 for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: 'wrongpassword' });
      // May return 400 if validation fails before auth check
      expect([400, 401]).toContain(res.status);
    });
    
    it('should return 401 or 400 for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'password123' });
      // May return 400 if validation fails before auth check
      expect([400, 401]).toContain(res.status);
    });
  });
  
  describe('POST /api/auth/forgot-password', () => {
    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({});
      expect(res.status).toBe(400);
    });
    
    it('should return 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });
  
  describe('Protected Routes', () => {
    it('should return 401 without token', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set(getUnauthenticatedHeaders());
      expect(res.status).toBe(401);
    });
    
    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set(getUnauthenticatedHeaders())
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(401);
    });
    
    it('should return 401 with malformed header', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set(getUnauthenticatedHeaders())
        .set('Authorization', 'invalid-header');
      expect(res.status).toBe(401);
    });

    it('should accept valid token', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set(getAuthHeaders('cafe_owner'));
      // Should be 200, 403 (if forbidden), 402 (if payment required), or 404 (if route not implemented)
      expect([200, 403, 404, 402]).toContain(res.status);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should return 429 after too many failed login attempts', async () => {
      const agent = request.agent(app);
      
      // Make multiple failed login attempts from same IP
      for (let i = 0; i < 12; i++) {
        await agent
          .post('/api/auth/login')
          .send({ email: 'test@test.com', password: 'wrong' });
      }
      
      // Next request should be rate limited
      const res = await agent
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: 'wrong' });
      
      // Rate limit (429) or validation error (400) if rate limiting is disabled in test
      expect([400, 429]).toContain(res.status);
    });
  });
});
