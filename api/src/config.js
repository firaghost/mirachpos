const path = require('path');

const dotenv = require('dotenv');

// Load root .env.local first (developer machine / Vite), then fallback to api/.env.
dotenv.config({ path: path.join(__dirname, '../../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

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
};

module.exports = { config };
