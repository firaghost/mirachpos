/**
 * Custom Error Classes
 * 
 * Centralized error handling with proper HTTP status codes.
 * All errors extend AppError base class for consistent handling.
 */

class AppError extends Error {
    constructor(message, statusCode = 500, code = 'server_error', details = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true; // Distinguishes from programming errors
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: this.code,
            message: this.message,
            ...(this.details && { details: this.details }),
        };
    }
}

class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400, 'validation_error', details);
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401, 'unauthorized');
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(message, 403, 'forbidden');
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'not_found');
    }
}

class PaymentRequiredError extends AppError {
    constructor(message = 'Payment required', code = 'payment_required') {
        super(message, 402, code);
    }
}

class ConflictError extends AppError {
    constructor(message = 'Resource conflict') {
        super(message, 409, 'conflict');
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Too many requests', retryAfter = 60) {
        super(message, 429, 'rate_limit_exceeded', { retryAfter });
    }
}

class ServiceUnavailableError extends AppError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, 503, 'service_unavailable');
    }
}

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        const parsed = JSON.parse(String(raw));
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

const safeJsonStringify = (v) => {
    try {
        if (v == null) return null;
        return JSON.stringify(v);
    } catch {
        return null;
    }
};

// Error handler middleware
const errorHandler = (err, req, res, _next) => {
    // Get logger from request or create one
    const log = req.log || require('./logger').logger;

    // Determine if this is an operational error we can trust
    const isOperational = err instanceof AppError && err.isOperational;

    // Log the error
    if (isOperational) {
        log.warn({
            type: 'operational_error',
            code: err.code,
            statusCode: err.statusCode,
            requestId: req.requestId,
        }, err.message);
    } else {
        log.error({
            type: 'unexpected_error',
            error: err.message,
            stack: err.stack,
            requestId: req.requestId,
        }, 'Unexpected server error');
    }

    // Determine response status and body
    const statusCode = err.statusCode || 500;
    const responseBody = {
        error: err.code || 'server_error',
        message: isOperational ? err.message : 'An unexpected error occurred',
        requestId: req.requestId,
        ...(err.details && isOperational && { details: err.details }),
    };

    // In development, include stack trace
    if (process.env.NODE_ENV !== 'production' && !isOperational) {
        responseBody.stack = err.stack;
    }

    return res.status(statusCode).json(responseBody);
};

module.exports = {
    AppError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    PaymentRequiredError,
    ConflictError,
    RateLimitError,
    ServiceUnavailableError,
    safeJsonParse,
    safeJsonStringify,
    errorHandler,
};
