const request = require('supertest');
const { createApp } = require('../../src/app');

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
    
    it('should return 401 for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    });
    
    it('should return 401 for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'password123' });
      expect(res.status).toBe(401);
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
        .get('/api/owner/dashboard');
      expect(res.status).toBe(401);
    });
    
    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(401);
    });
    
    it('should return 401 with malformed header', async () => {
      const res = await request(app)
        .get('/api/owner/dashboard')
        .set('Authorization', 'invalid-header');
      expect(res.status).toBe(401);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should return 429 after too many failed login attempts', async () => {
      // Make multiple failed login attempts
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'test@test.com', password: 'wrong' });
      }
      
      // Next request should be rate limited
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: 'wrong' });
      
      expect(res.status).toBe(429);
    });
  });
});
