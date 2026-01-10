# Complete POS System Implementation Guide & Production Readiness Framework

## Table of Contents
1. POS Architecture Reference
2. Security Implementation Standards
3. Code Review Checklist
4. Database Design Patterns
5. API Security Framework
6. Payment Processing Pipeline
7. Testing Strategy
8. Deployment Verification

---

## 1. POS System Architecture Reference

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CLIENT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ POS Terminal │  │ Mobile Order │  │ Web Admin    │      │
│  │ (Touch UI)   │  │ (Tablet)     │  │ Dashboard    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │ HTTPS/TLS
┌────────────────────────────┴─────────────────────────────────┐
│                   API GATEWAY LAYER                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Authentication │ Rate Limiting │ Validation │ Logging │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────┬──────────────┬──────────────┬──────────────────┘
             │              │              │
┌────────────┴──┐  ┌────────┴─────┐  ┌────┴─────────────────┐
│ ORDER SERVICE │  │PAYMENT SERVICE│  │INVENTORY SERVICE    │
│ ┌──────────────┤  ├──────────────┤  ├─────────────────────┤
│ │Order Mgmt    │  │Payment Proc  │  │Stock Tracking       │
│ │KDS Integration│ │Gateway Int   │  │Real-Time Sync       │
│ │Delivery Mgmt  │  │Refunds       │  │Location Mgmt        │
│ └──────────────┘  └──────────────┘  └─────────────────────┘
└─────────┬────────────────┬────────────────┬─────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
┌──────────────────────────┴─────────────────────────────────┐
│              DATA PERSISTENCE LAYER                        │
│  ┌─────────────────────┐      ┌──────────────────────────┐ │
│  │   PRIMARY DB        │      │ CACHE LAYER (Redis)     │ │
│  │ (Transactions,      │      │ (Session, Inventory,    │ │
│  │  Orders, Payments)  │      │  Analytics)             │ │
│  └─────────────────────┘      └──────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ EXTERNAL INTEGRATIONS                                  │ │
│  │ Payment Gateway │ Supplier APIs │ Delivery Platforms   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Components Definition

**Payment Service**: Handles all payment transactions
- Accepts payment requests from orders
- Communicates with payment gateway
- Manages idempotency for duplicate prevention
- Logs all payment attempts
- Handles refunds and reversals

**Order Service**: Manages order lifecycle
- Creates, modifies, cancels orders
- Communicates with KDS (Kitchen Display System)
- Integrates with delivery platforms
- Manages table reservations
- Tracks order status

**Inventory Service**: Real-time stock management
- Updates stock levels on each sale
- Prevents overselling
- Synchronizes across locations
- Manages automatic ordering
- Tracks food cost and waste

**User Service**: Authentication and authorization
- User registration and login
- Role management (Cashier, Manager, Admin)
- Permission enforcement
- Session management
- Audit logging

---

## 2. Security Implementation Standards

### 2.1 Encryption Requirements

**In Transit (HTTPS/TLS)**
```
Requirements:
- TLS 1.2 minimum (1.3 preferred)
- AES-256 cipher suites
- Perfect Forward Secrecy (ECDHE)
- Certificate from trusted CA
- HSTS enabled (min-age: 31536000)
- Certificate pinning for critical endpoints
```

**At Rest (Database)**
```
Requirements:
- AES-256 encryption at disk level
- Encryption keys separate from encrypted data
- Key rotation every 90 days
- Key management system (AWS KMS, HashiCorp Vault)
- Never store encryption keys in code
```

**Payment Data Specific**
```
Requirements:
- End-to-end encryption from terminal to processor
- Tokenization immediately upon receipt
- Never store raw card data (PCI violation)
- Never log card data in any form
- Use point-to-point encryption if storing temporarily
```

### 2.2 Authentication Framework

