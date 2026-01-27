import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Modal } from '../../components/Modal';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { Button } from '../../components/ui/button';

import { AppIcon } from '@/components/ui/app-icon';
type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  loyaltyPoints: number;
  loyaltyBalance: number;
  status: 'Active' | 'Suspended';
  updatedAt: string | null;
};

const formatMoney = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  return `ETB ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const ManagerCustomers: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftPoints, setDraftPoints] = useState('0');
  const [draftBalance, setDraftBalance] = useState('0');
  const [draftStatus, setDraftStatus] = useState<'Active' | 'Suspended'>('Active');

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const resolveOwnerBranchOverride = () => {
    try {
      const raw = localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
      return String(raw || '').trim();
    } catch {
      return '';
    }
  };

  const normalizeApiError = (raw: unknown): string => {
    const s = String(raw || '').trim();
    if (!s) return 'Something went wrong.';
    if (s === 'phone_in_use') return 'This phone is already registered.';
    if (s === 'branch_required') return 'Select a branch first.';
    if (s === 'name_required') return 'Name is required.';
    if (s === 'phone_required') return 'Phone is required.';
    if (s === 'not_found') return 'Customer not found.';
    return s;
  };

  const resolveBranchIdForOwner = (): string => {
    try {
      const session = readSession<any>();
      const role = typeof session?.role === 'string' ? session.role : '';
      const tokenBranchId = typeof session?.branchId === 'string' ? session.branchId : '';
      const branchOverride = role === 'Cafe Owner' && (!tokenBranchId || tokenBranchId === 'global') ? resolveOwnerBranchOverride() : '';
      return branchOverride;
    } catch {
      return '';
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      if (query.trim()) qs.set('q', query.trim());
      const branchOverride = resolveBranchIdForOwner();
      if (branchOverride) qs.set('branchId', branchOverride);
      const res = await apiFetch(`/api/manager/customers?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(normalizeApiError(json?.error || `HTTP ${res.status}`));
      const rows = Array.isArray(json?.customers) ? (json.customers as any[]) : [];
      setTotal(Number(json?.total ?? 0) || 0);
      const next: CustomerRow[] = rows
        .map((c) => {
          const status: CustomerRow['status'] = String(c.status || 'Active') === 'Suspended' ? 'Suspended' : 'Active';
          return {
            id: String(c.id || ''),
            name: String(c.name || ''),
            phone: String(c.phone || ''),
            loyaltyPoints: Number(c.loyaltyPoints ?? c.loyalty_points ?? 0) || 0,
            loyaltyBalance: Number(c.loyaltyBalance ?? c.loyalty_balance ?? 0) || 0,
            status,
            updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : typeof c.updated_at === 'string' ? c.updated_at : null,
          };
        })
        .filter((c) => c.id && c.name);
      setCustomers(next);
    } catch (e) {
      setCustomers([]);
      setTotal(0);
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load customers.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [query, page, pageSize]);

  const openNew = () => {
    setEditId('__new__');
    setDraftName('');
    setDraftPhone('');
    setDraftPoints('0');
    setDraftBalance('0');
    setDraftStatus('Active');
  };

  const openEdit = (c: CustomerRow) => {
    setEditId(c.id);
    setDraftName(c.name);
    setDraftPhone(c.phone);
    setDraftPoints(String(c.loyaltyPoints || 0));
    setDraftBalance(String(c.loyaltyBalance || 0));
    setDraftStatus(c.status);
  };

  const closeModal = () => {
    if (busy) return;
    setEditId(null);
    setDraftName('');
    setDraftPhone('');
    setDraftPoints('0');
    setDraftBalance('0');
    setDraftStatus('Active');
  };

  const submit = () => {
    const name = draftName.trim();
    const phone = draftPhone.trim();
    const loyaltyPoints = Number(draftPoints || 0);
    const loyaltyBalance = Number(draftBalance || 0);

    if (!name) {
      setFlash({ kind: 'error', message: 'Name is required.' });
      return;
    }
    if (!phone) {
      setFlash({ kind: 'error', message: 'Phone is required.' });
      return;
    }
    if (!Number.isFinite(loyaltyPoints) || loyaltyPoints < 0) {
      setFlash({ kind: 'error', message: 'Invalid loyalty points.' });
      return;
    }
    if (!Number.isFinite(loyaltyBalance) || loyaltyBalance < 0) {
      setFlash({ kind: 'error', message: 'Invalid loyalty balance.' });
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        const branchOverride = resolveBranchIdForOwner();
        const qs = new URLSearchParams();
        if (branchOverride) qs.set('branchId', branchOverride);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        if (editId === '__new__') {
          const res = await apiFetch(`/api/manager/customers${suffix}` , {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, loyaltyPoints, loyaltyBalance, status: draftStatus }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(normalizeApiError(json?.error || `HTTP ${res.status}`));
          setFlash({ kind: 'success', message: 'Customer created.' });
        } else if (editId) {
          const res = await apiFetch(`/api/manager/customers/${encodeURIComponent(editId)}${suffix}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, loyaltyPoints, loyaltyBalance, status: draftStatus }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(normalizeApiError(json?.error || `HTTP ${res.status}`));
          setFlash({ kind: 'success', message: 'Customer updated.' });
        }
        closeModal();
        await load();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save customer.' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const filtered = useMemo(() => customers, [customers]);

  const totalPages = useMemo(() => {
    const ps = Math.max(1, Number(pageSize) || 1);
    return Math.max(1, Math.ceil((Number(total) || 0) / ps));
  }, [pageSize, total]);

  const deleteTarget = useMemo(() => {
    if (!deleteId) return null;
    return customers.find((c) => c.id === deleteId) ?? null;
  }, [customers, deleteId]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="h-16 shrink-0 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-8 z-10">
        <div>
          <h2 className="text-foreground text-xl font-bold">Customers</h2>
          <p className="text-muted-foreground text-xs">Customer contacts and loyalty</p>
        </div>
        <button
          onClick={openNew}
          disabled={busy || loading}
          className="h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          <AppIcon name="add" className="text-[18px]" size={18} />
          Add Customer
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-7xl mx-auto flex flex-col gap-4">
          {flash ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-bold ${
                flash.kind === 'success'
                  ? 'bg-emerald-900/10 border-emerald-800 text-emerald-200'
                  : 'bg-red-900/10 border-red-800 text-red-200'
              }`}
            >
              {flash.message}
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full md:max-w-xl">
              <div className="relative w-full">
                <AppIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg" size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={busy}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/40 focus:outline-none placeholder:text-muted-foreground/60 text-foreground disabled:opacity-60"
                  placeholder="Search by name, phone, or ID"
                  type="text"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground">{loading ? 'Loading...' : `${total.toLocaleString()} customers`}</div>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(1);
                  setPageSize(Number(e.target.value) || 50);
                }}
                disabled={busy || loading}
                className="h-9 px-2 rounded-lg border border-border bg-background text-xs text-foreground disabled:opacity-60"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Page {page} / {totalPages}</div>
            <div className="flex items-center gap-2">
              <button
                disabled={busy || loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-9 px-3 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-bold disabled:opacity-60"
              >
                Prev
              </button>
              <button
                disabled={busy || loading || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-9 px-3 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-bold disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-background border-b border-border">
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Name</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Phone</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Points</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Balance</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-muted-foreground text-sm">
                      Loading customers...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-muted-foreground text-sm">
                      No customers.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-accent transition-colors">
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-foreground">{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.id}</span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{c.phone}</td>
                      <td className="p-4 text-sm font-mono text-foreground text-right">{c.loyaltyPoints.toLocaleString()}</td>
                      <td className="p-4 text-sm font-mono text-foreground text-right">{formatMoney(c.loyaltyBalance)}</td>
                      <td className="p-4">
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-bold border ${
                            c.status === 'Active'
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button disabled={busy || loading} onClick={() => openEdit(c)} className="text-primary hover:opacity-90 text-sm font-bold disabled:opacity-60">
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(c.id)}
                            disabled={busy || loading}
                            className="text-red-400 hover:text-red-300 text-sm font-bold disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={editId != null}
        title={editId === '__new__' ? 'Add Customer' : 'Edit Customer'}
        onClose={closeModal}
        footer={
          <div className="flex gap-3">
            <button
              onClick={closeModal}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Saving ' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-muted-foreground">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Phone</label>
          <input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-bold text-muted-foreground">Loyalty Points</label>
              <input value={draftPoints} onChange={(e) => setDraftPoints(e.target.value)} className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-sm font-bold text-muted-foreground">Loyalty Balance (ETB)</label>
              <input value={draftBalance} onChange={(e) => setDraftBalance(e.target.value)} className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
          </div>

          <label className="text-sm font-bold text-muted-foreground">Status</label>
          <select
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value as any)}
            className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none"
          >
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={deleteId != null}
        title="Delete Customer"
        onClose={() => setDeleteId(null)}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteId(null)}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!deleteId) return;
                const id = deleteId;
                setBusy(true);
                void (async () => {
                  try {
                    const branchOverride = resolveBranchIdForOwner();
                    const qs = new URLSearchParams();
                    if (branchOverride) qs.set('branchId', branchOverride);
                    const suffix = qs.toString() ? `?${qs.toString()}` : '';
                    const res = await apiFetch(`/api/manager/customers/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' });
                    const json = (await res.json().catch(() => null)) as any;
                    if (!res.ok) throw new Error(normalizeApiError(json?.error || `HTTP ${res.status}`));
                    setDeleteId(null);
                    setFlash({ kind: 'success', message: 'Customer deleted.' });
                    await load();
                  } catch (e) {
                    setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete customer.' });
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-extrabold transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Deleting ' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted-foreground">
          <div className="font-bold text-foreground">{deleteTarget?.name || 'This customer'}</div>
          {deleteTarget?.phone ? <div className="mt-1">Phone: <span className="text-foreground font-mono">{deleteTarget.phone}</span></div> : null}
          <div className="mt-3">This will permanently remove the customer.</div>
        </div>
      </Modal>
    </div>
  );
};
