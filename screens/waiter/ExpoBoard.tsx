import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '@/api';
import { readSession } from '@/session';
import { Screen } from '@/types';

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

const generateActionId = () => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const ExpoBoard: React.FC<Props> = ({ onNavigate }) => {
  const [board, setBoard] = useState<Ticket[]>([]);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<number | null>(null);

  const refreshBoard = useCallback(async () => {
    setErr('');
    const res = await apiFetch('/api/pos/kds/board?limit=400');
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setErr(typeof json?.error === 'string' ? json.error : 'Failed to load board');
      return;
    }
    const next = Array.isArray(json?.board) ? (json.board as Ticket[]) : [];
    setBoard(next);
  }, []);

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
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/ready`, { actionId: generateActionId() });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const onBump = useCallback(
    async (ticketId: string) => {
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/bump`, { actionId: generateActionId() });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const onRecall = useCallback(
    async (ticketId: string) => {
      await postAction(`/api/pos/kds/tickets/${encodeURIComponent(ticketId)}/recall`, { actionId: generateActionId() });
      await refreshBoard();
    },
    [postAction, refreshBoard],
  );

  const byOrder = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of board) {
      const oid = String(t?.order_id || '').trim();
      if (!oid) continue;
      const list = map.get(oid) || [];
      list.push(t);
      map.set(oid, list);
    }

    return Array.from(map.entries()).map(([orderId, tickets]) => {
      const sorted = tickets.slice().sort((a, b) => String(a.station || '').localeCompare(String(b.station || '')));
      const allReady = sorted.length > 0 && sorted.every((x) => String(x.status) === 'READY' || String(x.status) === 'BUMPED');
      const anyDelayed = sorted.some((x) => {
        if (!x.sla_due_at) return false;
        return new Date(x.sla_due_at).getTime() < Date.now();
      });
      const meta0 = sorted[0]?.meta || {};
      return { orderId, tickets: sorted, allReady, anyDelayed, meta: meta0 };
    });
  }, [board]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-4 flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div>
          <div className="flex items-center gap-3">
            <AppIcon name="restaurant" className="text-primary" />
            <h2 className="text-2xl font-black tracking-tight">Expo Board</h2>
            <span className={`text-xs font-black uppercase tracking-widest px-2 py-1 rounded border ${connected ? 'border-emerald-500/20 text-emerald-600 bg-emerald-500/10' : 'border-amber-500/20 text-amber-600 bg-amber-500/10'}`}>
              {connected ? 'Live' : 'Reconnecting'}
            </span>
          </div>
          {err ? <div className="mt-2 text-xs font-semibold text-destructive">{err}</div> : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate(Screen.WAITER_KITCHEN)}
            className="h-10 px-4 rounded-xl bg-secondary border border-border text-foreground font-black uppercase tracking-widest hover:bg-secondary/80"
          >
            Kitchen
          </button>
          <button
            onClick={() => void refreshBoard()}
            className="h-10 px-4 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground font-black uppercase tracking-widest"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-5">
          {byOrder.map((o) => {
            const table = o.meta?.tableName ? String(o.meta.tableName) : 'Table';
            const num = o.meta?.number ? String(o.meta.number) : '';
            const badgeClass = o.allReady
              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
              : o.anyDelayed
                ? 'bg-red-500/10 text-red-600 border-red-500/20'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/20';

            return (
              <section key={o.orderId} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <div className="text-lg font-black">{table} {num}</div>
                    <div className="mt-1 text-xs font-semibold text-muted-foreground">Order: {o.orderId}</div>
                  </div>
                  <div className={`px-3 py-1 rounded-full border text-xs font-black uppercase tracking-widest ${badgeClass}`}>
                    {o.allReady ? 'All Ready' : o.anyDelayed ? 'Delayed' : 'In Progress'}
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {o.tickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className="text-left rounded-xl border border-border bg-background hover:bg-secondary/40 transition-colors p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-black uppercase tracking-widest text-muted-foreground">{t.station}</div>
                        <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t.status}</div>
                      </div>
                      <div className="mt-3 text-sm font-semibold text-foreground/90">
                        {t.items.slice(0, 3).map((it) => (
                          <div key={it.id} className="flex justify-between gap-3">
                            <span className="truncate">{it.name}</span>
                            <span className="font-black">{Math.max(0, Number(it.qty || 0) - Number(it.voided_qty || 0))}</span>
                          </div>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      <TicketDetailDrawer
        open={Boolean(selected)}
        ticket={selected}
        onClose={() => setSelected(null)}
        onReady={(id) => void onReady(id)}
        onBump={(id) => void onBump(id)}
        onRecall={(id) => void onRecall(id)}
      />
    </div>
  );
};
