const {
  validateJwtSecret,
  validateTenantGatewaySecretsKey,
  validateCorsOrigins,
  validateMetricsKey,
} = require('../../src/utils/validateConfig');

describe('validateJwtSecret', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;

    expect(() => validateJwtSecret()).not.toThrow();
  });

  it('throws when JWT_SECRET is missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => validateJwtSecret()).toThrow(/JWT_SECRET environment variable is missing/);
    try {
      validateJwtSecret();
    } catch (e) {
      expect(e.code).toBe('JWT_SECRET_MISSING');
    }
  });

  it('throws when JWT_SECRET is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(10);

    try {
      validateJwtSecret();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('JWT_SECRET_TOO_SHORT');
    }
  });

  it('throws when JWT_SECRET has low entropy', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(64);

    try {
      validateJwtSecret();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('JWT_SECRET_LOW_ENTROPY');
    }
  });

  it('passes for a sufficiently random 64+ char secret', () => {
    process.env.NODE_ENV = 'production';
    const crypto = require('crypto');
    process.env.JWT_SECRET = crypto.randomBytes(96).toString('base64');

    expect(() => validateJwtSecret()).not.toThrow();
  });
});

describe('validateTenantGatewaySecretsKey', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.TENANT_GATEWAY_SECRETS_KEY;
    expect(() => validateTenantGatewaySecretsKey()).not.toThrow();
  });

  it('throws when TENANT_GATEWAY_SECRETS_KEY is missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TENANT_GATEWAY_SECRETS_KEY;
    try {
      validateTenantGatewaySecretsKey();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('TENANT_GATEWAY_SECRETS_KEY_MISSING');
    }
  });

  it('throws when TENANT_GATEWAY_SECRETS_KEY is invalid', () => {
    process.env.NODE_ENV = 'production';
    process.env.TENANT_GATEWAY_SECRETS_KEY = 'not-a-valid-key';
    try {
      validateTenantGatewaySecretsKey();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('TENANT_GATEWAY_SECRETS_KEY_INVALID');
    }
  });

  it('passes for a valid 32-byte base64 key', () => {
    process.env.NODE_ENV = 'production';
    const crypto = require('crypto');
    process.env.TENANT_GATEWAY_SECRETS_KEY = crypto.randomBytes(32).toString('base64');
    expect(() => validateTenantGatewaySecretsKey()).not.toThrow();
  });
});

describe('validateCorsOrigins', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = '*';
    expect(() => validateCorsOrigins()).not.toThrow();
  });

  it('does nothing when CORS_ORIGINS is empty', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    expect(() => validateCorsOrigins()).not.toThrow();
  });

  it('throws when CORS_ORIGINS contains unsafe wildcard', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '*';
    try {
      validateCorsOrigins();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('CORS_ORIGINS_UNSAFE');
    }
  });
});

describe('validateMetricsKey', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'test';
    process.env.METRICS_KEY = 'short';
    expect(() => validateMetricsKey()).not.toThrow();
  });

  it('does nothing when METRICS_KEY is empty', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.METRICS_KEY;
    expect(() => validateMetricsKey()).not.toThrow();
  });

  it('throws when METRICS_KEY is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_KEY = 'a'.repeat(10);
    try {
      validateMetricsKey();
      throw new Error('expected to throw');
    } catch (e) {
      expect(e.code).toBe('METRICS_KEY_TOO_SHORT');
    }
  });
});
