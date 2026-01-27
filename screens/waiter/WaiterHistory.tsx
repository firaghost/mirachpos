import { AppIcon } from '@/components/ui/app-icon';

import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterHistory: React.FC<Props> = ({ onNavigate }) => {
  const { selectOrder, getUiPref, setUiPref } = usePos();
  const canRefundFromHere = useMemo(() => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      return role === 'Branch Manager' || role === 'Cafe Owner';
    } catch {
      return false;
    }
  }, []);

  const openOrder = (orderId: string) => {
    selectOrder(orderId);
    onNavigate(canRefundFromHere ? Screen.MANAGER_ORDER_DETAILS : Screen.WAITER_RECEIPT);
  };
  const todayLabel = useMemo(() => formatDeviceDate(new Date(), { month: 'short', day: '2-digit', year: 'numeric' }), []);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Completed' | 'Open' | 'Voided'>(() =>
    getUiPref<'All' | 'Completed' | 'Open' | 'Voided'>('waiter.history.statusFilter', 'All'),
  );
  const [dateFilter, setDateFilter] = useState<'Today' | 'AllTime'>(() =>
    getUiPref<'Today' | 'AllTime'>('waiter.history.dateFilter', 'Today'),
  );
  const [query, setQuery] = useState(() => getUiPref<string>('waiter.history.query', ''));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowsRaw, setRowsRaw] = useState<any[]>([]);
  const [page, setPage] = useState(() => {
    const n = Number(getUiPref<number>('waiter.history.page', 1));
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
  });
  const pageSize = 25;
  const [total, setTotal] = useState(0);

  const statusParam = useMemo(() => {
    if (statusFilter === 'All') return '';
    if (statusFilter === 'Completed') return 'Paid';
    if (statusFilter === 'Voided') return 'Voided';
    return 'Open';
  }, [statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, dateFilter]);

  useEffect(() => {
    setUiPref('waiter.history.statusFilter', statusFilter);
  }, [statusFilter, setUiPref]);

  useEffect(() => {
    setUiPref('waiter.history.dateFilter', dateFilter);
  }, [dateFilter, setUiPref]);

  useEffect(() => {
    setUiPref('waiter.history.query', query);
  }, [query, setUiPref]);

  useEffect(() => {
    setUiPref('waiter.history.page', page);
  }, [page, setUiPref]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (statusParam) params.set('status', statusParam);
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));

        if (dateFilter === 'Today') {
          const now = new Date();
          const yyyy = String(now.getFullYear());
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const isoDay = `${yyyy}-${mm}-${dd}`;
          params.set('from', isoDay);
          params.set('to', isoDay);
        }

        const res = await apiFetch(`/api/waiter/history?${params.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || String(res.status));
        if (!mounted) return;
        setRowsRaw(Array.isArray(json?.orders) ? json.orders : []);
        setTotal(Number(json?.total) || 0);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Failed to load history');
        setRowsRaw([]);
        setTotal(0);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [dateFilter, page, pageSize, query, statusParam]);

  const rows = useMemo(() => {
    const base = rowsRaw
      .map((o) => {
        const items = Array.isArray(o?.items) ? o.items : [];
        const number = typeof o?.number === 'string' ? o.number : '';
        const tableName = typeof o?.tableName === 'string' ? o.tableName : '';
        const timeLabel = typeof o?.timeLabel === 'string' ? o.timeLabel : '';
        const paidAt = typeof o?.paidAt === 'string' ? o.paidAt : '';
        const createdAt = typeof o?.createdAt === 'string' ? o.createdAt : '';
        const createdByName = typeof o?.createdByName === 'string' ? o.createdByName : '';
        const createdByStaffId = typeof o?.createdByStaffId === 'string' ? o.createdByStaffId : '';
        const totalAmount = typeof o?.total === 'number' ? o.total : Number(o?.total) || 0;
        const status = typeof o?.status === 'string' ? o.status : '';

        const bestTime = paidAt || createdAt;
        const dt = bestTime
          ? formatDeviceDateTime(bestTime, {
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

        const time = dt || timeLabel;
        return {
          id: String(o?.id || ''),
          number,
          table: tableName,
          time,
          by: createdByName || createdByStaffId,
          itemsSummary: items.map((i: any) => `${String(i?.name || '')} (x${Number(i?.qty) || 0})`).join(', '),
          total: totalAmount,
          status,
        };
      })
      .filter((r) => r.id);
    return base;
  }, [rowsRaw, statusParam]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <div className="px-8 py-6 pb-2">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-foreground mb-1">Order History</h2>
            <p className="text-muted-foreground">View and manage past transactions</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDateFilter('Today')}
              className={`h-10 px-3 rounded-lg border text-sm font-bold transition-colors ${
                dateFilter === 'Today'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter('AllTime')}
              className={`h-10 px-3 rounded-lg border text-sm font-bold transition-colors ${
                dateFilter === 'AllTime'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
              }`}
            >
              All Time
            </button>
            <div className="hidden md:flex items-center bg-card rounded-lg border border-border h-10 px-3">
              <AppIcon name="calendar_today" className="text-muted-foreground text-[20px] mr-2" size={20} />
              <span className="text-sm text-foreground font-medium">{todayLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 xl:pb-0 scrollbar-hide max-w-full">
            <button onClick={() => setStatusFilter('All')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'All' ? 'bg-primary text-primary-foreground font-bold' : 'bg-card text-muted-foreground border border-transparent hover:border-border hover:text-foreground font-medium transition-all'}`}>All Orders</button>
            <button onClick={() => setStatusFilter('Open')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Open' ? 'bg-primary text-primary-foreground font-bold' : 'bg-card text-muted-foreground border border-transparent hover:border-border hover:text-foreground font-medium transition-all'}`}>Open</button>
            <button onClick={() => setStatusFilter('Completed')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Completed' ? 'bg-primary text-primary-foreground font-bold' : 'bg-card text-muted-foreground border border-transparent hover:border-border hover:text-foreground font-medium transition-all'}`}>Completed</button>
            <button onClick={() => setStatusFilter('Voided')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Voided' ? 'bg-destructive text-destructive-foreground font-bold' : 'bg-card text-muted-foreground border border-transparent hover:border-destructive/30 hover:text-foreground font-medium transition-all'}`}>Voided</button>
          </div>
          <div className="relative w-full xl:w-96">
            <AppIcon name="search" className="absolute left-3 top-2.5 text-muted-foreground text-[20px]" size={20} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="block w-full pl-10 pr-3 py-2 border-none rounded-lg bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm" placeholder="Search by Order ID or Table #" type="text"/>
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 py-4 overflow-hidden flex flex-col">
        <div className="flex-1 bg-card rounded-xl border border-border flex flex-col overflow-hidden shadow-xl">
          {error ? (
            <div className="px-6 py-4 text-sm text-destructive flex items-center justify-between gap-4 border-b border-border">
              <div>Failed to load history: {error}</div>
              <button
                onClick={() => setPage((p) => p)}
                className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold"
              >
                Retry
              </button>
            </div>
          ) : null}
          <div className="overflow-x-auto flex-1">
            <table className="min-w-full text-left whitespace-nowrap">
              <thead className="bg-secondary/50 text-muted-foreground text-xs uppercase font-semibold tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                <tr>
                  <th className="px-6 py-4">Order ID</th>
                  <th className="px-6 py-4">Table</th>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4">By</th>
                  <th className="px-6 py-4 w-1/3">Items Summary</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-muted-foreground">
                      Loading 
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-secondary/40 transition-colors cursor-pointer"
                    onClick={() => openOrder(r.id)}
                  >
                    <td className="px-6 py-4 font-mono text-primary">{r.number}</td>
                    <td className="px-6 py-4 text-foreground">{r.table}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.time}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.by || ' ”'}</td>
                    <td className="px-6 py-4 text-foreground truncate max-w-xs">{r.itemsSummary}</td>
                    <td className="px-6 py-4 text-right font-mono text-foreground font-medium">ETB {r.total.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        r.status === 'Paid' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                        r.status === 'Voided' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        r.status === 'Cooking' ? 'bg-primary/10 text-primary border-primary/20' :
                        'bg-muted/40 text-foreground border-border'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrder(r.id);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/40 transition-colors"
                      >
                        <AppIcon name="visibility" className="text-[20px]" size={20} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">Total: {total}</div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-9 px-3 rounded-lg bg-background border border-border text-muted-foreground disabled:opacity-50"
              >
                Prev
              </button>
              <div className="text-xs text-muted-foreground">Page {page} / {pageCount}</div>
              <button
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="h-9 px-3 rounded-lg bg-background border border-border text-muted-foreground disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
