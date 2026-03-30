import { AppIcon } from '@/components/ui/app-icon';
import { Sun, Moon, Calendar, ChevronDown } from 'lucide-react';

import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';
import { openPrintWindow } from '../../printUtils';

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

  const isWaiterManager = useMemo(() => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      return role === 'Waiter Manager';
    } catch {
      return false;
    }
  }, []);

  const openOrder = (orderId: string) => {
    selectOrder(orderId);
    onNavigate(canRefundFromHere ? Screen.MANAGER_ORDER_DETAILS : Screen.WAITER_RECEIPT);
  };
  const todayLabel = useMemo(() => formatDeviceDate(new Date(), { month: 'short', day: '2-digit', year: 'numeric' }), []);
  
  // Date range filter - now supports custom date ranges
  const [dateFilter, setDateFilter] = useState<'Today' | 'Yesterday' | 'Last7Days' | 'Last30Days' | 'Custom'>('Today');
  const [customDateFrom, setCustomDateFrom] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [customDateTo, setCustomDateTo] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Shift filter - DAY, NIGHT, or ALL
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');
  
  // Status filter
  const [statusFilter, setStatusFilter] = useState<'All' | 'Completed' | 'Open' | 'Voided'>('All');
  
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
  }, [query, statusFilter, dateFilter, shiftFilter, customDateFrom, customDateTo]);

  useEffect(() => {
    setUiPref('waiter.history.statusFilter', statusFilter);
  }, [statusFilter, setUiPref]);

  useEffect(() => {
    setUiPref('waiter.history.dateFilter', dateFilter);
  }, [dateFilter, setUiPref]);

  useEffect(() => {
    setUiPref('waiter.history.query', query);
  }, [query, setUiPref]);

  // Close date picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.closest('.date-picker-container')) {
        setShowDatePicker(false);
      }
    };
    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (statusParam) params.set('status', statusParam);
        if (shiftFilter !== 'ALL') params.set('shift', shiftFilter);
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));

        // Calculate date range based on filter
        const now = new Date();
        let fromDate: string | null = null;
        let toDate: string | null = null;

        switch (dateFilter) {
          case 'Today': {
            const yyyy = String(now.getFullYear());
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            fromDate = `${yyyy}-${mm}-${dd}`;
            toDate = fromDate;
            break;
          }
          case 'Yesterday': {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yyyy = String(yesterday.getFullYear());
            const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
            const dd = String(yesterday.getDate()).padStart(2, '0');
            fromDate = `${yyyy}-${mm}-${dd}`;
            toDate = fromDate;
            break;
          }
          case 'Last7Days': {
            const last7 = new Date(now);
            last7.setDate(last7.getDate() - 6);
            const yyyyFrom = String(last7.getFullYear());
            const mmFrom = String(last7.getMonth() + 1).padStart(2, '0');
            const ddFrom = String(last7.getDate()).padStart(2, '0');
            const yyyyTo = String(now.getFullYear());
            const mmTo = String(now.getMonth() + 1).padStart(2, '0');
            const ddTo = String(now.getDate()).padStart(2, '0');
            fromDate = `${yyyyFrom}-${mmFrom}-${ddFrom}`;
            toDate = `${yyyyTo}-${mmTo}-${ddTo}`;
            break;
          }
          case 'Last30Days': {
            const last30 = new Date(now);
            last30.setDate(last30.getDate() - 29);
            const yyyyFrom = String(last30.getFullYear());
            const mmFrom = String(last30.getMonth() + 1).padStart(2, '0');
            const ddFrom = String(last30.getDate()).padStart(2, '0');
            const yyyyTo = String(now.getFullYear());
            const mmTo = String(now.getMonth() + 1).padStart(2, '0');
            const ddTo = String(now.getDate()).padStart(2, '0');
            fromDate = `${yyyyFrom}-${mmFrom}-${ddFrom}`;
            toDate = `${yyyyTo}-${mmTo}-${ddTo}`;
            break;
          }
          case 'Custom': {
            fromDate = customDateFrom;
            toDate = customDateTo;
            break;
          }
        }

        if (fromDate && toDate) {
          params.set('from', fromDate);
          params.set('to', toDate);
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
  }, [dateFilter, page, pageSize, query, statusParam, shiftFilter, customDateFrom, customDateTo]);

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
        // Get shift info from the order or its shift_id
        const shiftType = o?.shiftType || o?.shift_type || '';

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
          items,
          total: totalAmount,
          status,
          shiftType,
        };
      })
      .filter((r) => r.id);
    return base;
  }, [rowsRaw]);

  const dailyPaidRows = useMemo(() => {
    if (!isWaiterManager) return [];
    if (dateFilter !== 'Today') return [];
    return rows.filter((r) => String(r.status || '').trim() === 'Paid');
  }, [dateFilter, isWaiterManager, rows]);

  const dailyPaidByProduct = useMemo(() => {
    const map = new Map<
      string,
      {
        productId: string;
        productName: string;
        qty: number;
        total: number;
      }
    >();

    for (const r of dailyPaidRows) {
      const items = Array.isArray((r as any)?.items) ? ((r as any).items as any[]) : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const productId = String((it as any)?.productId || (it as any)?.product_id || '').trim();
        const productName = String((it as any)?.name || (it as any)?.productName || '').trim();
        const qty = Number((it as any)?.qty ?? 0) || 0;
        const unitPrice = Number((it as any)?.unitPrice ?? (it as any)?.unit_price ?? (it as any)?.price ?? 0) || 0;
        if (!productName && !productId) continue;
        if (qty <= 0) continue;

        const key = productId || productName.toLowerCase();
        const prev = map.get(key);
        const nextQty = (prev?.qty || 0) + qty;
        const nextTotal = (prev?.total || 0) + qty * unitPrice;

        map.set(key, {
          productId: productId || prev?.productId || '',
          productName: productName || prev?.productName || '',
          qty: nextQty,
          total: nextTotal,
        });
      }
    }

    return Array.from(map.values())
      .filter((x) => (x.productId || x.productName) && x.qty > 0)
      .sort((a, b) => b.total - a.total);
  }, [dailyPaidRows]);

  const dailyPaidTotal = useMemo(() => dailyPaidRows.reduce((sum, r) => sum + (Number(r.total) || 0), 0), [dailyPaidRows]);

  const downloadDailySalesXlsx = async () => {
    if (!isWaiterManager) return;

    // Get date range based on current filter
    let fromDate: string;
    let toDate: string;
    const now = new Date();

    switch (dateFilter) {
      case 'Today': {
        fromDate = toDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        break;
      }
      case 'Yesterday': {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        fromDate = toDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        break;
      }
      case 'Custom': {
        fromDate = customDateFrom;
        toDate = customDateTo;
        break;
      }
      default: {
        fromDate = toDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      }
    }

    const qs = new URLSearchParams();
    qs.set('from', fromDate);
    qs.set('to', toDate);

    const res = await apiFetch(`/api/waiter/history/export/xlsx?${qs.toString()}`);
    if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);

    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^";]+)"?/i.exec(cd);
    const filename = m?.[1] ? String(m[1]) : `sales_${fromDate}_to_${toDate}.xlsx`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadDailySalesPdf = async () => {
    if (!isWaiterManager) return;

    // Get date range based on current filter
    let fromDate: string;
    let toDate: string;
    const now = new Date();

    switch (dateFilter) {
      case 'Today': {
        fromDate = toDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        break;
      }
      case 'Yesterday': {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        fromDate = toDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        break;
      }
      case 'Custom': {
        fromDate = customDateFrom;
        toDate = customDateTo;
        break;
      }
      default: {
        fromDate = toDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      }
    }

    const qs = new URLSearchParams();
    qs.set('from', fromDate);
    qs.set('to', toDate);

    try {
      const res = await apiFetch(`/api/waiter/history/export/pdf?${qs.toString()}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ? String(m[1]) : `sales_${fromDate}_to_${toDate}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      setError(msg.includes('Failed to fetch') ? 'Export blocked by browser/extension. Disable adblock or allow this site.' : msg);
    }
  };

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
            {isWaiterManager ? (
              <div className="hidden lg:flex items-center gap-2 mr-2">
                <button
                  onClick={() => void downloadDailySalesXlsx()}
                  className="h-10 px-3 rounded-lg border text-sm font-bold transition-colors bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  type="button"
                >
                  Export Excel
                </button>
                <button
                  onClick={() => void downloadDailySalesPdf()}
                  className="h-10 px-3 rounded-lg border text-sm font-bold transition-colors bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  type="button"
                >
                  Export PDF
                </button>
              </div>
            ) : null}
            
            {/* Professional Date Range Dropdown */}
            <div className="relative date-picker-container">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="h-10 px-3 rounded-lg border text-sm font-bold transition-colors bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground flex items-center gap-2"
                type="button"
              >
                <Calendar className="w-4 h-4" />
                {dateFilter === 'Today' && 'Today'}
                {dateFilter === 'Yesterday' && 'Yesterday'}
                {dateFilter === 'Last7Days' && 'Last 7 Days'}
                {dateFilter === 'Last30Days' && 'Last 30 Days'}
                {dateFilter === 'Custom' && `${customDateFrom} - ${customDateTo}`}
                <ChevronDown className="w-4 h-4" />
              </button>
              
              {showDatePicker && (
                <div className="absolute right-0 mt-2 w-64 bg-card rounded-lg border border-border shadow-xl z-50">
                  <div className="p-2">
                    <button
                      onClick={() => { setDateFilter('Today'); setShowDatePicker(false); }}
                      className={`w-full px-3 py-2 rounded text-sm text-left transition-colors ${dateFilter === 'Today' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      Today
                    </button>
                    <button
                      onClick={() => { setDateFilter('Yesterday'); setShowDatePicker(false); }}
                      className={`w-full px-3 py-2 rounded text-sm text-left transition-colors ${dateFilter === 'Yesterday' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      Yesterday
                    </button>
                    <button
                      onClick={() => { setDateFilter('Last7Days'); setShowDatePicker(false); }}
                      className={`w-full px-3 py-2 rounded text-sm text-left transition-colors ${dateFilter === 'Last7Days' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      Last 7 Days
                    </button>
                    <button
                      onClick={() => { setDateFilter('Last30Days'); setShowDatePicker(false); }}
                      className={`w-full px-3 py-2 rounded text-sm text-left transition-colors ${dateFilter === 'Last30Days' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      Last 30 Days
                    </button>
                    <div className="border-t border-border my-2" />
                    <div className="px-3 py-2">
                      <p className="text-xs text-muted-foreground mb-2">Custom Range</p>
                      <div className="flex flex-col gap-2">
                        <input
                          type="date"
                          value={customDateFrom}
                          onChange={(e) => {
                            setCustomDateFrom(e.target.value);
                            setDateFilter('Custom');
                          }}
                          className="w-full px-2 py-1 text-sm rounded border border-border bg-background"
                        />
                        <input
                          type="date"
                          value={customDateTo}
                          onChange={(e) => {
                            setCustomDateTo(e.target.value);
                            setDateFilter('Custom');
                          }}
                          className="w-full px-2 py-1 text-sm rounded border border-border bg-background"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Shift Filter Buttons */}
            <div className="flex items-center bg-card rounded-lg border border-border p-1">
              <button
                onClick={() => setShiftFilter('ALL')}
                className={`h-8 px-3 rounded text-sm font-medium transition-colors ${shiftFilter === 'ALL' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                All Shifts
              </button>
              <button
                onClick={() => setShiftFilter('DAY')}
                className={`h-8 px-3 rounded text-sm font-medium transition-colors flex items-center gap-1 ${shiftFilter === 'DAY' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Sun className="w-3 h-3" />
                Day
              </button>
              <button
                onClick={() => setShiftFilter('NIGHT')}
                className={`h-8 px-3 rounded text-sm font-medium transition-colors flex items-center gap-1 ${shiftFilter === 'NIGHT' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Moon className="w-3 h-3" />
                Night
              </button>
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
                  <th className="px-6 py-4">Shift</th>
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
                    <td colSpan={9} className="px-6 py-8 text-muted-foreground">
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
                    <td className="px-6 py-4">
                      {r.shiftType === 'DAY' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                          <Sun className="w-3 h-3 mr-1" />
                          Day
                        </span>
                      ) : r.shiftType === 'NIGHT' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                          <Moon className="w-3 h-3 mr-1" />
                          Night
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-foreground">{r.table}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.time}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.by || ' -'}</td>
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
                        type="button"
                      >
                        <AppIcon name="visibility" className="text-[20px]" size={20} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          try {
                            sessionStorage.setItem(`mirachpos.manualPrintReceiptOnce.${r.id}`, '1');
                          } catch {
                            // ignore
                          }
                          selectOrder(r.id);
                          onNavigate(Screen.WAITER_RECEIPT);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/40 transition-colors ml-1"
                        type="button"
                        title="Print ticket"
                      >
                        <AppIcon name="print" className="text-[20px]" size={20} />
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
