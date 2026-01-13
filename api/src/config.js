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

const config = {
  env: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  jwtSecret: String(process.env.JWT_SECRET || ''),
  provisionKey: String(process.env.PROVISION_KEY || ''),
  corsOrigins: parseList(process.env.CORS_ORIGINS),
  devBypassAuth: process.env.NODE_ENV !== 'production' && String(process.env.DEV_BYPASS_AUTH || '') === '1',
  turnstileSecretKey: String(process.env.TURNSTILE_SECRET_KEY || ''),
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
  },
};

module.exports = { config };
