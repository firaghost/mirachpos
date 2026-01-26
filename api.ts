import { initTabSession, readSession, clearSession } from './session';

export type ApiFetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
  auth?: boolean;
};

const tenantFromHostname = (): string => {
  try {
    const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
    const h = host.toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1') return '';

    // Do not treat the API host itself as a tenant.
    if (h.startsWith('api.')) return '';

    // Option A: <tenant>.mirach.com or <tenant>.mirachpos.com
    if (h.endsWith('.mirach.com') || h.endsWith('.mirachpos.com')) {
      const parts = h.split('.').filter(Boolean);
      if (parts.length >= 3) return parts[0];
    }

    return '';
  } catch {
    return '';
  }
};

const tenantSlug = (): string => {
  // Prefer the tenant slug stored in the authenticated session.
  // This prevents mismatches where localStorage.lastWorkspace drifts from the JWT tenant.
  try {
    initTabSession();
    const sess = readSession<any>();
    const s1 = typeof sess?.tenantSlug === 'string' ? sess.tenantSlug.trim().toLowerCase() : '';
    if (s1) return s1;
    const s2 = typeof sess?.tenant?.slug === 'string' ? sess.tenant.slug.trim().toLowerCase() : '';
    if (s2) return s2;
  } catch {
    // ignore
  }

  try {
    const envSlug = (import.meta as any)?.env?.VITE_TENANT_SLUG;
    const s = typeof envSlug === 'string' ? envSlug.trim().toLowerCase() : '';
    if (s) return s;
  } catch {
    // ignore
  }

  // Dev/local fallback: reuse the login workspace value as tenant slug.
  try {
    const ws = localStorage.getItem('mirachpos.lastWorkspace.v1') || '';
    const s = ws.trim().toLowerCase();
    if (s && s !== 'default') return s;
  } catch {
    // ignore
  }

  return tenantFromHostname();
};

const apiBase = (): string => {
  try {
    const envBase = (import.meta as any)?.env?.VITE_API_BASE;
    const s = typeof envBase === 'string' ? envBase.trim() : '';
    if (s) return s.replace(/\/+$/, '');
  } catch {
    // ignore
  }

  try {
    const w = window as any;
    const cfg = w?.mirachpos?.config;
    const s = typeof cfg?.apiBase === 'string' ? cfg.apiBase.trim() : '';
    if (s) return s.replace(/\/+$/, '');
  } catch {
    // ignore
  }

  // Dev fallback: when running the frontend on localhost, default to local API.
  try {
    const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:3001';

    if (host === 'apps.mirachpos.com') return 'https://apa.mirachpos.com';
  } catch {
    // ignore
  }

  return '';
};

export const resolveAssetUrl = (raw: string): string => {
  const s0 = String(raw || '').trim();
  if (!s0) return '';
  if (s0.startsWith('http://') || s0.startsWith('https://') || s0.startsWith('data:')) return s0;

  const normalized = (() => {
    const s = s0.replace(/\\/g, '/');
    const idxApi = s.indexOf('/api/uploads/');
    if (idxApi >= 0) return s.slice(idxApi);
    const idx = s.indexOf('/uploads/');
    if (idx >= 0) return s.slice(idx);
    return s;
  })();

  const needsPrefix = normalized.startsWith('/api/uploads/') || normalized.startsWith('/uploads/');
  if (!needsPrefix) return normalized;

  const base = apiBase();
  if (base) return `${base}${normalized}`;

  const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';
  if (isFileProtocol) return `https://apa.mirachpos.com${normalized}`;
  return normalized;
};

