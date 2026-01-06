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

module.exports = {
    requestIdMiddleware,
    addRequestIdToResponse,
    generateRequestId,
};
