import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { updateSession, readSession } from '../../session';
import { InitializePosModal } from '../../components/InitializePosModal';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { FiscalSettingsModal } from '../../components/FiscalSettingsModal';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDeviceTime } from '../../datetime';
import {
  downloadCSV,
  escapeCSV,
  formatCurrency,
  generateReportHeader,
  generateSectionHeader,
} from '../../utils/exportUtils';

import { AppIcon } from '@/components/ui/app-icon';
export const OwnerDashboard: React.FC = () => {
  const [currency, setCurrency] = useState('ETB');
  const [range, setRange] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [fiscalConfig, setFiscalConfig] = useState<{ id: string; name: string } | null>(null);


  const fmtMoney = useCallback(
    (n: number) => {
      const v = Number.isFinite(n) ? n : 0;
      return v.toLocaleString(undefined, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },
    [currency],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posInitOpen, setPosInitOpen] = useState(false);
  const [posEmpty, setPosEmpty] = useState<boolean | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(() => {
    try {
      const v = localStorage.getItem('mirachpos.owner.selectedBranchId.v1');
      return v && v.trim() ? v.trim() : null;
    } catch {
      return null;
    }
  });
  const [overview, setOverview] = useState<null | {
    kpis: {
      totalRevenueMonth: number;
      revenueDeltaPct?: number;
      activeBranches: number;
      totalBranches: number;
      totalOrders: number;
      ordersDeltaPct?: number;
      netProfit: number;
      netProfitDeltaPct?: number;
    };
    branches: Array<{
      id: string;
      name: string;
      manager: string;
      revenueToday: number;
      ordersToday: number;
      rating: number;
      status: 'Open' | 'Closed';
    }>;
    alerts: Array<{ title: string; detail: string; severity: 'Critical' | 'Warning'; icon: string }>;
    health: Array<{ label: string; value: string; status: 'Good' | 'Warn' | 'Bad' }>;
  }>(null);
  const [selectedBranchName, setSelectedBranchName] = useState<string>('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  const [trend, setTrend] = useState<Array<{ key: string; revenue: number; orders: number }>>([]);

  const [tableQuery, setTableQuery] = useState('');
  const [tableStatus, setTableStatus] = useState<'All' | 'Open' | 'Closed'>('All');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const clearBranchSelection = useCallback(() => {
    try {
      localStorage.removeItem('mirachpos.owner.selectedBranchId.v1');
    } catch {
      // ignore
    }
    setSelectedBranchId(null);
    setSelectedBranchName('');
  }, []);

  const focusBranch = useCallback(
    (branchId: string, branchName?: string) => {
      const id = String(branchId || '').trim();
      if (!id) return;
      try {
        localStorage.setItem('mirachpos.owner.selectedBranchId.v1', id);
      } catch {
        // ignore
      }
      setSelectedBranchId(id);
      setSelectedBranchName(String(branchName || id));
    },
    [],
  );

  const goToBranchSelect = useCallback(() => {
    try {
      updateSession({ screen: 'BRANCH_SELECT' });
    } catch {
      // ignore
    }
    window.location.reload();
  }, []);

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bid = selectedBranchId;

      // Fetch Currency Settings
      try {
        const settingsRes = await apiFetch('/api/pos/settings');
        if (settingsRes.ok) {
          const s = await settingsRes.json();
          if (s?.general?.currency) setCurrency(s.general.currency);
        }
      } catch {
        // ignore
      }

      let branchesList: Array<{ id: string; name: string }> = [];
      try {
        const br = await apiFetch('/api/branches');
        if (br.ok) {
          const bdata = (await br.json()) as { branches: Array<{ id: string; name: string }> };
          branchesList = Array.isArray(bdata.branches) ? bdata.branches : [];
        }
      } catch {
        // ignore
      }

      let effectiveBranchId: string | null = bid;
      if (bid) {
        const found = branchesList.find((x) => x.id === bid) || null;
        if (!found) {
          try {
            localStorage.removeItem('mirachpos.owner.selectedBranchId.v1');
          } catch {
            // ignore
          }
          setSelectedBranchId(null);
          effectiveBranchId = null;
          setSelectedBranchName('All Locations');
        } else {
          setSelectedBranchName(found.name || '');
        }
      } else {
        setSelectedBranchName('All Locations');
      }

      const res = await apiFetch(effectiveBranchId ? `/api/owner/overview?branchId=${encodeURIComponent(effectiveBranchId)}` : '/api/owner/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as any;
      const normalized = {
        kpis: {
          totalRevenueMonth: Number(raw?.kpis?.totalRevenueMonth ?? 0) || 0,
          activeBranches: Number(raw?.kpis?.activeBranches ?? 0) || 0,
          totalBranches: Number(raw?.kpis?.totalBranches ?? 0) || 0,
          totalOrders: Number(raw?.kpis?.totalOrders ?? 0) || 0,
          netProfit: Number(raw?.kpis?.netProfit ?? 0) || 0,
        },
        branches: Array.isArray(raw?.branches)
          ? raw.branches.map((b: any) => ({
            id: String(b?.id || ''),
            name: String(b?.name || ''),
            manager: String(b?.manager || ''),
            revenueToday: Number(b?.revenueToday ?? 0) || 0,
            ordersToday: Number(b?.ordersToday ?? 0) || 0,
            rating: Number(b?.rating ?? 0) || 0,
            status: b?.status === 'Closed' ? 'Closed' : 'Open',
          }))
          : [],
        alerts: Array.isArray(raw?.alerts)
          ? raw.alerts.map((a: any) => ({
            title: String(a?.title || ''),
            detail: String(a?.detail || ''),
            severity: a?.severity === 'Critical' ? 'Critical' : 'Warning',
            icon: String(a?.icon || 'warning'),
          }))
          : [],
        health: Array.isArray(raw?.health)
          ? raw.health.map((h: any) => ({
            label: String(h?.label || ''),
            value: String(h?.value || ''),
            status: h?.status === 'Bad' ? 'Bad' : h?.status === 'Warn' ? 'Warn' : 'Good',
          }))
          : [],
      } as typeof overview;
      setOverview(normalized);

      try {
        const params = new URLSearchParams();
        params.set('range', range);
        if (effectiveBranchId) params.set('branchId', effectiveBranchId);
        const trRes = await apiFetch(`/api/owner/overview?${params.toString()}`);
        const trJson = (await trRes.json().catch(() => null)) as any;
        const rows = Array.isArray(trJson?.trend) ? (trJson.trend as any[]) : [];
        if (trRes.ok) {
          setTrend(
            rows
              .map((x) => ({
                key: String(x?.key || ''),
                revenue: Number(x?.revenue ?? 0) || 0,
                orders: Number(x?.orders ?? 0) || 0,
              }))
              .filter((x) => x.key),
          );
        } else {
          setTrend([]);
        }
      } catch {
        setTrend([]);
      }

      setLastUpdatedAt(formatDeviceTime(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

      try {
        const posRes = await apiFetch(effectiveBranchId ? `/api/pos/tables?branchId=${encodeURIComponent(effectiveBranchId)}` : '/api/pos/tables');
        const posJson = (await posRes.json().catch(() => null)) as any;
        if (posRes.ok) {
          const tables = Array.isArray(posJson?.tables) ? posJson.tables : [];
          setPosEmpty(tables.length === 0);
        } else {
          setPosEmpty(null);
        }
      } catch {
        setPosEmpty(null);
      }
    } catch {
      setError('Start the API server (npm run dev:api).');
      setOverview(null);
      setPosEmpty(null);
    } finally {
      setLoading(false);
    }
  }, [range, selectedBranchId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await refreshOverview();
    };
    run();
    const id = window.setInterval(run, 15000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [refreshOverview]);

  const data =
    overview ??
    ({
      kpis: {
        totalRevenueMonth: 0,
        revenueDeltaPct: 0,
        activeBranches: 0,
        totalBranches: 0,
        totalOrders: 0,
        ordersDeltaPct: 0,
        netProfit: 0,
        netProfitDeltaPct: 0,
      },
      branches: [],
      alerts: [],
      health: [],
    } as any);
  const safeAlerts = Array.isArray((overview as any)?.alerts) ? ((overview as any).alerts as any[]) : [];
  const safeBranches = Array.isArray((overview as any)?.branches) ? ((overview as any).branches as any[]) : [];

  const alertsCount = safeAlerts.length;
  const filteredRows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    return safeBranches.filter((b) => {
      const statusOk = tableStatus === 'All' ? true : b.status === tableStatus;
      const qOk = !q ? true : b.name.toLowerCase().includes(q) || b.manager.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
      return statusOk && qOk;
    });
  }, [safeBranches, tableQuery, tableStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage]);

  useEffect(() => {
    setPage(1);
  }, [tableQuery, tableStatus, selectedBranchId]);

  const exportCsv = () => {
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
      businessName: 'MirachPOS',
      branchName: selectedBranchId ? (selectedBranchName || selectedBranchId) : 'All Locations',
      reportTitle: 'Branch Performance Report',
      fromDate: new Date().toISOString(),
      toDate: new Date().toISOString(),
      generatedBy: generatedBy || undefined,
    });
    lines.push(...headerLines);

    // Branch Performance Table
    lines.push(...generateSectionHeader('Branch Performance'));
    lines.push([
      escapeCSV('Branch ID'),
      escapeCSV('Branch Name'),
      escapeCSV('Manager'),
      escapeCSV("Today's Revenue"),
      escapeCSV('Orders Today'),
      escapeCSV('Status'),
    ].join(','));

    for (const r of filteredRows) {
      lines.push([
        escapeCSV(r.id),
        escapeCSV(r.name),
        escapeCSV(r.manager),
        escapeCSV(formatCurrency(r.revenueToday)),
        escapeCSV(String(r.ordersToday)),
        escapeCSV(r.status),
      ].join(','));
    }

    // Footer
    lines.push('');
    lines.push(escapeCSV('Powered by MirachPOS'));

    const safeBranch = (selectedBranchId || 'all_locations').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const filename = `branch_performance_${safeBranch}_${new Date().toISOString().slice(0, 10)}`;
    downloadCSV(lines.join('\n'), filename);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <InitializePosModal
        open={posInitOpen}
        onClose={() => setPosInitOpen(false)}
        onInitialized={() => {
          setPosEmpty(false);
          refreshOverview();
        }}
      />
      <OwnerPageHeader
        title="Overview"
        leftSlot={
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-muted text-foreground">{selectedBranchName || selectedBranchId || 'All Locations'}</span>
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-muted rounded-lg h-10 w-64 px-3 gap-2">
              <AppIcon name="search" className="text-muted-foreground text-[20px]" size={20} />
              <input
                value={tableQuery}
                onChange={(e) => setTableQuery(e.target.value)}
                className="bg-transparent border-none text-sm text-foreground placeholder:text-muted-foreground focus:ring-0 w-full p-0"
                placeholder="Search branches "
                type="text"
              />
            </div>
            <button className="relative text-muted-foreground hover:text-foreground transition-colors" onClick={() => setTableStatus('All')} type="button">
              <AppIcon name="notifications" />
              {alertsCount > 0 ? <span className="absolute top-0 right-0 size-2 bg-destructive rounded-full border-2 border-background"></span> : null}
            </button>
            <button
              onClick={refreshOverview}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-muted text-foreground rounded-lg text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              <AppIcon name="refresh" className="text-[20px]" size={20} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={goToBranchSelect}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-md"
              type="button"
            >
              <AppIcon name="swap_horiz" />
            </button>
            {selectedBranchId ? (
              <button
                onClick={clearBranchSelection}
                className="hidden lg:flex items-center justify-center gap-2 h-10 px-4 bg-muted text-foreground rounded-lg text-sm font-bold hover:bg-accent transition-colors"
                type="button"
              >
                <AppIcon name="public" />
              </button>
            ) : null}
            {posEmpty === true ? (
              <button
                type="button"
                onClick={() => setPosInitOpen(true)}
                className="hidden lg:flex items-center justify-center gap-2 h-10 px-4 bg-card border border-border text-primary rounded-lg text-sm font-black hover:bg-accent transition-colors"
              >
                <AppIcon name="build" className="text-[20px]" size={20} />
                <span className="hidden sm:inline">Initialize POS</span>
              </button>
            ) : null}
          </div>
        }
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!loading && !error && (!overview || safeBranches.length === 0) ? (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No branches yet for this workspace. Create your first branch in <span className="font-bold text-foreground">Branch Management</span>.
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">{lastUpdatedAt ? `Last updated: ${lastUpdatedAt}` : null}</div>
            {loading ? <div className="text-xs text-muted-foreground">Loading </div> : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-muted rounded-lg text-primary">
                  <AppIcon name="attach_money" />
                </div>
                <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-500 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <AppIcon name="trending_up" className="text-[14px]" size={14} />
                  {Math.round(Number((data.kpis as any).revenueDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-muted-foreground text-sm font-medium">Total Revenue (Month)</p>
                <p className="text-foreground text-2xl font-bold tracking-tight mt-1">{fmtMoney(data.kpis.totalRevenueMonth)}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-muted rounded-lg text-foreground">
                  <AppIcon name="store" />
                </div>
{data.kpis.activeBranches > 0 && (
                <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-500 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <AppIcon name="check_circle" className="text-[14px]" size={14} />
                  Live
                </span>
                )}
              </div>
              <div className="mt-3">
                <p className="text-muted-foreground text-sm font-medium">Active Branches</p>
                <p className="text-foreground text-2xl font-bold tracking-tight mt-1">
                  {data.kpis.activeBranches} <span className="text-muted-foreground text-base font-normal">/ {data.kpis.totalBranches}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-muted rounded-lg text-foreground">
                  <AppIcon name="receipt_long" />
                </div>
                <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-500 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <AppIcon name="trending_up" className="text-[14px]" size={14} />
                  {Math.round(Number((data.kpis as any).ordersDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-muted-foreground text-sm font-medium">Total Orders</p>
                <p className="text-foreground text-2xl font-bold tracking-tight mt-1">{data.kpis.totalOrders.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-muted rounded-lg text-foreground">
                  <AppIcon name="account_balance_wallet" />
                </div>
                <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-500 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <AppIcon name="trending_up" className="text-[14px]" size={14} />
                  {Math.round(Number((data.kpis as any).netProfitDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-muted-foreground text-sm font-medium">Net Profit</p>
                <p className="text-foreground text-2xl font-bold tracking-tight mt-1">{fmtMoney(data.kpis.netProfit)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Revenue Analytics</h3>
                  <p className="text-muted-foreground text-sm">Comparison across all branches</p>
                </div>
                <div className="flex bg-muted rounded-lg p-1">
                  {(['Daily', 'Weekly', 'Monthly'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${range === r ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {trend.length === 0 ? (
                <div className="h-64 w-full rounded-lg border border-dashed border-border bg-muted flex items-center justify-center px-6 text-center">
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-bold text-foreground">No revenue history yet</div>
                    <div className="text-xs text-muted-foreground">
                      This chart will populate automatically after orders are recorded.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="key" stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--primary))' }}
                      />
                      <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 shadow-lg flex-1">
                <h3 className="text-foreground text-base font-bold mb-4 flex items-center gap-2">
                  <AppIcon name="dns" className="text-primary" /> System Health
                </h3>
                <div className="flex flex-col gap-4">
                  {data.health.map((h) => {
                    const dot = h.status === 'Good' ? 'bg-emerald-500' : h.status === 'Warn' ? 'bg-primary' : 'bg-destructive';
                    const val = h.status === 'Good' ? 'text-emerald-600 dark:text-emerald-500' : h.status === 'Warn' ? 'text-muted-foreground' : 'text-destructive';
                    return (
                      <div key={h.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`size-2 rounded-full shrink-0 ${dot}`}></div>
                          <span className="text-xs text-foreground font-medium">{h.label}</span>
                        </div>
                        <span className={`text-xs font-mono ${val}`}>{h.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-lg flex-1">
                <h3 className="text-foreground text-base font-bold mb-4 flex items-center gap-2">
                  <AppIcon name="warning" className="text-destructive" /> Critical Alerts
                </h3>
                <div className="flex flex-col gap-3">
                  {data.alerts.map((a) => (
                    <div
                      key={a.title}
                      className={`p-3 rounded-lg bg-muted/50 border flex items-start gap-3 ${a.severity === 'Critical' ? 'border-destructive/30' : 'border-primary/30'
                        }`}
                    >
                      <AppIcon
                        name={a.icon}
                        className={`text-lg shrink-0 mt-0.5 ${a.severity === 'Critical' ? 'text-destructive' : 'text-primary'}`}
                        size={18}
                      />
                      <div>
                        <p className="text-foreground text-xs font-bold">{a.title}</p>
                        <p className="text-muted-foreground text-[11px] mt-0.5">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg mb-8">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-foreground text-lg font-bold">Branch Performance</h3>
                <p className="text-muted-foreground text-sm">Real-time data from all locations</p>
              </div>
              <div className="flex gap-3">
                <div className="hidden md:flex items-center bg-muted rounded-lg h-10 w-64 px-3 gap-2">
                  <AppIcon name="search" className="text-muted-foreground text-[20px]" size={20} />
                  <input
                    value={tableQuery}
                    onChange={(e) => setTableQuery(e.target.value)}
                    className="bg-transparent border-none text-sm text-foreground placeholder:text-muted-foreground focus:ring-0 w-full p-0"
                    placeholder="Search in table "
                    type="text"
                  />
                </div>
                <select
                  value={tableStatus}
                  onChange={(e) => setTableStatus(e.target.value as 'All' | 'Open' | 'Closed')}
                  className="h-10 px-3 rounded-lg border border-border bg-background text-muted-foreground text-sm hover:text-foreground"
                >
                  <option value="All">All</option>
                  <option value="Open">Open</option>
                  <option value="Closed">Closed</option>
                </select>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:text-foreground hover:bg-accent transition-colors"
                >
                  <AppIcon name="download" className="text-[18px]" size={18} />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-medium">Branch Name</th>
                    <th className="px-6 py-4 font-medium">Manager</th>
                    <th className="px-6 py-4 font-medium text-right">Today's Revenue</th>
                    <th className="px-6 py-4 font-medium text-right">Orders</th>
                    <th className="px-6 py-4 font-medium text-center">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-sm">
                  {pageRows.map((b) => (
                    <tr key={b.id} className="hover:bg-accent/50 transition-colors group">
                      <td className="px-6 py-4 text-foreground font-medium">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded bg-muted flex items-center justify-center text-primary font-bold">{b.name.slice(0, 1).toUpperCase()}</div>
                          <span>{b.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">{b.manager}</td>
                      <td className="px-6 py-4 text-foreground text-right font-medium">{fmtMoney(b.revenueToday)}</td>
                      <td className="px-6 py-4 text-muted-foreground text-right">{b.ordersToday}</td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-bold ${b.status === 'Open' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-500' : 'bg-destructive/15 text-destructive'
                            }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => setFiscalConfig({ id: b.id, name: b.name })}
                            className="size-8 rounded hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                            title="Fiscal Settings"
                          >
                            <AppIcon name="settings" />
                          </button>
                          <button
                            type="button"
                            onClick={() => focusBranch(b.id, b.name)}
                            className="size-8 rounded hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                            title="View Dashboard"
                          >
                            <AppIcon name="visibility" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <p className="text-muted-foreground text-xs">Showing {pageRows.length} of {filteredRows.length} branches</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="size-8 flex items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                  disabled={safePage <= 1}
                >
                  <AppIcon name="chevron_left" />
                </button>
                <button className="size-8 flex items-center justify-center rounded bg-primary text-primary-foreground font-bold">{safePage}</button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="size-8 flex items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                  disabled={safePage >= totalPages}
                >
                  <AppIcon name="chevron_right" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {fiscalConfig && (
        <FiscalSettingsModal
          branchId={fiscalConfig.id}
          branchName={fiscalConfig.name}
          isOpen={true}
          onClose={() => setFiscalConfig(null)}
        />
      )}
    </div>
  );
};
