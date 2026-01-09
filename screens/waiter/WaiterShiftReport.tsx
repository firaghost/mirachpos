import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { formatDeviceDateTime } from '../../datetime';

type ShiftLog = {
  id: string;
  staffId: string;
  staffName?: string;
  clockInAt: string;
  clockOutAt?: string;
};

type Resp = {
  ok: boolean;
  branchId: string;
  staffId: string;
  shiftLogs: ShiftLog[];
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

const fmtTime = (iso?: string) => {
  if (!iso) return ' ”';
  const s = formatDeviceDateTime(iso, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return s || ' ”';
};

const hoursBetween = (aIso: string, bIso?: string) => {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso || new Date().toISOString()).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / (1000 * 60 * 60));
};

export const WaiterShiftReport: React.FC<Props> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [remote, setRemote] = useState<Resp | null>(null);

  const load = async (mounted: { current: boolean }) => {
    setLoading(true);
    setErr('');
    try {
      const res = await apiFetch('/api/waiter/shift-report');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      if (!mounted.current) return;
      setRemote(json as Resp);
    } catch (e) {
      if (!mounted.current) return;
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    const mounted = { current: true };
    void load(mounted);
    return () => {
      mounted.current = false;
    };
  }, []);

  const rows = useMemo(() => {
    const src = Array.isArray(remote?.shiftLogs) ? remote!.shiftLogs : [];
    return [...src].sort((a, b) => String(b.clockInAt || '').localeCompare(String(a.clockInAt || '')));
  }, [remote]);

  const totals = useMemo(() => {
    const totalHours = rows.reduce((sum, r) => sum + hoursBetween(r.clockInAt, r.clockOutAt), 0);
    const openCount = rows.filter((r) => !r.clockOutAt).length;
    return { totalHours, openCount, shifts: rows.length };
  }, [rows]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white">
      <header className="flex items-center justify-between px-6 py-5 border-b border-[#393328] bg-[#221c10]">
        <div>
          <div className="text-2xl font-extrabold tracking-tight">Shift Report</div>
          <div className="text-xs text-[#b9b09d] mt-1">View-only shift activity.</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}
            className="h-10 px-4 rounded-lg border border-[#393328] bg-[#181611] hover:bg-[#2c241b] text-[#c9b792] font-bold"
          >
            Back
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {err ? <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">{err}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-[#393328] bg-[#221c10] p-5">
              <div className="text-xs text-[#b9b09d] font-bold uppercase tracking-wider">Shifts</div>
              <div className="text-3xl font-black mt-2">{loading ? ' ”' : totals.shifts}</div>
            </div>
            <div className="rounded-xl border border-[#393328] bg-[#221c10] p-5">
              <div className="text-xs text-[#b9b09d] font-bold uppercase tracking-wider">Open Shifts</div>
              <div className="text-3xl font-black mt-2">{loading ? ' ”' : totals.openCount}</div>
            </div>
            <div className="rounded-xl border border-[#393328] bg-[#221c10] p-5">
              <div className="text-xs text-[#b9b09d] font-bold uppercase tracking-wider">Total Hours (approx)</div>
              <div className="text-3xl font-black mt-2">{loading ? ' ”' : totals.totalHours.toFixed(1)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-[#393328] bg-[#221c10] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#393328] flex items-center justify-between">
              <div className="text-sm font-extrabold">Shift Logs</div>
              <button
                onClick={() => void load({ current: true })}
                className="h-9 px-3 rounded-lg bg-[#181611] border border-[#393328] text-[#c9b792] hover:text-white"
              >
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-[#b9b09d] uppercase tracking-wider">
                  <tr className="border-b border-[#393328]">
                    <th className="text-left px-5 py-3">Staff</th>
                    <th className="text-left px-5 py-3">Clock In</th>
                    <th className="text-left px-5 py-3">Clock Out</th>
                    <th className="text-right px-5 py-3">Hours</th>
                    <th className="text-left px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2c241b]">
                  {loading ? (
                    <tr>
                      <td className="px-5 py-6 text-[#b9b09d]" colSpan={5}>
                        Loading ¦
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="px-5 py-6 text-[#b9b09d]" colSpan={5}>
                        No shifts yet.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const hrs = hoursBetween(r.clockInAt, r.clockOutAt);
                      return (
                        <tr key={r.id} className="hover:bg-white/5">
                          <td className="px-5 py-4 font-semibold">{r.staffName || r.staffId}</td>
                          <td className="px-5 py-4 text-[#c9b792]">{fmtTime(r.clockInAt)}</td>
                          <td className="px-5 py-4 text-[#c9b792]">{fmtTime(r.clockOutAt)}</td>
                          <td className="px-5 py-4 text-right font-mono">{hrs.toFixed(2)}</td>
                          <td className="px-5 py-4">
                            {r.clockOutAt ? (
                              <span className="inline-flex items-center h-7 px-2 rounded-full text-xs font-bold bg-white/5 border border-white/10 text-[#c9b792]">Closed</span>
                            ) : (
                              <span className="inline-flex items-center h-7 px-2 rounded-full text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">Open</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[11px] text-[#8e826f]">
            This is view-only. If your staff shifts are managed externally, your manager can configure shift tracking.
          </div>
        </div>
      </div>
    </div>
  );
};
