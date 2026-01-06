import React, { useEffect, useMemo, useState } from 'react';
import { OwnerPageHeader } from '../components/OwnerPageHeader';
import { apiFetch } from '../api';
import { readSession, updateSession } from '../session';

type OwnerSettings = {
  business: {
    businessName: string;
    currency: string;
    timezone: string;
  };
  receipt: {
    footer1: string;
    footer2: string;
    showTin: boolean;
    logoDataUrl?: string;
  };
  payments?: {
    allowSplitPayments: boolean;
    methods: Array<{ id: string; label: string; enabled: boolean }>;
  };
  branchDefaults?: {
    defaultStatus: string;
    defaultCity: string;
    defaultRegion: string;
    defaultCountry: string;
    defaultCurrency: string;
    defaultVatEnabled: boolean;
    defaultVatRate: number;
    defaultServiceChargeEnabled: boolean;
    defaultServiceChargeRate: number;
  };
  taxes: {
    vatEnabled: boolean;
    vatRate: number;
    serviceChargeEnabled: boolean;
    serviceChargeRate: number;
  };
  preferences: {
    language: string;
  };
  security: {
    requirePinForRefunds: boolean;
    requirePinForDiscounts: boolean;
    sessionTimeoutMins: number;
  };
  policies?: {
    pinMinLength: number;
    pinMaxLength: number;
    maxDiscountPctWithoutApproval: number;
    refundsRequireManager: boolean;
    voidsRequireManager: boolean;
  };
  notifications?: {
    channels: { inApp: boolean; email: boolean; sms: boolean };
    rules: { lowStockAlerts: boolean; dailySummary: boolean; paymentFailures: boolean; staffLoginAlerts: boolean };
    emails: { recipients: string[] };
  };
  updatedAt?: string;
};

type PaymentMethod = { id: string; label: string; enabled: boolean };

type SettingsResp = { ok: true; settings: OwnerSettings };

type SubscriptionResp = {
  ok: true;
  tenantId: string;
  subscription: { tier: string; modules: string[]; trialStartAt?: string; trialEndsAt?: string };
  billing: { cycle: string; status: string; method: string; nextBillAt: string; amountEtb: number; graceEndsAt: string };
};

type SessionSub = { tier?: string; modules?: string[] } | null;

