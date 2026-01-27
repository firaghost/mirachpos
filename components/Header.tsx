import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { readSession } from '../session';
import { ThemeToggle } from './ui/theme-toggle';

import { AppIcon } from '@/components/ui/app-icon';
export const Header: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode }> = ({ title, subtitle, action }) => {
  const [session, setSession] = useState<any>(() => readSession<any>());
  const [updaterState, setUpdaterState] = useState<any>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);
  const [installingLocal, setInstallingLocal] = useState(false);
  const [branchName, setBranchName] = useState<string>('');

  useEffect(() => {
    const onSessionChanged = () => {
      setSession(readSession<any>());
    };
    try {
      window.addEventListener('mirachpos-session-changed', onSessionChanged as any);
    } catch {
      // ignore
    }
    return () => {
      try {
        window.removeEventListener('mirachpos-session-changed', onSessionChanged as any);
      } catch {
        // ignore
      }
    };
  }, []);

  const displayName = useMemo(() => {
    const n = typeof session?.staffName === 'string' ? session.staffName.trim() : '';
    if (n) return n;
    const tn = typeof session?.tenant?.name === 'string' ? session.tenant.name.trim() : '';
    return tn || 'User';
  }, [session?.staffName, session?.tenant?.name]);

  useEffect(() => {
    const u = (window as any)?.mirachpos?.updater;
    if (!u) return;

    let unsub: any = null;
    try {
      unsub = u.onState((st: any) => {
        setUpdaterState(st || null);
        const status = String(st?.status || '');
        if (status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing' || status === 'checking') {
          setUpdaterDismissed(false);
        }
      });
    } catch {
      // ignore
    }

    try {
      Promise.resolve(u.getState()).then((st: any) => setUpdaterState(st || null));
    } catch {
      // ignore
    }

    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        // ignore
      }
    };
  }, []);

  const branchLabel = useMemo(() => {
    const b = typeof session?.branchId === 'string' ? session.branchId.trim() : '';
    if (!b || b === 'global') return 'All Locations';
    const sName = typeof session?.branchName === 'string' ? session.branchName.trim() : '';
    if (sName) return sName;
    return branchName || b;
  }, [branchName, session?.branchId, session?.branchName]);

  useEffect(() => {
    const b = typeof session?.branchId === 'string' ? session.branchId.trim() : '';
    if (!b || b === 'global') {
      setBranchName('');
      return;
    }
    const sName = typeof session?.branchName === 'string' ? session.branchName.trim() : '';
    if (sName) {
      setBranchName('');
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const res = await apiFetch('/api/branches');
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as any;
        const list = Array.isArray(json?.branches) ? (json.branches as any[]) : [];
        const found = list.find((x) => String(x?.id || '').trim() === b) || null;
        const name = found ? String(found?.name || '').trim() : '';
        if (!cancelled) setBranchName(name);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [session?.branchId, session?.branchName]);

  const initials = (() => {
    const parts = displayName.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || 'U';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (a + b).toUpperCase();
  })();

  const updaterUi = useMemo(() => {
    if (updaterDismissed) return null;
    const st = updaterState && typeof updaterState === 'object' ? updaterState : null;
    const status = installingLocal ? 'installing' : String(st?.status || '');
    const percent = (() => {
      try {
        const p = Number(st?.progress?.percent);
        return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null;
      } catch {
        return null;
      }
    })();

    if (status !== 'checking' && status !== 'downloading' && status !== 'installing' && status !== 'downloaded') return null;

    const label =
      status === 'installing'
        ? 'Installing update'
        : status === 'downloading'
          ? percent == null
            ? 'Downloading update'
            : `Downloading ${percent.toFixed(0)}%`
          : status === 'downloaded'
            ? 'Update ready'
            : 'Checking updates';

    const tone = status === 'downloaded'
      ? 'border-border bg-card text-muted-foreground'
      : 'border-border bg-card text-muted-foreground';

    const onInstall = async () => {
      try {
        const u = (window as any)?.mirachpos?.updater;
        if (!u) return;
        setInstallingLocal(true);
        await u.quitAndInstall();
      } catch {
        // ignore
      }
    };

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${tone}`}>
        {status !== 'downloaded' ? (
          <span className="h-3.5 w-3.5 rounded-full border-2 border-current/20 border-t-current animate-spin" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
        )}
        <span className="text-xs font-bold whitespace-nowrap">{label}</span>
        {status === 'downloaded' ? (
          <button
            type="button"
            onClick={onInstall}
            className="h-7 px-3 rounded-full border text-[11px] font-extrabold"
            style={{ backgroundColor: 'var(--mirach-primary)', borderColor: 'var(--mirach-primary)', color: '#221c11' }}
          >
            Restart
          </button>
        ) : null}
        {status === 'installing' ? (
          <button
            type="button"
            disabled
            className="h-7 px-3 rounded-full border border-border bg-card text-muted-foreground text-[11px] font-extrabold opacity-80"
          >
            Restart
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setUpdaterDismissed(true)}
          className="h-6 w-6 rounded-full border border-current/20 bg-transparent text-current/80 hover:text-current flex items-center justify-center"
          aria-label="Dismiss update status"
        >
          <AppIcon name="close" className="text-[16px]" size={16} />
        </button>
      </div>
    );
  }, [installingLocal, updaterDismissed, updaterState]);

  return (
    <header className="shrink-0 border-b border-border bg-card/95 backdrop-blur px-4 sm:px-8 py-3 sm:py-0 min-h-16 z-10 relative">
      <div className="flex items-center justify-between gap-3 min-h-16">
        <div className="min-w-0">
          <h2 className="text-foreground text-xl font-bold tracking-tight truncate">{title}</h2>
          {subtitle ? (
            typeof subtitle === 'string'
              ? <p className="text-muted-foreground text-xs mt-0.5 truncate">{subtitle}</p>
              : <div className="text-muted-foreground text-xs mt-0.5 truncate">{subtitle}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {action ? <div className="flex flex-wrap items-center justify-end gap-2">{action}</div> : null}
          <div className="flex items-center gap-3">
            <ThemeToggle size="sm" />
            <div className="text-right hidden md:block">
              <p className="text-sm font-bold text-foreground leading-none">{displayName}</p>
              <p className="text-xs text-muted-foreground mt-1">{branchLabel}</p>
            </div>
            <div className="w-9 h-9 rounded-full border-2 border-border bg-card flex items-center justify-center text-foreground text-xs font-black">
              {initials}
            </div>
          </div>
        </div>
      </div>

      {updaterUi ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">{updaterUi}</div>
        </div>
      ) : null}
    </header>
  );
};
