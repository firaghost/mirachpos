import React, { useMemo } from 'react';
import { readSession } from '../session';

export const Header: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => {
  const session = useMemo(() => readSession<any>(), []);
  const displayName = (() => {
    const n = typeof session?.staffName === 'string' ? session.staffName.trim() : '';
    if (n) return n;
    const tn = typeof session?.tenant?.name === 'string' ? session.tenant.name.trim() : '';
    return tn || 'User';
  })();

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

  return (
    <header className="shrink-0 border-b border-border bg-surface/95 backdrop-blur flex flex-col sm:flex-row sm:items-center items-start sm:justify-between px-4 sm:px-8 py-3 sm:py-0 min-h-16 z-10 gap-3">
      <div className="min-w-0">
        <h2 className="text-white text-xl font-bold tracking-tight truncate">{title}</h2>
        {subtitle && <p className="text-text-muted text-xs mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-3">
        {action ? <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-2">{action}</div> : null}
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
