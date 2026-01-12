import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { PortalMenu, type PortalMenuAnchorRect } from '../../components/PortalMenu';
import { Screen } from '../../types';

export const OwnerBranches: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'All' | 'Open' | 'Closed' | 'Maintenance'>('All');
  const [region, setRegion] = useState('All');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [branches, setBranches] = useState<
    Array<{ id: string; name: string; managerName: string; city: string; region: string; address: string; phone: string; staffCount: number; status: 'Open' | 'Closed' | 'Maintenance'; rating: number }>
  >([]);

  const [perfById, setPerfById] = useState<Record<string, { revenueToday: number; ordersToday: number }>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<PortalMenuAnchorRect | null>(null);
  const [form, setForm] = useState({
    name: '',
    managerName: '',
    city: '',
    address: '',
    phone: '',
    status: 'Open' as 'Open' | 'Closed' | 'Maintenance',
    rating: '4.6',
  });

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/branches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        branches: Array<{
          id: string;
          name: string;
          managerName?: string;
          city?: string;
          region?: string;
          address?: string;
          phone?: string;
          staffCount?: number;
          status: string;
          rating: number;
        }>;
      };
      const list = Array.isArray(data.branches) ? data.branches : [];
      setBranches(
        list.map((b) => ({
          id: b.id,
          name: b.name,
          managerName: b.managerName || '',
          city: b.city || '',
          region: (b.region || b.city || '').toString(),
          address: b.address || '',
          phone: b.phone || '',
          staffCount: typeof b.staffCount === 'number' ? b.staffCount : 0,
          status: (b.status === 'Closed' || b.status === 'Maintenance' ? b.status : 'Open') as 'Open' | 'Closed' | 'Maintenance',
          rating: typeof b.rating === 'number' ? b.rating : 4.6,
        })),
      );

      try {
        const ov = await apiFetch('/api/owner/overview');
        if (ov.ok) {
          const odata = (await ov.json()) as {
            branches: Array<{ id: string; revenueToday: number; ordersToday: number }>;
          };
          const map: Record<string, { revenueToday: number; ordersToday: number }> = {};
          for (const r of Array.isArray(odata.branches) ? odata.branches : []) {
            map[r.id] = { revenueToday: Number(r.revenueToday) || 0, ordersToday: Number(r.ordersToday) || 0 };
          }
          setPerfById(map);
        }
      } catch {
        // ignore
      }
    } catch {
      setError('Backend not reachable. Start API server (npm run dev:api).');
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ name: '', managerName: '', city: '', address: '', phone: '', status: 'Open', rating: '4.6' });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (b: (typeof branches)[number]) => {
    setEditingId(b.id);
    setForm({
      name: b.name,
      managerName: b.managerName,
      city: b.city,
      address: b.address,
      phone: b.phone,
      status: b.status,
      rating: String(b.rating ?? 4.6),
    });
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const saveBranch = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Branch name is required.');
      return;
    }
    const ratingNum = Number(form.rating);
    const rating = Number.isFinite(ratingNum) ? Math.min(5, Math.max(0, ratingNum)) : 4.6;

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const res = await apiFetch(`/api/branches/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            managerName: form.managerName.trim(),
            city: form.city.trim(),
            address: form.address.trim(),
            phone: form.phone.trim(),
            status: form.status,
            rating,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await apiFetch('/api/branches/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            managerName: form.managerName.trim(),
            city: form.city.trim(),
            address: form.address.trim(),
            phone: form.phone.trim(),
            status: form.status,
            rating,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        try {
          const json = (await res.json().catch(() => null)) as any;
          const id = typeof json?.id === 'string' ? json.id : '';
          if (id) localStorage.setItem('mirachpos.owner.selectedBranchId.v1', id);
        } catch {
          // ignore
        }
      }

      await fetchBranches();
      setModalOpen(false);
    } catch {
      setError('Failed to save branch. Make sure the API server is running.');
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async (id: string) => {
    if (saving) return;
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const closeDelete = () => {
    if (saving) return;
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const confirmDelete = async () => {
    const id = deleteTargetId;
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/branches/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchBranches();
      setDeleteConfirmOpen(false);
      setDeleteTargetId(null);
    } catch {
      setError('Failed to delete branch. Make sure the API server is running.');
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => {
      const statusOk = status === 'All' ? true : b.status === status;
      const regionOk = region === 'All' ? true : (b.region || '').toLowerCase() === region.toLowerCase();
      const qOk =
        !q ||
        b.name.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.city.toLowerCase().includes(q) ||
        b.address.toLowerCase().includes(q);
      return statusOk && regionOk && qOk;
    });
  }, [branches, query, region, status]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const b of branches) {
      const r = (b.region || b.city || '').trim();
      if (r) set.add(r);
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [branches]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [safePage, visible]);

  useEffect(() => {
    setPage(1);
  }, [query, status, region]);

  const totalStaff = useMemo(() => branches.reduce((sum, b) => sum + (Number(b.staffCount) || 0), 0), [branches]);
  const topPerforming = useMemo(() => {
    let best: { id: string; name: string; revenueToday: number } | null = null;
    for (const b of branches) {
      const perf = perfById[b.id];
      const rev = perf ? Number(perf.revenueToday) || 0 : 0;
      if (!best || rev > best.revenueToday) best = { id: b.id, name: b.name, revenueToday: rev };
    }
    return best;
  }, [branches, perfById]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f8f7f6] dark:bg-[#221c10] text-[#111418] dark:text-white">
      <OwnerPageHeader
        title="Branch Management"
        rightSlot={
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center bg-[#393328] rounded-lg h-10 w-72 px-3 gap-2">
              <span className="material-symbols-outlined text-[#b9b09d]" style={{ fontSize: 20 }}>search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent border-none text-sm text-white placeholder-[#b9b09d] focus:ring-0 w-full p-0"
                placeholder="Search branches ¦"
                type="text"
              />
            </div>
            <button
              onClick={fetchBranches}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={openAdd}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add_business</span>
              <span className="hidden sm:inline">Add Branch</span>
            </button>
          </div>
        }
      />

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        {/* Filters & Search */}
        <div className="flex flex-col xl:flex-row gap-4 mb-6">
          {/* Filters */}
          <div className="flex gap-4">
            <div className="relative min-w-[180px]">
              <select
                value={status}
                onChange={(e) => setStatus((e.target.value || 'All') as 'All' | 'Open' | 'Closed' | 'Maintenance')}
                className="w-full h-12 bg-white dark:bg-[#2c261e] text-[#111418] dark:text-white border border-gray-200 dark:border-[#393328] rounded-lg text-sm px-4 focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] appearance-none cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Open">Active / Open</option>
                <option value="Closed">Inactive / Closed</option>
                <option value="Maintenance">Maintenance</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#b9b09d] pointer-events-none text-lg">expand_more</span>
            </div>
            <div className="relative min-w-[180px]">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value || 'All')}
                className="w-full h-12 bg-white dark:bg-[#2c261e] text-[#111418] dark:text-white border border-gray-200 dark:border-[#393328] rounded-lg text-sm px-4 focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] appearance-none cursor-pointer"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r === 'All' ? 'All Regions' : r}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#b9b09d] pointer-events-none text-lg">expand_more</span>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-900/10 text-red-400 p-4 flex items-center justify-between gap-4">
            <div className="text-sm">{error}</div>
            <button onClick={fetchBranches} className="h-10 px-4 rounded-lg bg-[#393328] text-white hover:bg-[#322c24]">
              Retry
            </button>
          </div>
        ) : null}

        {/* Branch Table */}
        <div className="w-full overflow-hidden rounded-xl border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#2c261e] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#322c24] border-b border-gray-200 dark:border-[#393328]">
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] whitespace-nowrap">Branch ID</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] whitespace-nowrap">Branch Info</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] whitespace-nowrap">Manager</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] whitespace-nowrap">Contact</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] whitespace-nowrap">Status</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-[#b9b09d] text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-[#393328]">
                {loading ? (
                  <tr>
                    <td className="py-8 px-6 text-sm text-[#b9b09d]" colSpan={6}>
                      Loading branches...
                    </td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td className="py-8 px-6 text-sm text-[#b9b09d]" colSpan={6}>
                      No branches found.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((b) => (
                    <tr key={b.id} className="group hover:bg-gray-50 dark:hover:bg-[#322c24]/50 transition-colors">
                      <td className="py-4 px-6 align-middle">
                        <span className="font-mono text-xs text-[#b9b09d] bg-[#393328]/30 px-2 py-1 rounded">{b.id}</span>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-lg bg-[#eead2b]/10 text-[#eead2b] flex items-center justify-center font-black">
                            {b.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-[#111418] dark:text-white">{b.name}</span>
                            <span className="text-xs text-[#b9b09d]">
                              {[b.address, b.city].map((x) => x.trim()).filter(Boolean).join(', ') || ' ”'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-[#eead2b]/20 text-[#eead2b] flex items-center justify-center text-[10px] font-bold">
                            {(b.managerName || ' ”').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-[#111418] dark:text-white">{b.managerName || ' ”'}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex flex-col">
                          <span className="text-sm text-[#111418] dark:text-white">{b.phone || ' ”'}</span>
                          <span className="text-xs text-[#b9b09d]">Rating: {b.rating.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-3">
                          <span
                            className={`text-xs font-medium ${
                              b.status === 'Open' ? 'text-emerald-400' : b.status === 'Maintenance' ? 'text-amber-500' : 'text-[#b9b09d]'
                            }`}
                          >
                            {b.status}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle text-right">
                        <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="p-2 rounded-lg text-[#b9b09d] hover:text-white hover:bg-[#393328] transition-colors"
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              try {
                                const rect = (ev.currentTarget as any)?.getBoundingClientRect?.();
                                if (rect) {
                                  setRowMenuAnchor({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                                } else {
                                  setRowMenuAnchor(null);
                                }
                              } catch {
                                setRowMenuAnchor(null);
                              }
                              setRowMenuId((prev) => (prev === b.id ? null : b.id));
                            }}
                          >
                            <span className="material-symbols-outlined text-[20px]">more_vert</span>
                          </button>

                          <PortalMenu
                            open={rowMenuId === b.id}
                            anchorRect={rowMenuId === b.id ? rowMenuAnchor : null}
                            onClose={() => {
                              setRowMenuId(null);
                              setRowMenuAnchor(null);
                            }}
                            width={200}
                          >
                            <button
                              type="button"
                              className="w-full px-4 py-3 text-left text-sm text-white hover:bg-[#2c241b]"
                              onClick={() => {
                                try {
                                  localStorage.setItem('mirachpos.owner.selectedBranchId.v1', String(b.id));
                                } catch {
                                  // ignore
                                }
                                try {
                                  window.location.hash = `#${String(Screen.OWNER_DASHBOARD)}`;
                                } catch {
                                  // ignore
                                }
                                setRowMenuId(null);
                                setRowMenuAnchor(null);
                              }}
                            >
                              View Dashboard
                            </button>
                            <button
                              type="button"
                              className="w-full px-4 py-3 text-left text-sm text-white hover:bg-[#2c241b]"
                              onClick={() => {
                                openEdit(b);
                                setRowMenuId(null);
                                setRowMenuAnchor(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="w-full px-4 py-3 text-left text-sm text-red-300 hover:bg-[#2c241b]"
                              onClick={() => {
                                deleteBranch(b.id);
                                setRowMenuId(null);
                                setRowMenuAnchor(null);
                              }}
                            >
                              Delete
                            </button>
                          </PortalMenu>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-[#393328] flex items-center justify-between">
            <p className="text-sm text-[#b9b09d]">
              Showing <span className="font-bold text-[#111418] dark:text-white">{pageRows.length}</span> of{' '}
              <span className="font-bold text-[#111418] dark:text-white">{visible.length}</span> branches
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 text-sm rounded-md border border-gray-200 dark:border-[#393328] text-[#b9b09d] hover:bg-gray-100 dark:hover:bg-[#393328] disabled:opacity-50"
                disabled={safePage <= 1}
              >
                Previous
              </button>
              <button className="px-3 py-1 text-sm rounded-md bg-[#eead2b] text-[#1a160e] font-bold">{safePage}</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 text-sm rounded-md border border-gray-200 dark:border-[#393328] text-[#b9b09d] hover:bg-gray-100 dark:hover:bg-[#393328] disabled:opacity-50"
                disabled={safePage >= totalPages}
              >
                Next
              </button>
              <button className="px-3 py-1 text-sm rounded-md border border-gray-200 dark:border-[#393328] text-[#b9b09d] hover:bg-gray-100 dark:hover:bg-[#393328]" onClick={fetchBranches}>
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats Cards below table */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            <div className="bg-white dark:bg-[#2c261e] p-6 rounded-xl border border-gray-200 dark:border-[#393328] flex items-start justify-between">
                <div>
                    <p className="text-[#b9b09d] text-sm font-medium mb-1">Total Branches</p>
                    <p className="text-3xl font-bold text-[#111418] dark:text-white">{branches.length}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-[#eead2b]/10 flex items-center justify-center text-[#eead2b]">
                    <span className="material-symbols-outlined">store</span>
                </div>
            </div>
            <div className="bg-white dark:bg-[#2c261e] p-6 rounded-xl border border-gray-200 dark:border-[#393328] flex items-start justify-between">
                <div>
                    <p className="text-[#b9b09d] text-sm font-medium mb-1">Active Staff</p>
                    <p className="text-3xl font-bold text-[#111418] dark:text-white">{totalStaff}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-white-500/10 flex items-center justify-center text-white-500">
                    <span className="material-symbols-outlined">badge</span>
                </div>
            </div>
             <div className="bg-white dark:bg-[#2c261e] p-6 rounded-xl border border-gray-200 dark:border-[#393328] flex items-start justify-between">
                <div>
                    <p className="text-[#b9b09d] text-sm font-medium mb-1">Top Performing</p>
                    <p className="text-lg font-bold text-[#111418] dark:text-white truncate">{topPerforming?.name || 'No data'}</p>
                    <p className="text-xs text-[#b9b09d] mt-1">Today: {topPerforming ? `ETB ${topPerforming.revenueToday.toLocaleString()}` : 'No data'}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <span className="material-symbols-outlined">trending_up</span>
                </div>
            </div>
        </div>

        {modalOpen ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div onClick={closeModal} className="absolute inset-0 bg-black/60"></div>
            <div className="relative w-full max-w-2xl rounded-2xl border border-[#393328] bg-white dark:bg-[#2c261e] text-[#111418] dark:text-white shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#393328]">
                <div className="text-lg font-black">{editingId ? 'Edit Branch' : 'Add Branch'}</div>
                <button onClick={closeModal} disabled={saving} className="h-9 w-9 rounded-lg bg-gray-100 dark:bg-[#322c24] hover:bg-gray-200 dark:hover:bg-[#393328] disabled:opacity-60">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Branch Name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Manager Name</span>
                  <input
                    value={form.managerName}
                    onChange={(e) => setForm((p) => ({ ...p, managerName: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">City</span>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Phone</span>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="tel"
                  />
                </label>

                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Address</span>
                  <input
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as 'Open' | 'Closed' | 'Maintenance' }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                  >
                    <option value="Open">Open</option>
                    <option value="Closed">Closed</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-[#b9b09d]">Rating (0-5)</span>
                  <input
                    value={form.rating}
                    onChange={(e) => setForm((p) => ({ ...p, rating: e.target.value }))}
                    className="h-11 rounded-lg border border-gray-200 dark:border-[#393328] bg-white dark:bg-[#221c10] px-3 focus:ring-2 focus:ring-[#eead2b]"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                  />
                </label>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 dark:border-[#393328] flex flex-col sm:flex-row gap-3 justify-end">
                <button onClick={closeModal} disabled={saving} className="h-11 px-4 rounded-lg bg-gray-100 dark:bg-[#322c24] hover:bg-gray-200 dark:hover:bg-[#393328] disabled:opacity-60">
                  Cancel
                </button>
                <button onClick={saveBranch} disabled={saving} className="h-11 px-5 rounded-lg bg-[#eead2b] hover:bg-amber-400 text-[#1a160e] font-bold disabled:opacity-60">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteConfirmOpen ? (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div onClick={closeDelete} className="absolute inset-0 bg-black/60"></div>
            <div className="relative w-full max-w-md rounded-2xl border border-[#393328] bg-white dark:bg-[#2c261e] text-[#111418] dark:text-white shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#393328]">
                <div className="text-lg font-black">Delete Branch</div>
                <button onClick={closeDelete} className="text-[#b9b09d] hover:text-[#111418] dark:hover:text-white" type="button" disabled={saving}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="px-6 py-5 text-sm text-[#5c554a] dark:text-[#c9b792]">
                This will permanently delete the branch and remove demo events associated with it. This action cannot be undone.
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-[#393328]">
                <button onClick={closeDelete} className="h-10 px-4 rounded-lg bg-white dark:bg-[#2c241b] border border-[#e6e2db] dark:border-[#3d3429] text-[#221c10] dark:text-white hover:bg-[#f8f7f6] dark:hover:bg-[#3d3429] disabled:opacity-60" disabled={saving} type="button">
                  Cancel
                </button>
                <button onClick={confirmDelete} className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-60" disabled={saving} type="button">
                  {saving ? 'Deleting ¦' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
