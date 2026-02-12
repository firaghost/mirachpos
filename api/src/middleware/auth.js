const jwt = require('jsonwebtoken');
 
const { config } = require('../config');

const requireAuth = (req, res, next) => {
  const hdr =
    (typeof req.header === 'function' ? req.header('Authorization') : '') ||
    (typeof req.get === 'function' ? req.get('Authorization') : '') ||
    (req.headers && (req.headers.authorization || req.headers.Authorization)) ||
    '';
  const m = /^Bearer\s+(.+)$/.exec(hdr);
  const token =
    (m ? m[1] : '') ||
    (typeof req.query?.token === 'string' ? String(req.query.token).trim() : '') ||
    (typeof req.query?.access_token === 'string' ? String(req.query.access_token).trim() : '');
  if (!token) {
    if (res && typeof res.status === 'function' && typeof res.json === 'function') return res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const secret = config.jwtSecret;
  if (!secret) {
    try {
      if (req.log?.error) req.log.error({ type: 'security_event', event: 'jwt_secret_missing' }, 'JWT_SECRET is required');
    } catch {
      // ignore
    }
    if (res && typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(500).json({
        error: 'server_misconfigured',
        message: 'JWT_SECRET is required.',
      });
    }
    return;
  }
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.auth = payload;
    return next();
  } catch {
    try {
      if (req.log?.warn) req.log.warn({ type: 'security_event', event: 'auth_token_invalid' }, 'Invalid auth token');
    } catch {
      // ignore
    }
    if (res && typeof res.status === 'function' && typeof res.json === 'function') return res.status(401).json({ error: 'unauthorized' });
    return;
  }
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const allowed = Array.isArray(allowedRoles) ? allowedRoles.map(String) : [];
  const role = String(req.auth?.role || '').trim();
  if (!allowed.length || allowed.includes(role)) return next();
  if (res && typeof res.status === 'function' && typeof res.json === 'function') return res.status(403).json({ error: 'forbidden' });
  return;
};

const requireSubscription = (moduleName) => (req, res, next) => {
  const mod = String(moduleName || '').trim();
  const sub = req.auth?.subscription;
  const modules = Array.isArray(sub?.modules) ? sub.modules.map(String) : [];
  const tier = String(sub?.tier || '').toLowerCase();
  const trialEndsAt = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;

  if (tier === 'trial' && trialEndsAt && !Number.isNaN(trialEndsAt.getTime()) && trialEndsAt.getTime() < Date.now()) {
    if (res && typeof res.status === 'function' && typeof res.json === 'function') return res.status(402).json({ error: 'subscription_required' });
    return;
  }

  if (!mod || modules.includes(mod)) return next();
  if (res && typeof res.status === 'function' && typeof res.json === 'function') return res.status(402).json({ error: 'subscription_required' });
  return;
};

module.exports = { requireAuth, requireRole, requireSubscription };
