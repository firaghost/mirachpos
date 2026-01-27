import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { Screen } from '../types';
import { readSession, updateSession } from '../session';
import { OwnerPageHeader } from '../components/OwnerPageHeader';

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const normalizeBranchId = (v: string) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === 'global') return '';
  // Legacy/dev ids sometimes use b_ while the API uses br_
  if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
  return s;
};

const resolveBranchIdForSchedule = (): string => {
  const s = readSession<any>();
  const role = typeof s?.role === 'string' ? s.role : '';
  const branchId = typeof s?.branchId === 'string' ? s.branchId : '';
  const norm = normalizeBranchId(branchId);
  if (norm) return norm;
  if (role === 'Cafe Owner') {
    try {
      const stored =
        localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
        localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
        '';
      return normalizeBranchId(stored);
    } catch {
      return '';
    }
  }
  return '';
};

const openOwnerBranchSelect = () => {
  try {
    updateSession({ screen: Screen.BRANCH_SELECT });
  } catch {
    // ignore
  }
  try {
    localStorage.setItem('mirachpos.branchSelect.returnScreen.v1', String(Screen.STAFF_SCHEDULE));
    localStorage.setItem('mirachpos.lastScreen.v1', String(Screen.BRANCH_SELECT));
  } catch {
    // ignore
  }
  try {
    window.location.hash = `#${String(Screen.BRANCH_SELECT)}`;
  } catch {
    // ignore
  }
};

type ApiStaffLite = {
  id: string;
  name: string;
  roleName?: string;
};

type ApiRow = {
  staffId: string;
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
  sun: string;
};

type ApiResp = {
  ok: boolean;
  branchId: string;
  weekStart: string;
  staff: ApiStaffLite[];
  rows: ApiRow[];
  readOnly?: boolean;
};

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

const weekStartOf = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diffToMon = (day + 6) % 7;
  x.setDate(x.getDate() - diffToMon);
  return x;
};

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
};

const emptyRow = (staffId: string): ApiRow => ({ staffId, mon: 'Off', tue: 'Off', wed: 'Off', thu: 'Off', fri: 'Off', sat: 'Off', sun: 'Off' });