export const authHeader = (): Record<string, string> => {
  initTabSession();
  const sess = readSession();
  const token = typeof sess?.token === 'string' ? sess.token : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const superadminAuthHeader = (): Record<string, string> => {
  initTabSession();
  const sess = readSession<any>();
  const token = typeof sess?.superadminToken === 'string' ? sess.superadminToken : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const logoutAndReload = () => {
  clearSession();
  try {
    window.location.reload();
  } catch {
    // ignore
  }
};

let serverOffsetMs = 0;

export const serverNowMs = () => Date.now() + serverOffsetMs;

export const apiFetch = async (input: RequestInfo | URL, init: ApiFetchOptions = {}) => {
  const { auth = true, headers, ...rest } = init;
  const mergedHeaders: Record<string, string> = { ...(headers || {}) };
  const isSuperadminRoute = typeof input === 'string' && input.startsWith('/api/superadmin/');
  const isSuperadminContext = (() => {
    try {
      initTabSession();
      const sess = readSession<any>();
      return String(sess?.role || '').trim() === 'Super Admin';
    } catch {
      return false;
    }
  })();
  if (auth) Object.assign(mergedHeaders, isSuperadminRoute || isSuperadminContext ? superadminAuthHeader() : authHeader());

  if (!isSuperadminRoute) {
    const tenant = tenantSlug();
    if (tenant && !mergedHeaders['X-Tenant'] && !mergedHeaders['x-tenant']) {
      mergedHeaders['X-Tenant'] = tenant;
    }
  }

  let finalInput: RequestInfo | URL = input;
  if (typeof input === 'string') {
    const isRelativeApi = input.startsWith('/api/');
    const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';

    // If an owner is using manager endpoints, many routes require branchId.
    // Auto-append branchId from local selection when missing.
    let pathWithQuery = input;
    try {
      if (input.startsWith('/api/manager/')) {
        const s = readSession<any>();
        const role = typeof s?.role === 'string' ? s.role : '';
        const tokenBranch = typeof s?.branchId === 'string' ? s.branchId : '';
        if (role === 'Cafe Owner' && (!tokenBranch || tokenBranch === 'global')) {
          const hasBranchId = /[?&]branchId=/.test(input);
          if (!hasBranchId) {
            const selected =
              (localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
                localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
                localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
                '')
                .trim();
            if (selected && selected !== 'global') {
              pathWithQuery = input.includes('?')
                ? `${input}&branchId=${encodeURIComponent(selected)}`
                : `${input}?branchId=${encodeURIComponent(selected)}`;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    const base = apiBase();
    if (isRelativeApi && base) {
      finalInput = `${base}${pathWithQuery}`;
    } else if (isRelativeApi && isFileProtocol) {
      finalInput = `https://apa.mirachpos.com${pathWithQuery}`;
    } else {
      finalInput = pathWithQuery;
    }
  }

  const method = typeof (rest as any)?.method === 'string' ? String((rest as any).method).toUpperCase() : 'GET';
  const cacheMode = (rest as any)?.cache;
  const finalCache = cacheMode != null ? cacheMode : method === 'GET' ? 'no-store' : undefined;
  const res = await fetch(finalInput, { ...rest, cache: finalCache, headers: mergedHeaders });

  if (res.status === 402) {
    try {
      const cloned = res.clone();
      const json = (await cloned.json().catch(() => null)) as any;
      const error = typeof json?.error === 'string' ? json.error : '';
      const moduleKey = typeof json?.module === 'string' ? json.module : '';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mirachpos-module-blocked', {
            detail: {
              status: 402,
              error,
              module: moduleKey,
              path: typeof input === 'string' ? input : '',
            },
          }),
        );
      }
    } catch {
      // ignore
    }
  }

  if (res.status === 403) {
    try {
      const cloned = res.clone();
      const json = (await cloned.json().catch(() => null)) as any;
      const error = typeof json?.error === 'string' ? json.error : '';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mirachpos-access-denied', {
            detail: {
              status: 403,
              error: error || 'forbidden',
              path: typeof input === 'string' ? input : '',
            },
          }),
        );
      }
    } catch {
      // ignore
    }
  }

  try {
    const dateHdr = res.headers.get('date');
    const serverMs = dateHdr ? Date.parse(dateHdr) : NaN;
    if (Number.isFinite(serverMs)) {
      serverOffsetMs = serverMs - Date.now();
    }
  } catch {
    // ignore
  }
  if (res.status === 401) {
    // Do NOT log out on business-rule 401s like PIN challenges.
    // Only force logout when the token is truly invalid/expired.
    const urlStr = typeof input === 'string' ? input : '';
    const isMeCheck = urlStr === '/api/auth/me' || urlStr === '/api/me';
    if (isMeCheck) {
      logoutAndReload();
      return res;
    }

    try {
      const cloned = res.clone();
      const json = (await cloned.json().catch(() => null)) as any;
      const err = String(json?.error || json?.message || '').trim().toLowerCase();
      if (err === 'invalid_token' || err === 'token_expired' || err === 'jwt_expired') {
        logoutAndReload();
        return res;
      }
    } catch {
      // ignore
    }
  }
  return res;
};
