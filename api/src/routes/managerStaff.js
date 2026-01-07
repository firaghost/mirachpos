const express = require('express');
const bcrypt = require('bcryptjs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const { loadEntitlements, requireModule, enforceStaffLimit } = require('../middleware/entitlements');
const { requirePermission } = require('../middleware/permissions');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');

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

const randomPin = (len = 6) => {
  const digits = '0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += digits[Math.floor(Math.random() * digits.length)];
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

const makeManagerStaffRouter = () => {
  const r = express.Router();

  const requireManagerOrOwner = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const role = String(req.auth?.role || '').trim();
    const r = role.toLowerCase();
    const isAllowed = r === 'branch manager' || r === 'cafe owner' || r === 'manager' || r.includes('manager') || r.includes('owner');
    if (!isAllowed) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  r.get(
    '/manager/staff',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('staff'),
    requirePermission('staff.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const page = Math.max(1, Number(req.query?.page || 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(req.query?.pageSize || 10) || 10));

      const base = db().from('staff').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) base.andWhere({ status });
      if (q) base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('email', 'like', `%${q}%`).orWhere('code', 'like', `%${q}%`));

      const all = await base
        .clone()
        .select(['id', 'code', 'name', 'email', 'phone', 'branch_id', 'role_id', 'role_name', 'status', 'last_login_at', 'created_at'])
        .orderBy('created_at', 'desc');

      const total = all.length;
      const start = (page - 1) * pageSize;
      const pageRows = all.slice(start, start + pageSize);

      const staff = pageRows.map((s) => ({
        id: String(s.id),
        code: String(s.code || ''),
        name: String(s.name || ''),
        email: String(s.email || ''),
        phone: String(s.phone || ''),
        branchId: String(s.branch_id || ''),
        roleId: String(s.role_id || ''),
        roleName: String(s.role_name || ''),
        status: String(s.status || 'Active'),
        lastLoginAt: s.last_login_at ? new Date(s.last_login_at).toISOString() : '',
        createdAt: s.created_at ? new Date(s.created_at).toISOString() : '',
      }));

      return res.json({ staff, page, pageSize, total, branchId });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/manager/staff',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('staff'),
    requirePermission('staff.create'),
    requireBranchId(),
    enforceStaffLimit,
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      try {
        await db().transaction(async (trx) => {
          await ensureDefaultRoles(trx, req.tenant.id);
        });
      } catch {
        // ignore
      }

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const pin = typeof body?.pin === 'string' ? body.pin : '';
      const status = typeof body?.status === 'string' ? body.status.trim() : 'Active';
      const roleName = typeof body?.roleName === 'string' ? body.roleName.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });
      if (!password || password.length < 4) return res.status(400).json({ error: 'password_too_short' });
      if (pin && String(pin).trim().length < 3) return res.status(400).json({ error: 'pin_too_short' });

      const now = nowIso();

      let effectiveRoleName = roleName || 'Waiter';
      let roleRow = await db().select(['id', 'name']).from('roles').where({ tenant_id: req.tenant.id, name: effectiveRoleName }).first();
      if (!roleRow && effectiveRoleName !== 'Waiter') {
        effectiveRoleName = 'Waiter';
        roleRow = await db().select(['id', 'name']).from('roles').where({ tenant_id: req.tenant.id, name: effectiveRoleName }).first();
      }
      const roleId = roleRow ? String(roleRow.id) : '';
      if (!roleId) return res.status(500).json({ error: 'role_missing' });

      const staffId = makeId('s');
      const passwordHash = await bcrypt.hash(password, 10);
      const needsPin = effectiveRoleName === 'Branch Manager' || effectiveRoleName === 'Cafe Owner';
      const finalPin = String(pin || '').trim() || (needsPin ? randomPin(6) : '');
      const pinHash = finalPin ? await bcrypt.hash(finalPin, 10) : null;

      const out = await db().transaction(async (trx) => {
        let effectiveCode = code || '';
        if (!effectiveCode) {
          for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const cand = await nextStaffCode(trx, { tenantId: req.tenant.id, cafeName: req.tenant.name, roleName: effectiveRoleName });
            // eslint-disable-next-line no-await-in-loop
            const exists = await trx.from('staff').where({ tenant_id: req.tenant.id, code: cand }).select(['id']).first();
            if (!exists) {
              effectiveCode = cand;
              break;
            }
          }
        }

        await trx.from('staff').insert({
          id: staffId,
          tenant_id: req.tenant.id,
          branch_id: branchId,
          role_id: roleId,
          role_name: effectiveRoleName,
          name,
          email,
          phone,
          code: effectiveCode || null,
          password_hash: passwordHash,
          pin_hash: pinHash,
          status: status || 'Active',
          created_at: now,
          updated_at: now,
        });
        return { effectiveCode };
      });

      await db().from('events').insert({
        id: makeId('evt'),
        tenant_id: req.tenant.id,
        branch_id: branchId,
        type: 'staff_created',
        payload: JSON.stringify({ staffId, by: String(req.auth?.role || '') }),
        at: now,
      });

      return res.status(201).json({ ok: true, staffId, code: out.effectiveCode || '', tempPassword: password, tempPin: finalPin || '' });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/manager/staff/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('staff'),
    requirePermission('staff.update'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const staffId = String(req.params.id || '').trim();
      if (!staffId) return res.status(400).json({ error: 'staff_id_required' });

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const status = typeof body?.status === 'string' ? body.status.trim() : '';
      const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
      const roleName = typeof body?.roleName === 'string' ? body.roleName.trim() : '';

      const existing = await db()
        .select(['id', 'branch_id'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: staffId })
        .first();
      if (!existing) return res.status(404).json({ error: 'staff_not_found' });
      if (String(existing.branch_id || '') !== branchId) return res.status(403).json({ error: 'forbidden' });

      const patch = { updated_at: nowIso() };
      if (name) patch.name = name;
      if (email) patch.email = email;
      if (typeof phone === 'string') patch.phone = phone;
      if (typeof code === 'string') patch.code = code;
      if (status) patch.status = status;

      let tempPin = '';
      if (body?.resetPin === true) {
        tempPin = randomPin(6);
        patch.pin_hash = await bcrypt.hash(tempPin, 10);
      } else if (pin) {
        if (pin.length < 3) return res.status(400).json({ error: 'pin_too_short' });
        patch.pin_hash = await bcrypt.hash(pin, 10);
      }

      if (roleName) {
        const roleRow = await db().select(['id', 'name']).from('roles').where({ tenant_id: req.tenant.id, name: roleName }).first();
        if (!roleRow) return res.status(400).json({ error: 'role_not_found' });
        patch.role_id = String(roleRow.id);
        patch.role_name = String(roleRow.name);
      }

      await db().from('staff').where({ tenant_id: req.tenant.id, id: staffId }).update(patch);

      await db().from('events').insert({
        id: makeId('evt'),
        tenant_id: req.tenant.id,
        branch_id: branchId,
        type: 'staff_updated',
        payload: JSON.stringify({ staffId, by: String(req.auth?.role || '') }),
        at: nowIso(),
      });

      return res.json({ ok: true, tempPin: tempPin || undefined });
    } catch (e) {
      return next(e);
    }
  });

  r.delete(
    '/manager/staff/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('staff'),
    requirePermission('staff.delete'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const staffId = String(req.params.id || '').trim();
      if (!staffId) return res.status(400).json({ error: 'staff_id_required' });

      const branchId = req.branchId || resolveBranchId(req);

      const existing = await db()
        .select(['id', 'branch_id', 'name'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: staffId })
        .first();
      if (!existing) return res.status(404).json({ error: 'staff_not_found' });
      if (String(existing.branch_id || '') !== branchId) return res.status(403).json({ error: 'forbidden' });

      await db().from('staff').where({ tenant_id: req.tenant.id, id: staffId }).del();

      await db().from('events').insert({
        id: makeId('evt'),
        tenant_id: req.tenant.id,
        branch_id: branchId,
        type: 'staff_deleted',
        payload: JSON.stringify({ staffId, by: String(req.auth?.role || '') }),
        at: nowIso(),
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/manager/staff/activity',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('staff'),
    requirePermission('staff.activity.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const type = typeof req.query?.type === 'string' ? req.query.type.trim() : '';
      const page = Math.max(1, Number(req.query?.page || 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(req.query?.pageSize || 10) || 10));

      const base = db().from('events').where({ tenant_id: req.tenant.id }).andWhere((b) => b.whereNull('branch_id').orWhere({ branch_id: branchId }));
      if (type) base.andWhere({ type });

      const rows0 = await base.select(['id', 'type', 'branch_id', 'payload', 'at']).orderBy('at', 'desc').limit(1000);

      const filtered = rows0
        .map((e) => ({
          id: String(e.id),
          type: String(e.type || ''),
          branchId: e.branch_id ? String(e.branch_id) : 'global',
          at: e.at ? new Date(e.at).toISOString() : '',
          payload: safeJsonParse(e.payload, {}),
        }))
        .filter((e) => {
          if (!q) return true;
          return e.id.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || JSON.stringify(e.payload || {}).toLowerCase().includes(q);
        });

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);

      return res.json({ events: items, page, pageSize, total, branchId });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerStaffRouter };
