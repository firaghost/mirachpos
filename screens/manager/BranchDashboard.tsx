import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { apiFetch } from '../../api';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const fmtEtb = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'ETB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `ETB ${v.toFixed(2)}`;
  }
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const BranchDashboard: React.FC<Props> = ({ onNavigate }) => {
  const { orders } = usePos();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [staffOnShift, setStaffOnShift] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [range, setRange] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [trend, setTrend] = useState<Array<{ key: string; revenue: number; orders: number }>>([]);
  const [recentPaid, setRecentPaid] = useState<Array<{ id: string; total: number; paidAt: string | null }>>([]);
  const [salesToday, setSalesToday] = useState(0);
  const [avgTicket, setAvgTicket] = useState(0);

  const openOrders = useMemo(() => orders.filter((o) => o.status !== 'Paid').length, [orders]);

  const resolveOwnerBranchOverride = () => {
    try {
      const raw = localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
      return String(raw || '').trim();
    } catch {
      return '';
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        const br = await apiFetch('/api/branches');
        if (br.ok) {
          const data = (await br.json().catch(() => null)) as any;
          const branches = Array.isArray(data?.branches) ? data.branches : [];
          setBranchName(branches.length === 1 ? String(branches[0]?.name || '') : '');
        }
      } catch {
        // ignore
      }

      const ov = await apiFetch(`/api/manager/overview?range=${encodeURIComponent(range)}`);
      const ovJson = (await ov.json().catch(() => null)) as any;
      if (!ov.ok) throw new Error(`HTTP ${ov.status}`);

      setStaffOnShift(Number(ovJson?.kpis?.staffOnShift ?? 0) || 0);
      const legacyTrend = Array.isArray(ovJson?.trend) ? ovJson.trend : [];
      setRecentPaid(Array.isArray(ovJson?.recentPaid) ? ovJson.recentPaid : []);

      // Prefer server-driven aggregates for today's KPIs + trend.
      // Fall back to legacy overview trend and payments query if aggregates are not available.
      try {
        const sessionRaw = (() => {
          try {
            return localStorage.getItem('mirachpos.session.v1') || '';
          } catch {
            return '';
          }
        })();
        const session = sessionRaw ? (JSON.parse(sessionRaw) as any) : null;
        const role = typeof session?.role === 'string' ? session.role : '';
        const tokenBranchId = typeof session?.branchId === 'string' ? session.branchId : '';
        const branchOverride = role === 'Cafe Owner' && (!tokenBranchId || tokenBranchId === 'global') ? resolveOwnerBranchOverride() : '';

        const now = new Date();
        const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const today = startDay.toISOString().slice(0, 10);

        const qsToday = new URLSearchParams({ from: today, to: today, limit: '10' });
        if (branchOverride) qsToday.set('branchId', branchOverride);
        const dailyRes = await apiFetch(`/api/manager/reports/daily?${qsToday.toString()}`);
        const dailyJson = (await dailyRes.json().catch(() => null)) as any;
        const dailyRows = Array.isArray(dailyJson?.daily) ? (dailyJson.daily as any[]) : [];
        const todayRow = dailyRows.find((r) => String(r?.date || '') === today) || dailyRows[0];
        const totalCollected = Number(todayRow?.totalCollected ?? 0) || 0;
        const orderCount = Number(todayRow?.orderCount ?? 0) || 0;
        if (dailyRes.ok) {
          setSalesToday(totalCollected);
          setAvgTicket(orderCount > 0 ? totalCollected / orderCount : 0);
        }

        if (range === 'Daily') {
          const qsHourly = new URLSearchParams({ date: today });
          if (branchOverride) qsHourly.set('branchId', branchOverride);
          const hRes = await apiFetch(`/api/manager/reports/hourly?${qsHourly.toString()}`);
          const hJson = (await hRes.json().catch(() => null)) as any;
          const hourly = Array.isArray(hJson?.hourly) ? (hJson.hourly as any[]) : [];
          const mapped = hourly
            .map((x) => {
              const hour = Number(x?.hour ?? 0) || 0;
              const key = `${String(hour).padStart(2, '0')}:00`;
              return {
                key,
                revenue: Number(x?.totalCollected ?? 0) || 0,
                orders: Number(x?.orderCount ?? 0) || 0,
              };
            })
            .filter((x) => x.key);
          if (hRes.ok && mapped.length > 0) setTrend(mapped);
          else setTrend(legacyTrend);
        } else {
          const days = range === 'Weekly' ? 7 : 30;
          const start = new Date(startDay);
          start.setDate(start.getDate() - (days - 1));
          const from = start.toISOString().slice(0, 10);
          const to = today;
          const qs = new URLSearchParams({ from, to, limit: String(days + 10) });
          if (branchOverride) qs.set('branchId', branchOverride);
          const dr = await apiFetch(`/api/manager/reports/daily?${qs.toString()}`);
          const dj = (await dr.json().catch(() => null)) as any;
          const rows = Array.isArray(dj?.daily) ? (dj.daily as any[]) : [];
          const mapped = rows
            .map((r) => ({
              key: String(r?.date || ''),
              revenue: Number(r?.totalCollected ?? 0) || 0,
              orders: Number(r?.orderCount ?? 0) || 0,
            }))
            .filter((x) => x.key)
            .slice(-days);
          if (dr.ok && mapped.length > 0) setTrend(mapped);
          else setTrend(legacyTrend);
        }

        if (!dailyRes.ok) {
          // Fallback to previous client-side computation if aggregates are missing.
          const qs = new URLSearchParams({ from: startDay.toISOString(), to: new Date(startDay.getTime() + 24 * 60 * 60 * 1000).toISOString(), limit: '500' });
          const pay = await apiFetch(`/api/manager/payments?${qs.toString()}`);
          const payJson = (await pay.json().catch(() => null)) as any;
          if (pay.ok && Array.isArray(payJson?.payments)) {
            const rows = payJson.payments as any[];
            const total = rows.reduce((sum, p) => sum + (Number(p?.total ?? 0) || 0), 0);
            setSalesToday(total);
            setAvgTicket(rows.length > 0 ? total / rows.length : 0);
          } else {
            setSalesToday(0);
            setAvgTicket(0);
          }
        }
      } catch {
        setTrend(legacyTrend);
        setSalesToday(0);
        setAvgTicket(0);
      }

      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch {
      setError('Start the API server (npm run dev or npm run dev:api from repo root).');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white">
      <header className="h-16 shrink-0 border-b border-[#393328] flex items-center justify-between px-6 lg:px-10 bg-[#181611]">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold leading-tight tracking-tight">Overview</h2>
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-[#b9b09d]">Branch:</span>
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-[#393328] text-white">{branchName || 'Current Branch'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex bg-[#393328] rounded-lg p-1">
            {(['Daily', 'Weekly', 'Monthly'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded text-xs font-bold transition-colors ${range === r ? 'bg-[#181611] text-white shadow-sm' : 'text-[#b9b09d] hover:text-white'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => onNavigate(Screen.MANAGER_ORDERS)}
            className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>receipt_long</span>
            <span className="hidden sm:inline">Orders</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="text-xs text-[#b9b09d]">{lastUpdatedAt ? `Last updated: ${lastUpdatedAt}` : null}</div>
            {loading ? <div className="text-xs text-[#b9b09d]">Loading ¦</div> : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-[#eead2b]">
                  <span className="material-symbols-outlined">payments</span>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Total Sales (Today)</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{fmtEtb(salesToday)}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">receipt_long</span>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Active Orders</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{openOrders.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">group</span>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Staff On Shift</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{staffOnShift.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-xl p-5 bg-[#393328] border border-[#544b3b] shadow-lg">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-[#2d2820] rounded-lg text-white">
                  <span className="material-symbols-outlined">bar_chart</span>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[#b9b09d] text-sm font-medium">Avg Ticket (Today)</p>
                <p className="text-white text-2xl font-bold tracking-tight mt-1">{fmtEtb(avgTicket)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[#544b3b] bg-[#221c10] p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white text-lg font-bold">Revenue Analytics</h3>
                  <p className="text-[#b9b09d] text-sm">Revenue & orders ({range})</p>
                </div>
              </div>

              <div className="h-64 w-full rounded-lg border border-[#393328] bg-[#1a1611]">
                {trend.length === 0 ? (
                  <div className="h-full flex items-center justify-center px-6 text-center">
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-bold text-white">No revenue history yet</div>
                      <div className="text-xs text-[#b9b09d]">This chart will populate after paid orders are recorded.</div>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
                      <CartesianGrid stroke="#393328" strokeDasharray="3 3" />
                      <XAxis dataKey="key" stroke="#b9b09d" tick={{ fontSize: 10 }} />
                      <YAxis stroke="#b9b09d" tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: '#221c10', border: '1px solid #544b3b', borderRadius: 8, color: '#fff' }}
                        labelStyle={{ color: '#b9b09d' }}
                        formatter={(value: any, name: any) => {
                          if (name === 'revenue') return [fmtEtb(Number(value || 0) || 0), 'Revenue'];
                          return [String(value), 'Orders'];
                        }}
                      />
                      <Line type="monotone" dataKey="revenue" stroke="#eead2b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="orders" stroke="#4ade80" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#544b3b] bg-[#221c10] p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white text-lg font-bold">Recent Paid Orders</h3>
                  <p className="text-[#b9b09d] text-sm">Latest completed transactions</p>
                </div>
              </div>
              {recentPaid.length === 0 ? (
                <div className="h-64 w-full rounded-lg border border-dashed border-[#393328] bg-[#1a1611] flex items-center justify-center px-6 text-center">
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-bold text-white">No paid orders yet</div>
                    <div className="text-xs text-[#b9b09d]">Complete a payment in POS to see transactions here.</div>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[#393328]">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#27231c] text-[#b9b09d] text-xs uppercase tracking-wider">
                          <th className="px-4 py-3 font-medium">Order</th>
                          <th className="px-4 py-3 font-medium text-right">Total</th>
                          <th className="px-4 py-3 font-medium">Paid At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#393328] text-sm">
                        {recentPaid.map((o) => (
                          <tr key={o.id} className="hover:bg-[#393328]/30 transition-colors">
                            <td className="px-4 py-3 text-white font-medium">{o.id}</td>
                            <td className="px-4 py-3 text-white text-right font-medium">{fmtEtb(o.total)}</td>
                            <td className="px-4 py-3 text-[#b9b09d]">{o.paidAt ? new Date(o.paidAt).toLocaleString() : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
