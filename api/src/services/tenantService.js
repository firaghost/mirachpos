const { db } = require('../db');

const getTenantBySlug = async (slug) => {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  return db()
    .select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'plan_ends_at'])
    .from('tenants')
    .where({ slug: s })
    .first();
};

module.exports = { getTenantBySlug };
