const { db } = require('../db');
const { config } = require('../config');
const { logAudit } = require('../utils/logger');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizePermissions = (raw) => {
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
};


// Default permissions for built-in roles when no custom role row exists in DB
const BUILTIN_ROLE_PERMISSIONS = {
  'Waiter': ['orders.read', 'orders.write', 'orders.void', 'payments.write'],
  'Waiter Manager': ['orders.read', 'orders.write', 'orders.void', 'payments.write', 'manager.settings.write', 'manager.read'],
  'Branch Manager': ['*'],
  'Cafe Owner': ['*'],
  'Manager': ['*'],
};

const readRolePermissions = async ({ tenantId, roleName }) => {
  const tn = String(tenantId || '').trim();
  const rn = String(roleName || '').trim();
  if (!tn || !rn) return [];

  const row = await db().select(['permissions']).from('roles').where({ tenant_id: tn, name: rn }).first();
  if (!row) {
    // Fall back to built-in defaults so fresh tenants still work without DB seed
    return BUILTIN_ROLE_PERMISSIONS[rn] || [];
  }
  return normalizePermissions(row.permissions);
};


const deny = async (req, res, { permission, role, reason }) => {
  await logAudit({
    tenantId: req.tenant?.id ? String(req.tenant.id) : null,
    branchId: req.auth?.branchId ? String(req.auth.branchId) : null,
    actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
    actorRole: req.auth?.role ? String(req.auth.role) : null,
    type: 'authz.denied',
    summary: 'Permission denied',
    payload: {
      permission: permission || null,
      role: role || null,
      reason: reason || null,
      path: String(req.originalUrl || req.url || ''),
      method: String(req.method || ''),
      requestId: req.requestId ? String(req.requestId) : null,
    },
    requestId: req.requestId ? String(req.requestId) : null,
  });
  return res.status(403).json({ error: 'forbidden' });
};

const requireTenantMatch = (req, res) => {
  if (!req.tenant || !req.tenant.id) {
    res.status(500).json({ error: 'tenant_missing' });
    return false;
  }
  if (!req.auth || !req.auth.tenantId) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  if (String(req.auth.tenantId) !== String(req.tenant.id)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
};

const requireRole = (...roles) => async (req, res, next) => {
  try {
    if (!requireTenantMatch(req, res)) return;

    if (config && config.devBypassAuth) return next();

    const role = String(req.auth?.role || '').trim();
    const allowed = roles.map((r) => String(r)).includes(role);
    if (!allowed) return deny(req, res, { permission: null, role, reason: `role_not_allowed:${roles.join(',')}` });

    return next();
  } catch (e) {
    return next(e);
  }
};

const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!requireTenantMatch(req, res)) return;

    if (config && config.devBypassAuth) return next();

    const perm = String(permission || '').trim();
    if (!perm) return next();

    const role = String(req.auth?.role || '').trim();
    if (!role) return deny(req, res, { permission: perm, role: '', reason: 'missing_role' });

    const perms = await readRolePermissions({ tenantId: req.tenant.id, roleName: role });
    const ok = perms.includes('*') || perms.includes(perm);
    if (!ok) return deny(req, res, { permission: perm, role, reason: 'missing_permission' });

    return next();
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  requireRole,
  requirePermission,
};
