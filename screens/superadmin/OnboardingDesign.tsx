import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceDateTime } from '../../datetime';
import { Screen } from '../../types';
import { updateSession } from '../../session';
import { readSession } from '../../session';

import { AppIcon } from '@/components/ui/app-icon';
type TenantProfile = {
  contactEmail?: string;
  contactPhone?: string;
  address1?: string;
  city?: string;
  country?: string;
  timezone?: string;
  currency?: string;
};

type TenantOnboarding = {
  stage?: string;
  completedAt?: string;
};

type TenantRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  profile?: TenantProfile;
  onboarding?: TenantOnboarding;
  internalTags?: string[];
};

type StageKey = 'incoming' | 'review' | 'plan' | 'activation';

const stageOrder: StageKey[] = ['incoming', 'review', 'plan', 'activation'];
const stageLabel: Record<StageKey, string> = {
  incoming: 'Incoming Requests',
  review: 'Admin Review',
  plan: 'Plan Assignment',
  activation: 'Activation',
};

const normalizeStage = (v: unknown): StageKey => {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'review') return 'review';
  if (s === 'plan') return 'plan';
  if (s === 'activation') return 'activation';
  return 'incoming';
};

const stageNext = (s: StageKey): StageKey => {
  const idx = stageOrder.indexOf(s);
  if (idx < 0) return 'incoming';
  return stageOrder[Math.min(stageOrder.length - 1, idx + 1)];
};

const fmtWhen = (iso?: string) => {
  if (!iso) return '';
  return formatDeviceDateTime(iso, { month: 'short', day: '2-digit', year: 'numeric' }) || '';
};

const hasProfileRisk = (t: TenantRow) => {
  const p = (t.profile || {}) as TenantProfile;
  return !String(p.contactPhone || '').trim() || !String(p.address1 || '').trim() || !String(p.city || '').trim() || !String(p.country || '').trim();
};

