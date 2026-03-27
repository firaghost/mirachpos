import React, { useMemo, useState } from 'react';

import { usePos } from '../../PosContext';
import { Screen } from '../../types';

import { AppIcon } from '@/components/ui/app-icon';
import { cn } from '@/components/lib/utils';

export type ActiveOrdersPanelProps = {
  onNavigate: (screen: Screen) => void;
  onFocusTable?: (tableId: string) => void;
};

export const ActiveOrdersPanel: React.FC<ActiveOrdersPanelProps> = ({ onNavigate, onFocusTable }) => {
  const { orders, tables, refreshFromServer, selectOrder } = usePos();

  const [filter, setFilter] = useState<'All' | 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Voided'>('All');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const base = orders.filter((o) => o.status !== 'Paid');
    return {
      Pending: base.filter((o) => o.status === 'Pending').length,
      Cooking: base.filter((o) => o.status === 'Cooking').length,
      Ready: base.filter((o) => o.status === 'Ready').length,
      Served: base.filter((o) => o.status === 'Served').length,
      Voided: base.filter((o) => o.status === 'Voided').length,
    };
  }, [orders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = orders.filter((o) => o.status !== 'Paid');

    return base.filter((o) => {
      const matchesStatus = filter === 'All' ? true : o.status === filter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        String(o.number || '').toLowerCase().includes(q) ||
        String(o.tableName || '').toLowerCase().includes(q)
      );
    });
  }, [orders, filter, query]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-foreground">Active</div>
            <div className="mt-1 text-[11px] text-muted-foreground font-semibold">Open tickets</div>
          </div>
          <button
            type="button"
            className="h-9 px-3 rounded-lg border border-border bg-background text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-2"
            onPointerDown={(e) => {
              e.preventDefault();
              void refreshFromServer();
            }}
          >
            <AppIcon name="sync" className="text-[18px]" size={18} />
            Refresh
          </button>
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {(
            [
              { k: 'All', label: 'All' },
              { k: 'Pending', label: `Sent (${counts.Pending})` },
              { k: 'Cooking', label: `Preparing (${counts.Cooking})` },
              { k: 'Ready', label: `Ready (${counts.Ready})` },
              { k: 'Voided', label: `Voided (${counts.Voided})` },
            ] as const
          ).map((x) => (
            <button
              key={x.k}
              type="button"
              className={cn(
                'h-8 px-3 rounded-full border text-[11px] font-black uppercase tracking-widest whitespace-nowrap',
                filter === x.k
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                setFilter(x.k as any);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="mt-2 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <AppIcon name="search" className="text-muted-foreground" size={18} />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full pl-10 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder-muted-foreground focus:outline-none"
            placeholder="Search table / order"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {visible.length === 0 ? (
          <div className="text-sm text-muted-foreground">No matching orders.</div>
        ) : (
          visible.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left rounded-xl border border-border bg-background p-3 hover:border-primary/40 transition-colors"
              onPointerDown={(e) => {
                e.preventDefault();
                selectOrder(o.id);
                if (onFocusTable) onFocusTable(o.tableId);

                const tbl = tables.find((t) => t.id === o.tableId) ?? null;
                const tableStatus = tbl ? String((tbl as any)?.status || '').trim() : '';
                if (o.status === 'Served' || tableStatus === 'Payment') {
                  onNavigate(Screen.WAITER_PAYMENT);
                  return;
                }
                onNavigate(Screen.WAITER_REVIEW);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-foreground font-black text-sm leading-tight">{o.number}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground font-semibold">{o.tableName}</div>
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{o.status}</div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground font-semibold">{o.items.length} items</div>
                <div className="text-sm font-black text-foreground">ETB {Number(o.total || 0).toFixed(2)}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
