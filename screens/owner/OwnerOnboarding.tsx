import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { Screen } from '../../types';
import { updateSession } from '../../session';

type TenantProfile = {
  contactEmail?: string;
  contactPhone?: string;
  address1?: string;
  city?: string;
  country?: string;
  timezone?: string;
  currency?: string;
};

type OnboardingState = {
  completed: boolean;
  completedAt: string;
  steps: { profile: boolean; branches: boolean };
  counts: { branches: number };
};

type OnboardingResp = {
  ok: boolean;
  tenant: { id: string; name: string; status: string; profile: TenantProfile } | null;
  onboarding: OnboardingState;
};

export const OwnerOnboarding: React.FC<{ onNavigate?: (screen: Screen) => void; onCompleted?: () => void }> = ({ onNavigate, onCompleted }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnboardingResp | null>(null);

  const [form, setForm] = useState({
    contactPhone: '',
    address1: '',
    city: '',
    country: '',
    timezone: 'Africa/Addis_Ababa',
    currency: 'ETB',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/owner/onboarding');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const next = json as OnboardingResp;
      setData(next);

      const p = (next?.tenant?.profile || {}) as TenantProfile;
      setForm({
        contactPhone: String(p.contactPhone || ''),
        address1: String(p.address1 || ''),
        city: String(p.city || ''),
        country: String(p.country || ''),
        timezone: String(p.timezone || 'Africa/Addis_Ababa'),
        currency: String(p.currency || 'ETB'),
      });

      if (next?.onboarding?.completed) {
        try {
          updateSession({ screen: Screen.OWNER_DASHBOARD });
        } catch {
          // ignore
        }
        onCompleted && onCompleted();
        onNavigate && onNavigate(Screen.OWNER_DASHBOARD);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load onboarding');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onNavigate]);

  useEffect(() => {
    load();
  }, [load]);

  const saveProfile = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/owner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: form }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/owner/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      try {
        updateSession({ screen: Screen.OWNER_DASHBOARD });
      } catch {
        // ignore
      }

      onCompleted && onCompleted();
      onNavigate && onNavigate(Screen.OWNER_DASHBOARD);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  const tenantName = data?.tenant?.name || 'Your Cafe';
  const steps = data?.onboarding?.steps || { profile: false, branches: false };
  const counts = data?.onboarding?.counts || { branches: 0 };

  const canFinish = Boolean(steps.profile && steps.branches);

  const profileMissing = useMemo(() => {
    const missing: string[] = [];
    if (!form.contactPhone.trim()) missing.push('Phone');
    if (!form.address1.trim()) missing.push('Address');
    if (!form.city.trim()) missing.push('City');
    if (!form.country.trim()) missing.push('Country');
    return missing;
  }, [form.address1, form.city, form.contactPhone, form.country]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <OwnerPageHeader
        title="Setup"
        leftSlot={<p className="text-xs text-muted-foreground">Complete onboarding for {tenantName}</p>}
        rightSlot={
          <button
            type="button"
            disabled={loading}
            onClick={load}
            className="h-10 px-4 rounded-lg bg-muted text-foreground text-sm font-bold hover:bg-accent disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading onboarding ¦</div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-4">
          <div className="lg:col-span-7 rounded-xl border border-border bg-card p-6">
            <h3 className="text-lg font-bold mb-4">Company profile</h3>
            <p className="text-sm text-muted-foreground mb-6">This is used for receipts, invoices, and branch setup.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Phone</span>
                <input
                  value={form.contactPhone}
                  onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))}
                  className="h-11 rounded-lg bg-background border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Timezone</span>
                <input
                  value={form.timezone}
                  onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                  className="h-11 rounded-lg bg-background border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-xs text-muted-foreground">Address</span>
                <input
                  value={form.address1}
                  onChange={(e) => setForm((p) => ({ ...p, address1: e.target.value }))}
                  className="h-11 rounded-lg bg-background border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">City</span>
                <input
                  value={form.city}
                  onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                  className="h-11 rounded-lg bg-background border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Country</span>
                <input
                  value={form.country}
                  onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
                  className="h-11 rounded-lg bg-background border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Currency</span>
                <input
                  readOnly
                  value="ETB"
                  className="h-11 rounded-lg bg-muted border border-border px-3 text-sm text-muted-foreground focus:outline-none cursor-not-allowed"
                />
              </label>
            </div>

            {profileMissing.length > 0 ? (
              <div className="mt-4 text-xs text-muted-foreground">Missing: {profileMissing.join(', ')}</div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={saveProfile}
                className="h-11 px-5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary-hover disabled:opacity-50"
              >
                Save profile
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-border bg-card p-6">
            <h3 className="text-lg font-bold mb-4">Checklist</h3>

            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-4 py-3">
                <div>
                  <div className="font-semibold">Company profile</div>
                  <div className="text-xs text-muted-foreground">Phone, address, city, country</div>
                </div>
                <span className={steps.profile ? 'text-emerald-500 font-bold' : 'text-muted-foreground font-bold'}>{steps.profile ? 'Done' : 'Required'}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-4 py-3">
                <div>
                  <div className="font-semibold">At least 1 branch</div>
                  <div className="text-xs text-muted-foreground">We created a default branch automatically</div>
                </div>
                <span className={steps.branches ? 'text-emerald-500 font-bold' : 'text-muted-foreground font-bold'}>
                  {steps.branches ? `Done (${counts.branches})` : 'Required'}
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                disabled={!canFinish || saving}
                onClick={complete}
                className="h-11 px-5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary-hover disabled:opacity-50"
              >
                Finish setup
              </button>
              {!canFinish ? (
                <div className="text-xs text-muted-foreground">Complete the required items above to finish onboarding.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
