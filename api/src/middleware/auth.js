const jwt = require('jsonwebtoken');
 
const { config } = require('../config');

const requireAuth = (req, res, next) => {
  const hdr = req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(hdr);
  const token =
    (m ? m[1] : '') ||
    (typeof req.query?.token === 'string' ? String(req.query.token).trim() : '') ||
    (typeof req.query?.access_token === 'string' ? String(req.query.access_token).trim() : '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const secret = config.jwtSecret;
  if (!secret) {
    try {
      if (req.log?.error) req.log.error({ type: 'security_event', event: 'jwt_secret_missing' }, 'JWT_SECRET is required');
    } catch {
      // ignore
    }
    return res.status(500).json({
      error: 'server_misconfigured',
      message: 'JWT_SECRET is required.',
    });
  }
  try {
    const payload = jwt.verify(token, secret);
    req.auth = payload;
    return next();
  } catch {
    try {
      if (req.log?.warn) req.log.warn({ type: 'security_event', event: 'auth_token_invalid' }, 'Invalid auth token');
    } catch {
      // ignore
    }
    return res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { requireAuth };