**Multi-Factor Authentication**
```javascript
// Example: JWT + TOTP Implementation
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');

async function authenticate(username, password, totpCode) {
  // Step 1: Verify password
  const user = await User.findByUsername(username);
  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    // Use constant-time comparison to prevent timing attacks
    await fakeDelayFor(100);
    throw new Error('Invalid credentials');
  }
  
  // Step 2: Verify TOTP (if enabled)
  if (user.mfaEnabled) {
    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 2 // Allow 30 seconds drift
    });
    if (!verified) throw new Error('Invalid TOTP code');
  }
  
  // Step 3: Generate JWT
  const token = jwt.sign(
    { 
      userId: user.id, 
      role: user.role,
      permissions: user.permissions 
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: '15m', // Short-lived tokens
      algorithm: 'HS256'
    }
  );
  
  // Step 4: Return refresh token separately
  const refreshToken = generateSecureToken(32);
  await saveRefreshToken(user.id, refreshToken);
  
  return { accessToken: token, refreshToken };
}
```

### 2.3 Authorization (Role-Based Access Control)

```javascript
// RBAC Implementation
const permissions = {
  'CASHIER': ['process_payment', 'view_order', 'print_receipt'],
  'MANAGER': ['view_reports', 'manage_staff', 'handle_refunds', 'view_inventory'],
  'ADMIN': ['manage_users', 'system_config', 'financial_reports', 'audit_logs'],
  'KITCHEN': ['view_orders', 'update_order_status', 'manage_ingredients']
};

async function authorize(userId, requiredPermission) {
  const user = await User.findById(userId);
  const userPermissions = permissions[user.role];
  
  if (!userPermissions.includes(requiredPermission)) {
    // Log security event
    await AuditLog.create({
      userId,
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      resource: requiredPermission,
      timestamp: new Date(),
      ipAddress: getClientIP(),
      result: 'DENIED'
    });
    throw new Error('Unauthorized');
  }
  
  return true;
}
```

### 2.4 Secrets Management

```yaml
# NEVER do this:
DATABASE_URL: "postgresql://user:password@host:5432/db"
API_KEY: "sk_live_abc123xyz"
JWT_SECRET: "my-super-secret-key"

# DO this instead:
# Use environment variables from secrets manager
Environment: Production
SecretsManager: AWS Secrets Manager | HashiCorp Vault

Rotation Policy:
  - API Keys: Every 90 days
  - Database Passwords: Every 45 days
  - Encryption Keys: Every 90 days
  - JWT Secrets: On every deployment
```

---

## 3. Code Review Checklist

### 3.1 Security Checklist

- [ ] No hard-coded secrets or credentials
- [ ] SQL queries use parameterized statements
- [ ] Input validation on all user-facing endpoints
- [ ] Output encoding to prevent XSS attacks
- [ ] CSRF tokens on all state-changing operations
- [ ] Authentication required before sensitive operations
- [ ] Authorization checked with principle of least privilege
- [ ] Sensitive data not logged (passwords, tokens, card data)
- [ ] Error messages don't expose internal details
- [ ] API rate limiting configured
- [ ] CORS headers appropriately restricted
- [ ] Encryption used for sensitive data in transit
- [ ] File uploads validated (type, size, virus scanned)
- [ ] No use of deprecated security functions
- [ ] Dependencies regularly updated
- [ ] Security headers configured (CSP, HSTS, X-Frame-Options)
- [ ] Session cookies use HttpOnly and Secure flags
- [ ] Password policies enforced (minimum length, complexity)

### 3.2 Data Integrity Checklist

- [ ] ACID properties properly utilized in transactions
- [ ] Idempotency keys implemented for payment operations
- [ ] Database constraints enforce business rules
- [ ] Foreign keys prevent orphaned records
- [ ] Unique constraints prevent duplicates
- [ ] Not null constraints on required fields
- [ ] Check constraints enforce valid values
- [ ] Concurrent access properly handled (locks/transactions)
- [ ] No race conditions in critical sections
- [ ] Transaction rollback on errors
- [ ] Inventory updates prevent negative quantities
- [ ] Payment amounts validated before processing

### 3.3 Performance Checklist

- [ ] Database queries have appropriate indexes
- [ ] N+1 query problems identified and fixed
- [ ] Caching strategy implemented for frequent data
- [ ] Long-running operations are asynchronous
- [ ] Connection pooling configured for database
- [ ] API response times within acceptable range (<200ms)
- [ ] Database query times optimized
- [ ] Memory leaks tested and resolved
- [ ] Pagination implemented for large datasets
- [ ] Database statistics regularly updated

### 3.4 Code Quality Checklist