const normalizeOwnerSettingsClient = (raw: any): OwnerSettings => {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const business = safe.business && typeof safe.business === 'object' ? safe.business : {};
  const receipt = safe.receipt && typeof safe.receipt === 'object' ? safe.receipt : {};
  const taxes = safe.taxes && typeof safe.taxes === 'object' ? safe.taxes : {};
  const preferences = safe.preferences && typeof safe.preferences === 'object' ? safe.preferences : {};
  const security = safe.security && typeof safe.security === 'object' ? safe.security : {};
  const payments = safe.payments && typeof safe.payments === 'object' ? safe.payments : null;
  const branchDefaults = safe.branchDefaults && typeof safe.branchDefaults === 'object' ? safe.branchDefaults : null;
  const policies = safe.policies && typeof safe.policies === 'object' ? safe.policies : null;
  const notifications = safe.notifications && typeof safe.notifications === 'object' ? safe.notifications : null;

  return {
    business: {
      businessName: typeof business.businessName === 'string' ? business.businessName : '',
      currency: typeof business.currency === 'string' && business.currency ? business.currency : 'ETB',
      timezone: typeof business.timezone === 'string' && business.timezone ? business.timezone : 'Africa/Addis_Ababa',
    },
    receipt: {
      footer1: typeof receipt.footer1 === 'string' ? receipt.footer1 : '',
      footer2: typeof receipt.footer2 === 'string' ? receipt.footer2 : '',
      showTin: typeof receipt.showTin === 'boolean' ? receipt.showTin : true,
      logoDataUrl: typeof receipt.logoDataUrl === 'string' ? receipt.logoDataUrl : '',
    },
    payments: payments
      ? {
        allowSplitPayments: typeof payments.allowSplitPayments === 'boolean' ? payments.allowSplitPayments : false,
        methods: Array.isArray(payments.methods) ? payments.methods : [],
      }
      : {
        allowSplitPayments: false,
        methods: [],
      },
    branchDefaults: branchDefaults
      ? {
        defaultStatus: typeof branchDefaults.defaultStatus === 'string' ? branchDefaults.defaultStatus : 'Open',
        defaultCity: typeof branchDefaults.defaultCity === 'string' ? branchDefaults.defaultCity : '',
        defaultRegion: typeof branchDefaults.defaultRegion === 'string' ? branchDefaults.defaultRegion : '',
        defaultCountry: typeof branchDefaults.defaultCountry === 'string' ? branchDefaults.defaultCountry : '',
        defaultCurrency: typeof branchDefaults.defaultCurrency === 'string' && branchDefaults.defaultCurrency ? branchDefaults.defaultCurrency : 'ETB',
        defaultVatEnabled: typeof branchDefaults.defaultVatEnabled === 'boolean' ? branchDefaults.defaultVatEnabled : true,
        defaultVatRate: Number.isFinite(Number(branchDefaults.defaultVatRate)) ? Number(branchDefaults.defaultVatRate) : 15,
        defaultServiceChargeEnabled:
          typeof branchDefaults.defaultServiceChargeEnabled === 'boolean' ? branchDefaults.defaultServiceChargeEnabled : true,
        defaultServiceChargeRate: Number.isFinite(Number(branchDefaults.defaultServiceChargeRate)) ? Number(branchDefaults.defaultServiceChargeRate) : 10,
      }
      : {
        defaultStatus: 'Open',
        defaultCity: '',
        defaultRegion: '',
        defaultCountry: '',
        defaultCurrency: 'ETB',
        defaultVatEnabled: true,
        defaultVatRate: 15,
        defaultServiceChargeEnabled: true,
        defaultServiceChargeRate: 10,
      },
    taxes: {
      vatEnabled: typeof taxes.vatEnabled === 'boolean' ? taxes.vatEnabled : true,
      vatRate: Number.isFinite(Number(taxes.vatRate)) ? Number(taxes.vatRate) : 15,
      serviceChargeEnabled: typeof taxes.serviceChargeEnabled === 'boolean' ? taxes.serviceChargeEnabled : true,
      serviceChargeRate: Number.isFinite(Number(taxes.serviceChargeRate)) ? Number(taxes.serviceChargeRate) : 10,
    },
    preferences: {
      language: typeof preferences.language === 'string' && preferences.language ? preferences.language : 'en',
    },
    security: {
      requirePinForRefunds: typeof security.requirePinForRefunds === 'boolean' ? security.requirePinForRefunds : true,
      requirePinForDiscounts: typeof security.requirePinForDiscounts === 'boolean' ? security.requirePinForDiscounts : true,
      sessionTimeoutMins: Number.isFinite(Number(security.sessionTimeoutMins)) ? Number(security.sessionTimeoutMins) : 30,
    },
    policies: policies
      ? {
        pinMinLength: Number.isFinite(Number(policies.pinMinLength)) ? Number(policies.pinMinLength) : 4,
        pinMaxLength: Number.isFinite(Number(policies.pinMaxLength)) ? Number(policies.pinMaxLength) : 8,
        maxDiscountPctWithoutApproval: Number.isFinite(Number(policies.maxDiscountPctWithoutApproval))
          ? Number(policies.maxDiscountPctWithoutApproval)
          : 10,
        refundsRequireManager: typeof policies.refundsRequireManager === 'boolean' ? policies.refundsRequireManager : true,
        voidsRequireManager: typeof policies.voidsRequireManager === 'boolean' ? policies.voidsRequireManager : true,
      }
      : {
        pinMinLength: 4,
        pinMaxLength: 8,
        maxDiscountPctWithoutApproval: 10,
        refundsRequireManager: true,
        voidsRequireManager: true,
      },
    notifications: notifications
      ? {
        channels: {
          inApp: typeof notifications.channels?.inApp === 'boolean' ? notifications.channels.inApp : true,
          email: typeof notifications.channels?.email === 'boolean' ? notifications.channels.email : false,
          sms: typeof notifications.channels?.sms === 'boolean' ? notifications.channels.sms : false,
        },
        rules: {
          lowStockAlerts: typeof notifications.rules?.lowStockAlerts === 'boolean' ? notifications.rules.lowStockAlerts : true,
          dailySummary: typeof notifications.rules?.dailySummary === 'boolean' ? notifications.rules.dailySummary : false,
          paymentFailures: typeof notifications.rules?.paymentFailures === 'boolean' ? notifications.rules.paymentFailures : true,
          staffLoginAlerts: typeof notifications.rules?.staffLoginAlerts === 'boolean' ? notifications.rules.staffLoginAlerts : false,
        },
        emails: {
          recipients: Array.isArray(notifications.emails?.recipients) ? notifications.emails.recipients : [],
        },
      }
      : {
        channels: { inApp: true, email: false, sms: false },
        rules: { lowStockAlerts: true, dailySummary: false, paymentFailures: true, staffLoginAlerts: false },
        emails: { recipients: [] },
      },
    updatedAt: typeof safe.updatedAt === 'string' ? safe.updatedAt : undefined,
  };
};

const deepEqual = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const Toggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex items-center cursor-pointer" aria-label={label ?? 'toggle'}>
    <input checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" type="checkbox" />
    <div className="w-11 h-6 bg-[#393328] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={cx(
      'w-full h-11 bg-background border border-border text-white text-sm rounded-lg focus:ring-1 focus:ring-primary/60 focus:border-primary px-4 placeholder-text-muted/50',
      props.className,
    )}
  />
);

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    className={cx(
      'w-full min-h-[92px] bg-background border border-border text-white text-sm rounded-lg focus:ring-1 focus:ring-primary/60 focus:border-primary px-4 py-3 placeholder-text-muted/50',
      props.className,
    )}
  />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    className={cx(
      'w-full h-11 bg-background border border-border text-white text-sm rounded-lg focus:ring-1 focus:ring-primary/60 focus:border-primary px-4',
      props.className,
    )}
  />
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex flex-col">
      <label className="text-xs text-text-muted font-bold uppercase tracking-wider">{label}</label>
      {hint ? <div className="text-xs text-text-muted mt-1">{hint}</div> : null}
    </div>
    {children}
  </div>
);

type TabKey =
  | 'business'
  | 'receipt'
  | 'taxes'
  | 'preferences'
  | 'security'
  | 'payments'
  | 'branch_defaults'
  | 'policies'
  | 'notifications';

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    try {
      const v = localStorage.getItem('mirachpos.settings.initialTab.v1') || '';
      if (v === 'business' || v === 'preferences' || v === 'payments' || v === 'security' || v === 'policies' || v === 'notifications') {
        localStorage.removeItem('mirachpos.settings.initialTab.v1');
        return v as TabKey;
      }
    } catch {
    }
    return 'business';
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionResp | null>(null);


  const [planCatalog, setPlanCatalog] = useState<Array<{ tier: string; pricing: { monthlyEtb: number; yearlyEtb: number }; modules: string[]; limits: any }> | null>(null);

  const [saved, setSaved] = useState<OwnerSettings | null>(null);
  const [draft, setDraft] = useState<OwnerSettings | null>(null);

  const readSessionSubscription = (): SessionSub => {
    try {
      const parsed = readSession<any>();
      return (parsed?.subscription || null) as SessionSub;
    } catch {
      return null;
    }
  };

  const [sessionSubscription, setSessionSubscription] = useState<SessionSub>(() => readSessionSubscription());

  useEffect(() => {
    const onChanged = () => setSessionSubscription(readSessionSubscription());
    window.addEventListener('mirachpos-session-changed', onChanged);
    return () => window.removeEventListener('mirachpos-session-changed', onChanged);
  }, []);

  const tier = String(sessionSubscription?.tier || sub?.subscription?.tier || 'Trial');
  const modules = useMemo(() => {
    const m1 = Array.isArray(sessionSubscription?.modules) ? sessionSubscription!.modules : [];
    const m2 = Array.isArray(sub?.subscription?.modules) ? sub!.subscription.modules : [];
    return m1.length ? m1 : m2;
  }, [sessionSubscription?.modules, sub?.subscription?.modules]);

  const requiredModuleForTab = useMemo(() => {
    const m: Record<TabKey, string | null> = {
      business: 'settings',
      receipt: 'settings',
      taxes: 'settings',
      preferences: 'settings',
      security: 'settings',
      payments: 'settings',
      branch_defaults: 'settings',
      policies: 'settings',
      notifications: 'settings',
    };
    return m;
  }, []);

  const lockedBySubscription = useMemo(() => {
    const billStatus = String(sub?.billing?.status || '').toLowerCase().replace(/\s+/g, '_');
    if (billStatus === 'pending_verify' || billStatus === 'verification_needed') return true;
    const required = requiredModuleForTab[activeTab];
    if (!required) return false;
    const mods = Array.isArray(sub?.subscription?.modules) ? sub!.subscription.modules : [];
    return !mods.includes(required);
  }, [activeTab, requiredModuleForTab, sub?.subscription?.modules]);

  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return !deepEqual(saved, draft);
  }, [saved, draft]);

  const canSave = dirty && !loading && !saving && !!draft && !lockedBySubscription;

  const validate = (s: OwnerSettings) => {
    const name = String(s.business.businessName || '').trim();
    if (!name) return 'Business name is required.';
    if (s.taxes.vatEnabled && (!Number.isFinite(Number(s.taxes.vatRate)) || s.taxes.vatRate < 0 || s.taxes.vatRate > 40)) {
      return 'VAT rate must be between 0 and 40.';
    }
    if (
      s.taxes.serviceChargeEnabled &&
      (!Number.isFinite(Number(s.taxes.serviceChargeRate)) || s.taxes.serviceChargeRate < 0 || s.taxes.serviceChargeRate > 40)
    ) {
      return 'Service charge rate must be between 0 and 40.';
    }
    if (!Number.isFinite(Number(s.security.sessionTimeoutMins)) || s.security.sessionTimeoutMins < 5 || s.security.sessionTimeoutMins > 1440) {
      return 'Session timeout must be between 5 and 1440 minutes.';
    }
    if (s.policies) {
      if (!Number.isFinite(Number(s.policies.pinMinLength)) || s.policies.pinMinLength < 3 || s.policies.pinMinLength > 12) {
        return 'PIN min length must be between 3 and 12.';
      }
      if (!Number.isFinite(Number(s.policies.pinMaxLength)) || s.policies.pinMaxLength < 3 || s.policies.pinMaxLength > 12) {
        return 'PIN max length must be between 3 and 12.';
      }
      if (s.policies.pinMaxLength < s.policies.pinMinLength) {
        return 'PIN max length cannot be less than PIN min length.';
      }
      if (
        !Number.isFinite(Number(s.policies.maxDiscountPctWithoutApproval)) ||
        s.policies.maxDiscountPctWithoutApproval < 0 ||
        s.policies.maxDiscountPctWithoutApproval > 90
      ) {
        return 'Max discount without approval must be between 0 and 90.';
      }
    }
    return null;
  };

  const onLogoFile = async (file: File) => {
    if (!draft) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setBanner({ kind: 'error', message: 'Logo must be an image (png, jpg, jpeg, webp).' });
      return;
    }
    // ~250KB cap to keep settings payload small (backend enforces a larger cap as well)
    if (file.size > 250 * 1024) {
      setBanner({ kind: 'error', message: 'Logo is too large. Please use an image under 250KB.' });
      return;
    }
    setBanner(null);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Failed to read file'));
      r.readAsDataURL(file);
    });
    setDraft({
      ...draft,
      receipt: { ...draft.receipt, logoDataUrl: dataUrl },
    });
  };

  const paymentMethods = useMemo(() => {
    const methods: PaymentMethod[] = (draft?.payments?.methods as PaymentMethod[] | undefined) || [];
    const byId = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));
    const order = [
      { id: 'cash', label: 'Cash', icon: 'payments' },
      { id: 'card', label: 'Card', icon: 'credit_card' },
      { id: 'mobile_money', label: 'Mobile Money', icon: 'smartphone' },
      { id: 'bank_transfer', label: 'Bank Transfer', icon: 'account_balance' },
    ];
    return order.map((o) => {
      const m = byId.get(o.id);
      return { id: o.id, label: m?.label || o.label, enabled: !!m?.enabled, icon: o.icon };
    });
  }, [draft?.payments?.methods]);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/settings');
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as SettingsResp;
      const normalized = normalizeOwnerSettingsClient((json as any)?.settings);
      setSaved(normalized);
      setDraft(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
      setSaved(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const loadSubscription = async () => {
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await apiFetch('/api/owner/subscription');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSub(json);
    } catch (e) {
      setSub(null);
      setSubError(e instanceof Error ? e.message : 'Failed to load subscription');
    } finally {
      setSubLoading(false);
    }
  };

  const loadPlanCatalog = async () => {
    try {
      const res = await apiFetch('/api/owner/plans');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      setPlanCatalog(Array.isArray(json?.plans) ? json.plans : null);
    } catch {
      setPlanCatalog(null);
    }
  };

  useEffect(() => {
    loadSubscription();
    loadPlanCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const discard = () => {
    if (!saved) return;
    setDraft(saved);
    setBanner(null);
  };

  const save = async () => {
    if (!draft || saving) return;
    if (lockedBySubscription) {
      setBanner({ kind: 'error', message: 'This section is visible but locked on your current plan. Upgrade to edit.' });
      return;
    }
    const msg = validate(draft);
    if (msg) {
      setBanner({ kind: 'error', message: msg });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      const normalized = normalizeOwnerSettingsClient((json as any)?.settings);
      setSaved(normalized);
      setDraft(normalized);
      setBanner({ kind: 'success', message: 'Settings saved.' });
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const tabs = useMemo(
    () =>
      [
        { key: 'business' as const, label: 'Business', icon: 'store' },
        { key: 'receipt' as const, label: 'Receipt', icon: 'receipt_long' },
        { key: 'payments' as const, label: 'Payment Methods', icon: 'payments' },
        { key: 'branch_defaults' as const, label: 'Branch Defaults', icon: 'domain' },
        { key: 'taxes' as const, label: 'Taxes & Service', icon: 'percent' },
        { key: 'preferences' as const, label: 'Preferences', icon: 'tune' },
        { key: 'security' as const, label: 'Security', icon: 'security' },
        { key: 'policies' as const, label: 'User/Role Policies', icon: 'policy' },
        { key: 'notifications' as const, label: 'Notifications', icon: 'notifications' },
      ] as const,
    [],
  );

  const s = useMemo(() => {
    if (!draft) return null;
    return normalizeOwnerSettingsClient(draft);
  }, [draft]);





  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white">
      <OwnerPageHeader
        title="Settings"
        leftSlot={<div className="text-xs text-[#b9b09d]">Advanced configuration and preferences</div>}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {error ? (
            <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg">{error}</div>
          ) : null}
          {banner ? (
            <div
              className={cx(
                'px-4 py-3 rounded-lg border',
                banner.kind === 'success'
                  ? 'bg-success/10 border-success/30 text-success'
                  : 'bg-danger/10 border-danger/30 text-danger',
              )}
            >
              {banner.message}
            </div>
          ) : null}

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-3">
              <div className="bg-[#221c10] border border-[#393328] rounded-xl overflow-hidden lg:sticky lg:top-6">
                <div className="p-4 border-b border-[#393328] bg-[#2c241b]">
                  <div className="text-white font-extrabold">Configuration</div>
                  <div className="text-xs text-text-muted mt-1">Owner-level settings</div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveTab(t.key)}
                      className={cx(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors',
                        activeTab === t.key
                          ? 'bg-primary/10 border-primary/40 text-white'
                          : 'bg-transparent border-transparent text-text-muted hover:text-white hover:bg-[#2c241b]',
                      )}
                    >
                      <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
                      <span className="text-sm font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>
                <div className="p-4 border-t border-[#393328] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={discard}
                    disabled={!dirty || saving || loading}
                    className={cx(
                      'px-4 h-10 rounded-lg border text-sm font-bold transition-colors',
                      !dirty || saving || loading
                        ? 'border-border text-text-muted opacity-60 cursor-not-allowed'
                        : 'border-border text-text-muted hover:text-white hover:bg-[#2c241b]',
                    )}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!canSave}
                    className={cx(
                      'px-4 h-10 rounded-lg text-sm font-extrabold transition-colors shadow-lg',
                      canSave ? 'bg-primary text-background hover:bg-primary-hover shadow-primary/20' : 'bg-border text-text-muted cursor-not-allowed',
                    )}
                  >
                    {saving ? 'Saving ¦' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
              <div className="bg-[#221c10] border border-[#393328] rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-[#393328] bg-[#2c241b] flex items-center justify-between">
                  <div className="text-white font-extrabold">
                    {tabs.find((t) => t.key === activeTab)?.label ?? 'Settings'}
                  </div>
                  <div className="text-xs text-text-muted">
                    {loading ? 'Loading ¦' : dirty ? 'Unsaved changes' : 'Up to date'}
                  </div>
                </div>

                <div className="p-6">
                  {!s ? (
                    <div className="text-text-muted">{loading ? 'Loading ¦' : 'No settings loaded.'}</div>
                  ) : null}

                  {lockedBySubscription ? (
                    <div className="mb-6 p-4 border border-primary/40 rounded-lg bg-primary/10">
                      <div className="text-white font-extrabold text-sm">Locked</div>
                      <div className="text-xs text-text-muted mt-1">
                        This section is visible for transparency, but editing is limited on your current plan. Upgrade to unlock.
                      </div>
                    </div>
                  ) : null}



                  <div className={lockedBySubscription ? 'opacity-60 pointer-events-none select-none' : ''}>

                    {s && activeTab === 'business' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Field label="Business Name">
                          <Input
                            value={s.business.businessName}
                            onChange={(e) => setDraft({ ...s, business: { ...s.business, businessName: e.target.value } })}
                          />
                        </Field>
                        <Field label="Currency">
                          <Input value={s.business.currency} onChange={(e) => setDraft({ ...s, business: { ...s.business, currency: e.target.value } })} />
                        </Field>
                        <Field label="Timezone">
                          <Input value={s.business.timezone} onChange={(e) => setDraft({ ...s, business: { ...s.business, timezone: e.target.value } })} />
                        </Field>
                      </div>
                    ) : null}

                    {s && activeTab === 'payments' ? (
                      <div className="flex flex-col gap-6">
                        <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                          <div>
                            <div className="text-white font-bold text-sm">Allow Split Payments</div>
                            <div className="text-xs text-text-muted mt-1">Enable paying one bill using multiple payment methods.</div>
                          </div>
                          <Toggle
                            checked={!!s.payments?.allowSplitPayments}
                            onChange={(v) =>
                              setDraft({
                                ...s,
                                payments: { allowSplitPayments: v, methods: s.payments?.methods || [] },
                              })
                            }
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {paymentMethods.map((m) => (
                            <div key={m.id} className="p-4 border border-border rounded-lg flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <span className="material-symbols-outlined text-text-muted">{m.icon}</span>
                                <div className="flex flex-col">
                                  <div className="text-white font-bold text-sm">{m.label}</div>
                                  <div className="text-xs text-text-muted">{m.id}</div>
                                </div>
                              </div>
                              <Toggle
                                checked={m.enabled}
                                onChange={(v) => {
                                  const current = s.payments?.methods || [];
                                  const byId = new Map(current.map((x) => [x.id, x]));
                                  byId.set(m.id, { id: m.id, label: m.label, enabled: v });
                                  setDraft({
                                    ...s,
                                    payments: { allowSplitPayments: !!s.payments?.allowSplitPayments, methods: Array.from(byId.values()) },
                                  });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {s && activeTab === 'branch_defaults' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Field label="Default Branch Status">
                          <Select
                            value={s.branchDefaults?.defaultStatus || 'Open'}
                            onChange={(e) =>
                              setDraft({
                                ...s,
                                branchDefaults: { ...(s.branchDefaults as any), defaultStatus: e.target.value },
                              })
                            }
                          >
                            <option value="Open">Open</option>
                            <option value="Closed">Closed</option>
                          </Select>
                        </Field>
                        <Field label="Default Currency">
                          <Select
                            value={s.branchDefaults?.defaultCurrency || 'ETB'}
                            onChange={(e) => setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultCurrency: e.target.value } })}
                          >
                            <option value="ETB">ETB</option>
                            <option value="USD">USD</option>
                          </Select>
                        </Field>
                        <Field label="Default City">
                          <Input
                            value={s.branchDefaults?.defaultCity || ''}
                            onChange={(e) => setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultCity: e.target.value } })}
                          />
                        </Field>
                        <Field label="Default Region">
                          <Input
                            value={s.branchDefaults?.defaultRegion || ''}
                            onChange={(e) => setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultRegion: e.target.value } })}
                          />
                        </Field>
                        <Field label="Default Country">
                          <Input
                            value={s.branchDefaults?.defaultCountry || ''}
                            onChange={(e) => setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultCountry: e.target.value } })}
                          />
                        </Field>

                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                            <div>
                              <div className="text-white font-bold text-sm">Default VAT Enabled</div>
                              <div className="text-xs text-text-muted mt-1">Applied when creating new branches.</div>
                            </div>
                            <Toggle
                              checked={!!s.branchDefaults?.defaultVatEnabled}
                              onChange={(v) => setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultVatEnabled: v } })}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                            <div>
                              <div className="text-white font-bold text-sm">Default Service Charge Enabled</div>
                              <div className="text-xs text-text-muted mt-1">Applied when creating new branches.</div>
                            </div>
                            <Toggle
                              checked={!!s.branchDefaults?.defaultServiceChargeEnabled}
                              onChange={(v) =>
                                setDraft({ ...s, branchDefaults: { ...(s.branchDefaults as any), defaultServiceChargeEnabled: v } })
                              }
                            />
                          </div>
                        </div>

                        <Field label="Default VAT Rate (%)">
                          <Input
                            type="number"
                            value={String(s.branchDefaults?.defaultVatRate ?? 15)}
                            onChange={(e) =>
                              setDraft({
                                ...s,
                                branchDefaults: { ...(s.branchDefaults as any), defaultVatRate: Number(e.target.value) },
                              })
                            }
                          />
                        </Field>
                        <Field label="Default Service Charge Rate (%)">
                          <Input
                            type="number"
                            value={String(s.branchDefaults?.defaultServiceChargeRate ?? 10)}
                            onChange={(e) =>
                              setDraft({
                                ...s,
                                branchDefaults: { ...(s.branchDefaults as any), defaultServiceChargeRate: Number(e.target.value) },
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}

                    {s && activeTab === 'receipt' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                          <div className="p-4 border border-border rounded-lg flex items-start justify-between gap-4">
                            <div className="flex flex-col">
                              <div className="text-white font-bold text-sm">Receipt Logo</div>
                              <div className="text-xs text-text-muted mt-1">Optional. Used on printed receipts. Recommended: small PNG/WebP.</div>
                              <div className="mt-3 flex items-center gap-3">
                                <label className="px-4 h-10 inline-flex items-center justify-center rounded-lg bg-surface-light border border-border text-sm font-bold text-text-muted hover:text-white hover:bg-surface transition-colors cursor-pointer">
                                  Upload Logo
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/jpg,image/webp"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) onLogoFile(f);
                                      e.currentTarget.value = '';
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setDraft({ ...s, receipt: { ...s.receipt, logoDataUrl: '' } })}
                                  className="px-4 h-10 rounded-lg border border-border text-sm font-bold text-text-muted hover:text-white hover:bg-surface-light transition-colors"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                            <div className="w-[160px] h-[96px] border border-border rounded-lg bg-background flex items-center justify-center overflow-hidden">
                              {s.receipt.logoDataUrl ? (
                                <img src={s.receipt.logoDataUrl} alt="Receipt logo" className="max-w-full max-h-full object-contain" />
                              ) : (
                                <div className="text-xs text-text-muted">No logo</div>
                              )}
                            </div>
                          </div>
                        </div>

                        <Field label="Footer Line 1">
                          <Input value={s.receipt.footer1} onChange={(e) => setDraft({ ...s, receipt: { ...s.receipt, footer1: e.target.value } })} />
                        </Field>
                        <Field label="Footer Line 2">
                          <Input value={s.receipt.footer2} onChange={(e) => setDraft({ ...s, receipt: { ...s.receipt, footer2: e.target.value } })} />
                        </Field>

                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                            <div>
                              <div className="text-white font-bold text-sm">Show TIN</div>
                              <div className="text-xs text-text-muted mt-1">Include tax number on receipts.</div>
                            </div>
                            <Toggle checked={s.receipt.showTin} onChange={(v) => setDraft({ ...s, receipt: { ...s.receipt, showTin: v } })} />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {s && activeTab === 'taxes' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg md:col-span-2">
                          <div>
                            <div className="text-white font-bold text-sm">VAT</div>
                            <div className="text-xs text-text-muted mt-1">Enable VAT calculations for receipts and reports.</div>
                          </div>
                          <Toggle checked={s.taxes.vatEnabled} onChange={(v) => setDraft({ ...s, taxes: { ...s.taxes, vatEnabled: v } })} />
                        </div>
                        <Field label="VAT Rate (%)">
                          <Input
                            type="number"
                            value={String(s.taxes.vatRate)}
                            onChange={(e) => setDraft({ ...s, taxes: { ...s.taxes, vatRate: Number(e.target.value) } })}
                          />
                        </Field>

                        <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg md:col-span-2">
                          <div>
                            <div className="text-white font-bold text-sm">Service Charge</div>
                            <div className="text-xs text-text-muted mt-1">Apply service charge to orders.</div>
                          </div>
                          <Toggle
                            checked={s.taxes.serviceChargeEnabled}
                            onChange={(v) => setDraft({ ...s, taxes: { ...s.taxes, serviceChargeEnabled: v } })}
                          />
                        </div>
                        <Field label="Service Charge Rate (%)">
                          <Input
                            type="number"
                            value={String(s.taxes.serviceChargeRate)}
                            onChange={(e) => setDraft({ ...s, taxes: { ...s.taxes, serviceChargeRate: Number(e.target.value) } })}
                          />
                        </Field>
                      </div>
                    ) : null}

                    {s && activeTab === 'preferences' ? (
                      <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <Field label="Language" hint="UI language for dashboards and POS screens.">
                            <Select
                              value={s.preferences.language}
                              onChange={(e) => setDraft({ ...s, preferences: { ...s.preferences, language: e.target.value } })}
                            >
                              <option value="en">English</option>
                              <option value="am">Amharic</option>
                            </Select>
                          </Field>
                        </div>
                      </div>
                    ) : null}

                    {s && activeTab === 'security' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg md:col-span-2">
                          <div>
                            <div className="text-white font-bold text-sm">Require PIN for refunds</div>
                            <div className="text-xs text-text-muted mt-1">Add an extra confirmation step for refunds.</div>
                          </div>
                          <Toggle
                            checked={s.security.requirePinForRefunds}
                            onChange={(v) => setDraft({ ...s, security: { ...s.security, requirePinForRefunds: v } })}
                          />
                        </div>

                        <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg md:col-span-2">
                          <div>
                            <div className="text-white font-bold text-sm">Require PIN for discounts</div>
                            <div className="text-xs text-text-muted mt-1">Prevent unauthorized discounts.</div>
                          </div>
                          <Toggle
                            checked={s.security.requirePinForDiscounts}
                            onChange={(v) => setDraft({ ...s, security: { ...s.security, requirePinForDiscounts: v } })}
                          />
                        </div>

                        <Field label="Session Timeout (minutes)" hint="After this period of inactivity, staff must log in again.">
                          <Input
                            type="number"
                            value={String(s.security.sessionTimeoutMins)}
                            onChange={(e) => setDraft({ ...s, security: { ...s.security, sessionTimeoutMins: Number(e.target.value) } })}
                          />
                        </Field>
                      </div>
                    ) : null}

                    {s && activeTab === 'policies' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Field label="PIN Min Length">
                          <Input
                            type="number"
                            value={String(s.policies?.pinMinLength ?? 4)}
                            onChange={(e) => setDraft({ ...s, policies: { ...(s.policies as any), pinMinLength: Number(e.target.value) } })}
                          />
                        </Field>
                        <Field label="PIN Max Length">
                          <Input
                            type="number"
                            value={String(s.policies?.pinMaxLength ?? 8)}
                            onChange={(e) => setDraft({ ...s, policies: { ...(s.policies as any), pinMaxLength: Number(e.target.value) } })}
                          />
                        </Field>
                        <Field label="Max Discount Without Approval (%)" hint="Discounts above this require manager approval.">
                          <Input
                            type="number"
                            value={String(s.policies?.maxDiscountPctWithoutApproval ?? 10)}
                            onChange={(e) =>
                              setDraft({ ...s, policies: { ...(s.policies as any), maxDiscountPctWithoutApproval: Number(e.target.value) } })
                            }
                          />
                        </Field>

                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                            <div>
                              <div className="text-white font-bold text-sm">Refunds Require Manager</div>
                              <div className="text-xs text-text-muted mt-1">Require elevated role to refund payments.</div>
                            </div>
                            <Toggle
                              checked={!!s.policies?.refundsRequireManager}
                              onChange={(v) => setDraft({ ...s, policies: { ...(s.policies as any), refundsRequireManager: v } })}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg">
                            <div>
                              <div className="text-white font-bold text-sm">Voids Require Manager</div>
                              <div className="text-xs text-text-muted mt-1">Require elevated role to void orders.</div>
                            </div>
                            <Toggle
                              checked={!!s.policies?.voidsRequireManager}
                              onChange={(v) => setDraft({ ...s, policies: { ...(s.policies as any), voidsRequireManager: v } })}
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {s && activeTab === 'notifications' ? (
                      <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 border border-border rounded-lg flex items-center justify-between gap-4">
                            <div>
                              <div className="text-white font-bold text-sm">In-app Notifications</div>
                              <div className="text-xs text-text-muted mt-1">Show alerts inside the app.</div>
                            </div>
                            <Toggle
                              checked={!!s.notifications?.channels.inApp}
                              onChange={(v) =>
                                setDraft({
                                  ...s,
                                  notifications: {
                                    ...(s.notifications as any),
                                    channels: { ...(s.notifications?.channels as any), inApp: v },
                                  },
                                })
                              }
                            />
                          </div>
                          <div className="p-4 border border-border rounded-lg flex items-center justify-between gap-4">
                            <div>
                              <div className="text-white font-bold text-sm">Email Notifications</div>
                              <div className="text-xs text-text-muted mt-1">Send important alerts by email.</div>
                            </div>
                            <Toggle
                              checked={!!s.notifications?.channels.email}
                              onChange={(v) =>
                                setDraft({
                                  ...s,
                                  notifications: {
                                    ...(s.notifications as any),
                                    channels: { ...(s.notifications?.channels as any), email: v },
                                  },
                                })
                              }
                            />
                          </div>
                          <div className="p-4 border border-border rounded-lg flex items-center justify-between gap-4">
                            <div>
                              <div className="text-white font-bold text-sm">SMS Notifications</div>
                              <div className="text-xs text-text-muted mt-1">Send alerts via SMS (if configured).</div>
                            </div>
                            <Toggle
                              checked={!!s.notifications?.channels.sms}
                              onChange={(v) =>
                                setDraft({
                                  ...s,
                                  notifications: {
                                    ...(s.notifications as any),
                                    channels: { ...(s.notifications?.channels as any), sms: v },
                                  },
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {[
                            { key: 'lowStockAlerts', title: 'Low Stock Alerts', desc: 'Notify when inventory falls below threshold.' },
                            { key: 'paymentFailures', title: 'Payment Failures', desc: 'Notify when payment processing fails.' },
                            { key: 'dailySummary', title: 'Daily Summary', desc: 'Send daily summary report.' },
                            { key: 'staffLoginAlerts', title: 'Staff Login Alerts', desc: 'Notify when staff signs in.' },
                          ].map((r) => (
                            <div key={r.key} className="p-4 border border-border rounded-lg flex items-center justify-between gap-4">
                              <div>
                                <div className="text-white font-bold text-sm">{r.title}</div>
                                <div className="text-xs text-text-muted mt-1">{r.desc}</div>
                              </div>
                              <Toggle
                                checked={!!(s.notifications?.rules as any)?.[r.key]}
                                onChange={(v) =>
                                  setDraft({
                                    ...s,
                                    notifications: {
                                      ...(s.notifications as any),
                                      rules: { ...(s.notifications?.rules as any), [r.key]: v },
                                    },
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>

                        <Field label="Email Recipients" hint="Comma-separated list. Used when Email Notifications are enabled.">
                          <TextArea
                            value={((s.notifications?.emails && Array.isArray(s.notifications.emails.recipients) ? s.notifications.emails.recipients : []) || []).join(', ')}
                            onChange={(e) => {
                              const arr = e.target.value
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean)
                                .slice(0, 10);
                              setDraft({
                                ...s,
                                notifications: {
                                  ...(s.notifications as any),
                                  emails: { ...((s.notifications as any)?.emails || {}), recipients: arr },
                                },
                              });
                            }}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={fetchSettings}
                  disabled={loading || saving}
                  className={cx(
                    'px-4 h-10 rounded-lg border text-sm font-bold transition-colors',
                    loading || saving
                      ? 'border-border text-text-muted opacity-60 cursor-not-allowed'
                      : 'border-border text-text-muted hover:text-white hover:bg-surface',
                  )}
                >
                  Refresh
                </button>
                <div className="text-xs text-text-muted">{saved?.updatedAt ? `Last saved: ${new Date(saved.updatedAt).toLocaleString()}` : ''}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
