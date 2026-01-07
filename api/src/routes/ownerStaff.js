const express = require('express');
const bcrypt = require('bcryptjs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const { loadEntitlements, requireModule, enforceStaffLimit } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');

const roleKindFromName = (name) => {
  const n = String(name || '').toLowerCase();
  if (n.includes('owner') || n.includes('super')) return 'super';
  if (n.includes('manager')) return 'manager';
  if (n.includes('kitchen') || n.includes('chef')) return 'kitchen';
  if (n.includes('wait') || n.includes('server')) return 'server';
  if (n.includes('barista') || n.includes('bar')) return 'barista';
  return 'other';
};

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

const logAudit = async ({ tenantId, branchId, actorStaffId, actorRole, type, summary, payload }) => {
  try {
    await db().from('audit_log').insert({
      id: makeId('aud'),
      tenant_id: tenantId,
      branch_id: branchId || null,
      actor_staff_id: actorStaffId || null,
      actor_role: actorRole || null,
      type,
      summary: summary || null,
      payload_json: payload != null ? JSON.stringify(payload) : null,
      created_at: nowIso(),
    });
  } catch {
    // ignore
  }
};

const randomCode = (len) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const cafeCode = (name) => {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, '');
  return (s || 'CAFE').slice(0, 6);
};

const staffRoleCode = (roleName) => {
  const r = String(roleName || '').toLowerCase();
  if (r.includes('owner')) return 'OWN';
  if (r.includes('manager')) return 'MGR';
  if (r.includes('wait')) return 'WTR';
  if (r.includes('kitchen') || r.includes('chef')) return 'KDS';
  if (r.includes('bar')) return 'BAR';
  return 'STF';
};

const nextStaffCode = async (trx, { tenantId, cafeName, roleName }) => {
  const c = cafeCode(cafeName);
  const r = staffRoleCode(roleName);
  const prefix = `${c}-${r}-`;

  const rows = await trx
    .from('staff')
    .where({ tenant_id: tenantId })
    .andWhere('code', 'like', `${prefix}%`)
    .select(['code']);

  let max = 0;
  for (const row of rows) {
    const code = String(row?.code || '');
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
};

const ensureDefaultRoles = async (trx, tenantId) => {
  const defaults = [
    {
      idPrefix: 'r_owner',
      name: 'Cafe Owner',
      scope: 'global',
      permissions: [
        'roles.read',
        'roles.create',
        'roles.update',
        'roles.delete',
        'invites.read',
        'invites.create',
        'invites.delete',
        'branches.read',
        'branches.create',
        'branches.update',
        'branches.delete',
        'staff.read',
        'staff.create',
        'staff.update',
        'staff.delete',
        'staff.activity.read',
        'reports.read',
        'reports.export',
        'manager.settings.read',
        'manager.settings.write',
        'finance.read',
        'finance.write',
        'menu.manage',
        'inventory.manage',
        'settings.manage',
      ],
    },
    {
      idPrefix: 'r_manager',
      name: 'Branch Manager',
      scope: 'branch',
      permissions: [
        'staff.read',
        'staff.create',
        'staff.update',
        'staff.delete',
        'staff.activity.read',
        'reports.read',
        'reports.export',
        'manager.settings.read',
        'manager.settings.write',
        'orders.read',
        'orders.void',
        'orders.refund',
        'payments.read',
        'finance.read',
        'inventory.read',
        'inventory.update',
        'kds.view',
        'kds.configure',
      ],
    },
    {
      idPrefix: 'r_waiter',
      name: 'Waiter',
      scope: 'branch',
      permissions: ['orders.create', 'orders.read', 'orders.update', 'payments.process'],
    },
    {
      idPrefix: 'r_kitchen',
      name: 'Kitchen',
      scope: 'branch',
      permissions: ['kds.view', 'kds.update'],
    },
    {
      idPrefix: 'r_barista',
      name: 'Barista',
      scope: 'branch',
      permissions: ['orders.create', 'orders.read', 'kds.view'],
    },
  ];

  const existing = await trx.from('roles').where({ tenant_id: tenantId }).select(['id', 'name', 'scope', 'permissions']);
  const existingByName = new Map(existing.map((x) => [String(x.name || ''), x]));
  const createdAt = nowIso();

  for (const d of defaults) {
    const ex = existingByName.get(d.name);
    if (!ex) {
      // eslint-disable-next-line no-await-in-loop
      await trx.from('roles').insert({
        id: makeId(d.idPrefix),
        tenant_id: tenantId,
        name: d.name,
        scope: d.scope,
        permissions: JSON.stringify(d.permissions),
        created_at: createdAt,
      });
      continue;
    }

    // If a default role exists but still uses wildcard/empty permissions, upgrade it.
    const current = Array.isArray(safeJsonParse(ex.permissions, [])) ? safeJsonParse(ex.permissions, []).map(String) : [];
    const shouldUpgrade = current.length === 0 || (current.length === 1 && current[0] === '*');
    if (!shouldUpgrade) continue;

    // eslint-disable-next-line no-await-in-loop
    await trx.from('roles').where({ tenant_id: tenantId, id: String(ex.id) }).update({
      scope: d.scope,
      permissions: JSON.stringify(d.permissions),
    });
  }
};

const makeOwnerStaffRouter = () => {
  const r = express.Router();

  r.get(
    '/owner/roles',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('roles.read'),
    async (req, res, next) => {
    try {
      try {
        await db().transaction(async (trx) => {
          await ensureDefaultRoles(trx, req.tenant.id);
        });
      } catch {
        // ignore
      }

      const rows = await db()
        .select(['id', 'name', 'scope', 'permissions'])
        .from('roles')
        .where({ tenant_id: req.tenant.id })
        .orderBy('name', 'asc');

      const roles = rows.map((x) => ({
        id: String(x.id),
        name: String(x.name),
        scope: x.scope === 'global' ? 'global' : 'branch',
        permissions: Array.isArray(safeJsonParse(x.permissions, [])) ? safeJsonParse(x.permissions, []).map(String) : [],
      }));

      return res.json({ ok: true, roles });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.post(
    '/owner/roles',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('roles.create'),
    async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const scope = req.body?.scope === 'global' ? 'global' : 'branch';
      const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [];
      if (!name) return res.status(400).json({ error: 'name_required' });

      const id = makeId('role');
      const createdAt = nowIso();
      await db().from('roles').insert({
        id,
        tenant_id: req.tenant.id,
        name,
        scope,
        permissions: JSON.stringify(permissions),
        created_at: createdAt,
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'role_created',
        summary: `Created role ${name}`,
        payload: { roleId: id, name, scope },
      });

      return res.status(201).json({ ok: true, role: { id, name, scope, permissions } });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.put(
    '/owner/roles/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('roles.update'),
    async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id']).from('roles').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.scope === 'string') patch.scope = req.body.scope === 'global' ? 'global' : 'branch';
      if (Array.isArray(req.body?.permissions)) patch.permissions = JSON.stringify(req.body.permissions.map(String));

      if (Object.keys(patch).length === 0) return res.json({ ok: true });

      await db().from('roles').where({ tenant_id: req.tenant.id, id }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'role_updated',
        summary: 'Updated role',
        payload: { roleId: id },
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.delete(
    '/owner/roles/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('roles.delete'),
    async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const existing = await db().select(['id']).from('roles').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('roles').where({ tenant_id: req.tenant.id, id }).delete();

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'role_deleted',
        summary: 'Deleted role',
        payload: { roleId: id },
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.get(
    '/owner/invites',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('invites.read'),
    async (req, res, next) => {
    try {
      const rows = await db()
        .select([
          'i.id',
          'i.code',
          'i.role_name',
          'i.branch_id',
          'i.created_at',
          'i.expires_at',
          'i.used_at',
          's.email as used_by_email',
        ])
        .from({ i: 'owner_invites' })
        .leftJoin({ s: 'staff' }, function joinStaff() {
          this.on('s.id', '=', 'i.used_by_staff_id').andOn('s.tenant_id', '=', 'i.tenant_id');
        })
        .where({ 'i.tenant_id': req.tenant.id })
        .orderBy('i.created_at', 'desc');

      const invites = rows.map((x) => ({
        id: String(x.id),
        code: String(x.code),
        roleName: String(x.role_name),
        branchId: x.branch_id ? String(x.branch_id) : '',
        createdAt: x.created_at ? new Date(x.created_at).toISOString() : '',
        expiresAt: x.expires_at ? new Date(x.expires_at).toISOString() : '',
        usedAt: x.used_at ? new Date(x.used_at).toISOString() : '',
        usedByEmail: x.used_by_email ? String(x.used_by_email) : '',
      }));

      return res.json({ ok: true, invites });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.post(
    '/owner/invites',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requireRole('Cafe Owner'),
    requirePermission('invites.create'),
    async (req, res, next) => {
    try {
      const roleName = typeof req.body?.roleName === 'string' ? req.body.roleName.trim() : '';
      const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId.trim() : '';
      const expiresInDays = Number(req.body?.expiresInDays || 7);
      if (!roleName) return res.status(400).json({ error: 'role_required' });

      const id = makeId('inv');
      const createdAt = nowIso();
      const exp = new Date(Date.now() + Math.max(1, Math.min(14, expiresInDays)) * 24 * 60 * 60 * 1000).toISOString();

      let code = randomCode(8);
      // retry on collision
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await db().select(['code']).from('owner_invites').where({ code }).first();
        if (!exists) break;
        code = randomCode(8);
      }

      await db().from('owner_invites').insert({
        id,
        tenant_id: req.tenant.id,
        code,
        role_name: roleName,
        branch_id: branchId || null,
        created_at: createdAt,
        expires_at: exp,
        used_at: null,
        used_by_staff_id: null,
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: branchId || null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'invite_created',
        summary: `Created invite ${code}`,
        payload: { inviteId: id, code, roleName, branchId: branchId || null, expiresAt: exp },
      });

      return res.status(201).json({ ok: true, invite: { id, code, roleName, branchId, createdAt, expiresAt: exp } });
    } catch (e) {
      return next(e);
    }
    }
  );

  r.get('/owner/staff', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), async (req, res, next) => {
    try {
      if (!requireOwner(req, res)) return;

      try {
        await db().transaction(async (trx) => {
          await ensureDefaultRoles(trx, req.tenant.id);
        });
      } catch {
        // ignore
      }

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const roleId = typeof req.query?.roleId === 'string' ? req.query.roleId.trim() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

      const page = Math.max(1, Number(req.query?.page || 1) || 1);
      const pageSize = Math.max(1, Math.min(50, Number(req.query?.pageSize || 20) || 20));
      const offset = (page - 1) * pageSize;

      const rolesRows = await db().select(['id', 'name', 'scope', 'permissions']).from('roles').where({ tenant_id: req.tenant.id });
      const roles = rolesRows.map((x) => ({
        id: String(x.id),
        name: String(x.name),
        scope: x.scope === 'global' ? 'global' : 'branch',
        permissions: Array.isArray(safeJsonParse(x.permissions, [])) ? safeJsonParse(x.permissions, []).map(String) : [],
      }));

      const branchesRows = await db().select(['id', 'name', 'status']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc');
      const branches = branchesRows.map((b) => ({ id: String(b.id), name: String(b.name), status: String(b.status || 'Open') }));

      let base = db().from('staff').where({ tenant_id: req.tenant.id });
      if (roleId) base = base.andWhere('role_id', roleId);
      if (status) base = base.andWhere('status', status);
      if (branchId) base = base.andWhere('branch_id', branchId);
      if (q) {
        base = base.andWhere((b) => {
          b.where('name', 'like', `%${q}%`).orWhere('email', 'like', `%${q}%`).orWhere('code', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`);
        });
      }

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base
        .clone()
        .select(['id', 'code', 'name', 'email', 'phone', 'branch_id', 'role_id', 'role_name', 'status', 'last_login_at', 'created_at'])
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      const staff = rows.map((s) => {
        const lastLoginAt = s.last_login_at ? new Date(s.last_login_at).toISOString() : '';
        const lastLoginLabel = lastLoginAt ? new Date(lastLoginAt).toLocaleString() : 'Never';
        const createdAt = s.created_at ? new Date(s.created_at).toISOString() : '';
        return {
          id: String(s.id),
          code: String(s.code || ''),
          name: String(s.name || ''),
          email: String(s.email || ''),
          phone: String(s.phone || ''),
          branchId: s.branch_id ? String(s.branch_id) : 'global',
          roleId: String(s.role_id || ''),
          roleName: String(s.role_name || ''),
          roleKind: roleKindFromName(String(s.role_name || '')),
          status: s.status || 'Active',
          lastLoginAt,
          lastLoginLabel,
          createdAt,
        };
      });

      const stats = {
        superAdmins: staff.filter((x) => x.roleKind === 'super').length,
        managers: staff.filter((x) => x.roleKind === 'manager').length,
        baristasServers: staff.filter((x) => x.roleKind === 'barista' || x.roleKind === 'server').length,
        kitchen: staff.filter((x) => x.roleKind === 'kitchen').length,
      };

      return res.json({
        ok: true,
        staff,
        roles,
        branches,
        stats,
        page,
        pageSize,
        total,
        meta: { q, roleId, status, branchId, generatedAt: nowIso() },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/owner/staff', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), enforceStaffLimit, async (req, res, next) => {
    try {
      if (!requireOwner(req, res)) return;

      try {
        await db().transaction(async (trx) => {
          await ensureDefaultRoles(trx, req.tenant.id);
        });
      } catch {
        // ignore
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
      const roleId = typeof req.body?.roleId === 'string' ? req.body.roleId.trim() : '';
      const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId.trim() : '';
      const status = typeof req.body?.status === 'string' ? req.body.status.trim() : 'Active';

      if (!name || !email) return res.status(400).json({ error: 'name_email_required' });
      if (!roleId) return res.status(400).json({ error: 'role_required' });

      const role = await db().select(['id', 'name']).from('roles').where({ tenant_id: req.tenant.id, id: roleId }).first();
      if (!role) return res.status(400).json({ error: 'invalid_role' });

      const tempPassword = password ? '' : randomCode(10);
      const finalPassword = password || tempPassword;
      const passwordHash = await bcrypt.hash(finalPassword, 10);

      const tempPin = pin ? '' : '';
      const pinHash = pin ? await bcrypt.hash(String(pin), 10) : null;

      const id = makeId('stf');
      const createdAt = nowIso();

      const out = await db().transaction(async (trx) => {
        let effectiveCode = code || '';
        if (!effectiveCode) {
          for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const cand = await nextStaffCode(trx, { tenantId: req.tenant.id, cafeName: req.tenant.name, roleName: String(role.name) });
            // eslint-disable-next-line no-await-in-loop
            const exists = await trx.from('staff').where({ tenant_id: req.tenant.id, code: cand }).select(['id']).first();
            if (!exists) {
              effectiveCode = cand;
              break;
            }
          }
        }

        await trx.from('staff').insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: branchId || null,
          role_id: roleId,
          role_name: String(role.name),
          name,
          email,
          phone: phone || null,
          code: effectiveCode || null,
          password_hash: passwordHash,
          pin_hash: pinHash,
          status: status || 'Active',
          created_at: createdAt,
          updated_at: createdAt,
        });
        return { effectiveCode };
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: branchId || null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'staff_created',
        summary: `Created staff ${name}`,
        payload: { staffId: id, roleId, roleName: String(role.name) },
      });

      return res.status(201).json({ ok: true, id, code: out.effectiveCode || '', tempPassword: tempPassword || undefined, tempPin: tempPin || undefined });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/owner/staff/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), async (req, res, next) => {
    try {
      if (!requireOwner(req, res)) return;

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const staff = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, id }).first();
      if (!staff) return res.status(404).json({ error: 'not_found' });

      const patch = {};

      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.email === 'string') patch.email = req.body.email.trim().toLowerCase();
      if (typeof req.body?.phone === 'string') patch.phone = req.body.phone.trim();
      if (typeof req.body?.code === 'string') patch.code = req.body.code.trim();
      if (typeof req.body?.status === 'string') patch.status = req.body.status.trim();

      if (typeof req.body?.branchId === 'string') patch.branch_id = req.body.branchId.trim() || null;

      if (typeof req.body?.roleId === 'string') {
        const roleId = req.body.roleId.trim();
        const role = await db().select(['id', 'name']).from('roles').where({ tenant_id: req.tenant.id, id: roleId }).first();
        if (!role) return res.status(400).json({ error: 'invalid_role' });
        patch.role_id = roleId;
        patch.role_name = String(role.name);
      }

      let tempPin = '';
      if (req.body?.resetPin) {
        const newPin = randomCode(6);
        tempPin = newPin;
        patch.pin_hash = await bcrypt.hash(newPin, 10);
      } else if (typeof req.body?.pin === 'string') {
        const pin = req.body.pin.trim();
        if (pin) patch.pin_hash = await bcrypt.hash(pin, 10);
      }

      patch.updated_at = nowIso();

      await db().from('staff').where({ tenant_id: req.tenant.id, id }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId: patch.branch_id || null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'staff_updated',
        summary: 'Updated staff',
        payload: { staffId: id },
      });

      return res.json({ ok: true, tempPin: tempPin || undefined });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeOwnerStaffRouter };
