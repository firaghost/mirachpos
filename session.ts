export const SESSION_KEY = 'mirachpos.session.v1';
export const LEGACY_SESSION_KEY_PREFIX = 'mirachpos.session.v1.role.';
export const LAST_ROLE_KEY = 'mirachpos.lastRole.v1';

const safeGet = (store: Storage | null, key: string): string | null => {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (store: Storage | null, key: string, value: string) => {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // ignore
  }
};

const safeRemove = (store: Storage | null, key: string) => {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
};

const normalizeRoleKey = (role: unknown): string => {
  const r = String(role ?? '').trim();
  if (!r) return 'unknown';
  return r.toLowerCase().replace(/\s+/g, '_');
};

const legacyKeyForRole = (role: unknown): string => `${LEGACY_SESSION_KEY_PREFIX}${normalizeRoleKey(role)}`;

const getSessionStore = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

const getLegacyStore = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export const initTabSession = () => {
  const store = getSessionStore();
  const legacy = getLegacyStore();

  const existing = safeGet(store, SESSION_KEY);
  if (existing && existing.trim()) return;

  // 1) Migrate old global legacy session key (pre role scoping)
  const legacyRaw = safeGet(legacy, SESSION_KEY);
  if (legacyRaw && legacyRaw.trim()) {
    safeSet(store, SESSION_KEY, legacyRaw);
    safeRemove(legacy, SESSION_KEY);
    try {
      window.dispatchEvent(new Event('mirachpos-session-changed'));
    } catch {
      // ignore
    }
    return;
  }

  // 2) Restore from the last role-scoped legacy key
  const lastRole = safeGet(legacy, LAST_ROLE_KEY);
  if (lastRole && lastRole.trim()) {
    const byRole = safeGet(legacy, legacyKeyForRole(lastRole));
    if (byRole && byRole.trim()) {
      safeSet(store, SESSION_KEY, byRole);
      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }
      return;
    }
  }
};

export const readSession = <T = any>(): T | null => {
  initTabSession();
  const store = getSessionStore();
  const raw = safeGet(store, SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeSession = (session: any) => {
  const store = getSessionStore();
  const payload = JSON.stringify(session ?? {});
  if (store) safeSet(store, SESSION_KEY, payload);

  // Keep legacy localStorage copy in sync for older screens still reading it directly,
  // but isolate it per role to avoid cross-role/session collisions.
  const legacy = getLegacyStore();
  const role = session && typeof session === 'object' ? (session as any).role : '';
  safeSet(legacy, legacyKeyForRole(role), payload);
  safeSet(legacy, LAST_ROLE_KEY, String(role || ''));

  // Ensure the old global key is removed so other tabs/roles don't hijack on refresh.
  safeRemove(legacy, SESSION_KEY);

  try {
    window.dispatchEvent(new Event('mirachpos-session-changed'));
  } catch {
    // ignore
  }
};

export const updateSession = (patch: Record<string, any>) => {
  const cur = readSession<any>() || {};
  writeSession({ ...cur, ...(patch || {}) });
};

export const clearSession = () => {
  // Read session BEFORE clearing to get role for clearing role-scoped legacy key
  const cur = readSession<any>();
  safeRemove(getSessionStore(), SESSION_KEY);
  const legacy = getLegacyStore();
  safeRemove(legacy, SESSION_KEY);
  try {
    safeRemove(legacy, legacyKeyForRole(cur?.role));
    safeRemove(legacy, LAST_ROLE_KEY);
  } catch {
    // ignore
  }
};
