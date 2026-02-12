const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const {
  validateSuperadminFeatureFlagsQuery,
  validateSuperadminFeatureFlagCreate,
  validateSuperadminFeatureFlagUpdate,
  validateIdParam,
} = require('../../middleware/validators');

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  const x = Number.isFinite(n) ? n : def;
  return Math.max(min, Math.min(max, x));
};

const makeSuperadminFeatureFlagsRouter = () => {
  const r = express.Router();

  r.get('/superadmin/feature-flags', requireSuperadmin, validateSuperadminFeatureFlagsQuery, async (req, res, next) => {
    try {
      const { page: pageRaw, pageSize: pageSizeRaw, q: qRaw, plan: planRaw, risk: riskRaw } = req.validatedQuery || req.query;
      const page = clampInt(pageRaw, 1, 1, 1000000);
      const pageSize = clampInt(pageSizeRaw, 10, 1, 100);
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const plan = sanitizeText(planRaw, { maxLen: 40 });
      const risk = sanitizeText(riskRaw, { maxLen: 40 });

      let base = db().from('feature_flags');
      if (plan) base = base.where({ plan });
      if (risk) base = base.where({ risk });
      if (q) base = base.andWhere((qb) => qb.whereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(id) LIKE ?', [`%${q}%`]));

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base.clone().orderBy('updated_at', 'desc').offset((page - 1) * pageSize).limit(pageSize);

      const statsRow = await db().from('feature_flags').select(['enabled', 'risk']).count({ c: '*' }).groupBy(['enabled', 'risk']);
      const stats = { totalFlags: total, activeGlobally: 0, highRisk: 0, betaFeatures: 0 };
      for (const r0 of statsRow) {
        if (r0.enabled) stats.activeGlobally += Number(r0.c || 0) || 0;
        if (String(r0.risk || '').toLowerCase() === 'high' || String(r0.risk || '').toLowerCase() === 'critical') {
          stats.highRisk += Number(r0.c || 0) || 0;
        }
      }

      const flags = rows.map((r0) => ({
        id: String(r0.id),
        name: String(r0.name || ''),
        plan: String(r0.plan || ''),
        risk: String(r0.risk || ''),
        enabled: Boolean(r0.enabled),
        updatedAt: toIso(r0.updated_at),
        updatedBy: 'Super Admin',
      }));

      return res.json({ ok: true, page, pageSize, total, stats, flags });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/feature-flags', requireSuperadmin, validateSuperadminFeatureFlagCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const id = String(body?.id || '').trim();
      const name = String(body?.name || '').trim();
      if (!id || !name) return res.status(400).json({ error: 'invalid_flag' });
      const nowIso = new Date().toISOString();
      await db().from('feature_flags').insert({
        id,
        name,
        plan: typeof body?.plan === 'string' ? body.plan.trim() : null,
        risk: typeof body?.risk === 'string' ? body.risk.trim() : null,
        enabled: body?.enabled ? 1 : 0,
        meta_json: JSON.stringify({}),
        updated_at: nowIso,
      });
      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/feature-flags/:id', requireSuperadmin, validateIdParam, validateSuperadminFeatureFlagUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const flagId = String(id || '').trim();
      if (!flagId) return res.status(400).json({ error: 'invalid_flag' });
      const existing = await db().from('feature_flags').select(['id']).where({ id: flagId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.plan === 'string') patch.plan = body.plan.trim();
      if (typeof body?.risk === 'string') patch.risk = body.risk.trim();
      if (typeof body?.enabled !== 'undefined') patch.enabled = body.enabled ? 1 : 0;
      patch.updated_at = new Date().toISOString();

      await db().from('feature_flags').where({ id: flagId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminFeatureFlagsRouter };
