const path = require('path');

const dotenv = require('dotenv');

// Load root .env.local first (developer machine / Vite), then fallback to api/.env.
// IMPORTANT: Do not override real server env vars in production.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(__dirname, '../../.env.local') });
  dotenv.config({ path: path.join(__dirname, '../.env'), override: true });
} else {
  dotenv.config();
}

const parseList = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const parseKeyList = (raw) =>
  Array.from(new Set(parseList(raw).map((k) => k.trim()).filter(Boolean)));

const config = {
  env: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  jwtSecret: String(process.env.JWT_SECRET || ''),
  metricsKey: String(process.env.METRICS_KEY || ''),
  provisionKey: String(process.env.PROVISION_KEY || ''),
  provisionKeys: (() => {
    const keys = parseKeyList(process.env.PROVISION_KEYS);
    const legacy = String(process.env.PROVISION_KEY || '').trim();
    if (legacy) keys.push(legacy);
    return Array.from(new Set(keys));
  })(),
  corsOrigins: parseList(process.env.CORS_ORIGINS),
  devBypassAuth: process.env.NODE_ENV !== 'production' && String(process.env.DEV_BYPASS_AUTH || '') === '1',
  turnstileSecretKey: String(process.env.TURNSTILE_SECRET_KEY || ''),
  requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS ? Number(process.env.REQUEST_TIMEOUT_MS) : 15000,
  healthGatewayTimeoutMs: process.env.HEALTH_GATEWAY_TIMEOUT_MS ? Number(process.env.HEALTH_GATEWAY_TIMEOUT_MS) : 3000,
  healthExternalChecksEnabled: String(process.env.HEALTH_EXTERNAL_CHECKS || 'true').toLowerCase() !== 'false',
  gatewayRequestTimeoutMs: process.env.GATEWAY_REQUEST_TIMEOUT_MS ? Number(process.env.GATEWAY_REQUEST_TIMEOUT_MS) : 15000,
  breakerFailureThreshold: process.env.BREAKER_FAILURE_THRESHOLD ? Number(process.env.BREAKER_FAILURE_THRESHOLD) : 5,
  breakerRecoveryMs: process.env.BREAKER_RECOVERY_MS ? Number(process.env.BREAKER_RECOVERY_MS) : 30000,
  breakerHalfOpenSuccesses: process.env.BREAKER_HALF_OPEN_SUCCESSES ? Number(process.env.BREAKER_HALF_OPEN_SUCCESSES) : 2,
  redisUrl: String(process.env.REDIS_URL || ''),
  redisHost: String(process.env.REDIS_HOST || ''),
  redisPort: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 0,
  redisPassword: String(process.env.REDIS_PASSWORD || ''),
  redisDb: process.env.REDIS_DB ? Number(process.env.REDIS_DB) : 0,
  cacheDisabled: String(process.env.CACHE_DISABLED || '').trim() === '1' || String(process.env.CACHE_DISABLED || '').trim().toLowerCase() === 'true',
  cacheKeyPrefix: String(process.env.CACHE_KEY_PREFIX || 'mirachpos:').trim(),
  cacheDefaultTtlSeconds: process.env.CACHE_DEFAULT_TTL_SECONDS ? Number(process.env.CACHE_DEFAULT_TTL_SECONDS) : 60,
  cacheReportTtlSeconds: process.env.CACHE_REPORT_TTL_SECONDS ? Number(process.env.CACHE_REPORT_TTL_SECONDS) : 120,
  cdnBaseUrl: String(process.env.CDN_BASE_URL || ''),
  mail: {
    host: String(process.env.MAIL_HOST || ''),
    port: process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 587,
    secure: (() => {
      const raw = String(process.env.MAIL_SECURE || '').trim().toLowerCase();
      if (raw) return raw === 'true';
      const port = process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 587;
      return port === 465;
    })(),
    user: String(process.env.MAIL_USERNAME || ''),
    pass: String(process.env.MAIL_PASSWORD || ''),
    from: String(process.env.CONTACT_SENDER_EMAIL || process.env.MAIL_USERNAME || ''),
    receiver: String(process.env.CONTACT_RECEIVER_EMAIL || process.env.MAIL_USERNAME || ''),
  },
  app: {
    name: String(process.env.APP_NAME || 'MirachPOS'),
    url: String(process.env.APP_URL || 'https://mirachpos.com'),
    appsUrl: String(process.env.APPS_URL || 'https://apps.mirachpos.com'),
    publicLinksUrl: String(
      process.env.PUBLIC_LINKS_URL ||
        process.env.PUBLIC_LINKS_BASE_URL ||
        process.env.PAY_LINKS_URL ||
        process.env.PAY_LINKS_BASE_URL ||
        process.env.PAY_PUBLIC_BASE_URL ||
        process.env.PAYMENTS_PUBLIC_BASE_URL ||
        process.env.PAYMENTS_PUBLIC_URL ||
        '',
    ),
    apiPublicUrl: String(
      process.env.API_PUBLIC_URL ||
        process.env.API_BASE_URL ||
        process.env.PUBLIC_API_URL ||
        process.env.APA_PUBLIC_URL ||
        process.env.APA_BASE_URL ||
        '',
    ),
  },
};

module.exports = { config };
