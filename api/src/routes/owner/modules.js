const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { computeTenantEntitlements, normalizeModules, upsertTenantEntitlementsSnapshot } = require('../../services/entitlements');
const { logAudit } = require('../../utils/logger');

const makeOwnerModulesRouter = ({ requireOwnerAuth }) => {
  const r = express.Router();

  r.put(
    '/owner/modules',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const body = req.body && typeof req.body === 'object' ? req.body : null;
        const modsRaw = Array.isArray(body?.modules) ? body.modules : null;
        const normalized0 = modsRaw ? normalizeModules(modsRaw) : [];
        const normalized = normalized0.includes('settings') ? normalized0 : [...normalized0, 'settings'];

        const nextOverride = normalized.length ? JSON.stringify(normalized) : null;
        const nowIso = new Date().toISOString();

        await db().from('tenants').where({ id: req.tenant.id }).update({ enabled_modules_json: nextOverride, updated_at: nowIso });

        const refreshedTenant = await db().select(['id', 'name', 'status', 'trial_ends_at', 'created_at', 'enabled_modules_json']).from('tenants').where({ id: req.tenant.id }).first();
        const tenantForEntitlements = refreshedTenant ? { ...req.tenant, ...refreshedTenant } : req.tenant;

        const ent = await computeTenantEntitlements({ tenant: tenantForEntitlements });
        if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: req.tenant.id, entitlements: ent });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.modules.updated',
          summary: 'Updated enabled modules',
          payload: { modules: normalized },
          requestId: req.requestId,
        });

        return res.json({ ok: true, modules: normalized, entitlements: ent });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerModulesRouter };
