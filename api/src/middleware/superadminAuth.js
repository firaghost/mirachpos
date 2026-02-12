const jwt = require('jsonwebtoken');
 
const { config } = require('../config');
const { db } = require('../db');

const requireSuperadmin = async (req, res, next) => {
  const hdr = req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(hdr);
  const token = m ? m[1] : '';
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  if (!config.jwtSecret) return res.status(500).json({ error: 'server_misconfigured' });

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (!payload || payload.kind !== 'superadmin') return res.status(403).json({ error: 'forbidden' });

    const superadminId = String(payload.superadminId || '').trim();
    if (!superadminId) return res.status(403).json({ error: 'forbidden' });

    const row = await db().select(['id', 'status']).from('superadmins').where({ id: superadminId }).first();
    if (!row) return res.status(403).json({ error: 'forbidden' });
    if (String(row.status || '') === 'Suspended') return res.status(403).json({ error: 'forbidden' });

    req.superadmin = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { requireSuperadmin };
