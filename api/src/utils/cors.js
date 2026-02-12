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

const normalizeWildcardSuffix = (rule) => {
  const raw = String(rule || '').trim().toLowerCase();
  if (!raw) return '';

  const noScheme = raw.replace(/^https?:\/\//, '');
  const noPort = noScheme.replace(/:\d+$/, '');
  return noPort.replace(/^\*\./, '').replace(/\/+$/, '');
};

const wildcardHostMatch = (host, suffix) => {
  const h = String(host || '').trim().toLowerCase();
  const s = String(suffix || '').trim().toLowerCase();
  if (!h || !s) return false;
  if (h === s) return true;
  return h.endsWith(`.${s}`);
};

const isAllowedOrigin = (origin, allowlist) => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!origin) return !isProd;

  const o = normalizeOrigin(origin);
  const host = originHost(origin) || o.replace(/^https?:\/\//, '').replace(/:\d+$/, '');

  if (host === 'apps.mirachpos.com' || host === 'mirachpos.com' || host === 'www.mirachpos.com') return true;
  if (host.endsWith('.mirachpos.com') || host.endsWith('.mirach.com')) return true;

  if (!Array.isArray(allowlist) || allowlist.length === 0) return !isProd;

  return allowlist.some((x) => {
    const rule = normalizeOrigin(x);
    if (!rule) return false;
    if (String(x || '').includes('*.') || rule.includes('*.')) {
      const suffix = normalizeWildcardSuffix(x || rule);
      return wildcardHostMatch(host, suffix);
    }
    return rule === o;
  });
};

module.exports = { isAllowedOrigin };