export const SA_OnboardingDesign: React.FC<{ onNavigate?: (screen: Screen) => void }> = ({ onNavigate }) => {
  const SELECTED_TENANT_KEY = 'mirachpos.sa.selectedTenantId.v1';

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<StageKey>('review');
  const [q, setQ] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selectedId, setSelectedId] = useState('');

  const [note, setNote] = useState('');

  const [tagInput, setTagInput] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);
  const [activity, setActivity] = useState<Array<{ id: string; at: string; type: string; message?: string; actor?: string }>>([]);

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

  const loadActivity = async (tenantId: string) => {
    setActivityLoading(true);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/activity`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const items = Array.isArray(json?.activity) ? json.activity : [];
      setActivity(items);
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<StageKey, number> = { incoming: 0, review: 0, plan: 0, activation: 0 };
    for (const t of tenants) c[normalizeStage(t?.onboarding?.stage)]++;
    return c;
  }, [tenants]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = tenants
      .map((t) => ({ ...t, _stage: normalizeStage(t?.onboarding?.stage) }))
      .filter((t) => t._stage === tab)
      .sort((a, b) => (String(a.lastActivityAt || a.updatedAt || a.createdAt || '') < String(b.lastActivityAt || b.updatedAt || b.createdAt || '') ? 1 : -1));

    if (!s) return base;
    return base.filter((t) => String(t.name || '').toLowerCase().includes(s) || String(t.id || '').toLowerCase().includes(s));
  }, [q, tab, tenants]);

  const selected = useMemo(() => {
    const found = filtered.find((t) => t.id === selectedId);
    return found || filtered[0] || null;
  }, [filtered, selectedId]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id) {
      setActivity([]);
      return;
    }
    loadActivity(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const openTenantDetails = (tenantId: string) => {
    try {
      localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    } catch {
      // ignore
    }
    onNavigate && onNavigate(Screen.SA_TENANT_DETAILS);
  };

  const updateTenant = async (tenantId: string, patch: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
      if (typeof patch.onboardingStage === 'string') setTab(normalizeStage(patch.onboardingStage));
      await loadActivity(tenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const approveAndNext = async () => {
    if (!selected) return;
    const cur = normalizeStage(selected?.onboarding?.stage);
    const next = stageNext(cur);
    await updateTenant(selected.id, { onboardingStage: next });
  };

  const setTier = async (tier: 'Trial' | 'Basic' | 'Pro' | 'Enterprise') => {
    if (!selected) return;
    await updateTenant(selected.id, { tier });
  };

  const setStatus = async (status: 'Active' | 'Suspended') => {
    if (!selected) return;
    await updateTenant(selected.id, { status });
  };

  const activate = async () => {
    if (!selected) return;
    await updateTenant(selected.id, { status: 'Active', onboardingStage: 'activation' });
    onNavigate && onNavigate(Screen.SA_TENANTS);
  };

  const suspend = async () => {
    if (!selected) return;
    await updateTenant(selected.id, { status: 'Suspended' });
  };

  const addTag = async () => {
    if (!selected) return;
    const v = tagInput.trim();
    if (!v) return;
    const current = Array.isArray(selected.internalTags) ? selected.internalTags : [];
    const next = [...new Set([...current, v])].slice(0, 30);
    setTagInput('');
    await updateTenant(selected.id, { internalTags: next });
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    const current = Array.isArray(selected.internalTags) ? selected.internalTags : [];
    const next = current.filter((t) => t !== tag);
    await updateTenant(selected.id, { internalTags: next });
  };

  const postNote = async () => {
    if (!selected) return;
    const msg = note.trim();
    if (!msg) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selected.id)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setNote('');
      await load();
      await loadActivity(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post note');
    } finally {
      setSaving(false);
    }
  };

  const stageChip = selected ? stageLabel[normalizeStage(selected?.onboarding?.stage)] : stageLabel[tab];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <div className="bg-background border-b border-border pt-6 px-8 shrink-0">
        <div className="flex flex-wrap justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-foreground text-3xl font-black leading-tight tracking-[-0.033em]">Onboarding &amp; Approvals</h1>
            <p className="text-muted-foreground text-sm font-normal">Manage cafe onboarding pipeline from request to activation.</p>
          </div>
          <div className="flex gap-3 items-start">
            <button
              onClick={load}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-medium hover:text-foreground hover:bg-accent transition-colors"
              type="button"
            >
              <AppIcon name="refresh" className="text-[18px]" size={18} /> Refresh
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-medium hover:text-foreground hover:bg-accent transition-colors"
              type="button"
              disabled
            >
              <AppIcon name="tune" className="text-[18px]" size={18} /> Configure Workflow
            </button>
          </div>
        </div>

        <div className="flex gap-8 overflow-x-auto no-scrollbar">
          {stageOrder.map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={
                  active
                    ? 'flex flex-col items-center justify-center border-b-[3px] border-b-primary text-foreground pb-3'
                    : 'flex flex-col items-center justify-center border-b-[3px] border-b-transparent text-muted-foreground pb-3 hover:text-foreground transition-colors group'
                }
                type="button"
              >
                <p className="text-sm font-bold tracking-[0.015em] flex items-center gap-2">
                  {stageLabel[k]}{' '}
                  <span
                    className={
                      active
                        ? 'bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold'
                        : 'bg-muted/40 text-muted-foreground text-[10px] px-1.5 py-0.5 rounded-full border border-border group-hover:text-foreground'
                    }
                  >
                    {counts[k] || 0}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[380px] bg-card border-r border-border flex flex-col shrink-0">
          <div className="p-4 border-b border-border flex flex-col gap-3">
            <div className="relative w-full">
              <AppIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[20px]" size={20} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full bg-background border border-border rounded-lg py-2 pl-10 pr-3 text-sm text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground"
                placeholder="Filter requests..."
                type="text"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Sorted by: <span className="text-foreground font-medium">Newest</span>
              </span>
              <button className="hover:text-foreground flex items-center gap-1" type="button" disabled>
                <AppIcon name="filter_list" className="text-[16px]" size={16} /> Filters
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
            {loading ? <div className="p-3 text-xs text-muted-foreground">Loading </div> : null}
            {filtered.map((t) => {
              const active = selected ? t.id === selected.id : t.id === selectedId;
              const risk = hasProfileRisk(t);
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={
                    active
                      ? 'p-4 rounded-lg bg-accent border border-primary/30 shadow-sm relative cursor-pointer group'
                      : 'p-4 rounded-lg border border-border bg-background hover:bg-accent cursor-pointer transition-colors group'
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedId(t.id);
                  }}
                >
                  {active ? (
                    <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(238,173,43,0.6)]"></div>
                  ) : null}
                  <h3 className={active ? 'font-bold text-foreground text-base mb-1' : 'font-bold text-muted-foreground group-hover:text-foreground text-base mb-1'}>
                    {t.name}
                  </h3>
                  <p className={active ? 'text-xs text-muted-foreground mb-3 font-mono' : 'text-xs text-muted-foreground/70 mb-3 font-mono'}>ID: {t.id}</p>
                  <div className="flex items-center justify-between">
                    {risk ? (
                      <span className="px-2 py-0.5 rounded bg-red-900/20 text-red-400 text-[10px] border border-red-900/30 font-medium uppercase tracking-wide">
                        Risk Flag
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-muted/40 text-muted-foreground text-[10px] border border-border font-medium uppercase tracking-wide">
                        {t.status || 'In Review'}
                      </span>
                    )}
                    <span className={active ? 'text-[10px] text-muted-foreground' : 'text-[10px] text-muted-foreground/70'}>{fmtWhen(t.lastActivityAt || t.updatedAt || t.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-background p-6 lg:p-8 relative">
          <div className="max-w-[1000px] mx-auto pb-20">
            {error ? (
              <div className="mb-6 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
            ) : null}

            {!selected ? (
              <div className="text-sm text-muted-foreground">Select a request from the left.</div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-8 pb-6 border-b border-border">
                  <div className="flex gap-5">
                    <div className="w-16 h-16 rounded-xl bg-card border border-border flex items-center justify-center shrink-0 shadow-sm">
                      <AppIcon name="storefront" className="text-3xl text-muted-foreground" size={30} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">{selected.name}</h2>
                        <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/30">{stageChip}</span>
                      </div>
                      <div className="flex items-center gap-4 text-muted-foreground text-sm">
                        <span className="flex items-center gap-1">
                          <AppIcon name="location_on" className="text-[18px]" size={18} />
                          {(selected.profile?.city || '') + (selected.profile?.country ? `, ${selected.profile?.country}` : '')}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-border"></span>
                        <span className="flex items-center gap-1">
                          <AppIcon name="calendar_today" className="text-[18px]" size={18} />
                          Submitted {fmtWhen(selected.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => openTenantDetails(selected.id)}
                      disabled={saving}
                      className="px-4 py-2 text-sm font-bold text-foreground border border-border bg-card rounded-lg hover:bg-accent transition-colors shadow-sm disabled:opacity-50"
                      type="button"
                    >
                      Request Info
                    </button>
                    <button
                      onClick={approveAndNext}
                      disabled={saving}
                      className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(238,173,43,0.15)] flex items-center gap-2 disabled:opacity-50"
                      type="button"
                    >
                      <AppIcon name="check" className="text-[18px]" size={18} /> Approve &amp; Next
                    </button>
                  </div>
                </div>

                {hasProfileRisk(selected) ? (
                  <div className="mb-8 p-4 rounded-lg border border-red-900/40 bg-red-950/10 flex gap-4 items-start shadow-sm">
                    <div className="p-2 bg-red-900/20 rounded-md shrink-0">
                      <AppIcon name="warning" className="text-red-400" />
                    </div>
                    <div>
                      <h4 className="text-red-400 font-bold text-sm mb-1 uppercase tracking-wide">RISK FLAG: INCOMPLETE PROFILE</h4>
                      <p className="text-red-200/70 text-sm leading-relaxed">Missing tenant contact/location fields. Complete profile before plan assignment.</p>
                    </div>
                    <button className="ml-auto text-xs text-red-400 font-medium underline hover:text-red-300" type="button" disabled>
                      View Details
                    </button>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8 space-y-6">
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/40 flex justify-between items-center">
                        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
                          <AppIcon name="domain" className="text-primary text-[18px]" size={18} /> Business Details
                        </h3>
                        <span className="text-muted-foreground text-xs">Verified via API</span>
                      </div>
                      <div className="p-5 grid grid-cols-2 gap-y-6 gap-x-8 text-sm">
                        <div className="col-span-2">
                          <p className="text-muted-foreground text-xs mb-2 uppercase tracking-wide">Registered Address</p>
                          <p className="text-foreground font-medium bg-background p-3 rounded border border-border text-sm leading-relaxed">
                            {selected.profile?.address1 || ' ”'}
                            <br />
                            {(selected.profile?.city || ' ”') + (selected.profile?.country ? `, ${selected.profile?.country}` : '')}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wide">Store Phone</p>
                          <p className="text-foreground font-medium">{selected.profile?.contactPhone || ' ”'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wide">Contact Email</p>
                          <p className="text-foreground font-medium">{selected.profile?.contactEmail || ' ”'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/40 flex justify-between items-center">
                        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
                          <AppIcon name="credit_card" className="text-primary text-[18px]" size={18} /> Plan Assignment
                        </h3>
                      </div>
                      <div className="p-5 flex flex-wrap gap-2">
                        {(['Trial', 'Basic', 'Pro', 'Enterprise'] as const).map((tier) => (
                          <button
                            key={tier}
                            onClick={() => setTier(tier)}
                            disabled={saving}
                            className={
                              'px-3 py-2 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ' +
                              (selected.plan === tier
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground')
                            }
                            type="button"
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/40 flex justify-between items-center">
                        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
                          <AppIcon name="toggle_on" className="text-primary text-[18px]" size={18} /> Activation
                        </h3>
                      </div>
                      <div className="p-5 flex flex-wrap gap-2">
                        <button
                          onClick={activate}
                          disabled={saving}
                          className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          type="button"
                        >
                          Activate
                        </button>
                        <button
                          onClick={suspend}
                          disabled={saving}
                          className="px-3 py-2 rounded-lg text-xs font-bold border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                          type="button"
                        >
                          Suspend
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-4 space-y-6">
                    <div className="bg-card border border-border rounded-xl p-5">
                      <h3 className="text-muted-foreground font-bold mb-4 text-xs uppercase tracking-wide">Internal Tags</h3>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {(Array.isArray((selected as any).internalTags) ? ((selected as any).internalTags as string[]) : []).map((t) => (
                          <span
                            key={t}
                            className="px-2.5 py-1 rounded bg-background border border-border text-xs text-muted-foreground font-medium flex items-center gap-1 group"
                          >
                            {t}
                            <button
                              onClick={() => removeTag(t)}
                              className="text-muted-foreground/50 hover:text-foreground"
                              type="button"
                              disabled={saving}
                            >
                              <AppIcon name="close" className="text-[14px]" size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="relative">
                        <input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addTag();
                          }}
                          className="w-full bg-background border border-border rounded py-1.5 px-3 text-sm text-foreground focus:border-primary focus:ring-0 placeholder:text-muted-foreground transition-all"
                          placeholder="+ Add tag"
                          type="text"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-[400px]">
                      <div className="px-5 py-3 border-b border-border bg-muted/40">
                        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
                          <AppIcon name="history_edu" className="text-muted-foreground text-[18px]" size={18} /> Activity Log
                        </h3>
                      </div>
                      <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                        {activityLoading ? <div className="text-xs text-muted-foreground">Loading </div> : null}
                        {activity.map((a) => (
                          <div key={a.id} className="relative pl-6 border-l border-border">
                            <div className="absolute -left-[5px] top-0 w-[9px] h-[9px] rounded-full bg-border border border-card"></div>
                            <div className="flex justify-between items-baseline mb-1">
                              <p className="text-xs font-bold text-foreground">{a.actor || 'System'}</p>
                              <p className="text-[10px] text-muted-foreground">{fmtWhen(a.at)}</p>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{a.message || a.type}</p>
                          </div>
                        ))}
                        {!activityLoading && activity.length === 0 ? <div className="text-xs text-muted-foreground">No activity yet.</div> : null}
                      </div>
                      <div className="p-3 border-t border-border bg-muted/40">
                        <div className="relative">
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground focus:border-primary focus:ring-0 resize-none h-20 mb-2 placeholder:text-muted-foreground"
                            placeholder="Add internal note..."
                          ></textarea>
                          <div className="flex justify-end">
                            <button
                              onClick={postNote}
                              className="px-3 py-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold rounded transition-colors uppercase tracking-wide"
                              type="button"
                              disabled={!note.trim() || saving}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
