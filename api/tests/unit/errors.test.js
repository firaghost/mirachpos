const {
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
} = require('../../src/utils/errors');

describe('utils/errors', () => {
  describe('AppError', () => {
    it('creates error with default values', () => {
      const err = new AppError('Something went wrong');
      expect(err.message).toBe('Something went wrong');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('server_error');
      expect(err.isOperational).toBe(true);
      expect(err.name).toBe('AppError');
    });

    it('creates error with custom values', () => {
      const err = new AppError('Custom error', 400, 'custom_error', { field: 'name' });
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('custom_error');
      expect(err.details).toEqual({ field: 'name' });
    });

    it('toJSON returns error object', () => {
      const err = new AppError('Test', 400, 'test_error', { field: 'value' });
      const json = err.toJSON();
      expect(json).toEqual({
        error: 'test_error',
        message: 'Test',
        details: { field: 'value' },
      });
    });

    it('toJSON excludes details when null', () => {
      const err = new AppError('Test');
      const json = err.toJSON();
      expect(json).toEqual({
        error: 'server_error',
        message: 'Test',
      });
      expect(json.details).toBeUndefined();
    });
  });

  describe('ValidationError', () => {
    it('creates validation error', () => {
      const err = new ValidationError('Invalid input', { email: 'Required' });
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('validation_error');
      expect(err.details).toEqual({ email: 'Required' });
    });
  });

  describe('UnauthorizedError', () => {
    it('creates unauthorized error with default message', () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('unauthorized');
      expect(err.message).toBe('Unauthorized');
    });

    it('creates unauthorized error with custom message', () => {
      const err = new UnauthorizedError('Invalid credentials');
      expect(err.message).toBe('Invalid credentials');
    });
  });

  describe('ForbiddenError', () => {
    it('creates forbidden error', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('forbidden');
      expect(err.message).toBe('Forbidden');
    });
  });

  describe('NotFoundError', () => {
    it('creates not found error with default resource', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Resource not found');
    });

    it('creates not found error with custom resource', () => {
      const err = new NotFoundError('User');
      expect(err.message).toBe('User not found');
    });
  });

  describe('PaymentRequiredError', () => {
    it('creates payment required error', () => {
      const err = new PaymentRequiredError();
      expect(err.statusCode).toBe(402);
      expect(err.code).toBe('payment_required');
    });

    it('creates payment required error with custom code', () => {
      const err = new PaymentRequiredError('Subscription expired', 'subscription_required');
      expect(err.code).toBe('subscription_required');
    });
  });

  describe('ConflictError', () => {
    it('creates conflict error', () => {
      const err = new ConflictError('Email already exists');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('conflict');
    });
  });

  describe('RateLimitError', () => {
    it('creates rate limit error', () => {
      const err = new RateLimitError();
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('rate_limit_exceeded');
    });
  });

  describe('ServiceUnavailableError', () => {
    it('creates service unavailable error', () => {
      const err = new ServiceUnavailableError();
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('service_unavailable');
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    it('returns fallback on invalid JSON', () => {
      expect(safeJsonParse('invalid', {})).toEqual({});
    });

    it('returns undefined on invalid JSON without fallback', () => {
      expect(safeJsonParse('invalid')).toBeUndefined();
    });
  });

  describe('safeJsonStringify', () => {
    it('stringifies object', () => {
      expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    });

    it('returns null on circular reference', () => {
      const obj = {};
      obj.self = obj;
      expect(safeJsonStringify(obj)).toBeNull();
    });
  });

  describe('errorHandler', () => {
    const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };

    it('handles operational errors', () => {
      const err = new ValidationError('Bad input');
      const req = { requestId: 'req-1', path: '/test', method: 'POST' };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      errorHandler(err, req, res, mockLogger);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'validation_error' }));
    });

    it('handles non-operational errors as 500', () => {
      const err = new Error('Unexpected');
      const req = { requestId: 'req-1', path: '/test', method: 'POST' };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      errorHandler(err, req, res, mockLogger);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
