import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';

import { AppIcon } from '@/components/ui/app-icon';
type PlatformSettings = {
  platformName: string;
  supportEmail: string;
  defaultTimezone: string;
  defaultCurrency: string;
  termsUrl: string;
  branding: {
    logoUrl: string;
    primaryColor: string;
    accentColor: string;
  };
  limits: {
    maxTenantsPerInstance: number;
    storageQuotaGbPerTenant: number;
    apiRateLimitPerMin: number;
  };
  security: {
    sessionTtlMinutes: number;
    requireMfaForSuperAdmin: boolean;
    allowDemoSeed: boolean;
  };
  maintenance: {
    enabled: boolean;
    message: string;
  };
};

type PlatformSettingsResp = { ok: true; settings: PlatformSettings };

const defaultDraft: PlatformSettings = {
  platformName: 'MirachPos Enterprise',
  supportEmail: 'support@mirachpos.com',
  defaultTimezone: 'Africa/Addis_Ababa',
  defaultCurrency: 'ETB (Br)',
  termsUrl: 'https://mirachpos.com/terms',
  branding: { logoUrl: '', primaryColor: '#eead2b', accentColor: '#c9b792' },
  limits: { maxTenantsPerInstance: 100, storageQuotaGbPerTenant: 50, apiRateLimitPerMin: 1000 },
  security: { sessionTtlMinutes: 7 * 24 * 60, requireMfaForSuperAdmin: false, allowDemoSeed: true },
  maintenance: { enabled: false, message: 'Scheduled maintenance in progress. Please try again shortly.' },
};

const normalizeLocalSettings = (v: any): PlatformSettings => {
  const x = (v && typeof v === 'object') ? v : {};
  return {
    ...defaultDraft,
    ...x,
    branding: { ...defaultDraft.branding, ...(x.branding && typeof x.branding === 'object' ? x.branding : {}) },
    limits: { ...defaultDraft.limits, ...(x.limits && typeof x.limits === 'object' ? x.limits : {}) },
    security: { ...defaultDraft.security, ...(x.security && typeof x.security === 'object' ? x.security : {}) },
    maintenance: { ...defaultDraft.maintenance, ...(x.maintenance && typeof x.maintenance === 'object' ? x.maintenance : {}) },
  };
};

const stableStringify = (value: any): string => {
  const seen = new WeakSet();
  const walk = (v: any): any => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk);
      const out: any = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
};

