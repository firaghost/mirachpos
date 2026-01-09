const jwt = require('jsonwebtoken');
 
const { config } = require('../config');

const requireAuth = (req, res, next) => {
  const hdr = req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(hdr);
  const token = m ? m[1] : '';
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const strict = String(process.env.STRICT_JWT_SECRET || '') === '1';
  const secret = config && config.jwtSecret ? config.jwtSecret : strict ? '' : 'dev-secret';
  if (!secret) return res.status(500).json({ error: 'server_misconfigured', message: 'JWT_SECRET is required (or set STRICT_JWT_SECRET=0 for local dev fallback).' });
  try {
    const payload = jwt.verify(token, secret);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { requireAuth };
