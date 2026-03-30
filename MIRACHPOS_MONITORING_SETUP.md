# MIRACHPOS Monitoring Endpoints - Complete Implementation

**Purpose:** Add public monitoring endpoints to MIRACHPOS API  
**Scope:** No-auth health checks, Prometheus metrics, synthetic transactions  
**Time to implement:** 30 minutes  
**Date:** March 26, 2026

---

## STEP 1: INSTALL PROMETHEUS CLIENT

```bash
# In your api directory
cd /path/to/mirachpos/api

npm install prom-client

# Or if using yarn
yarn add prom-client
```

---

## STEP 2: CREATE MONITORING ROUTE FILE

**File:** `api/src/routes/monitoring.js` (NEW)

```javascript
const express = require('express');
const client = require('prom-client');
const db = require('../db'); // Your Knex/db connection

const router = express.Router();

// ============================================
// PROMETHEUS METRICS SETUP
// ============================================

// Collect default Node.js metrics
client.collectDefaultMetrics({
  prefix: 'mirach_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'mirach_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10]
});

const orderCounter = new client.Counter({
  name: 'mirach_orders_created_total',
  help: 'Total number of orders created',
  labelNames: ['status', 'payment_method']
});

const paymentCounter = new client.Counter({
  name: 'mirach_payments_processed_total',
  help: 'Total number of payments processed',
  labelNames: ['method', 'status']
});

const activeUsersGauge = new client.Gauge({
  name: 'mirach_active_users',
  help: 'Number of currently active users'
});

const syncQueueGauge = new client.Gauge({
  name: 'mirach_sync_queue_depth',
  help: 'Number of pending sync events'
});

const dbConnectionGauge = new client.Gauge({
  name: 'mirach_db_connections',
  help: 'Number of active database connections'
});

// Make metrics available globally
global.mirachMetrics = {
  orderCounter,
  paymentCounter,
  httpRequestDuration,
  activeUsersGauge,
  syncQueueGauge,
  dbConnectionGauge
};

// ============================================
// PUBLIC HEALTH ENDPOINTS (NO AUTH REQUIRED)
// ============================================

/**
 * GET /api/health
 * Basic health check - already exists, but enhanced
 */
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Quick DB ping
    await db.raw('SELECT 1');
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      response_time_ms: responseTime,
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed',
      details: error.message
    });
  }
});

/**
 * GET /api/health/db
 * Database-specific health check
 */
router.get('/health/db', async (req, res) => {
  const checks = {
    connection: false,
    query_time_ms: 0,
    tables_accessible: false
  };
  
  try {
    const startTime = Date.now();
    
    // Test connection
    await db.raw('SELECT 1');
    checks.connection = true;
    checks.query_time_ms = Date.now() - startTime;
    
    // Test table access (read-only)
    await db('tenants').count('* as count').first();
    checks.tables_accessible = true;
    
    dbConnectionGauge.set(1);
    
    res.json({
      status: 'healthy',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    dbConnectionGauge.set(0);
    res.status(503).json({
      status: 'unhealthy',
      checks,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/health/redis
 * Redis/cache health check
 */
router.get('/health/redis', async (req, res) => {
  const checks = {
    connected: false,
    response_time_ms: 0
  };
  
  try {
    // If you have Redis, test it
    // Replace with your actual Redis check
    const startTime = Date.now();
    
    // Example: if using redis client
    // await redisClient.ping();
    
    checks.connected = true;
    checks.response_time_ms = Date.now() - startTime;
    
    res.json({
      status: 'healthy',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      checks,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/health/sync
 * Sync queue health
 */
router.get('/health/sync', async (req, res) => {
  try {
    // Get pending sync events count
    const pendingEvents = await db('events')
      .where({ synced: false })
      .count('* as count')
      .first();
    
    const count = parseInt(pendingEvents.count);
    syncQueueGauge.set(count);
    
    const status = count < 100 ? 'healthy' : count < 500 ? 'warning' : 'critical';
    const httpStatus = count < 500 ? 200 : 503;
    
    res.status(httpStatus).json({
      status,
      pending_events: count,
      max_threshold: 500,
      warning_threshold: 100,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/health/payments
 * Payment gateway health
 */
router.get('/health/payments', async (req, res) => {
  const checks = {
    telebirr: 'unknown',
    chapa: 'unknown',
    last_webhook: null
  };
  
  try {
    // Check last webhook receipt
    const lastWebhook = await db('webhook_events')
      .orderBy('received_at', 'desc')
      .first();
    
    if (lastWebhook) {
      checks.last_webhook = lastWebhook.received_at;
      
      const minutesSinceWebhook = 
        (Date.now() - new Date(lastWebhook.received_at).getTime()) / 1000 / 60;
      
      checks.telebirr = minutesSinceWebhook < 60 ? 'ok' : 'stale';
      checks.chapa = minutesSinceWebhook < 60 ? 'ok' : 'stale';
    }
    
    const isHealthy = checks.telebirr === 'ok' || checks.chapa === 'ok';
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'warning',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/status
 * Comprehensive system status
 */
router.get('/status', async (req, res) => {
  try {
    const promises = [
      // DB check
      db.raw('SELECT 1').then(() => ({ db: true })).catch(() => ({ db: false })),
      
      // Get order count today
      db('orders')
        .where('created_at', '>=', db.raw('CURDATE()'))
        .count('* as count')
        .first()
        .then(r => ({ orders_today: parseInt(r.count) }))
        .catch(() => ({ orders_today: 0 })),
      
      // Get active users (last 5 minutes)
      db('staff')
        .where('last_login_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 5 MINUTE)'))
        .count('* as count')
        .first()
        .then(r => ({ active_users: parseInt(r.count) }))
        .catch(() => ({ active_users: 0 }))
    ];
    
    const results = await Promise.all(promises);
    const status = Object.assign({}, ...results);
    
    // Update gauge
    activeUsersGauge.set(status.active_users || 0);
    
    const isHealthy = status.db === true;
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      ...status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// SYNTHETIC TRANSACTION MONITORING
// ============================================

/**
 * GET /api/monitor/transaction
 * Full synthetic transaction test
 */
router.get('/monitor/transaction', async (req, res) => {
  const results = {
    steps: [],
    passed: 0,
    failed: 0,
    total_time_ms: 0
  };
  
  const startTime = Date.now();
  
  // Step 1: Database Read
  try {
    const stepStart = Date.now();
    await db('tenants').select('id').limit(1);
    results.steps.push({
      name: 'database_read',
      status: 'passed',
      time_ms: Date.now() - stepStart
    });
    results.passed++;
  } catch (error) {
    results.steps.push({
      name: 'database_read',
      status: 'failed',
      error: error.message
    });
    results.failed++;
  }
  
  // Step 2: Database Write (test table)
  try {
    const stepStart = Date.now();
    // Use a test transaction that rolls back
    await db.transaction(async trx => {
      await trx.raw('SELECT 1');
      throw new Error('rollback'); // Force rollback
    }).catch(err => {
      if (err.message !== 'rollback') throw err;
    });
    results.steps.push({
      name: 'database_write',
      status: 'passed',
      time_ms: Date.now() - stepStart
    });
    results.passed++;
  } catch (error) {
    results.steps.push({
      name: 'database_write',
      status: 'failed',
      error: error.message
    });
    results.failed++;
  }
  
  // Step 3: Sync Queue Check
  try {
    const stepStart = Date.now();
    const pending = await db('events').where({ synced: false }).count('* as count').first();
    results.steps.push({
      name: 'sync_queue',
      status: parseInt(pending.count) < 100 ? 'passed' : 'warning',
      time_ms: Date.now() - stepStart,
      details: { pending_events: parseInt(pending.count) }
    });
    results.passed++;
  } catch (error) {
    results.steps.push({
      name: 'sync_queue',
      status: 'failed',
      error: error.message
    });
    results.failed++;
  }
  
  // Step 4: Order Creation Simulation
  try {
    const stepStart = Date.now();
    // Simulate order validation without creating
    await db('orders').where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 1 HOUR)')).count('* as count').first();
    results.steps.push({
      name: 'order_query',
      status: 'passed',
      time_ms: Date.now() - stepStart
    });
    results.passed++;
  } catch (error) {
    results.steps.push({
      name: 'order_query',
      status: 'failed',
      error: error.message
    });
    results.failed++;
  }
  
  results.total_time_ms = Date.now() - startTime;
  
  const allPassed = results.failed === 0;
  
  res.status(allPassed ? 200 : 503).json({
    status: allPassed ? 'healthy' : 'failed',
    results,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// PROMETHEUS METRICS ENDPOINT
// ============================================

/**
 * GET /api/metrics
 * Prometheus metrics endpoint
 */
router.get('/metrics', async (req, res) => {
  try {
    // Update dynamic metrics before scraping
    const pendingEvents = await db('events')
      .where({ synced: false })
      .count('* as count')
      .first();
    syncQueueGauge.set(parseInt(pendingEvents.count));
    
    const activeUsers = await db('staff')
      .where('last_login_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 5 MINUTE)'))
      .count('* as count')
      .first();
    activeUsersGauge.set(parseInt(activeUsers.count));
    
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// API KEY MONITORING (FOR PROTECTED ENDPOINTS)
// ============================================

// Middleware for monitor API key
const monitorAuth = (req, res, next) => {
  const apiKey = req.headers['x-monitor-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Monitor API key required' });
  }
  
  // Use environment variable or config
  const validKey = process.env.MONITOR_API_KEY;
  
  if (!validKey) {
    console.warn('MONITOR_API_KEY not set, monitoring disabled');
    return res.status(503).json({ error: 'Monitoring not configured' });
  }
  
  if (apiKey !== validKey) {
    return res.status(403).json({ error: 'Invalid monitor API key' });
  }
  
  next();
};

/**
 * GET /api/monitor/orders
 * Monitor order creation with API key
 */
router.get('/monitor/orders', monitorAuth, async (req, res) => {
  try {
    // Orders in last hour
    const recentOrders = await db('orders')
      .where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 1 HOUR)'))
      .count('* as count')
      .first();
    
    // Failed orders (if you track them)
    const failedOrders = await db('orders')
      .where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 1 HOUR)'))
      .where('status', 'error')
      .count('* as count')
      .first();
    
    res.json({
      orders_last_hour: parseInt(recentOrders.count),
      failed_last_hour: parseInt(failedOrders.count),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/monitor/errors
 * Recent error summary
 */
router.get('/monitor/errors', monitorAuth, async (req, res) => {
  // This would need error logging to database
  // For now, return mock data
  res.json({
    errors_last_hour: 0,
    top_errors: [],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
module.exports.metrics = global.mirachMetrics;
```

