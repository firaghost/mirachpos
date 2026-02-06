const { db } = require('../db');
const { config } = require('../config');
const { withCache } = require('../utils/cache');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeTier = (tier) => {
  const t = String(tier || '').trim().toLowerCase();
  if (!t) return 'Trial';
  if (t === 'trial') return 'Trial';
  if (t === 'starter' || t === 'basic') return 'Starter';
  if (t === 'growth') return 'Growth';
  if (t === 'pro' || t === 'enterprise') return 'Pro';
  return String(tier || '').trim();
};

const normalizeModuleKey = (m) => {
  const raw = String(m || '').trim();
  if (!raw) return '';
  const k = raw.toLowerCase().replace(/\s+/g, '_');
  if (k === 'owner-dashboard' || k === 'ownerdashboard' || k === 'owner_dash') return 'owner_dashboard';
  if (k === 'branch' || k === 'branch_management' || k === 'branch_managements') return 'branches';
  if (k === 'report' || k === 'reporting') return 'reports';
  if (k === 'inventory_management') return 'inventory';
  if (k === 'menu_management') return 'menu';
  if (k === 'guest' || k === 'customer' || k === 'customers') return 'guests';
  return k;
};

const normalizeModules = (list) => {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const k = normalizeModuleKey(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
};

const normalizeFeatureKey = (f) => {
  const raw = String(f || '').trim();
  if (!raw) return '';
  return raw.toLowerCase().replace(/\s+/g, '_');
};

const normalizeFeatures = (list) => {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const k = normalizeFeatureKey(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
};

const readGlobalFeatureFlags = async () => {
  const ttl = config?.cacheDefaultTtlSeconds || 60;
  return withCache('feature_flags:enabled:v1', ttl, async () => {
    const rows = await db().from('feature_flags').select(['id']).where({ enabled: 1 });
    return rows.map((r) => String(r.id || '')).filter(Boolean);
  });
};

const defaultEntitlementsForTier = (tier) => {
  const t = normalizeTier(tier);

  // Trial should allow core usage but with limits.
  if (t === 'Trial') {
    return {
      modules: ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'settings'],
      limits: { branchLimit: 1, staffLimit: 5 },
    };
  }

  if (t === 'Starter') {
    return {
      modules: ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings'],
      limits: { branchLimit: 1, staffLimit: 25 },
    };
  }

  if (t === 'Growth') {
    return {
      modules: ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'],
      limits: { branchLimit: 3, staffLimit: 100 },
    };
  }

  // Pro
  return {
    modules: ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'],
    limits: { branchLimit: 999, staffLimit: 9999 },
  };
};

const getPlanDefaults = async (tier) => {
  const t = normalizeTier(tier);
  const row = await db().select(['modules_json', 'limits_json', 'price_monthly_etb', 'price_yearly_etb']).from('plans').where({ tier: t }).first();
  const mods = normalizeModules(safeJsonParse(row?.modules_json, []));
  const base = defaultEntitlementsForTier(t);
  const limitsFromDb = safeJsonParse(row?.limits_json, null);
  return {
    tier: t,
    modules: mods.length ? mods : base.modules,
    limits: limitsFromDb && typeof limitsFromDb === 'object' ? { ...base.limits, ...limitsFromDb } : base.limits,
    pricing: {
      monthlyEtb: Number(row?.price_monthly_etb || 0) || 0,
      yearlyEtb: Number(row?.price_yearly_etb || 0) || 0,
    },
  };
};

const getOrCreateTenantSubscription = async (tenant) => {
  const tenantId = String(tenant?.id || '').trim();
  if (!tenantId) return null;

  const row = await db()
    .select(['tenant_id', 'tier', 'modules_json', 'cycle', 'status', 'method', 'next_bill_at', 'amount_etb', 'grace_ends_at', 'updated_at'])
    .from('tenant_subscription')
    .where({ tenant_id: tenantId })
    .first();
  if (row) {
    // Auto-correct bad historical inference:
    // previously, some tenants had subscriptions created as Basic during an active trial.
    const nowMs = Date.now();
    const trialEndsIso = (() => {
      try {
        return tenant?.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString() : '';
      } catch {
        return '';
      }
    })();
    const trialEndsMs = trialEndsIso ? new Date(trialEndsIso).getTime() : NaN;
    const isTrialActive = Number.isFinite(trialEndsMs) && nowMs < trialEndsMs;

    const curTier = normalizeTier(row?.tier || 'Trial');
    const amountEtb = Number(row?.amount_etb || 0) || 0;
    const looksLikeFreeAutoCreated = amountEtb <= 0.0001 && String(row?.method || 'manual') === 'manual';

    if (isTrialActive && curTier !== 'Trial' && looksLikeFreeAutoCreated) {
      const nowIso = new Date().toISOString();
      const plan = await getPlanDefaults('Trial');
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({
        tier: plan.tier,
        modules_json: JSON.stringify(plan.modules),
        cycle: 'Monthly',
        status: 'active',
        method: String(row?.method || 'manual'),
        next_bill_at: trialEndsIso || nowIso,
        amount_etb: 0,
        grace_ends_at: trialEndsIso || nowIso,
        updated_at: nowIso,
      });

      return db()
        .select(['tenant_id', 'tier', 'modules_json', 'cycle', 'status', 'method', 'next_bill_at', 'amount_etb', 'grace_ends_at', 'updated_at'])
        .from('tenant_subscription')
        .where({ tenant_id: tenantId })
        .first();
    }

    return row;
  }

  const nowIso = new Date().toISOString();
  const inferredTier = (() => {
    const trialEndsAt = (() => {
      try {
        return tenant?.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString() : '';
      } catch {
        return '';
      }
    })();
    const trialEndsMs = trialEndsAt ? new Date(trialEndsAt).getTime() : NaN;
    const isTrialActive = Number.isFinite(trialEndsMs) && Date.now() < trialEndsMs;
    if (isTrialActive) return 'Trial';

    // If tenant has a plan set, prefer it.
    const planRaw = typeof tenant?.plan === 'string' ? tenant.plan.trim() : '';
    const normalized = normalizeTier(planRaw);
    if (normalized && normalized !== 'Trial') return normalized;

    return 'Starter';
  })();
  const plan = await getPlanDefaults(inferredTier);

  const trialEndsAt = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString() : '';
  const nextBillAt = trialEndsAt || nowIso;

  await db().from('tenant_subscription').insert({
    tenant_id: tenantId,
    tier: plan.tier,
    modules_json: JSON.stringify(plan.modules),
    cycle: 'Monthly',
    status: 'active',
    method: 'manual',
    next_bill_at: nextBillAt,
    amount_etb: 0,
    grace_ends_at: nextBillAt,
    updated_at: nowIso,
  });

  return db()
    .select(['tenant_id', 'tier', 'modules_json', 'cycle', 'status', 'method', 'next_bill_at', 'amount_etb', 'grace_ends_at', 'updated_at'])
    .from('tenant_subscription')
    .where({ tenant_id: tenantId })
    .first();
};

const readActiveAddonEntitlements = async (tenantId) => {
  const rows = await db()
    .from({ tas: 'tenant_addon_subscriptions' })
    .leftJoin({ ap: 'addon_packages' }, 'ap.id', 'tas.addon_id')
    .select(['tas.status', 'ap.modules_json', 'ap.limits_json'])
    .where({ 'tas.tenant_id': tenantId, 'tas.status': 'active' });

  const addonModules = [];
  const addonLimits = {};

  for (const r of rows || []) {
    const mods = normalizeModules(safeJsonParse(r?.modules_json, []));
    for (const m of mods) addonModules.push(m);
    const lim = safeJsonParse(r?.limits_json, null);
    if (lim && typeof lim === 'object') Object.assign(addonLimits, lim);
  }

  return {
    modules: normalizeModules(addonModules),
    limits: addonLimits,
  };
};

const computeTenantEntitlements = async ({ tenant, subscriptionRow = null }) => {
  const tenantId = String(tenant?.id || '').trim();
  if (!tenantId) return null;

  const sub = subscriptionRow || (await getOrCreateTenantSubscription(tenant));
  const tier = normalizeTier(sub?.tier || 'Trial');

  const plan = await getPlanDefaults(tier);

  const subModules = normalizeModules(safeJsonParse(sub?.modules_json, []));
  const baseModules = subModules.length ? subModules : plan.modules;

  const addonEnt = await readActiveAddonEntitlements(tenantId);
  const combinedModules = normalizeModules([...(baseModules || []), ...(addonEnt?.modules || [])]);

  // Optional override (treated as override only)
  const override = normalizeModules(safeJsonParse(tenant?.enabled_modules_json, null));
  const effectiveModules = override && override.length ? combinedModules.filter((m) => override.includes(m)) : combinedModules;

  const status = String(sub?.status || 'active');
  const graceEndsAt = sub?.grace_ends_at ? new Date(sub.grace_ends_at).toISOString() : '';

  const globalFeatures = normalizeFeatures(await readGlobalFeatureFlags());
  const tenantFeatures = normalizeFeatures(safeJsonParse(tenant?.features_json, []));
  const effectiveFeatures = Array.from(new Set([...globalFeatures, ...tenantFeatures]));

  const computedAt = new Date().toISOString();

  return {
    ok: true,
    tenantId,
    subscription: {
      tier,
      modules: effectiveModules,
      trialStartAt: tenant?.created_at ? new Date(tenant.created_at).toISOString() : '',
      trialEndsAt: tenant?.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString() : '',
    },
    billing: {
      cycle: String(sub?.cycle || 'Monthly'),
      status,
      method: String(sub?.method || 'manual'),
      nextBillAt: sub?.next_bill_at ? new Date(sub.next_bill_at).toISOString() : '',
      amountEtb: Number(sub?.amount_etb || 0) || 0,
      graceEndsAt,
    },
    limits: { ...(plan.limits || {}), ...(addonEnt?.limits || {}) },
    features: effectiveFeatures,
    pricing: plan.pricing,
    computedAt,
  };
};

const upsertTenantEntitlementsSnapshot = async ({ tenantId, entitlements }) => {
  const id = String(tenantId || '').trim();
  if (!id || !entitlements) return;

  const nowIso = new Date().toISOString();

  await db()
    .from('tenant_entitlements')
    .insert({
      tenant_id: id,
      tier: String(entitlements.subscription?.tier || 'Trial'),
      modules_json: JSON.stringify(entitlements.subscription?.modules || []),
      limits_json: JSON.stringify(entitlements.limits || {}),
      status: String(entitlements.billing?.status || 'active'),
      grace_ends_at: entitlements.billing?.graceEndsAt ? new Date(entitlements.billing.graceEndsAt).toISOString() : null,
      computed_at: nowIso,
    })
    .onConflict('tenant_id')
    .merge({
      tier: String(entitlements.subscription?.tier || 'Trial'),
      modules_json: JSON.stringify(entitlements.subscription?.modules || []),
      limits_json: JSON.stringify(entitlements.limits || {}),
      status: String(entitlements.billing?.status || 'active'),
      grace_ends_at: entitlements.billing?.graceEndsAt ? new Date(entitlements.billing.graceEndsAt).toISOString() : null,
      computed_at: nowIso,
    });
};

module.exports = {
  normalizeTier,
  normalizeModules,
  normalizeFeatures,
  readGlobalFeatureFlags,
  getOrCreateTenantSubscription,
  computeTenantEntitlements,
  upsertTenantEntitlementsSnapshot,
};
