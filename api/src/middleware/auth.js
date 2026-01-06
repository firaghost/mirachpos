const jwt = require('jsonwebtoken');
 
const { config } = require('../config');

const requireAuth = (req, res, next) => {
  const hdr = req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(hdr);
  const token = m ? m[1] : '';
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  if (!config.jwtSecret) return res.status(500).json({ error: 'server_misconfigured' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { requireAuth };
