/**
 * Rate Limiting Middleware
 * 
 * Protects API endpoints from brute force attacks and abuse.
 * - Global limiter: 100 requests per minute per IP
 * - Auth limiter: 5 login attempts per 15 minutes (brute force protection)
 * - Strict limiter: 10 requests per minute for sensitive operations
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Helper to get client IP (works behind proxies)
const getClientIp = (req, res) => {
    return ipKeyGenerator(req, res);
};

const makeRateLimitHandler = (eventName, payload) => {
    return (req, res) => {
        try {
            if (req.log?.warn) req.log.warn({ type: 'security_event', event: 'rate_limited', limiter: eventName }, 'Rate limit exceeded');
        } catch {
            // ignore
        }
        return res.status(429).json(payload);
    };
};

// Global rate limiter - 100 requests per minute
const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    message: {
        error: 'too_many_requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: 60,
    },
    handler: makeRateLimitHandler('global', {
        error: 'too_many_requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: 60,
    }),
    keyGenerator: getClientIp,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/.well-known/appspecific/com.chrome.devtools.json';
    },
});

// Auth rate limiter - 5 attempts per 15 minutes (brute force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'too_many_login_attempts',
        message: 'Too many login attempts. Please try again in 15 minutes.',
        retryAfter: 900,
    },
    handler: makeRateLimitHandler('auth', {
        error: 'too_many_login_attempts',
        message: 'Too many login attempts. Please try again in 15 minutes.',
        retryAfter: 900,
    }),
    keyGenerator: getClientIp,
    skipSuccessfulRequests: true, // Don't count successful logins
});

// Strict limiter - 10 requests per minute (for sensitive operations)
const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'rate_limit_exceeded',
        message: 'Rate limit exceeded for this operation. Please try again later.',
        retryAfter: 60,
    },
    handler: makeRateLimitHandler('strict', {
        error: 'rate_limit_exceeded',
        message: 'Rate limit exceeded for this operation. Please try again later.',
        retryAfter: 60,
    }),
    keyGenerator: getClientIp,
});

// Payment verification limiter - allow polling but prevent abuse
const paymentVerifyLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'too_many_verification_attempts',
        message: 'Too many verification attempts. Please wait before trying again.',
        retryAfter: 60,
    },
    handler: makeRateLimitHandler('payment_verify', {
        error: 'too_many_verification_attempts',
        message: 'Too many verification attempts. Please wait before trying again.',
        retryAfter: 60,
    }),
    keyGenerator: getClientIp,
});

// Payment rate limiter - 3 payment attempts per minute
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'too_many_payment_attempts',
        message: 'Too many payment attempts. Please wait before trying again.',
        retryAfter: 60,
    },
    handler: makeRateLimitHandler('payment', {
        error: 'too_many_payment_attempts',
        message: 'Too many payment attempts. Please wait before trying again.',
        retryAfter: 60,
    }),
    keyGenerator: getClientIp,
});

module.exports = {
    globalLimiter,
    authLimiter,
    strictLimiter,
    paymentLimiter,
    paymentVerifyLimiter,
};
