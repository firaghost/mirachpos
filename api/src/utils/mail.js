const { config } = require('../config');

const createMailTransporter = (overrides) => {
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch {
    return null;
  }

  const host = String(config.mail?.host || '').trim();
  const port = Number(overrides?.port || config.mail?.port || 587);
  const user = String(config.mail?.user || '').trim();
  const pass = String(config.mail?.pass || '').trim();
  if (!host || !user || !pass) return null;

  const secure =
    typeof overrides?.secure === 'boolean'
      ? overrides.secure
      : typeof config.mail?.secure === 'boolean'
        ? config.mail.secure
        : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    family: 4,
    requireTLS: !secure && port === 587,
    tls: { minVersion: 'TLSv1.2', servername: host },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
};

module.exports = { createMailTransporter };
