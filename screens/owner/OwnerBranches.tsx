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
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <OwnerPageHeader
        title="Branch Management"
        rightSlot={
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center bg-muted rounded-lg h-10 w-72 px-3 gap-2">
              <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 20 }}>search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent border-none text-sm text-foreground placeholder:text-muted-foreground focus:ring-0 w-full p-0"
                placeholder="Search branches ¦"
                type="text"
              />
            </div>
            <button
              onClick={fetchBranches}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-muted text-foreground rounded-lg text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={openAdd}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-md"
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
                className="w-full h-12 bg-background text-foreground border border-border rounded-lg text-sm px-4 focus:ring-1 focus:ring-primary focus:border-primary appearance-none cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Open">Active / Open</option>
                <option value="Closed">Inactive / Closed</option>
                <option value="Maintenance">Maintenance</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-lg">expand_more</span>
            </div>
            <div className="relative min-w-[180px]">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value || 'All')}
                className="w-full h-12 bg-background text-foreground border border-border rounded-lg text-sm px-4 focus:ring-1 focus:ring-primary focus:border-primary appearance-none cursor-pointer"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r === 'All' ? 'All Regions' : r}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-lg">expand_more</span>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive p-4 flex items-center justify-between gap-4">
            <div className="text-sm">{error}</div>
            <button onClick={fetchBranches} className="h-10 px-4 rounded-lg bg-muted text-foreground hover:bg-accent">
              Retry
            </button>
          </div>
        ) : null}

        {/* Branch Table */}
        <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Branch ID</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Branch Info</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Manager</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Contact</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td className="py-8 px-6 text-sm text-muted-foreground" colSpan={6}>
                      Loading branches...
                    </td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td className="py-8 px-6 text-sm text-muted-foreground" colSpan={6}>
                      No branches found.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((b) => (
                    <tr key={b.id} className="group hover:bg-accent/50 transition-colors">
                      <td className="py-4 px-6 align-middle">
                        <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{b.id}</span>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black">
                            {b.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground">{b.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {[b.address, b.city].map((x) => x.trim()).filter(Boolean).join(', ') || ' ”'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                            {(b.managerName || ' ”').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-foreground">{b.managerName || ' ”'}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex flex-col">
                          <span className="text-sm text-foreground">{b.phone || ' ”'}</span>
                          <span className="text-xs text-muted-foreground">Rating: {b.rating.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-3">
                          <span
                            className={`text-xs font-medium ${
                              b.status === 'Open' ? 'text-emerald-600 dark:text-emerald-500' : b.status === 'Maintenance' ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
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
                            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
                              className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-accent"
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
                              className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-accent"
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
                              className="w-full px-4 py-3 text-left text-sm text-destructive hover:bg-accent"
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
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-bold text-foreground">{pageRows.length}</span> of{' '}
              <span className="font-bold text-foreground">{visible.length}</span> branches
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                disabled={safePage <= 1}
              >
                Previous
              </button>
              <button className="px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground font-bold">{safePage}</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                disabled={safePage >= totalPages}
              >
                Next
              </button>
              <button className="px-3 py-1 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground" onClick={fetchBranches}>
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats Cards below table */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            <div className="bg-card p-6 rounded-xl border border-border flex items-start justify-between">
                <div>
                    <p className="text-muted-foreground text-sm font-medium mb-1">Total Branches</p>
                    <p className="text-3xl font-bold text-foreground">{branches.length}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined">store</span>
                </div>
            </div>
            <div className="bg-card p-6 rounded-xl border border-border flex items-start justify-between">
                <div>
                    <p className="text-muted-foreground text-sm font-medium mb-1">Active Staff</p>
                    <p className="text-3xl font-bold text-foreground">{totalStaff}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <span className="material-symbols-outlined">badge</span>
                </div>
            </div>
             <div className="bg-card p-6 rounded-xl border border-border flex items-start justify-between">
                <div>
                    <p className="text-muted-foreground text-sm font-medium mb-1">Top Performing</p>
                    <p className="text-lg font-bold text-foreground truncate">{topPerforming?.name || 'No data'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Today: {topPerforming ? `ETB ${topPerforming.revenueToday.toLocaleString()}` : 'No data'}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <span className="material-symbols-outlined">trending_up</span>
                </div>
            </div>
        </div>

        {modalOpen ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div onClick={closeModal} className="absolute inset-0 bg-black/60"></div>
            <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card text-foreground shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="text-lg font-black">{editingId ? 'Edit Branch' : 'Add Branch'}</div>
                <button onClick={closeModal} disabled={saving} className="h-9 w-9 rounded-lg bg-muted hover:bg-accent disabled:opacity-60">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">Branch Name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">Manager Name</span>
                  <input
                    value={form.managerName}
                    onChange={(e) => setForm((p) => ({ ...p, managerName: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">City</span>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">Phone</span>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="tel"
                  />
                </label>

                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-bold text-muted-foreground">Address</span>
                  <input
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="text"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as 'Open' | 'Closed' | 'Maintenance' }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                  >
                    <option value="Open">Open</option>
                    <option value="Closed">Closed</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-muted-foreground">Rating (0-5)</span>
                  <input
                    value={form.rating}
                    onChange={(e) => setForm((p) => ({ ...p, rating: e.target.value }))}
                    className="h-11 rounded-lg border border-border bg-background px-3 focus:ring-2 focus:ring-primary"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                  />
                </label>
              </div>

              <div className="px-6 py-4 border-t border-border flex flex-col sm:flex-row gap-3 justify-end">
                <button onClick={closeModal} disabled={saving} className="h-11 px-4 rounded-lg bg-muted hover:bg-accent disabled:opacity-60">
                  Cancel
                </button>
                <button onClick={saveBranch} disabled={saving} className="h-11 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold disabled:opacity-60">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteConfirmOpen ? (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div onClick={closeDelete} className="absolute inset-0 bg-black/60"></div>
            <div className="relative w-full max-w-md rounded-2xl border border-border bg-card text-foreground shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="text-lg font-black">Delete Branch</div>
                <button onClick={closeDelete} className="text-muted-foreground hover:text-foreground" type="button" disabled={saving}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="px-6 py-5 text-sm text-muted-foreground">
                This will permanently delete the branch and remove demo events associated with it. This action cannot be undone.
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
                <button onClick={closeDelete} className="h-10 px-4 rounded-lg bg-background border border-border text-foreground hover:bg-accent disabled:opacity-60" disabled={saving} type="button">
                  Cancel
                </button>
                <button onClick={confirmDelete} className="h-10 px-4 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold disabled:opacity-60" disabled={saving} type="button">
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