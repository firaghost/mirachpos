import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '@/api';
import { readSession } from '@/session';
import { Screen } from '@/types';
import { usePos } from '@/PosContext';

import { AppIcon } from '@/components/ui/app-icon';
import { TicketDetailDrawer } from '@/components/TicketDetailDrawer';

type TicketItem = {
  id: string;
  name: string;
  qty: number;
  voided_qty: number;
  notes?: string | null;
  prep_state: string;
};

type Ticket = {
  id: string;
  order_id: string;
  station: string;
  course_no: number;
  status: string;
  priority: number;
  created_at: string;
  fired_at?: string | null;
  ready_at?: string | null;
  bumped_at?: string | null;
  sla_due_at?: string | null;
  meta?: { tableName?: string | null; number?: string | null };
  items: TicketItem[];
};

type Props = {
  onNavigate: (screen: Screen) => void;
};

const BOARD_CACHE_KEY = 'mirachpos.kds2.board.v1';
const SETTINGS_KEY = 'mirachpos.kds2.settings.v1';

const safeParse = (raw: string | null) => {
  try {
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const generateActionId = () => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isTypingTarget = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = String(node.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return Boolean(node.isContentEditable);
};

const readSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const json = raw ? JSON.parse(raw) : null;
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
};

const slaState = (dueAtIso?: string | null) => {
  if (!dueAtIso) return 'none' as const;
  const dueMs = new Date(dueAtIso).getTime();
  if (!Number.isFinite(dueMs)) return 'none' as const;
  const remaining = dueMs - Date.now();
  if (remaining >= 3 * 60 * 1000) return 'green' as const;
  if (remaining >= 60 * 1000) return 'yellow' as const;
  return 'red' as const;
};

const minsSince = (iso: string | null | undefined, nowMs: number) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const d = nowMs - ms;
  if (!Number.isFinite(d) || d < 0) return null;
  return Math.max(0, Math.floor(d / 60000));
};

const slaRemainingMins = (dueAtIso: string | null | undefined, nowMs: number) => {
  if (!dueAtIso) return null;
  const dueMs = new Date(dueAtIso).getTime();
  if (!Number.isFinite(dueMs)) return null;
  return Math.round((dueMs - nowMs) / 60000);
};

const statusPill = (st: string) => {
  const s = String(st || '').trim().toUpperCase();
  if (s === 'READY') return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
  if (s === 'IN_PREP') return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
  if (s === 'FIRED') return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
  if (s === 'BUMPED') return 'bg-muted/40 text-muted-foreground border-border';
  if (s === 'RECALLED') return 'bg-violet-500/10 text-violet-700 border-violet-500/20';
  return 'bg-muted/30 text-muted-foreground border-border';
};

