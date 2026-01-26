import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';

type AddonRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  isAvailable: boolean;
  availabilityTier: string | null;
  pricing: { monthlyEtb: number; yearlyEtb: number; setupFeeEtb: number };
};

export const SA_Addons: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AddonRow[]>([]);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [available, setAvailable] = useState<'all' | 'true' | 'false'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [draftMonthly, setDraftMonthly] = useState('0');
  const [draftYearly, setDraftYearly] = useState('0');
  const [draftSetup, setDraftSetup] = useState('0');
  const [draftAvailable, setDraftAvailable] = useState(true);

  const categories = useMemo(() => {
    const set0 = new Set<string>();
    for (const x of items) {
      const c = String(x.category || '').trim();
      if (c) set0.add(c);
    }
    return Array.from(set0).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category.trim()) params.set('category', category.trim());
      if (available !== 'all') params.set('available', available);

      const url = `/api/superadmin/addons${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiFetch(url);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const addons = Array.isArray(json?.addons) ? json.addons : [];
      setItems(
        addons.map((a: any) => ({
          id: String(a?.id || ''),
          code: String(a?.code || ''),
          name: String(a?.name || ''),
          description: String(a?.description || ''),
          category: String(a?.category || ''),
          isAvailable: Boolean(a?.isAvailable),
          availabilityTier: a?.availabilityTier != null ? String(a.availabilityTier) : null,
          pricing: {
            monthlyEtb: Number(a?.pricing?.monthlyEtb || 0) || 0,
            yearlyEtb: Number(a?.pricing?.yearlyEtb || 0) || 0,
            setupFeeEtb: Number(a?.pricing?.setupFeeEtb || 0) || 0,
          },
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load add-ons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const code = draftCode.trim().toLowerCase();
      const name = draftName.trim();
      if (!code) throw new Error('Code is required');
      if (!name) throw new Error('Name is required');

      const monthlyEtb = Number(draftMonthly || 0) || 0;
      const yearlyEtb = Number(draftYearly || 0) || 0;
      const setupFeeEtb = Number(draftSetup || 0) || 0;
      if (monthlyEtb < 0 || yearlyEtb < 0 || setupFeeEtb < 0) throw new Error('Pricing must be >= 0');

      const res = await apiFetch('/api/superadmin/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          category: draftCategory.trim(),
          isAvailable: Boolean(draftAvailable),
          pricing: { monthlyEtb, yearlyEtb, setupFeeEtb },
          modules: [],
          limits: {},
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setCreateOpen(false);
      setDraftCode('');
      setDraftName('');
      setDraftCategory('');
      setDraftMonthly('0');
      setDraftYearly('0');
      setDraftSetup('0');
      setDraftAvailable(true);

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create add-on');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailable = async (id: string, next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/addons/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: next }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update add-on');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (saving) return;
    const ok = typeof window !== 'undefined' ? window.confirm('Delete this add-on?') : false;
    if (!ok) return;

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/addons/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete add-on');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-black text-foreground">Add-ons</div>
          <div className="text-muted-foreground text-sm mt-1">Add-on packages that extend tenant modules/limits.</div>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 disabled:opacity-60"
          onClick={() => setCreateOpen(true)}
          disabled={saving}
        >
          New Add-on
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-600/40 bg-red-500/10 text-red-200 px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          className="h-11 rounded-lg border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
          placeholder="Search code/name/category"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
        <select
          className="h-11 rounded-lg border border-border bg-card px-3 text-foreground"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="h-11 rounded-lg border border-border bg-card px-3 text-foreground"
          value={available}
          onChange={(e) => setAvailable(e.target.value as any)}
        >
          <option value="all">All</option>
          <option value="true">Available</option>
          <option value="false">Hidden</option>
        </select>
        <button
          className="h-11 rounded-lg border border-border bg-card text-foreground font-black hover:bg-accent disabled:opacity-60"
          onClick={load}
          disabled={loading || saving}
        >
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div className="grid grid-cols-12 bg-muted/40 text-muted-foreground text-xs font-black uppercase tracking-widest px-4 py-3">
          <div className="col-span-3">Code</div>
          <div className="col-span-3">Name</div>
          <div className="col-span-2">Category</div>
          <div className="col-span-2">Pricing</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-4 py-6 text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-muted-foreground">No add-ons found.</div>
          ) : (
            items.map((x) => (
              <div key={x.id} className="grid grid-cols-12 px-4 py-3 items-center">
                <div className="col-span-3">
                  <div className="text-foreground font-black">{x.code}</div>
                  <div className="text-muted-foreground text-xs">{x.isAvailable ? 'Available' : 'Hidden'}</div>
                </div>
                <div className="col-span-3">
                  <div className="text-foreground font-bold">{x.name}</div>
                  <div className="text-muted-foreground text-xs line-clamp-1">{x.description}</div>
                </div>
                <div className="col-span-2 text-muted-foreground">{x.category || '—'}</div>
                <div className="col-span-2 text-muted-foreground">
                  <div className="text-xs">M: {Math.round(x.pricing.monthlyEtb)} ETB</div>
                  <div className="text-xs">Y: {Math.round(x.pricing.yearlyEtb)} ETB</div>
                </div>
                <div className="col-span-2 flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-black hover:bg-accent disabled:opacity-60"
                    onClick={() => toggleAvailable(x.id, !x.isAvailable)}
                    disabled={saving}
                  >
                    {x.isAvailable ? 'Hide' : 'Show'}
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg border border-red-600/40 bg-red-500/10 text-red-200 font-black hover:bg-red-500/15 disabled:opacity-60"
                    onClick={() => del(x.id)}
                    disabled={saving}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5">
            <div className="text-foreground font-black text-lg">New Add-on</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Code</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground" value={draftCode} onChange={(e) => setDraftCode(e.target.value)} placeholder="e.g. advanced_analytics" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Name</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Advanced Analytics" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Category</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground" value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} placeholder="analytics" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Monthly ETB</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground" value={draftMonthly} onChange={(e) => setDraftMonthly(e.target.value)} />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Yearly ETB</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground" value={draftYearly} onChange={(e) => setDraftYearly(e.target.value)} />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Setup Fee ETB</div>
                <input className="h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground" value={draftSetup} onChange={(e) => setDraftSetup(e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 mt-4 text-muted-foreground text-sm font-bold">
              <input type="checkbox" checked={draftAvailable} onChange={(e) => setDraftAvailable(e.target.checked)} />
              Available to tenants
            </label>

            <div className="flex justify-end gap-2 mt-5">
              <button className="px-4 py-2 rounded-lg border border-border bg-card text-foreground font-black hover:bg-accent" onClick={() => setCreateOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 disabled:opacity-60" onClick={create} disabled={saving}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
