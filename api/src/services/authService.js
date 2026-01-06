const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot } = require('./entitlements');

const safeIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const maybeDowngradeDueSubscription = async (tenantId) => {
  const sub = await db().select(['tenant_id', 'tier', 'status', 'next_bill_at']).from('tenant_subscription').where({ tenant_id: tenantId }).first();
  if (!sub) return;
  const status = String(sub.status || 'active').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'active') return;

  const nextBillIso = safeIso(sub.next_bill_at);
  if (!nextBillIso) return;
  const nextBillMs = new Date(nextBillIso).getTime();
  if (!Number.isFinite(nextBillMs)) return;
  if (Date.now() < nextBillMs) return;

  const curTier = String(sub.tier || 'Trial');
  if (curTier === 'Basic') return;

  const plan = await db().select(['modules_json', 'price_monthly_etb']).from('plans').where({ tier: 'Basic' }).first();
  const nowIso = new Date().toISOString();
  const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({
    tier: 'Basic',
    cycle: 'Monthly',
    modules_json: String(plan?.modules_json || '[]'),
    amount_etb: Number(plan?.price_monthly_etb || 0) || 0,
    status: 'past_due',
    grace_ends_at: graceEndsAt,
    updated_at: nowIso,
  });
};

const loginWithEmailPassword = async ({ tenantId, email, password, jwtSecret }) => {
  const em = String(email || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!tenantId || !em || !pw) return { ok: false, error: 'invalid_credentials' };

  const tenant = await db()
    .select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at'])
    .from('tenants')
    .where({ id: tenantId })
    .first();

  if (!tenant) return { ok: false, error: 'tenant_not_found' };
  if (String(tenant.status) === 'suspended') return { ok: false, error: 'tenant_suspended' };

  await maybeDowngradeDueSubscription(String(tenant.id));

  const staff = await db()
    .select(['id', 'tenant_id', 'branch_id', 'role_name', 'name', 'email', 'password_hash'])
    .from('staff')
    .where({ tenant_id: tenantId, email: em })
    .first();

  if (!staff) return { ok: false, error: 'invalid_credentials' };

  const match = await bcrypt.compare(pw, String(staff.password_hash || ''));
  if (!match) return { ok: false, error: 'invalid_credentials' };

  const token = jwt.sign(
    {
      tenantId: staff.tenant_id,
      staffId: staff.id,
      role: staff.role_name,
      branchId: staff.branch_id || 'global',
    },
    jwtSecret,
    { expiresIn: '12h' },
  );

  const branchId = staff.branch_id || 'global';
  const branch = await (async () => {
    if (!staff.branch_id) return { id: 'global', name: 'Global' };
    const b = await db().select(['id', 'name']).from('branches').where({ tenant_id: tenantId, id: String(staff.branch_id) }).first();
    if (!b) return { id: String(staff.branch_id), name: '' };
    return { id: String(b.id), name: String(b.name || '') };
  })();

  const ent = await computeTenantEntitlements({ tenant });
  if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: tenant.id, entitlements: ent });

  return {
    ok: true,
    token,
    role: staff.role_name,
    branchId,
    tenantId: String(staff.tenant_id),
    staffId: String(staff.id),
    staffName: String(staff.name || ''),
    tenant: { id: String(tenant.id), slug: String(tenant.slug || ''), name: String(tenant.name || '') },
    branch,
    subscription: ent?.subscription || { tier: 'Trial', modules: [] },
    billing: ent?.billing || { cycle: 'Monthly', status: 'active', method: 'manual', nextBillAt: '', amountEtb: 0, graceEndsAt: '' },
    limits: ent?.limits || {},
  };
};

module.exports = { loginWithEmailPassword };
