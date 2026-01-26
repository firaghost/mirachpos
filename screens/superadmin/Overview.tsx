import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceDateTime } from '../../datetime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/components/lib/utils';

type Range = '30d' | '7d' | '24h';

type OverviewPayload = {
  ok: boolean;
  overview?: {
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    trialTenants: number;
    totalBranches: number;
    totalUsers: number;
    ordersLast30d: number;
    ordersToday?: number;
    ordersMonth?: number;
    orderTotalLast30dEtb: number;
    avgTicketEtb?: number;
    mrrEtb: number;
    syncHealth?: { syncingBranches: number; windowMinutes: number };
    lastSyncAt?: string;
    databaseStatus?: string;
    trends?: { tenantsPct?: number; ordersPct?: number; revenuePct?: number };
    syncConflictsPending?: number;
    errorRate5xx?: number;
    errorRateDelta?: number;
    errorSparkline?: number[];
    alertsNewCount?: number;
  };
  revenueByMonth?: Array<{ month: string; totalEtb: number }>;
  tenantGrowth?: Array<{ month: string; newTenants: number }>;
  tenantChurn?: Array<{ month: string; churnedTenants: number }>;
  alerts?: Array<{ id: string; severity: string; message: string; status: string; createdAt: string }>;
};

export const SA_Overview: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<OverviewPayload | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/overview?range=${encodeURIComponent(range)}`);
      const json = await res.json();
      if (!res.ok) throw new Error('Global uplink failed');
      setData(json);
    } catch (e) {
      setError('Supernode connection lost');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const fmtInt = (n: number) => new Intl.NumberFormat(undefined).format(Number(n || 0));
  const fmtEtb = (n: number) => `ETB ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n || 0))}`;
  const fmtCompact = (n: number) =>
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(Number(n || 0));

  const overview = data?.overview;
  const totalTenants = Number(overview?.totalTenants || 0);
  const activeTenants = Number(overview?.activeTenants || 0);
  const trialTenants = Number(overview?.trialTenants || 0);
  const suspendedTenants = Number(overview?.suspendedTenants || 0);
  const totalBranches = Number(overview?.totalBranches || 0);
  const ordersToday = Number(overview?.ordersToday || 0);
  const ordersMonth = Number(overview?.ordersMonth || overview?.ordersLast30d || 0);
  const orderTotalEtb = Number(overview?.orderTotalLast30dEtb || 0);
  const avgTicketEtb = Number(overview?.avgTicketEtb || 0);
  const mrrEtb = Number(overview?.mrrEtb || 0);
  const syncingBranches = Number(overview?.syncHealth?.syncingBranches || 0);
  const lastSyncAt = overview?.lastSyncAt || '';
  const databaseStatus = String(overview?.databaseStatus || 'unknown');
  const syncConflictsPending = Number(overview?.syncConflictsPending || 0);
  const errorRate5xx = Number(overview?.errorRate5xx || 0);
  const errorRateDelta = Number(overview?.errorRateDelta || 0);
  const errorSparkline = Array.isArray(overview?.errorSparkline) ? overview!.errorSparkline! : [];
  const alertsNewCount = Number(overview?.alertsNewCount || 0);
  const trends = overview?.trends || {};

  const errorStatus = (() => {
    const r = errorRate5xx;
    if (r <= 0.01) return { label: 'Normal', cls: 'text-emerald-500' };
    if (r <= 0.03) return { label: 'Elevated', cls: 'text-primary' };
    return { label: 'Critical', cls: 'text-destructive' };
  })();

  const monthShort = (ym: string) => {
    const s = String(ym || '');
    const d = new Date(`${s}-01T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return s.slice(5);
    return formatDeviceDateTime(d, { month: 'short' }) || s.slice(5);
  };

  const revenue = Array.isArray(data?.revenueByMonth) ? data!.revenueByMonth! : [];
  const growth = Array.isArray(data?.tenantGrowth) ? data!.tenantGrowth! : [];
  const churn = Array.isArray(data?.tenantChurn) ? data!.tenantChurn! : [];
  const alerts = Array.isArray(data?.alerts) ? data!.alerts! : [];

  const revMax = Math.max(1, ...revenue.map((x) => Number(x.totalEtb || 0)));

  const relTime = (iso: string) => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const d = Math.max(0, Date.now() - t);
    if (d < 60 * 1000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 60 * 60 * 1000) return `${Math.floor(d / (60 * 1000))}m ago`;
    if (d < 24 * 60 * 60 * 1000) return `${Math.floor(d / (60 * 60 * 1000))}h ago`;
    return `${Math.floor(d / (24 * 60 * 60 * 1000))}d ago`;
  };

  const severityUi = (sev: string) => {
    const s = String(sev || '').toLowerCase();
    if (s === 'critical') return { label: 'CRITICAL', cls: 'text-destructive bg-destructive/10 border-destructive/20', icon: 'error' };
    if (s === 'high' || s === 'warning') return { label: 'WARNING', cls: 'text-primary bg-primary/10 border-primary/20', icon: 'warning' };
    return { label: 'INFO', cls: 'text-muted-foreground bg-muted/40 border-border', icon: 'info' };
  };

  const pctLabel = (n: number) => {
    const x = Number(n || 0) || 0;
    const sign = x > 0 ? '+' : '';
    return `${sign}${x}%`;
  };

  const sparkPath = (values: number[], w: number, h: number) => {
    if (!values.length) return `M0,${h} L${w},${h}`;
    const max = Math.max(1e-9, ...values);
    const min = Math.min(...values);
    const span = Math.max(1e-9, max - min);
    const step = values.length > 1 ? w / (values.length - 1) : w;
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / span) * (h - 6) - 3;
      return [x, y];
    });
    return `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L')}`;
  };

  const growthSeries = (() => {
    const ys = growth.map((g) => Number(g.newTenants || 0) || 0);
    const max = Math.max(1, ...ys);
    return { ys, max };
  })();

  const churnSeries = (() => {
    const map = new Map<string, number>();
    churn.forEach((c) => map.set(String(c.month || ''), Number(c.churnedTenants || 0) || 0));
    const ys = growth.map((g) => map.get(String(g.month || '')) ?? 0);
    const max = Math.max(1, ...ys);
    return { ys, max };
  })();

  const growthPath = (() => {
    const ys = growthSeries.ys;
    if (!ys.length) return 'M0,150 L800,150';
    const w = 800;
    const h = 200;
    const step = ys.length > 1 ? w / (ys.length - 1) : w;
    const pts = ys.map((v, i) => {
      const x = i * step;
      const y = h - (v / growthSeries.max) * 140 - 10;
      return [x, y];
    });
    return `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L')}`;
  })();

  const churnPath = (() => {
    const ys = churnSeries.ys;
    if (!ys.length) return 'M0,150 L800,150';
    const w = 800;
    const h = 200;
    const max = Math.max(growthSeries.max, churnSeries.max);
    const step = ys.length > 1 ? w / (ys.length - 1) : w;
    const pts = ys.map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * 140 - 10;
      return [x, y];
    });
    return `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L')}`;
  })();

  const growthAreaPath = (() => {
    const base = growthPath;
    return `${base} V200 H0 Z`;
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="shrink-0 px-6 py-5 border-b border-border flex flex-col gap-4 md:flex-row md:items-end justify-between bg-background/95 backdrop-blur-sm z-10">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm font-medium tracking-wide">Dashboard</p>
          <h2 className="text-foreground text-3xl font-black leading-tight tracking-[-0.02em]">Platform Overview</h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-card p-1 rounded-lg border border-border">
            <button
              className={cn('px-3 py-1.5 rounded text-xs font-bold transition-colors', range === '30d' ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setRange('30d')}
            >
              30 Days
            </button>
            <button
              className={cn('px-3 py-1.5 rounded text-xs font-bold transition-colors', range === '7d' ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setRange('7d')}
            >
              7 Days
            </button>
            <button
              className={cn('px-3 py-1.5 rounded text-xs font-bold transition-colors', range === '24h' ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setRange('24h')}
            >
              24 Hours
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={load}
            className="h-10 px-4 font-bold gap-2 border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <span className={cn('material-symbols-outlined text-[18px]', loading && 'animate-spin')}>sync</span>
            Refresh
          </Button>

          <button className="flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-bold transition-colors shadow-lg shadow-primary/10">
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Export Report</span>
          </button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-7xl mx-auto p-6 lg:p-10 space-y-6 pb-32">
          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex justify-between items-center">
              <p className="text-xs font-black uppercase tracking-widest leading-none">{error}</p>
              <button onClick={() => setError(null)} className="h-7 w-7 rounded-full grid place-items-center hover:bg-accent transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="md:col-span-3 bg-muted/40 border border-border">
              <CardContent className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">System Status</span>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <div className={cn('size-2 rounded-full bg-emerald-500', 'shadow-[0_0_8px_rgba(11,218,25,0.5)]')} />
                    <span className="text-foreground text-sm font-medium">API Gateway</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn('size-2 rounded-full', databaseStatus === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(11,218,25,0.5)]' : 'bg-destructive shadow-[0_0_8px_rgba(255,77,77,0.5)]')} />
                    <span className="text-foreground text-sm font-medium">Database Cluster</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn('size-2 rounded-full', syncingBranches > 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(11,218,25,0.5)]' : 'bg-primary animate-pulse shadow-[0_0_8px_rgba(238,173,43,0.5)]')} />
                    <span className="text-foreground text-sm font-medium">
                      Sync Services
                      {syncingBranches > 0 ? null : <span className="text-xs text-primary ml-1">(Degraded)</span>}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-1 bg-muted/40 border border-border">
              <CardContent className="p-4 md:p-5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Last Sync</span>
                <span className="text-foreground text-sm font-mono">{loading ? '…' : relTime(lastSyncAt) || '—'}</span>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card border border-border shadow-lg relative overflow-hidden group">
              <CardContent className="p-5">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-symbols-outlined text-foreground text-6xl">storefront</span>
                </div>
                <div className="flex justify-between items-start mb-3">
                  <p className="text-muted-foreground text-sm font-medium">Total Cafes</p>
                </div>
                <p className="text-foreground text-3xl font-bold tracking-tight">{fmtInt(totalTenants)}</p>
                <div className="mt-1 text-xs text-muted-foreground">
                  <span className="text-foreground font-semibold">{fmtInt(activeTenants)} Active</span>
                  <span className="mx-2">/</span>
                  <span className="text-primary font-semibold">{fmtInt(trialTenants)} Trial</span>
                  <span className="mx-2">/</span>
                  <span className="text-destructive font-semibold">{fmtInt(suspendedTenants)} Suspended</span>
                </div>
                <div className="flex items-center gap-1 mt-3">
                  <span className="material-symbols-outlined text-emerald-500 text-sm">trending_up</span>
                  <p className="text-emerald-500 text-xs font-bold">
                    {pctLabel(Number(trends.tenantsPct || 0))}
                    <span className="text-muted-foreground font-normal ml-1">vs prev period</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border border-border shadow-lg relative overflow-hidden group">
              <CardContent className="p-5">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-symbols-outlined text-foreground text-6xl">point_of_sale</span>
                </div>
                <div className="flex justify-between items-start mb-3">
                  <p className="text-muted-foreground text-sm font-medium">Active Terminals</p>
                </div>
                <p className="text-foreground text-3xl font-bold tracking-tight">{fmtInt(totalBranches)}</p>
                <p className="text-xs mt-1 text-muted-foreground">Syncing: {fmtInt(syncingBranches)} branches</p>
                <div className="flex items-center gap-1 mt-3">
                  <span className="material-symbols-outlined text-emerald-500 text-sm">trending_up</span>
                  <p className="text-emerald-500 text-xs font-bold">+0% <span className="text-muted-foreground font-normal ml-1">growth</span></p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border border-border shadow-lg relative overflow-hidden group">
              <CardContent className="p-5">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-symbols-outlined text-foreground text-6xl">receipt_long</span>
                </div>
                <div className="flex justify-between items-start mb-3">
                  <p className="text-muted-foreground text-sm font-medium">Orders (Today / Month)</p>
                </div>
                <p className="text-foreground text-3xl font-bold tracking-tight">
                  {fmtCompact(ordersToday)} <span className="text-xl text-muted-foreground font-normal">/ {fmtCompact(ordersMonth)}</span>
                </p>
                <p className="text-xs mt-1 text-muted-foreground">Avg. ticket {fmtEtb(avgTicketEtb)}</p>
                <div className="flex items-center gap-1 mt-3">
                  <span className="material-symbols-outlined text-emerald-500 text-sm">trending_up</span>
                  <p className="text-emerald-500 text-xs font-bold">
                    {pctLabel(Number(trends.ordersPct || 0))}
                    <span className="text-muted-foreground font-normal ml-1">volume</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border border-border shadow-lg relative overflow-hidden group">
              <CardContent className="p-5">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-symbols-outlined text-foreground text-6xl">payments</span>
                </div>
                <div className="flex justify-between items-start mb-3">
                  <p className="text-muted-foreground text-sm font-medium">Platform Revenue</p>
                </div>
                <p className="text-foreground text-3xl font-bold tracking-tight">{fmtEtb(mrrEtb)}</p>
                <p className="text-xs mt-1 text-muted-foreground">MRR: {fmtEtb(mrrEtb)}</p>
                <div className="flex items-center gap-1 mt-3">
                  <span className="material-symbols-outlined text-emerald-500 text-sm">trending_up</span>
                  <p className="text-emerald-500 text-xs font-bold">
                    {pctLabel(Number(trends.revenuePct || 0))}
                    <span className="text-muted-foreground font-normal ml-1">YTD</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-xl p-6 border border-border flex flex-col">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Cafe Growth</h3>
                  <p className="text-muted-foreground text-sm">Net new active tenants over time</p>
                </div>
                <div className="flex gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><div className="w-3 h-1 bg-primary rounded-full"></div> Growth</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><div className="w-3 h-1 bg-muted rounded-full"></div> Churn</span>
                </div>
              </div>

              <div className="flex-1 w-full h-64 relative">
                <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 800 200">
                  <line x1="0" y1="0" x2="800" y2="0" stroke="hsl(var(--border))" strokeOpacity="0.6" strokeWidth="1" />
                  <line x1="0" y1="50" x2="800" y2="50" stroke="hsl(var(--border))" strokeOpacity="0.6" strokeWidth="1" />
                  <line x1="0" y1="100" x2="800" y2="100" stroke="hsl(var(--border))" strokeOpacity="0.6" strokeWidth="1" />
                  <line x1="0" y1="150" x2="800" y2="150" stroke="hsl(var(--border))" strokeOpacity="0.6" strokeWidth="1" />

                  <path d={growthAreaPath} fill="url(#gradientPrimary)" opacity="0.1" />
                  <path d={growthPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" />
                  <path d={churnPath} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="6 6" />
                  <defs>
                    <linearGradient id="gradientPrimary" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="1" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>

                <div className="flex justify-between mt-2 text-xs text-muted-foreground font-mono">
                  {growth.slice(0, 12).map((g) => (
                    <span key={g.month}>{monthShort(g.month)}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <Card className="bg-card rounded-xl border border-border">
                <CardHeader className="p-6 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-foreground text-base font-bold">Offline Sync Health</CardTitle>
                    <CardDescription className="text-muted-foreground text-sm">Branches with recent updates</CardDescription>
                  </div>
                  <span className={cn('material-symbols-outlined', syncingBranches > 0 ? 'text-emerald-500' : 'text-primary')}>check_circle</span>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-black text-foreground tracking-tight">{totalBranches > 0 ? `${Math.round((syncingBranches / Math.max(1, totalBranches)) * 1000) / 10}%` : '—'}</span>
                    <span className="text-sm text-muted-foreground mb-1">Success Rate</span>
                  </div>
                  <div className="mt-3 w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${totalBranches > 0 ? Math.min(100, Math.round((syncingBranches / Math.max(1, totalBranches)) * 100)) : 0}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{fmtInt(syncConflictsPending)} sync conflicts pending resolution.</p>
                </CardContent>
              </Card>

              <div className="bg-card rounded-xl p-6 border border-border flex-1">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-foreground text-base font-bold">Error Rate (5xx)</h3>
                  <span className={cn('text-xs px-2 py-1 rounded bg-muted', errorStatus.cls)}>{errorStatus.label}</span>
                </div>
                <div className="flex items-end gap-2 mb-4">
                  <span className="text-2xl font-bold text-foreground">{`${(errorRate5xx * 100).toFixed(2)}%`}</span>
                  <span className={cn('text-xs mb-1', errorRateDelta <= 0 ? 'text-emerald-500' : 'text-primary')}>{`${errorRateDelta >= 0 ? '+' : ''}${(errorRateDelta * 100).toFixed(2)}%`}</span>
                </div>
                <svg className={cn('w-full h-12 overflow-visible', errorStatus.cls)} preserveAspectRatio="none" viewBox="0 0 300 50">
                  <path d={sparkPath(errorSparkline.length ? errorSparkline : [0, 0, 0, 0, 0], 300, 50)} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <p className="text-xs text-muted-foreground mt-3">DB: <span className="text-foreground">{databaseStatus}</span></p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card rounded-xl p-0 border border-border">
              <CardHeader className="p-6 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-foreground text-lg font-bold">Monthly Revenue</CardTitle>
                  <CardDescription className="text-muted-foreground text-sm">Last 8 months (ETB)</CardDescription>
                </div>
                <button className="text-xs text-primary hover:text-foreground transition-colors">View Report</button>
              </CardHeader>
              <CardContent className="p-6">
                <div className="h-44 flex items-end justify-between gap-2">
                  {revenue.map((r, idx) => {
                    const h = Math.max(8, Math.round((Number(r.totalEtb || 0) / revMax) * 100));
                    const isCurrent = idx === revenue.length - 1;
                    return (
                      <div
                        key={r.month}
                        className={cn(
                          'flex-1 rounded-t-sm transition-all cursor-pointer group relative',
                          isCurrent ? 'bg-primary shadow-[0_0_10px_rgba(238,173,43,0.2)]' : 'bg-muted hover:bg-primary hover:shadow-[0_0_15px_rgba(238,173,43,0.3)]',
                        )}
                        style={{ height: `${h}%` }}
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border">
                          {fmtEtb(Number(r.totalEtb || 0))}
                        </div>
                      </div>
                    );
                  })}
                  {revenue.length === 0 && (
                    <div className="text-xs text-muted-foreground">No revenue data</div>
                  )}
                </div>
                <div className="flex justify-between mt-3 text-xs text-muted-foreground font-mono">
                  {revenue.slice(0, 8).map((r) => (
                    <span key={r.month} className={cn(r.month === revenue[revenue.length - 1]?.month ? 'text-foreground font-bold' : '')}>
                      {monthShort(r.month)}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card rounded-xl border border-border flex flex-col overflow-hidden">
              <CardHeader className="p-4 border-b border-border bg-muted/40 flex flex-row items-center justify-between">
                <CardTitle className="text-foreground text-lg font-bold">Critical Alerts</CardTitle>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold border', alertsNewCount > 0 ? 'bg-destructive/20 text-destructive border-destructive/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')}>
                  {alertsNewCount > 0 ? `${alertsNewCount} New` : 'None'}
                </span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 text-muted-foreground text-xs uppercase font-semibold">
                      <tr>
                        <th className="px-4 py-3">Severity</th>
                        <th className="px-4 py-3">Message</th>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {alerts.slice(0, 6).map((a) => {
                        const ui = severityUi(a.severity);
                        return (
                          <tr key={a.id} className="hover:bg-accent transition-colors">
                            <td className="px-4 py-3">
                              <span className={cn('inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded border', ui.cls)}>
                                <span className="material-symbols-outlined text-[14px]">{ui.icon}</span>
                                {ui.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-foreground">{a.message}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{relTime(a.createdAt) || '—'}</td>
                            <td className="px-4 py-3 text-right">
                              <button className="text-primary hover:text-foreground text-xs font-bold underline">Investigate</button>
                            </td>
                          </tr>
                        );
                      })}
                      {!alerts.length && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">No open alerts</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default SA_Overview;
