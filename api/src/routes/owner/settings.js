const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { safeJsonParse } = require('../../utils/errors');
const { logAudit } = require('../../utils/logger');

const makeOwnerSettingsRouter = ({ requireOwnerAuth, normalizeOwnerSettings }) => {
  const r = express.Router();

  r.get(
    '/owner/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
        const parsed = safeJsonParse(row?.settings_json, {});
        const settings = parsed && typeof parsed === 'object' ? parsed : {};

        // Ensure UI always sees the tenant's actual business name at least as a default.
        try {
          const bname = String(settings?.business?.businessName || '').trim();
          if (!bname) {
            const trow = await db().select(['name']).from('tenants').where({ id: req.tenant.id }).first();
            const tname = String(trow?.name || '').trim();
            if (tname) {
              settings.business = settings.business && typeof settings.business === 'object' ? settings.business : {};
              settings.business.businessName = tname;
            }
          }
        } catch {
          // ignore
        }
        return res.json({ ok: true, settings });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/owner/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
        const prev = safeJsonParse(row?.settings_json, {});
        const body = req.body?.settings || req.body;
        const nextSettings = normalizeOwnerSettings(body, prev);

        try {
          const rawLogo = String(nextSettings?.receipt?.logoDataUrl || '').trim();
          if (rawLogo) {
            const okPrefix = /^data:image\/(png|jpe?g|webp);base64,/i.test(rawLogo);
            if (!okPrefix) return res.status(400).json({ error: 'invalid_logo' });
            if (rawLogo.length > 900_000) return res.status(400).json({ error: 'logo_too_large' });
          }
        } catch {
          return res.status(400).json({ error: 'invalid_logo' });
        }
        const nowIso = new Date().toISOString();

        try {
          await db()
            .from('owner_settings')
            .insert({ tenant_id: req.tenant.id, settings_json: JSON.stringify(nextSettings), updated_at: nowIso })
            .onConflict('tenant_id')
            .merge({ settings_json: JSON.stringify(nextSettings), updated_at: nowIso });
        } catch (e) {
          try {
            if (req.log && typeof req.log.error === 'function') {
              req.log.error({ err: e, tenantId: req.tenant?.id }, 'Failed to save owner settings');
            }
          } catch {
            // ignore
          }

          const code = String(e?.code || '');
          const msg = String(e?.message || '');
          if (code === 'ER_NO_SUCH_TABLE' || msg.toLowerCase().includes('owner_settings')) {
            return res.status(500).json({
              error: 'db_schema_outdated',
              message: 'Missing required table owner_settings. Run database migrations.',
            });
          }
          return next(e);
        }

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.settings.updated',
          summary: 'Updated owner settings',
          payload: null,
          requestId: req.requestId,
        });

        return res.json({ ok: true, settings: nextSettings });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerSettingsRouter };
