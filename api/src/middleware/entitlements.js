const { db } = require('../db');
const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');
const { config } = require('../config');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const isPendingVerifyBlocked = (ent) => {
  const status = String(ent?.billing?.status || 'active');
  return status === 'pending_verify' || status === 'verification_needed';
};

const safeIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const ensureDueDateDowngrade = async (tenantId) => {
  const sub = await db()
    .select(['tenant_id', 'tier', 'cycle', 'status', 'next_bill_at'])
    .from('tenant_subscription')
    .where({ tenant_id: tenantId })
    .first();
  if (!sub) return { changed: false };

  const status = String(sub.status || 'active').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'active') return { changed: false };

  const nextBillIso = safeIso(sub.next_bill_at);
  if (!nextBillIso) return { changed: false };
  const nextBillMs = new Date(nextBillIso).getTime();
  if (!Number.isFinite(nextBillMs)) return { changed: false };
  if (Date.now() < nextBillMs) return { changed: false };

  const curTier = String(sub.tier || 'Trial');
  if (curTier === 'Basic') return { changed: false };

  const basicPlan = await db().select(['modules_json', 'price_monthly_etb', 'price_yearly_etb']).from('plans').where({ tier: 'Basic' }).first();
  const basicModules = safeJsonParse(basicPlan?.modules_json, []);

  const nowIso = new Date().toISOString();
  const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({
    tier: 'Basic',
    cycle: 'Monthly',
    modules_json: JSON.stringify(Array.isArray(basicModules) ? basicModules : []),
    amount_etb: Number(basicPlan?.price_monthly_etb || 0) || 0,
    status: 'past_due',
    grace_ends_at: graceEndsAt,
    updated_at: nowIso,
  });

  try {
    await db().from('audit_log').insert({
      id: `aud_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
      tenant_id: tenantId,
      branch_id: null,
      actor_staff_id: null,
      actor_role: 'system',
      type: 'billing.auto_downgrade',
      summary: `Auto-downgraded from ${curTier} to Basic due to billing date`,
      payload_json: JSON.stringify({ fromTier: curTier, toTier: 'Basic', nextBillAt: nextBillIso, graceEndsAt }),
      created_at: nowIso,
    });
  } catch {
    // ignore
  }

  return { changed: true };
};

const loadEntitlements = async (req, res, next) => {
  try {
    // Requires tenantMiddleware + requireAuth before this middleware.
    if (!req.tenant || !req.tenant.id) return res.status(500).json({ error: 'tenant_missing' });

    if (config.devBypassAuth) {
      req.entitlements = {
        ok: true,
        tenantId: String(req.tenant.id),
        subscription: { tier: 'Dev', modules: ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'] },
        billing: { status: 'active', graceEndsAt: '' },
        limits: {},
        computedAt: new Date().toISOString(),
      };
      return next();
    }

    const tenantId = String(req.tenant.id);

    // Server-side billing enforcement: auto-downgrade on due date.
    const downgrade = await ensureDueDateDowngrade(tenantId);
    if (downgrade.changed) {
      const ent0 = await computeTenantEntitlements({ tenant: req.tenant });
      if (ent0) await upsertTenantEntitlementsSnapshot({ tenantId, entitlements: ent0 });
      req.entitlements = ent0;
      return next();
    }

    // Prefer snapshot.
    const snap = await db()
      .select(['tenant_id', 'tier', 'modules_json', 'limits_json', 'status', 'grace_ends_at', 'computed_at'])
      .from('tenant_entitlements')
      .where({ tenant_id: tenantId })
      .first();

    if (snap) {
      req.entitlements = {
        ok: true,
        tenantId,
        subscription: { tier: String(snap.tier || 'Trial'), modules: safeJsonParse(snap.modules_json, []) },
        billing: {
          status: String(snap.status || 'active'),
          graceEndsAt: snap.grace_ends_at ? new Date(snap.grace_ends_at).toISOString() : '',
        },
        limits: safeJsonParse(snap.limits_json, {}),
        computedAt: snap.computed_at ? new Date(snap.computed_at).toISOString() : '',
      };
      return next();
    }

    // Compute if missing.
    const ent = await computeTenantEntitlements({ tenant: req.tenant });
    if (ent) await upsertTenantEntitlementsSnapshot({ tenantId, entitlements: ent });
    req.entitlements = ent;
    return next();
  } catch (e) {
    return next(e);
  }
};

const isPastDueBlocked = (ent) => {
  const status = String(ent?.billing?.status || 'active');
  if (status !== 'past_due' && status !== 'canceled') return false;

  const graceEndsAt = String(ent?.billing?.graceEndsAt || '');
  if (!graceEndsAt) return true;
  const t = new Date(graceEndsAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() > t;
};

const requireModule = (moduleKey) => (req, res, next) => {
  const ent = req.entitlements;
  if (!ent) return res.status(500).json({ error: 'entitlements_missing' });

  if (config.devBypassAuth) return next();

  if (isPendingVerifyBlocked(ent)) return res.status(402).json({ error: 'subscription_pending_verify' });
  if (isPastDueBlocked(ent)) return res.status(402).json({ error: 'subscription_inactive' });

  const mods = Array.isArray(ent?.subscription?.modules) ? ent.subscription.modules.map(String) : [];
  if (!mods.includes(String(moduleKey))) return res.status(402).json({ error: 'module_not_enabled', module: String(moduleKey) });
  return next();
};

const enforceBranchLimit = async (req, res, next) => {
  try {
    const ent = req.entitlements;
    if (!ent) return res.status(500).json({ error: 'entitlements_missing' });

    if (isPendingVerifyBlocked(ent)) return res.status(402).json({ error: 'subscription_pending_verify' });
    if (isPastDueBlocked(ent)) return res.status(402).json({ error: 'subscription_inactive' });

    const lim = Number(ent?.limits?.branchLimit);
    if (!Number.isFinite(lim) || lim <= 0) return next();

    const countRow = await db().count({ c: '*' }).from('branches').where({ tenant_id: req.tenant.id }).first();
    const count = Number(countRow?.c ?? countRow?.count ?? countRow?.['count(*)'] ?? 0) || 0;

    // If already at/over limit, block creates.
    if (count >= lim) return res.status(402).json({ error: 'limit_reached', limit: 'branches', max: lim });
    return next();
  } catch (e) {
    return next(e);
  }
};

const enforceStaffLimit = async (req, res, next) => {
  try {
    const ent = req.entitlements;
    if (!ent) return res.status(500).json({ error: 'entitlements_missing' });

    if (isPendingVerifyBlocked(ent)) return res.status(402).json({ error: 'subscription_pending_verify' });
    if (isPastDueBlocked(ent)) return res.status(402).json({ error: 'subscription_inactive' });

    const lim = Number(ent?.limits?.staffLimit);
    if (!Number.isFinite(lim) || lim <= 0) return next();

    const countRow = await db().count({ c: '*' }).from('staff').where({ tenant_id: req.tenant.id });
    const count = Number(countRow?.[0]?.c ?? countRow?.[0]?.count ?? countRow?.[0]?.['count(*)'] ?? 0) || 0;

    if (count >= lim) return res.status(402).json({ error: 'limit_reached', limit: 'staff', max: lim });
    return next();
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  loadEntitlements,
  requireModule,
  enforceBranchLimit,
  enforceStaffLimit,
};