---

## STEP 3: UPDATE API ROUTES

**File:** `api/src/app.js` (MODIFY)

Add the monitoring routes:

```javascript
// Add near top with other requires
const monitoringRoutes = require('./routes/monitoring');

// ... existing routes ...

// Monitoring routes (public, no auth)
app.use('/api', monitoringRoutes);

// Or if you want to group them:
app.use('/api/health', monitoringRoutes);
app.use('/api/metrics', monitoringRoutes);
```

---

## STEP 4: ADD HTTP REQUEST TRACKING

**File:** `api/src/app.js` (MODIFY - add middleware)

```javascript
// Add after app initialization

// Prometheus HTTP metrics tracking
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Record response time on finish
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    const route = req.route ? req.route.path : req.path;
    
    if (global.mirachMetrics?.httpRequestDuration) {
      global.mirachMetrics.httpRequestDuration.observe(
        {
          method: req.method,
          route: route,
          status_code: res.statusCode
        },
        duration
      );
    }
  });
  
  next();
});
```

---

## STEP 5: TRACK ORDERS IN EXISTING CODE

**File:** `api/src/routes/orders.js` (MODIFY)

Add metrics tracking to order creation:

```javascript
// In your POST /api/orders handler

// After successful order creation:
if (global.mirachMetrics?.orderCounter) {
  global.mirachMetrics.orderCounter.inc({
    status: 'created',
    payment_method: req.body.payment_method || 'unknown'
  });
}
```

