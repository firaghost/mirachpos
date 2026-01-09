import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { formatDeviceDate, formatDeviceTime } from '../../datetime';

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

type DraftRec = {
  draft_id: string;
  created_by_staff_id?: string;
  status?: string;
  notes?: string;
  summary?: { items?: number; total?: number };
  items?: Array<{ product_id?: string; name?: string; image?: string; unit_price?: number; qty?: number }>;
  submitted_at_local?: string;
  updated_at_server?: string;
};

type AuditRec = {
  id?: string;
  at?: string;
  actor_name?: string;
  actor_staff_id?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  message?: string;
};

interface Props {
    onNavigate: (screen: Screen) => void;
}

export const WaiterDashboard: React.FC<Props> = ({ onNavigate }) => {
  const { tables, orders, selectTable, selectOrder, refreshFromServer, setTableAssignment } = usePos();
  const session = useMemo(() => {
    try {
      return readSession<any>();
    } catch {
      return null;
    }
  }, []);
  const staffId = typeof session?.staffId === 'string' ? session.staffId : '';
  const sessionRole = useMemo(() => {
    try {
      const s = readSession<any>();
      return typeof s?.role === 'string' ? s.role : '';
    } catch {
      return '';
    }
  }, []);

  const isImpersonationEnabled = sessionRole === 'Branch Manager' || sessionRole === 'Cafe Owner' || sessionRole === 'Waiter Manager';
  const isWaiterManager = sessionRole === 'Waiter Manager';
  const [area, setArea] = useState<'All Areas' | 'Main Hall' | 'Patio' | 'Bar Area' | 'Private Room'>('All Areas');
  const [filter, setFilter] = useState<'All' | 'Free' | 'Occupied' | 'Action'>('All');
  const [now, setNow] = useState<Date>(() => new Date());
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftErr, setDraftErr] = useState('');
  const [drafts, setDrafts] = useState<DraftRec[]>([]);
  const [sideTab, setSideTab] = useState<'drafts' | 'activity'>('drafts');
  const [rightOpen, setRightOpen] = useState(() => {
    try {
      const v = localStorage.getItem('mirachpos.waiter.rightPanelOpen');
      if (v === '0') return false;
      if (v === '1') return true;
      return true;
    } catch {
      return true;
    }
  });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditErr, setAuditErr] = useState('');
  const [auditRows, setAuditRows] = useState<AuditRec[]>([]);
  const [actionErr, setActionErr] = useState('');
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchWaiterId, setSwitchWaiterId] = useState<string>('');
  const [switchPin, setSwitchPin] = useState('');
  const [switchErr, setSwitchErr] = useState('');
  const [switching, setSwitching] = useState(false);
  const [impersonateWaiterId, setImpersonateWaiterId] = useState<string | null>(() => {
    try {
      if (!isImpersonationEnabled) return null;
      return localStorage.getItem('mirachpos.manager.impersonate.waiterId');
    } catch {
      return null;
    }
  });

  const [staffNameCache, setStaffNameCache] = useState<Record<string, string>>(() => readStaffNameCache());
  const [remoteStaff, setRemoteStaff] = useState<Array<{ id: string; name: string; roleName?: string }>>([]);

  useEffect(() => {
    if (isImpersonationEnabled) return;
    setImpersonateWaiterId(null);
  }, [isImpersonationEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('mirachpos.waiter.rightPanelOpen', rightOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [rightOpen]);

  const impersonatedWaiter = useMemo(() => {
    if (!impersonateWaiterId) return null;
    const name = staffNameCache[impersonateWaiterId] || remoteStaff.find((s) => s.id === impersonateWaiterId)?.name || '';
    return { id: impersonateWaiterId, name: name || impersonateWaiterId };
  }, [impersonateWaiterId]);

  const visibleTables = useMemo(() => {
    const effectiveWaiterId = impersonateWaiterId || staffId;

    // Shared-device waiter portal behavior:
    // - Waiters should only see their assigned tables + unassigned tables.
    // - Managers/owners can see all tables unless they are impersonating.
    if (isImpersonationEnabled && !impersonateWaiterId) return tables;

    return tables.filter((t) => {
      const assigned = typeof (t as any).assignedStaffId === 'string' ? String((t as any).assignedStaffId) : '';
      if (!assigned) return true;
      return assigned === effectiveWaiterId;
    });
  }, [impersonateWaiterId, isImpersonationEnabled, staffId, tables]);

  const remoteWaiters = useMemo(() => {
    return remoteStaff.filter((s) => String(s.roleName || '').trim() === 'Waiter');
  }, [remoteStaff]);

  useEffect(() => {
    if (!isImpersonationEnabled) return;
    let mounted = true;
    const run = async () => {
      try {
        try {
          const s = readSession<any>();
          const role = typeof s?.role === 'string' ? s.role : '';
          if (role !== 'Branch Manager' && role !== 'Cafe Owner' && role !== 'Waiter Manager') return;
        } catch {
          return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const res = await apiFetch('/api/manager/staff?pageSize=200');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.staff) ? (json.staff as any[]) : [];
        const staff = rows
          .map((s) => ({ id: String(s.id || ''), name: String(s.name || ''), roleName: String(s.roleName || '') }))
          .filter((s) => s.id && s.name);
        if (!mounted) return;
        setRemoteStaff(staff);

        try {
          const cache: Record<string, string> = { ...readStaffNameCache() };
          for (const r of staff) cache[r.id] = r.name;
          localStorage.setItem('mirachpos.staffNameCache.v1', JSON.stringify(cache));
          window.dispatchEvent(new Event('mirachpos-staff-cache-changed'));
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
  }, [isImpersonationEnabled]);

  useEffect(() => {
    const refresh = () => {
      setStaffNameCache(readStaffNameCache());
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('mirachpos-staff-cache-changed', refresh as any);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('mirachpos-staff-cache-changed', refresh as any);
    };
  }, [tables]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const loadDrafts = async () => {
    setDraftLoading(true);
    setDraftErr('');
    try {
      const res = await apiFetch(`/api/sync/drafts/inbox?status=SUBMITTED`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const items = Array.isArray(json?.drafts) ? (json.drafts as DraftRec[]) : [];
      setDrafts(items);
    } catch (e) {
      setDraftErr(e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Failed to load drafts');
    } finally {
      setDraftLoading(false);
    }
  };

  useEffect(() => {
    loadDrafts();
    const id = window.setInterval(() => loadDrafts(), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const loadAudit = async () => {
    setAuditLoading(true);
    setAuditErr('');
    try {
      const res = await apiFetch(`/api/audit/list?limit=50`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.audit) ? (json.audit as AuditRec[]) : [];
      setAuditRows(rows);
    } catch (e) {
      setAuditErr(e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Failed to load activity');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
    const id = window.setInterval(() => loadAudit(), 10_000);
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
    for (const s of remoteStaff) {
      if (!s.id || !s.name) continue;
      map.set(s.id, { id: s.id, name: s.name });
    }
    return map;
  }, [remoteStaff, staffNameCache]);

  const tablesInArea = useMemo(() => {
    const anyHasArea = visibleTables.some((t) => typeof (t as any).area === 'string');
    if (!anyHasArea) return visibleTables;
    if (area === 'All Areas') return visibleTables;
    return visibleTables.filter((t) => (t as any).area === area);
  }, [visibleTables, area]);

  const counts = useMemo(() => {
    const free = tablesInArea.filter((t) => t.openOrderId == null).length;
    const occupied = tablesInArea.length - free;
    const action = tablesInArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    }).length;
    return { all: tablesInArea.length, free, occupied, action };
  }, [tablesInArea, ordersById]);

  const sortedTablesInArea = useMemo(() => {
    const list = [...tablesInArea];
    const numFromName = (name: string): number => {
      const n = String(name || '').trim();
      const m = n.match(/(\d+)/);
      return m ? Number(m[1]) || 0 : 0;
    };
    return list.sort((a, b) => {
      const areaA = String((a as any).area || '').trim();
      const areaB = String((b as any).area || '').trim();
      if (areaA !== areaB) return areaA.localeCompare(areaB);
      const na = numFromName(String(a.name || a.id || ''));
      const nb = numFromName(String(b.name || b.id || ''));
      if (na !== nb) return na - nb;
      return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''));
    });
  }, [tablesInArea]);

  const filteredTables = useMemo(() => {
    if (filter === 'All') return sortedTablesInArea;
    if (filter === 'Free') return sortedTablesInArea.filter((t) => t.openOrderId == null);
    if (filter === 'Occupied') return sortedTablesInArea.filter((t) => t.openOrderId != null);
    return sortedTablesInArea.filter((t) => {
      if (!t.openOrderId) return false;
      const o = ordersById.get(t.openOrderId);
      return t.status === 'Payment' || o?.status === 'Ready';
    });
  }, [sortedTablesInArea, filter, ordersById]);

  const handleTableClick = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    const effectiveWaiterId = impersonateWaiterId || staffId;
    const assigned = typeof (table as any).assignedStaffId === 'string' ? String((table as any).assignedStaffId) : '';
    const isAssignedToOther = assigned && effectiveWaiterId && assigned !== effectiveWaiterId;
    if (!isImpersonationEnabled && isAssignedToOther) {
      setActionErr('This table is assigned to another waiter. Ask a manager to reassign it.');
      return;
    }

    selectTable(table.id);

    // Assign the table to the current waiter on first interaction.
    try {
      if (effectiveWaiterId && !table.assignedStaffId) {
        const name = staffById.get(effectiveWaiterId)?.name || staffNameCache[effectiveWaiterId] || '';
        setTableAssignment([table.id], effectiveWaiterId, name || null);
      }
    } catch {
      // ignore
    }

    if (table.openOrderId) {
      selectOrder(table.openOrderId);
      const o = ordersById.get(table.openOrderId);
      if (table.status === 'Payment' || o?.status === 'Served') {
        onNavigate(Screen.WAITER_PAYMENT);
      } else {
        onNavigate(Screen.WAITER_REVIEW);
      }
      return;
    }

    onNavigate(Screen.WAITER_MENU);
  };

  const handleRefresh = async () => {
    setNow(new Date());
    setActionErr('');
    try {
      await refreshFromServer();
      try {
        if (sideTab === 'drafts') await loadDrafts();
        else await loadAudit();
      } catch {
        // ignore
      }
    } catch {
      setActionErr('Failed to refresh from server.');
    }
  };

  const handleNewWalkIn = () => {
    setActionErr('');
    const free = tables.find((t) => t.openOrderId == null);
    if (!free) {
      setActionErr('No free tables available.');
      return;
    }

    const effectiveWaiterId = impersonateWaiterId || staffId;
    const assigned = typeof (free as any).assignedStaffId === 'string' ? String((free as any).assignedStaffId) : '';
    const isAssignedToOther = assigned && effectiveWaiterId && assigned !== effectiveWaiterId;
    if (!isImpersonationEnabled && isAssignedToOther) {
      setActionErr('No unassigned/free tables available. Ask a manager to reassign a table.');
      return;
    }
    selectTable(free.id);

    try {
      if (effectiveWaiterId && !free.assignedStaffId) {
        const name = staffById.get(effectiveWaiterId)?.name || staffNameCache[effectiveWaiterId] || '';
        setTableAssignment([free.id], effectiveWaiterId, name || null);
      }
    } catch {
      // ignore
    }

    onNavigate(Screen.WAITER_MENU);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
      {switchOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#483c23] bg-[#221c11] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#483c23] bg-[#2c2417] flex items-center justify-between">
              <div>
                <div className="text-lg font-black">Active Waiter</div>
                <div className="text-xs text-[#c9b792] mt-0.5">Switch without logging out</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSwitchOpen(false);
                  setSwitchErr('');
                  setSwitchPin('');
                }}
                className="h-9 px-3 rounded-lg border border-[#483c23] bg-[#221c11] text-[#c9b792] hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-[#b9b09d]">Select waiter</label>
                <select
                  value={switchWaiterId}
                  onChange={(e) => setSwitchWaiterId(e.target.value)}
                  className="mt-2 w-full h-11 rounded-lg border border-[#393328] bg-[#181611] px-3 text-white"
                >
                  <option value="">Choose waiter…</option>
                  {remoteWaiters.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              {!isWaiterManager ? (
                <div>
                  <label className="text-xs font-bold text-[#b9b09d]">Waiter PIN</label>
                  <input
                    type="password"
                    value={switchPin}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      setSwitchPin(v);
                    }}
                    placeholder="1234"
                    className="mt-2 w-full h-11 rounded-lg border border-[#393328] bg-[#181611] px-3 text-white"
                  />
                </div>
              ) : null}
              {switchErr ? <div className="text-xs text-red-300 font-semibold">{switchErr}</div> : null}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => {
                    try {
                      localStorage.removeItem('mirachpos.manager.impersonate.waiterId');
                    } catch {
                      // ignore
                    }
                    setImpersonateWaiterId(null);
                    setSwitchOpen(false);
                    setSwitchErr('');
                    setSwitchPin('');
                  }}
                  className="h-11 px-4 rounded-lg border border-[#483c23] bg-[#221c11] text-[#c9b792] hover:text-white font-bold"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={switching || !switchWaiterId || (!isWaiterManager && switchPin.trim().length < 3)}
                  onClick={async () => {
                    if (switching) return;
                    setSwitchErr('');
                    setSwitching(true);
                    try {
                      if (!isWaiterManager) {
                        const res = await apiFetch('/api/pos/staff/verify-pin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ staffId: switchWaiterId, pin: switchPin.trim() }),
                        });
                        const json = (await res.json().catch(() => null)) as any;
                        if (!res.ok) {
                          const err = String(json?.error || 'forbidden');
                          if (err === 'pin_required') setSwitchErr('PIN required or incorrect.');
                          else if (err === 'staff_not_found') setSwitchErr('Waiter not found.');
                          else setSwitchErr('Failed to switch waiter.');
                          return;
                        }
                      }
                      try {
                        localStorage.setItem('mirachpos.manager.impersonate.waiterId', switchWaiterId);
                      } catch {
                        // ignore
                      }
                      setImpersonateWaiterId(switchWaiterId);
                      setSwitchOpen(false);
                      setSwitchErr('');
                      setSwitchPin('');
                      try {
                        await refreshFromServer();
                      } catch {
                        // ignore
                      }
                    } catch {
                      setSwitchErr('Failed to switch waiter.');
                    } finally {
                      setSwitching(false);
                    }
                  }}
                  className="h-11 px-5 rounded-lg bg-[#eead2b] hover:bg-[#d49a26] text-[#221c11] font-extrabold disabled:opacity-50"
                >
                  {switching ? 'Switching…' : 'Set Active Waiter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isImpersonationEnabled && impersonateWaiterId && (
        <div className="px-6 py-2 bg-[#2c2417] border-b border-[#483c23] flex items-center justify-between">
          <div className="text-xs text-[#c9b792]">
            Viewing as: <span className="text-white font-bold">{impersonatedWaiter?.name ?? impersonateWaiterId}</span>
          </div>
          <button
            onClick={() => {
              let returnScreen: Screen | null = null;
              try {
                const raw = localStorage.getItem('mirachpos.manager.impersonate.returnScreen');
                returnScreen = (raw as Screen) ?? null;
                localStorage.removeItem('mirachpos.manager.impersonate.returnScreen');
              } catch {
                // ignore
              }
              try {
                localStorage.removeItem('mirachpos.manager.impersonate.waiterId');
              } catch {
                // ignore
              }
              setImpersonateWaiterId(null);
              if (returnScreen) {
                onNavigate(returnScreen);
              }
            }}
            className="h-8 px-3 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] hover:text-white hover:border-[#eead2b]/40 text-xs font-bold"
          >
            Exit
          </button>
        </div>
      )}
      {/* Header Section */}
      <header className="bg-[#2c2417] border-b border-[#483c23] flex-shrink-0 z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-6 py-4 gap-4">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-3">
              <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">{area}</h2>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-900/30 text-green-400 border border-green-800">OPEN</span>
            </div>
            <p className="text-[#c9b792] text-sm font-medium mt-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">schedule</span>
              {formatDeviceTime(now, { hour: '2-digit', minute: '2-digit' })}    {formatDeviceDate(now, { month: 'short', day: '2-digit', year: 'numeric' })}
            </p>
            {actionErr ? <p className="mt-2 text-xs text-red-300 font-semibold">{actionErr}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            {isImpersonationEnabled && (
              <button
                onClick={() => {
                  setSwitchErr('');
                  setSwitchPin('');
                  setSwitchWaiterId(impersonateWaiterId || '');
                  setSwitchOpen(true);
                }}
                className="hidden md:flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] hover:text-white hover:border-[#eead2b]/40 transition-colors text-sm font-bold"
              >
                <span className="material-symbols-outlined text-lg">badge</span>
                Active Waiter
              </button>
            )}
            <button
              onClick={() => void handleRefresh()}
              className="hidden md:flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#483c23] text-white hover:bg-[#5a4530] transition-colors text-sm font-bold"
            >
              <span className="material-symbols-outlined text-lg">sync</span>
              Refresh
            </button>
            <button 
                onClick={handleNewWalkIn}
                className="flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-[#eead2b] text-[#221c11] hover:bg-[#d49619] shadow-lg shadow-[#eead2b]/20 transition-all text-sm font-bold"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              New Walk-in
            </button>
          </div>
        </div>
        {/* Floor Tabs & Status Filter Row */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between px-6 pb-0 gap-4">
          <div className="flex gap-6 border-b border-transparent xl:border-none overflow-x-auto">
            <button onClick={() => setArea('All Areas')} className={`pb-3 border-b-4 font-bold text-sm tracking-wide ${area === 'All Areas' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>All Areas</button>
            <button onClick={() => setArea('Main Hall')} className={`pb-3 border-b-4 font-bold text-sm tracking-wide ${area === 'Main Hall' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Main Hall</button>
            <button onClick={() => setArea('Patio')} className={`pb-3 border-b-4 font-bold text-sm tracking-wide ${area === 'Patio' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Patio</button>
            <button onClick={() => setArea('Bar Area')} className={`pb-3 border-b-4 font-bold text-sm tracking-wide ${area === 'Bar Area' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Bar Area</button>
            <button onClick={() => setArea('Private Room')} className={`pb-3 border-b-4 font-bold text-sm tracking-wide ${area === 'Private Room' ? 'border-[#eead2b] text-[#eead2b]' : 'border-transparent text-[#c9b792] hover:text-white transition-colors'}`}>Private Room</button>
          </div>
          <div className="flex gap-2 pb-3 overflow-x-auto items-center">
            <button onClick={() => setFilter('All')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'All' ? 'bg-white text-black' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
              <span className="text-xs font-bold uppercase">All</span>
              <span className="bg-black/10 px-1.5 py-0.5 rounded text-[10px] font-bold">{counts.all}</span>
            </button>
            <button onClick={() => setFilter('Free')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Free' ? 'border border-[#eead2b] bg-[#eead2b]/10 text-[#eead2b]' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
              <span className="w-2 h-2 rounded-full bg-[#c9b792]"></span>
              <span className="text-xs font-bold uppercase">Free</span>
              <span className="text-[10px] opacity-60">{counts.free}</span>
            </button>
            <button onClick={() => setFilter('Occupied')} className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-4 transition-colors ${filter === 'Occupied' ? 'border border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border border-[#483c23] bg-transparent text-[#c9b792] hover:bg-[#3a2e22] hover:text-white'}`}>
              <span className="w-2 h-2 rounded-full bg-teal-500"></span>
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
      </header>

      <div className="flex-1 overflow-hidden bg-[#1a1612]">
        <div className="flex h-full overflow-hidden relative">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-6 pb-28">
              {filteredTables.map((t) => {
                const order = t.openOrderId ? ordersById.get(t.openOrderId) : null;
                const isFree = t.openOrderId == null;
                const isOccupied = !isFree;
                const assignedName =
                  (t as any).assignedStaffName && String((t as any).assignedStaffName).trim()
                    ? String((t as any).assignedStaffName)
                    : t.assignedStaffId
                      ? (staffNameCache[t.assignedStaffId] || staffById.get(t.assignedStaffId)?.name || '')
                      : '';
                const displayTotal = isOccupied ? (typeof order?.total === 'number' ? order.total : t.currentTotal) : 0;

                return (
                  <div
                    key={t.id}
                    onClick={() => handleTableClick(t.id)}
                    className={`group relative flex flex-col justify-between aspect-[4/3] p-5 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-1 ${
                      isFree
                        ? 'border border-dashed border-[#483c23] bg-[#211911]/50 hover:bg-[#2c241b] hover:border-solid hover:border-[#eead2b]'
                        : 'border-l-4 border-l-teal-500 border-y border-r border-[#483c23] bg-[#2c241b] hover:border-teal-500'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span
                        className={`text-4xl font-black transition-colors ${
                          isFree ? 'text-[#483c23] group-hover:text-[#eead2b]' : 'text-white opacity-90'
                        }`}
                      >
                        {t.name.replace(/^T-?/i, '')}
                      </span>
                      <div
                        className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                          isFree
                            ? 'bg-[#2c241b] text-[#c9b792]'
                            : 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                        }`}
                      >
                        {isFree ? 'Free' : t.status === 'Payment' ? 'Payment' : order?.status ?? 'Occupied'}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#c9b792]">{assignedName ? assignedName : 'Unassigned'}</span>
                        <span className="text-xs font-bold text-[#c9b792]">{isOccupied ? `ETB ${displayTotal.toFixed(2)}` : ''}</span>
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

          {!rightOpen ? (
            <button
              onClick={() => setRightOpen(true)}
              className="hidden xl:flex absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-2xl bg-[#eead2b] text-[#221c11] shadow-lg shadow-[#eead2b]/20 items-center justify-center"
              title="Open drafts/activity"
            >
              <span className="material-symbols-outlined text-[22px]">dock_to_right</span>
            </button>
          ) : null}

          <aside className={`hidden xl:flex border-l border-[#483c23] bg-[#211911] flex-col transition-all ${rightOpen ? 'w-[440px]' : 'w-0 overflow-hidden border-l-0'}`}>
            <div className="px-5 py-4 border-b border-[#483c23] bg-[#2c2417] flex items-center justify-between">
              {rightOpen ? (
                <div className="flex flex-col">
                  <div className="text-sm font-black">Right Panel</div>
                  <div className="text-[11px] text-[#c9b792] font-semibold">Drafts + Activity</div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                {rightOpen ? (
                  <button
                    onClick={() => (sideTab === 'drafts' ? loadDrafts() : loadAudit())}
                    className="h-9 px-3 rounded-lg bg-[#483c23] hover:bg-[#5a4530] text-white font-bold text-xs"
                  >
                    Refresh
                  </button>
                ) : null}
                <button
                  onClick={() => setRightOpen(false)}
                  className="h-9 w-9 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] hover:text-white"
                  title="Collapse"
                >
                  <span className="material-symbols-outlined text-[18px]">close_fullscreen</span>
                </button>
              </div>
            </div>

            {!rightOpen ? null : (
              <>
                <div className="px-4 pt-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSideTab('drafts')}
                      className={`h-9 px-3 rounded-lg text-xs font-black border ${
                        sideTab === 'drafts'
                          ? 'bg-[#eead2b] text-[#221c11] border-[#eead2b]'
                          : 'bg-transparent text-[#c9b792] border-[#483c23] hover:text-white'
                      }`}
                    >
                      Draft Inbox
                    </button>
                    <button
                      onClick={() => setSideTab('activity')}
                      className={`h-9 px-3 rounded-lg text-xs font-black border ${
                        sideTab === 'activity'
                          ? 'bg-[#eead2b] text-[#221c11] border-[#eead2b]'
                          : 'bg-transparent text-[#c9b792] border-[#483c23] hover:text-white'
                      }`}
                    >
                      Activity
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {sideTab === 'drafts' ? (
                    <>
                      {draftErr ? (
                        <div className="mb-3 p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">{draftErr}</div>
                      ) : null}
                      {draftLoading ? (
                        <div className="text-sm text-[#c9b792]">Loading ¦</div>
                      ) : drafts.length === 0 ? (
                        <div className="text-sm text-[#c9b792]">No submitted drafts.</div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {drafts.slice(0, 12).map((d) => {
                            const staffName = d.created_by_staff_id ? (staffById.get(d.created_by_staff_id)?.name ?? d.created_by_staff_id) : ' ”';
                            const items = Array.isArray(d.items) ? d.items : [];
                            const top = items.slice(0, 3);
                            const more = Math.max(0, items.length - top.length);
                            return (
                              <div key={d.draft_id} className="rounded-xl border border-[#483c23] bg-[#1a1612] p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-black truncate">{d.draft_id}</div>
                                    <div className="text-xs text-[#c9b792] font-semibold truncate">By: {staffName}</div>
                                  </div>
                                  <div className="text-xs font-black text-[#eead2b]">ETB {Number(d.summary?.total ?? 0).toFixed(2)}</div>
                                </div>

                                {top.length > 0 ? (
                                  <div className="mt-3 flex flex-col gap-2">
                                    {top.map((it, idx) => (
                                      <div key={`${it.product_id || it.name || idx}`} className="flex items-center gap-3">
                                        <div
                                          className="w-10 h-10 rounded-lg bg-[#2c241b] border border-[#483c23] bg-cover bg-center flex-none"
                                          style={{ backgroundImage: `url('${it.image || ''}')` }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs text-white font-bold truncate">{it.name || it.product_id || 'Item'}</div>
                                          <div className="text-[11px] text-[#c9b792]">x{Number(it.qty ?? 0)}</div>
                                        </div>
                                        <div className="text-xs text-white font-black">ETB {(Number(it.unit_price ?? 0) * Number(it.qty ?? 0)).toFixed(2)}</div>
                                      </div>
                                    ))}
                                    {more > 0 ? <div className="text-[11px] text-[#c9b792] font-semibold">+{more} more ¦</div> : null}
                                  </div>
                                ) : null}

                                {d.notes ? <div className="mt-3 text-xs text-[#c9b792] whitespace-pre-wrap break-words">{d.notes}</div> : null}

                                <div className="mt-3 flex items-center justify-between">
                                  <div className="text-[11px] text-[#c9b792] font-semibold">Items: {Number(d.summary?.items ?? 0)}</div>
                                  <button
                                    onClick={() => onNavigate(Screen.DESKTOP_DRAFT_INBOX)}
                                    className="h-9 px-3 rounded-lg bg-[#eead2b] text-[#221c11] hover:bg-[#d49619] font-extrabold text-xs"
                                  >
                                    Open Inbox
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {auditErr ? (
                        <div className="mb-3 p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">{auditErr}</div>
                      ) : null}
                      {auditLoading ? (
                        <div className="text-sm text-[#c9b792]">Loading ¦</div>
                      ) : auditRows.length === 0 ? (
                        <div className="text-sm text-[#c9b792]">No activity yet.</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {auditRows.slice(0, 50).map((a, idx) => (
                            <div key={String(a.id || idx)} className="rounded-xl border border-[#483c23] bg-[#1a1612] p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs text-white font-black truncate">{a.actor_name || a.actor_staff_id || ' ”'}</div>
                                  <div className="text-[11px] text-[#c9b792] font-semibold truncate">{a.action || 'activity'}</div>
                                </div>
                                <div className="text-[11px] text-[#c9b792]">{String(a.at || '').slice(11, 19)}</div>
                              </div>
                              {a.message ? <div className="mt-2 text-xs text-[#c9b792] whitespace-pre-wrap break-words">{a.message}</div> : null}
                              {a.entity_type || a.entity_id ? (
                                <div className="mt-2 text-[11px] text-[#c9b792]">{a.entity_type || ''}{a.entity_id ? `: ${a.entity_id}` : ''}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      <div className="flex-none border-t border-[#2c241b] bg-[#211911]">
        <div className="px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs text-[#c9b792]">
          <div className="flex items-center gap-6">
            <div><span className="text-white font-bold">Free</span> {counts.free}</div>
            <div><span className="text-white font-bold">Occupied</span> {counts.occupied}</div>
            <div><span className="text-white font-bold">Action</span> {counts.action}</div>
            <div><span className="text-white font-bold">Capacity</span> {Math.round((counts.occupied / Math.max(1, counts.all)) * 100)}%</div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate(Screen.WAITER_SHIFT_REPORT)} className="h-10 px-4 rounded-lg bg-[#2c241b] border border-[#483c23] text-[#c9b792] hover:text-white hover:border-[#eead2b]/30 font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">assessment</span>
              Shift Report
            </button>
            <button onClick={() => onNavigate(Screen.WAITER_STATUS)} className="h-10 px-4 rounded-lg bg-white text-black font-extrabold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">soup_kitchen</span>
              Kitchen Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
