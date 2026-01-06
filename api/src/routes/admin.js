const express = require('express');
const { provisionTenant } = require('../services/provisionService');
const { runDailyCron } = require('../services/cronService');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const makeAdminRouter = ({ provisionKey }) => {
  const r = express.Router();

  const requireProvisionKey = (req, res) => {
    const key = req.header('X-Provision-Key') || '';
    if (!provisionKey || key !== provisionKey) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  r.post('/provision', async (req, res, next) => {
    try {
      if (!requireProvisionKey(req, res)) return;

      const out = await provisionTenant({
        slug: req.body?.slug,
        name: req.body?.name,
        trialDays: req.body?.trialDays,
        ownerName: req.body?.ownerName,
        ownerEmail: req.body?.ownerEmail,
        ownerPassword: req.body?.ownerPassword,
        branchName: req.body?.branchName,
      });

      if (!out.ok) return res.status(out.error === 'slug_in_use' ? 409 : 400).json({ error: out.error });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/cron/daily', async (req, res, next) => {
    try {
      if (!requireProvisionKey(req, res)) return;
      const out = await runDailyCron();
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/seed', async (req, res, next) => {
    try {
      if (!requireProvisionKey(req, res)) return;

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!email || !password) return res.status(400).json({ error: 'email_password_required' });

      const exists = await db().select(['id']).from('superadmins').where({ email }).first();
      if (exists) return res.status(409).json({ error: 'already_exists' });

      const nowIso = new Date().toISOString();
      const passwordHash = await bcrypt.hash(password, 10);
      const id = makeId('sa');

      await db().from('superadmins').insert({
        id,
        email,
        name: name || null,
        password_hash: passwordHash,
        status: 'Active',
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id, email });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeAdminRouter };
