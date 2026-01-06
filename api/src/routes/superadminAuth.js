const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { config } = require('../config');
const { db } = require('../db');

const makeSuperadminAuthRouter = () => {
  const r = express.Router();

  r.post('/superadmin/login', async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) return res.status(400).json({ error: 'invalid_credentials' });

      const row = await db()
        .select(['id', 'email', 'password_hash', 'status'])
        .from('superadmins')
        .where({ email })
        .first();

      if (!row) return res.status(401).json({ error: 'invalid_credentials' });
      if (row.status === 'Suspended') return res.status(403).json({ error: 'suspended' });

      const ok = await bcrypt.compare(password, String(row.password_hash || ''));
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

      const token = jwt.sign(
        { kind: 'superadmin', superadminId: row.id, email: row.email },
        config.jwtSecret,
        { expiresIn: '12h' },
      );

      const nowIso = new Date().toISOString();
      await db().from('superadmins').where({ id: row.id }).update({ last_login_at: nowIso, updated_at: nowIso });

      return res.json({ ok: true, token });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminAuthRouter };
