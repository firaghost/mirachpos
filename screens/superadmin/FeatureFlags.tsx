import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { PortalMenu } from '../../components/PortalMenu';

import { AppIcon } from '@/components/ui/app-icon';
type FeatureFlag = {
  id: string;
  name: string;
  plan: string;
  risk: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};

type FeatureFlagsResp = {
  ok: true;
  page: number;
  pageSize: number;
  total: number;
  stats: { totalFlags: number; activeGlobally: number; highRisk: number; betaFeatures: number };
  flags: FeatureFlag[];
};

export const SA_FeatureFlags: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FeatureFlagsResp | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalSaving, setModalSaving] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState('All Plans');
  const [formRisk, setFormRisk] = useState('Low');
  const [formEnabled, setFormEnabled] = useState(false);

  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('All Plans');
  const [risk, setRisk] = useState('Risk: Any');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [actionsAnchor, setActionsAnchor] = useState<any>(null);

  const totalPages = useMemo(() => {
    const total = Number(data?.total || 0);
    return Math.max(1, Math.ceil(total / pageSize));
  }, [data?.total]);

  useEffect(() => {
    setPage(1);
  }, [q, plan, risk]);

  const fetchFlags = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (plan !== 'All Plans') params.set('plan', plan);
      if (risk !== 'Risk: Any') params.set('risk', risk.replace('Risk: ', ''));
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiFetch(`/api/superadmin/feature-flags?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as FeatureFlagsResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feature flags');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleActions = (id: string, ev?: React.MouseEvent) => {
    const next = openActionsFor === id ? null : id;
    setOpenActionsFor(next);
    if (!next) {
      setActionsAnchor(null);
      return;
    }
    try {
      const el = (ev?.currentTarget as any) || null;
      const r = el?.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r) {
        setActionsAnchor({
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        });
      } else {
        setActionsAnchor(null);
      }
    } catch {
      setActionsAnchor(null);
    }
  };

  useEffect(() => {
    fetchFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    fetchFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, plan, risk]);

  const stats = data?.stats || { totalFlags: 0, activeGlobally: 0, highRisk: 0, betaFeatures: 0 };
  const flags = Array.isArray(data?.flags) ? data!.flags : [];

  const riskColor = (r: string) => {
    const x = String(r || '').toLowerCase();
    if (x === 'critical') return { text: 'text-destructive', icon: 'error' };
    if (x === 'high') return { text: 'text-destructive', icon: 'warning' };
    if (x === 'medium') return { text: 'text-primary', icon: 'warning' };
    return { text: 'text-emerald-500', icon: 'shield' };
  };

  const timeAgo = (iso: string) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(t)) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  };

  const toggleFlag = async (id: string, enabled: boolean) => {
    if (savingId) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/superadmin/feature-flags/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await fetchFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update flag');
    } finally {
      setSavingId(null);
    }
  };

  const openCreate = () => {
    setModalMode('create');
    setFormId('');
    setFormName('');
    setFormPlan('All Plans');
    setFormRisk('Low');
    setFormEnabled(false);
    setModalOpen(true);
  };

  const openEdit = (flag: FeatureFlag) => {
    setModalMode('edit');
    setFormId(String(flag.id || ''));
    setFormName(String(flag.name || ''));
    setFormPlan(String(flag.plan || 'All Plans'));
    setFormRisk(String(flag.risk || 'Low'));
    setFormEnabled(Boolean(flag.enabled));
    setModalOpen(true);
  };

  const saveFlag = async () => {
    if (modalSaving) return;
    const id = formId.trim();
    const name = formName.trim();
    const plan = formPlan.trim() || 'All Plans';
    const risk = formRisk.trim() || 'Low';
    if (!id) {
      setError('Flag ID is required');
      return;
    }
    if (!name) {
      setError('Feature name is required');
      return;
    }

    setModalSaving(true);
    setError(null);
    try {
      if (modalMode === 'create') {
        const res = await apiFetch('/api/superadmin/feature-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, plan, risk, enabled: Boolean(formEnabled) }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      } else {
        const res = await apiFetch(`/api/superadmin/feature-flags/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, plan, risk, enabled: Boolean(formEnabled) }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setModalOpen(false);
      await fetchFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : modalMode === 'create' ? 'Failed to create flag' : 'Failed to update flag');
    } finally {
      setModalSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Scrollable Content Area */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {/* Page Heading & Actions */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-display font-bold text-foreground tracking-tight">Feature Management</h2>
              <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
                Manage global feature availability, plan dependencies, and rollout percentages. 
                <span className="text-primary/80 ml-1">Changes affect live production environments immediately.</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2.5 rounded-lg border border-border bg-card text-foreground hover:bg-accent text-sm font-semibold transition-colors flex items-center gap-2">
                <AppIcon name="history" />
                View Audit Log
              </button>
              <button onClick={openCreate} className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold shadow-lg shadow-primary/10 transition-colors flex items-center gap-2">
                <AppIcon name="add" />
                Create Flag
              </button>
            </div>
          </div>

          {error ? <div className="border border-red-900/40 bg-red-900/10 text-red-200 rounded-lg px-4 py-3 text-sm">{error}</div> : null}

          {/* KPI Stats Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Total Flags</span>
                <AppIcon name="flag" className="text-muted-foreground" />
              </div>
              <span className="text-2xl font-bold text-foreground font-mono">{loading ? ' ”' : String(stats.totalFlags)}</span>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Active Globally</span>
                <AppIcon name="public" className="text-primary" />
              </div>
              <span className="text-2xl font-bold text-foreground font-mono">{loading ? ' ”' : String(stats.activeGlobally)}</span>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">High Risk</span>
                <AppIcon name="warning" className="text-primary" />
              </div>
              <span className="text-2xl font-bold text-foreground font-mono">{loading ? ' ”' : String(stats.highRisk)}</span>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Beta Features</span>
                <AppIcon name="science" className="text-muted-foreground" />
              </div>
              <span className="text-2xl font-bold text-foreground font-mono">{loading ? ' ”' : String(stats.betaFeatures)}</span>
            </div>
          </div>

          {/* Filters Toolbar */}
          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg w-full max-w-sm">
              <AppIcon name="filter_list" className="text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} className="bg-transparent border-none p-0 text-sm text-foreground placeholder:text-muted-foreground focus:ring-0 w-full focus:outline-none" placeholder="Filter by name or ID..." type="text"/>
            </div>
            <div className="h-6 w-[1px] bg-border mx-1"></div>
            <div className="relative">
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="appearance-none bg-background border border-border text-foreground text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-primary cursor-pointer">
                <option>All Plans</option>
                <option>Basic</option>
                <option>Pro</option>
                <option>Enterprise</option>
              </select>
              <AppIcon name="expand_more" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <div className="relative">
              <select value={risk} onChange={(e) => setRisk(e.target.value)} className="appearance-none bg-background border border-border text-foreground text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-primary cursor-pointer">
                <option>Risk: Any</option>
                <option>Risk: Low</option>
                <option>Risk: Medium</option>
                <option>Risk: High</option>
                <option>Risk: Critical</option>
              </select>
              <AppIcon name="expand_more" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium mr-2">Showing {(page - 1) * pageSize + 1}-{(page - 1) * pageSize + flags.length} of {Number(data?.total || 0)}</span>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground disabled:opacity-50">
                <AppIcon name="chevron_left" />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="p-1.5 rounded-md hover:bg-accent text-foreground disabled:opacity-50">
                <AppIcon name="chevron_right" />
              </button>
            </div>
          </div>

          {/* Data Grid */}
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider w-1/3">Feature Name / ID</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Plan Dependency</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Risk Level</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Last Modified</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Status</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td className="p-4 text-sm text-muted-foreground" colSpan={6}>Loading </td>
                  </tr>
                ) : null}

                {!loading && flags.length === 0 ? (
                  <tr>
                    <td className="p-4 text-sm text-muted-foreground" colSpan={6}>No flags found.</td>
                  </tr>
                ) : null}

                {!loading
                  ? flags.map((f) => {
                      const rc = riskColor(f.risk);
                      const initials = String(f.updatedBy || 'SY')
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((x) => x[0].toUpperCase())
                        .join('')
                        .slice(0, 2);
                      const planPill = f.plan === 'All Plans' ? 'bg-muted/40 text-muted-foreground border border-border' : 'bg-primary/10 text-primary border border-primary/20';
                      const labelOn = f.enabled ? 'ON' : 'OFF';
                      const labelColor = f.enabled ? 'text-foreground' : 'text-muted-foreground';
                      return (
                        <tr key={f.id} className="group hover:bg-accent transition-colors">
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="text-foreground font-bold text-sm">{f.name}</span>
                              <span className="text-muted-foreground text-xs font-mono mt-1 opacity-70">{f.id}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={"inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold " + planPill}>{f.plan}</span>
                          </td>
                          <td className="p-4">
                            <div className={"flex items-center gap-2 " + rc.text}>
                              <AppIcon name={rc.icon} />
                              <span className="text-xs font-bold uppercase">{f.risk}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs text-foreground">{initials || 'SY'}</div>
                              <div className="flex flex-col">
                                <span className="text-foreground text-xs">{f.updatedBy || 'System'}</span>
                                <span className="text-muted-foreground text-[10px]">{timeAgo(f.updatedAt)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <label className="inline-flex relative items-center cursor-pointer">
                              <input
                                checked={!!f.enabled}
                                onChange={(e) => toggleFlag(f.id, e.target.checked)}
                                disabled={savingId === f.id}
                                className="sr-only peer"
                                type="checkbox"
                              />
                              <div className="w-11 h-6 bg-muted rounded-full peer border border-border peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary/20 peer-checked:after:bg-primary peer-checked:border-primary"></div>
                              <span className={"ml-3 text-sm font-medium min-w-[30px] " + labelColor}>{labelOn}</span>
                            </label>
                          </td>
                          <td className="pr-4 text-right">
                            <button
                              type="button"
                              onClick={(ev) => toggleActions(f.id, ev)}
                              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                            >
                              <AppIcon name="more_vert" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </tbody>
            </table>
          </div>

          <PortalMenu
            open={Boolean(openActionsFor) && Boolean(actionsAnchor)}
            anchorRect={actionsAnchor}
            onClose={() => {
              setOpenActionsFor(null);
              setActionsAnchor(null);
            }}
            width={220}
          >
            {(() => {
              const f = flags.find((x) => x.id === openActionsFor);
              if (!f) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      openEdit(f);
                      setOpenActionsFor(null);
                      setActionsAnchor(null);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent"
                  >
                    Edit
                  </button>
                </>
              );
            })()}
          </PortalMenu>

          {modalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div onClick={() => setModalOpen(false)} className="absolute inset-0 bg-black/60"></div>
              <div className="relative w-full max-w-xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
                  <div className="flex flex-col">
                    <div className="text-foreground font-bold">{modalMode === 'create' ? 'Create Feature Flag' : 'Edit Feature Flag'}</div>
                    <div className="text-muted-foreground text-xs">Changes apply immediately.</div>
                  </div>
                  <button onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent">
                    <AppIcon name="close" />
                  </button>
                </div>

                <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Flag ID</div>
                    <input
                      value={formId}
                      onChange={(e) => setFormId(e.target.value)}
                      disabled={modalMode === 'edit' || modalSaving}
                      className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                      placeholder="e.g. feat_inventory_v2"
                      type="text"
                    />
                    {modalMode === 'edit' ? <div className="text-[11px] text-muted-foreground/70">ID cannot be changed.</div> : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Feature Name</div>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      disabled={modalSaving}
                      className="bg-background border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                      placeholder="Human readable name"
                      type="text"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan Dependency</div>
                    <div className="relative">
                      <select
                        value={formPlan}
                        onChange={(e) => setFormPlan(e.target.value)}
                        disabled={modalSaving}
                        className="appearance-none bg-background border border-border text-foreground text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-primary cursor-pointer w-full"
                      >
                        <option>All Plans</option>
                        <option>Basic</option>
                        <option>Pro</option>
                        <option>Enterprise</option>
                        <option>Beta</option>
                      </select>
                      <AppIcon name="expand_more" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Level</div>
                    <div className="relative">
                      <select
                        value={formRisk}
                        onChange={(e) => setFormRisk(e.target.value)}
                        disabled={modalSaving}
                        className="appearance-none bg-background border border-border text-foreground text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-primary cursor-pointer w-full"
                      >
                        <option>Low</option>
                        <option>Medium</option>
                        <option>High</option>
                        <option>Critical</option>
                      </select>
                      <AppIcon name="expand_more" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="md:col-span-2 flex items-center justify-between bg-background border border-border rounded-xl px-4 py-3">
                    <div className="flex flex-col">
                      <div className="text-foreground text-sm font-bold">Status</div>
                      <div className="text-muted-foreground text-xs">Enable or disable globally.</div>
                    </div>
                    <label className="inline-flex relative items-center cursor-pointer">
                      <input
                        checked={!!formEnabled}
                        onChange={(e) => setFormEnabled(e.target.checked)}
                        disabled={modalSaving}
                        className="sr-only peer"
                        type="checkbox"
                      />
                      <div className="w-11 h-6 bg-muted rounded-full peer border border-border peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary/20 peer-checked:after:bg-primary peer-checked:border-primary"></div>
                      <span className={"ml-3 text-sm font-medium min-w-[30px] " + (formEnabled ? 'text-foreground' : 'text-muted-foreground')}>{formEnabled ? 'ON' : 'OFF'}</span>
                    </label>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-border bg-muted/40 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setModalOpen(false)}
                    disabled={modalSaving}
                    className="px-4 py-2.5 rounded-lg border border-border bg-card text-foreground hover:bg-accent text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveFlag}
                    disabled={modalSaving}
                    className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold shadow-lg shadow-primary/10 transition-colors disabled:opacity-60"
                  >
                    {modalSaving ? 'Saving ' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="text-center text-muted-foreground text-xs mt-4">
            MirachPos Admin Console v4.2.0    Data secured via end-to-end encryption
          </div>
        </div>
      </main>
    </div>
  );
};
