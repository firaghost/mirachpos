import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { readSession } from '../../session';
import { formatDeviceTime } from '../../datetime';
import { InitializePosModal } from '../../components/InitializePosModal';
import { AppIcon } from '@/components/ui/app-icon';
import { Modal } from '../../components/Modal';

// ─── helpers ─────────────────────────────────────────────────────────────────

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

const WAITER_STORAGE_KEY = 'mirachpos.manager.floor.waiterId';

// ─── types ────────────────────────────────────────────────────────────────────

type StatusFilter = 'All' | 'Free' | 'Occupied' | 'Action';
type ShiftFilter = 'ALL' | 'DAY' | 'NIGHT';

interface Props {
  onNavigate: (screen: Screen) => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export const ManagerFloorMap: React.FC<Props> = ({ onNavigate }) => {
  const { tables, orders, selectOrder, selectTable, refreshFromServer, addTable, deleteTable } = usePos();

  const [initOpen, setInitOpen] = useState(false);
  const [area, setArea] = useState<string>('All Areas');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('ALL');
  const [now, setNow] = useState<Date>(() => new Date());

  // Table modal state
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableModalMode, setTableModalMode] = useState<'add' | 'edit'>('add');
  const [tableEditTarget, setTableEditTarget] = useState<typeof tables[number] | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSeats, setDraftSeats] = useState(4);
  const [draftArea, setDraftArea] = useState('');
  const [draftShiftType, setDraftShiftType] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');
  const [draftWaiterId, setDraftWaiterId] = useState<string>('');
  const [modalLoading, setModalLoading] = useState(false);

  // Staff
  const [remoteWaiters, setRemoteWaiters] = useState<Array<{ id: string; name: string }>>([]);
  const staffNameCache = useMemo(() => readStaffNameCache(), []);

  const [waiterId, setWaiterId] = useState<string | 'All'>(() => {
    try {
      return localStorage.getItem(WAITER_STORAGE_KEY) ?? 'All';
    } catch {
      return 'All';
    }
  });

  // Clock
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Persist waiter filter
  useEffect(() => {
    try {
      if (waiterId === 'All') localStorage.removeItem(WAITER_STORAGE_KEY);
      else localStorage.setItem(WAITER_STORAGE_KEY, waiterId);
    } catch { /* ignore */ }
  }, [waiterId]);

  // Fetch waiters
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = readSession<any>();
        const role = typeof s?.role === 'string' ? s.role : '';
        if (role !== 'Branch Manager' && role !== 'Cafe Owner') return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const res = await apiFetch('/api/manager/staff?pageSize=200');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !mounted) return;
        const rows = Array.isArray(json?.staff) ? (json.staff as any[]) : [];
        const waiters = rows
          .filter((s) => String(s?.roleName || '').toLowerCase() === 'waiter')
          .map((s) => ({ id: String(s.id || ''), name: String(s.name || '') }))
          .filter((s) => s.id && s.name);
        setRemoteWaiters(waiters);
        try {
          const cache: Record<string, string> = { ...readStaffNameCache() };
          for (const w of waiters) cache[w.id] = w.name;
          localStorage.setItem('mirachpos.staffNameCache.v1', JSON.stringify(cache));
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { void refreshFromServer(); }, [refreshFromServer]);

  // ── derived data ────────────────────────────────────────────────────────────

  const ordersById = useMemo(() => {
    const m = new Map<string, typeof orders[number]>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  const staffById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const [id, name] of Object.entries(staffNameCache as Record<string, string>)) {
      if (id && name) m.set(id, { id, name });
    }
    for (const s of remoteWaiters) {
      if (s.id && s.name) m.set(s.id, { id: s.id, name: s.name });
    }
    return m;
  }, [remoteWaiters, staffNameCache]);

  const baseTables = useMemo(() => {
    let t = waiterId === 'All' ? tables : tables.filter((t) => (t as any).assignedStaffId === waiterId);
    if (shiftFilter !== 'ALL') {
      t = t.filter((t) => {
        const st = (t as any).shiftType || (t as any).shift_type || 'ALL';
        return st === shiftFilter || st === 'ALL';
      });
    }
    return t;
  }, [tables, waiterId, shiftFilter]);

  const availableAreas = useMemo(() => {
    const s = new Set<string>();
    for (const t of baseTables) {
      const a = typeof (t as any).area === 'string' ? String((t as any).area).trim() : '';
      if (a) s.add(a);
    }
    return Array.from(s).sort();
  }, [baseTables]);

  // Reset area when it disappears
  useEffect(() => {
    if (area !== 'All Areas' && !availableAreas.includes(area)) setArea('All Areas');
  }, [area, availableAreas]);

  const areaFiltered = useMemo(() => {
    const anyArea = baseTables.some((t) => typeof (t as any).area === 'string');
    return anyArea && area !== 'All Areas'
      ? baseTables.filter((t) => (t as any).area === area)
      : baseTables;
  }, [area, baseTables]);

  const visibleTables = useMemo(() => {
    if (statusFilter === 'All') return areaFiltered;
    if (statusFilter === 'Free') return areaFiltered.filter((t) => t.openOrderId == null);
    if (statusFilter === 'Occupied') return areaFiltered.filter((t) => t.openOrderId != null);
    return areaFiltered.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    });
  }, [areaFiltered, statusFilter, ordersById]);

  const counts = useMemo(() => {
    const free = areaFiltered.filter((t) => t.openOrderId == null).length;
    const occupied = areaFiltered.length - free;
    const action = areaFiltered.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    }).length;
    return { all: areaFiltered.length, free, occupied, action };
  }, [areaFiltered, ordersById]);

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleTableClick = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    selectTable(table.id);
    if (table.openOrderId) selectOrder(table.openOrderId);
    onNavigate(Screen.MANAGER_TABLE_DETAILS);
  };

  const openAddTable = () => {
    setTableModalMode('add');
    setTableEditTarget(null);
    setDraftName('');
    setDraftSeats(4);
    setDraftArea(area === 'All Areas' ? '' : area);
    setDraftShiftType('ALL');
    setDraftWaiterId('');
    setModalLoading(false);
    setTableModalOpen(true);
  };

  const openEditTable = (e: React.MouseEvent, table: typeof tables[number]) => {
    e.stopPropagation();
    setTableModalMode('edit');
    setTableEditTarget(table);
    setDraftName(table.name);
    setDraftSeats(table.seats);
    setDraftArea((table as any).area || '');
    setDraftShiftType(((table as any).shiftType || (table as any).shift_type || 'ALL') as 'ALL' | 'DAY' | 'NIGHT');
    setDraftWaiterId((table as any).assignedStaffId || '');
    setModalLoading(false);
    setTableModalOpen(true);
  };

  const handleDeleteTable = async (e: React.MouseEvent, tableId: string) => {
    e.stopPropagation();
    if (!confirm('Delete this table?')) return;
    try {
      deleteTable(tableId);
      await refreshFromServer();
    } catch {
      alert('Failed to delete table');
    }
  };

  const submitTableModal = async () => {
    if (modalLoading) return;
    const name = draftName.trim();
    if (!name) { alert('Table name is required'); return; }
    if (draftSeats < 1) { alert('Seats must be at least 1'); return; }

    const waiter = draftWaiterId ? staffById.get(draftWaiterId) : null;
    const assignedStaffId = waiter?.id || null;
    const assignedStaffName = waiter?.name || null;

    setModalLoading(true);
    try {
      if (tableModalMode === 'add') {
        // Create locally via context (source of truth) and notify server
        addTable({
          name,
          seats: draftSeats,
          area: (draftArea.trim() || undefined) as any,
          shiftType: draftShiftType,
          assignedStaffId,
          assignedStaffName,
        });
        // Best-effort server sync
        try {
          await apiFetch('/api/manager/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, seats: draftSeats, area: draftArea.trim() || undefined, shiftType: draftShiftType, assignedStaffId }),
          });
        } catch { /* server sync best-effort */ }
      } else if (tableEditTarget) {
        // Best-effort server sync
        try {
          await apiFetch(`/api/manager/tables/${encodeURIComponent(tableEditTarget.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, seats: draftSeats, area: draftArea.trim() || undefined, shiftType: draftShiftType, assignedStaffId }),
          });
        } catch { /* server sync best-effort */ }
      }
      setTableModalOpen(false);
      setTableEditTarget(null);
      await refreshFromServer();
    } catch {
      alert(tableModalMode === 'add' ? 'Failed to add table' : 'Failed to update table');
    } finally {
      setModalLoading(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────

  const STATUS_FILTERS: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'All', label: 'All', count: counts.all },
    { key: 'Free', label: 'Free', count: counts.free },
    { key: 'Occupied', label: 'Occupied', count: counts.occupied },
    { key: 'Action', label: 'Action', count: counts.action },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">

      {/* ── Top bar ── */}
      <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">
            Manager / <span className="text-foreground font-semibold">Floor Map</span>
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-black tracking-tight">{area}</h1>
            <span className="text-muted-foreground text-xs font-medium tabular-nums">
              {formatDeviceTime(now, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {tables.length === 0 ? (
            <button
              type="button"
              onClick={() => setInitOpen(true)}
              className="h-9 px-4 rounded bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary/90 transition-colors"
            >
              <AppIcon name="build" size={15} />
              Initialize POS
            </button>
          ) : (
            <button
              type="button"
              onClick={openAddTable}
              className="h-9 px-4 rounded bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary/90 transition-colors"
            >
              <AppIcon name="add" size={15} />
              Add Table
            </button>
          )}
          <button
            onClick={() => onNavigate(Screen.MANAGER_DASHBOARD)}
            className="h-9 px-4 rounded border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors flex items-center gap-1.5"
          >
            <AppIcon name="arrow_back" size={15} />
            Dashboard
          </button>
        </div>
      </div>

      {/* ── Control strip ── */}
      <div className="border-b border-border bg-card/60 px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">

        {/* Area tabs */}
        <div className="flex items-center gap-4 overflow-x-auto">
          {[{ key: 'All Areas', label: 'All Areas' }, ...availableAreas.map((a) => ({ key: a, label: a }))].map((t) => (
            <button
              key={t.key}
              onClick={() => setArea(t.key)}
              className={`pb-1.5 border-b-2 text-xs font-bold tracking-wide whitespace-nowrap transition-colors ${
                area === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-border hidden md:block" />

        {/* Status pills */}
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            const colorMap: Record<StatusFilter, string> = {
              All: active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              Free: active ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:text-foreground',
              Occupied: active ? 'bg-cyan-600 text-white' : 'text-muted-foreground hover:text-foreground',
              Action: active ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground',
            };
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`h-7 px-3 rounded text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                  active ? `${colorMap[f.key]} border-transparent` : `border-border ${colorMap[f.key]}`
                }`}
              >
                {f.key === 'Action' && active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
                )}
                {f.label}
                <span className={`ml-0.5 opacity-70 tabular-nums`}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-border hidden md:block" />

        {/* Shift filter */}
        <div className="flex items-center gap-1">
          {(['ALL', 'DAY', 'NIGHT'] as ShiftFilter[]).map((s) => {
            const icons: Record<ShiftFilter, string> = { ALL: '⊙', DAY: '☀', NIGHT: '🌙' };
            return (
              <button
                key={s}
                onClick={() => setShiftFilter(s)}
                className={`h-7 px-2.5 rounded text-[11px] font-bold border transition-colors ${
                  shiftFilter === s
                    ? 'bg-secondary border-border text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {icons[s]} {s === 'ALL' ? 'All Shifts' : s}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        {remoteWaiters.length > 0 && <div className="h-5 w-px bg-border hidden md:block" />}

        {/* Waiter filter */}
        {remoteWaiters.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto">
            <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">Waiter:</span>
            {[{ id: 'All', name: 'All' }, ...remoteWaiters].map((w) => (
              <button
                key={w.id}
                onClick={() => setWaiterId(w.id)}
                className={`h-7 px-3 rounded text-[11px] font-bold border whitespace-nowrap transition-colors ${
                  waiterId === w.id
                    ? 'bg-secondary border-border text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {w.id === 'All' ? 'All Waiters' : (staffNameCache[w.id] || w.name)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Table grid ── */}
      <div className="flex-1 overflow-y-auto p-6 bg-background">
        {visibleTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <AppIcon name="table_restaurant" size={48} className="opacity-20" />
            <div className="text-center">
              <p className="font-semibold text-foreground">No tables found</p>
              <p className="text-sm mt-1">
                {tables.length === 0
                  ? 'Initialize your POS to create tables.'
                  : 'Try changing the filters above.'}
              </p>
            </div>
            {tables.length === 0 && (
              <button
                onClick={() => setInitOpen(true)}
                className="mt-2 h-9 px-4 rounded bg-primary text-primary-foreground text-xs font-bold"
              >
                Initialize POS
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 pb-20">
            {visibleTables.map((t) => {
              const order = t.openOrderId ? ordersById.get(t.openOrderId) : null;
              const isFree = t.openOrderId == null;
              const isAction = !isFree && (t.status === 'Payment' || order?.status === 'Ready');
              const shiftType = (t as any).shiftType || (t as any).shift_type || 'ALL';

              const assignedName =
                (t as any).assignedStaffName
                  ? String((t as any).assignedStaffName)
                  : t.assignedStaffId
                    ? (staffById.get(t.assignedStaffId)?.name || '')
                    : '';

              const cardBorder = isFree
                ? 'border border-dashed border-border hover:border-primary hover:border-solid'
                : isAction
                  ? 'border-l-4 border-l-amber-500 border border-amber-500/20'
                  : 'border-l-4 border-l-cyan-500 border border-cyan-500/15';

              const statusChip = isFree
                ? 'bg-secondary text-muted-foreground text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded'
                : isAction
                  ? 'bg-amber-500/15 text-amber-500 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded'
                  : 'bg-cyan-500/10 text-cyan-500 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded';

              return (
                <div
                  key={t.id}
                  onClick={() => handleTableClick(t.id)}
                  className={`group relative flex flex-col justify-between aspect-[4/3] p-4 rounded-lg cursor-pointer transition-all duration-150 hover:-translate-y-0.5 bg-card ${cardBorder}`}
                >
                  {/* Shift badge */}
                  {shiftType !== 'ALL' && (
                    <span className={`absolute top-2 left-2 text-[9px] font-bold px-1 py-0.5 rounded ${
                      shiftType === 'DAY' ? 'bg-amber-100 text-amber-700' : 'bg-slate-700 text-slate-200'
                    }`}>
                      {shiftType === 'DAY' ? '☀' : '🌙'}
                    </span>
                  )}

                  {/* Edit / Delete — only on hover */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={(e) => openEditTable(e, t)}
                      className="h-7 w-7 rounded bg-background/90 border border-border text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                      title="Edit table"
                    >
                      <AppIcon name="edit" size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteTable(e, t.id)}
                      className="h-7 w-7 rounded bg-background/90 border border-red-500/30 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors"
                      title="Delete table"
                    >
                      <AppIcon name="delete" size={14} />
                    </button>
                  </div>

                  {/* Table number */}
                  <div className="flex items-start justify-between pt-1">
                    <span className={`text-3xl font-black leading-none transition-colors ${
                      isFree ? 'text-muted-foreground group-hover:text-primary' : 'text-foreground'
                    }`}>
                      {t.name.replace(/^T-?/i, '') || t.name}
                    </span>
                    <span className={statusChip}>
                      {isFree ? 'Free' : isAction ? (t.status === 'Payment' ? 'Pay' : 'Ready') : 'Busy'}
                    </span>
                  </div>

                  {/* Footer info */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground truncate max-w-[70%]">
                        {assignedName || <span className="opacity-50">Unassigned</span>}
                      </span>
                      {!isFree && (
                        <span className="text-[11px] font-bold text-foreground tabular-nums">
                          ETB {t.currentTotal.toFixed(0)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                        <AppIcon name="person" size={12} />
                        {t.seats}
                      </span>
                      {order?.number && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">{order.number}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── InitializePOS modal ── */}
      <InitializePosModal
        open={initOpen}
        onClose={() => setInitOpen(false)}
        onInitialized={() => {
          try { window.location.reload(); } catch { /* ignore */ }
        }}
      />

      {/* ── Add / Edit table modal ── */}
      <Modal
        open={tableModalOpen}
        onClose={() => { setTableModalOpen(false); setTableEditTarget(null); setModalLoading(false); }}
        title={tableModalMode === 'add' ? 'Add Table' : 'Edit Table'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Table Name</label>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="e.g., T-12, Patio 1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Seats</label>
              <input
                type="number"
                min={1}
                max={50}
                value={draftSeats}
                onChange={(e) => setDraftSeats(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Shift</label>
              <select
                value={draftShiftType}
                onChange={(e) => setDraftShiftType(e.target.value as 'ALL' | 'DAY' | 'NIGHT')}
                className="w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="ALL">All Shifts</option>
                <option value="DAY">☀ Day Shift</option>
                <option value="NIGHT">🌙 Night Shift</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Area <span className="font-normal opacity-60">(optional)</span></label>
            <input
              value={draftArea}
              onChange={(e) => setDraftArea(e.target.value)}
              className="w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="e.g., Main Hall, Patio, VIP"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Assign Waiter <span className="font-normal opacity-60">(optional)</span></label>
            <select
              value={draftWaiterId}
              onChange={(e) => setDraftWaiterId(e.target.value)}
              className="w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Unassigned</option>
              {remoteWaiters.map((w) => (
                <option key={w.id} value={w.id}>{staffById.get(w.id)?.name || w.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setTableModalOpen(false); setTableEditTarget(null); setModalLoading(false); }}
              className="h-9 px-4 rounded border border-border text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={modalLoading || !draftName.trim()}
              onClick={submitTableModal}
              className="h-9 px-4 rounded bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {modalLoading ? 'Saving…' : tableModalMode === 'add' ? 'Add Table' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
