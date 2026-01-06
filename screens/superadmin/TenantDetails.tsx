import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { readSession, updateSession } from '../../session';

export const SA_TenantDetails: React.FC<{ onBack: () => void; onNavigate?: (screen: Screen) => void }> = ({ onBack, onNavigate }) => {
  const SELECTED_TENANT_KEY = 'mirachpos.sa.selectedTenantId.v1';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingModules, setSavingModules] = useState(false);
  const [tab, setTab] = useState<'branches' | 'users' | 'feature_access' | 'integrations'>('branches');
  const [search, setSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [tenant, setTenant] = useState<
    | null
    | {
        id: string;
        name: string;
        slug?: string;
        domain?: string;
        status: string;
        plan: string;
        enabledModules?: string[] | null;
        profile?: any;
        branchesPreview?: Array<{ id: string; name: string; city?: string; status?: string }>;
        metrics?: any;
        incidents?: any[];
        branches: number;
        users: number;
        lastActivityAt?: string;
        createdAt?: string;
        updatedAt?: string;
      }
  >(null);

  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [baselineModules, setBaselineModules] = useState<string[]>([]);
  const [baselineFeatures, setBaselineFeatures] = useState<string[]>([]);

  const selectedTenantId = useMemo(() => {
    try {
      return localStorage.getItem(SELECTED_TENANT_KEY) || '';
    } catch {
      return '';
    }
  }, []);

  const reload = async () => {
    if (!selectedTenantId) {
      setTenant(null);
      setError('No tenant selected');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const t = json?.tenant || null;
      setTenant(t);
      setEditName(String(t?.name || ''));
      setEditOwner(String(t?.profile?.ownerName || t?.profile?.contactName || ''));
      setEditEmail(String(t?.profile?.contactEmail || ''));
      setEditPhone(String(t?.profile?.contactPhone || ''));
      setEditCity(String(t?.profile?.city || ''));
      setEditCountry(String(t?.profile?.country || ''));
      const plan = String(t?.plan || 'Enterprise');
      const base = plan === 'Trial'
        ? ['pos', 'orders', 'tables', 'staff']
        : plan === 'Basic'
          ? ['pos', 'orders', 'tables', 'staff', 'reports']
          : plan === 'Pro'
            ? ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance']
            : ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance', 'settings', 'owner_dashboard', 'branches', 'guests'];
      const initial = Array.isArray(t?.enabledModules) ? t.enabledModules : base;
      const nextMods = base.filter((m) => initial.includes(m));
      setEnabledModules(nextMods);
      setBaselineModules(nextMods);
      const initialFeatures = Array.isArray(t?.features) ? t.features : [];
      const nextFeatures = initialFeatures.map((f: any) => String(f || '')).filter(Boolean);
      setFeatures(nextFeatures);
      setBaselineFeatures(nextFeatures);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tenant');
      setTenant(null);
    } finally {
      setLoading(false);
    }
  };

  const hasUnsavedAccessChanges = useMemo(() => {
    const a = [...enabledModules].map(String).sort().join('|');
    const b = [...baselineModules].map(String).sort().join('|');
    const fa = [...features].map(String).sort().join('|');
    const fb = [...baselineFeatures].map(String).sort().join('|');
    return a !== b || fa !== fb;
  }, [baselineFeatures, baselineModules, enabledModules, features]);

  const toggleFeature = (flag: string) => {
    setFeatures((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]));
  };

  const fetchUsers = async () => {
    if (!selectedTenantId) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}/users`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setUsers(Array.isArray(json?.users) ? json.users : []);
    } catch (e) {
      setUsers([]);
      setUsersError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'users') return;
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedTenantId]);

  const saveEditConfig = async () => {
    if (!selectedTenantId) return;
    if (loading) return;
    setLoading(true);
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          profile: {
            ownerName: editOwner,
            contactName: editOwner,
            contactEmail: editEmail,
            contactPhone: editPhone,
            city: editCity,
            country: editCountry,
          },
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setEditOpen(false);
      setToast('Config saved');
      setTimeout(() => setToast(null), 2500);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTenant = async (patch: { name?: string; status?: string; tier?: string }) => {
    if (!selectedTenantId) return;
    if (loading) return;
    setLoading(true);
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await reload();

      const msg = (() => {
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'tier')) return 'Plan updated';
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) return 'Status updated';
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'name')) return 'Tenant updated';
        return 'Updated';
      })();
      setToast(msg);
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update tenant');
    } finally {
      setLoading(false);
    }
  };

  const isSuspended = String(tenant?.status || '').toLowerCase() === 'suspended';
  const planValue = (tenant?.plan || 'Enterprise') as 'Trial' | 'Basic' | 'Pro' | 'Enterprise';

  const tierModules = useMemo(() => {
    const plan = String(planValue || 'Enterprise');
    if (plan === 'Trial') return ['pos', 'orders', 'tables', 'staff'];
    if (plan === 'Basic') return ['pos', 'orders', 'tables', 'staff', 'reports'];
    if (plan === 'Pro') return ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance'];
    return ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance', 'settings', 'owner_dashboard', 'branches', 'guests'];
  }, [planValue]);

  const profile = (tenant?.profile && typeof tenant.profile === 'object') ? tenant.profile : {};
  const metrics = (tenant?.metrics && typeof tenant.metrics === 'object') ? tenant.metrics : {};
  const subInfo = (tenant as any)?.subscription && typeof (tenant as any).subscription === 'object' ? (tenant as any).subscription : null;
  const planPricing = (tenant as any)?.planPricing && typeof (tenant as any).planPricing === 'object' ? (tenant as any).planPricing : null;
  const planLimits = (tenant as any)?.planLimits && typeof (tenant as any).planLimits === 'object' ? (tenant as any).planLimits : null;

  const branchesTable = Array.isArray((tenant as any)?.branchesTable) ? (tenant as any).branchesTable : [];
  const activity = Array.isArray((tenant as any)?.activity) ? (tenant as any).activity : [];

  const fmtEtb = (n: number) => `ETB ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n || 0))}`;
  const fmtCompact = (n: number) =>
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(Number(n || 0));

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

  const nextInvoiceLabel = (() => {
    const raw = String(subInfo?.nextBillAt || '').trim();
    if (!raw) return '-';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  })();

  const graceLabel = (() => {
    const raw = String(subInfo?.graceEndsAt || '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  })();
  const incidents = Array.isArray(tenant?.incidents) ? tenant!.incidents! : [];

  const statusPill = (() => {
    const st = String(tenant?.status || '').toLowerCase();
    if (st === 'active') return { cls: 'bg-green-500/20 text-green-400 border border-green-500/30', label: 'Active' };
    if (st === 'suspended') return { cls: 'bg-red-900/20 text-red-400 border border-red-900/50', label: 'Suspended' };
    if (st === 'trial') return { cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', label: 'New' };
    return { cls: 'bg-[#2c241b] text-[#c9b792] border border-[#483c23]', label: tenant?.status || 'Unknown' };
  })();

  const branchStatusUi = (raw: string) => {
    const s = String(raw || '').toLowerCase();
    if (s === 'online') return { cls: 'bg-green-900/30 text-green-400 border border-green-900/50', dot: 'bg-green-400', label: 'Online' };
    if (s === 'syncing') return { cls: 'bg-yellow-900/30 text-yellow-500 border border-yellow-900/50', dot: 'bg-yellow-500', label: 'Syncing' };
    return { cls: 'bg-red-900/30 text-red-400 border border-red-900/50', dot: 'bg-red-400', label: 'Offline' };
  };
  const initials = useMemo(() => {
    const n = String(tenant?.name || '').trim();
    if (!n) return '??';
    const parts = n.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '');
    return (a + b).toUpperCase() || '??';
  }, [tenant?.name]);

  useEffect(() => {
    // if plan changes, clamp enabled modules to tier
    setEnabledModules((prev) => tierModules.filter((m) => prev.includes(m)));
  }, [tierModules]);

  const toggleModule = (mod: string) => {
    if (!tierModules.includes(mod)) return;
    setEnabledModules((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]));
  };

  const saveModules = async () => {
    if (!tenant?.id) return;
    if (savingModules) return;
    if (!hasUnsavedAccessChanges) return;
    setSavingModules(true);
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(tenant.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModules, features }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast('Modules updated');
      setTimeout(() => setToast(null), 4000);
      await reload();
      setBaselineModules(enabledModules);
      setBaselineFeatures(features);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update modules');
    } finally {
      setSavingModules(false);
    }
  };

  const resetCreds = async () => {
    if (!tenant?.id) return;
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch('/api/superadmin/tenants/reset-creds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast(`Reset token: ${String(json?.resetToken || '')}`);
      setTimeout(() => setToast(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset creds failed');
    }
  };

  const impersonate = async (role: 'Cafe Owner' | 'Branch Manager' | 'Waiter' = 'Cafe Owner', screen: Screen = Screen.OWNER_DASHBOARD) => {
    if (!tenant?.id) return;
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch('/api/superadmin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, role }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      updateSession({
        role: json?.role || role,
        token: json?.token || '',
        superadminToken: readSession<any>()?.superadminToken || undefined,
        branchId: json?.branchId || 'global',
        tenantId: json?.tenantId || tenant.id,
        subscription: json?.subscription || null,
        screen,
      });

      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }

      if (onNavigate) {
        onNavigate(screen);
      } else {
        onBack();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impersonate failed');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
      <header className="flex items-center justify-between whitespace-nowrap border-b border-[#483c23] px-6 py-3 bg-[#221c11] z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white mr-1">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="hidden md:flex flex-col">
            <h2 className="text-white text-lg font-bold leading-tight tracking-[-0.015em]">Tenant Details</h2>
            <div className="text-[11px] text-[#c9b792] font-medium">Super Admin / Tenants / {tenant?.name || 'Tenant'}</div>
          </div>
        </div>
        <div className="flex flex-1 justify-end gap-6">
          <div className="hidden md:flex items-center w-full max-w-md">
            <div className="flex w-full items-stretch rounded-lg h-10 bg-[#2e281a] border border-[#483c23] focus-within:border-[#c9b792] transition-colors">
              <div className="text-[#c9b792] flex items-center justify-center pl-3">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>search</span>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex w-full bg-transparent border-none text-white focus:ring-0 placeholder:text-[#c9b792] px-3 text-sm"
                placeholder="Search tenants, branches, or logs..."
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-[#c9b792] hover:text-white relative">
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-0 right-0 size-2 bg-red-500 rounded-full"></span>
            </button>
            <button className="text-[#c9b792] hover:text-white">
              <span className="material-symbols-outlined">help</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        {toast ? (
          <div className="mb-6 rounded-lg border border-[#483c23] bg-[#2d261a] p-4 text-sm text-[#c9b792]">{toast}</div>
        ) : null}

        {loading && !tenant ? (
          <div className="mb-6 text-sm text-[#c9b792]">Loading tenant...</div>
        ) : null}

        <nav className="flex items-center text-sm">
          <button onClick={onBack} className="text-[#c9b792] hover:text-[#eead2b] transition-colors font-medium">Tenants</button>
          <span className="text-[#c9b792] mx-2">/</span>
          <span className="text-white font-medium">{tenant?.name || 'Tenant'}</span>
        </nav>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-[#483c23] pb-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">{tenant?.name || 'Tenant'}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusPill.cls}`}>{statusPill.label}</span>
            </div>
            <div className="flex items-center gap-2 text-[#c9b792]">
              <span className="material-symbols-outlined text-[18px]">fingerprint</span>
              <span className="font-mono text-sm">ID: {tenant?.id || selectedTenantId || '-'}</span>
              <button
                className="text-[#c9b792] hover:text-white ml-1"
                title="Copy ID"
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(String(tenant?.id || selectedTenantId || ''));
                    setToast('Copied');
                    setTimeout(() => setToast(null), 1500);
                  } catch {
                    // ignore
                  }
                }}
              >
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
              </button>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => impersonate('Cafe Owner', Screen.OWNER_DASHBOARD)}
              disabled={!tenant || loading}
              className="flex items-center gap-2 h-10 px-4 bg-[#2e281a] hover:bg-[#3a3222] border border-[#483c23] rounded-lg text-white text-sm font-bold transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
              <span>Impersonate</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-2 h-10 px-4 bg-[#2e281a] hover:bg-[#3a3222] border border-[#483c23] rounded-lg text-white text-sm font-bold transition-colors"
              onClick={() => setEditOpen(true)}
            >
              <span className="material-symbols-outlined text-[20px]">edit</span>
              <span>Edit Config</span>
            </button>
            <button
              onClick={() => updateTenant({ status: isSuspended ? 'Active' : 'Suspended' })}
              disabled={!tenant || loading}
              className="flex items-center gap-2 h-10 px-4 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 rounded-lg text-red-400 text-sm font-bold transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">block</span>
              <span>{isSuspended ? 'Reactivate' : 'Suspend'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-[#c9b792] text-sm font-medium">Total Branches</p>
              <span className="material-symbols-outlined text-[#eead2b]">store</span>
            </div>
            <p className="text-2xl font-bold text-white">{Number(metrics.branches ?? tenant?.branches ?? 0) || 0}</p>
            <div className="flex items-center gap-1 text-xs text-green-400 mt-1">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span>+{Number(metrics.branchesNewMonth || 0) || 0} this month</span>
            </div>
          </div>
          <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-[#c9b792] text-sm font-medium">Active Users</p>
              <span className="material-symbols-outlined text-[#eead2b]">group</span>
            </div>
            <p className="text-2xl font-bold text-white">{Number(metrics.users ?? tenant?.users ?? 0) || 0}</p>
            <div className="flex items-center gap-1 text-xs text-[#c9b792] mt-1">
              <span>Stable</span>
            </div>
          </div>
          <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-[#c9b792] text-sm font-medium">Monthly Orders</p>
              <span className="material-symbols-outlined text-[#eead2b]">shopping_cart</span>
            </div>
            <p className="text-2xl font-bold text-white">{fmtCompact(Number(metrics.ordersMonth || 0) || 0)}</p>
            <div className="flex items-center gap-1 text-xs text-green-400 mt-1">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span>+{Number(metrics.ordersPct || 0) || 0}% vs last mo</span>
            </div>
          </div>
          <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-[#c9b792] text-sm font-medium">Current MRR</p>
              <span className="material-symbols-outlined text-[#eead2b]">payments</span>
            </div>
            <p className="text-2xl font-bold text-white">{fmtEtb(Number(metrics.mrrEtb || 0) || 0)}</p>
            <div className="flex items-center gap-1 text-xs text-[#c9b792] mt-1">
              <span className="bg-[#eead2b]/20 text-[#eead2b] px-1 rounded">{tenant?.plan || 'Plan'}</span>
            </div>
          </div>
        </div>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Profile & Usage */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="bg-[#2e281a] border border-[#483c23] rounded-lg overflow-hidden">
                <div className="h-24 bg-gradient-to-r from-[#483c23] to-[#221c11] relative">
                  <div className="absolute -bottom-8 left-6 border-4 border-[#2e281a] rounded-full">
                    <div className="size-16 rounded-full bg-white flex items-center justify-center text-[#221c11] font-black">{initials}</div>
                  </div>
                </div>
                <div className="pt-10 px-6 pb-6">
                  <h3 className="text-lg font-bold text-white mb-4">Tenant Profile</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-[#c9b792] uppercase font-bold tracking-wider">Owner</p>
                      <div className="flex items-center gap-2 text-sm text-white">
                        <span className="material-symbols-outlined text-[18px] text-[#eead2b]">person</span>
                        {String(profile?.ownerName || profile?.contactName || profile?.owner || '-')}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-[#c9b792] uppercase font-bold tracking-wider">Contact</p>
                      <div className="flex items-center gap-2 text-sm text-white">
                        <span className="material-symbols-outlined text-[18px] text-[#eead2b]">mail</span>
                        {String(profile?.contactEmail || '-')}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-white mt-1">
                        <span className="material-symbols-outlined text-[18px] text-[#eead2b]">call</span>
                        {String(profile?.contactPhone || '-')}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-[#c9b792] uppercase font-bold tracking-wider">Location</p>
                      <div className="flex items-center gap-2 text-sm text-white">
                        <span className="material-symbols-outlined text-[18px] text-[#eead2b]">location_on</span>
                        {String(profile?.city || '-')}{profile?.country ? `, ${String(profile.country)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-[#483c23]">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[#c9b792]">Next Billing</span>
                      <span className="text-white font-medium">{nextInvoiceLabel}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm mt-2">
                      <span className="text-[#c9b792]">Payment Method</span>
                      <span className="text-white font-medium">{String(subInfo?.method || subInfo?.cycle || 'manual')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-6">
                <h3 className="text-lg font-bold text-white mb-4">Usage vs Limits</h3>
                <div className="space-y-5">
                  {(() => {
                    const used = Number(metrics.branches ?? tenant?.branches ?? 0) || 0;
                    const limit = Number((planLimits as any)?.branchLimit || (planLimits as any)?.branches || 0) || 0;
                    const pct = limit ? Math.min(100, (used / Math.max(1, limit)) * 100) : 0;
                    return (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[#c9b792]">Branches Used</span>
                          <span className="text-white font-bold">{used} / {limit || '-'}</span>
                        </div>
                        <div className="h-2 w-full bg-[#221c11] rounded-full overflow-hidden">
                          <div className="h-full bg-[#eead2b] rounded-full" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const used = Number(metrics.storageGb || 0) || 0;
                    const limit = Number(metrics.storageLimitGb || 0) || 0;
                    const pct = limit ? Math.min(100, (used / Math.max(1, limit)) * 100) : 0;
                    return (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[#c9b792]">Storage (Cloud)</span>
                          <span className="text-white font-bold">{used ? `${used} GB` : '-'}{limit ? ` / ${limit} GB` : ''}</span>
                        </div>
                        <div className="h-2 w-full bg-[#221c11] rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-600 rounded-full" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const pct = Number(metrics.apiUsagePct || metrics.apiCallsPct || 0) || 0;
                    return (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[#c9b792]">API Calls (Monthly)</span>
                          <span className="text-white font-bold">{pct ? `${pct}%` : '-'}</span>
                        </div>
                        <div className="h-2 w-full bg-[#221c11] rounded-full overflow-hidden">
                          <div className="h-full bg-green-600 rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Right Column: Tabs & Data */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="flex border-b border-[#483c23]">
                {[{ key: 'branches', label: 'Branches' }, { key: 'users', label: 'Users' }, { key: 'feature_access', label: 'Feature Access' }, { key: 'integrations', label: 'Integrations' }].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key as any)}
                    className={`px-6 py-3 text-sm transition-colors ${
                      tab === t.key
                        ? 'font-bold text-[#eead2b] border-b-2 border-[#eead2b]'
                        : 'font-medium text-[#c9b792] hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'branches' ? (
              <div className="bg-[#2e281a] border border-[#483c23] rounded-lg overflow-hidden flex flex-col">
                <div className="p-4 flex justify-between items-center border-b border-[#483c23]">
                  <h3 className="font-bold text-white">Branch Status</h3>
                  <button
                    type="button"
                    onClick={reload}
                    className="text-xs font-bold text-[#eead2b] flex items-center gap-1 hover:text-white transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                    Refresh Data
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#221c11] border-b border-[#483c23] text-xs uppercase text-[#c9b792] font-bold tracking-wider">
                        <th className="px-6 py-3">Branch Name</th>
                        <th className="px-6 py-3">Location ID</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">POS Version</th>
                        <th className="px-6 py-3 text-right">Last Sync</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-[#483c23]">
                      {(() => {
                        const needle = search.trim().toLowerCase();
                        const rows = needle
                          ? branchesTable.filter((b: any) =>
                              String(b?.name || '').toLowerCase().includes(needle) ||
                              String(b?.locationId || '').toLowerCase().includes(needle) ||
                              String(b?.status || '').toLowerCase().includes(needle) ||
                              String(b?.posVersion || '').toLowerCase().includes(needle)
                            )
                          : branchesTable;
                        return rows;
                      })().length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-6 text-center text-sm text-[#c9b792]">No branches found.</td>
                        </tr>
                      ) : (
                        (() => {
                          const needle = search.trim().toLowerCase();
                          return needle
                            ? branchesTable.filter((b: any) =>
                                String(b?.name || '').toLowerCase().includes(needle) ||
                                String(b?.locationId || '').toLowerCase().includes(needle) ||
                                String(b?.status || '').toLowerCase().includes(needle) ||
                                String(b?.posVersion || '').toLowerCase().includes(needle)
                              )
                            : branchesTable;
                        })().map((b: any, i: number) => {
                          const st = branchStatusUi(String(b?.syncStatus || b?.status || 'offline'));
                          const lastSync = String(b?.lastSyncAt || '');
                          const lastSyncLabel = lastSync ? relTime(lastSync) : '-';
                          return (
                            <tr key={String(b?.id || i)} className="hover:bg-[#332b1e] transition-colors">
                              <td className="px-6 py-4 font-medium text-white">{String(b?.name || '-')}</td>
                              <td className="px-6 py-4 font-mono text-[#c9b792]">{String(b?.locationId || b?.location || b?.id || '-')}</td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium ${st.cls}`}>
                                  <span className={`size-1.5 rounded-full ${st.dot}`}></span>
                                  {st.label}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-[#c9b792]">{String(b?.posVersion || '-')}</td>
                              <td className="px-6 py-4 text-right text-[#c9b792]">{lastSyncLabel || '-'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="bg-[#221c11] p-3 border-t border-[#483c23] flex justify-center">
                  <button
                    className="text-xs text-[#c9b792] hover:text-white font-medium flex items-center gap-1"
                    type="button"
                    onClick={() => {
                      setTab('branches');
                      setSearch('');
                    }}
                  >
                    View All Branches <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </div>
              </div>
              ) : null}

              {tab === 'users' ? (
                <div className="bg-[#2e281a] border border-[#483c23] rounded-lg overflow-hidden flex flex-col">
                  <div className="p-4 flex justify-between items-center border-b border-[#483c23]">
                    <h3 className="font-bold text-white">Users</h3>
                    <button
                      type="button"
                      onClick={fetchUsers}
                      disabled={usersLoading}
                      className="text-xs font-bold text-[#eead2b] flex items-center gap-1 hover:text-white transition-colors disabled:opacity-60"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${usersLoading ? 'animate-spin' : ''}`}>refresh</span>
                      Refresh
                    </button>
                  </div>
                  {usersError ? (
                    <div className="p-4 text-sm text-red-300">{usersError}</div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#221c11] border-b border-[#483c23] text-xs uppercase text-[#c9b792] font-bold tracking-wider">
                          <th className="px-6 py-3">Name</th>
                          <th className="px-6 py-3">Role</th>
                          <th className="px-6 py-3">Email</th>
                          <th className="px-6 py-3">Phone</th>
                          <th className="px-6 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-[#483c23]">
                        {(() => {
                          const needle = search.trim().toLowerCase();
                          const rows = needle
                            ? users.filter((u: any) =>
                                String(u?.name || '').toLowerCase().includes(needle) ||
                                String(u?.email || '').toLowerCase().includes(needle) ||
                                String(u?.phone || '').toLowerCase().includes(needle) ||
                                String(u?.role || '').toLowerCase().includes(needle)
                              )
                            : users;
                          if (usersLoading) {
                            return (
                              <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-[#c9b792]">Loading users...</td>
                              </tr>
                            );
                          }
                          if (rows.length === 0) {
                            return (
                              <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-[#c9b792]">No users found.</td>
                              </tr>
                            );
                          }
                          return rows.map((u: any) => (
                            <tr key={String(u.id)} className="hover:bg-[#332b1e] transition-colors">
                              <td className="px-6 py-4 font-medium text-white">{String(u.name || '-')}</td>
                              <td className="px-6 py-4 text-[#c9b792]">{String(u.role || '-')}</td>
                              <td className="px-6 py-4 text-[#c9b792]">{String(u.email || '-')}</td>
                              <td className="px-6 py-4 text-[#c9b792]">{String(u.phone || '-')}</td>
                              <td className="px-6 py-4 text-right">
                                <span className="inline-flex items-center rounded-md bg-[#221c11] px-2 py-1 text-xs font-medium text-[#c9b792] border border-[#483c23]">
                                  {String(u.status || '-')}
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {tab === 'feature_access' ? (
                <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-6">
                  <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">Feature Access</h3>
                      <div className="text-xs text-[#c9b792]">Manage tenant modules and feature flags</div>
                    </div>
                    <button
                      type="button"
                      onClick={saveModules}
                      disabled={savingModules || loading || !hasUnsavedAccessChanges}
                      className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#221c11] font-bold hover:bg-[#d69a25] disabled:opacity-60"
                    >
                      {savingModules ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-[#221c11]/50 border border-[#483c23] rounded-lg p-4">
                      <div className="text-[11px] text-[#c9b792] uppercase tracking-wider font-bold mb-2">Subscription Modules</div>
                      {[{ key: 'inventory', icon: 'inventory_2', label: 'Inventory' }, { key: 'reports', icon: 'bar_chart', label: 'Reports' }, { key: 'menu', icon: 'restaurant_menu', label: 'Menu' }, { key: 'staff', icon: 'group', label: 'Staff' }, { key: 'finance', icon: 'payments', label: 'Finance' }, { key: 'settings', icon: 'settings', label: 'Settings' }].map((m) => {
                        const allowedByTier = tierModules.includes(m.key);
                        const active = enabledModules.includes(m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            disabled={!allowedByTier}
                            onClick={() => toggleModule(m.key)}
                            className="w-full flex items-center justify-between p-3 hover:bg-[#221c11]/50 rounded-md transition-colors disabled:opacity-60"
                          >
                            <div className="flex items-center gap-3">
                              <span className="material-symbols-outlined text-[#c9b792]">{m.icon}</span>
                              <div className="flex flex-col items-start">
                                <span className="text-white text-sm">{m.label}</span>
                                {!allowedByTier ? <span className="text-[11px] text-[#c9b792]">Not in plan</span> : null}
                              </div>
                            </div>
                            <span className={`material-symbols-outlined text-[20px] ${active ? 'text-[#eead2b]' : 'text-[#c9b792] opacity-50'}`}>{active ? 'toggle_on' : 'toggle_off'}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="bg-[#221c11]/50 border border-[#483c23] rounded-lg p-4">
                      <div className="text-[11px] text-[#c9b792] uppercase tracking-wider font-bold mb-2">Feature Flags</div>
                      {[{ key: 'loyalty', icon: 'loyalty', label: 'Loyalty Program' }, { key: 'kds', icon: 'restaurant', label: 'Kitchen Display (KDS)' }, { key: 'public_api', icon: 'api', label: 'Public API' }].map((f) => {
                        const active = features.includes(f.key);
                        return (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => toggleFeature(f.key)}
                            className="w-full flex items-center justify-between p-3 hover:bg-[#221c11]/50 rounded-md transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="material-symbols-outlined text-[#c9b792]">{f.icon}</span>
                              <span className="text-white text-sm">{f.label}</span>
                            </div>
                            <span className={`material-symbols-outlined text-[20px] ${active ? 'text-[#eead2b]' : 'text-[#c9b792] opacity-50'}`}>{active ? 'toggle_on' : 'toggle_off'}</span>
                          </button>
                        );
                      })}

                      <div className="mt-3 text-xs">
                        {hasUnsavedAccessChanges ? (
                          <div className="text-[#eead2b] font-semibold">Unsaved changes</div>
                        ) : (
                          <div className="text-[#c9b792]">No pending changes</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === 'integrations' ? (
                <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-6">
                  <h3 className="text-lg font-bold text-white">Integrations</h3>
                  <div className="text-sm text-[#c9b792] mt-2">No integrations configured yet.</div>
                </div>
              ) : null}

              <div className="bg-[#2e281a] border border-[#483c23] rounded-lg p-6">
                <div className="flex justify-between items-end mb-4">
                  <h3 className="text-lg font-bold text-white">Incident History & Logs</h3>
                  <button type="button" onClick={() => setAuditOpen(true)} className="text-sm text-[#eead2b] hover:text-white">View Full Audit Log</button>
                </div>
                <div className="relative pl-4 border-l border-[#483c23] space-y-6">
                  {(() => {
                    const items = activity.length ? activity : incidents;
                    const needle = search.trim().toLowerCase();
                    const filtered = needle
                      ? items.filter((x: any) => String(x?.type || '').toLowerCase().includes(needle) || String(x?.message || '').toLowerCase().includes(needle))
                      : items;
                    return filtered;
                  })().length === 0 ? (
                    <div className="text-sm text-[#c9b792]">No incidents yet.</div>
                  ) : (
                    (() => {
                      const items = activity.length ? activity : incidents;
                      const needle = search.trim().toLowerCase();
                      const filtered = needle
                        ? items.filter((x: any) => String(x?.type || '').toLowerCase().includes(needle) || String(x?.message || '').toLowerCase().includes(needle))
                        : items;
                      return filtered;
                    })().slice(0, 10).map((ev: any, i: number) => {
                      const at = String(ev?.at || '');
                      const when = at ? new Date(at) : null;
                      const ts = when && !Number.isNaN(when.getTime())
                        ? when.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : '-';
                      const type = String(ev?.type || 'event');
                      const desc = String(ev?.message || ev?.summary || ev?.details || '');
                      const sev = String(ev?.severity || type).toLowerCase();
                      const dot = sev.includes('error') ? 'bg-red-500' : sev.includes('warn') ? 'bg-[#eead2b]' : 'bg-green-500';
                      return (
                        <div key={String(ev?.id || i)} className="relative pl-6">
                          <div className={`absolute -left-[21px] top-1 size-3 ${dot} rounded-full border-2 border-[#2e281a]`}></div>
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                            <div>
                              <p className="text-sm font-bold text-white">{type}</p>
                              <p className="text-xs text-[#c9b792] mt-0.5">{desc || `Branch: ${String(ev?.branchId || 'global')}`}</p>
                            </div>
                            <span className="text-xs text-[#c9b792] font-mono whitespace-nowrap">{ts}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
        </div>
        {editOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xl rounded-xl border border-[#483c23] bg-[#221c11] shadow-xl">
              <div className="p-4 border-b border-[#483c23] flex items-center justify-between">
                <div className="font-bold text-white">Edit Tenant Config</div>
                <button type="button" className="text-[#c9b792] hover:text-white" onClick={() => setEditOpen(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">Tenant Name</div>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">Owner</div>
                  <input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">Email</div>
                  <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">Phone</div>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">City</div>
                  <input value={editCity} onChange={(e) => setEditCity(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#c9b792] mb-1">Country</div>
                  <input value={editCountry} onChange={(e) => setEditCountry(e.target.value)} className="h-10 w-full rounded-lg border border-[#483c23] bg-[#2e281a] px-3 text-sm text-white" />
                </div>
              </div>
              <div className="p-4 border-t border-[#483c23] flex items-center justify-end gap-2">
                <button type="button" className="h-10 px-4 rounded-lg border border-[#483c23] bg-[#2e281a] text-[#c9b792] hover:text-white" onClick={() => setEditOpen(false)}>Cancel</button>
                <button type="button" className="h-10 px-4 rounded-lg bg-[#eead2b] text-[#221c11] font-bold hover:bg-[#d69a25]" onClick={saveEditConfig} disabled={loading}>Save</button>
              </div>
            </div>
          </div>
        ) : null}

        {auditOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-3xl rounded-xl border border-[#483c23] bg-[#221c11] shadow-xl">
              <div className="p-4 border-b border-[#483c23] flex items-center justify-between">
                <div className="font-bold text-white">Audit Log (Recent)</div>
                <button type="button" className="text-[#c9b792] hover:text-white" onClick={() => setAuditOpen(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                {(() => {
                  const items = activity.length ? activity : incidents;
                  const needle = search.trim().toLowerCase();
                  const filtered = needle
                    ? items.filter((x: any) => String(x?.type || '').toLowerCase().includes(needle) || String(x?.message || '').toLowerCase().includes(needle))
                    : items;
                  if (filtered.length === 0) return <div className="text-sm text-[#c9b792]">No audit events.</div>;
                  return (
                    <div className="space-y-3">
                      {filtered.slice(0, 50).map((ev: any) => (
                        <div key={String(ev?.id)} className="rounded-lg border border-[#483c23] bg-[#2e281a] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-bold text-white">{String(ev?.type || 'event')}</div>
                            <div className="text-xs font-mono text-[#c9b792]">{String(ev?.at ? new Date(ev.at).toLocaleString() : '')}</div>
                          </div>
                          <div className="text-xs text-[#c9b792] mt-1">{String(ev?.message || '')}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : null}
        </div>
      </main>
    </div>
  );
};
