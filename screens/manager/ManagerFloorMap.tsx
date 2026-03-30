import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Header } from '../../components/Header';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { readSession } from '../../session';
import { formatDeviceTime } from '../../datetime';
import { InitializePosModal } from '../../components/InitializePosModal';

import { AppIcon } from '@/components/ui/app-icon';

import { Modal } from '../../components/Modal';

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
  const { tables, orders, selectOrder, selectTable, refreshFromServer, addTable, deleteTable } = usePos();
  const [initOpen, setInitOpen] = useState(false);
  const [area, setArea] = useState<string>('All Areas');
  const [filter, setFilter] = useState<'All' | 'Free' | 'Occupied' | 'Action'>('All');
  const [shiftTypeFilter, setShiftTypeFilter] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');
  const [now, setNow] = useState<Date>(() => new Date());

  // Table editing state
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableModalMode, setTableModalMode] = useState<'add' | 'edit'>('add');
  const [tableEditTarget, setTableEditTarget] = useState<typeof tables[number] | null>(null);
  const [tableDraftName, setTableDraftName] = useState('');
  const [tableDraftSeats, setTableDraftSeats] = useState(4);
  const [tableDraftArea, setTableDraftArea] = useState('');
  const [tableModalLoading, setTableModalLoading] = useState(false);

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

  const baseTables = useMemo(() => {
    let filtered = waiterId === 'All' ? tables : tables.filter((t) => (t.assignedStaffId ?? null) === waiterId);
    // Apply shift type filter
    if (shiftTypeFilter !== 'ALL') {
      filtered = filtered.filter((t) => {
        const tableShiftType = (t as any).shiftType || (t as any).shift_type || 'ALL';
        return tableShiftType === shiftTypeFilter || tableShiftType === 'ALL';
      });
    }
    return filtered;
  }, [tables, waiterId, shiftTypeFilter]);

  // Debug: log table counts and shift types
  useEffect(() => {
    console.log('[ManagerFloorMap] Tables:', tables.length, 'Base:', baseTables.length, 'ShiftFilter:', shiftTypeFilter);
    console.log('[ManagerFloorMap] Table shift types:', tables.map(t => ({ id: t.id, name: t.name, shiftType: (t as any).shiftType || (t as any).shift_type || 'ALL' })));
  }, [tables, baseTables, shiftTypeFilter]);

  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    for (const t of baseTables) {
      const a = typeof (t as any).area === 'string' ? String((t as any).area).trim() : '';
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseTables]);

  useEffect(() => {
    if (area === 'All Areas') return;
    if (availableAreas.includes(area)) return;
    setArea('All Areas');
  }, [area, availableAreas]);

  const visibleTables = useMemo(() => {
    const anyHasArea = baseTables.some((t) => typeof (t as any).area === 'string');
    const inArea = anyHasArea && area !== 'All Areas' ? baseTables.filter((t) => (t as any).area === area) : baseTables;

    if (filter === 'All') return inArea;
    if (filter === 'Free') return inArea.filter((t) => t.openOrderId == null);
    if (filter === 'Occupied') return inArea.filter((t) => t.openOrderId != null);
    return inArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    });
  }, [area, baseTables, filter, ordersById]);

  const counts = useMemo(() => {
    const anyHasArea = baseTables.some((t) => typeof (t as any).area === 'string');
    const inArea = anyHasArea && area !== 'All Areas' ? baseTables.filter((t) => (t as any).area === area) : baseTables;

    const free = inArea.filter((t) => t.openOrderId == null).length;
    const occupied = inArea.length - free;
    const action = inArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    }).length;
    return { all: inArea.length, free, occupied, action };
  }, [area, baseTables, ordersById]);

  const handleTableClick = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    selectTable(table.id);

    if (table.openOrderId) {
      selectOrder(table.openOrderId);
    }

    onNavigate(Screen.MANAGER_TABLE_DETAILS);
  };

  // Table editing handlers
  const openAddTable = () => {
    setTableModalMode('add');
    setTableEditTarget(null);
    setTableDraftName('');
    setTableDraftSeats(4);
    setTableDraftArea(area === 'All Areas' ? '' : area);
    setTableModalOpen(true);
    setTableModalLoading(false);
  };

  const openEditTable = (e: React.MouseEvent, table: typeof tables[number]) => {
    e.stopPropagation();
    setTableModalMode('edit');
    setTableEditTarget(table);
    setTableDraftName(table.name);
    setTableDraftSeats(table.seats);
    setTableDraftArea((table as any).area || '');
    setTableModalOpen(true);
    setTableModalLoading(false);
  };

  const closeTableModal = () => {
    setTableModalOpen(false);
    setTableEditTarget(null);
    setTableModalLoading(false);
  };

  const handleDeleteTable = async (e: React.MouseEvent, tableId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this table?')) return;
    try {
      deleteTable(tableId);
      await refreshFromServer();
    } catch (err) {
      alert('Failed to delete table');
    }
  };

  const submitTableModal = async () => {
    if (tableModalLoading) return;
    const name = tableDraftName.trim();
    if (!name) {
      alert('Table name is required');
      return;
    }
    if (tableDraftSeats < 1) {
      alert('Seats must be at least 1');
      return;
    }

    setTableModalLoading(true);
    try {
      if (tableModalMode === 'add') {
        // Add new table via API
        const res = await apiFetch('/api/manager/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            seats: tableDraftSeats,
            area: tableDraftArea.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } else if (tableModalMode === 'edit' && tableEditTarget) {
        // Edit existing table via API
        const res = await apiFetch(`/api/manager/tables/${encodeURIComponent(tableEditTarget.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            seats: tableDraftSeats,
            area: tableDraftArea.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
      }
      closeTableModal();
      await refreshFromServer();
    } catch (err) {
      alert(tableModalMode === 'add' ? 'Failed to add table' : 'Failed to update table');
    } finally {
      setTableModalLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
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
        <div className="border-b border-border bg-card px-6 py-6 flex flex-col gap-5">
          <div className="text-muted-foreground text-sm">
            <span className="opacity-70">Manager</span> <span className="opacity-50">/</span> <span className="text-foreground font-semibold">Floor Map</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">{area}</h2>
                <span className="text-muted-foreground text-sm font-medium">{formatDeviceTime(now, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-sm text-muted-foreground">Filter by waiter to see their assigned tables across all areas.</div>
            </div>
            <div className="flex items-center gap-2">
              {tables.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setInitOpen(true)}
                  className="h-11 px-5 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 flex items-center gap-2 text-sm"
                >
                  <AppIcon name="build" className="text-[18px]" size={18} />
                  Initialize POS
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAddTable}
                  className="h-11 px-5 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 flex items-center gap-2 text-sm"
                >
                  <AppIcon name="add" className="text-[18px]" size={18} />
                  Add Table
                </button>
              )}
              <button onClick={() => onNavigate(Screen.TABLE_ASSIGNMENT)} className="h-11 px-5 rounded-lg bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 flex items-center gap-2 text-sm font-semibold">
                <AppIcon name="arrow_back" className="text-[18px]" size={18} />
                Back to Assign
              </button>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex gap-6 overflow-x-auto">
              {[{ key: 'All Areas', label: 'All Areas' }, ...availableAreas.map((a) => ({ key: a, label: a }))].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setArea(t.key)}
                  className={`pb-2 border-b-4 font-bold text-sm tracking-wide ${area === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground transition-colors'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto items-center">
              <button onClick={() => setFilter('All')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'All' ? 'bg-secondary text-foreground border border-border' : 'border border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <span className="text-xs font-bold uppercase">All</span>
                <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-bold">{counts.all}</span>
              </button>
              <button onClick={() => setFilter('Free')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Free' ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <span className="text-xs font-bold uppercase">Free</span>
                <span className="text-[10px] opacity-60">{counts.free}</span>
              </button>
              <button onClick={() => setFilter('Occupied')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Occupied' ? 'border border-teal-500/40 bg-teal-500/10 text-teal-500' : 'border border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <span className="text-xs font-bold uppercase">Occupied</span>
                <span className="text-[10px] opacity-60">{counts.occupied}</span>
              </button>
              <button onClick={() => setFilter('Action')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Action' ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <AppIcon name="notifications_active" className="text-sm animate-pulse" size={14} />
                <span className="text-xs font-bold uppercase">Action</span>
                <span className="text-[10px] font-bold">{counts.action}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 overflow-x-auto items-center">
            <span className="text-xs text-muted-foreground font-medium mr-1">Shift:</span>
            <button onClick={() => setShiftTypeFilter('ALL')} className={`h-8 px-3 rounded-full border text-xs font-bold ${shiftTypeFilter === 'ALL' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30'}`}>All ({tables.length})</button>
            <button onClick={() => setShiftTypeFilter('DAY')} className={`h-8 px-3 rounded-full border text-xs font-bold ${shiftTypeFilter === 'DAY' ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30'}`}>☀ Day</button>
            <button onClick={() => setShiftTypeFilter('NIGHT')} className={`h-8 px-3 rounded-full border text-xs font-bold ${shiftTypeFilter === 'NIGHT' ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30'}`}>🌙 Night</button>
            <span className="text-xs text-muted-foreground ml-2">Showing: {baseTables.length}</span>
          </div>

          <div className="flex gap-2 overflow-x-auto items-center">
            <span className="text-xs text-muted-foreground font-medium mr-1">Waiter:</span>
            <button onClick={() => setWaiterId('All')} className={`h-9 px-4 rounded-full border text-xs font-bold ${waiterId === 'All' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30'}`}>All Waiters</button>
            {waiters.map((w) => (
              <button key={w.id} onClick={() => setWaiterId(w.id)} className={`h-9 px-4 rounded-full border text-xs font-bold whitespace-nowrap ${waiterId === w.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30'}`}>{staffNameCache[w.id] || w.name}</button>
            ))}
          </div>
        </div>

        <div className="h-full overflow-y-auto px-6 py-6 lg:px-8 lg:py-8 bg-background">
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
                      ? 'border border-dashed border-border bg-card hover:bg-accent hover:border-solid hover:border-primary'
                      : 'border-l-4 border-l-teal-500 border border-border bg-card hover:border-teal-500/50'
                  }`}
                >
                  {/* Shift Type Badge */}
                  <div className="absolute top-2 left-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      ((t as any).shiftType || (t as any).shift_type || 'ALL') === 'DAY'
                        ? 'bg-amber-100 text-amber-700'
                        : ((t as any).shiftType || (t as any).shift_type || 'ALL') === 'NIGHT'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {(t as any).shiftType || (t as any).shift_type || 'ALL'}
                    </span>
                  </div>
                  {/* Edit/Delete buttons - always visible and vivid */}
                  <div className="absolute top-3 right-3 flex gap-2 z-10">
                    <button
                      onClick={(e) => openEditTable(e, t)}
                      className="h-9 w-9 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/40 flex items-center justify-center border-2 border-white"
                      title="Edit table"
                    >
                      <AppIcon name="edit" size={18} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteTable(e, t.id)}
                      className="h-9 w-9 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/40 flex items-center justify-center border-2 border-white"
                      title="Delete table"
                    >
                      <AppIcon name="delete" size={18} />
                    </button>
                  </div>

                  <div className="flex justify-between items-start">
                    <span className={`text-4xl font-black transition-colors ${isFree ? 'text-muted-foreground group-hover:text-primary' : 'text-foreground opacity-90'}`}>{t.name.replace(/^T-?/i, '')}</span>
                    <div className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${isFree ? 'bg-secondary text-muted-foreground border border-border' : 'bg-teal-500/10 text-teal-500 border border-teal-500/20'}`}>
                      {isFree ? 'Free' : t.status === 'Payment' ? 'Payment' : order?.status ?? 'Occupied'}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{assignedName ? assignedName : 'Unassigned'}</span>
                      <span className="text-xs font-bold text-muted-foreground">{!isFree ? `ETB ${t.currentTotal.toFixed(2)}` : ''}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <AppIcon name="person" className="text-sm" size={14} />
                        {t.seats}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{t.openOrderId ? order?.number : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Table Add/Edit Modal */}
      <Modal open={tableModalOpen} onClose={closeTableModal} title={tableModalMode === 'add' ? 'Add Table' : 'Edit Table'}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-muted-foreground">Table Name</label>
            <input
              value={tableDraftName}
              onChange={(e) => setTableDraftName(e.target.value)}
              className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
              placeholder="e.g., T-12, Patio 1"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Seats</label>
            <input
              type="number"
              min={1}
              max={50}
              value={tableDraftSeats}
              onChange={(e) => setTableDraftSeats(Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Area (optional)</label>
            <input
              value={tableDraftArea}
              onChange={(e) => setTableDraftArea(e.target.value)}
              className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
              placeholder="e.g., Main Hall, Patio, VIP"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeTableModal} className="h-10 px-4 rounded-lg bg-secondary text-foreground font-bold">
              Cancel
            </button>
            <button
              disabled={tableModalLoading || !tableDraftName.trim()}
              onClick={submitTableModal}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-extrabold disabled:opacity-50"
            >
              {tableModalLoading ? 'Saving...' : tableModalMode === 'add' ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
