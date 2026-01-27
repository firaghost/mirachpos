import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
type HealthResponse = {
  ok: boolean;
  environment: string;
  allOperational: boolean;
  lastRefreshedAt: string;
  kpis: {
    avgSyncLatencyMs: number;
    latencyTrendPct: number;
    failedSyncs24h: number;
    failedSyncsDelta: number;
    apiUptimePct: number;
    apiStatusLabel: string;
  };
  errorFeed: Array<{ at: string; level: string; message: string }>;
  components: Array<{
    id: string;
    name: string;
    region: string;
    status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | string;
    responseTimeMs: number;
    uptime30dPct: number;
    icon?: string;
  }>;
};

const fmtTime = (iso: string) => {
  return formatDeviceTime(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const fmtShortTime = (iso: string) => {
  return formatDeviceTime(iso, { hour: '2-digit', minute: '2-digit' });
};

export const SA_SystemHealth: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/superadmin/system-health');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setHealth(json as HealthResponse);
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load system health'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onForceSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    try {
      const res = await apiFetch('/api/superadmin/system-health/force-sync', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || 'Force sync failed'));
    } finally {
      setSyncing(false);
    }
  }, [load, syncing]);

  const envLabel = health?.environment || 'Production';
  const allOk = Boolean(health?.allOperational);
  const headerStatusText = allOk ? 'All Systems Operational' : 'Degraded';
  const headerDotClass = allOk ? 'bg-emerald-500' : 'bg-destructive';
  const lastRefreshed = health?.lastRefreshedAt ? fmtTime(health.lastRefreshedAt) : '';

  const errorFeed = useMemo(() => {
    const items = Array.isArray(health?.errorFeed) ? health!.errorFeed : [];
    return items.slice(0, 25);
  }, [health]);

  const components = useMemo(() => {
    const items = Array.isArray(health?.components) ? health!.components : [];
    return items;
  }, [health]);

  const kpiLatency = typeof health?.kpis?.avgSyncLatencyMs === 'number' ? health!.kpis.avgSyncLatencyMs : 0;
  const kpiLatencyTrend = typeof health?.kpis?.latencyTrendPct === 'number' ? health!.kpis.latencyTrendPct : 0;
  const kpiFailed24 = typeof health?.kpis?.failedSyncs24h === 'number' ? health!.kpis.failedSyncs24h : 0;
  const kpiFailedDelta = typeof health?.kpis?.failedSyncsDelta === 'number' ? health!.kpis.failedSyncsDelta : 0;
  const kpiUptime = typeof health?.kpis?.apiUptimePct === 'number' ? health!.kpis.apiUptimePct : 99.98;
  const kpiApiStatusLabel = health?.kpis?.apiStatusLabel || 'Operational';

  const latencyPct = useMemo(() => {
    const ms = Number(kpiLatency) || 0;
    const pct = Math.round(Math.max(0, Math.min(100, (ms / 5000) * 100)));
    return pct;
  }, [kpiLatency]);

  const latencyTrendIsDown = kpiLatencyTrend < 0;
  const latencyTrendText = `${kpiLatencyTrend >= 0 ? '+' : ''}${kpiLatencyTrend}% vs 1h ago`;
  const failedDeltaText = `${kpiFailedDelta >= 0 ? '+' : ''}${kpiFailedDelta} incidents`;
  const failedDeltaIsUp = kpiFailedDelta >= 0;
  const errorDotClass = errorFeed.length > 0 ? 'bg-destructive' : 'bg-emerald-500';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card flex-shrink-0">
        <div className="flex flex-col">
          <h2 className="text-lg font-bold text-foreground tracking-tight">System Infrastructure Monitor</h2>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${headerDotClass} animate-pulse`}></span>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Environment: {envLabel}    {headerStatusText}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-muted-foreground font-mono">Last refreshed: {lastRefreshed || (loading ? 'Loading ' : ' ”')}</p>
          <div className="h-4 w-px bg-border"></div>
          <button
            onClick={onForceSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded text-primary text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-primary/10"
          >
            <AppIcon name="sync" className="text-[16px]" size={16} /> Force Sync
          </button>
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* KPI Card 1 */}
          <div className="bg-card border border-border p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <AppIcon name="speed" className="text-6xl text-primary" size={60} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Avg Sync Latency</p>
              <h3 className="text-3xl font-bold text-foreground mt-1 tabular-nums">{kpiLatency}<span className="text-lg font-medium text-muted-foreground ml-1">ms</span></h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-4 h-4 rounded-full ${latencyTrendIsDown ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/20 text-primary'} text-[10px]`}
              >
                <AppIcon name={latencyTrendIsDown ? 'arrow_downward' : 'arrow_upward'} className="text-[12px]" size={12} />
              </span>
              <p className={`${latencyTrendIsDown ? 'text-emerald-500' : 'text-primary'} text-xs font-medium`}>{latencyTrendText}</p>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0"></div>
          </div>
          {/* KPI Card 2 */}
          <div className="bg-card border border-border p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <AppIcon name="warning" className="text-6xl text-primary" size={60} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Failed Syncs (24h)</p>
              <h3 className="text-3xl font-bold text-foreground mt-1 tabular-nums">{kpiFailed24}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-4 h-4 rounded-full ${failedDeltaIsUp ? 'bg-primary/20 text-primary' : 'bg-emerald-500/15 text-emerald-500'} text-[10px]`}
              >
                <AppIcon name={failedDeltaIsUp ? 'arrow_upward' : 'arrow_downward'} className="text-[12px]" size={12} />
              </span>
              <p className={`${failedDeltaIsUp ? 'text-primary' : 'text-emerald-500'} text-xs font-medium`}>{failedDeltaText}</p>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0"></div>
          </div>
          {/* KPI Card 4 */}
          <div className="bg-card border border-border p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <AppIcon name="check_circle" className="text-6xl text-emerald-500" size={60} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">API Uptime</p>
              <h3 className="text-3xl font-bold text-foreground mt-1 tabular-nums">{kpiUptime.toFixed(2)}<span className="text-lg font-medium text-muted-foreground ml-1">%</span></h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${allOk ? 'bg-emerald-500' : 'bg-primary'}`}></span>
              <p className="text-muted-foreground text-xs font-medium">{kpiApiStatusLabel}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Latency Chart Section */}
          <div className="lg:col-span-2 bg-card border border-border rounded-md p-5 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Real-Time Sync Latency</h3>
                <p className="text-xs text-muted-foreground mt-1">Measuring end-to-end packet travel time (ms)</p>
              </div>
              <div className="flex gap-2">
                <button className="px-2 py-1 text-[10px] font-bold uppercase rounded bg-primary text-primary-foreground">1H</button>
              </div>
            </div>
            <div className="relative w-full h-[240px] bg-background rounded border border-border p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wider font-medium">Current latency</div>
                  <div className="text-foreground text-3xl font-black tabular-nums mt-1">{Math.round(kpiLatency)}<span className="text-muted-foreground text-base font-bold ml-1">ms</span></div>
                  <div className="text-muted-foreground text-xs mt-2">Failed syncs (24h): <span className="text-foreground font-bold tabular-nums">{kpiFailed24}</span></div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground text-xs uppercase tracking-wider font-medium">Status</div>
                  <div className={"mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold " + (allOk ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-primary/30 bg-primary/10 text-primary')}>
                    <span className={"w-2 h-2 rounded-full " + (allOk ? 'bg-emerald-500' : 'bg-primary')} />
                    {allOk ? 'HEALTHY' : 'DEGRADED'}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2">
                  <span>0ms</span>
                  <span>5,000ms+</span>
                </div>
                <div className="w-full h-3 rounded-full border border-border bg-muted overflow-hidden">
                  <div className={"h-full " + (allOk ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${latencyPct}%` }} />
                </div>
              </div>
            </div>
          </div>
          {/* Recent Incidents Log */}
          <div className="lg:col-span-1 bg-card border border-border rounded-md p-5 flex flex-col h-[366px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Error Log Feed</h3>
              <span className={`w-2 h-2 rounded-full ${errorDotClass} animate-pulse`}></span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-xs space-y-3 pr-2">
              {error && (
                <div className="border-l-2 border-destructive/50 pl-3 py-1">
                  <div className="flex justify-between text-muted-foreground text-[10px] mb-1">
                    <span>{lastRefreshed || ' ”'}</span>
                    <span className="text-destructive font-bold">ERROR</span>
                  </div>
                  <p className="text-muted-foreground">{error}</p>
                </div>
              )}
              {!error && loading && (
                <div className="border-l-2 border-primary/50 pl-3 py-1">
                  <div className="flex justify-between text-muted-foreground text-[10px] mb-1">
                    <span> ”</span>
                    <span className="text-primary font-bold">INFO</span>
                  </div>
                  <p className="text-muted-foreground">Loading </p>
                </div>
              )}
              {!error && !loading && errorFeed.length === 0 && (
                <div className="border-l-2 border-emerald-500/50 pl-3 py-1">
                  <div className="flex justify-between text-muted-foreground text-[10px] mb-1">
                    <span>{lastRefreshed || ' ”'}</span>
                    <span className="text-emerald-500 font-bold">OK</span>
                  </div>
                  <p className="text-muted-foreground">No recent incidents.</p>
                </div>
              )}
              {!error && errorFeed.map((it, idx) => {
                const lvl = String(it.level || '').toUpperCase();
                const isCritical = lvl === 'CRITICAL' || lvl === 'ERROR';
                const border = isCritical ? 'border-destructive/50' : 'border-primary/50';
                const label = isCritical ? 'text-destructive' : 'text-primary';
                return (
                  <div key={`${it.at}_${idx}`} className={`border-l-2 ${border} pl-3 py-1`}>
                    <div className="flex justify-between text-muted-foreground text-[10px] mb-1">
                      <span>{fmtShortTime(it.at)}</span>
                      <span className={`${label} font-bold`}>{lvl || 'WARN'}</span>
                    </div>
                    <p className="text-muted-foreground">{it.message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detailed Component Health Status Grid */}
        <div className="bg-card border border-border rounded-md overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex justify-between items-center bg-muted/40">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Component Health Status</h3>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Service Name</th>
                  <th className="px-5 py-3 font-semibold">Region</th>
                  <th className="px-5 py-3 font-semibold text-center">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Response Time</th>
                  <th className="px-5 py-3 font-semibold text-right">Uptime (30d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {components.length === 0 && (
                  <tr className="hover:bg-accent transition-colors">
                    <td className="px-5 py-3 text-muted-foreground" colSpan={5}>{loading ? 'Loading ' : 'No components reported.'}</td>
                  </tr>
                )}
                {components.map((c) => {
                  const status = String(c.status || 'DEGRADED').toUpperCase();
                  const isHealthy = status === 'HEALTHY';
                  const isDown = status === 'DOWN';
                  const badgeBg = isDown ? 'bg-destructive/10 text-destructive border-destructive/20' : (isHealthy ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-primary/10 text-primary border-primary/20');
                  const dot = isDown ? 'bg-destructive' : (isHealthy ? 'bg-emerald-500' : 'bg-primary');
                  const rtClass = isHealthy ? 'text-muted-foreground' : (isDown ? 'text-destructive' : 'text-primary');
                  return (
                    <tr key={c.id} className="hover:bg-accent transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground flex items-center gap-2">
                        <AppIcon name={c.icon || 'dns'} className="text-[18px] text-muted-foreground" size={18} />
                        {c.name}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{c.region}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${badgeBg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span> {status}
                        </span>
                      </td>
                      <td className={`px-5 py-3 text-right font-mono ${rtClass}`}>{Math.round(Number(c.responseTimeMs || 0))}ms</td>
                      <td className="px-5 py-3 text-right font-mono text-muted-foreground">{Number(c.uptime30dPct || 0).toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
