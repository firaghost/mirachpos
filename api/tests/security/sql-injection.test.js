const request = require('supertest');
const { createApp } = require('../../src/app');

describe('SQL Injection Prevention', () => {
  let app;
  
  beforeAll(() => {
    app = createApp();
  });
  
  const maliciousInputs = [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "1; DELETE FROM orders WHERE '1'='1",
    "' UNION SELECT * FROM passwords --",
    "test@test.com'--",
    "admin'--",
    "1' OR 1=1 LIMIT 1--",
    "' OR '1'='1' /*",
    "'; EXEC xp_cmdshell('dir'); --"
  ];
  
  it('should sanitize user input in login queries', async () => {
    for (const input of maliciousInputs) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: input, password: 'test' });
      
      // Should not crash or return unexpected data
      expect([400, 401, 429]).toContain(res.status);
    }
  });
  
  it('should sanitize password field', async () => {
    for (const input of maliciousInputs) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: input });
      
      expect([400, 401, 429]).toContain(res.status);
    }
  });
  
  it('should not expose database errors', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ 
        email: "test'; SELECT * FROM users--", 
        password: 'test' 
      });
    
    // Should not contain SQL error messages
    expect(res.body.error).not.toMatch(/sql/i);
    expect(res.body.error).not.toMatch(/syntax/i);
  });
});
