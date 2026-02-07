const { config } = require('../config');

const createMailTransporter = (overrides) => {
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch {
    return null;
  }

  // Support both MAIL_* and SMTP_* env vars (like LandingPage server)
  const host = String(overrides?.host || config.mail?.host || process.env.SMTP_HOST || '').trim();
  const port = Number(overrides?.port || config.mail?.port || process.env.SMTP_PORT || 465);
  const user = String(config.mail?.user || process.env.SMTP_USER || '').trim();
  const pass = String(config.mail?.pass || process.env.SMTP_PASS || '').trim();
  const from = String(config.mail?.from || process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim();

  if (!host || !user || !pass) return null;

  // Default to secure=true for port 465, false otherwise
  const secure =
    typeof overrides?.secure === 'boolean'
      ? overrides.secure
      : typeof config.mail?.secure === 'boolean'
        ? config.mail.secure
        : port === 465;

  const timeoutMsRaw =
    overrides?.timeoutMs ??
    process.env.MAIL_TIMEOUT_MS ??
    process.env.SMTP_TIMEOUT_MS ??
    10_000;
  const timeoutMs = Math.max(1000, Number(timeoutMsRaw) || 30_000);

  const transportOptions = {
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };

  // Only add TLS options for port 587 with STARTTLS
  if (!secure && (port === 587 || port === 2525)) {
    transportOptions.requireTLS = true;
    transportOptions.tls = {
      rejectUnauthorized: false, // Accept self-signed certificates (common in cPanel)
      minVersion: 'TLSv1.2',
    };
  }

  // For port 465 SSL (common with cPanel), add TLS options to handle various certificate setups
  if (secure) {
    transportOptions.tls = {
      rejectUnauthorized: false, // Accept self-signed certificates (common in cPanel)
      minVersion: 'TLSv1.2',
    };
  }

  return nodemailer.createTransport(transportOptions);
};

module.exports = { createMailTransporter };
