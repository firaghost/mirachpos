const isAllowedOrigin = (origin, allowlist) => {
  if (!origin) return true;
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;

  return allowlist.some((x) => {
    const rule = String(x || '');
    if (!rule) return false;
    if (rule.includes('*.')) {
      const suffix = rule.replace('*.', '');
      return origin.endsWith(suffix);
    }
    return rule === origin;
  });
};

module.exports = { isAllowedOrigin };
