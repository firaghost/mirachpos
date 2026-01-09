import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceTime } from '../../datetime';

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
  const headerDotClass = allOk ? 'bg-[#4ade80]' : 'bg-[#ef4444]';
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
  const errorDotClass = errorFeed.length > 0 ? 'bg-[#ef4444]' : 'bg-[#4ade80]';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-slate-100">
      {/* Header */}
      <header className="h-16 border-b border-[#483c23] flex items-center justify-between px-6 bg-[#221c10] flex-shrink-0">
        <div className="flex flex-col">
          <h2 className="text-lg font-bold text-white tracking-tight">System Infrastructure Monitor</h2>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${headerDotClass} animate-pulse`}></span>
            <p className="text-xs text-[#c9b792] font-medium uppercase tracking-wide">Environment: {envLabel}    {headerStatusText}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-[#c9b792] font-mono">Last refreshed: {lastRefreshed || (loading ? 'Loading ¦' : ' ”')}</p>
          <div className="h-4 w-px bg-[#483c23]"></div>
          <button
            onClick={onForceSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#eead2b]/10 hover:bg-[#eead2b]/20 border border-[#eead2b]/20 rounded text-[#eead2b] text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-[#eead2b]/10"
          >
            <span className="material-symbols-outlined text-[16px]">sync</span> Force Sync
          </button>
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* KPI Card 1 */}
          <div className="bg-[#2c2415] border border-[#483c23] p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-[#eead2b]">speed</span>
            </div>
            <div>
              <p className="text-[#c9b792] text-xs font-medium uppercase tracking-wider">Avg Sync Latency</p>
              <h3 className="text-3xl font-bold text-white mt-1 tabular-nums">{kpiLatency}<span className="text-lg font-medium text-[#c9b792] ml-1">ms</span></h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-4 h-4 rounded-full ${latencyTrendIsDown ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'bg-[#eead2b]/20 text-[#eead2b]'} text-[10px]`}
              >
                <span className="material-symbols-outlined text-[12px]">{latencyTrendIsDown ? 'arrow_downward' : 'arrow_upward'}</span>
              </span>
              <p className={`${latencyTrendIsDown ? 'text-[#4ade80]' : 'text-[#eead2b]'} text-xs font-medium`}>{latencyTrendText}</p>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#eead2b]/0 via-[#eead2b]/50 to-[#eead2b]/0"></div>
          </div>
          {/* KPI Card 2 */}
          <div className="bg-[#2c2415] border border-[#483c23] p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-[#eead2b]">warning</span>
            </div>
            <div>
              <p className="text-[#c9b792] text-xs font-medium uppercase tracking-wider">Failed Syncs (24h)</p>
              <h3 className="text-3xl font-bold text-white mt-1 tabular-nums">{kpiFailed24}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-4 h-4 rounded-full ${failedDeltaIsUp ? 'bg-[#eead2b]/20 text-[#eead2b]' : 'bg-[#4ade80]/20 text-[#4ade80]'} text-[10px]`}
              >
                <span className="material-symbols-outlined text-[12px]">{failedDeltaIsUp ? 'arrow_upward' : 'arrow_downward'}</span>
              </span>
              <p className={`${failedDeltaIsUp ? 'text-[#eead2b]' : 'text-[#4ade80]'} text-xs font-medium`}>{failedDeltaText}</p>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#eead2b]/0 via-[#eead2b]/50 to-[#eead2b]/0"></div>
          </div>
          {/* KPI Card 4 */}
          <div className="bg-[#2c2415] border border-[#483c23] p-5 rounded-md flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-[#4ade80]">check_circle</span>
            </div>
            <div>
              <p className="text-[#c9b792] text-xs font-medium uppercase tracking-wider">API Uptime</p>
              <h3 className="text-3xl font-bold text-white mt-1 tabular-nums">{kpiUptime.toFixed(2)}<span className="text-lg font-medium text-[#c9b792] ml-1">%</span></h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${allOk ? 'bg-[#4ade80]' : 'bg-[#eead2b]'}`}></span>
              <p className="text-[#c9b792] text-xs font-medium">{kpiApiStatusLabel}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Latency Chart Section */}
          <div className="lg:col-span-2 bg-[#2c2415] border border-[#483c23] rounded-md p-5 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">Real-Time Sync Latency</h3>
                <p className="text-xs text-[#c9b792] mt-1">Measuring end-to-end packet travel time (ms)</p>
              </div>
              <div className="flex gap-2">
                <button className="px-2 py-1 text-[10px] font-bold uppercase rounded bg-[#eead2b] text-white">1H</button>
              </div>
            </div>
            <div className="relative w-full h-[240px] bg-[#221c10] rounded border border-[#483c23]/50 p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[#c9b792] text-xs uppercase tracking-wider font-medium">Current latency</div>
                  <div className="text-white text-3xl font-black tabular-nums mt-1">{Math.round(kpiLatency)}<span className="text-[#c9b792] text-base font-bold ml-1">ms</span></div>
                  <div className="text-[#c9b792] text-xs mt-2">Failed syncs (24h): <span className="text-white font-bold tabular-nums">{kpiFailed24}</span></div>
                </div>
                <div className="text-right">
                  <div className="text-[#c9b792] text-xs uppercase tracking-wider font-medium">Status</div>
                  <div className={"mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold " + (allOk ? 'border-[#4ade80]/30 bg-[#4ade80]/10 text-[#4ade80]' : 'border-[#eead2b]/30 bg-[#eead2b]/10 text-[#eead2b]')}>
                    <span className={"w-2 h-2 rounded-full " + (allOk ? 'bg-[#4ade80]' : 'bg-[#eead2b]')} />
                    {allOk ? 'HEALTHY' : 'DEGRADED'}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] text-[#c9b792] font-medium uppercase tracking-wider mb-2">
                  <span>0ms</span>
                  <span>5,000ms+</span>
                </div>
                <div className="w-full h-3 rounded-full border border-[#483c23] bg-[#2c2415] overflow-hidden">
                  <div className={"h-full " + (allOk ? 'bg-[#4ade80]' : 'bg-[#eead2b]')} style={{ width: `${latencyPct}%` }} />
                </div>
              </div>
            </div>
          </div>
          {/* Recent Incidents Log */}
          <div className="lg:col-span-1 bg-[#2c2415] border border-[#483c23] rounded-md p-5 flex flex-col h-[366px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Error Log Feed</h3>
              <span className={`w-2 h-2 rounded-full ${errorDotClass} animate-pulse`}></span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-xs space-y-3 pr-2">
              {error && (
                <div className="border-l-2 border-[#ef4444]/50 pl-3 py-1">
                  <div className="flex justify-between text-[#c9b792] text-[10px] mb-1">
                    <span>{lastRefreshed || ' ”'}</span>
                    <span className="text-[#ef4444] font-bold">ERROR</span>
                  </div>
                  <p className="text-slate-300">{error}</p>
                </div>
              )}
              {!error && loading && (
                <div className="border-l-2 border-[#eead2b]/50 pl-3 py-1">
                  <div className="flex justify-between text-[#c9b792] text-[10px] mb-1">
                    <span> ”</span>
                    <span className="text-[#eead2b] font-bold">INFO</span>
                  </div>
                  <p className="text-slate-300">Loading ¦</p>
                </div>
              )}
              {!error && !loading && errorFeed.length === 0 && (
                <div className="border-l-2 border-[#4ade80]/50 pl-3 py-1">
                  <div className="flex justify-between text-[#c9b792] text-[10px] mb-1">
                    <span>{lastRefreshed || ' ”'}</span>
                    <span className="text-[#4ade80] font-bold">OK</span>
                  </div>
                  <p className="text-slate-300">No recent incidents.</p>
                </div>
              )}
              {!error && errorFeed.map((it, idx) => {
                const lvl = String(it.level || '').toUpperCase();
                const isCritical = lvl === 'CRITICAL' || lvl === 'ERROR';
                const border = isCritical ? 'border-[#ef4444]/50' : 'border-[#eead2b]/50';
                const label = isCritical ? 'text-[#ef4444]' : 'text-[#eead2b]';
                return (
                  <div key={`${it.at}_${idx}`} className={`border-l-2 ${border} pl-3 py-1`}>
                    <div className="flex justify-between text-[#c9b792] text-[10px] mb-1">
                      <span>{fmtShortTime(it.at)}</span>
                      <span className={`${label} font-bold`}>{lvl || 'WARN'}</span>
                    </div>
                    <p className="text-slate-300">{it.message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detailed Component Health Status Grid */}
        <div className="bg-[#2c2415] border border-[#483c23] rounded-md overflow-hidden">
          <div className="px-5 py-4 border-b border-[#483c23] flex justify-between items-center bg-white/5">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">Component Health Status</h3>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 text-xs text-[#c9b792] font-medium uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Service Name</th>
                  <th className="px-5 py-3 font-semibold">Region</th>
                  <th className="px-5 py-3 font-semibold text-center">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Response Time</th>
                  <th className="px-5 py-3 font-semibold text-right">Uptime (30d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#483c23] text-sm">
                {components.length === 0 && (
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="px-5 py-3 text-[#c9b792]" colSpan={5}>{loading ? 'Loading ¦' : 'No components reported.'}</td>
                  </tr>
                )}
                {components.map((c) => {
                  const status = String(c.status || 'DEGRADED').toUpperCase();
                  const isHealthy = status === 'HEALTHY';
                  const isDown = status === 'DOWN';
                  const badgeBg = isDown ? 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20' : (isHealthy ? 'bg-[#4ade80]/10 text-[#4ade80] border-[#4ade80]/20' : 'bg-[#eead2b]/10 text-[#eead2b] border-[#eead2b]/20');
                  const dot = isDown ? 'bg-[#ef4444]' : (isHealthy ? 'bg-[#4ade80]' : 'bg-[#eead2b]');
                  const rtClass = isHealthy ? 'text-slate-400' : (isDown ? 'text-[#ef4444]' : 'text-[#eead2b]');
                  return (
                    <tr key={c.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-200 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-[#c9b792]">{c.icon || 'dns'}</span>
                        {c.name}
                      </td>
                      <td className="px-5 py-3 text-[#c9b792]">{c.region}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${badgeBg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span> {status}
                        </span>
                      </td>
                      <td className={`px-5 py-3 text-right font-mono ${rtClass}`}>{Math.round(Number(c.responseTimeMs || 0))}ms</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-400">{Number(c.uptime30dPct || 0).toFixed(2)}%</td>
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
