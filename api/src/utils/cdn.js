const { config } = require('../config');

const resolveCdnUrl = (rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return path;
  const base = String(config.cdnBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base || !path.startsWith('/')) return path;
  return `${base}${path}`;
};

module.exports = { resolveCdnUrl };