- [ ] Code follows project style guide
- [ ] Functions have single responsibility
- [ ] Method/function names are clear and descriptive
- [ ] Complex logic is documented with comments
- [ ] Dead code removed
- [ ] DRY principle followed (no code duplication)
- [ ] Error handling is comprehensive
- [ ] Logging is appropriate and useful
- [ ] Tests cover critical paths
- [ ] README is up to date

---

## 4. Database Design Patterns

### 4.1 Transactions Table (Core)

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identification
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  
  -- Payment Details
  amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(50) NOT NULL, -- 'card', 'cash', 'mobile_wallet'
  
  -- Status Tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, authorized, captured, settled, failed, refunded
  status_reason TEXT,
  
  -- Idempotency (Critical for duplicate prevention)
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  request_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Payment Processor Reference
  processor_transaction_id VARCHAR(255),
  processor_response_code VARCHAR(50),
  processor_response_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorized_at TIMESTAMP,
  settled_at TIMESTAMP,
  failed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Audit Trail
  ip_address INET,
  user_agent TEXT,
  
  CONSTRAINT valid_status CHECK (status IN ('pending', 'authorized', 'captured', 'settled', 'failed', 'refunded')),
  CONSTRAINT valid_payment_method CHECK (payment_method IN ('card', 'cash', 'mobile_wallet'))
);

-- Critical indexes
CREATE INDEX idx_transactions_order_id ON transactions(order_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_idempotency ON transactions(idempotency_key);
```

### 4.2 Inventory Table with Concurrency Control

```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  
  -- Inventory State
  quantity_on_hand INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved INT NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  quantity_available INT GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  
  -- Reorder Logic
  reorder_point INT NOT NULL DEFAULT 10,
  reorder_quantity INT NOT NULL DEFAULT 50,
  
  -- Concurrency Control (Optimistic Locking)
  version INT NOT NULL DEFAULT 1,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync TIMESTAMP,
  
  CONSTRAINT positive_quantities CHECK (quantity_on_hand >= 0 AND quantity_reserved >= 0),
  CONSTRAINT reorder_logic CHECK (reorder_point > 0),
  UNIQUE(menu_item_id, location_id)
);

-- Concurrency example: Update with version check
-- UPDATE inventory 
-- SET quantity_on_hand = quantity_on_hand - 1, 
--     version = version + 1,
--     last_updated = CURRENT_TIMESTAMP
-- WHERE menu_item_id = $1 AND location_id = $2 
--   AND quantity_on_hand > 0
--   AND version = $3
-- RETURNING *;
```

### 4.3 Idempotency Tracking

```sql
CREATE TABLE idempotency_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Request Identity
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  request_path VARCHAR(255) NOT NULL,
  
  -- Response Cache
  response_code INT,
  response_body JSONB,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',
  
  CONSTRAINT valid_code CHECK (response_code >= 200 AND response_code < 600)
);

-- Cleanup expired entries (run periodically)
-- DELETE FROM idempotency_store 
-- WHERE expires_at < CURRENT_TIMESTAMP;

CREATE INDEX idx_idempotency_key ON idempotency_store(idempotency_key);
CREATE INDEX idx_idempotency_expires ON idempotency_store(expires_at);
```

### 4.4 Audit Log Table

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Actor
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_role VARCHAR(50),
  
  -- Action Details
  action VARCHAR(100) NOT NULL, -- 'CREATE_ORDER', 'PROCESS_PAYMENT', etc.
  resource_type VARCHAR(50) NOT NULL, -- 'ORDER', 'TRANSACTION', 'INVENTORY'
  resource_id UUID,
  
  -- Changes
  old_values JSONB,
  new_values JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  -- Status
  status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED', 'DENIED'
  status_reason TEXT,
  
  -- Timestamp
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_action CHECK (action IN ('CREATE_ORDER', 'PROCESS_PAYMENT', 'REFUND', 'UPDATE_INVENTORY', 'DELETE_USER'))
);

CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
```

---

## 5. API Security Framework

### 5.1 API Endpoint Security Layers

