const norm = (v) => String(v || '').trim().toLowerCase().replace(/\/+$/, '');

const isAllowedOrigin = (origin, allowlist) => {
  if (!origin) return true;

  const o = norm(origin);

  // Hard-allow official app origins to prevent accidental lockout.
  if (o === 'https://apps.mirachpos.com' || o === 'https://mirachpos.com' || o === 'https://www.mirachpos.com') {
    return true;
  }

  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;

  return allowlist.some((x) => {
    const rule = norm(x);
    if (!rule) return false;
    if (rule.includes('*.')) {
      const suffix = rule.replace('*.', '');
      return o.endsWith(suffix);
    }
    return rule === o;
  });
};

module.exports = { isAllowedOrigin };
