const jwt = require('jsonwebtoken');

// Use your actual JWT_SECRET from .env
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

// Test user payload
const payload = {
  tenantId: 't_test',
  role: 'Cafe Owner',
  staffId: 's_owner',
  branchId: 'b_1',
  email: 'owner@test.com',
  iat: Math.floor(Date.now() / 1000),
};

// Generate token
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

console.log('\n=== Generated Test Token ===\n');
console.log(token);
console.log('\n=== For Swagger UI ===\n');
console.log('bearerAuth: Bearer ' + token);
console.log('tenantHeader: test');
console.log('\n===========================\n');