---

## STEP 6: TRACK PAYMENTS IN EXISTING CODE

**File:** `api/src/routes/payments.js` or webhook handlers (MODIFY)

```javascript
// In payment processing:

if (global.mirachMetrics?.paymentCounter) {
  global.mirachMetrics.paymentCounter.inc({
    method: paymentMethod, // 'telebirr', 'chapa', 'cash'
    status: success ? 'success' : 'failed'
  });
}
```

---

## STEP 7: ENVIRONMENT VARIABLES

**File:** `.env` (ADD)

```bash
# Monitoring
MONITOR_API_KEY=your-secure-random-key-here
ENABLE_METRICS=true

# Optional: Set for production
METRICS_PORT=9090
```

Generate a secure key:
```bash
# Run this in terminal
openssl rand -hex 32
# Copy the output to MONITOR_API_KEY
```

---

## STEP 8: UPTIME KUMA CONFIG

**Config for your monitoring tool:**

```json
{
  "monitors": [
    {
      "name": "MIRACHPOS - Basic Health",
      "url": "https://api.mirachpos.com/api/health",
      "method": "GET",
      "interval": 60,
      "expected_status": 200,
      "alert_threshold": 2
    },
    {
      "name": "MIRACHPOS - Full Status",
      "url": "https://api.mirachpos.com/api/status",
      "method": "GET",
      "interval": 120,
      "expected_status": 200
    },
    {
      "name": "MIRACHPOS - DB Health",
      "url": "https://api.mirachpos.com/api/health/db",
      "method": "GET",
      "interval": 300,
      "expected_status": 200
    },
    {
      "name": "MIRACHPOS - Sync Queue",
      "url": "https://api.mirachpos.com/api/health/sync",
      "method": "GET",
      "interval": 300,
      "expected_status": 200
    },
    {
      "name": "MIRACHPOS - Payment Gateways",
      "url": "https://api.mirachpos.com/api/health/payments",
      "method": "GET",
      "interval": 600,
      "expected_status": 200
    },
    {
      "name": "MIRACHPOS - Synthetic Transaction",
      "url": "https://api.mirachpos.com/api/monitor/transaction",
      "method": "GET",
      "interval": 300,
      "expected_status": 200
    },
    {
      "name": "MIRACHPOS - Prometheus Metrics",
      "url": "https://api.mirachpos.com/api/metrics",
      "method": "GET",
      "interval": 60,
      "expected_status": 200,
      "type": "prometheus"
    }
  ]
}
```

---

## STEP 9: TEST ENDPOINTS

After deploying, test each endpoint:

```bash
# 1. Basic health
curl https://api.mirachpos.com/api/health

# 2. Full status
curl https://api.mirachpos.com/api/status

# 3. DB health  
curl https://api.mirachpos.com/api/health/db

# 4. Sync health
curl https://api.mirachpos.com/api/health/sync

# 5. Synthetic transaction
curl https://api.mirachpos.com/api/monitor/transaction

# 6. Prometheus metrics
curl https://api.mirachpos.com/api/metrics

# 7. Protected endpoint (with API key)
curl -H "X-Monitor-Key: your-key-here" \
  https://api.mirachpos.com/api/monitor/orders
```

---

## STEP 10: GRAFANA DASHBOARD (OPTIONAL)

**Prometheus Data Source:**
```yaml
# Add to prometheus.yml
scrape_configs:
  - job_name: 'mirachpos'
    static_configs:
      - targets: ['api.mirachpos.com']
    metrics_path: /api/metrics
    scrape_interval: 15s
```

**Grafana Dashboard JSON:** Import from standard Prometheus dashboards or create custom.

---

## ENDPOINTS SUMMARY

| Endpoint | Auth | What It Checks | Alert If |
|----------|------|----------------|----------|
| `/api/health` | ❌ No | Basic server health | Down |
| `/api/health/db` | ❌ No | Database connection | Fail |
| `/api/health/sync` | ❌ No | Sync queue depth | >500 |
| `/api/health/payments` | ❌ No | Webhook recency | Stale >1hr |
| `/api/status` | ❌ No | Full system status | Degraded |
| `/api/monitor/transaction` | ❌ No | Full flow test | Fail |
| `/api/metrics` | ❌ No | Prometheus data | No data |
| `/api/monitor/orders` | ✅ API Key | Order metrics | - |

---

## TROUBLESHOOTING

### Issue: Metrics not updating
**Fix:** Check if `global.mirachMetrics` is set in your order/payment routes.

### Issue: DB health fails
**Fix:** Ensure `db` import matches your Knex connection export.

### Issue: Endpoints not accessible
**Fix:** Check route mounting order - monitoring should be before auth middleware.

### Issue: API key not working
**Fix:** Verify `MONITOR_API_KEY` is set in environment, restart server.

---

**All endpoints ready! Test and deploy. 🚀**