```javascript
// Middleware stack for API security
const apiSecurityStack = [
  // 1. HTTPS enforcement
  enforceHttps,
  
  // 2. Request validation
  validateContentType,
  validatePayloadSize,
  
  // 3. Authentication
  authenticateRequest, // JWT validation
  
  // 4. Authorization
  authorizePermission,
  
  // 5. Rate limiting
  rateLimitByUser,
  rateLimitByIP,
  
  // 6. Input validation
  validateRequestBody,
  validatePathParameters,
  validateQueryParameters,
  
  // 7. Business logic handler
  handleRequest,
  
  // 8. Response filtering
  filterSensitiveData,
  
  // 9. Logging
  logSecurityEvent
];

// Endpoint definition example
router.post('/api/v1/transactions/process',
  ...apiSecurityStack,
  async (req, res) => {
    // All security checks have passed
    const { orderId, amount, paymentMethod } = req.body;
    const transaction = await processPayment(orderId, amount, paymentMethod);
    res.json({ success: true, transactionId: transaction.id });
  }
);
```

### 5.2 Input Validation Framework

```javascript
// Validation schema example
const transactionSchema = {
  orderId: {
    type: 'uuid',
    required: true
  },
  amount: {
    type: 'number',
    required: true,
    min: 0.01,
    max: 9999999.99,
    precision: 2
  },
  paymentMethod: {
    type: 'enum',
    required: true,
    values: ['card', 'cash', 'mobile_wallet']
  },
  idempotencyKey: {
    type: 'string',
    required: true,
    pattern: /^[a-f0-9-]{36}$/,
    maxLength: 255
  }
};

// Validation function
async function validateInput(data, schema) {
  const errors = [];
  
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    
    // Check required
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${field} is required`);
      continue;
    }
    
    if (value === undefined || value === null) continue;
    
    // Type validation
    if (rules.type === 'number' && typeof value !== 'number') {
      errors.push(`${field} must be a number`);
    }
    
    // Range validation
    if (rules.min && value < rules.min) {
      errors.push(`${field} must be >= ${rules.min}`);
    }
    
    if (rules.max && value > rules.max) {
      errors.push(`${field} must be <= ${rules.max}`);
    }
    
    // Enum validation
    if (rules.values && !rules.values.includes(value)) {
      errors.push(`${field} must be one of: ${rules.values.join(', ')}`);
    }
  }
  
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  
  return true;
}
```

### 5.3 Error Handling (Secure)

```javascript
// NEVER expose internal details
const UNSAFE_RESPONSES = {
  // ❌ Bad
  'Database error: table users does not exist',
  'Stack trace: at DatabaseConnection.query (db.js:123)',
  'Password hash salt value: $2b$10$...'
};

const SAFE_RESPONSES = {
  // ✅ Good
  'An error occurred while processing your request',
  'Invalid payment details provided',
  'Order not found or access denied'
};

