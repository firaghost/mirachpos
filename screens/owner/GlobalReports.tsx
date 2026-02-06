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
import { formatDeviceDateTime } from '../../datetime';
import {
  downloadCSV,
  escapeCSV,
  formatCurrency,
  formatReadableDate,
  generateReportHeader,
  generateSectionHeader,
  generateFilename,
} from '../../utils/exportUtils';

import { AppIcon } from '@/components/ui/app-icon';
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

const toDateOnly = (iso: string) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
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
    const scope = locationId ? branches.find((b) => b.id === locationId)?.name || locationId : 'All Locations';

    let generatedBy = '';
    try {
      const s = readSession<any>();
      generatedBy = String(s?.name || s?.username || s?.email || s?.role || '').trim();
    } catch {
      // ignore
    }

    const lines: string[] = [];

    // Professional header
    const headerLines = generateReportHeader({
      businessName: tenantName,
      branchName: scope !== 'All Locations' ? scope : undefined,
      reportTitle: 'Global Reports',
      fromDate: fromIso || '',
      toDate: toIso || '',
      generatedBy: generatedBy || undefined,
    });
    lines.push(...headerLines);

    // Summary Totals
    lines.push(...generateSectionHeader('Summary Totals'));
    lines.push([escapeCSV('Metric'), escapeCSV('Value')].join(','));
    lines.push([escapeCSV('Transactions'), escapeCSV(String(totals.txCount))].join(','));
    lines.push([escapeCSV('Net Sales'), escapeCSV(formatCurrency(totals.netSales))].join(','));
    lines.push([escapeCSV('Tax Collected'), escapeCSV(formatCurrency(totals.tax))].join(','));
    lines.push([escapeCSV('Tips'), escapeCSV(formatCurrency(totals.tips))].join(','));
    lines.push([escapeCSV('Discounts'), escapeCSV(formatCurrency(-Math.abs(totals.discounts)))].join(','));
    lines.push([escapeCSV('Total Collected'), escapeCSV(formatCurrency(totals.totalCollected))].join(','));

    // Payment Methods
    const pmRows = Array.isArray((r as any).paymentMethods) ? ((r as any).paymentMethods as any[]) : [];
    if (pmRows.length) {
      lines.push(...generateSectionHeader('Payment Methods'));
      lines.push([escapeCSV('Method'), escapeCSV('Transactions'), escapeCSV('Amount')].join(','));
      for (const p of pmRows) {
        lines.push([escapeCSV(p.name), escapeCSV(String(p.txCount)), escapeCSV(formatCurrency(p.amount))].join(','));
      }
    }

    // Branch Breakdown
    if (!locationId && Array.isArray(r.branchBreakdown) && r.branchBreakdown.length) {
      lines.push(...generateSectionHeader('Branch Performance'));
      lines.push([escapeCSV('Branch'), escapeCSV('Status'), escapeCSV('Orders'), escapeCSV('Net Sales'), escapeCSV('Tax'), escapeCSV('Tips'), escapeCSV('Discounts'), escapeCSV('Total')].join(','));
      for (const b of r.branchBreakdown) {
        lines.push([
          escapeCSV(b.name),
          escapeCSV(b.status),
          escapeCSV(String(b.txCount)),
          escapeCSV(formatCurrency(b.netSales)),
          escapeCSV(formatCurrency(b.tax)),
          escapeCSV(formatCurrency(b.tips)),
          escapeCSV(formatCurrency(-Math.abs(b.discounts))),
          escapeCSV(formatCurrency(b.totalCollected)),
        ].join(','));
      }
    }

    // Daily Ledger
    lines.push(...generateSectionHeader('Daily Sales Ledger'));
    lines.push([escapeCSV('Date'), escapeCSV('Orders'), escapeCSV('Net Sales'), escapeCSV('Tax'), escapeCSV('Tips'), escapeCSV('Discounts'), escapeCSV('Total')].join(','));
    for (const x of r.ledger) {
      lines.push([
        escapeCSV(formatReadableDate(x.date)),
        escapeCSV(String(x.txCount)),
        escapeCSV(formatCurrency(x.netSales)),
        escapeCSV(formatCurrency(x.tax)),
        escapeCSV(formatCurrency(x.tips)),
        escapeCSV(formatCurrency(-Math.abs(x.discounts))),
        escapeCSV(formatCurrency(x.totalCollected)),
      ].join(','));
    }

    // Footer
    lines.push('');
    lines.push(escapeCSV('Powered by MirachPOS'));

    const filename = generateFilename('global_reports', locationId ? scope : 'all_locations', fromIso, toIso);
    downloadCSV(lines.join('\n'), filename);
  };

  const exportXlsx = async () => {
    setBanner(null);
    const from = toDateOnly(fromIso);
    const to = toDateOnly(toIso);
    if (!from || !to) {
      setBanner({ kind: 'error', message: 'Select a valid date range first.' });
      return;
    }

    try {
      const qs = new URLSearchParams();
      if (locationId) qs.set('branchId', locationId);
      qs.set('from', from);
      qs.set('to', to);

      const res = await apiFetch(`/api/owner/reports/export/xlsx?${qs.toString()}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ? String(m[1]) : `mirachpos_reports_${from}_to_${to}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to export Excel.' });
    }
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
      return formatDeviceDateTime(d, { month: 'short', year: 'numeric' }) || 'This Month';
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

  const maxSoldCategoryRevenue = useMemo(() => {
    const list = Array.isArray(soldCategories) ? soldCategories : [];
    let max = 0;
    for (const c of list) {
      const v = Number((c as any).revenue || 0) || 0;
      if (v > max) max = v;
    }
    return max;
  }, [soldCategories]);

  const donutColors = ['hsl(var(--primary))', 'hsl(var(--muted-foreground))', 'hsl(var(--muted))', 'hsl(var(--border))'];

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
    <div className="relative flex h-full w-full flex-col bg-background text-foreground overflow-hidden antialiased">
      <OwnerPageHeader
        title="Global Reports"
        leftSlot={
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Location:</span>
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-muted text-foreground">{locationLabel}</span>
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setBanner(null);
                setScheduleOpen(true);
              }}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-muted text-foreground rounded-lg text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              <AppIcon name="schedule_send" />
              <span className="hidden sm:inline">Schedule</span>
            </button>
            <button
              onClick={fetchAll}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-muted text-foreground rounded-lg text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              <AppIcon name="refresh" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={exportCsv}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-md"
              type="button"
            >
              <AppIcon name="download" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={logout}
              className="flex items-center justify-center h-10 px-4 bg-card border border-border text-primary rounded-lg text-sm font-black hover:bg-accent transition-colors"
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
              className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${banner.kind === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-500'
                  : 'border-destructive/20 bg-destructive/10 text-destructive'
                }`}
            >
              <div className="text-sm font-medium">{banner.message}</div>
              <button
                onClick={() => setBanner(null)}
                className="h-9 px-3 rounded-lg bg-card border border-border text-foreground hover:bg-accent hover:border-primary/50"
                type="button"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {scheduleOpen ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setScheduleOpen(false);
              }}
            >
              <div className="w-full max-w-[520px] rounded-2xl border border-border bg-card shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                  <div>
                    <div className="text-foreground text-lg font-black">Schedule Report Email</div>
                    <div className="text-muted-foreground text-sm mt-1">Sends the current report snapshot on a schedule (demo scheduler).</div>
                  </div>
                  <button
                    onClick={() => setScheduleOpen(false)}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <AppIcon name="close" className="text-[22px]" size={22} />
                  </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Recipient Email</span>
                      <input
                        value={scheduleEmail}
                        onChange={(e) => setScheduleEmail(e.target.value)}
                        placeholder="owner@company.com"
                        type="email"
                        className="h-10 rounded-lg border border-border bg-background text-foreground px-3 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Frequency</span>
                      <select
                        value={scheduleFrequency}
                        onChange={(e) => setScheduleFrequency((e.target.value as any) || 'weekly')}
                        className="h-10 rounded-lg border border-border bg-background text-foreground px-3 text-sm focus:border-primary focus:outline-none"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                  </div>

                  <div className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
                    <div className="font-bold text-foreground">Scope</div>
                    <div className="mt-1">Location: <span className="text-foreground font-bold">{locationLabel}</span></div>
                    <div className="mt-1">Range: <span className="text-foreground font-bold">{rangeLabel}</span></div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <button
                    onClick={() => setScheduleOpen(false)}
                    className="h-10 px-4 rounded-lg bg-background border border-border text-foreground hover:bg-accent hover:border-primary/50"
                    disabled={scheduleLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitSchedule}
                    className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 disabled:opacity-60"
                    disabled={scheduleLoading}
                  >
                    {scheduleLoading ? 'Scheduling ' : 'Schedule'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 border-y border-border py-4 items-center">
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
                  className="group flex h-10 shrink-0 items-center justify-center gap-x-2 rounded-xl bg-background border border-border px-4 transition-colors hover:border-primary/50"
                  type="button"
                >
                  <AppIcon name="calendar_today" className="text-muted-foreground group-hover:text-foreground text-[18px]" size={18} />
                  <span className="text-muted-foreground group-hover:text-foreground text-sm font-medium">{rangeLabel}</span>
                  <AppIcon name="keyboard_arrow_down" className="text-muted-foreground group-hover:text-foreground text-[18px]" size={18} />
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
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Date Range</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button onClick={presetThisMonth} className="h-9 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-accent hover:border-primary/50" type="button">This Month</button>
                      <button onClick={presetLast30} className="h-9 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-accent hover:border-primary/50" type="button">Last 30</button>
                      <button onClick={presetThisYear} className="h-9 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-accent hover:border-primary/50" type="button">This Year</button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From</span>
                        <input
                          value={toDateInput(draftFromIso || fromIso)}
                          onChange={(e) => setDraftFromIso(fromDateInputStartIso(e.target.value))}
                          type="date"
                          className="h-9 rounded-lg border border-border bg-background text-foreground px-2 text-sm focus:border-primary focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To</span>
                        <input
                          value={toDateInput(draftToIso || toIso)}
                          onChange={(e) => setDraftToIso(fromDateInputEndIso(e.target.value))}
                          type="date"
                          className="h-9 rounded-lg border border-border bg-background text-foreground px-2 text-sm focus:border-primary focus:outline-none"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        onClick={() => {
                          setRangeOpen(false);
                          setRangeAnchor(null);
                        }}
                        className="h-9 px-3 rounded-lg bg-background border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
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
                        className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
                        type="button"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </PortalMenu>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-background border border-border px-4 h-10">
                <AppIcon name="storefront" className="text-muted-foreground text-[18px]" size={18} />
                <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Location</span>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="h-9 bg-transparent text-sm text-foreground focus:ring-0 border-none"
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
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 text-destructive p-4 flex items-center justify-between gap-4">
              <div className="text-sm">{error}</div>
              <button onClick={fetchAll} className="h-10 px-4 rounded-lg bg-background border border-border text-foreground hover:bg-accent hover:border-primary/50">
                Retry
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Total Revenue (Net)</p>
                <AppIcon name="payments" className="text-primary text-[18px]" size={18} />
              </div>
              <p className="text-foreground text-3xl font-black tracking-tight mt-2">{money.format(kpis.totalRevenueNet)}</p>
              <p className="text-xs text-muted-foreground mt-1">Location: {locationLabel}</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Transactions</p>
                <AppIcon name="receipt_long" className="text-muted-foreground text-[18px]" size={18} />
              </div>
              <p className="text-foreground text-3xl font-black tracking-tight mt-2">{Number(totals.txCount || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Paid orders in range</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Avg Ticket (Net)</p>
                <AppIcon name="query_stats" className="text-muted-foreground text-[18px]" size={18} />
              </div>
              <p className="text-foreground text-3xl font-black tracking-tight mt-2">{money.format(avgTicket)}</p>
              <p className="text-xs text-muted-foreground mt-1">Net sales / tx</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Top Sold Item</p>
                <AppIcon name="restaurant" className="text-muted-foreground text-[18px]" size={18} />
              </div>
              <p className="text-foreground text-lg font-black tracking-tight mt-2 truncate">{topSoldItem?.name || '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">{topSoldItem ? money.format(Number(topSoldItem.revenue || 0) || 0) : 'No sales yet'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-foreground text-lg font-bold">Revenue vs. Expenses Trend</p>
                    <p className="text-muted-foreground text-sm">Monthly comparison</p>
                  </div>
                </div>
                <div className="h-[240px] w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} opacity={0.5} />
                      <XAxis dataKey="name" stroke="hsl(var(--border))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis stroke="hsl(var(--border))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(v) => [money.format(Number(v) || 0), '']}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} fill="url(#revFill)" />
                      <Area type="monotone" dataKey="expenses" stroke="hsl(var(--muted-foreground))" strokeWidth={2} fillOpacity={0.1} fill="hsl(var(--muted-foreground))" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div>
                    <p className="text-foreground text-lg font-black">What's Sold (Top Items)</p>
                    <p className="text-muted-foreground text-sm">Based on paid orders in the selected range</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-[260px]">
                      <AppIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[18px]" size={18} />
                      <input
                        value={soldSearch}
                        onChange={(e) => setSoldSearch(e.target.value)}
                        className="w-full h-10 rounded-xl border border-border bg-background pl-10 pr-10 text-sm text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground"
                        placeholder="Search item or category"
                        type="text"
                      />
                      {soldSearch.trim() ? (
                        <button
                          onClick={() => setSoldSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                          type="button"
                          title="Clear"
                        >
                          <AppIcon name="close" className="text-[18px]" size={18} />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex items-center rounded-xl border border-border bg-background px-2 h-10">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-2">Top</span>
                      <select
                        value={soldLimit}
                        onChange={(e) => setSoldLimit((Number(e.target.value) as any) || 10)}
                        className="h-9 bg-transparent text-sm text-foreground focus:ring-0 border-none"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </div>

                    <div className="flex items-center rounded-xl border border-border bg-background p-1">
                      <button
                        onClick={() => setSoldSort('revenue')}
                        className={`h-8 px-3 rounded-lg text-xs font-black uppercase tracking-wider ${soldSort === 'revenue' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        type="button"
                      >
                        Revenue
                      </button>
                      <button
                        onClick={() => setSoldSort('qty')}
                        className={`h-8 px-3 rounded-lg text-xs font-black uppercase tracking-wider ${soldSort === 'qty' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        type="button"
                      >
                        Qty
                      </button>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Showing {Math.min(soldLimit, soldItemsSorted.length)} of {soldItemsSorted.length}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border bg-background">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-5 py-3">Item</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topSoldItems.length ? (
                        topSoldItems.map((it) => (
                          <tr key={it.productId} className="hover:bg-accent/50 transition-colors">
                            <td className="px-5 py-3 text-foreground font-bold whitespace-nowrap">{it.name}</td>
                            <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{it.category || 'Uncategorized'}</td>
                            <td className="px-5 py-3 text-right font-mono text-foreground">{Number(it.qty || 0).toLocaleString()}</td>
                            <td className="px-5 py-3 text-right font-bold text-primary">{money.format(Number(it.revenue || 0) || 0)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-5 py-10 text-muted-foreground" colSpan={4}>
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
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-foreground text-lg font-black">Action Center</p>
                    <p className="text-muted-foreground text-sm">Quick insights + exports</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Sold Revenue</div>
                    <div className="text-foreground font-black mt-1">{money.format(soldInsights.totalRevenue)}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Units Sold</div>
                    <div className="text-foreground font-black mt-1">{Number(soldInsights.totalQty || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Unique Items</div>
                    <div className="text-foreground font-black mt-1">{Number(soldInsights.uniqueItems || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Top Category</div>
                    <div className="text-foreground font-black mt-1 truncate" title={soldInsights.topCategoryName}>{soldInsights.topCategoryName}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">{soldInsights.topCategoryRevenue ? money.format(soldInsights.topCategoryRevenue) : '—'}</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-foreground font-black">Payments</div>
                      <div className="text-muted-foreground text-xs mt-0.5">Breakdown by method</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Top</div>
                      <div className="text-foreground font-black">{payments.primary?.name || '—'}</div>
                      <div className="text-muted-foreground text-xs">{payments.total ? `${payments.pct}%` : '—'}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-muted-foreground text-xs">Total collected (payments)</div>
                    <div className="text-primary font-black">{payments.total ? money.format(payments.total) : '—'}</div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {(payments.list || []).slice(0, 6).map((p) => (
                      <div key={p.name} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-foreground font-bold truncate">{p.name}</div>
                          <div className="text-muted-foreground text-[11px]">Tx: {Number(p.txCount || 0).toLocaleString()}</div>
                        </div>
                        <div className="text-foreground font-black whitespace-nowrap">{money.format(Number(p.amount || 0) || 0)}</div>
                      </div>
                    ))}

                    {!payments.list?.length ? (
                      <div className="text-muted-foreground text-sm">No payment method data yet.</div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={exportCsv}
                    className="h-11 rounded-xl bg-primary text-primary-foreground font-black text-sm hover:bg-primary/90 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <AppIcon name="table_view" className="text-[18px]" size={18} />
                    Export CSV
                  </button>
                  <button
                    onClick={() => void exportXlsx()}
                    className="h-11 rounded-xl bg-background border border-border text-foreground font-black text-sm hover:bg-accent hover:border-primary/50 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <AppIcon name="grid_on" className="text-[18px]" size={18} />
                    Export Excel
                  </button>
                  <button
                    onClick={exportSoldCsv}
                    className="h-11 rounded-xl bg-background border border-border text-foreground font-black text-sm hover:bg-accent hover:border-primary/50 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <AppIcon name="table_view" className="text-[18px]" size={18} />
                    Export Sold
                  </button>
                  <button
                    onClick={() => {
                      setBanner(null);
                      setScheduleOpen(true);
                    }}
                    className="h-11 rounded-xl bg-background border border-border text-foreground font-black text-sm hover:bg-accent hover:border-primary/50 flex items-center justify-center gap-2 col-span-2"
                    type="button"
                  >
                    <AppIcon name="schedule_send" className="text-[18px]" size={18} />
                    Schedule
                  </button>
                </div>
              </div>

            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all h-full overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-foreground text-lg font-bold">Revenue Summary</p>
                  <p className="text-muted-foreground text-sm truncate" title={`${rangeLabel} • ${locationLabel}`}>{rangeLabel} • {locationLabel}</p>
                </div>
                <div className="shrink-0 size-10 rounded-xl border border-border bg-background flex items-center justify-center">
                  <AppIcon name="monitoring" className="text-primary text-[20px]" size={20} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Total Collected</div>
                <div className="mt-1 text-foreground font-black text-2xl md:text-3xl tracking-tight font-mono">{money.format(Number(totals.totalCollected || 0) || 0)}</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Net Sales</div>
                    <div className="text-foreground font-black text-sm font-mono truncate">{money.format(Number(totals.netSales || 0) || 0)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Tax</div>
                    <div className="text-foreground font-black text-sm font-mono truncate">{money.format(Number(totals.tax || 0) || 0)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Tips</div>
                    <div className="text-foreground font-black text-sm font-mono truncate">{money.format(Number(totals.tips || 0) || 0)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold text-destructive">Discounts</div>
                    <div className="text-destructive font-black text-sm font-mono truncate">-{money.format(Math.abs(Number(totals.discounts || 0) || 0))}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all h-full overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider font-bold">What's Sold (Categories)</div>
                  <div className="text-foreground font-black mt-1">Top mix share</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Total</div>
                  <div className="text-foreground font-black">{money.format(Number(donut.total || 0) || 0)}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex items-center justify-center">
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
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                        >
                          {donut.list.map((_, idx) => (
                            <Cell key={idx} fill={donutColors[idx % donutColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                          formatter={(v, n) => [money.format(Number(v) || 0), String(n)]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 m-auto size-28 rounded-full bg-background border border-border flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-foreground">{donut.pct}%</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-widest truncate max-w-[92px]" title={donut.primary.name}>{donut.primary.name}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 min-w-0">
                  {donut.list.length ? (
                    donut.list.slice(0, 4).map((x, idx) => {
                      const pct = donut.total > 0 ? Math.round(((Number(x.value) || 0) / donut.total) * 100) : 0;
                      return (
                        <div key={x.name} className="rounded-xl border border-border bg-background px-4 py-3 min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: donutColors[idx % donutColors.length] }} />
                              <div className="text-foreground font-bold truncate" title={x.name}>{x.name}</div>
                            </div>
                            <div className="text-muted-foreground text-xs font-bold whitespace-nowrap">{pct}%</div>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 min-w-0">
                            <div className="text-muted-foreground text-xs whitespace-nowrap">Revenue</div>
                            <div className="text-primary font-black whitespace-nowrap truncate">{money.format(Number(x.value || 0) || 0)}</div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-muted-foreground text-sm">No category sales yet.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all h-full overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-foreground font-black">Top Categories</div>
                  <div className="text-muted-foreground text-sm mt-1">By revenue</div>
                </div>
                <div className="shrink-0 size-10 rounded-xl border border-border bg-background flex items-center justify-center">
                  <AppIcon name="leaderboard" className="text-primary text-[20px]" size={20} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3">
                {(Array.isArray(soldCategories) ? soldCategories : []).slice(0, 6).map((c, idx) => {
                  const revenue = Number((c as any).revenue || 0) || 0;
                  const pct = maxSoldCategoryRevenue > 0 ? Math.round((revenue / maxSoldCategoryRevenue) * 100) : 0;
                  return (
                    <div key={c.name} className="rounded-xl border border-border bg-background px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="size-8 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground font-black">{idx + 1}</div>
                          <div className="min-w-0">
                            <div className="text-foreground font-bold truncate">{c.name || 'Uncategorized'}</div>
                            <div className="text-muted-foreground text-xs">Qty: {Number(c.qty || 0).toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="text-primary font-black whitespace-nowrap">{money.format(revenue)}</div>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-muted border border-border overflow-hidden">
                        <div className="h-full bg-primary/90" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {!soldCategories.length ? <div className="text-muted-foreground text-sm">No category sales yet.</div> : null}
              </div>
            </div>
          </div>

          {!locationId ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-foreground text-lg font-bold">All Locations Command Center</p>
                  <p className="text-muted-foreground text-sm">Branch ranking + executive insights for the selected range</p>
                </div>
                <div className="text-xs text-muted-foreground">Sorted by Net Sales</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">Top Branch</div>
                  <div className="text-foreground text-lg font-black mt-1">{topBranch?.name || '—'}</div>
                  <div className="text-muted-foreground text-sm mt-1">{topBranch ? money.format(topBranch.netSales) : '—'}</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">Avg Ticket (Net)</div>
                  <div className="text-foreground text-lg font-black mt-1">{money.format(avgTicket)}</div>
                  <div className="text-muted-foreground text-sm mt-1">{totals.txCount} transactions</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider">Top Category (Sold)</div>
                  <div className="text-foreground text-lg font-black mt-1">{topCategory?.name || '—'}</div>
                  <div className="text-muted-foreground text-sm mt-1">{topCategory ? money.format(Number((topCategory as any).revenue || 0) || 0) : '—'}</div>
                </div>
              </div>

              {branchBreakdown.length ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm text-muted-foreground">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                      <tr>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Branch</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Status</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-center">Tx</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Net Sales</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Tax</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right">Tips</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right text-destructive">Discounts</th>
                        <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider text-right text-foreground">Total Collected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      {branchBreakdown.map((b, idx) => (
                        <tr key={b.branchId} className={idx % 2 === 1 ? 'bg-muted/20 hover:bg-accent/50 transition-colors' : 'hover:bg-accent/50 transition-colors'}>
                          <td className="whitespace-nowrap px-5 py-3 text-foreground font-bold">{b.name}</td>
                          <td className="whitespace-nowrap px-5 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold border ${b.status === 'Open'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border-emerald-500/20'
                                  : b.status === 'Closed'
                                    ? 'bg-destructive/10 text-destructive border-destructive/20'
                                    : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-center">{b.txCount}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-foreground font-bold">{money.format(b.netSales)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right">{money.format(b.tax)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right">{money.format(b.tips)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-destructive">-{money.format(Math.abs(b.discounts))}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-black text-primary">{money.format(b.totalCollected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
                  No branch payment data found for this range. Create a few orders/payments in different branches to populate the All Locations ranking.
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center border-b border-border bg-muted/20 px-4 pt-4">
              <button
                onClick={() => setTab('ledger')}
                className={`mr-4 pb-4 ${tab === 'ledger' ? 'border-b-2 border-primary text-foreground font-bold' : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm px-2`}
              >
                Daily Sales Ledger
              </button>
              <button
                onClick={() => setTab('mix')}
                className={`mr-4 pb-4 ${tab === 'mix' ? 'border-b-2 border-primary text-foreground font-bold' : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm px-2`}
              >
                Product Mix
              </button>
              <button
                onClick={() => setTab('void')}
                className={`mr-4 pb-4 ${tab === 'void' ? 'border-b-2 border-primary text-foreground font-bold' : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm px-2`}
              >
                Void / Comp Log
              </button>
              <button
                onClick={() => setTab('labor')}
                className={`mr-4 pb-4 ${tab === 'labor' ? 'border-b-2 border-primary text-foreground font-bold' : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm px-2`}
              >
                Labor Analysis
              </button>
              <div className="ml-auto pb-3">
                <button className="flex items-center gap-1 text-xs text-primary font-bold uppercase tracking-wide hover:underline">
                  <AppIcon name="tune" className="text-[16px]" size={16} />
                  Customize Columns
                </button>
              </div>
            </div>

            {tab === 'ledger' ? (
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="relative max-w-sm w-full">
                  <AppIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[20px]" size={20} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                    placeholder="Search transactions (by date)..."
                    type="text"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Showing {pageRows.length} of {filteredLedger.length} rows</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                      disabled={safePage <= 1}
                    >
                      <AppIcon name="chevron_left" className="text-[20px]" size={20} />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="p-1 rounded hover:bg-accent text-foreground disabled:opacity-50"
                      disabled={safePage >= totalPages}
                    >
                      <AppIcon name="chevron_right" className="text-[20px]" size={20} />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              {tab === 'ledger' ? (
                <table className="w-full text-left text-sm text-muted-foreground">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                    <tr>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Date</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-center">Trans. Count</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Net Sales</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Tax</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right">Tips</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right text-destructive">Discounts</th>
                      <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider text-right text-foreground">Total Collected</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-medium">
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
                        <tr key={r.date} className={idx % 2 === 1 ? 'bg-muted/20 hover:bg-accent/50 transition-colors' : 'hover:bg-accent/50 transition-colors'}>
                          <td className="whitespace-nowrap px-6 py-4 text-foreground">{fmtDate(r.date)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-center">{r.txCount}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.netSales)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.tax)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">{money.format(r.tips)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-destructive">-{money.format(Math.abs(r.discounts))}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right font-bold text-foreground">{money.format(r.totalCollected)}</td>
                          <td className="px-4 py-4 text-right">
                            <button className="text-muted-foreground hover:text-primary">
                              <AppIcon name="more_vert" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="bg-muted/50 border-t-2 border-border">
                    <tr>
                      <td className="px-6 py-4 font-bold text-foreground uppercase">Totals</td>
                      <td className="px-6 py-4 text-center font-bold text-foreground">{totals.txCount}</td>
                      <td className="px-6 py-4 text-right font-bold text-foreground">{money.format(totals.netSales)}</td>
                      <td className="px-6 py-4 text-right font-bold text-foreground">{money.format(totals.tax)}</td>
                      <td className="px-6 py-4 text-right font-bold text-foreground">{money.format(totals.tips)}</td>
                      <td className="px-6 py-4 text-right font-bold text-destructive">-{money.format(Math.abs(totals.discounts))}</td>
                      <td className="px-6 py-4 text-right font-bold text-primary text-base">{money.format(totals.totalCollected)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              ) : tab === 'mix' ? (
                <div className="p-6 text-sm">
                  <div className="text-foreground font-bold">Product Mix (by Sold Categories)</div>
                  <div className="text-muted-foreground mt-1">Derived from paid orders (order payload items).</div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {soldCategories.length ? (
                      soldCategories.slice(0, 8).map((c) => (
                        <div key={c.name} className="rounded-lg border border-border bg-background p-4 flex items-center justify-between">
                          <div className="text-foreground font-semibold">{c.name}</div>
                          <div className="text-primary font-black">{money.format(Number(c.revenue || 0) || 0)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-muted-foreground">No category data yet.</div>
                    )}
                  </div>
                </div>
              ) : tab === 'labor' ? (
                <div className="p-6 text-sm">
                  <div className="text-foreground font-bold">Labor Analysis</div>
                  <div className="text-muted-foreground mt-1">Shift activity is tracked from real clock-in/clock-out logs.</div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Net Revenue</div>
                      <div className="text-foreground text-xl font-black mt-1">{money.format(kpis.totalRevenueNet)}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Shift Hours</div>
                      <div className="text-foreground text-xl font-black mt-1">{(shift?.totalHours ?? 0).toFixed(2)} h</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Shifts</div>
                      <div className="text-foreground text-xl font-black mt-1">{shift?.shifts ?? 0}</div>
                    </div>
                  </div>

                  {shift ? (
                    <div className="mt-6 rounded-xl border border-border overflow-hidden">
                      <div className="px-5 py-4 bg-muted/50 border-b border-border flex items-center justify-between">
                        <div className="text-foreground font-extrabold">Staff Shift Activity</div>
                        <div className="text-[11px] text-muted-foreground">Open shifts: {shift.openShifts}</div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-muted-foreground">
                          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                            <tr>
                              <th className="px-5 py-3">Staff</th>
                              <th className="px-5 py-3">Role</th>
                              <th className="px-5 py-3 text-right">Hours</th>
                              <th className="px-5 py-3 text-right">Shifts</th>
                              <th className="px-5 py-3 text-right">Open</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {Array.isArray(shift.staff) && shift.staff.length ? (
                              shift.staff.slice(0, 50).map((r) => (
                                <tr key={r.staffId} className="hover:bg-accent/50 transition-colors">
                                  <td className="px-5 py-3 text-foreground font-bold whitespace-nowrap">{r.name}</td>
                                  <td className="px-5 py-3 whitespace-nowrap">{r.roleName || '—'}</td>
                                  <td className="px-5 py-3 text-right font-mono">{Number(r.hours || 0).toFixed(2)}</td>
                                  <td className="px-5 py-3 text-right font-mono">{r.shifts}</td>
                                  <td className="px-5 py-3 text-right font-mono">{r.openShifts}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-5 py-6 text-muted-foreground" colSpan={5}>
                                  No shift activity in this date range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 text-muted-foreground">No shift activity data available.</div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">No void/comp events recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
