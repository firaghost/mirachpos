const calculateEntropy = (str) => {
  const len = str.length;
  if (len === 0) return 0;

  const freq = new Map();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
};

const validateJwtSecret = () => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;

  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    const err = new Error(
      'CRITICAL: JWT_SECRET environment variable is missing. Generate a secure secret with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
    );
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }

  if (secret.length < 64) {
    const err = new Error(`CRITICAL: JWT_SECRET must be at least 64 characters. Current length: ${secret.length}`);
    err.code = 'JWT_SECRET_TOO_SHORT';
    throw err;
  }

  const entropy = calculateEntropy(secret);
  if (entropy < 4.5) {
    const err = new Error('CRITICAL: JWT_SECRET has low entropy (too predictable). Use a random 64+ char secret.');
    err.code = 'JWT_SECRET_LOW_ENTROPY';
    throw err;
  }
};

const validateTenantGatewaySecretsKey = () => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;

  const raw = String(process.env.TENANT_GATEWAY_SECRETS_KEY || '').trim();
  if (!raw) {
    const err = new Error(
      'CRITICAL: TENANT_GATEWAY_SECRETS_KEY is missing. It must be a 32-byte key encoded as base64 or hex.',
    );
    err.code = 'TENANT_GATEWAY_SECRETS_KEY_MISSING';
    throw err;
  }

  const decodeIfLen32 = (encoding) => {
    try {
      const buf = Buffer.from(raw, encoding);
      return buf.length === 32 ? buf : null;
    } catch {
      return null;
    }
  };

  const b64 = decodeIfLen32('base64');
  if (b64) return;
  const hex = decodeIfLen32('hex');
  if (hex) return;

  const err = new Error('CRITICAL: TENANT_GATEWAY_SECRETS_KEY is invalid. It must decode to exactly 32 bytes (base64 or hex).');
  err.code = 'TENANT_GATEWAY_SECRETS_KEY_INVALID';
  throw err;
};

const parseList = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const validateCorsOrigins = () => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;

  const raw = String(process.env.CORS_ORIGINS || '').trim();
  if (!raw) return;

  const origins = parseList(raw).map((s) => s.toLowerCase());
  const hasWildcard = origins.some((o) => o === '*' || o === 'null' || o.includes('*') && !o.includes('*.'));
  if (hasWildcard) {
    const err = new Error('CRITICAL: CORS_ORIGINS contains an unsafe wildcard. Do not use "*" with credentialed CORS. Provide explicit origins instead.');
    err.code = 'CORS_ORIGINS_UNSAFE';
    throw err;
  }
};

const validateMetricsKey = () => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;

  const key = String(process.env.METRICS_KEY || '').trim();
  if (!key) return;
  if (key.length < 32) {
    const err = new Error('CRITICAL: METRICS_KEY must be at least 32 characters (use a random secret).');
    err.code = 'METRICS_KEY_TOO_SHORT';
    throw err;
  }
};

module.exports = { validateJwtSecret, validateTenantGatewaySecretsKey, validateCorsOrigins, validateMetricsKey };
