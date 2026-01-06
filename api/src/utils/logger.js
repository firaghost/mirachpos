/**
 * Structured Logger (Pino)
 * 
 * Production-ready logging with:
 * - JSON output in production
 * - Pretty print in development
 * - Request ID correlation
 * - Log levels (error, warn, info, debug)
 */

const pino = require('pino');
const { config } = require('../config');

const isDevelopment = config.env !== 'production';

// Create logger with environment-appropriate configuration
const logger = pino({
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

    // Base fields included in every log
    base: {
        service: 'mirachpos-api',
        env: config.env,
    },

    // Timestamp format
    timestamp: pino.stdTimeFunctions.isoTime,

    // Format options
    formatters: {
        level: (label) => ({ level: label }),
    },

    // Pretty print in development
    transport: isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname,service,env',
            },
        }
        : undefined,
});

// Create child logger with request context
const createRequestLogger = (req) => {
    return logger.child({
        requestId: req.requestId || 'unknown',
        method: req.method,
        path: req.path,
        ip: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
        userAgent: req.headers['user-agent'],
        tenantId: req.tenant?.id || req.auth?.tenantId,
        staffId: req.auth?.staffId,
    });
};

// Create child logger for specific service/module
const createServiceLogger = (serviceName) => {
    return logger.child({ service: serviceName });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    const reqLogger = createRequestLogger(req);

    // Attach logger to request for use in handlers
    req.log = reqLogger;

    // Log request start
    reqLogger.info({ type: 'request_start' }, `${req.method} ${req.path}`);

    // Log response on finish
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const logData = {
            type: 'request_end',
            statusCode: res.statusCode,
            duration,
        };

        if (res.statusCode >= 500) {
            reqLogger.error(logData, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        } else if (res.statusCode >= 400) {
            reqLogger.warn(logData, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        } else {
            reqLogger.info(logData, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        }
    });

    next();
};

module.exports = {
    logger,
    createRequestLogger,
    createServiceLogger,
    requestLogger,
};
