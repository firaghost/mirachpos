/**
 * Request ID Middleware
 * 
 * Generates unique request IDs for tracing requests across logs.
 */

const crypto = require('crypto');

const generateRequestId = () => {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `req_${timestamp}_${random}`;
};

const requestIdMiddleware = (req, _res, next) => {
    // Use existing request ID from header if present (for distributed tracing)
    // Otherwise generate a new one
    req.requestId = req.headers['x-request-id'] || generateRequestId();
    next();
};

// Middleware to add request ID to response headers
const addRequestIdToResponse = (req, res, next) => {
    res.setHeader('X-Request-ID', req.requestId);
    next();
};

const addRequestIdToJsonBody = (req, res, next) => {
    const original = res.json.bind(res);
    res.json = (body) => {
        try {
            const id = typeof req.requestId === 'string' ? req.requestId : '';
            if (!id) return original(body);
            if (body && typeof body === 'object' && !Array.isArray(body)) {
                if (typeof body.requestId === 'string' && body.requestId.trim()) return original(body);
                return original({ ...body, requestId: id });
            }
            return original(body);
        } catch {
            return original(body);
        }
    };
    next();
};

module.exports = {
    requestIdMiddleware,
    addRequestIdToResponse,
    addRequestIdToJsonBody,
    generateRequestId,
};
