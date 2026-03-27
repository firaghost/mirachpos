import React, { useMemo, useState } from 'react';

import { usePos } from '../../PosContext';

import { AppIcon } from '@/components/ui/app-icon';
import { cn } from '@/components/lib/utils';

const minutesSince = (iso?: string) => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  return mins >= 0 ? mins : null;
};

export type FloorPanelProps = {
  onSelectTable: (tableId: string) => void;
};

export const FloorPanel: React.FC<FloorPanelProps> = ({ onSelectTable }) => {
  const { tables, orders, selectedTableId } = usePos();

  const staffNameCache = useMemo(() => {
    try {
      const raw = localStorage.getItem('mirachpos.staffNameCache.v1');
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      if (!parsed || typeof parsed !== 'object') return {} as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && typeof v === 'string' && v.trim()) out[k] = v;
      }
      return out;
    } catch {
      return {} as Record<string, string>;
    }
  }, []);

  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) {
      const a = typeof (t as any)?.area === 'string' ? String((t as any).area).trim() : '';
      if (a) set.add(a);
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [tables]);

  const [area, setArea] = useState<string>('All');
  const [filter, setFilter] = useState<'All' | 'Free' | 'Occupied' | 'Action'>('All');

  const openOrderById = useMemo(() => {
    const map = new Map<string, any>();
    for (const o of orders) map.set(o.id, o);
    return map;
  }, [orders]);

  const visibleTables = useMemo(() => {
    const base = area === 'All'
      ? tables
      : tables.filter((t) => {
        const a = typeof (t as any)?.area === 'string' ? String((t as any).area).trim() : '';
        return a === area;
      });

    return base.filter((t) => {
      if (filter === 'All') return true;
      if (filter === 'Free') return t.status === 'Free';
      if (filter === 'Occupied') return t.status !== 'Free';
      if (filter === 'Action') return t.status === 'Payment' || t.status === 'Reserved';
      return true;
    });
  }, [area, filter, tables]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black uppercase tracking-widest text-foreground">Floor</div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="h-9 pl-9 pr-8 rounded-lg border border-border bg-background text-xs font-black uppercase tracking-widest text-muted-foreground focus:outline-none"
              >
                {areas.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <AppIcon name="grid_view" className="text-muted-foreground" size={18} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {(['All', 'Free', 'Occupied', 'Action'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={cn(
                'h-8 px-3 rounded-full border text-[11px] font-black uppercase tracking-widest whitespace-nowrap',
                filter === k
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                setFilter(k);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleTables.map((t) => {
            const active = selectedTableId === t.id;
            const openOrderId = t.openOrderId || '';
            const openOrder = openOrderId ? openOrderById.get(openOrderId) : null;
            const mins = minutesSince(openOrder?.createdAt);

            const assignedName = (() => {
              const direct = typeof (t as any).assignedStaffName === 'string' ? String((t as any).assignedStaffName).trim() : '';
              if (direct) return direct;
              const assignedId = typeof (t as any).assignedStaffId === 'string' ? String((t as any).assignedStaffId).trim() : '';
              if (!assignedId) return '';
              const cached = staffNameCache[assignedId] ? String(staffNameCache[assignedId] || '').trim() : '';
              if (cached) return cached;
              return '';
            })();

            const statusTone = (() => {
              if (t.status === 'Free') return 'border-border bg-background';
              if (t.status === 'Payment') return 'border-primary/40 bg-primary/5';
              if (t.status === 'Reserved') return 'border-amber-500/40 bg-amber-500/10';
              return 'border-emerald-500/40 bg-emerald-500/10';
            })();

            return (
              <button
                key={t.id}
                type="button"
                className={cn(
                  'text-left rounded-xl border p-3 transition-colors',
                  statusTone,
                  active ? 'ring-2 ring-primary' : 'hover:border-primary/40'
                )}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onSelectTable(t.id);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-foreground font-black text-sm leading-tight">{t.name}</div>
                    <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {t.status}
                      {mins != null && t.status !== 'Free' ? ` • ${mins}m` : ''}
                    </div>
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.seats}</div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs font-black text-foreground">ETB {Number(t.currentTotal || 0).toFixed(2)}</div>
                  {t.cartItemCount > 0 ? (
                    <div className="h-6 px-2 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center">
                      {t.cartItemCount}
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">
                    {assignedName ? assignedName : 'Unassigned'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
