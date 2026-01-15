import React, { useEffect, useMemo, useState } from 'react';
import { readSession } from '../session';

export const Header: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => {
  const session = useMemo(() => readSession<any>(), []);
  const [updaterState, setUpdaterState] = useState<any>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);
  const displayName = (() => {
    const n = typeof session?.staffName === 'string' ? session.staffName.trim() : '';
    if (n) return n;
    const tn = typeof session?.tenant?.name === 'string' ? session.tenant.name.trim() : '';
    return tn || 'User';
  })();

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

  const branchLabel = (() => {
    const b = typeof session?.branchId === 'string' ? session.branchId.trim() : '';
    if (!b || b === 'global') return 'All Locations';
    return b;
  })();

  const initials = (() => {
    const parts = displayName.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || 'U';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (a + b).toUpperCase();
  })();

  const updaterUi = useMemo(() => {
    if (updaterDismissed) return null;
    const st = updaterState && typeof updaterState === 'object' ? updaterState : null;
    const status = String(st?.status || '');
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

    const tone = status === 'downloaded' ? 'border-[#2f5f44] bg-[#163324] text-[#bde7c9]' : 'border-[#483c23] bg-[#221c11] text-[#c9b792]';

    const onInstall = async () => {
      try {
        const u = (window as any)?.mirachpos?.updater;
        if (!u) return;
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
            className="h-7 px-2.5 rounded-full border border-[#2f5f44] bg-[#1b402c] text-[#e7fff0] text-[11px] font-extrabold hover:bg-[#225238]"
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
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    );
  }, [updaterDismissed, updaterState]);

  return (
    <header className="shrink-0 border-b border-border bg-surface/95 backdrop-blur flex flex-col sm:flex-row sm:items-center items-start sm:justify-between px-4 sm:px-8 py-3 sm:py-0 min-h-16 z-10 gap-3">
      <div className="min-w-0">
        <h2 className="text-white text-xl font-bold tracking-tight truncate">{title}</h2>
        {subtitle && <p className="text-text-muted text-xs mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-3">
        {action ? <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-2">{action}</div> : null}
        {updaterUi}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-light rounded-full border border-border">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
          <span className="text-xs font-medium text-success">System Operational</span>
        </div>
        <button className="relative w-9 h-9 rounded-full bg-surface-light text-text-muted hover:text-white hover:bg-border flex items-center justify-center transition-all">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
          <span className="absolute top-2 right-2.5 w-2 h-2 bg-danger rounded-full border border-surface"></span>
        </button>
        <div className="w-px h-8 bg-border mx-1"></div>
        <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-white leading-none">{displayName}</p>
                <p className="text-xs text-text-muted mt-1">{branchLabel}</p>
            </div>
            <div className="w-9 h-9 rounded-full border-2 border-border bg-surface-light flex items-center justify-center text-white text-xs font-black">
              {initials}
            </div>
        </div>
      </div>
    </header>
  );
};
