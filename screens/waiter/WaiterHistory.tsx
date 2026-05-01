import { AppIcon } from '@/components/ui/app-icon';
import { Sun, Moon, Calendar, ChevronDown, BarChart2, Clock, X, FileText, RefreshCw, Settings2, Download } from 'lucide-react';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { formatDeviceDateTime } from '../../datetime';

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
    } catch { return false; }
  }, []);

  const isWaiterManager = useMemo(() => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      return role === 'Waiter Manager' || role === 'Branch Manager' || role === 'Cafe Owner';
    } catch { return false; }
  }, []);

  const openOrder = (orderId: string) => {
    selectOrder(orderId);
    onNavigate(canRefundFromHere ? Screen.MANAGER_ORDER_DETAILS : Screen.DASHBOARD);
  };

  // ---------- Business Date Logic (7 AM Cutoff) ----------
  const getBusinessDateStr = (date: Date) => {
    const d = new Date(date);
    if (d.getHours() < 7) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const todayStr = useMemo(() => getBusinessDateStr(new Date()), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getBusinessDateStr(d);
  }, []);
  
  const [dateFilter, setDateFilter] = useState<'Today' | 'Yesterday' | 'Custom'>('Today');
  const [customDate, setCustomDate] = useState(todayStr);


  // ---------- Status & Query ----------
  const [statusFilter, setStatusFilter] = useState<'All' | 'Completed' | 'Open' | 'Voided'>('All');
  const [query, setQuery] = useState(() => getUiPref<string>('waiter.history.query', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowsRaw, setRowsRaw] = useState<any[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [page, setPage] = useState(() => {
    const n = Number(getUiPref<number>('waiter.history.page', 1));
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
  });
  const pageSize = 25;
  const [total, setTotal] = useState(0);

  // ---------- Export Modal ----------
  const [showExportModal, setShowExportModal] = useState(false);
  const [isHourly, setIsHourly] = useState(false);
  const [exportFromHour, setExportFromHour] = useState('07');
  const [exportToHour, setExportToHour] = useState('18');
  const [isExporting, setIsExporting] = useState(false);

  // ---------- Compute Date Params ----------
  const getDateRange = useCallback(() => {
    const day = dateFilter === 'Today' ? todayStr : dateFilter === 'Yesterday' ? yesterdayStr : customDate;
    return { from: day, to: day, day };
  }, [dateFilter, customDate, todayStr, yesterdayStr]);

  const statusParam = useMemo(() => {
    if (statusFilter === 'All') return '';
    if (statusFilter === 'Completed') return 'Paid';
    if (statusFilter === 'Voided') return 'Voided';
    return 'Open';
  }, [statusFilter]);

  useEffect(() => { setPage(1); }, [query, statusFilter, dateFilter, customDate]);
  useEffect(() => { setUiPref('waiter.history.query', query); }, [query, setUiPref]);

  // Track online/offline status
  useEffect(() => {
    const onOnline = () => setIsOfflineMode(false);
    const onOffline = () => setIsOfflineMode(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const isElectron = typeof window !== 'undefined' && Boolean((window as any)?.mirachpos?.pos);

  // Load offline orders from Electron SQLite and convert to history rows
  const loadOfflineOrders = useCallback(async (day: string): Promise<{ orders: any[]; total: number }> => {
    try {
      const pos = (window as any).mirachpos.pos;
      if (!pos?.listOrders) return { orders: [], total: 0 };

      // Determine scope key from session
      const s = readSession<any>();
      const tenantId = typeof s?.tenantId === 'string' ? s.tenantId : '';
      const role = typeof s?.role === 'string' ? s.role : '';
      const rawBranch = typeof s?.branchId === 'string' ? s.branchId : '';
      const normBranch = rawBranch && rawBranch !== 'global' ? rawBranch : (() => {
        try {
          // Prioritize based on role so each role picks the right persisted selection
          if (role === 'Cafe Owner') {
            return localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
              localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
              localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') || '';
          }
          if (role === 'Branch Manager') {
            return localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
              localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') || '';
          }
          return localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
        } catch { return ''; }
      })();

      if (!tenantId || !normBranch) return { orders: [], total: 0 };
      const scopeKey = `tenant:${tenantId}:branch:${normBranch}:pos_ui_v1`;


      const rawOrders: any[] = await pos.listOrders({ scopeKey, limit: 1000 });
      if (!Array.isArray(rawOrders)) return { orders: [], total: 0 };

      // Filter by business date (day string)
      const dayStart = new Date(`${day}T07:00:00`).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      let filtered = rawOrders.filter((o: any) => {
        const t = new Date(o.created_at || o.createdAt || 0).getTime();
        return t >= dayStart && t < dayEnd;
      });

      // Apply status filter
      if (statusParam) {
        filtered = filtered.filter((o: any) => {
          const st = String(o.status || '').toLowerCase();
          return st === statusParam.toLowerCase();
        });
      }

      // Apply text search
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        filtered = filtered.filter((o: any) =>
          String(o.table_name || '').toLowerCase().includes(q) ||
          String(o.display_number || '').toLowerCase().includes(q) ||
          String(o.id || '').toLowerCase().includes(q)
        );
      }

      // Convert SQLite snake_case rows to API-compatible camelCase objects
      const orders = filtered.map((o: any) => ({
        id: o.id,
        number: o.display_number || o.id?.slice(-6) || '',
        tableName: o.table_name || '',
        createdAt: o.created_at || '',
        paidAt: o.paid_at || null,
        createdByName: o.created_by_name || '',
        status: o.status || 'Pending',
        subtotal: Number(o.subtotal || 0),
        tax: Number(o.tax || 0),
        tip: Number(o.tip || 0),
        discount: Number(o.discount || 0),
        total: Number(o.total || 0),
        items: [],
        shiftType: '',
        _offline: true,
      }));

      // Paginate client-side
      const pageStart = (page - 1) * pageSize;
      const paged = orders.slice(pageStart, pageStart + pageSize);
      return { orders: paged, total: orders.length };
    } catch {
      return { orders: [], total: 0 };
    }
  }, [page, query, statusParam]);

  // Main Fetch
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { day } = getDateRange();
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;

        if (offline && isElectron) {
          const { orders, total: t } = await loadOfflineOrders(day);
          if (!mounted) return;
          setRowsRaw(orders);
          setTotal(t);
        } else {
          // ── Online path: call remote API ──
          const params = new URLSearchParams();
          if (query.trim()) params.set('q', query.trim());
          if (statusParam) params.set('status', statusParam);
          params.set('from', day);
          params.set('to', day);
          params.set('page', String(page));
          params.set('pageSize', String(pageSize));

          const res = await apiFetch(`/api/waiter/history?${params.toString()}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || 'Failed to fetch history');
          if (!mounted) return;
          setRowsRaw(Array.isArray(json?.orders) ? json.orders : []);
          setTotal(Number(json?.total) || 0);
        }
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Error');
        setRowsRaw([]); setTotal(0);
      } finally { if (mounted) setLoading(false); }
    };
    run();
    return () => { mounted = false; };
  }, [getDateRange, page, query, statusParam, isElectron, loadOfflineOrders]);

  const handleExport = async (hourlyOverride: boolean = false) => {
    setIsExporting(true);
    try {
      const { day } = getDateRange();
      const params = new URLSearchParams();
      params.set('from', day);
      if (hourlyOverride || isHourly) {
        params.set('fromHour', exportFromHour);
        params.set('toHour', exportToHour);
      }
      
      const url = `/api/waiter/history/export/xlsx?${params.toString()}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const hourPart = (hourlyOverride || isHourly) ? `_${exportFromHour}-${exportToHour}` : '';
      a.download = `Full_Report_${day}${hourPart}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      setShowExportModal(false);
    } catch (e) {
      alert('Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const rows = useMemo(() =>
    [...rowsRaw]
      .sort((a, b) => {
        const aTime = new Date(a?.paidAt || a?.createdAt || 0).getTime();
        const bTime = new Date(b?.paidAt || b?.createdAt || 0).getTime();
        return bTime - aTime; // Newest first
      })
      .map((o) => {
      const paidAt = typeof o?.paidAt === 'string' ? o.paidAt : '';
      const createdAt = typeof o?.createdAt === 'string' ? o.createdAt : '';
      const dt = formatDeviceDateTime(paidAt || createdAt, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return {
        id: String(o?.id || ''),
        number: String(o?.number || ''),
        table: String(o?.tableName || ''),
        time: dt,
        by: String(o?.createdByName || ''),
        itemsSummary: (Array.isArray(o?.items) ? o.items : []).map((i: any) => `${i?.name} (x${i?.qty})`).join(', '),
        total: Number(o?.total || 0),
        status: String(o?.status || ''),
        shiftType: String(o?.shiftType || ''),
      };
    }), [rowsRaw]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  
  const formatHour12 = (h: string) => {
    const hh = parseInt(h, 10);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    let displayH = hh % 12;
    if (displayH === 0) displayH = 12;
    return `${String(displayH).padStart(2, '0')}:00 ${ampm}`;
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Offline Banner */}
      {isOfflineMode && isElectron && (
        <div className="flex items-center gap-2 px-8 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-600">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest">Offline Mode — Showing local orders only</span>
        </div>
      )}
      {/* Header */}
      <div className="px-8 pt-6 pb-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-foreground">Order History</h2>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">
              7 AM Business Day Boundary
            </p>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {isWaiterManager && (
              <button onClick={() => setShowExportModal(true)}
                className="h-10 px-4 rounded-xl border border-primary/30 bg-primary/10 text-primary text-sm font-bold flex items-center gap-2 hover:bg-primary/20 transition-all">
                <FileText size={18} /> Export Excel
              </button>
            )}
            
            <div className="flex items-center bg-card rounded-xl border border-border p-1 gap-1">
              {(['Today', 'Yesterday', 'Custom'] as const).map(f => (
                <button key={f} onClick={() => setDateFilter(f)}
                  className={`h-8 px-4 rounded-lg text-sm font-bold transition-all ${dateFilter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {f}
                </button>
              ))}
              {dateFilter === 'Custom' && (
                <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                  className="h-8 px-2 bg-transparent text-xs font-bold border-none focus:ring-0" />
              )}
            </div>

            <div className="flex items-center bg-card rounded-xl border border-border p-1 gap-1">
              {(['All', 'Open', 'Completed', 'Voided'] as const).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="relative w-full md:w-72">
              <AppIcon name="search" className="absolute left-3 top-2.5 text-muted-foreground" size={18} />
              <input value={query} onChange={e => setQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border focus:ring-1 focus:ring-primary text-sm font-medium"
                placeholder="Search Table or #Order" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 px-8 pb-6 overflow-hidden">
        <div className="h-full bg-card rounded-2xl border border-border shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/30 backdrop-blur-md border-b border-border">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Order</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Shift</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Table</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Time</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Items</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest text-right">Total</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={8} className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-primary" size={32} /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-20 text-center text-muted-foreground font-medium">No records found.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} onClick={() => openOrder(r.id)} className="hover:bg-muted/30 transition-colors cursor-pointer group">
                    <td className="px-6 py-4 font-mono text-sm font-black text-primary">#{r.number}</td>
                    <td className="px-6 py-4">
                      {r.shiftType === 'DAY' ? (
                        <div className="flex items-center gap-1 text-amber-600 font-bold text-[10px]"><Sun size={10} /> Day</div>
                      ) : r.shiftType === 'NIGHT' ? (
                        <div className="flex items-center gap-1 text-indigo-500 font-bold text-[10px]"><Moon size={10} /> Night</div>
                      ) : <span className="text-muted-foreground text-[10px]">—</span>}
                    </td>
                    <td className="px-6 py-4 font-bold text-sm">{r.table || 'Walk-in'}</td>
                    <td className="px-6 py-4 text-muted-foreground text-xs font-medium">{r.time}</td>
                    <td className="px-6 py-4 text-xs text-foreground/80 max-w-xs truncate font-medium">{r.itemsSummary}</td>
                    <td className="px-6 py-4 text-right font-black text-sm">ETB {r.total.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${
                        r.status === 'Paid' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                        r.status === 'Voided' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        'bg-blue-500/10 text-blue-600 border-blue-500/20'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right"><ChevronDown size={18} className="-rotate-90 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="p-4 border-t border-border flex items-center justify-between bg-muted/5">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{total} Orders</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="h-9 px-4 rounded-xl border border-border bg-card text-xs font-bold disabled:opacity-30">Prev</button>
              <div className="px-4 py-1.5 rounded-xl bg-card border border-border text-[10px] font-black uppercase">
                {page} / {pageCount}
              </div>
              <button disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}
                className="h-9 px-4 rounded-xl border border-border bg-card text-xs font-bold disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card rounded-3xl border border-border shadow-2xl overflow-hidden anim-pop-in">
            <div className="px-8 pt-8 pb-6 bg-muted/10 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-black">Export Report</h3>
                <button onClick={() => setShowExportModal(false)} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><X size={20}/></button>
              </div>
              <p className="text-muted-foreground text-sm font-medium">Generate Excel sales report for the selected business day.</p>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border">
                <div className="flex-1">
                  <h4 className="text-sm font-black text-foreground">Hourly Filter</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">Filter sales by specific hours</p>
                </div>
                <button onClick={() => setIsHourly(!isHourly)}
                  className={`w-12 h-6 rounded-full transition-all relative ${isHourly ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isHourly ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              {isHourly && (
                <div className="grid grid-cols-2 gap-4 anim-fade-in">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-1">From Hour</label>
                    <select value={exportFromHour} onChange={e => setExportFromHour(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl bg-background border border-border font-bold text-sm focus:ring-1 focus:ring-primary focus:outline-none">
                      {hours.map(h => <option key={h} value={h}>{formatHour12(h)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest pl-1">To Hour</label>
                    <select value={exportToHour} onChange={e => setExportToHour(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl bg-background border border-border font-bold text-sm focus:ring-1 focus:ring-primary focus:outline-none">
                      {hours.map(h => <option key={h} value={h}>{formatHour12(h)}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2">
                <button onClick={() => handleExport(false)} disabled={isExporting}
                  className="w-full h-12 rounded-2xl border-2 border-primary/20 text-primary font-black text-xs tracking-widest uppercase hover:bg-primary/5 transition-all flex items-center justify-center gap-2">
                   Download Full Business Day
                </button>
                {isHourly && (
                  <button onClick={() => handleExport(true)} disabled={isExporting}
                    className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-black text-xs tracking-widest uppercase shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
                    <Download size={16} /> Download Hourly Range
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
