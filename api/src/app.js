const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');

const { config } = require('./config');
const { isAllowedOrigin } = require('./utils/cors');
const { logger, requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/errors');
const { getGatewayConfig } = require('./services/paymentGatewayService');
const { requestIdMiddleware, addRequestIdToResponse, addRequestIdToJsonBody } = require('./middleware/requestId');
const { globalLimiter, authLimiter, strictLimiter, paymentLimiter, paymentVerifyLimiter } = require('./middleware/rateLimiter');
const { metricsMiddleware, metricsHandler } = require('./metrics');

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
const { makeManagerPurchaseOrdersRouter } = require('./routes/managerPurchaseOrders');
const { makeManagerAuditRouter } = require('./routes/managerAudit');
const { makeManagerPaymentsRouter } = require('./routes/managerPayments');
const { makeManagerCustomersRouter } = require('./routes/managerCustomers');
const { makeEnhancedReportsRouter } = require('./routes/enhancedReports');
const { makeCustomReportsRouter } = require('./routes/customReports');
const { makeIntegrationRouter } = require('./routes/integrations');
const { makeManagerPrintRouter } = require('./routes/managerPrint');
const { makeTelebirrStandingOrderRouter } = require('./routes/telebirrStandingOrder');
const { makeRealtimeRouter } = require('./routes/realtime');
const { makeFCMRouter } = require('./routes/fcm');

const { handleCheckoutPage, handleReceiptPage, handleDisplayPage } = require('./pages/posPublicPages');
const { setupSwagger } = require('./swagger');

const probeUrl = async (url, timeoutMs) => {
  if (!url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return Boolean(res);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const requestTimeout = (req, res, next) => {
  const baseTimeoutMs = Number(config.requestTimeoutMs || 0) || 0;
  if (baseTimeoutMs <= 0) return next();

  const isTestEmail = req.path === '/api/owner/reports/test-email';
  const overrideRaw = process.env.REPORT_TEST_EMAIL_TIMEOUT_MS;
  const overrideMs = Math.max(0, Number(overrideRaw) || 0);
  const timeoutMs = isTestEmail && overrideMs > 0 ? overrideMs : baseTimeoutMs;
  req.setTimeout(timeoutMs);
  res.setTimeout(timeoutMs, () => {
    if (res.headersSent) return;
    if (req.log?.warn) req.log.warn({ type: 'request_timeout', timeoutMs }, 'Request timeout');
    res.status(503).json({ error: 'request_timeout', message: 'Request timed out', requestId: req.requestId });
  });
  return next();
};


const createApp = () => {
  const app = express();

  // Trust reverse proxy (cPanel/Cloudflare) so req.protocol uses X-Forwarded-Proto
  app.set('trust proxy', true);

  // ==========================================================================
  // SECURITY MIDDLEWARE (Order matters!)
  // ==========================================================================

  // Disable x-powered-by header
  app.disable('x-powered-by');

  // Request ID generation (first, for tracing)
  app.use(requestIdMiddleware);
  app.use(addRequestIdToResponse);
  app.use(addRequestIdToJsonBody);

  // Security headers with enhanced configuration
  app.use(
    helmet({
      contentSecurityPolicy: false, 
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Gzip compression
  app.use(compression({ threshold: 1024 }));

  const webhookBodyParser = (req, res, next) => {
    try {
      if (req.body && Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
        const ct = String(req.header('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          try {
            req.body = JSON.parse(req.body.toString('utf8'));
          } catch {
            req.body = {};
          }
        }
      }
    } catch {
      // ignore
    }
    return next();
  };

  const { makeWebhookRouter } = require('./routes/webhook');
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhookBodyParser, makeWebhookRouter());

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

  // Metrics (request count/latency/errors)
  app.use(metricsMiddleware);

  // Request timeout (global)
  app.use(requestTimeout);

  // Global rate limiting (100 req/min)
  app.use('/api', globalLimiter);

  // Remove CSP headers (API server noise reduction)
  app.use((req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    next();
  });

  // Prevent caching of authenticated API responses.
  // This avoids stale lists (needing hard refresh) behind browser/proxy/CDN caches.
  app.use('/api', (req, res, next) => {
    try {
      const p = String(req.path || '');
      const isCacheable = p.startsWith('/uploads/') || p.startsWith('/public/');
      if (!isCacheable) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Vary', 'Origin, Authorization, X-Tenant');
      }
    } catch {
      // ignore
    }
    return next();
  });

  app.get('/p/:token', handleCheckoutPage);

  app.get('/r/:token', handleReceiptPage);
  app.get('/d/:token', handleDisplayPage);

  // ==========================================================================
  // HEALTH & STATIC ROUTES (No rate limiting)
  // ==========================================================================

  app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send('{}');
  });

  app.get('/', (_req, res) => res.json({ ok: true, name: 'mirachpos-api' }));

  app.get('/metrics', (req, res, next) => {
    try {
      if (config.env !== 'production') return metricsHandler(req, res, next);

      const key = String(config.metricsKey || '').trim();
      if (!key) return res.status(404).json({ error: 'not_found' });

      const provided = String(req.query?.key || req.headers['x-metrics-key'] || '').trim();
      if (!provided || provided !== key) return res.status(403).json({ error: 'forbidden' });

      return metricsHandler(req, res, next);
    } catch (e) {
      return next(e);
    }
  });

  app.get('/health', async (req, res) => {
    try {
      let dbStatus = 'unknown';
      try {
        await require('./db').db().raw('SELECT 1');
        dbStatus = 'up';
      } catch (e) {
        dbStatus = 'down';
      }

      const full = String(req.query?.full || '').trim() === '1';
      const gateways = {};
      if (full && config.healthExternalChecksEnabled) {
        try {
          const [chapaCfg, telebirrCfg] = await Promise.all([
            getGatewayConfig('chapa'),
            getGatewayConfig('telebirr'),
          ]);

          const chapaEnabled = Boolean(chapaCfg?.enabled);
          const telebirrEnabled = Boolean(telebirrCfg?.enabled);
          const chapaUrl = chapaEnabled ? 'https://api.chapa.co' : '';
          const telebirrUrl = telebirrEnabled ? String(telebirrCfg?.baseUrl || 'https://api.ethiotelecom.et') : '';
          const start = Date.now();
          const [chapaOk, telebirrOk] = await Promise.all([
            chapaEnabled ? probeUrl(chapaUrl, config.healthGatewayTimeoutMs) : false,
            telebirrEnabled ? probeUrl(telebirrUrl, config.healthGatewayTimeoutMs) : false,
          ]);
          const elapsed = Date.now() - start;

          gateways.chapa = { status: chapaEnabled ? (chapaOk ? 'up' : 'down') : 'disabled' };
          gateways.telebirr = { status: telebirrEnabled ? (telebirrOk ? 'up' : 'down') : 'disabled' };
          gateways.responseTimeMs = elapsed;
        } catch {
          gateways.chapa = { status: 'unknown' };
          gateways.telebirr = { status: 'unknown' };
        }
      }

      res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        db: dbStatus,
        gateways,
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: 'health_check_failed',
        message: err?.message || 'Health check failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  const swaggerEnabled = (() => {
    if (config.env !== 'production') return true;
    return String(process.env.SWAGGER_ENABLED || '').trim() === '1';
  })();
  if (swaggerEnabled) {
    setupSwagger(app);
  }

  // ==========================================================================
  // AUTH ROUTES (With auth rate limiting)
  // ==========================================================================

  // Apply stricter rate limiting to auth endpoints
  app.use('/api/login', authLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/login-pin', authLimiter);
  app.use('/api/auth/login-pin', authLimiter);
  app.use('/api/auth/forgot-password', authLimiter);
  app.use('/api/auth/forgot-password', strictLimiter);
  app.use('/api/superadmin/login', authLimiter);

  // Public endpoints: tighten abuse protections
  app.use('/api/public/signup', strictLimiter);
  app.use('/api/public/pos-links/:token/initiate-chapa', paymentLimiter);
  app.use('/api/public/pos-links/:token/verify-chapa', paymentVerifyLimiter);

  // Admin/superadmin endpoints: stricter limits
  app.use('/admin', strictLimiter);
  app.use('/api/admin', strictLimiter);
  app.use('/api/superadmin', strictLimiter);

  // ==========================================================================
  // API ROUTES
  // ==========================================================================

  app.use('/admin', makeAdminRouter({ provisionKey: config.provisionKey, provisionKeys: config.provisionKeys }));
  app.use('/api/admin', makeAdminRouter({ provisionKey: config.provisionKey, provisionKeys: config.provisionKeys }));
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
  app.use('/api', makeManagerPurchaseOrdersRouter());
  app.use('/api', makeManagerAuditRouter());
  app.use('/api', makeManagerPaymentsRouter());
  app.use('/api', makeManagerCustomersRouter());
  app.use('/api', makeEnhancedReportsRouter());
  app.use('/api', makeCustomReportsRouter());
  app.use('/api', makeIntegrationRouter());
  app.use('/api', makeManagerPrintRouter());
  app.use('/api', makeTelebirrStandingOrderRouter());
  app.use('/api', makeRealtimeRouter());
  app.use('/api', makeFCMRouter());

  
  // ERROR HANDLING

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
