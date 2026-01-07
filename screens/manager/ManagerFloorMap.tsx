import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { apiFetch } from '../../api';
import { InitializePosModal } from '../../components/InitializePosModal';
import { readSession } from '../../session';

const readStaffNameCache = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem('mirachpos.staffNameCache.v1');
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

const STORAGE_KEY = 'mirachpos.manager.floor.waiterId';

export const ManagerFloorMap: React.FC<Props> = ({ onNavigate }) => {
  const { tables, orders, selectOrder, selectTable, refreshFromServer } = usePos();
  const [initOpen, setInitOpen] = useState(false);
  const [area, setArea] = useState<'All Areas' | 'Main Hall' | 'Patio' | 'Bar Area' | 'Private Room'>('All Areas');
  const [filter, setFilter] = useState<'All' | 'Free' | 'Occupied' | 'Action'>('All');
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const staffNameCache = useMemo(() => readStaffNameCache(), []);
  const [remoteWaiters, setRemoteWaiters] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        try {
          const s = readSession<any>();
          const role = typeof s?.role === 'string' ? s.role : '';
          if (role !== 'Branch Manager' && role !== 'Cafe Owner') return;
        } catch {
          return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const res = await apiFetch('/api/manager/staff?pageSize=200');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.staff) ? (json.staff as any[]) : [];
        const waiters = rows
          .filter((s) => String(s?.roleName || '').toLowerCase() === 'waiter')
          .map((s) => ({ id: String(s.id || ''), name: String(s.name || '') }))
          .filter((s) => s.id && s.name);

        if (!mounted) return;
        setRemoteWaiters(waiters);

        try {
          const cache: Record<string, string> = { ...readStaffNameCache() };
          for (const w of waiters) cache[w.id] = w.name;
          localStorage.setItem('mirachpos.staffNameCache.v1', JSON.stringify(cache));
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  const waiters = useMemo(() => {
    return remoteWaiters;
  }, [remoteWaiters]);

  const [waiterId, setWaiterId] = useState<string | 'All'>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v ? v : 'All';
    } catch {
      return 'All';
    }
  });

  useEffect(() => {
    try {
      if (waiterId === 'All') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, waiterId);
    } catch {
      // ignore
    }
  }, [waiterId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ordersById = useMemo(() => {
    const map = new Map<string, (typeof orders)[number]>();
    for (const o of orders) map.set(o.id, o);
    return map;
  }, [orders]);

  const staffById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const [id, name] of Object.entries(staffNameCache as Record<string, string>)) {
      const nm = typeof name === 'string' ? name : '';
      if (!id || !nm) continue;
      map.set(id, { id, name: nm });
    }
    for (const s of remoteWaiters) {
      if (!s.id || !s.name) continue;
      map.set(s.id, { id: s.id, name: s.name });
    }
    return map;
  }, [remoteWaiters, staffNameCache]);

  const visibleTables = useMemo(() => {
    const base = waiterId === 'All' ? tables : tables.filter((t) => (t.assignedStaffId ?? null) === waiterId);
    const anyHasArea = base.some((t) => typeof (t as any).area === 'string');
    const inArea = anyHasArea && area !== 'All Areas' ? base.filter((t) => (t as any).area === area) : base;

    if (filter === 'All') return inArea;
    if (filter === 'Free') return inArea.filter((t) => t.openOrderId == null);
    if (filter === 'Occupied') return inArea.filter((t) => t.openOrderId != null);
    return inArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    });
  }, [tables, waiterId, area, filter, ordersById]);

  const counts = useMemo(() => {
    const base = waiterId === 'All' ? tables : tables.filter((t) => (t.assignedStaffId ?? null) === waiterId);
    const anyHasArea = base.some((t) => typeof (t as any).area === 'string');
    const inArea = anyHasArea && area !== 'All Areas' ? base.filter((t) => (t as any).area === area) : base;

    const free = inArea.filter((t) => t.openOrderId == null).length;
    const occupied = inArea.length - free;
    const action = inArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    }).length;
    return { all: inArea.length, free, occupied, action };
  }, [tables, waiterId, area, ordersById]);

  const handleTableClick = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    selectTable(table.id);

    if (table.openOrderId) {
      selectOrder(table.openOrderId);
    }

    onNavigate(Screen.MANAGER_TABLE_DETAILS);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#211911] text-white">
      <Header title="Floor Map" subtitle="Manager view of tables and waiter assignments" />

      <InitializePosModal
        open={initOpen}
        onClose={() => setInitOpen(false)}
        onInitialized={() => {
          try {
            window.location.reload();
          } catch {
            // ignore
          }
        }}
      />

      <div className="flex-1 overflow-hidden">
        <div className="border-b border-[#3d3226] bg-[#2c241b] px-6 py-6 flex flex-col gap-5">
          <div className="text-[#c8ad93] text-sm">
            <span className="opacity-70">Manager</span> <span className="opacity-50">/</span> <span className="text-white font-semibold">Floor Map</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">{area}</h2>
                <span className="text-[#c9b792] text-sm font-medium">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-sm text-[#c8ad93]">Filter by waiter to see their assigned tables across all areas.</div>
            </div>
            <div className="flex items-center gap-2">
              {tables.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setInitOpen(true)}
                  className="h-11 px-5 rounded-lg bg-[#eead2b] text-[#211911] font-black hover:bg-[#d99a20] flex items-center gap-2 text-sm"
                >
                  <span className="material-symbols-outlined text-[18px]">build</span>
                  Initialize POS
                </button>
              ) : null}
              <button onClick={() => onNavigate(Screen.TABLE_ASSIGNMENT)} className="h-11 px-5 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 flex items-center gap-2 text-sm font-semibold">
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back to Assign
              </button>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex gap-6 overflow-x-auto">
              <button onClick={() => setArea('All Areas')} className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === 'All Areas' ? 'border-[#cf7317] text-[#cf7317]' : 'border-transparent text-[#c8ad93] hover:text-white transition-colors'}`}>All Areas</button>
              <button onClick={() => setArea('Main Hall')} className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === 'Main Hall' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Main Hall</button>
              <button onClick={() => setArea('Patio')} className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === 'Patio' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Patio</button>
              <button onClick={() => setArea('Bar Area')} className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === 'Bar Area' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Bar Area</button>
              <button onClick={() => setArea('Private Room')} className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === 'Private Room' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Private Room</button>
            </div>

            <div className="flex gap-2 overflow-x-auto items-center">
              <button onClick={() => setFilter('All')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'All' ? 'bg-white text-black' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
                <span className="text-xs font-bold uppercase">All</span>
                <span className="bg-black/10 px-1.5 py-0.5 rounded text-[10px] font-bold">{counts.all}</span>
              </button>
              <button onClick={() => setFilter('Free')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Free' ? 'border border-[#eead2b] bg-[#eead2b]/10 text-[#eead2b]' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
                <span className="text-xs font-bold uppercase">Free</span>
                <span className="text-[10px] opacity-60">{counts.free}</span>
              </button>
              <button onClick={() => setFilter('Occupied')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Occupied' ? 'border border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
                <span className="text-xs font-bold uppercase">Occupied</span>
                <span className="text-[10px] opacity-60">{counts.occupied}</span>
              </button>
              <button onClick={() => setFilter('Action')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Action' ? 'border border-[#eead2b] bg-[#eead2b]/10 text-[#eead2b]' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
                <span className="material-symbols-outlined text-sm animate-pulse">notifications_active</span>
                <span className="text-xs font-bold uppercase">Action</span>
                <span className="text-[10px] font-bold">{counts.action}</span>
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto items-center">
            <button onClick={() => setWaiterId('All')} className={`h-9 px-4 rounded-full border text-xs font-bold ${waiterId === 'All' ? 'bg-[#cf7317] text-white border-[#cf7317]' : 'bg-transparent border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30'}`}>All Waiters</button>
            {waiters.map((w) => (
              <button key={w.id} onClick={() => setWaiterId(w.id)} className={`h-9 px-4 rounded-full border text-xs font-bold whitespace-nowrap ${waiterId === w.id ? 'bg-[#cf7317] text-white border-[#cf7317]' : 'bg-transparent border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30'}`}>{staffNameCache[w.id] || w.name}</button>
            ))}
          </div>
        </div>

        <div className="h-full overflow-y-auto px-6 py-6 lg:px-8 lg:py-8 bg-[#211911]">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-6 pb-28">
            {visibleTables.map((t) => {
              const order = t.openOrderId ? ordersById.get(t.openOrderId) : null;
              const isFree = t.openOrderId == null;
              const assignedName =
                (t as any).assignedStaffName && String((t as any).assignedStaffName).trim()
                  ? String((t as any).assignedStaffName)
                  : t.assignedStaffId
                    ? (staffNameCache[t.assignedStaffId] || staffById.get(t.assignedStaffId)?.name || '')
                    : '';

              return (
                <div
                  key={t.id}
                  onClick={() => handleTableClick(t.id)}
                  className={`group relative flex flex-col justify-between aspect-[4/3] p-5 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-1 ${
                    isFree
                      ? 'border border-dashed border-[#3d3226] bg-[#211911] hover:bg-white/5 hover:border-solid hover:border-[#cf7317]'
                      : 'border-l-4 border-l-teal-500 border-y border-r border-[#3d3226] bg-[#2c241b] hover:border-teal-500'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className={`text-4xl font-black transition-colors ${isFree ? 'text-[#483c23] group-hover:text-[#eead2b]' : 'text-white opacity-90'}`}>{t.name.replace(/^T-?/i, '')}</span>
                    <div className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${isFree ? 'bg-[#2c241b] text-[#c9b792]' : 'bg-teal-500/10 text-teal-400 border border-teal-500/20'}`}>
                      {isFree ? 'Free' : t.status === 'Payment' ? 'Payment' : order?.status ?? 'Occupied'}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#c9b792]">{assignedName ? assignedName : 'Unassigned'}</span>
                      <span className="text-xs font-bold text-[#c9b792]">{!isFree ? `ETB ${t.currentTotal.toFixed(2)}` : ''}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-white/5">
                      <span className="text-xs text-[#c9b792] flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">person</span>
                        {t.seats}
                      </span>
                      <span className="text-[10px] text-[#c9b792]">{t.openOrderId ? order?.number : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
