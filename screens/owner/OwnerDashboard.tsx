import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { updateSession } from '../../session';
import { InitializePosModal } from '../../components/InitializePosModal';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDeviceTime } from '../../datetime';

const fmtEtb = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'ETB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `ETB ${v.toFixed(2)}`;
  }
};

export const OwnerDashboard: React.FC = () => {
  const [range, setRange] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
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
    const rows = filteredRows;
    const header = ['BranchId', 'BranchName', 'Manager', 'RevenueToday', 'OrdersToday', 'Status'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.id, r.name, r.manager, r.revenueToday, r.ordersToday, r.status]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `branch-performance-${selectedBranchId || 'all'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white">
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
            <span className="text-xs text-[#b9b09d]">Branch:</span>
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-[#393328] text-white">{selectedBranchName || selectedBranchId || 'All Locations'}</span>
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-[#393328] rounded-lg h-10 w-64 px-3 gap-2">
              <span className="material-symbols-outlined text-[#b9b09d]" style={{ fontSize: 20 }}>search</span>
              <input
                value={tableQuery}
                onChange={(e) => setTableQuery(e.target.value)}
                className="bg-transparent border-none text-sm text-white placeholder-[#b9b09d] focus:ring-0 w-full p-0"
                placeholder="Search branches ¦"
                type="text"
              />
            </div>
            <button className="relative text-[#b9b09d] hover:text-white transition-colors" onClick={() => setTableStatus('All')} type="button">
              <span className="material-symbols-outlined">notifications</span>
              {alertsCount > 0 ? <span className="absolute top-0 right-0 size-2 bg-red-500 rounded-full border-2 border-[#181611]"></span> : null}
            </button>
            <button
              onClick={refreshOverview}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={goToBranchSelect}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>swap_horiz</span>
              <span className="hidden sm:inline">Switch Branch</span>
            </button>
            {selectedBranchId ? (
              <button
                onClick={clearBranchSelection}
                className="hidden lg:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
                type="button"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>public</span>
                <span className="hidden sm:inline">Global View</span>
              </button>
            ) : null}
            {posEmpty === true ? (
              <button
                type="button"
                onClick={() => setPosInitOpen(true)}
                className="hidden lg:flex items-center justify-center gap-2 h-10 px-4 bg-[#221c10] border border-[#544b3b] text-[#eead2b] rounded-lg text-sm font-black hover:bg-[#2c2417] transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>build</span>
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
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {!loading && !error && (!overview || safeBranches.length === 0) ? (
            <div className="rounded-xl border border-[#393328] bg-[#1f1b14] p-6 text-sm text-[#c8ad93]">
              No branches yet for this workspace. Create your first branch in <span className="font-bold text-white">Branch Management</span>.
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="text-xs text-[#b9b09d]">{lastUpdatedAt ? `Last updated: ${lastUpdatedAt}` : null}</div>
            {loading ? <div className="text-xs text-[#b9b09d]">Loading ¦</div> : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-[#eead2b]">
                  <span className="material-symbols-outlined">attach_money</span>
                </div>
                <span className="bg-[#1e3a23] text-[#4ade80] text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span>
                  {Math.round(Number((data.kpis as any).revenueDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Total Revenue (Month)</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{fmtEtb(data.kpis.totalRevenueMonth)}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">store</span>
                </div>
                <span className="bg-[#1e3a23] text-[#4ade80] text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span>
                  2%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Active Branches</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">
                  {data.kpis.activeBranches} <span className="text-[#b9b09d] text-base font-normal">/ {data.kpis.totalBranches}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">receipt_long</span>
                </div>
                <span className="bg-[#1e3a23] text-[#4ade80] text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span>
                  {Math.round(Number((data.kpis as any).ordersDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Total Orders</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{data.kpis.totalOrders.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">account_balance_wallet</span>
                </div>
                <span className="bg-[#1e3a23] text-[#4ade80] text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span>
                  {Math.round(Number((data.kpis as any).netProfitDeltaPct || 0))}%
                </span>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Net Profit</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{fmtEtb(data.kpis.netProfit)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-[#544b3b] bg-[#221c10] p-6 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-white text-lg font-bold">Revenue Analytics</h3>
                  <p className="text-[#b9b09d] text-sm">Comparison across all branches</p>
                </div>
                <div className="flex bg-[#393328] rounded-lg p-1">
                  {(['Daily', 'Weekly', 'Monthly'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                        range === r ? 'bg-[#181611] text-white shadow-sm' : 'text-[#b9b09d] hover:text-white'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {trend.length === 0 ? (
                <div className="h-64 w-full rounded-lg border border-dashed border-[#393328] bg-[#1a1611] flex items-center justify-center px-6 text-center">
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-bold text-white">No revenue history yet</div>
                    <div className="text-xs text-[#b9b09d]">
                      This chart will populate automatically after orders are recorded.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid stroke="#393328" strokeDasharray="3 3" />
                      <XAxis dataKey="key" stroke="#b9b09d" tick={{ fill: '#b9b09d', fontSize: 12 }} />
                      <YAxis stroke="#b9b09d" tick={{ fill: '#b9b09d', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#221c10', borderColor: '#544b3b', color: '#fff' }}
                        itemStyle={{ color: '#eead2b' }}
                      />
                      <Line type="monotone" dataKey="revenue" stroke="#eead2b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-[#544b3b] bg-[#221c10] p-5 shadow-lg flex-1">
                <h3 className="text-white text-base font-bold mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#eead2b]">dns</span> System Health
                </h3>
                <div className="flex flex-col gap-4">
                  {data.health.map((h) => {
                    const dot = h.status === 'Good' ? 'bg-[#4ade80] shadow-[0_0_8px_#4ade80]' : h.status === 'Warn' ? 'bg-[#eead2b]' : 'bg-[#ef4444]';
                    const val = h.status === 'Good' ? 'text-[#4ade80]' : h.status === 'Warn' ? 'text-[#b9b09d]' : 'text-[#ef4444]';
                    return (
                      <div key={h.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`size-2 rounded-full ${dot}`}></div>
                          <span className="text-sm text-white">{h.label}</span>
                        </div>
                        <span className={`text-xs font-mono ${val}`}>{h.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-[#544b3b] bg-[#221c10] p-5 shadow-lg flex-1">
                <h3 className="text-white text-base font-bold mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#ef4444]">warning</span> Critical Alerts
                </h3>
                <div className="flex flex-col gap-3">
                  {data.alerts.map((a) => (
                    <div
                      key={a.title}
                      className={`p-3 rounded-lg bg-[#393328]/50 border flex items-start gap-3 ${
                        a.severity === 'Critical' ? 'border-[#ef4444]/30' : 'border-[#eead2b]/30'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-lg shrink-0 mt-0.5 ${a.severity === 'Critical' ? 'text-[#ef4444]' : 'text-[#eead2b]'}`}
                      >
                        {a.icon}
                      </span>
                      <div>
                        <p className="text-white text-xs font-bold">{a.title}</p>
                        <p className="text-[#b9b09d] text-[11px] mt-0.5">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#544b3b] bg-[#221c10] overflow-hidden shadow-lg mb-8">
            <div className="px-6 py-4 border-b border-[#393328] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-white text-lg font-bold">Branch Performance</h3>
                <p className="text-[#b9b09d] text-sm">Real-time data from all locations</p>
              </div>
              <div className="flex gap-3">
                <div className="hidden md:flex items-center bg-[#393328] rounded-lg h-10 w-64 px-3 gap-2">
                  <span className="material-symbols-outlined text-[#b9b09d]" style={{ fontSize: 20 }}>search</span>
                  <input
                    value={tableQuery}
                    onChange={(e) => setTableQuery(e.target.value)}
                    className="bg-transparent border-none text-sm text-white placeholder-[#b9b09d] focus:ring-0 w-full p-0"
                    placeholder="Search in table ¦"
                    type="text"
                  />
                </div>
                <select
                  value={tableStatus}
                  onChange={(e) => setTableStatus(e.target.value as 'All' | 'Open' | 'Closed')}
                  className="h-10 px-3 rounded-lg border border-[#544b3b] bg-[#221c10] text-[#b9b09d] text-sm hover:text-white"
                >
                  <option value="All">All</option>
                  <option value="Open">Open</option>
                  <option value="Closed">Closed</option>
                </select>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#544b3b] text-[#b9b09d] text-sm hover:text-white hover:bg-[#393328] transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#27231c] text-[#b9b09d] text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-medium">Branch Name</th>
                    <th className="px-6 py-4 font-medium">Manager</th>
                    <th className="px-6 py-4 font-medium text-right">Today's Revenue</th>
                    <th className="px-6 py-4 font-medium text-right">Orders</th>
                    <th className="px-6 py-4 font-medium text-center">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#393328] text-sm">
                  {pageRows.map((b) => (
                    <tr key={b.id} className="hover:bg-[#393328]/30 transition-colors group">
                      <td className="px-6 py-4 text-white font-medium">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded bg-[#393328] flex items-center justify-center text-[#eead2b] font-bold">{b.name.slice(0, 1).toUpperCase()}</div>
                          <span>{b.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[#b9b09d]">{b.manager}</td>
                      <td className="px-6 py-4 text-white text-right font-medium">{fmtEtb(b.revenueToday)}</td>
                      <td className="px-6 py-4 text-[#b9b09d] text-right">{b.ordersToday}</td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-bold ${
                            b.status === 'Open' ? 'bg-[#1e3a23] text-[#4ade80]' : 'bg-[#3a1e1e] text-[#ef4444]'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => focusBranch(b.id, b.name)}
                          className="text-[#b9b09d] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="View this branch"
                        >
                          <span className="material-symbols-outlined">more_vert</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-[#393328] flex items-center justify-between">
              <p className="text-[#b9b09d] text-xs">Showing {pageRows.length} of {filteredRows.length} branches</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="size-8 flex items-center justify-center rounded bg-[#393328] text-[#b9b09d] hover:text-white disabled:opacity-50"
                  disabled={safePage <= 1}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
                </button>
                <button className="size-8 flex items-center justify-center rounded bg-[#eead2b] text-[#181611] font-bold">{safePage}</button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="size-8 flex items-center justify-center rounded bg-[#393328] text-[#b9b09d] hover:text-white disabled:opacity-50"
                  disabled={safePage >= totalPages}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