export const SA_Settings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PlatformSettings>(defaultDraft);
  const [draft, setDraft] = useState<PlatformSettings>(defaultDraft);

  const [activeTab, setActiveTab] = useState<'general' | 'security' | 'limits' | 'branding' | 'environment'>('general');

  const dirty = useMemo(() => stableStringify(saved) !== stableStringify(draft), [saved, draft]);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const s0 = (json as PlatformSettingsResp).settings || defaultDraft;
      const s = normalizeLocalSettings(s0);
      setSaved(s);
      setDraft(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load platform settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discard = () => {
    setError(null);
    setDraft(saved);
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const s0 = (json as PlatformSettingsResp).settings || draft;
      const s = normalizeLocalSettings(s0);
      setSaved(s);
      setDraft(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save platform settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Main Scrollable Content */}
      <main className="flex-1 overflow-y-auto bg-background scroll-smooth">
        <div className="max-w-[1200px] mx-auto p-8 pb-24">
          {/* Breadcrumbs & Heading */}
          <div className="flex flex-col gap-6 mb-8">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Dashboard</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-foreground font-medium">Platform Settings</span>
            </div>
            <div className="flex justify-between items-end">
              <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Platform Settings</h2>
                <p className="text-muted-foreground text-base max-w-2xl">Global configuration for the MirachPos environment. Changes here affect all tenants and system behavior.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={discard} disabled={!dirty || loading || saving} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-transparent border border-border rounded hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60 disabled:hover:bg-transparent">
                  Discard Changes
                </button>
                <button onClick={save} disabled={!dirty || loading || saving} className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-60">
                  <AppIcon name="save" />
                  {saving ? 'Saving ' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
          {error ? <div className="mb-6 border border-red-900/40 bg-red-900/10 text-red-200 rounded-lg px-4 py-3 text-sm">{error}</div> : null}
          {/* Two Column Layout: Nav & Form */}
          <div className="grid grid-cols-12 gap-8">
            {/* Left Col: Settings Categories */}
            <div className="col-span-12 lg:col-span-3">
              <nav className="flex flex-col gap-1 sticky top-4">
                <button onClick={() => setActiveTab('general')} className="cursor-pointer group text-left">
                  <div className={(activeTab === 'general' ? 'bg-accent border-border' : 'border-transparent') + " flex items-center gap-3 p-3 rounded border hover:bg-accent/60 transition-all"}>
                    <AppIcon name="tune" className="text-muted-foreground peer-checked:text-primary group-hover:text-foreground transition-colors" />
                    <div className="flex flex-col">
                      <span className={"text-sm font-medium group-hover:text-foreground " + (activeTab === 'general' ? 'text-foreground' : 'text-muted-foreground')}>General</span>
                    </div>
                  </div>
                </button>
                <button onClick={() => setActiveTab('security')} className="cursor-pointer group text-left">
                  <div className={(activeTab === 'security' ? 'bg-accent border-border' : 'border-transparent') + " flex items-center gap-3 p-3 rounded border hover:bg-accent/60 transition-all"}>
                    <AppIcon name="security" className="text-muted-foreground peer-checked:text-primary group-hover:text-foreground transition-colors" />
                    <div className="flex flex-col">
                      <span className={"text-sm font-medium group-hover:text-foreground " + (activeTab === 'security' ? 'text-foreground' : 'text-muted-foreground')}>Security & Access</span>
                    </div>
                  </div>
                </button>
                <button onClick={() => setActiveTab('limits')} className="cursor-pointer group text-left">
                  <div className={(activeTab === 'limits' ? 'bg-accent border-border' : 'border-transparent') + " flex items-center gap-3 p-3 rounded border hover:bg-accent/60 transition-all"}>
                    <AppIcon name="database" className="text-muted-foreground peer-checked:text-primary group-hover:text-foreground transition-colors" />
                    <div className="flex flex-col">
                      <span className={"text-sm font-medium group-hover:text-foreground " + (activeTab === 'limits' ? 'text-foreground' : 'text-muted-foreground')}>System Limits</span>
                    </div>
                  </div>
                </button>
                <button onClick={() => setActiveTab('branding')} className="cursor-pointer group text-left">
                  <div className={(activeTab === 'branding' ? 'bg-accent border-border' : 'border-transparent') + " flex items-center gap-3 p-3 rounded border hover:bg-accent/60 transition-all"}>
                    <AppIcon name="palette" className="text-muted-foreground peer-checked:text-primary group-hover:text-foreground transition-colors" />
                    <div className="flex flex-col">
                      <span className={"text-sm font-medium group-hover:text-foreground " + (activeTab === 'branding' ? 'text-foreground' : 'text-muted-foreground')}>Branding</span>
                    </div>
                  </div>
                </button>
                <div className="h-px bg-border my-2"></div>
                <button onClick={() => setActiveTab('environment')} className="cursor-pointer group text-left">
                  <div className={(activeTab === 'environment' ? 'bg-destructive/10 border-destructive/30' : 'border-transparent') + " flex items-center gap-3 p-3 rounded border hover:bg-accent/60 transition-all"}>
                    <AppIcon name="warning" className="text-destructive/70 peer-checked:text-destructive group-hover:text-destructive transition-colors" />
                    <div className="flex flex-col">
                      <span className={"text-sm font-medium group-hover:text-destructive " + (activeTab === 'environment' ? 'text-destructive' : 'text-muted-foreground')}>Environment</span>
                    </div>
                  </div>
                </button>
              </nav>
            </div>
            {/* Right Col: Forms */}
            <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
              {/* Section: General Information */}
              {activeTab === 'general' ? (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/40">
                    <h3 className="text-lg font-bold text-foreground">General Information</h3>
                    <AppIcon name="info" className="text-muted-foreground" />
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform Name</label>
                      <input value={draft.platformName} onChange={(e) => setDraft((d) => ({ ...d, platformName: e.target.value }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="text" placeholder="Platform name" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Support Email</label>
                      <input value={draft.supportEmail} onChange={(e) => setDraft((d) => ({ ...d, supportEmail: e.target.value }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="email" placeholder="support@..." />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Default Timezone</label>
                      <div className="relative">
                        <select value={draft.defaultTimezone} onChange={(e) => setDraft((d) => ({ ...d, defaultTimezone: e.target.value }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm appearance-none focus:outline-none disabled:opacity-60">
                          <option>Africa/Addis_Ababa</option>
                          <option>UTC (Coordinated Universal Time)</option>
                          <option>EST (Eastern Standard Time)</option>
                          <option>PST (Pacific Standard Time)</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
                          <AppIcon name="expand_more" />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Default Currency</label>
                      <div className="mt-2 flex items-center">
                        <span className="text-foreground font-bold bg-card px-3 py-2 rounded border border-border text-sm">
                          ETB (Br)
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms of Service URL</label>
                      <input value={draft.termsUrl} onChange={(e) => setDraft((d) => ({ ...d, termsUrl: e.target.value }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="url" placeholder="https://..." />
                    </div>
                  </div>
                </section>
              ) : null}
              {/* Section: System Limits */}
              {activeTab === 'limits' ? (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/40">
                    <h3 className="text-lg font-bold text-foreground">System Limits</h3>
                    <AppIcon name="database" className="text-muted-foreground" />
                  </div>
                  <div className="p-6 flex flex-col gap-6">
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Max Tenants Per Instance</span>
                        <span className="text-xs text-muted-foreground mt-1">Hard limit for the number of active tenant databases allowed.</span>
                      </div>
                      <input value={String(draft.limits.maxTenantsPerInstance)} onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, maxTenantsPerInstance: Number(e.target.value || 0) } }))} disabled={loading || saving} className="w-32 bg-card border border-border rounded text-foreground px-4 py-2 focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-right focus:outline-none disabled:opacity-60" type="number" />
                    </div>
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Storage Quota Per Tenant (GB)</span>
                        <span className="text-xs text-muted-foreground mt-1">Default storage allocated to new tenants.</span>
                      </div>
                      <input value={String(draft.limits.storageQuotaGbPerTenant)} onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, storageQuotaGbPerTenant: Number(e.target.value || 0) } }))} disabled={loading || saving} className="w-32 bg-card border border-border rounded text-foreground px-4 py-2 focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-right focus:outline-none disabled:opacity-60" type="number" />
                    </div>
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">API Rate Limit (Req/min)</span>
                        <span className="text-xs text-muted-foreground mt-1">Global throttling limit for external API calls.</span>
                      </div>
                      <input value={String(draft.limits.apiRateLimitPerMin)} onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, apiRateLimitPerMin: Number(e.target.value || 0) } }))} disabled={loading || saving} className="w-32 bg-card border border-border rounded text-foreground px-4 py-2 focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-right focus:outline-none disabled:opacity-60" type="number" />
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'security' ? (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/40">
                    <h3 className="text-lg font-bold text-foreground">Security & Access (Advanced)</h3>
                    <AppIcon name="security" className="text-muted-foreground" />
                  </div>
                  <div className="p-6 flex flex-col gap-6">
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Session TTL (minutes)</span>
                        <span className="text-xs text-muted-foreground mt-1">Controls how long admin sessions remain valid.</span>
                      </div>
                      <input value={String(draft.security.sessionTtlMinutes)} onChange={(e) => setDraft((d) => ({ ...d, security: { ...d.security, sessionTtlMinutes: Number(e.target.value || 0) } }))} disabled={loading || saving} className="w-32 bg-card border border-border rounded text-foreground px-4 py-2 focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-right focus:outline-none disabled:opacity-60" type="number" />
                    </div>
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Require MFA for Super Admin</span>
                        <span className="text-xs text-muted-foreground mt-1">When enabled, SA logins must pass additional verification.</span>
                      </div>
                      <label className="inline-flex relative items-center cursor-pointer">
                        <input checked={!!draft.security.requireMfaForSuperAdmin} onChange={(e) => setDraft((d) => ({ ...d, security: { ...d.security, requireMfaForSuperAdmin: e.target.checked } }))} disabled={loading || saving} className="sr-only peer" type="checkbox" />
                        <div className="w-11 h-6 bg-muted rounded-full peer border border-border peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary/20 peer-checked:after:bg-primary peer-checked:border-primary"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Allow Demo Seeding</span>
                        <span className="text-xs text-muted-foreground mt-1">Enable or disable automatic demo data creation.</span>
                      </div>
                      <label className="inline-flex relative items-center cursor-pointer">
                        <input checked={!!draft.security.allowDemoSeed} onChange={(e) => setDraft((d) => ({ ...d, security: { ...d.security, allowDemoSeed: e.target.checked } }))} disabled={loading || saving} className="sr-only peer" type="checkbox" />
                        <div className="w-11 h-6 bg-muted rounded-full peer border border-border peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary/20 peer-checked:after:bg-primary peer-checked:border-primary"></div>
                      </label>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'branding' ? (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/40">
                    <h3 className="text-lg font-bold text-foreground">Branding</h3>
                    <AppIcon name="palette" className="text-muted-foreground" />
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Logo URL</label>
                      <input value={draft.branding.logoUrl} onChange={(e) => setDraft((d) => ({ ...d, branding: { ...d.branding, logoUrl: e.target.value } }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="url" placeholder="https://..." />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Color</label>
                      <input value={draft.branding.primaryColor} onChange={(e) => setDraft((d) => ({ ...d, branding: { ...d.branding, primaryColor: e.target.value } }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="text" placeholder="#eead2b" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accent Color</label>
                      <input value={draft.branding.accentColor} onChange={(e) => setDraft((d) => ({ ...d, branding: { ...d.branding, accentColor: e.target.value } }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="text" placeholder="#c9b792" />
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'environment' ? (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/40">
                    <h3 className="text-lg font-bold text-foreground">Environment (Advanced)</h3>
                    <AppIcon name="warning" className="text-muted-foreground" />
                  </div>
                  <div className="p-6 flex flex-col gap-6">
                    <div className="flex items-center justify-between gap-4 p-4 border border-border rounded bg-muted/40">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">Maintenance Mode</span>
                        <span className="text-xs text-muted-foreground mt-1">Use when performing upgrades or migrations.</span>
                      </div>
                      <label className="inline-flex relative items-center cursor-pointer">
                        <input checked={!!draft.maintenance.enabled} onChange={(e) => setDraft((d) => ({ ...d, maintenance: { ...d.maintenance, enabled: e.target.checked } }))} disabled={loading || saving} className="sr-only peer" type="checkbox" />
                        <div className="w-11 h-6 bg-muted rounded-full peer border border-border peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary/20 peer-checked:after:bg-primary peer-checked:border-primary"></div>
                      </label>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Maintenance Message</label>
                      <input value={draft.maintenance.message} onChange={(e) => setDraft((d) => ({ ...d, maintenance: { ...d.maintenance, message: e.target.value } }))} disabled={loading || saving} className="w-full bg-card border border-border rounded text-foreground px-4 py-2.5 focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground text-sm focus:outline-none disabled:opacity-60" type="text" placeholder="Message shown during maintenance" />
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
