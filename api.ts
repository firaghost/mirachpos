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

    // Option A: <tenant>.mirach.com
    if (h.endsWith('.mirach.com')) {
      const parts = h.split('.').filter(Boolean);
      if (parts.length >= 3) return parts[0];
    }

    return '';
  } catch {
    return '';
  }
};

const tenantSlug = (): string => {
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

  // Dev fallback: when running the frontend on localhost, default to local API.
  try {
    const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:3001';
  } catch {
    // ignore
  }

  return '';
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
  if (auth) Object.assign(mergedHeaders, isSuperadminRoute ? superadminAuthHeader() : authHeader());

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
    const base = apiBase();
    if (isRelativeApi && base) {
      finalInput = `${base}${input}`;
    }
    if (isRelativeApi && isFileProtocol) {
      finalInput = `http://127.0.0.1:3001${input}`;
    }
  }

  const res = await fetch(finalInput, { ...rest, headers: mergedHeaders });

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
    logoutAndReload();
  }
  return res;
};
