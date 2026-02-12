const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { uid } = require('../../utils/ids');
const { safeJsonParse, safeJsonStringify } = require('../../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { logAudit } = require('../../utils/logger');

const makeOwnerIntegrationsRouter = ({ requireOwnerAuth }) => {
  const r = express.Router();

  r.get(
    '/owner/integrations/available',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });
        const category = sanitizeText(req.query?.category, { maxLen: 60 });

        const base = db().from('integrations_catalog').where({ is_available: 1 });
        if (category) base.andWhere({ category });
        if (q) {
          base.andWhere((qb) =>
            qb
              .whereRaw('LOWER(code) LIKE ?', [`%${q}%`])
              .orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`])
              .orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]),
          );
        }

        const rows = await base
          .select(['id', 'code', 'name', 'description', 'category', 'integration_type', 'required_tier', 'config_schema_json', 'meta_json', 'updated_at'])
          .orderBy('updated_at', 'desc')
          .limit(300);

        const integrations = (rows || []).map((r0) => ({
          id: String(r0.id),
          code: String(r0.code || ''),
          name: String(r0.name || ''),
          description: r0.description != null ? String(r0.description) : '',
          category: r0.category != null ? String(r0.category) : '',
          integrationType: String(r0.integration_type || 'api_key'),
          requiredTier: r0.required_tier != null ? String(r0.required_tier) : null,
          configSchema: safeJsonParse(r0.config_schema_json, null),
          meta: safeJsonParse(r0.meta_json, {}),
          updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
        }));

        return res.json({ ok: true, integrations });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/owner/integrations',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        const rows = await db()
          .from({ ti: 'tenant_integrations' })
          .leftJoin({ ic: 'integrations_catalog' }, 'ic.id', 'ti.integration_id')
          .select([
            'ti.id',
            'ti.integration_id',
            'ti.status',
            'ti.config_json',
            'ti.installed_at',
            'ti.updated_at',
            'ic.code',
            'ic.name',
            'ic.category',
            'ic.integration_type',
            'ic.is_available',
          ])
          .where({ 'ti.tenant_id': req.tenant.id })
          .orderBy('ti.updated_at', 'desc')
          .limit(500);

        const installed = (rows || []).map((r0) => ({
          id: String(r0.id),
          integrationId: String(r0.integration_id || ''),
          code: r0.code != null ? String(r0.code) : '',
          name: r0.name != null ? String(r0.name) : '',
          category: r0.category != null ? String(r0.category) : '',
          integrationType: r0.integration_type != null ? String(r0.integration_type) : '',
          isAvailable: Boolean(r0.is_available),
          status: String(r0.status || 'installed'),
          config: safeJsonParse(r0.config_json, {}),
          installedAt: r0.installed_at ? new Date(r0.installed_at).toISOString() : '',
          updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
        }));

        return res.json({ ok: true, installed });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/owner/integrations/:id/install',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const integrationId = String(req.params?.id || '').trim();
        if (!integrationId) return res.status(400).json({ error: 'id_required' });

        const ic = await db().select(['id', 'is_available']).from('integrations_catalog').where({ id: integrationId }).first();
        if (!ic) return res.status(404).json({ error: 'not_found' });
        if (!ic.is_available) return res.status(409).json({ error: 'not_available' });

        const nowIso = new Date().toISOString();
        const id = uid('tint');
        const configJson = safeJsonStringify(req.body?.config && typeof req.body.config === 'object' ? req.body.config : {});

        try {
          await db().from('tenant_integrations').insert({
            id,
            tenant_id: req.tenant.id,
            integration_id: integrationId,
            status: 'installed',
            config_json: configJson,
            secrets_json: null,
            installed_at: nowIso,
            updated_at: nowIso,
          });
        } catch (e) {
          const msg = String(e?.message || '').toLowerCase();
          if (msg.includes('duplicate') || msg.includes('unique')) return res.status(409).json({ error: 'already_installed' });
          throw e;
        }

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.integrations.install',
          summary: 'Installed integration',
          payload: { integrationId },
          requestId: req.requestId,
        });

        return res.status(201).json({ ok: true, id });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/owner/integrations/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const integrationId = String(req.params?.id || '').trim();
        if (!integrationId) return res.status(400).json({ error: 'id_required' });

        const row = await db()
          .select(['id', 'config_json', 'status'])
          .from('tenant_integrations')
          .where({ tenant_id: req.tenant.id, integration_id: integrationId })
          .first();
        if (!row) return res.status(404).json({ error: 'not_installed' });

        const patch = { updated_at: new Date().toISOString() };
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
          const s = String(req.body.status || '').trim();
          if (s) patch.status = s;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'config')) {
          const cfg = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
          patch.config_json = safeJsonStringify(cfg);
        }

        await db().from('tenant_integrations').where({ id: String(row.id) }).update(patch);

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.integrations.update',
          summary: 'Updated integration config',
          payload: { integrationId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') },
          requestId: req.requestId,
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.delete(
    '/owner/integrations/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const integrationId = String(req.params?.id || '').trim();
        if (!integrationId) return res.status(400).json({ error: 'id_required' });

        const deleted = await db().from('tenant_integrations').where({ tenant_id: req.tenant.id, integration_id: integrationId }).del();
        if (!deleted) return res.status(404).json({ error: 'not_found' });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.integrations.uninstall',
          summary: 'Uninstalled integration',
          payload: { integrationId },
          requestId: req.requestId,
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerIntegrationsRouter };
