import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Modal } from '../../components/Modal';

type ApiStaff = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  branchId: string;
  roleId: string;
  roleName: string;
  status: 'Active' | 'On Leave' | 'Suspended';
  lastLoginAt: string;
  createdAt: string;
};

type StaffResp = {
  staff: ApiStaff[];
  page: number;
  pageSize: number;
  total: number;
  branchId?: string;
};

type ActivityEvent = {
  id: string;
  type: string;
  branchId: string;
  at: string;
  payload: Record<string, unknown>;
};

type ActivityResp = { events: ActivityEvent[]; page: number; pageSize: number; total: number; branchId?: string };

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const statusBadgeClass = (status: ApiStaff['status']) => {
  const base = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-bold border';
  if (status === 'Active') return `${base} bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800`;
  if (status === 'On Leave') return `${base} bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700`;
  return `${base} bg-red-50 text-red-700 border-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800`;
};

export const ManagerTeam: React.FC = () => {
  const [tab, setTab] = useState<'staff' | 'activity'>('staff');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StaffResp | null>(null);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | ApiStaff['status']>('Active');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [banner, setBanner] = useState<null | { kind: 'success' | 'error'; message: string }>(null);

  const staff = data?.staff || [];
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPassword, setDraftPassword] = useState('');
  const [draftPin, setDraftPin] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftStatus, setDraftStatus] = useState<ApiStaff['status']>('Active');

  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiStaff | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStatus, setEditStatus] = useState<ApiStaff['status']>('Active');
  const [editPin, setEditPin] = useState('');

  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityResp | null>(null);
  const [activityQ, setActivityQ] = useState('');
  const [activityType, setActivityType] = useState('');
  const [activityPage, setActivityPage] = useState(1);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await apiFetch(`/api/manager/staff?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as StaffResp;
      setData({
        staff: Array.isArray(json.staff) ? json.staff : [],
        page: Number(json.page) || page,
        pageSize: Number(json.pageSize) || pageSize,
        total: Number(json.total) || 0,
        branchId: json.branchId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, status]);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const params = new URLSearchParams();
      if (activityQ.trim()) params.set('q', activityQ.trim());
      if (activityType) params.set('type', activityType);
      params.set('page', String(activityPage));
      params.set('pageSize', '10');

      const res = await apiFetch(`/api/manager/staff/activity?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ActivityResp;
      setActivity({
        events: Array.isArray(json.events) ? json.events : [],
        page: Number(json.page) || activityPage,
        pageSize: Number(json.pageSize) || 10,
        total: Number(json.total) || 0,
        branchId: json.branchId,
      });
    } catch (e) {
      setActivityError(e instanceof Error ? e.message : 'Failed to load activity');
      setActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, [activityPage, activityQ, activityType]);

  useEffect(() => {
    if (tab !== 'staff') return;
    fetchStaff();
  }, [fetchStaff, tab]);

  useEffect(() => {
    if (tab !== 'activity') return;
    fetchActivity();
  }, [fetchActivity, tab]);

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityQ, activityType]);

  const openAdd = () => {
    setBanner(null);
    setAddOpen(true);
    setAddLoading(false);
    setDraftName('');
    setDraftCode('');
    setDraftEmail('');
    setDraftPassword('');
    setDraftPin('');
    setDraftPhone('');
    setDraftStatus('Active');
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddLoading(false);
  };

  const submitAdd = async () => {
    if (addLoading) return;
    const name = draftName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Name is required.' });
      return;
    }
    const email = draftEmail.trim();
    if (!email) {
      setBanner({ kind: 'error', message: 'Email is required for login.' });
      return;
    }
    setAddLoading(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/manager/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: draftCode.trim(),
          email,
          password: draftPassword,
          pin: draftPin,
          phone: draftPhone.trim(),
          status: draftStatus,
        }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      closeAdd();
      const tp = typeof payload?.tempPassword === 'string' ? payload.tempPassword : '';
      const tpin = typeof payload?.tempPin === 'string' ? payload.tempPin : '';
      const msg = tp && tpin ? `Staff member created. Temp password: ${tp}. PIN: ${tpin}` : tp ? `Staff member created. Temp password: ${tp}` : tpin ? `Staff member created. PIN: ${tpin}` : 'Staff member created.';
      setBanner({ kind: 'success', message: msg });
      await fetchStaff();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create staff.' });
      setAddLoading(false);
    }
  };

  const openEdit = (s: ApiStaff) => {
    setBanner(null);
    setEditTarget(s);
    setEditName(s.name || '');
    setEditCode(s.code || '');
    setEditEmail(s.email || '');
    setEditPhone(s.phone || '');
    setEditStatus(s.status || 'Active');
    setEditPin('');
    setEditOpen(true);
    setEditLoading(false);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditLoading(false);
    setEditTarget(null);
  };

  const submitEdit = async () => {
    if (editLoading || !editTarget) return;
    const name = editName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Name is required.' });
      return;
    }
    setEditLoading(true);
    try {
      const res = await apiFetch(`/api/manager/staff/${encodeURIComponent(editTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: editCode.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
          status: editStatus,
          pin: editPin,
        }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      closeEdit();
      const tpin = typeof payload?.tempPin === 'string' ? payload.tempPin : '';
      setBanner({ kind: 'success', message: tpin ? `Staff updated. PIN: ${tpin}` : 'Staff updated.' });
      await fetchStaff();
      if (tab === 'activity') await fetchActivity();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update staff.' });
      setEditLoading(false);
    }
  };

  const showing = useMemo(() => {
    if (!total) return { start: 0, end: 0, total: 0 };
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, (page - 1) * pageSize + pageSize);
    return { start, end, total };
  }, [page, pageSize, total]);

  const activityTypes = useMemo(() => ['staff_created', 'staff_updated'], []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <main className="w-full max-w-[1440px] mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-2">Team</h1>
              <p className="text-[#b9b09d] max-w-2xl">Manage staff for your branch. Role changes are restricted by policy.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-5 h-11 bg-[#eead2b] hover:bg-[#d49a26] text-[#181611] rounded-lg text-sm font-bold transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Add Staff
              </button>
            </div>
          </div>

          {banner ? (
            <div
              className={cx(
                'rounded-xl border p-4 flex items-center justify-between gap-4 mb-6',
                banner.kind === 'success' ? 'border-emerald-500/20 bg-emerald-900/10 text-emerald-200' : 'border-red-500/20 bg-red-900/10 text-red-200',
              )}
            >
              <div className="text-sm font-medium">{banner.message}</div>
              <button onClick={() => setBanner(null)} className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 text-white">
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="bg-[#221c10] rounded-xl border border-[#393328] overflow-hidden">
            <div className="flex border-b border-[#393328] px-6">
              <button
                onClick={() => setTab('staff')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] text-sm font-bold',
                  tab === 'staff' ? 'text-[#eead2b] border-[#eead2b]' : 'text-[#b9b09d] border-transparent hover:text-white',
                )}
              >
                <span className="material-symbols-outlined text-[20px]">group</span>
                Staff
              </button>
              <button
                onClick={() => setTab('activity')}
                className={cx(
                  'relative flex items-center gap-2 px-4 py-4 border-b-[3px] text-sm font-bold',
                  tab === 'activity' ? 'text-[#eead2b] border-[#eead2b]' : 'text-[#b9b09d] border-transparent hover:text-white',
                )}
              >
                <span className="material-symbols-outlined text-[20px]">history</span>
                Activity
              </button>
            </div>

            {tab === 'staff' ? (
              <>
                <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#393328]">
                  <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                    <div className="relative w-full max-w-md">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#b9b09d]">search</span>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 rounded-lg bg-[#181611] border border-[#393328] focus:ring-1 focus:ring-[#eead2b] text-sm"
                        placeholder="Search by name, email, or code..."
                        type="text"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="h-10 bg-[#181611] rounded-lg border border-[#393328] text-sm font-semibold text-white px-3"
                    >
                      <option value="Active">Status: Active</option>
                      <option value="">Status: All</option>
                      <option value="On Leave">Status: On Leave</option>
                      <option value="Suspended">Status: Suspended</option>
                    </select>
                    <button
                      onClick={fetchStaff}
                      className="h-10 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] text-white font-bold"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="p-6 text-sm text-red-300 flex items-center justify-between">
                    <div>Failed to load staff: {error}</div>
                    <button onClick={fetchStaff} className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#181611] font-bold">
                      Retry
                    </button>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#181611] border-b border-[#393328]">
                      <tr>
                        <th className="py-4 px-6 text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Employee</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Role</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Contact</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Status</th>
                        <th className="py-4 px-6 text-xs font-bold text-[#b9b09d] uppercase tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#393328]">
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="py-10 px-6 text-sm text-[#b9b09d]">
                            Loading ¦
                          </td>
                        </tr>
                      ) : staff.length ? (
                        staff.map((s) => (
                          <tr key={s.id} className="hover:bg-[#2c241b] transition-colors">
                            <td className="py-4 px-6">
                              <div>
                                <div className="text-sm font-bold">{s.name}</div>
                                <div className="text-xs text-[#b9b09d]">Code: {s.code || s.id}</div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className="text-sm font-semibold">{s.roleName || '  '}</span>
                            </td>
                            <td className="py-4 px-6">
                              <div className="text-sm">{s.email || '  '}</div>
                              <div className="text-xs text-[#b9b09d]">{s.phone || '  '}</div>
                            </td>
                            <td className="py-4 px-6">
                              <span className={statusBadgeClass(s.status)}>
                                <span className={cx('w-1.5 h-1.5 rounded-full', s.status === 'Active' ? 'bg-emerald-500' : s.status === 'On Leave' ? 'bg-gray-400' : 'bg-red-500')} />
                                {s.status}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <button
                                onClick={() => openEdit(s)}
                                className="h-9 px-3 rounded-lg bg-[#393328] hover:bg-[#4a4234] text-white text-sm font-bold"
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-10 px-6 text-sm text-[#b9b09d]">
                            No staff found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#393328]">
                  <div className="text-xs text-[#b9b09d]">
                    Showing {showing.start}-{showing.end} of {showing.total}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="h-9 px-3 rounded-lg bg-[#393328] disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <div className="text-xs text-[#b9b09d]">Page {page} / {pageCount}</div>
                    <button
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      className="h-9 px-3 rounded-lg bg-[#393328] disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#393328]">
                  <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                    <div className="relative w-full max-w-md">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#b9b09d]">search</span>
                      <input
                        value={activityQ}
                        onChange={(e) => setActivityQ(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 rounded-lg bg-[#181611] border border-[#393328] focus:ring-1 focus:ring-[#eead2b] text-sm"
                        placeholder="Search events..."
                        type="text"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={activityType}
                      onChange={(e) => setActivityType(e.target.value)}
                      className="h-10 bg-[#181611] rounded-lg border border-[#393328] text-sm font-semibold text-white px-3"
                    >
                      <option value="">All Types</option>
                      {activityTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={fetchActivity}
                      className="h-10 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] text-white font-bold"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {activityError ? <div className="p-6 text-sm text-red-300">Failed to load activity: {activityError}</div> : null}

                <div className="divide-y divide-[#393328]">
                  {activityLoading ? (
                    <div className="p-6 text-sm text-[#b9b09d]">Loading ¦</div>
                  ) : activity?.events?.length ? (
                    activity.events.map((e) => (
                      <div key={e.id} className="p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="text-sm font-bold">{e.type}</div>
                          <div className="text-xs text-[#b9b09d]">{e.at}</div>
                        </div>
                        <pre className="mt-3 text-xs text-[#b9b09d] whitespace-pre-wrap">{JSON.stringify(e.payload || {}, null, 2)}</pre>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-sm text-[#b9b09d]">No activity yet.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <Modal open={addOpen} onClose={closeAdd} title="Add Staff">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Name</label>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Code (optional)</label>
            <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Email (required for login)</label>
            <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Password (optional)</label>
            <input value={draftPassword} onChange={(e) => setDraftPassword(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
            <div className="mt-1 text-[11px] text-[#b9b09d]">Leave empty to auto-generate a temporary password.</div>
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">PIN (optional)</label>
            <input value={draftPin} onChange={(e) => setDraftPin(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
            <div className="mt-1 text-[11px] text-[#b9b09d]">Leave empty to auto-generate a PIN for waiter login by code.</div>
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Phone (optional)</label>
            <input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Status</label>
            <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as any)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white">
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeAdd} className="h-10 px-4 rounded-lg bg-[#393328] text-white font-bold">
              Cancel
            </button>
            <button disabled={addLoading} onClick={submitAdd} className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#181611] font-extrabold disabled:opacity-50">
              {addLoading ? 'Saving ¦' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={editOpen} onClose={closeEdit} title="Manage Staff">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Code</label>
            <input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Email</label>
            <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Phone</label>
            <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Status</label>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white">
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[#b9b09d]">Set New PIN (optional)</label>
            <input value={editPin} onChange={(e) => setEditPin(e.target.value)} className="mt-1 w-full h-11 bg-[#181611] border border-[#393328] rounded-lg px-4 text-white" />
          </div>

          <div className="text-xs text-[#b9b09d]">Role changes are not allowed for Branch Managers.</div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={closeEdit} className="h-10 px-4 rounded-lg bg-[#393328] text-white font-bold">
              Cancel
            </button>
            <button disabled={editLoading} onClick={submitEdit} className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#181611] font-extrabold disabled:opacity-50">
              {editLoading ? 'Saving ¦' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
