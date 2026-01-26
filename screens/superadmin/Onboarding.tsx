import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceDate } from '../../datetime';
import { Screen } from '../../types';
import { updateSession } from '../../session';
import { readSession } from '../../session';

type TenantRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  branches: number;
  users: number;
  lastActivityAt?: string;
};

export const SA_Onboarding: React.FC<{ onNavigate?: (screen: Screen) => void }> = ({ onNavigate }) => {
  const SELECTED_TENANT_KEY = 'mirachpos.sa.selectedTenantId.v1';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'trial' | 'all'>('trial');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/superadmin/tenants');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const list = Array.isArray(json?.tenants) ? (json.tenants as TenantRow[]) : [];
      setTenants(list);
      if (!selectedId && list.length > 0) setSelectedId(String(list[0]?.id || ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tenants');
      setTenants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = tab === 'trial'
      ? tenants.filter((t) => String(t.status || '') === 'Trial' || String(t.plan || '') === 'Trial')
      : tenants;
    if (!s) return base;
    return base.filter((t) => String(t.name || '').toLowerCase().includes(s) || String(t.id || '').toLowerCase().includes(s));
  }, [q, tab, tenants]);

  const selected = useMemo(() => filtered.find((t) => t.id === selectedId) || filtered[0] || null, [filtered, selectedId]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const updateTenant = async (tenantId: string, patch: { status?: string; tier?: string }) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast('Updated');
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const openTenantDetails = (tenantId: string) => {
    try {
      localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    } catch {
      // ignore
    }
    onNavigate && onNavigate(Screen.SA_TENANT_DETAILS);
  };

  const impersonateOwner = async (tenantId: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch('/api/superadmin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, role: 'Cafe Owner' }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      try {
        updateSession({
          role: json?.role || 'Cafe Owner',
          token: json?.token || '',
          superadminToken: readSession<any>()?.superadminToken || undefined,
          branchId: json?.branchId || 'global',
          tenantId: json?.tenantId || tenantId,
          subscription: json?.subscription || null,
          screen: Screen.OWNER_DASHBOARD,
        });
      } catch {
        // ignore
      }

      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }
      onNavigate && onNavigate(Screen.OWNER_DASHBOARD);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impersonate failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <div className="bg-background border-b border-border pt-6 px-8 shrink-0">
        <div className="flex flex-wrap justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-foreground text-3xl font-black leading-tight tracking-[-0.033em]">Onboarding & Approvals</h1>
            <p className="text-muted-foreground text-sm font-normal">Review trial signups, assign plans, and suspend/activate tenants.</p>
          </div>
          <div className="flex gap-3 items-start">
            <button
              onClick={load}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-medium hover:text-foreground hover:bg-accent transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span> Refresh
            </button>
          </div>
        </div>

        <div className="flex gap-3 pb-4">
          <button
            onClick={() => setTab('trial')}
            className={
              tab === 'trial'
                ? 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold'
                : 'px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-bold hover:bg-accent hover:text-foreground'
            }
          >
            Trial
          </button>
          <button
            onClick={() => setTab('all')}
            className={
              tab === 'all'
                ? 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold'
                : 'px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-bold hover:bg-accent hover:text-foreground'
            }
          >
            All
          </button>
          <div className="flex-1" />
          <div className="relative w-[320px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[20px]">search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-card border border-border rounded-lg py-2 pl-10 pr-3 text-sm text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground"
              placeholder="Search by name or tenant ID"
              type="text"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[380px] bg-card border-r border-border flex flex-col shrink-0">
          <div className="p-4 border-b border-border text-xs text-muted-foreground">
            {loading ? 'Loading ¦' : `${filtered.length} tenants`}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={
                  'w-full text-left p-4 rounded-lg border transition-colors ' +
                  (t.id === selectedId
                    ? 'bg-accent border-primary/30'
                    : 'bg-background border-border hover:bg-accent')
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-foreground text-base">{t.name}</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground font-bold">{t.plan}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{t.id}</p>
                <div className="flex items-center justify-between mt-3">
                  <span
                    className={
                      'text-[10px] px-2 py-0.5 rounded border font-bold ' +
                      (t.status === 'Active'
                        ? 'bg-green-900/20 text-green-300 border-green-900/40'
                        : 'bg-red-900/20 text-red-300 border-red-900/40')
                    }
                  >
                    {t.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">{t.lastActivityAt ? formatDeviceDate(t.lastActivityAt) : ''}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-background p-6 lg:p-8">
          {error ? (
            <div className="mb-6 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
          ) : null}
          {toast ? (
            <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{toast}</div>
          ) : null}

          {!selected ? (
            <div className="text-sm text-muted-foreground">Select a tenant from the left.</div>
          ) : (
            <div className="max-w-[1100px]">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-foreground tracking-tight">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground font-mono">{selected.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={saving}
                    onClick={() => openTenantDetails(selected.id)}
                    className="px-4 py-2 text-sm font-bold text-foreground border border-border bg-card rounded-lg hover:bg-accent disabled:opacity-50"
                  >
                    Open Details
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => impersonateOwner(selected.id)}
                    className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    Impersonate Owner
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-foreground font-bold text-sm mb-4">Status</h3>
                  <div className="flex gap-3">
                    <button
                      disabled={saving || selected.status === 'Active'}
                      onClick={() => updateTenant(selected.id, { status: 'Active' })}
                      className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50"
                    >
                      Activate
                    </button>
                    <button
                      disabled={saving || selected.status === 'Suspended'}
                      onClick={() => updateTenant(selected.id, { status: 'Suspended' })}
                      className="flex-1 h-11 rounded-lg bg-destructive text-destructive-foreground font-bold text-sm hover:bg-destructive/90 disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-foreground font-bold text-sm mb-4">Plan assignment</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(['Trial', 'Basic', 'Pro', 'Enterprise'] as const).map((tier) => (
                      <button
                        key={tier}
                        disabled={saving || selected.plan === tier}
                        onClick={() => updateTenant(selected.id, { tier })}
                        className={
                          'h-11 rounded-lg font-bold text-sm border disabled:opacity-50 ' +
                          (selected.plan === tier
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground')
                        }
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-border bg-card p-5">
                <h3 className="text-foreground font-bold text-sm mb-2">Quick metrics</h3>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="text-muted-foreground text-xs">Branches</div>
                    <div className="text-foreground text-lg font-bold">{selected.branches}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="text-muted-foreground text-xs">Users</div>
                    <div className="text-foreground text-lg font-bold">{selected.users}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="text-muted-foreground text-xs">Status</div>
                    <div className="text-foreground text-lg font-bold">{selected.status}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
