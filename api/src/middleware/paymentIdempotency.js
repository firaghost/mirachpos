/**
 * Payment Idempotency Middleware
 * 
 * Prevents duplicate payment processing by tracking idempotency keys.
 * Each payment request should include an X-Idempotency-Key header.
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { logger } = require('../utils/logger');

const log = logger.child({ service: 'idempotency' });

// In-memory cache for fast lookups (with TTL)
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cleanup old cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, 5 * 60 * 1000); // Every 5 minutes

/**
 * Check if we've already processed this request
 * @param {string} key - Idempotency key
 * @returns {Promise<{exists: boolean, response?: any}>}
 */
const checkIdempotency = async (key) => {
    // Check memory cache first
    if (cache.has(key)) {
        const entry = cache.get(key);
        if (Date.now() - entry.timestamp < CACHE_TTL) {
            return { exists: true, response: entry.response };
        }
        cache.delete(key);
    }

    // Check database
    const row = await db()
        .select(['id', 'response_json', 'created_at'])
        .from('idempotency_keys')
        .where({ key })
        .first();

    if (row) {
        const response = JSON.parse(row.response_json || '{}');
        // Update cache
        cache.set(key, { response, timestamp: Date.now() });
        return { exists: true, response };
    }

    return { exists: false };
};

/**
 * Store the response for an idempotency key
 * @param {string} key - Idempotency key
 * @param {string} path - Request path
 * @param {any} response - Response to store
 */
const storeIdempotency = async (key, path, response) => {
    const nowIso = new Date().toISOString();

    try {
        await db().from('idempotency_keys').insert({
            id: makeId('idk'),
            key,
            path,
            response_json: JSON.stringify(response),
            created_at: nowIso,
        });

        // Update cache
        cache.set(key, { response, timestamp: Date.now() });
    } catch (e) {
        // Ignore duplicate key errors
        if (!e.message?.includes('Duplicate') && !e.message?.includes('unique')) {
            log.error({ error: e.message, key }, 'Failed to store idempotency key');
        }
    }
};

/**
 * Middleware that enforces idempotency for payment operations
 */
const paymentIdempotency = async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];

    // If no key provided, generate one from request signature
    const key = idempotencyKey || `${req.method}:${req.path}:${req.auth?.tenantId || 'anon'}:${JSON.stringify(req.body)}`;

    try {
        const { exists, response } = await checkIdempotency(key);

        if (exists) {
            log.info({ key, path: req.path }, 'Returning cached response for idempotent request');
            return res.json(response);
        }

        // Store the key for this request
        req.idempotencyKey = key;

        // Capture the response
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // Only store successful responses
            if (res.statusCode >= 200 && res.statusCode < 300) {
                storeIdempotency(key, req.path, body).catch(() => { });
            }
            return originalJson(body);
        };

        next();
    } catch (e) {
        log.error({ error: e.message, key }, 'Idempotency check failed');
        // Continue without idempotency on error
        next();
    }
};

/**
 * Optional: Check idempotency key without blocking
 * Use when you want to check but not enforce
 */
const checkPaymentIdempotency = async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (idempotencyKey) {
        try {
            const { exists, response } = await checkIdempotency(idempotencyKey);
            if (exists) {
                req.idempotentResponse = response;
            }
        } catch (e) {
            // Ignore errors
        }
    }

    next();
};

module.exports = {
    paymentIdempotency,
    checkPaymentIdempotency,
    checkIdempotency,
    storeIdempotency,
};