const dayKeys: Array<keyof Omit<ApiRow, 'staffId'>> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const ShiftSchedule: React.FC<{ readOnly?: boolean }> = ({ readOnly }) => {
  const [weekStart, setWeekStart] = useState(() => toIsoDate(weekStartOf(new Date())));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [remote, setRemote] = useState<ApiResp | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [rows, setRows] = useState<ApiRow[]>([]);

  const effectiveReadOnly = Boolean(readOnly || remote?.readOnly);

  const staffById = useMemo(() => {
    const m = new Map<string, ApiStaffLite>();
    for (const s of remote?.staff ?? []) m.set(s.id, s);
    return m;
  }, [remote]);

  const mergedRows = useMemo(() => {
    const staff = remote?.staff ?? [];
    const byId = new Map<string, ApiRow>();
    for (const r of rows) byId.set(r.staffId, r);
    return staff.map((s) => byId.get(s.id) ?? emptyRow(s.id));
  }, [remote, rows]);

  useEffect(() => {
    const onChanged = () => {
      setErr('');
      setOk('');
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener('mirachpos-session-changed', onChanged);
    return () => window.removeEventListener('mirachpos-session-changed', onChanged);
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      setErr('');
      setOk('');
      try {
        const branchId = resolveBranchIdForSchedule();
        const sess = readSession();
        const role = typeof sess?.role === 'string' ? sess.role : '';
        if (role === 'Cafe Owner' && !branchId) {
          throw new Error('select_branch');
        }
        const qs = new URLSearchParams({ weekStart });
        if (branchId) qs.set('branchId', branchId);
        const res = await apiFetch(`/api/schedule?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const code = String(json?.error || String(res.status));
          if (code === 'branch_not_found' || code === 'branch_required') throw new Error('select_branch');
          throw new Error(code);
        }
        if (!mounted) return;
        const r = json as ApiResp;
        setRemote(r);
        setRows(Array.isArray(r.rows) ? r.rows : []);
        setEditMode(false);
      } catch (e) {
        if (!mounted) return;
        setRemote(null);
        setRows([]);
        setEditMode(false);
        const msg = e instanceof Error ? e.message : 'Failed to load schedule';
        setErr(msg);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [weekStart, refreshNonce]);

  const updateCell = (staffId: string, day: keyof Omit<ApiRow, 'staffId'>, value: string) => {
    setRows((prev) => {
      const map = new Map<string, ApiRow>(prev.map((r) => [r.staffId, r] as [string, ApiRow]));
      const cur: ApiRow = map.get(staffId) ?? emptyRow(staffId);
      const next: ApiRow = { ...cur, [day]: value };
      map.set(staffId, next);
      return Array.from(map.values());
    });
  };

  const save = async () => {
    if (saving) return;
    if (effectiveReadOnly) return;
    setSaving(true);
    setErr('');
    setOk('');
    try {
      const branchId = resolveBranchIdForSchedule();
      const res = await apiFetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart,
          branchId: branchId || undefined,
          rows: mergedRows,
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setOk('Saved.');
      setEditMode(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <OwnerPageHeader
        title="Shift Schedule"
        leftSlot={<div className="text-xs text-muted-foreground">{effectiveReadOnly ? 'View-only' : 'Create and manage weekly shifts'}</div>}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRefreshNonce((n) => n + 1)}
              disabled={loading || saving}
              className="h-10 px-3 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
              type="button"
            >
              Refresh
            </button>
            <button
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="h-10 px-3 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground"
              type="button"
            >
              Prev
            </button>
            <button
              onClick={() => setWeekStart(toIsoDate(weekStartOf(new Date())))}
              className="h-10 px-3 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground"
              type="button"
            >
              Current
            </button>
            <button
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="h-10 px-3 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground"
              type="button"
            >
              Next
            </button>
            <input
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="h-10 px-3 rounded-lg border border-border bg-background text-foreground"
              type="text"
            />
            {!effectiveReadOnly ? (
              <>
                <button
                  onClick={() => setEditMode((v) => !v)}
                  disabled={loading}
                  className="h-10 px-3 rounded-lg border border-border bg-background hover:bg-accent text-foreground font-bold disabled:opacity-50"
                  type="button"
                >
                  {editMode ? 'Done' : 'Edit'}
                </button>
                <button
                  onClick={save}
                  disabled={loading || saving}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground font-extrabold disabled:opacity-50"
                  type="button"
                >
                  {saving ? 'Saving ' : 'Save'}
                </button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          {err === 'select_branch' ? (
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="text-sm font-extrabold">Select a branch to view schedules</div>
              <div className="text-xs text-muted-foreground mt-1">
                As an Owner, schedules are branch-specific. Choose a branch first.
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={openOwnerBranchSelect}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground font-extrabold"
                >
                  Choose Branch
                </button>
              </div>
            </div>
          ) : null}
          {err ? <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{err}</div> : null}
          {ok ? <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-sm">{ok}</div> : null}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-extrabold">Week of {weekStart}</div>
              <div className="text-[11px] text-muted-foreground">Branch: {remote?.branchId || ' ”'}    Staff: {(remote?.staff?.length ?? 0) || 0}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wider">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3">Employee</th>
                    <th className="text-left px-4 py-3">Role</th>
                    {dayKeys.map((d) => (
                      <th key={d} className="text-left px-4 py-3">{d.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr><td colSpan={2 + dayKeys.length} className="px-4 py-6 text-muted-foreground">Loading </td></tr>
                  ) : mergedRows.length === 0 ? (
                    <tr><td colSpan={2 + dayKeys.length} className="px-4 py-6 text-muted-foreground">No staff found for this branch.</td></tr>
                  ) : (
                    mergedRows.map((r) => {
                      const s = staffById.get(r.staffId);
                      return (
                        <tr key={r.staffId} className="hover:bg-accent/50">
                          <td className="px-4 py-3 font-semibold">{s?.name || r.staffId}</td>
                          <td className="px-4 py-3 text-muted-foreground">{s?.roleName || ' ”'}</td>
                          {dayKeys.map((d) => (
                            <td key={d} className="px-4 py-3">
                              {editMode && !effectiveReadOnly ? (
                                <input
                                  value={String((r as any)[d] || '')}
                                  onChange={(e) => updateCell(r.staffId, d, e.target.value)}
                                  className="h-9 w-28 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                                />
                              ) : (
                                <span className={cx('inline-flex items-center px-2 py-1 rounded-lg text-xs border', String((r as any)[d] || '') === 'Off' ? 'border-border text-muted-foreground' : 'border-primary/30 text-primary')}>
                                  {String((r as any)[d] || '') || 'Off'}
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Tip: Enter shift text like  œ08:00-16:00  or  œOff .
          </div>
        </div>
      </div>
    </div>
  );
};
