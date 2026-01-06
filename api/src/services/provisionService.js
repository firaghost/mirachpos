const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const cafeCode = (name) => {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, '');
  return (s || 'CAFE').slice(0, 6);
};

const validateSlug = (slug) => {
  const s = String(slug || '').trim().toLowerCase();
  if (!s || !/^[a-z0-9-]{2,32}$/.test(s)) return { ok: false, error: 'invalid_slug' };
  return { ok: true, value: s };
};

const validateEmail = (email) => {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'owner_email_required' };
  return { ok: true, value: e };
};

const provisionTenant = async ({ slug, name, trialDays, ownerName, ownerEmail, ownerPassword, branchName }) => {
  const vSlug = validateSlug(slug);
  if (!vSlug.ok) return vSlug;

  const tenantName = String(name || '').trim();
  if (!tenantName) return { ok: false, error: 'name_required' };

  const vEmail = validateEmail(ownerEmail);
  if (!vEmail.ok) return vEmail;

  const pw = String(ownerPassword || '');
  if (!pw || pw.length < 6) return { ok: false, error: 'owner_password_too_short' };

  const days = Math.max(1, Math.min(30, Number(trialDays || 4)));
  const now = new Date();
  const trialEnds = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const existing = await db().select(['id']).from('tenants').where({ slug: vSlug.value }).first();
  if (existing) return { ok: false, error: 'slug_in_use' };

  const tenantId = makeId('t');
  const defaultBranchId = makeId('b');
  const ownerRoleId = makeId('r_owner');
  const managerRoleId = makeId('r_manager');
  const waiterRoleId = makeId('r_waiter');
  const ownerStaffId = makeId('s_owner');
  const createdAt = now.toISOString();

  const ownerHash = await bcrypt.hash(pw, 10);
  const ownerCode = `${cafeCode(tenantName)}-OWN-0001`;

  await db().transaction(async (trx) => {
    await trx
      .insert({
        id: tenantId,
        slug: vSlug.value,
        name: tenantName,
        status: 'trial',
        trial_ends_at: trialEnds.toISOString(),
        plan: 'trial',
        plan_ends_at: trialEnds.toISOString(),
        created_at: createdAt,
      })
      .into('tenants');

    await trx
      .insert({
        tenant_id: tenantId,
        profile_json: JSON.stringify({
          ownerName: String(ownerName || '').trim(),
          contactName: String(ownerName || '').trim(),
          contactEmail: vEmail.value,
          contactPhone: '',
          address1: '',
          city: '',
          country: '',
          timezone: '',
          currency: '',
        }),
        updated_at: createdAt,
      })
      .into('tenant_profile');

    await trx
      .insert({
        tenant_id: tenantId,
        tier: 'Trial',
        modules_json: JSON.stringify([]),
        cycle: 'Monthly',
        status: 'active',
        method: 'manual',
        next_bill_at: trialEnds.toISOString(),
        amount_etb: 0,
        grace_ends_at: trialEnds.toISOString(),
        updated_at: createdAt,
      })
      .into('tenant_subscription');

    await trx
      .insert({
        id: defaultBranchId,
        tenant_id: tenantId,
        name: String(branchName || 'Main Branch').trim() || 'Main Branch',
        status: 'Open',
        created_at: createdAt,
      })
      .into('branches');

    await trx
      .insert([
        { id: ownerRoleId, tenant_id: tenantId, name: 'Cafe Owner', scope: 'global', permissions: JSON.stringify(['*']), created_at: createdAt },
        { id: managerRoleId, tenant_id: tenantId, name: 'Branch Manager', scope: 'branch', permissions: JSON.stringify(['*']), created_at: createdAt },
        { id: waiterRoleId, tenant_id: tenantId, name: 'Waiter', scope: 'branch', permissions: JSON.stringify(['*']), created_at: createdAt },
      ])
      .into('roles');

    await trx
      .insert({
        id: ownerStaffId,
        tenant_id: tenantId,
        branch_id: null,
        role_id: ownerRoleId,
        role_name: 'Cafe Owner',
        name: String(ownerName || 'Owner').trim() || 'Owner',
        email: vEmail.value,
        phone: '',
        code: ownerCode,
        password_hash: ownerHash,
        pin_hash: null,
        status: 'Active',
        created_at: createdAt,
      })
      .into('staff');

    await trx
      .insert({
        id: makeId('evt'),
        tenant_id: tenantId,
        branch_id: null,
        type: 'tenant_provisioned',
        payload: JSON.stringify({ tenantId: tenantId, slug: vSlug.value, branchId: defaultBranchId, ownerStaffId }),
        at: createdAt,
      })
      .into('events');
  });

  return {
    ok: true,
    tenant: { id: tenantId, slug: vSlug.value, name: tenantName, status: 'trial', trialEndsAt: trialEnds.toISOString() },
    owner: { id: ownerStaffId, email: vEmail.value },
    defaultBranch: { id: defaultBranchId, name: String(branchName || 'Main Branch').trim() || 'Main Branch' },
  };
};

module.exports = { provisionTenant };