// Secure error handler
function handleError(error, req, res, next) {
  // Log full error internally
  logger.error({
    message: error.message,
    stack: error.stack,
    userId: req.user?.id,
    endpoint: req.path,
    timestamp: new Date()
  });
  
  // Return safe error to client
  let statusCode = 500;
  let message = 'An error occurred while processing your request';
  
  if (error instanceof ValidationError) {
    statusCode = 400;
    message = 'Invalid input provided';
  } else if (error instanceof AuthenticationError) {
    statusCode = 401;
    message = 'Authentication failed';
  } else if (error instanceof AuthorizationError) {
    statusCode = 403;
    message = 'Access denied';
  } else if (error instanceof NotFoundError) {
    statusCode = 404;
    message = 'Resource not found';
  }
  
  res.status(statusCode).json({
    error: message,
    requestId: req.id // For support reference
  });
}
```

---

## 6. Payment Processing Pipeline

### 6.1 Payment Processing Flow with Idempotency

```javascript
async function processPayment(orderData) {
  const idempotencyKey = generateUUID();
  
  try {
    // Step 1: Check if already processed (idempotency)
    const existingTransaction = await checkIdempotencyStore(idempotencyKey);
    if (existingTransaction) {
      return existingTransaction;
    }
    
    // Step 2: Create database transaction
    const transaction = await db.transaction(async (trx) => {
      // 2a: Lock and validate order
      const order = await trx('orders')
        .where({ id: orderData.orderId })
        .forUpdate() // Pessimistic lock
        .first();
      
      if (!order) throw new NotFoundError('Order not found');
      if (order.total !== orderData.amount) {
        throw new PaymentError('Amount mismatch');
      }
      
      // 2b: Create transaction record
      const paymentTransaction = await trx('transactions').insert({
        order_id: order.id,
        user_id: orderData.userId,
        amount: orderData.amount,
        payment_method: orderData.paymentMethod,
        idempotency_key: idempotencyKey,
        status: 'pending',
        request_timestamp: new Date()
      }).returning('*');
      
      // 2c: Call payment gateway
      const gatewayResponse = await callPaymentGateway({
        amount: orderData.amount,
        currency: 'USD',
        idempotencyKey: idempotencyKey, // Pass to gateway too
        method: orderData.paymentMethod
      });
      
      // 2d: Update transaction with gateway response
      await trx('transactions')
        .where({ id: paymentTransaction.id })
        .update({
          status: gatewayResponse.success ? 'authorized' : 'failed',
          processor_transaction_id: gatewayResponse.transactionId,
          processor_response_code: gatewayResponse.code,
          processor_response_message: gatewayResponse.message,
          authorized_at: gatewayResponse.success ? new Date() : null
        });
      
      // 2e: Update order status if successful
      if (gatewayResponse.success) {
        await trx('orders')
          .where({ id: order.id })
          .update({ status: 'payment_confirmed' });
      }
      
      return paymentTransaction;
    });
    
    // Step 3: Store in idempotency cache
    await storeIdempotencyResult(idempotencyKey, transaction);
    
    // Step 4: Log audit trail
    await logAudit({
      userId: orderData.userId,
      action: 'PROCESS_PAYMENT',
      resourceType: 'TRANSACTION',
      resourceId: transaction.id,
      newValues: transaction,
      status: 'SUCCESS'
    });
    
    return transaction;
    
  } catch (error) {
    // Log the error
    await logAudit({
      userId: orderData.userId,
      action: 'PROCESS_PAYMENT',
      resourceType: 'TRANSACTION',
      statusReason: error.message,
      status: 'FAILED'
    });
    
    throw error;
  }
}
```

### 6.2 Retry Logic with Exponential Backoff

```javascript
async function paymentRetryWithBackoff(orderData, maxRetries = 3) {
  const idempotencyKey = generateUUID();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await processPayment({
        ...orderData,
        idempotencyKey // Same key for all retries
      });
      
    } catch (error) {
      // Log retry attempt
      logger.warn(`Payment retry ${attempt}/${maxRetries}`, {
        orderId: orderData.orderId,
        error: error.message
      });
      
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      
      // Calculate backoff: 1s, 2s, 4s
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      await delay(backoffMs);
    }
  }
}
```

---

## 7. Testing Strategy

### 7.1 Security Testing Scenarios

```javascript
// Example: Payment idempotency test
describe('Payment Idempotency', () => {
  it('should process payment once despite multiple requests', async () => {
    const idempotencyKey = 'test-key-12345';
    const paymentData = {
      orderId: 'order-123',
      amount: 100.00,
      paymentMethod: 'card'
    };
    
    // First request
    const response1 = await processPayment({
      ...paymentData,
      idempotencyKey
    });
    
    // Second request with same idempotency key
    const response2 = await processPayment({
      ...paymentData,
      idempotencyKey
    });
    
    // Should return same result
    expect(response1.id).to.equal(response2.id);
    
    // Should only have one transaction in database
    const transactions = await db('transactions')
      .where({ idempotency_key: idempotencyKey });
    expect(transactions).to.have.lengthOf(1);
  });
});

// Example: SQL Injection prevention test
describe('SQL Injection Prevention', () => {
  it('should safely handle malicious input', async () => {
    const maliciousInput = "'; DROP TABLE users; --";
    
    const response = await api.post('/orders', {
      customerId: maliciousInput,
      items: []
    });
    
    expect(response.status).to.equal(400); // Validation error
    
    // Verify data integrity
    const usersTable = await db.raw("SELECT COUNT(*) FROM users");
    expect(usersTable.rows[0].count).to.be.greaterThan(0);
  });
});

