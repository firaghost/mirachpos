const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');

const makeOwnerProfileRouter = ({ requireOwnerAuth }) => {
  const r = express.Router();

  r.get(
    '/owner/profile',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const staff = await db()
          .select(['id', 'name', 'email', 'phone', 'status', 'role_name', 'branch_id', 'created_at', 'last_login_at'])
          .from('staff')
          .where({ tenant_id: req.tenant.id, id: String(req.auth.staffId) })
          .first();

        if (!staff) return res.status(404).json({ error: 'staff_not_found' });

        return res.json({
          ok: true,
          tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name, status: req.tenant.status },
          profile: {
            id: staff.id,
            name: staff.name,
            email: staff.email,
            phone: staff.phone || '',
            status: staff.status,
            role: staff.role_name,
            branchId: staff.branch_id || 'global',
            createdAt: staff.created_at || null,
            lastLoginAt: staff.last_login_at || null,
          },
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/owner/profile',
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
        const profile = body && body.profile && typeof body.profile === 'object' ? body.profile : null;
        if (!profile) return res.status(400).json({ error: 'invalid_profile' });

        const normalized = {
          contactEmail: typeof profile.contactEmail === 'string' ? profile.contactEmail.trim() : '',
          contactPhone: typeof profile.contactPhone === 'string' ? profile.contactPhone.trim() : '',
          address1: typeof profile.address1 === 'string' ? profile.address1.trim() : '',
          city: typeof profile.city === 'string' ? profile.city.trim() : '',
          country: typeof profile.country === 'string' ? profile.country.trim() : '',
          timezone: typeof profile.timezone === 'string' ? profile.timezone.trim() : '',
          currency: typeof profile.currency === 'string' ? profile.currency.trim() : '',
        };

        const nowIso = new Date().toISOString();
        await db()
          .from('tenant_profile')
          .insert({ tenant_id: req.tenant.id, profile_json: JSON.stringify(normalized), updated_at: nowIso })
          .onConflict('tenant_id')
          .merge({ profile_json: JSON.stringify(normalized), updated_at: nowIso });

        return res.json({ ok: true, profile: normalized });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/owner/onboarding',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const onboardingRow = await db()
          .select(['completed', 'completed_at'])
          .from('owner_onboarding')
          .where({ tenant_id: req.tenant.id })
          .first();
        const completed = onboardingRow ? Boolean(onboardingRow.completed) : false;

        const profileRow = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: req.tenant.id }).first();
        const profile = (() => {
          try {
            return profileRow?.profile_json ? JSON.parse(String(profileRow.profile_json)) : {};
          } catch {
            return {};
          }
        })();

        const branchesCountRow = await db().count({ c: '*' }).from('branches').where({ tenant_id: req.tenant.id }).first();
        const rawCount = branchesCountRow ? (branchesCountRow.c ?? branchesCountRow.count ?? branchesCountRow['count(*)']) : 0;
        const branchesCount = Number(rawCount || 0) || 0;

        const steps = {
          profile: Boolean(profile && profile.contactPhone && profile.address1 && profile.city && profile.country),
          branches: branchesCount > 0,
        };

        const completedAt = onboardingRow?.completed_at || '';

        return res.json({
          ok: true,
          tenant: { id: req.tenant.id, name: req.tenant.name, status: req.tenant.status, profile },
          onboarding: {
            completed,
            completedAt,
            steps,
            counts: { branches: branchesCount },
          },
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/owner/onboarding/complete',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const nowIso = new Date().toISOString();
        await db()
          .from('owner_onboarding')
          .insert({ tenant_id: req.tenant.id, completed: true, completed_at: nowIso, updated_at: nowIso })
          .onConflict('tenant_id')
          .merge({ completed: true, completed_at: nowIso, updated_at: nowIso });

        return res.json({ ok: true, onboarding: { completed: true, completedAt: nowIso } });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerProfileRouter };
