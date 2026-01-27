import { useEffect, useState } from 'react';

type Params = {
  userRole: string | null;
  currentScreen: string;
  isPosRole: (role: string | null) => boolean;
  safeSessionTimeoutMs: (mins: unknown) => number;
  apiFetch: (path: string, init?: any) => Promise<Response>;
  logoutAndReload: () => void;
};

export const usePosIdleTimeout = ({
  userRole,
  currentScreen,
  isPosRole,
  safeSessionTimeoutMs,
  apiFetch,
  logoutAndReload,
}: Params) => {
  const [posTimeoutMs, setPosTimeoutMs] = useState(0);
  const [lastActivityMs, setLastActivityMs] = useState(() => Date.now());

  useEffect(() => {
    if (!userRole || !isPosRole(userRole)) {
      setPosTimeoutMs(0);
      return;
    }

    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/pos/settings');
        const json = (await res.json().catch(() => null)) as any;
        if (!mounted) return;
        if (!res.ok) return;
        const mins = json?.security?.sessionTimeoutMins;
        setPosTimeoutMs(safeSessionTimeoutMs(mins));
      } catch {
        if (!mounted) return;
        setPosTimeoutMs(0);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [apiFetch, isPosRole, safeSessionTimeoutMs, userRole]);

  useEffect(() => {
    if (!posTimeoutMs || !userRole || !isPosRole(userRole)) return;

    const bump = () => setLastActivityMs(Date.now());
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener('pointerdown', bump, opts);
    window.addEventListener('keydown', bump, opts);
    window.addEventListener('scroll', bump, opts);
    window.addEventListener('touchstart', bump, opts);

    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('scroll', bump);
      window.removeEventListener('touchstart', bump);
    };
  }, [posTimeoutMs, userRole, isPosRole]);

  useEffect(() => {
    if (!posTimeoutMs || !userRole || !isPosRole(userRole)) return;

    const t = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityMs;
      if (idleMs >= posTimeoutMs) {
        logoutAndReload();
      }
    }, 15000);

    return () => window.clearInterval(t);
  }, [lastActivityMs, logoutAndReload, posTimeoutMs, userRole, isPosRole]);

  useEffect(() => {
    setLastActivityMs(Date.now());
  }, [currentScreen]);
};
