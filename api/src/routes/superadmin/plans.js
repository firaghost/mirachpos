const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { safeJsonParse } = require('../../utils/errors');
const { makeId } = require('../../utils/ids');
const { logAudit } = require('../../utils/logger');
const {
  validateTierParam,
  validateSuperadminPlanCreate,
  validateSuperadminPlanUpdate,
} = require('../../middleware/validators');
const { normalizeTier } = require('../../services/entitlements');
const { toIso } = require('./utils');

const makeSuperadminPlansRouter = () => {
  const r = express.Router();

  r.get('/superadmin/plans', requireSuperadmin, async (_req, res, next) => {
    try {
      const rows = await db()
        .select(['tier', 'modules_json', 'limits_json', 'price_monthly_etb', 'price_yearly_etb', 'updated_at'])
        .from('plans')
        .orderBy('tier', 'asc');

      const plans = rows.map((p) => ({
        tier: String(p.tier || ''),
        modules: Array.isArray(safeJsonParse(p.modules_json, [])) ? safeJsonParse(p.modules_json, []).map(String) : [],
        limits: safeJsonParse(p.limits_json, {}),
        pricing: {
          monthlyEtb: Number(p.price_monthly_etb || 0) || 0,
          yearlyEtb: Number(p.price_yearly_etb || 0) || 0,
        },
        updatedAt: toIso(p.updated_at),
      }));

      return res.json({ ok: true, plans });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/plans', requireSuperadmin, validateSuperadminPlanCreate, async (req, res, next) => {
    try {
      const { tier: tierRaw, modules: modulesRaw, limits: limitsRaw, pricing } = req.validatedBody || req.body;
      if (!tierRaw) return res.status(400).json({ error: 'tier_required' });
      const tier = tierRaw;

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const modules = Array.isArray(modulesRaw) ? modulesRaw.map(String).filter(Boolean) : [];
      const limits = limitsRaw && typeof limitsRaw === 'object' ? limitsRaw : {};

      const monthlyEtb = Number(pricing?.monthlyEtb ?? 0);
      const yearlyEtb = Number(pricing?.yearlyEtb ?? 0);
      if (!Number.isFinite(monthlyEtb) || monthlyEtb < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
      if (!Number.isFinite(yearlyEtb) || yearlyEtb < 0) return res.status(400).json({ error: 'invalid_yearly_price' });

      const nowIso = new Date().toISOString();
      await db().from('plans').insert({
        tier,
        modules_json: JSON.stringify(modules),
        limits_json: JSON.stringify(limits),
        price_monthly_etb: monthlyEtb,
        price_yearly_etb: yearlyEtb,
        updated_at: nowIso,
      });

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'plans.create',
        summary: `Created plan ${tier}`,
        payload: { tier, monthlyEtb, yearlyEtb, modulesCount: modules.length },
        requestId: req.requestId,
      });

      return res.status(201).json({ ok: true, tier });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/plans/:tier', requireSuperadmin, validateTierParam, validateSuperadminPlanUpdate, async (req, res, next) => {
    try {
      const { tier: tierRaw } = req.validatedParams || req.params;
      const tier = normalizeTier(tierRaw);
      if (!tier) return res.status(400).json({ error: 'tier_required' });

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};

      if (Array.isArray(body?.modules)) patch.modules_json = JSON.stringify(body.modules.map(String));

      if (body && Object.prototype.hasOwnProperty.call(body, 'limits')) {
        if (body.limits && typeof body.limits === 'object') patch.limits_json = JSON.stringify(body.limits);
        else if (body.limits == null) patch.limits_json = JSON.stringify({});
      }

      if (body?.pricing && typeof body.pricing === 'object') {
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'monthlyEtb')) {
          const m = Number(body.pricing.monthlyEtb);
          if (!Number.isFinite(m) || m < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
          patch.price_monthly_etb = m;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'yearlyEtb')) {
          const y = Number(body.pricing.yearlyEtb);
          if (!Number.isFinite(y) || y < 0) return res.status(400).json({ error: 'invalid_yearly_price' });
          patch.price_yearly_etb = y;
        }
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('plans').where({ tier }).update(patch);

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'plans.update',
        summary: `Updated plan ${tier}`,
        payload: { tier, keys: Object.keys(patch).filter((k) => k !== 'updated_at') },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminPlansRouter };
