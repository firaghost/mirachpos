const jwt = require('jsonwebtoken');

// Test JWT secret (must match the one in test setup)
const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

// Test tenant and user fixtures
const TEST_TENANT = {
  id: 't_test',
  slug: 'test',
  name: 'Test Tenant',
  status: 'active',
};

const TEST_USER_CAFE_OWNER = {
  tenantId: 't_test',
  role: 'Cafe Owner',
  staffId: 's_owner',
  branchId: 'b_1',
  email: 'owner@test.com',
};

const TEST_USER_BRANCH_MANAGER = {
  tenantId: 't_test',
  role: 'Branch Manager',
  staffId: 's_manager',
  branchId: 'b_1',
  email: 'manager@test.com',
};

const TEST_USER_WAITER = {
  tenantId: 't_test',
  role: 'Waiter',
  staffId: 's_waiter',
  branchId: 'b_1',
  email: 'waiter@test.com',
};

const TEST_USER_SUPERADMIN = {
  tenantId: 'platform',
  role: 'Superadmin',
  staffId: 's_super',
  email: 'superadmin@test.com',
};

/**
 * Generate a valid JWT token for testing
 * @param {Object} payload - User payload
 * @returns {string} JWT token
 */
const generateTestToken = (payload) => {
  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });
};

/**
 * Get authorization header with valid test token
 * @param {string} role - User role (cafe_owner, branch_manager, waiter, superadmin)
 * @returns {Object} Headers object with Authorization
 */
const getAuthHeaders = (role = 'cafe_owner') => {
  let payload;
  switch (role) {
    case 'cafe_owner':
      payload = TEST_USER_CAFE_OWNER;
      break;
    case 'branch_manager':
      payload = TEST_USER_BRANCH_MANAGER;
      break;
    case 'waiter':
      payload = TEST_USER_WAITER;
      break;
    case 'superadmin':
      payload = TEST_USER_SUPERADMIN;
      break;
    default:
      payload = TEST_USER_CAFE_OWNER;
  }

  const token = generateTestToken(payload);
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant': TEST_TENANT.slug,
  };
};

/**
 * Get headers for unauthenticated requests
 * @returns {Object} Headers object with X-Tenant only
 */
const getUnauthenticatedHeaders = () => ({
  'X-Tenant': TEST_TENANT.slug,
});

const getSuperadminHeaders = (superadminId = 'sa_1') => {
  const token = generateTestToken({ kind: 'superadmin', superadminId, email: TEST_USER_SUPERADMIN.email });
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant': TEST_TENANT.slug,
  };
};

module.exports = {
  generateTestToken,
  getAuthHeaders,
  getSuperadminHeaders,
  getUnauthenticatedHeaders,
  TEST_TENANT,
  TEST_USER_CAFE_OWNER,
  TEST_USER_BRANCH_MANAGER,
  TEST_USER_WAITER,
  TEST_USER_SUPERADMIN,
  TEST_JWT_SECRET,
};