export const KitchenBoard: React.FC<Props> = ({ onNavigate }) => {
  const { selectOrder, printKitchenTicket } = usePos();
  const [board, setBoard] = useState<Ticket[]>(() => {
    const cached = safeParse(localStorage.getItem(BOARD_CACHE_KEY));
    return Array.isArray(cached?.board) ? (cached.board as Ticket[]) : [];
  });
  const [station, setStation] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string>('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string>('');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const initialSettings = useMemo(() => readSettings(), []);
  const [showFulfilled, setShowFulfilled] = useState<boolean>(() => Boolean(initialSettings?.showFulfilled));
  const [statusFilter, setStatusFilter] = useState<'active' | 'new' | 'fired' | 'in_prep' | 'ready'>(() => {
    const v = String(initialSettings?.statusFilter || 'active');
    if (v === 'new' || v === 'fired' || v === 'in_prep' || v === 'ready' || v === 'active') return v;
    return 'active';
  });
  const [gridSize, setGridSize] = useState<'dynamic' | 'small' | 'medium' | 'large'>(() => {
    const v = String(initialSettings?.gridSize || 'dynamic');
    if (v === 'small' || v === 'medium' || v === 'large' || v === 'dynamic') return v;
    return 'dynamic';
  });
  const [quickFilter, setQuickFilter] = useState<'none' | 'overdue' | 'all_day'>(() => {
    const v = String(initialSettings?.quickFilter || 'none');
    if (v === 'overdue' || v === 'all_day' || v === 'none') return v;
    return 'none';
  });
  const [expediterMode, setExpediterMode] = useState<boolean>(() => Boolean(initialSettings?.expediterMode));
  const [showShortcuts, setShowShortcuts] = useState<boolean>(() => {
    if (typeof initialSettings?.showShortcuts === 'boolean') return Boolean(initialSettings.showShortcuts);
    return true;
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<number | null>(null);

  const refreshBoard = useCallback(async () => {
    setErr('');
    const qs = new URLSearchParams();
    if (station.trim()) qs.set('station', station.trim());
    qs.set('limit', '400');

    const res = await apiFetch(`/api/pos/kds/board?${qs.toString()}`);
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setErr(typeof json?.error === 'string' ? json.error : 'Failed to load board');
      return;
    }

    const next = Array.isArray(json?.board) ? (json.board as Ticket[]) : [];
    setBoard(next);
    try {
      localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), board: next }));
    } catch {
    }
  }, [station]);

  const connect = useCallback(() => {
    const session = readSession<any>();
    if (!session?.token) return;

    const tenantSlug = session?.tenantSlug || session?.tenant?.slug || '';

    const url = new URL('/api/realtime/pos', window.location.origin);
    url.searchParams.set('token', session.token);
    if (tenantSlug) url.searchParams.set('tenant', String(tenantSlug));

    const es = new EventSource(url.toString());
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      void refreshBoard();
    };

    es.addEventListener('pos', (e) => {
      try {
        const evt = JSON.parse((e as MessageEvent).data);
        const type = String(evt?.type || '').trim();
        if (type === 'pos.kds.ticket') {
          void refreshBoard();
        }
      } catch {
      }
    });

    es.onerror = () => {
      setConnected(false);
      try {
        es.close();
      } catch {
      }
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      reconnectRef.current = window.setTimeout(() => connect(), 2500);
    };
  }, [refreshBoard]);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    connect();
    return () => {
      try {
        esRef.current?.close();
      } catch {
      }
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          showFulfilled,
          statusFilter,
          gridSize,
          quickFilter,
          expediterMode,
          showShortcuts,
        }),
      );
    } catch {
    }
  }, [expediterMode, gridSize, quickFilter, showFulfilled, showShortcuts, statusFilter]);

  const postAction = useCallback(async (path: string, body: any) => {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg = typeof json?.error === 'string' ? json.error : 'request_failed';
      throw new Error(msg);
    }
    return json;
  }, []);

  const onReady = useCallback(
    async (ticketId: string) => {
      const actionId = generateActionId();
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/ready`, { actionId });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const onBump = useCallback(
    async (ticketId: string) => {
      const actionId = generateActionId();
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/bump`, { actionId });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const onRecall = useCallback(
    async (ticketId: string) => {
      const actionId = generateActionId();
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/recall`, { actionId });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const onPrintKitchen = useCallback(
    async (orderId: string) => {
      const oid = String(orderId || '').trim();
      if (!oid) return;
      setErr('');
      setPrintingOrderId(oid);
      try {
        const res = await apiFetch(`/api/pos/print/kitchen/${encodeURIComponent(oid)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const errKey = typeof json?.error === 'string' ? json.error : 'print_failed';
          if (errKey === 'lan_only' || errKey === 'device_required' || errKey === 'device_not_found') {
            selectOrder(oid);
            await printKitchenTicket(oid, { mode: 'dialog' });
            return;
          }
          throw new Error(errKey);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'print_failed');
      } finally {
        setPrintingOrderId('');
      }
    },
    [printKitchenTicket, selectOrder],
  );

  const columns = useMemo(() => {
    const by = {
      NEW: [] as Ticket[],
      FIRED: [] as Ticket[],
      IN_PREP: [] as Ticket[],
      READY: [] as Ticket[],
      BUMPED: [] as Ticket[],
      RECALLED: [] as Ticket[],
    };

    for (const t of board) {
      const st = String(t?.status || '').trim();
      if (st in by) (by as any)[st].push(t);
      else by.NEW.push(t);
    }

    return by;
  }, [board]);

  const recallLastFulfilled = useCallback(async () => {
    const list = Array.isArray(columns.BUMPED) ? columns.BUMPED.slice() : [];
    if (!list.length) return;
    list.sort((a, b) => String(b.bumped_at || '').localeCompare(String(a.bumped_at || '')));
    const t = list[0];
    if (!t?.id) return;
    await onRecall(String(t.id));
    setSelected(t);
  }, [columns.BUMPED, onRecall]);

  const activeTickets = useMemo(() => {
    const all = [...columns.NEW, ...columns.FIRED, ...columns.IN_PREP, ...columns.READY];
    const effectiveStatusFilter = expediterMode ? 'ready' : statusFilter;
    const filtered =
      effectiveStatusFilter === 'new'
        ? columns.NEW
        : effectiveStatusFilter === 'fired'
          ? columns.FIRED
          : effectiveStatusFilter === 'in_prep'
            ? columns.IN_PREP
            : effectiveStatusFilter === 'ready'
              ? columns.READY
              : all;

    const filtered2 = filtered
      .filter((t) => {
        if (quickFilter === 'none') return true;
        if (quickFilter === 'overdue') {
          if (!t?.sla_due_at) return false;
          const dueMs = Date.parse(String(t.sla_due_at));
          return Number.isFinite(dueMs) ? nowTick > dueMs : false;
        }
        if (quickFilter === 'all_day') {
          const atIso = String(t?.fired_at || t?.created_at || '');
          const atMs = Date.parse(atIso);
          if (!Number.isFinite(atMs)) return false;
          return nowTick - atMs >= 60 * 60000;
        }
        return true;
      });

    return filtered2
      .slice()
      .sort((a, b) => {
        const aIso = String(a.fired_at || a.created_at || '');
        const bIso = String(b.fired_at || b.created_at || '');
        const aMs = Date.parse(aIso);
        const bMs = Date.parse(bIso);
        if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs - bMs;
        return aIso.localeCompare(bIso);
      });
  }, [columns.FIRED, columns.IN_PREP, columns.NEW, columns.READY, expediterMode, nowTick, quickFilter, statusFilter]);

  const quickCounts = useMemo(() => {
    const all = [...columns.NEW, ...columns.FIRED, ...columns.IN_PREP, ...columns.READY];
    let overdue = 0;
    let allDay = 0;
    for (const t of all) {
      const dueIso = t?.sla_due_at ? String(t.sla_due_at) : '';
      if (dueIso) {
        const dueMs = Date.parse(dueIso);
        if (Number.isFinite(dueMs) && nowTick > dueMs) overdue += 1;
      }

      const atIso = String(t?.fired_at || t?.created_at || '');
      const atMs = Date.parse(atIso);
      if (Number.isFinite(atMs) && nowTick - atMs >= 60 * 60000) allDay += 1;
    }
    return { overdue, allDay };
  }, [columns.FIRED, columns.IN_PREP, columns.NEW, columns.READY, nowTick]);

  useEffect(() => {
    if (quickFilter === 'none') return;
    if (quickFilter === 'overdue' && quickCounts.overdue === 0) setQuickFilter('none');
    if (quickFilter === 'all_day' && quickCounts.allDay === 0) setQuickFilter('none');
  }, [quickCounts.allDay, quickCounts.overdue, quickFilter]);

  const gridMinWidth = (() => {
    if (gridSize === 'small') return 220;
    if (gridSize === 'medium') return 280;
    if (gridSize === 'large') return 360;
    return 260;
  })();

  const pillCounts = useMemo(() => {
    return {
      active: columns.NEW.length + columns.FIRED.length + columns.IN_PREP.length + columns.READY.length,
      new: columns.NEW.length,
      fired: columns.FIRED.length,
      in_prep: columns.IN_PREP.length,
      ready: columns.READY.length,
    };
  }, [columns.FIRED.length, columns.IN_PREP.length, columns.NEW.length, columns.READY.length]);

  useEffect(() => {
    if (statusFilter === 'active') return;
    const count = (pillCounts as any)[statusFilter] as number;
    if (Number(count) > 0) return;
    setStatusFilter('active');
  }, [pillCounts, statusFilter]);

  useEffect(() => {
    if (!expediterMode) return;
    if (statusFilter !== 'ready') setStatusFilter('ready');
    if (quickFilter === 'all_day') return;
  }, [expediterMode, quickFilter, statusFilter]);

  const selectedIndex = useMemo(() => {
    if (!selected?.id) return -1;
    return activeTickets.findIndex((t) => String(t.id) === String(selected.id));
  }, [activeTickets, selected?.id]);

  const selectByIndex = useCallback(
    (idx: number) => {
      if (!activeTickets.length) return;
      const i = Math.max(0, Math.min(activeTickets.length - 1, idx));
      const t = activeTickets[i];
      if (!t) return;
      setSelected(t);
    },
    [activeTickets],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') {
        if (selected) {
          setSelected(null);
          e.preventDefault();
        }
        return;
      }

      const key = String(e.key || '').toLowerCase();
      const t = selected;
      if (key === 'p' && t?.order_id) {
        void onPrintKitchen(String(t.order_id));
        e.preventDefault();
        return;
      }

      if (key === 'r' && t?.id) {
        void onReady(String(t.id));
        e.preventDefault();
        return;
      }

      if (key === 'b' && t?.id) {
        void onBump(String(t.id));
        e.preventDefault();
        return;
      }

      if (key === 'l') {
        void recallLastFulfilled();
        e.preventDefault();
        return;
      }

      if (key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        if (activeTickets.length) selectByIndex((selectedIndex >= 0 ? selectedIndex : -1) + 1);
        e.preventDefault();
        return;
      }

      if (key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (activeTickets.length) selectByIndex((selectedIndex >= 0 ? selectedIndex : 0) - 1);
        e.preventDefault();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTickets.length, onBump, onPrintKitchen, onReady, recallLastFulfilled, selectByIndex, selected, selectedIndex]);

  const renderTicketCard = (t: Ticket) => {
    const sla = slaState(t.sla_due_at);
    const slaBar =
      sla === 'green'
        ? 'bg-emerald-500'
        : sla === 'yellow'
          ? 'bg-amber-500'
          : sla === 'red'
            ? 'bg-red-500'
            : 'bg-muted-foreground/20';

    const table = t.meta?.tableName ? String(t.meta.tableName) : 'Table';
    const num = t.meta?.number ? String(t.meta.number) : '';
    const ageMin = minsSince(t.fired_at || t.created_at, nowTick);
    const rem = slaRemainingMins(t.sla_due_at, nowTick);
    const slaText =
      rem == null
        ? '-'
        : rem >= 0
          ? `Due in ${rem}m`
          : `Overdue ${Math.abs(rem)}m`;
    const itemsCount = Array.isArray(t.items) ? t.items.length : 0;

    return (
      <div key={t.id} className="group relative rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow overflow-hidden">
        <div className={`h-1 w-full ${slaBar}`} />
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelected(t)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSelected(t);
            }
          }}
          className="w-full text-left p-4 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-lg font-black text-foreground truncate">{table}{num ? ` ${num}` : ''}</div>
                <span className={`h-6 px-2 rounded-full border text-[10px] font-black uppercase tracking-widest ${statusPill(t.status)}`}>{String(t.status || '').replace(/_/g, ' ')}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-semibold uppercase tracking-widest truncate">
                {String(t.station || 'kitchen')} / C{t.course_no ?? '-'}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Items</div>
              <div className="text-sm font-black text-foreground">{itemsCount}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="text-xs font-semibold text-muted-foreground">
                {ageMin != null ? `${ageMin}m` : '-'}
              </div>
              <div className={`text-[11px] font-bold ${rem != null && rem < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {slaText}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onPrintKitchen(t.order_id);
                }}
                disabled={printingOrderId === String(t.order_id)}
                className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-secondary/40 disabled:opacity-50"
                title="Print to kitchen printer"
              >
                {printingOrderId === String(t.order_id) ? 'Printing' : 'Print'}
              </button>
              <div className="hidden md:flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {String(t.status || '').toUpperCase() !== 'READY' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onReady(t.id);
                    }}
                    className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest"
                  >
                    Ready
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onBump(t.id);
                    }}
                    className="h-8 px-3 rounded-lg bg-secondary border border-border text-xs font-black uppercase tracking-widest"
                  >
                    Bump
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {t.items.slice(0, 3).map((it) => {
              const eff = Math.max(0, Number(it.qty || 0) - Number(it.voided_qty || 0));
              return (
                <div key={it.id} className="text-sm font-semibold text-foreground/90 flex items-center justify-between gap-3">
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 font-black">{eff}</span>
                </div>
              );
            })}
            {t.items.length > 3 ? <div className="text-xs text-muted-foreground font-semibold">+{t.items.length - 3} more</div> : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <AppIcon name="soup_kitchen" className="text-primary" />
              </div>
              <div className="flex flex-col">
                <div className="text-xl font-black tracking-tight">Kitchen Display</div>
                <div className="text-xs text-muted-foreground font-semibold">KDS 2.0</div>
              </div>
              <span className={`ml-2 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${connected ? 'border-emerald-500/20 text-emerald-700 bg-emerald-500/10' : 'border-amber-500/20 text-amber-700 bg-amber-500/10'}`}>
                {connected ? 'Live' : 'Reconnecting'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={station}
                onChange={(e) => setStation(e.target.value)}
                placeholder="Station (optional)"
                className="h-10 w-full md:w-64 px-3 rounded-xl bg-background border border-border text-sm font-semibold"
              />
              <button
                onClick={() => void refreshBoard()}
                className="h-10 px-4 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground font-black uppercase tracking-widest"
                title="Refresh"
              >
                Refresh
              </button>
            </div>
          </div>

          {err ? <div className="text-xs font-semibold text-destructive">{err}</div> : null}
        </div>
      </header>

      <div className="flex-1 overflow-hidden bg-muted/20 relative">
        <div className="h-full">
          <main className="h-full overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-widest ${
                    statusFilter === 'active' ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  Active
                  <span className="ml-2">{pillCounts.active}</span>
                </button>

                {pillCounts.new > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('new')}
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-widest ${
                      statusFilter === 'new' ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    New
                    <span className="ml-2">{pillCounts.new}</span>
                  </button>
                ) : null}

                {pillCounts.fired > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('fired')}
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-widest ${
                      statusFilter === 'fired' ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    Fired
                    <span className="ml-2">{pillCounts.fired}</span>
                  </button>
                ) : null}

                {pillCounts.in_prep > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('in_prep')}
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-widest ${
                      statusFilter === 'in_prep' ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    In Prep
                    <span className="ml-2">{pillCounts.in_prep}</span>
                  </button>
                ) : null}

                {pillCounts.ready > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ready')}
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-widest ${
                      statusFilter === 'ready' ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    Ready
                    <span className="ml-2">{pillCounts.ready}</span>
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-1">
                  {(['dynamic', 'small', 'medium', 'large'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setGridSize(s)}
                      className={`h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${
                        gridSize === s ? 'bg-secondary text-foreground border-border' : 'bg-background text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {s === 'dynamic' ? 'Dyn' : s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setExpediterMode((v) => !v)}
                  className={`h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${
                    expediterMode
                      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground'
                  }`}
                  title="Expediter mode (focus Ready)"
                >
                  Expo
                </button>

                {quickCounts.overdue > 0 ? (
                  <button
                    type="button"
                    onClick={() => setQuickFilter((v) => (v === 'overdue' ? 'none' : 'overdue'))}
                    className={`h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${
                      quickFilter === 'overdue'
                        ? 'bg-red-500/10 text-red-700 border-red-500/20'
                        : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                    title="Show overdue tickets"
                  >
                    Overdue
                    <span className="ml-2 text-foreground">{quickCounts.overdue}</span>
                  </button>
                ) : null}

                {quickCounts.allDay > 0 ? (
                  <button
                    type="button"
                    onClick={() => setQuickFilter((v) => (v === 'all_day' ? 'none' : 'all_day'))}
                    className={`h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${
                      quickFilter === 'all_day'
                        ? 'bg-amber-500/10 text-amber-700 border-amber-500/20'
                        : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                    title="Show tickets older than 60 minutes"
                  >
                    All Day
                    <span className="ml-2 text-foreground">{quickCounts.allDay}</span>
                  </button>
                ) : null}

                {columns.BUMPED.length ? (
                  <button
                    type="button"
                    onClick={() => setShowFulfilled((v) => !v)}
                    className="h-9 px-3 rounded-lg border border-border bg-background text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  >
                    {showFulfilled ? 'Hide' : 'Show'} fulfilled
                    <span className="ml-2 text-foreground">{columns.BUMPED.length}</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mb-4 rounded-2xl border border-border bg-background/70 backdrop-blur px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Shortcuts</div>
                  {showShortcuts ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">J/K</span> Navigate
                      </span>
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">R</span> Ready
                      </span>
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">B</span> Bump
                      </span>
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">P</span> Print
                      </span>
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">L</span> Recall last
                      </span>
                      <span className="px-2 py-1 rounded-lg border border-border bg-background">
                        <span className="font-black text-foreground">Esc</span> Close
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold text-muted-foreground">Hidden</div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowShortcuts((v) => !v)}
                  className="h-9 px-3 rounded-lg border border-border bg-background text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  title="Toggle shortcuts"
                >
                  {showShortcuts ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMinWidth}px, 1fr))` }}>
              {activeTickets.map(renderTicketCard)}
            </div>

            {showFulfilled && columns.BUMPED.length ? (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Recently Fulfilled</div>
                  <div className="text-[11px] font-black text-muted-foreground">{columns.BUMPED.length}</div>
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMinWidth}px, 1fr))` }}>
                  {columns.BUMPED.map(renderTicketCard)}
                </div>
              </div>
            ) : null}
          </main>

          <div
            className={`hidden lg:block absolute top-0 bottom-0 right-0 w-[520px] bg-card border-l border-border shadow-2xl transition-transform duration-200 ${
              selected ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <TicketDetailDrawer
              variant="inline"
              open={Boolean(selected)}
              ticket={selected}
              onClose={() => setSelected(null)}
              onReady={(id) => void onReady(id)}
              onBump={(id) => void onBump(id)}
              onRecall={(id) => void onRecall(id)}
              onPrintKitchen={(orderId) => void onPrintKitchen(orderId)}
              printing={Boolean(printingOrderId)}
            />
          </div>
        </div>

        {selected ? (
          <div className="lg:hidden absolute inset-0 z-[120] bg-background">
            <TicketDetailDrawer
              variant="inline"
              open={true}
              ticket={selected}
              onClose={() => setSelected(null)}
              onReady={(id) => void onReady(id)}
              onBump={(id) => void onBump(id)}
              onRecall={(id) => void onRecall(id)}
              onPrintKitchen={(orderId) => void onPrintKitchen(orderId)}
              printing={Boolean(printingOrderId)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};
