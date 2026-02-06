const { db } = require('../db');

const getTenantSlugFromHeader = (req) => {
  const raw = req.header('X-Tenant');
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
};

const getTenantSlugFromQuery = (req) => {
  const raw =
    (typeof req.query?.tenant === 'string' ? req.query.tenant : '') ||
    (typeof req.query?.tenantSlug === 'string' ? req.query.tenantSlug : '') ||
    (typeof req.query?.x_tenant === 'string' ? req.query.x_tenant : '');
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
};

const tenantMiddleware = async (req, res, next) => {
  try {
    const slug = getTenantSlugFromHeader(req) || getTenantSlugFromQuery(req);
    if (!slug) {
      return res.status(400).json({ error: 'tenant_required' });
    }

    const tenant = await db()
      .select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'plan_ends_at', 'features_json'])
      .from('tenants')
      .where({ slug })
      .first();

    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
    if (tenant.status === 'suspended') return res.status(403).json({ error: 'tenant_suspended' });

    req.tenant = tenant;
    return next();
  } catch (e) {
    return next(e);
  }
};

module.exports = { tenantMiddleware, getTenantSlugFromHeader };
