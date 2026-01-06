const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { config } = require('./config');
const { isAllowedOrigin } = require('./utils/cors');
const { logger, requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/errors');
const { requestIdMiddleware, addRequestIdToResponse } = require('./middleware/requestId');
const { globalLimiter, authLimiter } = require('./middleware/rateLimiter');

// Route imports
const { makeAdminRouter } = require('./routes/admin');
const { makeAuthRouter } = require('./routes/auth');
const { makeBranchesRouter } = require('./routes/branches');
const { makePublicRouter } = require('./routes/public');
const { makeOwnerRouter } = require('./routes/owner');
const { makeOwnerStaffRouter } = require('./routes/ownerStaff');
const { makeSupportRouter } = require('./routes/support');
const { makeManagerRouter } = require('./routes/manager');
const { makeSubscriptionRouter } = require('./routes/subscription');
const { makeSuperadminAuthRouter } = require('./routes/superadminAuth');
const { makeSuperadminRouter } = require('./routes/superadmin');
const { makeAdminMetricsRouter } = require('./routes/adminMetrics');
const { makeScheduleRouter } = require('./routes/schedule');
const { makeSyncRouter } = require('./routes/sync');
const { makeWaiterRouter } = require('./routes/waiter');
const { makeStaffRouter } = require('./routes/staff');
const { makeManagerStaffRouter } = require('./routes/managerStaff');
const { makeAuditRouter } = require('./routes/audit');
const { makePosRouter } = require('./routes/pos');
const { makePosCustomersRouter } = require('./routes/posCustomers');
const { makeInventoryRouter } = require('./routes/inventory');
const { makeGuestsRouter } = require('./routes/guests');
const { makeManagerFinanceRouter } = require('./routes/managerFinance');
const { makeManagerMenuRouter } = require('./routes/managerMenu');
const { makeManagerSuppliersRouter } = require('./routes/managerSuppliers');
const { makeManagerAuditRouter } = require('./routes/managerAudit');
const { makeManagerPaymentsRouter } = require('./routes/managerPayments');
const { makeManagerCustomersRouter } = require('./routes/managerCustomers');
const { makeEnhancedReportsRouter } = require('./routes/enhancedReports');
const { makeManagerPrintRouter } = require('./routes/managerPrint');
const { makeTelebirrStandingOrderRouter } = require('./routes/telebirrStandingOrder');


const createApp = () => {
  const app = express();

  // ==========================================================================
  // SECURITY MIDDLEWARE (Order matters!)
  // ==========================================================================

  // Disable x-powered-by header
  app.disable('x-powered-by');

  // Request ID generation (first, for tracing)
  app.use(requestIdMiddleware);
  app.use(addRequestIdToResponse);

  // Security headers with enhanced configuration
  app.use(
    helmet({
      contentSecurityPolicy: false, // API server, not needed
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Request body parsing with size limit
  app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // For webhook signature verification
    }
  }));

  // CORS configuration
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.corsOrigins)),
      credentials: true,
    }),
  );

  // Structured request logging
  app.use(requestLogger);

  // Global rate limiting (100 req/min)
  app.use('/api', globalLimiter);

  // Remove CSP headers (API server noise reduction)
  app.use((req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    next();
  });

  // ==========================================================================
  // HEALTH & STATIC ROUTES (No rate limiting)
  // ==========================================================================

  app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send('{}');
  });

  app.get('/', (_req, res) => res.json({ ok: true, name: 'mirachpos-api' }));

  app.get('/health', async (_req, res) => {
    let dbStatus = 'unknown';
    try {
      await require('./db').db().raw('SELECT 1');
      dbStatus = 'up';
    } catch (e) {
      dbStatus = 'down';
    }

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
    });
  });

  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // ==========================================================================
  // WEBHOOKS (No auth, special handling)
  // ==========================================================================

  const { makeWebhookRouter } = require('./routes/webhook');
  app.use('/api/webhooks', makeWebhookRouter());

  // ==========================================================================
  // AUTH ROUTES (With auth rate limiting)
  // ==========================================================================

  // Apply stricter rate limiting to auth endpoints
  app.use('/api/login', authLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/superadmin/login', authLimiter);

  // ==========================================================================
  // API ROUTES
  // ==========================================================================

  app.use('/admin', makeAdminRouter({ provisionKey: config.provisionKey }));
  app.use('/api', makePublicRouter());
  app.use('/api', makeSuperadminAuthRouter());
  app.use('/api', makeSuperadminRouter());
  app.use('/api/superadmin', makeAdminMetricsRouter());
  app.use('/api', makeAuthRouter());
  app.use('/api', makeBranchesRouter());
  app.use('/api', makeOwnerRouter());
  app.use('/api', makeOwnerStaffRouter());
  app.use('/api', makeSupportRouter());
  app.use('/api', makeManagerRouter());
  app.use('/api', makeSubscriptionRouter());
  app.use('/api', makeScheduleRouter());
  app.use('/api', makeSyncRouter());
  app.use('/api', makeWaiterRouter());
  app.use('/api', makeStaffRouter());
  app.use('/api', makeManagerStaffRouter());
  app.use('/api', makeAuditRouter());
  app.use('/api', makePosRouter());
  app.use('/api', makePosCustomersRouter());
  app.use('/api', makeInventoryRouter());
  app.use('/api', makeGuestsRouter());
  app.use('/api', makeManagerFinanceRouter());
  app.use('/api', makeManagerMenuRouter());
  app.use('/api', makeManagerSuppliersRouter());
  app.use('/api', makeManagerAuditRouter());
  app.use('/api', makeManagerPaymentsRouter());
  app.use('/api', makeManagerCustomersRouter());
  app.use('/api', makeEnhancedReportsRouter());
  app.use('/api', makeManagerPrintRouter());
  app.use('/api', makeTelebirrStandingOrderRouter());

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  // 404 handler for API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: `Cannot ${req.method} ${req.path}`,
      requestId: req.requestId,
    });
  });

  // Centralized error handler (must be last)
  app.use(errorHandler);

  // Log startup
  logger.info({ port: config.port, env: config.env }, 'Application created');

  return app;
};

module.exports = { createApp };
