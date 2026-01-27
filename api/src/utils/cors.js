const normalizeOrigin = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const port = url.port;
    const isDefaultPort = (url.protocol === 'https:' && (!port || port === '443')) ||
      (url.protocol === 'http:' && (!port || port === '80'));
    const suffix = isDefaultPort ? '' : `:${port}`;
    return `${url.protocol}//${url.hostname}${suffix}`.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '').replace(/:(443|80)$/, '');
  }
};

const originHost = (value) => {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isAllowedOrigin = (origin, allowlist) => {
  if (!origin) return true;

  const o = normalizeOrigin(origin);
  const host = originHost(origin) || o.replace(/^https?:\/\//, '').replace(/:\d+$/, '');

  if (host === 'apps.mirachpos.com' || host === 'mirachpos.com' || host === 'www.mirachpos.com') return true;
  if (host.endsWith('.mirachpos.com') || host.endsWith('.mirach.com')) return true;

  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!Array.isArray(allowlist) || allowlist.length === 0) return !isProd;

  return allowlist.some((x) => {
    const rule = normalizeOrigin(x);
    if (!rule) return false;
    if (rule.includes('*.')) {
      const suffix = rule.replace('*.', '');
      return o.endsWith(suffix);
    }
    return rule === o;
  });
};

module.exports = { isAllowedOrigin };