// Example: Inventory race condition test
describe('Concurrent Inventory Updates', () => {
  it('should prevent overselling with concurrent requests', async () => {
    // Setup: 2 units available
    await updateInventory('item-1', { quantity: 2 });
    
    // Simulate 3 concurrent purchase requests
    const promises = [
      purchaseItem('item-1', 1),
      purchaseItem('item-1', 1),
      purchaseItem('item-1', 1)
    ];
    
    const results = await Promise.allSettled(promises);
    
    // Only 2 should succeed, 1 should fail
    const successful = results.filter(r => r.status === 'fulfilled').length;
    expect(successful).to.equal(2);
    
    // Verify inventory is correct
    const inventory = await getInventory('item-1');
    expect(inventory.quantity).to.equal(0);
  });
});
```

### 7.2 Load Testing Script

```bash
#!/bin/bash
# Load testing for peak hour scenario

# 100 concurrent transactions
ab -n 100 -c 100 -p transaction_payload.json \
   -H "Authorization: Bearer $JWT_TOKEN" \
   https://api.pos.example.com/api/v1/transactions/process

# Monitor database connections
watch -n 1 'psql -c "SELECT count(*) as connections FROM pg_stat_activity;"'

# Monitor API response times
ab -n 1000 -c 50 -g results.tsv \
   https://api.pos.example.com/health
```

---

## 8. Deployment Verification

### 8.1 Pre-Production Checklist

```yaml
Security Verification:
  - [ ] No hard-coded secrets found in codebase
  - [ ] All dependencies up-to-date and scanned
  - [ ] PCI DSS compliance verified
  - [ ] Encryption in transit (TLS 1.2+) enabled
  - [ ] Encryption at rest (AES-256) enabled
  - [ ] Database credentials in secrets manager
  - [ ] API keys rotated
  - [ ] Security headers configured
  - [ ] CORS properly restricted
  - [ ] Rate limiting enabled
  - [ ] DDoS protection configured

Database Verification:
  - [ ] Database backups automated and tested
  - [ ] Connection pooling configured
  - [ ] Indexes created on all foreign keys
  - [ ] Query performance tested
  - [ ] Data migration script tested
  - [ ] Rollback procedure documented
  - [ ] Monitoring alerts configured

Application Verification:
  - [ ] Error handling tested
  - [ ] Logging properly configured
  - [ ] Health check endpoint working
  - [ ] Metrics collection working
  - [ ] Performance acceptable (<200ms p95)
  - [ ] Memory leaks tested
  - [ ] Database connection leaks tested

Operational Readiness:
  - [ ] Incident response plan documented
  - [ ] On-call rotation established
  - [ ] Monitoring dashboards created
  - [ ] Alerting thresholds set
  - [ ] Runbook created
  - [ ] Deployment procedure documented
  - [ ] Rollback procedure documented
  - [ ] Support team trained
```

### 8.2 Monitoring & Alerting Setup

```yaml
Key Metrics:
  - API Response Time (p50, p95, p99)
  - Error Rate (5xx, 4xx)
  - Payment Success Rate
  - Database Query Time
  - Transaction Throughput
  - Queue Depth (if using message queues)
  - Cache Hit Rate
  - Memory Usage
  - Disk Usage

Alerting Rules:
  - Error rate > 1% → Page on-call
  - Payment failures > 5 in 5min → Page on-call
  - Database query time > 500ms (p95) → Alert
  - API response time > 500ms (p95) → Alert
  - Memory usage > 80% → Alert
  - Disk usage > 85% → Alert
  - Failed login attempts > 10 in 5min → Alert
```

---

## Summary

This document provides a comprehensive framework for building, securing, and deploying a production-grade POS system. The key principles are:

1. **Security First**: Implement PCI DSS compliance, encryption, and proper authentication
2. **Data Integrity**: Use ACID transactions and idempotency keys
3. **Scalability**: Design for real-time inventory sync and concurrent transactions
4. **Reliability**: Implement proper error handling and retry logic
5. **Auditability**: Log all financial transactions immutably
6. **Testing**: Verify security, performance, and business logic
7. **Monitoring**: Track system health and security events continuously

Use the AI code analysis prompt provided separately to systematically review your codebase against these standards before production deployment.
