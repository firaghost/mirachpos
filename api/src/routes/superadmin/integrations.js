const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { makeId } = require('../../utils/ids');
const { safeJsonParse } = require('../../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { logAudit } = require('../../utils/logger');
const {
  validateSuperadminIntegrationsQuery,
  validateSuperadminIntegrationCreate,
  validateSuperadminIntegrationUpdate,
  validateSuperadminAddonQuery,
  validateSuperadminAddonCreate,
  validateSuperadminAddonUpdate,
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

const makeSuperadminIntegrationsRouter = () => {
  const r = express.Router();

  r.get('/superadmin/integrations', requireSuperadmin, validateSuperadminIntegrationsQuery, async (req, res, next) => {
    try {
      const { q: qRaw, category: categoryRaw, available: availableParam } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const category = sanitizeText(categoryRaw, { maxLen: 60 });
      const availableRaw = typeof availableParam === 'string' ? availableParam.trim().toLowerCase() : '';

      const base = db().from('integrations_catalog');
      if (category) base.where({ category });
      if (availableRaw === 'true') base.where({ is_available: 1 });
      if (availableRaw === 'false') base.where({ is_available: 0 });

      if (q) {
        base.andWhere((qb) => qb.whereRaw('LOWER(code) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]));
      }

      const rows = await base
        .select(['id', 'code', 'name', 'description', 'category', 'integration_type', 'is_available', 'required_tier', 'config_schema_json', 'meta_json', 'created_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const integrations = (rows || []).map((r0) => ({
        id: String(r0.id),
        code: String(r0.code || ''),
        name: String(r0.name || ''),
        description: r0.description != null ? String(r0.description) : '',
        category: r0.category != null ? String(r0.category) : '',
        integrationType: String(r0.integration_type || 'api_key'),
        isAvailable: Boolean(r0.is_available),
        requiredTier: r0.required_tier != null ? String(r0.required_tier) : null,
        configSchema: safeJsonParse(r0.config_schema_json, null),
        meta: safeJsonParse(r0.meta_json, {}),
        createdAt: toIso(r0.created_at),
        updatedAt: toIso(r0.updated_at),
      }));

      return res.json({ ok: true, integrations });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/integrations', requireSuperadmin, validateSuperadminIntegrationCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('integrations_catalog').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof body?.category === 'string' ? body.category.trim() : null;
      const description = typeof body?.description === 'string' ? body.description.trim() : null;
      const integrationType = typeof body?.integrationType === 'string' ? body.integrationType.trim() : 'api_key';
      const requiredTier = typeof body?.requiredTier === 'string' ? body.requiredTier.trim() : null;
      const isAvailable = body?.isAvailable !== false;

      const configSchema = body?.configSchema && typeof body.configSchema === 'object' ? body.configSchema : null;
      const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};

      const nowIso = new Date().toISOString();
      const id = makeId('int');
      await db().from('integrations_catalog').insert({
        id,
        code,
        name,
        description,
        category,
        integration_type: integrationType,
        is_available: isAvailable ? 1 : 0,
        required_tier: requiredTier,
        config_schema_json: configSchema != null ? JSON.stringify(configSchema) : null,
        meta_json: JSON.stringify(meta || {}),
        created_at: nowIso,
        updated_at: nowIso,
      });

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'integrations.create',
        summary: `Created integration ${code}`,
        payload: { integrationId: id, code },
        requestId: req.requestId,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/integrations/:id', requireSuperadmin, validateIdParam, validateSuperadminIntegrationUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.description === 'string') patch.description = body.description.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim();
      if (typeof body?.integrationType === 'string') patch.integration_type = body.integrationType.trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'isAvailable')) patch.is_available = body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'requiredTier')) patch.required_tier = typeof body.requiredTier === 'string' ? body.requiredTier.trim() : null;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'configSchema')) {
        const v = body.configSchema;
        patch.config_schema_json = v && typeof v === 'object' ? JSON.stringify(v) : null;
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'meta')) {
        const v = body.meta;
        patch.meta_json = v && typeof v === 'object' ? JSON.stringify(v) : JSON.stringify({});
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('integrations_catalog').where({ id: trimmedId }).update(patch);

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'integrations.update',
        summary: `Updated integration ${String(existing.code || trimmedId)}`,
        payload: { integrationId: trimmedId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/integrations/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_integrations').where({ integration_id: trimmedId }).del();
      await db().from('integrations_catalog').where({ id: trimmedId }).del();

      const nowIso = new Date().toISOString();
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'integrations.delete',
        summary: `Deleted integration ${String(existing.code || trimmedId)}`,
        payload: { integrationId: trimmedId },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/integrations/:id/tenants', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const integ = await db().select(['id', 'code', 'name']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!integ) return res.status(404).json({ error: 'not_found' });

      const rows = await db()
        .from({ ti: 'tenant_integrations' })
        .leftJoin({ t: 'tenants' }, 't.id', 'ti.tenant_id')
        .select(['ti.id', 'ti.tenant_id', 't.name as tenant_name', 't.slug as tenant_slug', 'ti.status', 'ti.installed_at', 'ti.updated_at'])
        .where({ 'ti.integration_id': trimmedId })
        .orderBy('ti.updated_at', 'desc')
        .limit(1000);

      const installs = (rows || []).map((r0) => ({
        id: String(r0.id),
        tenantId: String(r0.tenant_id || ''),
        tenantName: r0.tenant_name != null ? String(r0.tenant_name) : '',
        tenantSlug: r0.tenant_slug != null ? String(r0.tenant_slug) : '',
        status: String(r0.status || ''),
        installedAt: toIso(r0.installed_at),
        updatedAt: toIso(r0.updated_at),
      }));

      return res.json({ ok: true, integration: { id: String(integ.id), code: String(integ.code || ''), name: String(integ.name || '') }, installs });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/addons', requireSuperadmin, validateSuperadminAddonQuery, async (req, res, next) => {
    try {
      const { q: qRaw, category: categoryRaw, available: availableParam } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const category = sanitizeText(categoryRaw, { maxLen: 60 });
      const availableRaw = typeof availableParam === 'string' ? availableParam.trim().toLowerCase() : '';

      const base = db().from('addon_packages');
      if (category) base.where({ category });
      if (availableRaw === 'true') base.where({ is_available: 1 });
      if (availableRaw === 'false') base.where({ is_available: 0 });
      if (q) {
        base.andWhere((qb) => qb.whereRaw('LOWER(code) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]));
      }

      const rows = await base
        .select([
          'id',
          'code',
          'name',
          'description',
          'category',
          'price_monthly_etb',
          'price_yearly_etb',
          'setup_fee_etb',
          'modules_json',
          'limits_json',
          'meta_json',
          'is_available',
          'availability_tier',
          'created_at',
          'updated_at',
        ])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const addons = (rows || []).map((a) => ({
        id: String(a.id),
        code: String(a.code || ''),
        name: String(a.name || ''),
        description: a.description != null ? String(a.description) : '',
        category: a.category != null ? String(a.category) : '',
        pricing: {
          monthlyEtb: Number(a.price_monthly_etb || 0) || 0,
          yearlyEtb: Number(a.price_yearly_etb || 0) || 0,
          setupFeeEtb: Number(a.setup_fee_etb || 0) || 0,
        },
        modules: safeJsonParse(a.modules_json, []),
        limits: safeJsonParse(a.limits_json, {}),
        meta: safeJsonParse(a.meta_json, {}),
        isAvailable: Boolean(a.is_available),
        availabilityTier: a.availability_tier != null ? String(a.availability_tier) : null,
        createdAt: toIso(a.created_at),
        updatedAt: toIso(a.updated_at),
      }));

      return res.json({ ok: true, addons });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/addons', requireSuperadmin, validateSuperadminAddonCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('addon_packages').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof body?.category === 'string' ? body.category.trim() : null;
      const description = typeof body?.description === 'string' ? body.description.trim() : null;
      const availabilityTier = typeof body?.availabilityTier === 'string' ? body.availabilityTier.trim() : null;
      const isAvailable = body?.isAvailable !== false;

      const pricing = body?.pricing && typeof body.pricing === 'object' ? body.pricing : {};
      const monthlyEtb = Number(pricing.monthlyEtb || 0) || 0;
      const yearlyEtb = Number(pricing.yearlyEtb || 0) || 0;
      const setupFeeEtb = Number(pricing.setupFeeEtb || 0) || 0;
      if (monthlyEtb < 0 || yearlyEtb < 0 || setupFeeEtb < 0) return res.status(400).json({ error: 'invalid_pricing' });

      const modules = Array.isArray(body?.modules) ? body.modules.map(String).filter(Boolean) : [];
      const limits = body?.limits && typeof body.limits === 'object' ? body.limits : {};
      const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};

      const nowIso = new Date().toISOString();
      const id = makeId('add');
      await db().from('addon_packages').insert({
        id,
        code,
        name,
        description,
        category,
        price_monthly_etb: monthlyEtb,
        price_yearly_etb: yearlyEtb,
        setup_fee_etb: setupFeeEtb,
        modules_json: JSON.stringify(modules),
        limits_json: JSON.stringify(limits),
        meta_json: JSON.stringify(meta),
        is_available: isAvailable ? 1 : 0,
        availability_tier: availabilityTier,
        created_at: nowIso,
        updated_at: nowIso,
      });

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'addons.create',
        summary: `Created add-on ${code}`,
        payload: { addonId: id, code },
        requestId: req.requestId,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/addons/:id', requireSuperadmin, validateIdParam, validateSuperadminAddonUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.description === 'string') patch.description = body.description.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'isAvailable')) patch.is_available = body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'availabilityTier')) {
        patch.availability_tier = typeof body.availabilityTier === 'string' ? body.availabilityTier.trim() : null;
      }

      if (body?.pricing && typeof body.pricing === 'object') {
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'monthlyEtb')) {
          const v = Number(body.pricing.monthlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
          patch.price_monthly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'yearlyEtb')) {
          const v = Number(body.pricing.yearlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_yearly_price' });
          patch.price_yearly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'setupFeeEtb')) {
          const v = Number(body.pricing.setupFeeEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_setup_fee' });
          patch.setup_fee_etb = v;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body || {}, 'modules')) {
        const modules = Array.isArray(body.modules) ? body.modules.map(String).filter(Boolean) : [];
        patch.modules_json = JSON.stringify(modules);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'limits')) {
        const limits = body.limits && typeof body.limits === 'object' ? body.limits : {};
        patch.limits_json = JSON.stringify(limits);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'meta')) {
        const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
        patch.meta_json = JSON.stringify(meta);
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('addon_packages').where({ id: trimmedId }).update(patch);

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'addons.update',
        summary: `Updated add-on ${String(existing.code || trimmedId)}`,
        payload: { addonId: trimmedId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/addons/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_addon_subscriptions').where({ addon_id: trimmedId }).del();
      await db().from('addon_packages').where({ id: trimmedId }).del();

      const nowIso = new Date().toISOString();
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'addons.delete',
        summary: `Deleted add-on ${String(existing.code || trimmedId)}`,
        payload: { addonId: trimmedId },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminIntegrationsRouter };
