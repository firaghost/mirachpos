import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, logoutAndReload } from '../../api';
import { PortalMenu, type PortalMenuAnchorRect } from '../../components/PortalMenu';
import { readSession } from '../../session';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';

type Branch = { id: string; name: string };

type ReportsResponse = {
  kpis: { totalRevenueNet: number; cogs: number; laborCost: number };
  trend: Array<{ ym: string; name: string; revenue: number; expenses: number }>;
  categories: Array<{ name: string; value: number }>;
  soldItems?: Array<{ productId: string; name: string; category: string; qty: number; revenue: number }>;
  soldCategories?: Array<{ name: string; qty: number; revenue: number }>;
  paymentMethods?: Array<{ name: string; txCount: number; amount: number }>;
  branchBreakdown?: Array<{
    branchId: string;
    name: string;
    status: string;
    txCount: number;
    netSales: number;
    tax: number;
    tips: number;
    discounts: number;
    totalCollected: number;
  }>;
  ledger: Array<{ date: string; txCount: number; netSales: number; tax: number; tips: number; discounts: number; totalCollected: number }>;
  totals: { txCount: number; netSales: number; tax: number; tips: number; discounts: number; totalCollected: number };
  shift?: {
    branchId: string;
    from: string;
    to: string;
    totalHours: number;
    openShifts: number;
    shifts: number;
    staff: Array<{ staffId: string; name: string; roleName: string; hours: number; shifts: number; openShifts: number }>;
  };
};

const startOfThisMonthIso = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const endOfTodayIso = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const toDateInput = (iso: string) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return '';
  }
};

const fromDateInputStartIso = (value: string) => {
  if (!value) return '';
  const [yyyy, mm, dd] = value.split('-').map((x) => Number(x));
  if (!yyyy || !mm || !dd) return '';
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

const fromDateInputEndIso = (value: string) => {
  if (!value) return '';
  const [yyyy, mm, dd] = value.split('-').map((x) => Number(x));
  if (!yyyy || !mm || !dd) return '';
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};

export const GlobalReports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [locationId, setLocationId] = useState<string>('');
  const [fromIso, setFromIso] = useState<string>(() => startOfThisMonthIso());
  const [toIso, setToIso] = useState<string>(() => endOfTodayIso());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');
  const [tab, setTab] = useState<'ledger' | 'mix' | 'void' | 'labor'>('ledger');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<PortalMenuAnchorRect | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [soldSearch, setSoldSearch] = useState('');
  const [soldSort, setSoldSort] = useState<'revenue' | 'qty'>('revenue');
  const [soldLimit, setSoldLimit] = useState<10 | 25 | 50>(10);
  const [draftFromIso, setDraftFromIso] = useState<string>('');
  const [draftToIso, setDraftToIso] = useState<string>('');

  const tenantName = useMemo(() => {
    try {
      const s = readSession<any>();
      const name = typeof s?.tenant?.name === 'string' ? s.tenant.name.trim() : '';
      return name || 'Cafe';
    } catch {
      return 'Cafe';
    }
  }, []);

  const fmtDate = useCallback((raw: string) => {
    const v = String(raw || '').trim();
    if (!v) return '—';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return v;
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
    } catch {
      return v;
    }
  }, []);

  const fmtDateTime = useCallback((raw: string) => {
    const v = String(raw || '').trim();
    if (!v) return '';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return v;
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d);
    } catch {
      return v;
    }
  }, []);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'ETB',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const logout = () => logoutAndReload();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        const br = await apiFetch('/api/branches');
        if (br.ok) {
          const data = (await br.json()) as { branches: Array<{ id: string; name: string }> };
          setBranches(Array.isArray(data.branches) ? data.branches : []);
        }
      } catch {
        // ignore
      }

      const qs = new URLSearchParams();
      if (locationId) qs.set('branchId', locationId);
      if (fromIso) qs.set('from', fromIso);
      if (toIso) qs.set('to', toIso);
      const url = qs.toString() ? `/api/owner/reports?${qs.toString()}` : '/api/owner/reports';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ReportsResponse;
      setReports(data);
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      setError('Start the API server (npm run dev:api).');
      setReports(null);
    } finally {
      setLoading(false);
    }
  }, [fromIso, locationId, toIso]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    setPage(1);
  }, [query, locationId, tab]);

  useEffect(() => {
    if (tab !== 'ledger') setQuery('');
  }, [tab]);

  // rangeOpen overlay is handled by PortalMenu (outside click + escape)

  useEffect(() => {
    if (!scheduleOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScheduleOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scheduleOpen]);

  const ledger = reports?.ledger || [];
  const filteredLedger = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((r) => r.date.toLowerCase().includes(q));
  }, [ledger, query]);

  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredLedger.slice(start, start + pageSize);
  }, [filteredLedger, safePage]);

  const csvEscape = (v: unknown) => {
    const s = String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  };

  const exportCsv = () => {
    const r = reports;
    if (!r) return;
    const generatedAt = new Date().toISOString();
    const scope = locationId ? branches.find((b) => b.id === locationId)?.name || locationId : 'All Locations';

    const lines: string[] = [];
    lines.push(`${tenantName} - Global Reports`);
    lines.push('Powered by MirachPos');
    lines.push('');
    lines.push(['GeneratedAt', generatedAt].map(csvEscape).join(','));
    lines.push(['Location', scope].map(csvEscape).join(','));
    lines.push(['From', fromIso || ''].map(csvEscape).join(','));
    lines.push(['To', toIso || ''].map(csvEscape).join(','));
    lines.push('');

    lines.push('Totals');
    lines.push(['TransCount', 'NetSales', 'Tax', 'Tips', 'Discounts', 'TotalCollected'].map(csvEscape).join(','));
    lines.push(
      [
        totals.txCount,
        totals.netSales,
        totals.tax,
        totals.tips,
        -Math.abs(totals.discounts),
        totals.totalCollected,
      ]
        .map(csvEscape)
        .join(','),
    );
    lines.push('');

    const pmRows = Array.isArray((r as any).paymentMethods) ? ((r as any).paymentMethods as any[]) : [];
    if (pmRows.length) {
      lines.push('Payments (by Method)');
      lines.push(['Method', 'TxCount', 'Amount'].map(csvEscape).join(','));
      for (const p of pmRows) {
        lines.push([p.name, p.txCount, p.amount].map(csvEscape).join(','));
      }
      lines.push('');
    }

    if (!locationId && Array.isArray(r.branchBreakdown) && r.branchBreakdown.length) {
      lines.push('All Locations - Branch Breakdown');
      lines.push(['Branch', 'Status', 'TransCount', 'NetSales', 'Tax', 'Tips', 'Discounts', 'TotalCollected'].map(csvEscape).join(','));
      for (const b of r.branchBreakdown) {
        lines.push(
          [b.name, b.status, b.txCount, b.netSales, b.tax, b.tips, -Math.abs(b.discounts), b.totalCollected]
            .map(csvEscape)
            .join(','),
        );
      }
      lines.push('');
    }

    lines.push('Daily Sales Ledger');
    lines.push(['Date', 'TransCount', 'NetSales', 'Tax', 'Tips', 'Discounts', 'TotalCollected'].map(csvEscape).join(','));
    for (const x of r.ledger) {
      lines.push(
        [x.date, x.txCount, x.netSales, x.tax, x.tips, -Math.abs(x.discounts), x.totalCollected]
          .map(csvEscape)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `global-reports-${locationId || 'all'}-${generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportSoldCsv = () => {
    const generatedAt = new Date().toISOString();
    const scope = locationId ? branches.find((b) => b.id === locationId)?.name || locationId : 'All Locations';
    const sortLabel = soldSort === 'qty' ? 'qty' : 'revenue';
    const q = soldSearch.trim();

    const lines: string[] = [];
    lines.push(`${tenantName} - What\'s Sold`);
    lines.push('Powered by MirachPos');
    lines.push('');
    lines.push(['GeneratedAt', generatedAt].map(csvEscape).join(','));
    lines.push(['Location', scope].map(csvEscape).join(','));
    lines.push(['From', fromIso || ''].map(csvEscape).join(','));
    lines.push(['To', toIso || ''].map(csvEscape).join(','));
    lines.push(['Sort', sortLabel].map(csvEscape).join(','));
    if (q) lines.push(['Search', q].map(csvEscape).join(','));
    lines.push('');

    lines.push(['Item', 'Category', 'Qty', 'Revenue'].map(csvEscape).join(','));
    for (const it of soldItemsSorted) {
      lines.push([it.name, it.category || 'Uncategorized', it.qty, it.revenue].map(csvEscape).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `what-sold-${locationId || 'all'}-${generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const submitSchedule = async () => {
    if (scheduleLoading) return;
    const email = scheduleEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setBanner({ kind: 'error', message: 'Please enter a valid email address.' });
      return;
    }
    setScheduleLoading(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/reports/schedule-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          frequency: scheduleFrequency,
          branchId: locationId,
          from: fromIso,
          to: toIso,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as any;
        const msg = j?.error === 'invalid_email' ? 'Invalid email.' : `Failed to schedule (HTTP ${res.status}).`;
        throw new Error(msg);
      }
      setScheduleOpen(false);
      setBanner({ kind: 'success', message: `Scheduled ${scheduleFrequency} report email to ${email}.` });
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to schedule email.' });
    } finally {
      setScheduleLoading(false);
    }
  };

  const kpis = reports?.kpis || { totalRevenueNet: 0, cogs: 0, laborCost: 0 };
  const totals = reports?.totals || { txCount: 0, netSales: 0, tax: 0, tips: 0, discounts: 0, totalCollected: 0 };
  const trend = reports?.trend || [];
  const financialCats = reports?.categories || [];
  const soldItems = reports?.soldItems || [];
  const soldCategories = reports?.soldCategories || [];
  const paymentMethods = reports?.paymentMethods || [];
  const branchBreakdown = reports?.branchBreakdown || [];
  const shift = reports?.shift;

  const monthLabel = useMemo(() => {
    try {
      const d = fromIso ? new Date(fromIso) : new Date();
      return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
    } catch {
      return 'This Month';
    }
  }, [fromIso]);

  const rangeLabel = useMemo(() => {
    const from = toDateInput(fromIso);
    const to = toDateInput(toIso);
    if (from && to) {
      return `${from} → ${to}`;
    }
    if (from) return `From ${from}`;
    if (to) return `To ${to}`;
    return `This Month: ${monthLabel}`;
  }, [fromIso, monthLabel, toIso]);

  const locationLabel = locationId ? branches.find((b) => b.id === locationId)?.name || locationId : 'All Locations';

  const donut = useMemo(() => {
    const base = Array.isArray(soldCategories) ? soldCategories : [];
    const list0 = base
      .map((c) => ({ name: String(c.name || 'Uncategorized'), value: Number(c.revenue || 0) || 0 }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = list0.reduce((s, c) => s + (Number(c.value) || 0), 0) || 0;
    const top = list0.slice(0, 3);
    const otherSum = list0.slice(3).reduce((s, c) => s + (Number(c.value) || 0), 0);
    const list = otherSum > 0 ? [...top, { name: 'Other', value: otherSum }] : top;
    const primary = list[0] || { name: '—', value: 0 };
    const pct = total > 0 ? Math.round((primary.value / total) * 100) : 0;
    return { total, list, primary, pct };
  }, [soldCategories]);

  const donutColors = ['#eead2b', '#8d764e', '#483c23', '#2a2316'];

  const topBranch = useMemo(() => {
    if (!branchBreakdown.length) return null;
    return branchBreakdown.reduce((best, cur) => (cur.netSales > (best?.netSales ?? -Infinity) ? cur : best), null as null | (typeof branchBreakdown)[number]);
  }, [branchBreakdown]);

  const avgTicket = useMemo(() => {
    const tx = totals.txCount || 0;
    if (!tx) return 0;
    return totals.netSales / tx;
  }, [totals.netSales, totals.txCount]);

  const topCategory = useMemo(() => {
    const c = soldCategories[0];
    if (!c) return null;
    return c;
  }, [soldCategories]);

  const soldItemsFiltered = useMemo(() => {
    const list = Array.isArray(soldItems) ? soldItems : [];
    const q = soldSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((x) => {
      const name = String(x.name || '').toLowerCase();
      const cat = String((x as any).category || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    });
  }, [soldItems, soldSearch]);

  const soldItemsSorted = useMemo(() => {
    const list = soldItemsFiltered.slice();
    list.sort((a, b) => {
      const ar = Number(a.revenue || 0) || 0;
      const br = Number(b.revenue || 0) || 0;
      const aq = Number(a.qty || 0) || 0;
      const bq = Number(b.qty || 0) || 0;
      if (soldSort === 'qty') return (bq - aq) || (br - ar);
      return (br - ar) || (bq - aq);
    });
    return list;
  }, [soldItemsFiltered, soldSort]);

  const topSoldItems = useMemo(() => soldItemsSorted.slice(0, soldLimit), [soldItemsSorted, soldLimit]);

  const topSoldItem = soldItemsSorted.length ? soldItemsSorted[0] : null;

  const soldInsights = useMemo(() => {
    const list = Array.isArray(soldItems) ? soldItems : [];
    let totalRevenue = 0;
    let totalQty = 0;
    for (const it of list) {
      totalRevenue += Number(it.revenue || 0) || 0;
      totalQty += Number(it.qty || 0) || 0;
    }
    const uniqueItems = list.length;
    const topCat = Array.isArray(soldCategories) && soldCategories.length ? soldCategories[0] : null;
    return {
      totalRevenue,
      totalQty,
      uniqueItems,
      topCategoryName: topCat?.name || '—',
      topCategoryRevenue: Number((topCat as any)?.revenue || 0) || 0,
    };
  }, [soldCategories, soldItems]);

  const payments = useMemo(() => {
    const list = Array.isArray(paymentMethods) ? paymentMethods : [];
    const total = list.reduce((s, x) => s + (Number((x as any).amount || 0) || 0), 0) || 0;
    const primary = list[0] || { name: '—', amount: 0, txCount: 0 };
    const pct = total > 0 ? Math.round(((Number((primary as any).amount || 0) || 0) / total) * 100) : 0;
    return { total, primary, pct, list };
  }, [paymentMethods]);

  const presetThisMonth = () => {
    setFromIso(startOfThisMonthIso());
    setToIso(endOfTodayIso());
  };

  const presetLast30 = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const from = new Date(d.getTime() - 29 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    setFromIso(from.toISOString());
    setToIso(endOfTodayIso());
  };

  const presetThisYear = () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
    setFromIso(from.toISOString());
    setToIso(endOfTodayIso());
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#181611] text-white overflow-hidden antialiased">
      <OwnerPageHeader
        title="Global Reports"
        leftSlot={
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-[#b9b09d]">Location:</span>
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-[#393328] text-white">{locationLabel}</span>
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setBanner(null);
                setScheduleOpen(true);
              }}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>schedule_send</span>
              <span className="hidden sm:inline">Schedule</span>
            </button>
            <button
              onClick={fetchAll}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={exportCsv}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={logout}
              className="flex items-center justify-center h-10 px-4 bg-[#221c10] border border-[#544b3b] text-[#eead2b] rounded-lg text-sm font-black hover:bg-[#2c2417] transition-colors"
              type="button"
            >
              Log Out
            </button>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto overflow-x-hidden px-6 md:px-8 py-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
          {banner ? (
            <div
              className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
                banner.kind === 'success'
                  ? 'border-green-500/20 bg-green-900/10 text-green-200'
                  : 'border-red-500/20 bg-red-900/10 text-red-200'
              }`}
            >
              <div className="text-sm font-medium">{banner.message}</div>
              <button
                onClick={() => setBanner(null)}
                className="h-9 px-3 rounded-lg bg-[#2a2316] border border-[#483c23] text-white hover:border-primary/50"
                type="button"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-sm text-[#c9b792]">
            <span>Home</span>
            <span className="text-[#483c23]">›</span>
            <span>Reports</span>
            <span className="text-[#483c23]">›</span>
            <span className="text-white font-medium">Global Reports</span>
            <span className="ml-auto text-xs text-[#c9b792]">{lastUpdatedAt ? `Updated: ${fmtDateTime(lastUpdatedAt)}` : ''}</span>
          </div>

          {scheduleOpen ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setScheduleOpen(false);
              }}
            >
              <div className="w-full max-w-[520px] rounded-2xl border border-[#483c23] bg-[#221c11] shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-[#483c23] px-5 py-4">
                  <div>
                    <div className="text-white text-lg font-black">Schedule Report Email</div>
                    <div className="text-[#c9b792] text-sm mt-1">Sends the current report snapshot on a schedule (demo scheduler).</div>
                  </div>
                  <button
                    onClick={() => setScheduleOpen(false)}
                    className="p-1.5 rounded-md hover:bg-[#483c23] text-[#c9b792] hover:text-white transition-colors"
                  >
                    <span className="material-symbols-outlined text-[22px]">close</span>
                  </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-[#c9b792] uppercase tracking-wider font-bold">Recipient Email</span>
                      <input
                        value={scheduleEmail}
                        onChange={(e) => setScheduleEmail(e.target.value)}
                        placeholder="owner@company.com"
                        type="email"
                        className="h-10 rounded-lg border border-[#483c23] bg-[#2a2316] text-white px-3 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-[#c9b792] uppercase tracking-wider font-bold">Frequency</span>
                      <select
                        value={scheduleFrequency}
                        onChange={(e) => setScheduleFrequency((e.target.value as any) || 'weekly')}
                        className="h-10 rounded-lg border border-[#483c23] bg-[#2a2316] text-white px-3 text-sm focus:border-primary focus:outline-none"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                  </div>

                  <div className="rounded-xl border border-[#483c23] bg-[#2a2316] p-4 text-sm text-[#c9b792]">
                    <div className="font-bold text-white">Scope</div>
                    <div className="mt-1">Location: <span className="text-white font-bold">{locationLabel}</span></div>
                    <div className="mt-1">Range: <span className="text-white font-bold">{rangeLabel}</span></div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-[#483c23] px-5 py-4">
                  <button
                    onClick={() => setScheduleOpen(false)}
                    className="h-10 px-4 rounded-lg bg-[#2a2316] border border-[#483c23] text-white hover:border-primary/50"
                    disabled={scheduleLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitSchedule}
                    className="h-10 px-4 rounded-lg bg-primary text-[#221c10] font-black hover:bg-primary/90 disabled:opacity-60"
                    disabled={scheduleLoading}
                  >
                    {scheduleLoading ? 'Scheduling ¦' : 'Schedule'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 border-y border-[#483c23] py-4 items-center">
            <div className="lg:col-span-7 flex flex-wrap items-center gap-3">
              <div className="relative">
                <button
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const next = !rangeOpen;
                    if (!next) {
                      setRangeOpen(false);
                      setRangeAnchor(null);
                      return;
                    }
                    setDraftFromIso(fromIso);
                    setDraftToIso(toIso);
                    try {
                      const r = (ev.currentTarget as any)?.getBoundingClientRect?.();
                      if (r) {
                        setRangeAnchor({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
                      } else {
                        setRangeAnchor(null);
                      }
                    } catch {
                      setRangeAnchor(null);
                    }
                    setRangeOpen(true);
                  }}
                  className="group flex h-10 shrink-0 items-center justify-center gap-x-2 rounded-xl bg-[#2a2316] border border-[#483c23] px-4 transition-colors hover:border-[#c9b792]/50"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[#c9b792] group-hover:text-white text-[18px]">calendar_today</span>
                  <span className="text-[#c9b792] group-hover:text-white text-sm font-medium">{rangeLabel}</span>
                  <span className="material-symbols-outlined text-[#c9b792] group-hover:text-white text-[18px]">keyboard_arrow_down</span>
                </button>

              <PortalMenu
                open={rangeOpen}
                anchorRect={rangeAnchor}
                onClose={() => {
                  setRangeOpen(false);
                  setRangeAnchor(null);
                }}
                width={320}
              >
                <div className="p-3">
                  <div className="text-xs font-bold text-[#c9b792] uppercase tracking-wider">Date Range</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button onClick={presetThisMonth} className="h-9 rounded-lg bg-[#2a2316] border border-[#483c23] text-sm text-white hover:border-primary/50" type="button">This Month</button>
                    <button onClick={presetLast30} className="h-9 rounded-lg bg-[#2a2316] border border-[#483c23] text-sm text-white hover:border-primary/50" type="button">Last 30</button>
                    <button onClick={presetThisYear} className="h-9 rounded-lg bg-[#2a2316] border border-[#483c23] text-sm text-white hover:border-primary/50" type="button">This Year</button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#c9b792]">From</span>
                      <input
                        value={toDateInput(draftFromIso || fromIso)}
                        onChange={(e) => setDraftFromIso(fromDateInputStartIso(e.target.value))}
                        type="date"
                        className="h-9 rounded-lg border border-[#483c23] bg-[#2a2316] text-white px-2 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#c9b792]">To</span>
                      <input
                        value={toDateInput(draftToIso || toIso)}
                        onChange={(e) => setDraftToIso(fromDateInputEndIso(e.target.value))}
                        type="date"
                        className="h-9 rounded-lg border border-[#483c23] bg-[#2a2316] text-white px-2 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        setRangeOpen(false);
                        setRangeAnchor(null);
                      }}
                      className="h-9 px-3 rounded-lg bg-[#2a2316] border border-[#483c23] text-sm text-[#c9b792] hover:text-white"
                      type="button"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        if (draftFromIso) setFromIso(draftFromIso);
                        if (draftToIso) setToIso(draftToIso);
                        setRangeOpen(false);
                        setRangeAnchor(null);
                      }}
                      className="h-9 px-3 rounded-lg bg-primary text-[#221c10] text-sm font-bold hover:bg-primary/90"
                      type="button"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </PortalMenu>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-[#2a2316] border border-[#483c23] px-4 h-10">
              <span className="material-symbols-outlined text-[#c9b792] text-[18px]">storefront</span>
              <span className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Location</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="h-9 bg-transparent text-sm text-white focus:ring-0 border-none"
              >
                <option value="">All Locations</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            </div>

            <div className="lg:col-span-5 hidden lg:flex items-center justify-end gap-2 text-xs text-[#c9b792]">
              <span className="text-primary font-bold">Updated:</span>
              <span>{lastUpdatedAt ? fmtDateTime(lastUpdatedAt) : '—'}</span>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-900/10 text-red-300 p-4 flex items-center justify-between gap-4">
              <div className="text-sm">{error}</div>
              <button onClick={fetchAll} className="h-10 px-4 rounded-lg bg-[#2a2316] border border-[#483c23] text-white hover:border-primary/50">
                Retry
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[#c9b792] text-xs font-bold uppercase tracking-wider">Total Revenue (Net)</p>
                <span className="material-symbols-outlined text-[#eead2b] text-[18px]">payments</span>
              </div>
              <p className="text-white text-3xl font-black tracking-tight mt-2">{money.format(kpis.totalRevenueNet)}</p>
              <p className="text-xs text-[#c9b792] mt-1">Location: {locationLabel}</p>
            </div>

            <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[#c9b792] text-xs font-bold uppercase tracking-wider">Transactions</p>
                <span className="material-symbols-outlined text-[#c9b792] text-[18px]">receipt_long</span>
              </div>
              <p className="text-white text-3xl font-black tracking-tight mt-2">{Number(totals.txCount || 0).toLocaleString()}</p>
              <p className="text-xs text-[#c9b792] mt-1">Paid orders in range</p>
            </div>

            <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[#c9b792] text-xs font-bold uppercase tracking-wider">Avg Ticket (Net)</p>
                <span className="material-symbols-outlined text-[#c9b792] text-[18px]">query_stats</span>
              </div>
              <p className="text-white text-3xl font-black tracking-tight mt-2">{money.format(avgTicket)}</p>
              <p className="text-xs text-[#c9b792] mt-1">Net sales / tx</p>
            </div>

            <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[#c9b792] text-xs font-bold uppercase tracking-wider">Top Sold Item</p>
                <span className="material-symbols-outlined text-[#c9b792] text-[18px]">restaurant</span>
              </div>
              <p className="text-white text-lg font-black tracking-tight mt-2 truncate">{topSoldItem?.name || '—'}</p>
              <p className="text-xs text-[#c9b792] mt-1">{topSoldItem ? money.format(Number(topSoldItem.revenue || 0) || 0) : 'No sales yet'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-lg font-bold">Revenue vs. Expenses Trend</p>
                    <p className="text-[#c9b792] text-sm">Monthly comparison</p>
                  </div>
                </div>
                <div className="h-[240px] w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#eead2b" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#eead2b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#483c23" vertical={false} opacity={0.5} />
                      <XAxis dataKey="name" stroke="#483c23" tick={{ fill: '#c9b792', fontSize: 12 }} />
                      <YAxis stroke="#483c23" tick={{ fill: '#c9b792', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#221c11', borderColor: '#483c23', color: '#fff' }}
                        labelStyle={{ color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(v) => [money.format(Number(v) || 0), '']}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#eead2b" strokeWidth={3} fill="url(#revFill)" />
                      <Area type="monotone" dataKey="expenses" stroke="#8d764e" strokeWidth={2} fillOpacity={0.1} fill="#8d764e" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div>
                    <p className="text-white text-lg font-black">What's Sold (Top Items)</p>
                    <p className="text-[#c9b792] text-sm">Based on paid orders in the selected range</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-[260px]">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#c9b792] text-[18px]">search</span>
                      <input
                        value={soldSearch}
                        onChange={(e) => setSoldSearch(e.target.value)}
                        className="w-full h-10 rounded-xl border border-[#483c23] bg-[#221c11] pl-10 pr-10 text-sm text-white focus:border-primary focus:outline-none placeholder:text-[#c9b792]/60"
                        placeholder="Search item or category"
                        type="text"
                      />
                      {soldSearch.trim() ? (
                        <button
                          onClick={() => setSoldSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[#483c23] text-[#c9b792] hover:text-white"
                          type="button"
                          title="Clear"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      ) : null}
                    </div>

                    <div className="flex items-center rounded-xl border border-[#483c23] bg-[#221c11] px-2 h-10">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#c9b792] mr-2">Top</span>
                      <select
                        value={soldLimit}
                        onChange={(e) => setSoldLimit((Number(e.target.value) as any) || 10)}
                        className="h-9 bg-transparent text-sm text-white focus:ring-0 border-none"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </div>

                    <div className="flex items-center rounded-xl border border-[#483c23] bg-[#221c11] p-1">
                      <button
                        onClick={() => setSoldSort('revenue')}
                        className={`h-8 px-3 rounded-lg text-xs font-black uppercase tracking-wider ${soldSort === 'revenue' ? 'bg-primary text-[#221c10]' : 'text-[#c9b792] hover:text-white'}`}
                        type="button"
                      >
                        Revenue
                      </button>
                      <button
                        onClick={() => setSoldSort('qty')}
                        className={`h-8 px-3 rounded-lg text-xs font-black uppercase tracking-wider ${soldSort === 'qty' ? 'bg-primary text-[#221c10]' : 'text-[#c9b792] hover:text-white'}`}
                        type="button"
                      >
                        Qty
                      </button>
                    </div>

                    <div className="text-xs text-[#c9b792]">
                      Showing {Math.min(soldLimit, soldItemsSorted.length)} of {soldItemsSorted.length}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#483c23] bg-[#221c11]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#221c11] text-xs uppercase text-[#c9b792] border-b border-[#483c23]">
                      <tr>
                        <th className="px-5 py-3">Item</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#483c23]">
                      {topSoldItems.length ? (
                        topSoldItems.map((it) => (
                          <tr key={it.productId} className="hover:bg-[#322a1b] transition-colors">
                            <td className="px-5 py-3 text-white font-bold whitespace-nowrap">{it.name}</td>
                            <td className="px-5 py-3 text-[#c9b792] whitespace-nowrap">{it.category || 'Uncategorized'}</td>
                            <td className="px-5 py-3 text-right font-mono text-white">{Number(it.qty || 0).toLocaleString()}</td>
                            <td className="px-5 py-3 text-right font-bold text-primary">{money.format(Number(it.revenue || 0) || 0)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-5 py-10 text-[#c9b792]" colSpan={4}>
                            {soldSearch.trim() ? 'No matching items found.' : 'No sold items found for this range. Create a few paid orders to populate.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-lg font-black">Action Center</p>
                    <p className="text-[#c9b792] text-sm">Quick insights + exports</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#483c23] bg-[#221c11] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#c9b792] font-bold">Sold Revenue</div>
                    <div className="text-white font-black mt-1">{money.format(soldInsights.totalRevenue)}</div>
                  </div>
                  <div className="rounded-xl border border-[#483c23] bg-[#221c11] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#c9b792] font-bold">Units Sold</div>
                    <div className="text-white font-black mt-1">{Number(soldInsights.totalQty || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-[#483c23] bg-[#221c11] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#c9b792] font-bold">Unique Items</div>
                    <div className="text-white font-black mt-1">{Number(soldInsights.uniqueItems || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-[#483c23] bg-[#221c11] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#c9b792] font-bold">Top Category</div>
                    <div className="text-white font-black mt-1 truncate" title={soldInsights.topCategoryName}>{soldInsights.topCategoryName}</div>
                    <div className="text-[#c9b792] text-xs mt-0.5">{soldInsights.topCategoryRevenue ? money.format(soldInsights.topCategoryRevenue) : '—'}</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-[#483c23] bg-[#221c11] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-white font-black">Payments</div>
                      <div className="text-[#c9b792] text-xs mt-0.5">Breakdown by method</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-[#c9b792] font-bold">Top</div>
                      <div className="text-white font-black">{payments.primary?.name || '—'}</div>
                      <div className="text-[#c9b792] text-xs">{payments.total ? `${payments.pct}%` : '—'}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[#c9b792] text-xs">Total collected (payments)</div>
                    <div className="text-primary font-black">{payments.total ? money.format(payments.total) : '—'}</div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {(payments.list || []).slice(0, 6).map((p) => (
                      <div key={p.name} className="flex items-center justify-between rounded-xl border border-[#483c23] bg-[#2a2316] px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-white font-bold truncate">{p.name}</div>
                          <div className="text-[#c9b792] text-[11px]">Tx: {Number(p.txCount || 0).toLocaleString()}</div>
                        </div>
                        <div className="text-white font-black whitespace-nowrap">{money.format(Number(p.amount || 0) || 0)}</div>
                      </div>
                    ))}

                    {!payments.list?.length ? (
                      <div className="text-[#c9b792] text-sm">No payment method data yet.</div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={exportCsv}
                    className="h-11 rounded-xl bg-primary text-[#221c10] font-black text-sm hover:bg-primary/90 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Export Report
                  </button>
                  <button
                    onClick={exportSoldCsv}
                    className="h-11 rounded-xl bg-[#221c11] border border-[#483c23] text-white font-black text-sm hover:border-primary/50 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">table_view</span>
                    Export Sold
                  </button>
                  <button
                    onClick={() => {
                      setBanner(null);
                      setScheduleOpen(true);
                    }}
                    className="h-11 rounded-xl bg-[#221c11] border border-[#483c23] text-white font-black text-sm hover:border-primary/50 flex items-center justify-center gap-2 col-span-2"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">schedule_send</span>
                    Schedule
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div>
                  <p className="text-white text-lg font-bold">Revenue Breakdown</p>
                  <p className="text-[#c9b792] text-sm">Net sales, tax, tips, discounts</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {financialCats.length ? (
                    financialCats.map((c) => (
                      <div key={c.name} className="flex items-center justify-between rounded-lg border border-[#483c23] bg-[#221c11] px-4 py-3">
                        <div className="text-white font-bold">{c.name}</div>
                        <div className="text-[#c9b792] font-mono">{money.format(Number(c.value || 0) || 0)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-[#c9b792] text-sm">No revenue breakdown available.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div className="text-[#c9b792] text-xs uppercase tracking-wider font-bold">What's Sold (Categories)</div>
                <div className="mt-3 flex items-center justify-center relative">
                  <div className="relative size-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donut.list}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={54}
                          outerRadius={72}
                          paddingAngle={2}
                          stroke="#221c11"
                          strokeWidth={2}
                        >
                          {donut.list.map((_, idx) => (
                            <Cell key={idx} fill={donutColors[idx % donutColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#221c11', borderColor: '#483c23', color: '#fff' }}
                          formatter={(v, n) => [money.format(Number(v) || 0), String(n)]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 m-auto size-28 rounded-full bg-[#2a2316] flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-white">{donut.pct}%</span>
                      <span className="text-xs text-[#c9b792] uppercase tracking-widest">{donut.primary.name}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] p-6">
                <div className="text-white font-black">Top Categories</div>
                <div className="text-[#c9b792] text-sm mt-1">By revenue</div>
                <div className="mt-4 grid grid-cols-1 gap-3">
                  {(Array.isArray(soldCategories) ? soldCategories : []).slice(0, 6).map((c) => (
                    <div key={c.name} className="flex items-center justify-between rounded-xl border border-[#483c23] bg-[#221c11] px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-white font-bold truncate">{c.name || 'Uncategorized'}</div>
                        <div className="text-[#c9b792] text-xs">Qty: {Number(c.qty || 0).toLocaleString()}</div>
                      </div>
                      <div className="text-primary font-black whitespace-nowrap">{money.format(Number(c.revenue || 0) || 0)}</div>
                    </div>
                  ))}
                  {!soldCategories.length ? <div className="text-[#c9b792] text-sm">No category sales yet.</div> : null}
                </div>
              </div>
            </div>
          </div>

          {!locationId ? (
            <div className="flex flex-col gap-4 rounded-xl border border-[#483c23] bg-[#2a2316] p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-white text-lg font-bold">All Locations Command Center</p>
                  <p className="text-[#c9b792] text-sm">Branch ranking + executive insights for the selected range</p>
                </div>
                <div className="text-xs text-[#c9b792]">Sorted by Net Sales</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-[#483c23] bg-[#221c11] p-4">
                  <div className="text-[#c9b792] text-xs uppercase tracking-wider">Top Branch</div>
                  <div className="text-white text-lg font-black mt-1">{topBranch?.name || '—'}</div>
                  <div className="text-[#c9b792] text-sm mt-1">{topBranch ? money.format(topBranch.netSales) : '—'}</div>
                </div>
                <div className="rounded-xl border border-[#483c23] bg-[#221c11] p-4">
                  <div className="text-[#c9b792] text-xs uppercase tracking-wider">Avg Ticket (Net)</div>
                  <div className="text-white text-lg font-black mt-1">{money.format(avgTicket)}</div>
                  <div className="text-[#c9b792] text-sm mt-1">{totals.txCount} transactions</div>
                </div>
                <div className="rounded-xl border border-[#483c23] bg-[#221c11] p-4">
                  <div className="text-[#c9b792] text-xs uppercase tracking-wider">Top Category (Sold)</div>
                  <div className="text-white text-lg font-black mt-1">{topCategory?.name || '—'}</div>
                  <div className="text-[#c9b792] text-sm mt-1">{topCategory ? money.format(Number((topCategory as any).revenue || 0) || 0) : '—'}</div>
                </div>
              </div>

              {branchBreakdown.length ? (
                <div className="overflow-x-auto rounded-xl border border-[#483c23]">
                  <table className="w-full text-left text-sm text-[#c9b792]">
                    <thead className="bg-[#221c11] text-xs uppercase text-[#c9b792] border-b border-[#483c23]">
                      <tr>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Branch</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Status</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-center">Tx</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Net Sales</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Tax</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Tips</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right text-red-400">Discounts</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right text-white">Total Collected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#483c23] font-medium">
                      {branchBreakdown.map((b, idx) => (
                        <tr key={b.branchId} className={idx % 2 === 1 ? 'bg-[#221c11]/40 hover:bg-[#322a1b] transition-colors' : 'hover:bg-[#322a1b] transition-colors'}>
                          <td className="whitespace-nowrap px-5 py-3 text-white font-bold">{b.name}</td>
                          <td className="whitespace-nowrap px-5 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold border ${
                                b.status === 'Open'
                                  ? 'bg-green-500/10 text-green-300 border-green-500/20'
                                  : b.status === 'Closed'
                                    ? 'bg-red-500/10 text-red-300 border-red-500/20'
                                    : 'bg-[#2a2316] text-[#c9b792] border-[#483c23]'
                              }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-center">{b.txCount}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-white font-bold">{money.format(b.netSales)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right">{money.format(b.tax)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right">{money.format(b.tips)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-red-400">-{money.format(Math.abs(b.discounts))}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-black text-primary">{money.format(b.totalCollected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-[#483c23] bg-[#221c11] p-4 text-sm text-[#c9b792]">
                  No branch payment data found for this range. Create a few orders/payments in different branches to populate the All Locations ranking.
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-col rounded-xl border border-[#483c23] bg-[#2a2316] overflow-hidden">
            <div className="flex flex-wrap items-center border-b border-[#483c23] bg-[#221c11]/50 px-4 pt-4">
              <button
                onClick={() => setTab('ledger')}
                className={`mr-4 pb-4 ${tab === 'ledger' ? 'border-b-2 border-primary text-white font-bold' : 'border-b-2 border-transparent text-[#c9b792] hover:text-white font-medium'} text-sm px-2`}
              >
                Daily Sales Ledger
              </button>
              <button
                onClick={() => setTab('mix')}
                className={`mr-4 pb-4 ${tab === 'mix' ? 'border-b-2 border-primary text-white font-bold' : 'border-b-2 border-transparent text-[#c9b792] hover:text-white font-medium'} text-sm px-2`}
              >
                Product Mix
              </button>
              <button
                onClick={() => setTab('void')}
                className={`mr-4 pb-4 ${tab === 'void' ? 'border-b-2 border-primary text-white font-bold' : 'border-b-2 border-transparent text-[#c9b792] hover:text-white font-medium'} text-sm px-2`}
              >
                Void / Comp Log
              </button>
              <button
                onClick={() => setTab('labor')}
                className={`mr-4 pb-4 ${tab === 'labor' ? 'border-b-2 border-primary text-white font-bold' : 'border-b-2 border-transparent text-[#c9b792] hover:text-white font-medium'} text-sm px-2`}
              >
                Labor Analysis
              </button>
              <div className="ml-auto pb-3">
                <button className="flex items-center gap-1 text-xs text-primary font-bold uppercase tracking-wide hover:underline">
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                  Customize Columns
                </button>
              </div>
            </div>

            {tab === 'ledger' ? (
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="relative max-w-sm w-full">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#c9b792] text-[20px]">search</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-lg border border-[#483c23] bg-[#221c11] py-2 pl-10 pr-4 text-sm text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-[#c9b792]/60"
                    placeholder="Search transactions (by date)..."
                    type="text"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#c9b792]">Showing {pageRows.length} of {filteredLedger.length} rows</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded hover:bg-[#483c23] text-[#c9b792] disabled:opacity-50"
                      disabled={safePage <= 1}
                    >
                      <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="p-1 rounded hover:bg-[#483c23] text-white disabled:opacity-50"
                      disabled={safePage >= totalPages}
                    >
                      <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              {tab === 'ledger' ? (
              <table className="w-full text-left text-sm text-[#c9b792]">
                <thead className="bg-[#221c11] text-xs uppercase text-[#c9b792] border-b border-[#483c23]">
                  <tr>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Date</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-center">Trans. Count</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Net Sales</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Tax</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Tips</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right text-red-400">Discounts</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right text-white">Total Collected</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#483c23] font-medium">
                  {loading ? (
                    <tr>
                      <td className="px-6 py-6" colSpan={8}>
                        Loading...
                      </td>
                    </tr>
                  ) : pageRows.length === 0 ? (
                    <tr>
                      <td className="px-6 py-6" colSpan={8}>
                        No rows.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((r, idx) => (
                      <tr key={r.date} className={idx % 2 === 1 ? 'bg-[#221c11]/40 hover:bg-[#322a1b] transition-colors' : 'hover:bg-[#322a1b] transition-colors'}>
                        <td className="whitespace-nowrap px-6 py-4 text-white">{fmtDate(r.date)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-center">{r.txCount}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.netSales)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.tax)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.tips)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-red-400">-{money.format(Math.abs(r.discounts))}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right font-bold text-white">{money.format(r.totalCollected)}</td>
                        <td className="px-4 py-4 text-right">
                          <button className="text-[#c9b792] hover:text-primary">
                            <span className="material-symbols-outlined">more_vert</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-[#221c11] border-t-2 border-[#483c23]">
                  <tr>
                    <td className="px-6 py-4 font-bold text-white uppercase">Totals</td>
                    <td className="px-6 py-4 text-center font-bold text-white">{totals.txCount}</td>
                    <td className="px-6 py-4 text-right font-bold text-white">{money.format(totals.netSales)}</td>
                    <td className="px-6 py-4 text-right font-bold text-white">{money.format(totals.tax)}</td>
                    <td className="px-6 py-4 text-right font-bold text-white">{money.format(totals.tips)}</td>
                    <td className="px-6 py-4 text-right font-bold text-red-400">-{money.format(Math.abs(totals.discounts))}</td>
                    <td className="px-6 py-4 text-right font-bold text-primary text-base">{money.format(totals.totalCollected)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              ) : tab === 'mix' ? (
                <div className="p-6 text-sm">
                  <div className="text-white font-bold">Product Mix (by Sold Categories)</div>
                  <div className="text-[#c9b792] mt-1">Derived from paid orders (order payload items).</div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {soldCategories.length ? (
                      soldCategories.slice(0, 8).map((c) => (
                        <div key={c.name} className="rounded-lg border border-[#483c23] bg-[#221c11] p-4 flex items-center justify-between">
                          <div className="text-white font-semibold">{c.name}</div>
                          <div className="text-primary font-black">{money.format(Number(c.revenue || 0) || 0)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-[#c9b792]">No category data yet.</div>
                    )}
                  </div>
                </div>
              ) : tab === 'labor' ? (
                <div className="p-6 text-sm">
                  <div className="text-white font-bold">Labor Analysis</div>
                  <div className="text-[#c9b792] mt-1">Shift activity is tracked from real clock-in/clock-out logs.</div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-[#483c23] bg-[#221c11] p-4">
                      <div className="text-[#c9b792] text-xs uppercase tracking-wider">Net Revenue</div>
                      <div className="text-white text-xl font-black mt-1">{money.format(kpis.totalRevenueNet)}</div>
                    </div>
                    <div className="rounded-lg border border-[#483c23] bg-[#221c11] p-4">
                      <div className="text-[#c9b792] text-xs uppercase tracking-wider">Shift Hours</div>
                      <div className="text-white text-xl font-black mt-1">{(shift?.totalHours ?? 0).toFixed(2)} h</div>
                    </div>
                    <div className="rounded-lg border border-[#483c23] bg-[#221c11] p-4">
                      <div className="text-[#c9b792] text-xs uppercase tracking-wider">Shifts</div>
                      <div className="text-white text-xl font-black mt-1">{shift?.shifts ?? 0}</div>
                    </div>
                  </div>

                  {shift ? (
                    <div className="mt-6 rounded-xl border border-[#483c23] overflow-hidden">
                      <div className="px-5 py-4 bg-[#221c11] border-b border-[#483c23] flex items-center justify-between">
                        <div className="text-white font-extrabold">Staff Shift Activity</div>
                        <div className="text-[11px] text-[#c9b792]">Open shifts: {shift.openShifts}</div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-[#c9b792]">
                          <thead className="bg-[#221c11] text-xs uppercase text-[#c9b792] border-b border-[#483c23]">
                            <tr>
                              <th className="px-5 py-3">Staff</th>
                              <th className="px-5 py-3">Role</th>
                              <th className="px-5 py-3 text-right">Hours</th>
                              <th className="px-5 py-3 text-right">Shifts</th>
                              <th className="px-5 py-3 text-right">Open</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#483c23]">
                            {Array.isArray(shift.staff) && shift.staff.length ? (
                              shift.staff.slice(0, 50).map((r) => (
                                <tr key={r.staffId} className="hover:bg-[#322a1b] transition-colors">
                                  <td className="px-5 py-3 text-white font-bold whitespace-nowrap">{r.name}</td>
                                  <td className="px-5 py-3 whitespace-nowrap">{r.roleName || '—'}</td>
                                  <td className="px-5 py-3 text-right font-mono">{Number(r.hours || 0).toFixed(2)}</td>
                                  <td className="px-5 py-3 text-right font-mono">{r.shifts}</td>
                                  <td className="px-5 py-3 text-right font-mono">{r.openShifts}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-5 py-6 text-[#c9b792]" colSpan={5}>
                                  No shift activity in this date range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 text-[#c9b792]">No shift activity data available.</div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-sm text-[#c9b792]">No void/comp events recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
