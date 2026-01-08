export const SESSION_KEY = 'mirachpos.session.v1';

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

  const legacyRaw = safeGet(legacy, SESSION_KEY);
  if (!legacyRaw || !legacyRaw.trim()) return;

  safeSet(store, SESSION_KEY, legacyRaw);
  safeRemove(legacy, SESSION_KEY);
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
  // Keep legacy localStorage copy in sync for older screens still reading it directly.
  safeSet(getLegacyStore(), SESSION_KEY, payload);

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
  safeRemove(getSessionStore(), SESSION_KEY);
  safeRemove(getLegacyStore(), SESSION_KEY);
};
