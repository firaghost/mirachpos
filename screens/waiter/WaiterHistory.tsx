
import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterHistory: React.FC<Props> = ({ onNavigate }) => {
  const { selectOrder } = usePos();
  const todayLabel = useMemo(() => new Date().toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }), []);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Completed' | 'Open' | 'Voided'>('All');
  const [query, setQuery] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowsRaw, setRowsRaw] = useState<any[]>([]);
  const [page, setPage] = useState(1);
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
  }, [query, statusFilter]);

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
  }, [page, pageSize, query, statusParam]);

  const rows = useMemo(() => {
    const base = rowsRaw
      .map((o) => {
        const items = Array.isArray(o?.items) ? o.items : [];
        const number = typeof o?.number === 'string' ? o.number : '';
        const tableName = typeof o?.tableName === 'string' ? o.tableName : '';
        const timeLabel = typeof o?.timeLabel === 'string' ? o.timeLabel : '';
        const createdByName = typeof o?.createdByName === 'string' ? o.createdByName : '';
        const createdByStaffId = typeof o?.createdByStaffId === 'string' ? o.createdByStaffId : '';
        const totalAmount = typeof o?.total === 'number' ? o.total : Number(o?.total) || 0;
        const status = typeof o?.status === 'string' ? o.status : '';
        return {
          id: String(o?.id || ''),
          number,
          table: tableName,
          time: timeLabel,
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
    <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
      <div className="px-8 py-6 pb-2">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-white mb-1">Order History</h2>
            <p className="text-[#c9b792]">View and manage past transactions</p>
          </div>
          <div className="flex items-center bg-[#2c241b] rounded-lg border border-[#483c23] h-10 px-3 cursor-pointer hover:border-[#eead2b]/50 transition-colors">
            <span className="material-symbols-outlined text-[#c9b792] text-[20px] mr-2">calendar_today</span>
            <span className="text-sm text-white font-medium">Today: {todayLabel}</span>
          </div>
        </div>
        <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 xl:pb-0 scrollbar-hide max-w-full">
            <button onClick={() => setStatusFilter('All')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'All' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#2c241b] text-[#c9b792] border border-transparent hover:border-[#483c23] hover:text-white font-medium transition-all'}`}>All Orders</button>
            <button onClick={() => setStatusFilter('Open')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Open' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#2c241b] text-[#c9b792] border border-transparent hover:border-[#483c23] hover:text-white font-medium transition-all'}`}>Open</button>
            <button onClick={() => setStatusFilter('Completed')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Completed' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#2c241b] text-[#c9b792] border border-transparent hover:border-[#483c23] hover:text-white font-medium transition-all'}`}>Completed</button>
            <button onClick={() => setStatusFilter('Voided')} className={`px-4 py-1.5 rounded-lg text-sm shadow-sm ${statusFilter === 'Voided' ? 'bg-red-500 text-white font-bold' : 'bg-[#2c241b] text-[#c9b792] border border-transparent hover:border-red-500/30 hover:text-white font-medium transition-all'}`}>Voided</button>
          </div>
          <div className="relative w-full xl:w-96">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#c9b792] text-[20px]">search</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="block w-full pl-10 pr-3 py-2 border-none rounded-lg bg-[#2c241b] text-white placeholder-[#c9b792] focus:outline-none focus:ring-1 focus:ring-[#eead2b] sm:text-sm" placeholder="Search by Order ID or Table #" type="text"/>
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 py-4 overflow-hidden flex flex-col">
        <div className="flex-1 bg-[#2c241b] rounded-xl border border-[#483c23] flex flex-col overflow-hidden shadow-xl">
          {error ? (
            <div className="px-6 py-4 text-sm text-red-300 flex items-center justify-between gap-4 border-b border-[#483c23]">
              <div>Failed to load history: {error}</div>
              <button
                onClick={() => setPage((p) => p)}
                className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#221c11] font-bold"
              >
                Retry
              </button>
            </div>
          ) : null}
          <div className="overflow-x-auto flex-1">
            <table className="min-w-full text-left whitespace-nowrap">
              <thead className="bg-[#3a2e22]/50 text-[#c9b792] text-xs uppercase font-semibold tracking-wider sticky top-0 z-10 backdrop-blur-sm">
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
              <tbody className="divide-y divide-[#483c23] text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-[#c9b792]">
                      Loading ¦
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#3a2e22]/40 transition-colors cursor-pointer">
                    <td className="px-6 py-4 font-mono text-[#eead2b]">{r.number}</td>
                    <td className="px-6 py-4 text-white">{r.table}</td>
                    <td className="px-6 py-4 text-[#c9b792]">{r.time}</td>
                    <td className="px-6 py-4 text-[#c9b792]">{r.by || ' ”'}</td>
                    <td className="px-6 py-4 text-white truncate max-w-xs">{r.itemsSummary}</td>
                    <td className="px-6 py-4 text-right font-mono text-white font-medium">ETB {r.total.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        r.status === 'Paid' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                        r.status === 'Voided' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        r.status === 'Cooking' ? 'bg-[#eead2b]/10 text-[#eead2b] border-[#eead2b]/20' :
                        'bg-white/10 text-white border-white/10'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectOrder(r.id);
                          onNavigate(Screen.WAITER_RECEIPT);
                        }}
                        className="text-[#c9b792] hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">visibility</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-[#483c23] flex items-center justify-between gap-4">
            <div className="text-xs text-[#c9b792]">Total: {total}</div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-9 px-3 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] disabled:opacity-50"
              >
                Prev
              </button>
              <div className="text-xs text-[#c9b792]">Page {page} / {pageCount}</div>
              <button
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="h-9 px-3 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] disabled:opacity-50"
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
