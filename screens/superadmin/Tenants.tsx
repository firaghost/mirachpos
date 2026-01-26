import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';

type TenantItem = {
  id: string;
  name: string;
  status: string;
  plan: string;
  branches: number;
  users: number;
  lastActivityAt?: string;
  owner?: { name?: string; email?: string; phone?: string };
  usage?: { pct?: number; label?: string };
};

type TenantsResponse = {
  ok: boolean;
  tenants?: TenantItem[];
  page?: number;
  limit?: number;
  total?: number;
};

export const SA_Tenants: React.FC<{ onNavigate?: (screen: Screen) => void }> = ({ onNavigate }) => {
  const SELECTED_TENANT_KEY = 'mirachpos.sa.selectedTenantId.v1';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TenantItem[]>([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [sort, setSort] = useState<'last_activity' | 'created' | 'name'>('last_activity');
  const [page, setPage] = useState(1);
  const [limit] = useState(24);
  const [total, setTotal] = useState(0);

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardSaving, setOnboardSaving] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardResult, setOnboardResult] = useState<{ tenantId: string; slug: string; ownerPassword?: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newTier, setNewTier] = useState<'Trial' | 'Basic' | 'Pro' | 'Enterprise'>('Trial');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerPhone, setNewOwnerPhone] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('');
  const [newBranchName, setNewBranchName] = useState('Main Branch');
  const [newCity, setNewCity] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newAddress1, setNewAddress1] = useState('');

  const slugify = (v: string) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .slice(0, 48);

  const openOnboard = () => {
    setOnboardError(null);
    setOnboardResult(null);
    setNewName('');
    setNewSlug('');
    setNewTier('Trial');
    setNewOwnerName('');
    setNewOwnerEmail('');
    setNewOwnerPhone('');
    setNewOwnerPassword('');
    setNewBranchName('Main Branch');
    setNewCity('');
    setNewCountry('');
    setNewAddress1('');
    setOnboardOpen(true);
  };

  const createTenant = async () => {
    if (onboardSaving) return;
    setOnboardSaving(true);
    setOnboardError(null);
    setOnboardResult(null);
    try {
      const name0 = newName.trim();
      if (!name0) throw new Error('Cafe name is required');
      const email0 = newOwnerEmail.trim().toLowerCase();
      if (!email0) throw new Error('Owner email is required');
      const slug0 = (newSlug.trim() || slugify(name0)).trim();
      const res = await apiFetch('/api/superadmin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name0,
          slug: slug0,
          tier: newTier,
          ownerName: newOwnerName.trim(),
          ownerEmail: email0,
          ownerPhone: newOwnerPhone.trim(),
          ownerPassword: newOwnerPassword,
          branchName: newBranchName.trim(),
          city: newCity.trim(),
          country: newCountry.trim(),
          address1: newAddress1.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setOnboardResult({ tenantId: String(json?.tenantId || ''), slug: String(json?.slug || slug0), ownerPassword: json?.ownerPassword ? String(json.ownerPassword) : undefined });
      await load();
    } catch (e) {
      setOnboardError(e instanceof Error ? e.message : 'Onboarding failed');
    } finally {
      setOnboardSaving(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      if (tier) params.set('tier', tier);
      if (sort) params.set('sort', sort);
      params.set('page', String(page));
      params.set('limit', String(limit));

      const res = await apiFetch(`/api/superadmin/tenants?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as TenantsResponse | null;
      if (!res.ok) throw new Error('Tenant index uplink failed');
      setItems(Array.isArray(json?.tenants) ? json!.tenants! : []);
      setTotal(Number(json?.total || 0));
    } catch {
      setError('Global registry node offline');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sort]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, tier]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const relTime = (iso?: string) => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const d = Math.max(0, Date.now() - t);
    if (d < 60 * 1000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 60 * 60 * 1000) return `${Math.floor(d / (60 * 1000))}m ago`;
    if (d < 24 * 60 * 60 * 1000) return `${Math.floor(d / (60 * 60 * 1000))}h ago`;
    return `${Math.floor(d / (24 * 60 * 60 * 1000))}d ago`;
  };

  const initials = (name: string) => {
    const n = String(name || '').trim();
    if (!n) return '??';
    const parts = n.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '');
    return (a + b).toUpperCase() || '??';
  };

  const statusUi = (s: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'active') return { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20', cardBorder: 'border-border hover:border-emerald-500/30' };
    if (v === 'suspended') return { label: 'Suspended', cls: 'bg-destructive/10 text-destructive ring-destructive/20', cardBorder: 'border-destructive/30 hover:border-destructive/40' };
    if (v === 'trial') return { label: 'New', cls: 'bg-muted/40 text-muted-foreground ring-border', cardBorder: 'border-border hover:border-primary/30' };
    return { label: s || 'Unknown', cls: 'bg-primary/10 text-primary ring-primary/20', cardBorder: 'border-border hover:border-primary/40' };
  };

  const usageColor = (pct: number) => {
    if (pct >= 90) return 'bg-destructive';
    if (pct >= 60) return 'bg-primary';
    return 'bg-emerald-500';
  };

  const openTenant = (id: string) => {
    try {
      localStorage.setItem(SELECTED_TENANT_KEY, id);
    } catch {
      // ignore
    }
    onNavigate?.(Screen.SA_TENANT_DETAILS);
  };

  const showingFrom = total === 0 ? 0 : (page - 1) * limit + 1;
  const showingTo = Math.min(total, page * limit);

  const stableItems = useMemo(() => items, [items]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <main className="flex-1 px-4 sm:px-8 py-6 w-full max-w-[1600px] mx-auto overflow-y-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-muted-foreground">Home</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-foreground">Cafes</span>
            </div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Tenant Management</h1>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center justify-center gap-2 rounded-lg h-10 px-4 bg-card hover:bg-accent border border-border text-muted-foreground hover:text-foreground text-sm font-semibold transition-colors">
              <span className="material-symbols-outlined text-[20px]">download</span>
              <span>Export List</span>
            </button>
            <button
              type="button"
              onClick={openOnboard}
              className="flex items-center justify-center gap-2 rounded-lg h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold transition-colors shadow-lg shadow-primary/10"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              <span>Onboard New Cafe</span>
            </button>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-lg border border-border bg-card flex flex-col lg:flex-row gap-4 justify-between items-center">
          <div className="flex flex-1 w-full gap-4">
            <div className="relative w-full max-w-md">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-muted-foreground">search</span>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="block w-full rounded-md border border-border bg-background py-2 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                placeholder="Search by cafe name, ID, or owner email..."
                type="text"
              />
            </div>
            <div className="hidden sm:flex gap-3">
              <select
                value={status || 'all'}
                onChange={(e) => setStatus(e.target.value === 'all' ? '' : e.target.value)}
                className="rounded-md border border-border bg-background text-foreground text-sm focus:border-primary focus:ring-primary py-2 pl-3 pr-10"
              >
                <option value="all">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Suspended">Suspended</option>
                <option value="Trial">New</option>
              </select>
              <select
                value={tier || 'all'}
                onChange={(e) => setTier(e.target.value === 'all' ? '' : e.target.value)}
                className="rounded-md border border-border bg-background text-foreground text-sm focus:border-primary focus:ring-primary py-2 pl-3 pr-10"
              >
                <option value="all">All Plans</option>
                <option value="Trial">Trial</option>
                <option value="Basic">Basic</option>
                <option value="Pro">Pro</option>
                <option value="Enterprise">Enterprise</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Sort by:</span>
            <button
              type="button"
              onClick={() => setSort('last_activity')}
              className="flex items-center gap-1 text-foreground font-medium hover:text-primary transition-colors"
            >
              Last Activity
              <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
            </button>
            <button
              type="button"
              onClick={() => setSort('created')}
              className="flex items-center gap-1 text-muted-foreground font-medium hover:text-foreground transition-colors"
            >
              Created
            </button>
            <button
              type="button"
              onClick={() => setSort('name')}
              className="flex items-center gap-1 text-muted-foreground font-medium hover:text-foreground transition-colors"
            >
              Name
            </button>
            <button
              type="button"
              onClick={load}
              className="ml-2 flex items-center justify-center gap-1 rounded-lg h-9 px-3 bg-background hover:bg-accent border border-border text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors"
            >
              <span className={loading ? 'material-symbols-outlined animate-spin text-[18px]' : 'material-symbols-outlined text-[18px]'}>sync</span>
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {stableItems.map((t) => {
            const ui = statusUi(t.status);
            const ownerName = String(t.owner?.name || '').trim();
            const ownerEmail = String(t.owner?.email || '').trim();
            const ownerPhone = String(t.owner?.phone || '').trim();
            const usagePct = Math.max(0, Math.min(100, Number(t.usage?.pct || 0)));
            const usageLabel = String(t.usage?.label || '');
            const activityLabel = relTime(t.lastActivityAt);
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => openTenant(t.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openTenant(t.id)}
                className={`group bg-card rounded-lg border ${ui.cardBorder} transition-all duration-200 flex flex-col cursor-pointer`}
              >
                <div className="p-5 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="size-12 rounded bg-muted p-1 flex items-center justify-center shrink-0">
                        <div className="w-full h-full bg-background flex items-center justify-center text-foreground font-bold rounded-sm">{initials(t.name)}</div>
                      </div>
                      <div>
                        <h3 className="text-foreground font-bold text-lg leading-tight group-hover:text-primary transition-colors">{t.name}</h3>
                        <p className="text-muted-foreground text-xs font-mono">ID: {t.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${ui.cls}`}>{ui.label}</span>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent transition-colors ml-1"
                      >
                        <span className="material-symbols-outlined text-[20px]">more_vert</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="material-symbols-outlined text-[18px] text-primary">person</span>
                      <span className="text-foreground font-medium">{ownerName || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="material-symbols-outlined text-[18px] text-primary">mail</span>
                      <span className="text-muted-foreground">{ownerEmail || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="material-symbols-outlined text-[18px] text-primary">call</span>
                      <span className="text-muted-foreground">{ownerPhone || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="material-symbols-outlined text-primary text-[18px]">verified</span>
                      <span className="text-foreground font-medium">{t.plan || '-'}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Usage</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${usageColor(usagePct)} rounded-full`} style={{ width: `${usagePct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{usagePct ? `${usagePct}%` : '—'}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{usageLabel || '—'}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-muted-foreground text-[18px]">storefront</span>
                      <span className="text-sm text-foreground">{Number(t.branches || 0)} Branches</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-muted-foreground text-[18px]">group</span>
                      <span className="text-sm text-foreground">{Number(t.users || 0)} Users</span>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-3 bg-muted/40 border-t border-border rounded-b-lg flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {activityLabel ? `Active ${activityLabel}` : 'No activity'}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTenant(t.id);
                      }}
                      className="text-primary hover:text-foreground text-xs font-semibold px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && stableItems.length === 0 ? (
            <div className="col-span-full text-center text-sm text-muted-foreground py-20">No cafes found.</div>
          ) : null}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
          <div className="text-sm text-muted-foreground">
            Showing <span className="text-foreground font-medium">{showingFrom}</span> to <span className="text-foreground font-medium">{showingTo}</span> of{' '}
            <span className="text-foreground font-medium">{total}</span> cafes
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-card text-sm text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
            >
              Next
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      </main>

      {onboardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-xl overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/40 flex items-center justify-between">
              <div>
                <div className="text-foreground font-bold">Onboard New Cafe</div>
                <div className="text-xs text-muted-foreground">Create a tenant with owner account and default branch</div>
              </div>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOnboardOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-4">
              {onboardError ? <div className="mb-3 rounded-lg border border-red-900/40 bg-red-900/10 p-3 text-sm text-red-200">{onboardError}</div> : null}
              {onboardResult ? (
                <div className="mb-3 rounded-lg border border-emerald-900/40 bg-emerald-900/10 p-3 text-sm text-emerald-200">
                  Created tenant <span className="font-mono">{onboardResult.slug}</span> ({onboardResult.tenantId}).
                  {onboardResult.ownerPassword ? (
                    <div className="mt-2 text-xs text-emerald-200">
                      Generated owner password: <span className="font-mono font-bold">{onboardResult.ownerPassword}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Cafe Name *</div>
                  <input value={newName} onChange={(e) => { setNewName(e.target.value); if (!newSlug.trim()) setNewSlug(slugify(e.target.value)); }} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Slug</div>
                  <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground font-mono" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Plan</div>
                  <select value={newTier} onChange={(e) => setNewTier(e.target.value as any)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
                    <option value="Trial">Trial</option>
                    <option value="Basic">Basic</option>
                    <option value="Pro">Pro</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Owner Name</div>
                  <input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Owner Email *</div>
                  <input value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Owner Phone</div>
                  <input value={newOwnerPhone} onChange={(e) => setNewOwnerPhone(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Owner Password</div>
                  <input value={newOwnerPassword} onChange={(e) => setNewOwnerPassword(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground font-mono" placeholder="Leave blank to auto-generate" />
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Default Branch Name</div>
                  <input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">City</div>
                  <input value={newCity} onChange={(e) => setNewCity(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Country</div>
                  <input value={newCountry} onChange={(e) => setNewCountry(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Address</div>
                  <input value={newAddress1} onChange={(e) => setNewAddress1(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border bg-muted/40 flex items-center justify-end gap-2">
              <button type="button" className="h-10 px-4 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent" onClick={() => setOnboardOpen(false)}>
                Close
              </button>
              <button type="button" className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-60" onClick={createTenant} disabled={onboardSaving}>
                {onboardSaving ? 'Creating...' : 'Create Cafe'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SA_Tenants;
