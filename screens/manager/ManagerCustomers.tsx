import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Modal } from '../../components/Modal';
import { apiFetch } from '../../api';

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

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '500');
      if (query.trim()) qs.set('q', query.trim());
      const res = await apiFetch(`/api/manager/customers?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.customers) ? (json.customers as any[]) : [];
      const next: CustomerRow[] = rows
        .map((c) => ({
          id: String(c.id || ''),
          name: String(c.name || ''),
          phone: String(c.phone || ''),
          loyaltyPoints: Number(c.loyaltyPoints ?? c.loyalty_points ?? 0) || 0,
          loyaltyBalance: Number(c.loyaltyBalance ?? c.loyalty_balance ?? 0) || 0,
          status: (String(c.status || 'Active') as any) === 'Suspended' ? 'Suspended' : 'Active',
          updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : typeof c.updated_at === 'string' ? c.updated_at : null,
        }))
        .filter((c) => c.id && c.name);
      setCustomers(next);
    } catch (e) {
      setCustomers([]);
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
   }, [query]);

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
        if (editId === '__new__') {
          const res = await apiFetch('/api/manager/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, loyaltyPoints, loyaltyBalance, status: draftStatus }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
          setFlash({ kind: 'success', message: 'Customer created.' });
        } else if (editId) {
          const res = await apiFetch(`/api/manager/customers/${encodeURIComponent(editId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, loyaltyPoints, loyaltyBalance, status: draftStatus }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [customers, query]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-none border-b border-border">
        <Header title="Customers" subtitle="Customer contacts and loyalty" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-muted text-lg">search</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-surface focus:ring-2 focus:ring-primary focus:outline-none placeholder:text-text-muted text-white"
                  placeholder="Search by name, phone, or ID ¦"
                  type="text"
                />
              </div>
            </div>
            <button
              onClick={openNew}
              className="px-4 py-2 bg-primary text-background font-bold rounded-lg flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add Customer
            </button>
          </div>

          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-light border-b border-border">
                  <th className="p-4 text-xs font-bold text-text-muted uppercase">Name</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase">Phone</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase text-right">Points</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase text-right">Balance</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase">Status</th>
                  <th className="p-4 text-xs font-bold text-text-muted uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-text-muted text-sm">
                      Loading customers ¦
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-text-muted text-sm">
                      No customers.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-surface-light/50 transition-colors">
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-white">{c.name}</span>
                          <span className="text-xs text-text-muted">{c.id}</span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-text-muted">{c.phone}</td>
                      <td className="p-4 text-sm font-mono text-white text-right">{c.loyaltyPoints.toLocaleString()}</td>
                      <td className="p-4 text-sm font-mono text-white text-right">{formatMoney(c.loyaltyBalance)}</td>
                      <td className="p-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${c.status === 'Active' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => openEdit(c)} className="text-primary hover:text-primary-hover text-sm font-bold">
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(c.id)}
                            className="text-red-400 hover:text-red-300 text-sm font-bold"
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
              className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary-hover text-background font-extrabold transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Saving ¦' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-text-muted">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-text-muted">Phone</label>
          <input value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-bold text-text-muted">Loyalty Points</label>
              <input value={draftPoints} onChange={(e) => setDraftPoints(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-sm font-bold text-text-muted">Loyalty Balance (ETB)</label>
              <input value={draftBalance} onChange={(e) => setDraftBalance(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>

          <label className="text-sm font-bold text-text-muted">Status</label>
          <select
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value as any)}
            className="w-full h-10 px-2 rounded-lg border border-border bg-surface text-sm text-text-muted focus:outline-none"
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
              className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
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
                    const res = await apiFetch(`/api/manager/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    const json = (await res.json().catch(() => null)) as any;
                    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
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
              className="flex-1 h-11 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Deleting ¦' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-text-muted">This will permanently remove the customer.</div>
      </Modal>
    </div>
  );
};
