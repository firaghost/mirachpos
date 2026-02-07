import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';
import { Modal } from '../../components/Modal';

import { AppIcon } from '@/components/ui/app-icon';
type GatewayConfig = {
  enabled: boolean;
  enabledForPos?: boolean;
  publicKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  encryptionKey?: string;
  appId?: string;
  appKey?: string;
  shortCode?: string;
  merchantId?: string;
  merchantAppId?: string;
  apiKey?: string;
  baseUrl?: string;
  fabricAppId?: string;
  appSecret?: string;
  merchantCode?: string;
  privateKey?: string;
};

type PaymentConfigState = {
  bankDetails: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    instructions: string;
    manualEnabled: boolean;
    requireImageUpload: boolean;
    autoGrantGracePeriod: boolean;

    billingRules?: {
      autoRenewDefault?: boolean;
      prorationOnUpgrade?: boolean;
      billingCycleAnchor?: 'signup_date' | 'first_of_month';
      currencyDefault?: 'ETB';
      autoSuspensionTrigger?: boolean;
      offlineAccounts?: Array<{
        id: string;
        bankName: string;
        accountNumber: string;
        accountHolder: string;
        active: boolean;
      }>;
    };

    taxation?: {
      globalVatRatePct?: number;
      rules?: Array<{
        code: string;
        name: string;
        ratePct: number;
        logic: 'exclusive' | 'inclusive';
        status: 'active' | 'suspended' | 'archived';
        effectiveDate: string;
        applicabilityCategories?: string[];
      }>;
    };
  };
  chapa: GatewayConfig;
  telebirr: GatewayConfig;
  cbeBirr: GatewayConfig;
  sms: { enabled: boolean; provider: string; apiKey: string; senderId: string };
  settings: {
    environment: 'production' | 'sandbox';
    gracePeriodDays: number;
    reportRetentionDays: number;
    vatEnabled: boolean;
    starterPriceEtb: number;
    growthPriceEtb: number;
  };
};

const defaultState: PaymentConfigState = {
  bankDetails: {
    bankName: '',
    accountNumber: '',
    accountName: '',
    instructions: '',
    manualEnabled: true,
    requireImageUpload: true,
    autoGrantGracePeriod: true,

    billingRules: {
      autoRenewDefault: true,
      prorationOnUpgrade: true,
      billingCycleAnchor: 'signup_date',
      currencyDefault: 'ETB',
      autoSuspensionTrigger: true,
      offlineAccounts: [],
    },

    taxation: {},
  },
  chapa: { enabled: false, enabledForPos: false, publicKey: '', secretKey: '', webhookSecret: '', encryptionKey: '' },
  telebirr: { enabled: false, enabledForPos: false, appId: '', appKey: '', shortCode: '', baseUrl: '', fabricAppId: '', appSecret: '', merchantAppId: '', merchantCode: '', privateKey: '' },
  cbeBirr: { enabled: false, merchantId: '', apiKey: '' },
  sms: { enabled: false, provider: 'africas_talking', apiKey: '', senderId: '' },
  settings: { environment: 'production', gracePeriodDays: 3, reportRetentionDays: 365, vatEnabled: true, starterPriceEtb: 500, growthPriceEtb: 1500 },
};

const deepEqual = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const maskish = (s: string) => {
  const v = String(s || '');
  if (!v) return '-';
  if (v.includes('******')) return v;
  if (v.length <= 8) return v;
  return `${v.slice(0, 6)}...${v.slice(-2)}`;
};

const Toggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label?: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => {
  return (
    <div className="flex items-center gap-2">
      {label ? <span className="text-xs font-bold text-foreground">{label}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${checked ? 'bg-primary/60 border-primary' : 'bg-muted border-border'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'} ${checked ? 'border-4 border-primary' : 'border-4 border-border'
            }`}
        />
      </button>
    </div>
  );
};

type PaymentTab = 'gateways' | 'pricing' | 'rules' | 'vat' | 'invoices';

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: string; title: string }> = ({ active, onClick, icon, title }) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-colors ${active
        ? 'bg-card border-primary text-foreground'
        : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }`}
      type="button"
    >
      <AppIcon name={icon} className={`text-[20px] ${active ? 'text-primary' : ''}`} size={20} />
      <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{title}</span>
    </button>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
};

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`h-10 px-3 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 ${props.className || ''}`}
  />
);

const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={`min-h-[96px] px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 ${props.className || ''}`}
  />
);

export const PaymentConfig: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<PaymentConfigState>(defaultState);
  const [saved, setSaved] = useState<PaymentConfigState>(defaultState);

  const [activeTab, setActiveTab] = useState<PaymentTab>('gateways');

  const [configureOpen, setConfigureOpen] = useState<null | 'telebirr' | 'chapa' | 'cbeBirr'>(null);
  const [configureDraft, setConfigureDraft] = useState<any | null>(null);

  const [pricingMonthlyEnabled, setPricingMonthlyEnabled] = useState(true);
  const [pricingYearlyEnabled, setPricingYearlyEnabled] = useState(true);
  const [pricingSettingsLoading, setPricingSettingsLoading] = useState(false);
  const [pricingSettingsError, setPricingSettingsError] = useState<string | null>(null);

  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Array<{ tier: string; modules: string[]; limits: any; pricing: { monthlyEtb: number; yearlyEtb: number } }>>([]);

  const [createTierOpen, setCreateTierOpen] = useState(false);
  const [createTierLoading, setCreateTierLoading] = useState(false);
  const [createTierError, setCreateTierError] = useState<string | null>(null);
  const [createTierDraft, setCreateTierDraft] = useState<{ tier: string; monthlyEtb: string; yearlyEtb: string; modulesCsv: string; branchLimit: string; staffLimit: string }>(
    { tier: '', monthlyEtb: '', yearlyEtb: '', modulesCsv: '', branchLimit: '', staffLimit: '' }
  );

  const [editTierOpen, setEditTierOpen] = useState(false);
  const [editTierLoading, setEditTierLoading] = useState(false);
  const [editTierError, setEditTierError] = useState<string | null>(null);
  const [editTierDraft, setEditTierDraft] = useState<{ tier: string; monthlyEtb: string; yearlyEtb: string; modulesCsv: string; branchLimit: string; staffLimit: string }>(
    { tier: '', monthlyEtb: '', yearlyEtb: '', modulesCsv: '', branchLimit: '', staffLimit: '' }
  );

  const [invoiceTab, setInvoiceTab] = useState<'all' | 'recurring' | 'template'>('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [invoiceTier, setInvoiceTier] = useState('');
  const [invoiceFrom, setInvoiceFrom] = useState('');
  const [invoiceTo, setInvoiceTo] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceLimit, setInvoiceLimit] = useState(10);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceRows, setInvoiceRows] = useState<any[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoiceStats, setInvoiceStats] = useState<{ revenueEtb: number; outstandingCount: number; avgInvoiceEtb: number; monthStart?: string } | null>(null);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<any | null>(null);

  const [manualInvOpen, setManualInvOpen] = useState(false);
  const [manualInvLoading, setManualInvLoading] = useState(false);
  const [manualInvError, setManualInvError] = useState<string | null>(null);
  const [manualInvDraft, setManualInvDraft] = useState<{ tenantId: string; description: string; amountEtb: string; dueInDays: string; notes: string }>(
    { tenantId: '', description: '', amountEtb: '', dueInDays: '7', notes: '' }
  );

  const [subsLoading, setSubsLoading] = useState(false);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [subsOverview, setSubsOverview] = useState<any | null>(null);
  const [subsRows, setSubsRows] = useState<any[]>([]);

  const [invoiceTplLoading, setInvoiceTplLoading] = useState(false);
  const [invoiceTplError, setInvoiceTplError] = useState<string | null>(null);
  const [invoiceTemplate, setInvoiceTemplate] = useState<{ companyName: string; tin: string; vatRegNo: string; address: string; footerNote: string }>(
    { companyName: '', tin: '', vatRegNo: '', address: '', footerNote: '' }
  );

  const [taxCategories, setTaxCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [taxCatLoading, setTaxCatLoading] = useState(false);
  const [taxCatError, setTaxCatError] = useState<string | null>(null);
  const [taxCatNewName, setTaxCatNewName] = useState('');
  const [taxCatEditId, setTaxCatEditId] = useState<string>('');
  const [taxCatEditName, setTaxCatEditName] = useState<string>('');

  const [taxAuditLoading, setTaxAuditLoading] = useState(false);
  const [taxAuditError, setTaxAuditError] = useState<string | null>(null);
  const [taxAuditEvents, setTaxAuditEvents] = useState<any[]>([]);

  const [billingPolicy, setBillingPolicy] = useState<{
    autoRenewDefault: boolean;
    prorationOnUpgrade: boolean;
    billingCycleAnchor: 'signup_date' | 'first_of_month';
    currencyDefault: 'ETB';
    autoSuspensionTrigger: boolean;
    updatedAt?: string;
  } | null>(null);
  const [offlineAccounts, setOfflineAccounts] = useState<Array<{ id: string; bankName: string; accountNumber: string; accountHolder: string; active: boolean }>>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [dunningSteps, setDunningSteps] = useState<Array<{ id: string; offsetDays: number; title: string; bodyTemplate: string; channel: string; enabled: boolean; sortOrder: number }>>([]);
  const [dunningLoading, setDunningLoading] = useState(false);
  const [dunningError, setDunningError] = useState<string | null>(null);
  const [dunningEditId, setDunningEditId] = useState<string>('');
  const [dunningEditDraft, setDunningEditDraft] = useState<{ offsetDays: string; title: string; bodyTemplate: string; channel: string; enabled: boolean; sortOrder: string }>(
    { offsetDays: '0', title: '', bodyTemplate: '', channel: 'email', enabled: true, sortOrder: '0' }
  );

  const [taxRules, setTaxRules] = useState<Array<{ code: string; name: string; ratePct: number; logic: 'exclusive' | 'inclusive'; status: 'active' | 'suspended' | 'archived'; effectiveDate: string; applicabilityCategories: string[] }>>([]);
  const [taxStatus, setTaxStatus] = useState<{ fiscalPrinterStatus: string | null; fiscalSignatureOk: boolean | null; lastErcaSyncAt: string | null; nextErcaSyncAt: string | null } | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);

  const [addOfflineOpen, setAddOfflineOpen] = useState(false);
  const [addOfflineDraft, setAddOfflineDraft] = useState<{ bankName: string; accountNumber: string; accountHolder: string; active: boolean }>(
    { bankName: '', accountNumber: '', accountHolder: '', active: true }
  );

  const [addTaxOpen, setAddTaxOpen] = useState(false);
  const [addTaxDraft, setAddTaxDraft] = useState<{ code: string; name: string; ratePct: string; logic: 'exclusive' | 'inclusive'; status: 'active' | 'suspended' | 'archived'; effectiveDate: string; categoriesCsv: string }>(
    { code: '', name: '', ratePct: '15', logic: 'exclusive', status: 'active', effectiveDate: new Date().toISOString().slice(0, 10), categoriesCsv: '' }
  );

  const [taxStatusOpen, setTaxStatusOpen] = useState(false);
  const [taxStatusDraft, setTaxStatusDraft] = useState<{ fiscalPrinterStatus: string; fiscalSignatureOk: boolean; lastErcaSyncAt: string; nextErcaSyncAt: string }>(
    { fiscalPrinterStatus: '', fiscalSignatureOk: false, lastErcaSyncAt: '', nextErcaSyncAt: '' }
  );

  const dirty = useMemo(() => !deepEqual(saved, draft), [saved, draft]);

  const loadBilling = async () => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const [pRes, aRes] = await Promise.all([
        apiFetch('/api/superadmin/billing-policy'),
        apiFetch('/api/superadmin/offline-accounts'),
      ]);
      const pJson = (await pRes.json().catch(() => null)) as any;
      const aJson = (await aRes.json().catch(() => null)) as any;
      if (!pRes.ok) throw new Error(pJson?.error || `HTTP ${pRes.status}`);
      if (!aRes.ok) throw new Error(aJson?.error || `HTTP ${aRes.status}`);

      const pol = pJson?.policy || {};
      setBillingPolicy({
        autoRenewDefault: pol.autoRenewDefault !== false,
        prorationOnUpgrade: pol.prorationOnUpgrade !== false,
        billingCycleAnchor: pol.billingCycleAnchor === 'first_of_month' ? 'first_of_month' : 'signup_date',
        currencyDefault: 'ETB',
        autoSuspensionTrigger: pol.autoSuspensionTrigger !== false,
        updatedAt: typeof pol.updatedAt === 'string' ? pol.updatedAt : '',
      });
      setOfflineAccounts(Array.isArray(aJson?.accounts) ? aJson.accounts : []);
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to load billing policy');
    } finally {
      setBillingLoading(false);
    }
  };

  const saveBillingPolicy = async () => {
    if (!billingPolicy) return;
    setBillingLoading(true);
    setBillingError(null);
    try {
      const res = await apiFetch('/api/superadmin/billing-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(billingPolicy),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadBilling();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to save billing policy');
    } finally {
      setBillingLoading(false);
    }
  };

  const createOfflineAccount = async () => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const bankName = addOfflineDraft.bankName.trim();
      const accountNumber = addOfflineDraft.accountNumber.trim();
      const accountHolder = addOfflineDraft.accountHolder.trim();
      if (!bankName) throw new Error('bank_name_required');
      if (!accountNumber) throw new Error('account_number_required');
      if (!accountHolder) throw new Error('account_holder_required');

      const res = await apiFetch('/api/superadmin/offline-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankName, accountNumber, accountHolder, active: !!addOfflineDraft.active }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setAddOfflineOpen(false);
      setAddOfflineDraft({ bankName: '', accountNumber: '', accountHolder: '', active: true });
      await loadBilling();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setBillingLoading(false);
    }
  };

  const createTaxRule = async () => {
    setTaxLoading(true);
    setTaxError(null);
    try {
      const code = addTaxDraft.code.trim();
      const name = addTaxDraft.name.trim();
      const ratePct = Number(addTaxDraft.ratePct || 0);
      const effectiveDate = addTaxDraft.effectiveDate;
      const categories = addTaxDraft.categoriesCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!code) throw new Error('code_required');
      if (!name) throw new Error('name_required');
      if (!Number.isFinite(ratePct)) throw new Error('rate_invalid');
      if (!effectiveDate) throw new Error('effective_date_required');

      const res = await apiFetch('/api/superadmin/tax-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          ratePct,
          logic: addTaxDraft.logic,
          status: addTaxDraft.status,
          effectiveDate,
          applicabilityCategories: categories,
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setAddTaxOpen(false);
      setAddTaxDraft({ code: '', name: '', ratePct: '15', logic: 'exclusive', status: 'active', effectiveDate: new Date().toISOString().slice(0, 10), categoriesCsv: '' });
      await loadTax();
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : 'Failed to create tax rule');
    } finally {
      setTaxLoading(false);
    }
  };

  const saveTaxSystemStatus = async () => {
    setTaxLoading(true);
    setTaxError(null);
    try {
      const res = await apiFetch('/api/superadmin/tax-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fiscalPrinterStatus: taxStatusDraft.fiscalPrinterStatus.trim(),
          fiscalSignatureOk: !!taxStatusDraft.fiscalSignatureOk,
          lastErcaSyncAt: taxStatusDraft.lastErcaSyncAt ? new Date(taxStatusDraft.lastErcaSyncAt).toISOString() : '',
          nextErcaSyncAt: taxStatusDraft.nextErcaSyncAt ? new Date(taxStatusDraft.nextErcaSyncAt).toISOString() : '',
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTaxStatusOpen(false);
      await loadTax();
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : 'Failed to update tax status');
    } finally {
      setTaxLoading(false);
    }
  };

  const updateOfflineAccount = async (id: string, patch: any) => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const res = await apiFetch(`/api/superadmin/offline-accounts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadBilling();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to update account');
    } finally {
      setBillingLoading(false);
    }
  };

  const deleteOfflineAccount = async (id: string) => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const res = await apiFetch(`/api/superadmin/offline-accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadBilling();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to delete account');
    } finally {
      setBillingLoading(false);
    }
  };

  const loadTax = async () => {
    setTaxLoading(true);
    setTaxError(null);
    try {
      const [rRes, sRes] = await Promise.all([
        apiFetch('/api/superadmin/tax-rules'),
        apiFetch('/api/superadmin/tax-status'),
      ]);
      const rJson = (await rRes.json().catch(() => null)) as any;
      const sJson = (await sRes.json().catch(() => null)) as any;
      if (!rRes.ok) throw new Error(rJson?.error || `HTTP ${rRes.status}`);
      if (!sRes.ok) throw new Error(sJson?.error || `HTTP ${sRes.status}`);

      setTaxRules(Array.isArray(rJson?.rules) ? rJson.rules : []);
      setTaxStatus(sJson?.status && typeof sJson.status === 'object' ? sJson.status : null);
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : 'Failed to load tax settings');
    } finally {
      setTaxLoading(false);
    }
  };

  const saveTaxRule = async (code: string, patch: any) => {
    setTaxLoading(true);
    setTaxError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tax-rules/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadTax();
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : 'Failed to save tax rule');
    } finally {
      setTaxLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'rules') void loadBilling();
    if (activeTab === 'vat') void loadTax();
  }, [activeTab]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/superadmin/payment-config');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const cfg = (json?.config && typeof json.config === 'object' ? json.config : {}) as any;

      const merged: PaymentConfigState = {
        ...defaultState,
        ...cfg,
        bankDetails: { ...defaultState.bankDetails, ...(cfg.bankDetails || {}) },
        chapa: { ...defaultState.chapa, ...(cfg.chapa || {}) },
        telebirr: { ...defaultState.telebirr, ...(cfg.telebirr || {}) },
        cbeBirr: { ...defaultState.cbeBirr, ...(cfg.cbeBirr || {}) },
        sms: { ...defaultState.sms, ...(cfg.sms || {}) },
        settings: { ...defaultState.settings, ...(cfg.settings || {}) },
      };

      setSaved(merged);
      setDraft(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (activeTab !== 'invoices') return;
    if (invoiceTab === 'recurring') void loadSubscriptions();
    if (invoiceTab === 'template') void loadInvoiceTemplate();
  }, [activeTab, invoiceTab]);

  useEffect(() => {
    if (activeTab !== 'vat') return;
    if (taxCategories.length === 0) void loadTaxCategories();
    if (taxAuditEvents.length === 0) void loadTaxAudit();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'gateways') return;
    if (plans.length === 0) void loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/superadmin/payment-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(saved);
    setError(null);
  };

  const openConfigure = (kind: 'telebirr' | 'chapa' | 'cbeBirr') => {
    setConfigureOpen(kind);
    setConfigureDraft({ ...(draft as any)[kind] });
  };

  const applyConfigure = () => {
    if (!configureOpen) return;
    setDraft((p) => ({ ...p, [configureOpen]: { ...(p as any)[configureOpen], ...(configureDraft || {}) } } as any));
    setConfigureOpen(null);
    setConfigureDraft(null);
  };

  const loadInvoices = async () => {
    setInvoiceLoading(true);
    setInvoiceError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(invoicePage));
      params.set('limit', String(invoiceLimit));
      if (invoiceStatus) params.set('status', invoiceStatus);
      if (invoiceSearch.trim()) params.set('q', invoiceSearch.trim());
      if (invoiceTier) params.set('tier', invoiceTier);
      if (invoiceFrom) params.set('from', invoiceFrom);
      if (invoiceTo) params.set('to', invoiceTo);

      const res = await apiFetch(`/api/superadmin/invoices?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.invoices) ? json.invoices : [];
      setInvoiceRows(rows);
      setInvoiceTotal(Number(json?.total || 0));
      setInvoiceStats(json?.stats && typeof json.stats === 'object' ? json.stats : null);
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : 'Failed to load invoices');
      setInvoiceRows([]);
      setInvoiceTotal(0);
    } finally {
      setInvoiceLoading(false);
    }
  };

  const loadSubscriptions = async () => {
    setSubsLoading(true);
    setSubsError(null);
    try {
      const res = await apiFetch('/api/superadmin/billing');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSubsOverview(json?.overview || null);
      setSubsRows(Array.isArray(json?.subscriptions) ? json.subscriptions : []);
    } catch (e) {
      setSubsError(e instanceof Error ? e.message : 'Failed to load subscriptions');
    } finally {
      setSubsLoading(false);
    }
  };

  const loadInvoiceTemplate = async () => {
    setInvoiceTplLoading(true);
    setInvoiceTplError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const t = json?.settings?.invoiceTemplate || {};
      setInvoiceTemplate({
        companyName: typeof t.companyName === 'string' ? t.companyName : '',
        tin: typeof t.tin === 'string' ? t.tin : '',
        vatRegNo: typeof t.vatRegNo === 'string' ? t.vatRegNo : '',
        address: typeof t.address === 'string' ? t.address : '',
        footerNote: typeof t.footerNote === 'string' ? t.footerNote : '',
      });
    } catch (e) {
      setInvoiceTplError(e instanceof Error ? e.message : 'Failed to load invoice template');
    } finally {
      setInvoiceTplLoading(false);
    }
  };

  const saveInvoiceTemplate = async () => {
    setInvoiceTplLoading(true);
    setInvoiceTplError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceTemplate }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadInvoiceTemplate();
    } catch (e) {
      setInvoiceTplError(e instanceof Error ? e.message : 'Failed to save invoice template');
    } finally {
      setInvoiceTplLoading(false);
    }
  };

  const loadPricingSettings = async () => {
    setPricingSettingsLoading(true);
    setPricingSettingsError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const p = json?.settings?.pricing || {};
      setPricingMonthlyEnabled(p?.monthlyEnabled !== false);
      setPricingYearlyEnabled(p?.yearlyEnabled !== false);
    } catch (e) {
      setPricingSettingsError(e instanceof Error ? e.message : 'Failed to load pricing settings');
    } finally {
      setPricingSettingsLoading(false);
    }
  };

  const savePricingSettings = async () => {
    setPricingSettingsLoading(true);
    setPricingSettingsError(null);
    try {
      const res = await apiFetch('/api/superadmin/platform-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing: { monthlyEnabled: pricingMonthlyEnabled, yearlyEnabled: pricingYearlyEnabled } }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadPricingSettings();
    } catch (e) {
      setPricingSettingsError(e instanceof Error ? e.message : 'Failed to save pricing settings');
    } finally {
      setPricingSettingsLoading(false);
    }
  };

  const loadPlans = async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const res = await apiFetch('/api/superadmin/plans');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPlans(Array.isArray(json?.plans) ? json.plans : []);
    } catch (e) {
      setPlans([]);
      setPlansError(e instanceof Error ? e.message : 'Failed to load plans');
    } finally {
      setPlansLoading(false);
    }
  };

  const updatePlanPricing = async (tier: string, patch: { monthlyEtb?: number; yearlyEtb?: number }) => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const res = await apiFetch(`/api/superadmin/plans/${encodeURIComponent(tier)}` as any, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing: patch }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadPlans();
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Failed to update plan');
    } finally {
      setPlansLoading(false);
    }
  };

  const updatePlanTier = async () => {
    setEditTierLoading(true);
    setEditTierError(null);
    try {
      const tier = editTierDraft.tier.trim();
      if (!tier) throw new Error('tier_required');

      const monthlyEtb = Number(String(editTierDraft.monthlyEtb || '0').replace(/,/g, ''));
      const yearlyEtb = Number(String(editTierDraft.yearlyEtb || '0').replace(/,/g, ''));
      const branchLimit = Number(String(editTierDraft.branchLimit || '0').replace(/,/g, ''));
      const staffLimit = Number(String(editTierDraft.staffLimit || '0').replace(/,/g, ''));
      const modules = String(editTierDraft.modulesCsv || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!Number.isFinite(monthlyEtb) || monthlyEtb < 0) throw new Error('invalid_monthly_price');
      if (!Number.isFinite(yearlyEtb) || yearlyEtb < 0) throw new Error('invalid_yearly_price');
      if (!Number.isFinite(branchLimit) || branchLimit < 0) throw new Error('invalid_branch_limit');
      if (!Number.isFinite(staffLimit) || staffLimit < 0) throw new Error('invalid_staff_limit');

      const res = await apiFetch(`/api/superadmin/plans/${encodeURIComponent(tier)}` as any, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modules,
          limits: { branchLimit, staffLimit },
          pricing: { monthlyEtb, yearlyEtb },
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadPlans();
      setEditTierOpen(false);
    } catch (e) {
      setEditTierError(e instanceof Error ? e.message : 'Failed to update tier');
    } finally {
      setEditTierLoading(false);
    }
  };

  const createPlanTier = async () => {
    setCreateTierLoading(true);
    setCreateTierError(null);
    try {
      const tier = createTierDraft.tier.trim();
      const monthlyEtb = Number(String(createTierDraft.monthlyEtb || '0').replace(/,/g, ''));
      const yearlyEtb = Number(String(createTierDraft.yearlyEtb || '0').replace(/,/g, ''));
      const branchLimit = Number(String(createTierDraft.branchLimit || '0').replace(/,/g, ''));
      const staffLimit = Number(String(createTierDraft.staffLimit || '0').replace(/,/g, ''));
      const modules = createTierDraft.modulesCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!tier) throw new Error('tier_required');
      if (!Number.isFinite(monthlyEtb) || monthlyEtb < 0) throw new Error('invalid_monthly_price');
      if (!Number.isFinite(yearlyEtb) || yearlyEtb < 0) throw new Error('invalid_yearly_price');
      if (!Number.isFinite(branchLimit) || branchLimit < 0) throw new Error('invalid_branch_limit');
      if (!Number.isFinite(staffLimit) || staffLimit < 0) throw new Error('invalid_staff_limit');

      const res = await apiFetch('/api/superadmin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          modules,
          limits: { branchLimit, staffLimit },
          pricing: { monthlyEtb, yearlyEtb },
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setCreateTierOpen(false);
      setCreateTierDraft({ tier: '', monthlyEtb: '', yearlyEtb: '', modulesCsv: '', branchLimit: '', staffLimit: '' });
      await loadPlans();
    } catch (e) {
      setCreateTierError(e instanceof Error ? e.message : 'Failed to create tier');
    } finally {
      setCreateTierLoading(false);
    }
  };

  const loadDunning = async () => {
    setDunningLoading(true);
    setDunningError(null);
    try {
      const res = await apiFetch('/api/superadmin/dunning-steps');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDunningSteps(Array.isArray(json?.steps) ? json.steps : []);
    } catch (e) {
      setDunningSteps([]);
      setDunningError(e instanceof Error ? e.message : 'Failed to load dunning steps');
    } finally {
      setDunningLoading(false);
    }
  };

  const saveDunningStep = async (id: string) => {
    setDunningLoading(true);
    setDunningError(null);
    try {
      const offsetDays = Number(String(dunningEditDraft.offsetDays || '0').replace(/,/g, ''));
      const sortOrder = Number(String(dunningEditDraft.sortOrder || '0').replace(/,/g, ''));
      const title = dunningEditDraft.title.trim();
      const bodyTemplate = dunningEditDraft.bodyTemplate;
      const channel = dunningEditDraft.channel.trim() || 'email';
      const enabled = !!dunningEditDraft.enabled;

      if (!Number.isFinite(offsetDays) || offsetDays < -365 || offsetDays > 365) throw new Error('offset_days_invalid');
      if (!Number.isFinite(sortOrder) || sortOrder < 0) throw new Error('sort_order_invalid');
      if (!title) throw new Error('title_required');

      const res = await apiFetch(`/api/superadmin/dunning-steps/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsetDays, sortOrder, title, bodyTemplate, channel, enabled }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDunningEditId('');
      await loadDunning();
    } catch (e) {
      setDunningError(e instanceof Error ? e.message : 'Failed to update dunning step');
    } finally {
      setDunningLoading(false);
    }
  };

  const addDunningStep = async () => {
    setDunningLoading(true);
    setDunningError(null);
    try {
      const offsetDays = Number(String(dunningEditDraft.offsetDays || '0').replace(/,/g, ''));
      const sortOrder = Number(String(dunningEditDraft.sortOrder || '0').replace(/,/g, ''));
      const title = dunningEditDraft.title.trim();
      const bodyTemplate = dunningEditDraft.bodyTemplate;
      const channel = dunningEditDraft.channel.trim() || 'email';
      const enabled = !!dunningEditDraft.enabled;

      if (!Number.isFinite(offsetDays) || offsetDays < -365 || offsetDays > 365) throw new Error('offset_days_invalid');
      if (!Number.isFinite(sortOrder) || sortOrder < 0) throw new Error('sort_order_invalid');
      if (!title) throw new Error('title_required');

      const res = await apiFetch('/api/superadmin/dunning-steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offsetDays, sortOrder, title, bodyTemplate, channel, enabled }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDunningEditId('');
      setDunningEditDraft({ offsetDays: '0', title: '', bodyTemplate: '', channel: 'email', enabled: true, sortOrder: '0' });
      await loadDunning();
    } catch (e) {
      setDunningError(e instanceof Error ? e.message : 'Failed to create dunning step');
    } finally {
      setDunningLoading(false);
    }
  };

  const deleteDunningStep = async (id: string) => {
    setDunningLoading(true);
    setDunningError(null);
    try {
      const res = await apiFetch(`/api/superadmin/dunning-steps/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadDunning();
    } catch (e) {
      setDunningError(e instanceof Error ? e.message : 'Failed to delete step');
    } finally {
      setDunningLoading(false);
    }
  };

  const loadTaxCategories = async () => {
    setTaxCatLoading(true);
    setTaxCatError(null);
    try {
      const res = await apiFetch('/api/superadmin/tax-categories');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTaxCategories(Array.isArray(json?.categories) ? json.categories.map((c: any) => ({ id: String(c.id), name: String(c.name || '') })) : []);
    } catch (e) {
      setTaxCatError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setTaxCatLoading(false);
    }
  };

  const createTaxCategory = async () => {
    const name = taxCatNewName.trim();
    if (!name) return;
    setTaxCatLoading(true);
    setTaxCatError(null);
    try {
      const res = await apiFetch('/api/superadmin/tax-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTaxCatNewName('');
      await loadTaxCategories();
      await loadTax();
    } catch (e) {
      setTaxCatError(e instanceof Error ? e.message : 'Failed to create category');
    } finally {
      setTaxCatLoading(false);
    }
  };

  const deleteTaxCategory = async (id: string) => {
    setTaxCatLoading(true);
    setTaxCatError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tax-categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await loadTaxCategories();
      await loadTax();
    } catch (e) {
      setTaxCatError(e instanceof Error ? e.message : 'Failed to delete category');
    } finally {
      setTaxCatLoading(false);
    }
  };

  const updateTaxCategory = async (id: string, name: string) => {
    const nextName = String(name || '').trim();
    if (!id || !nextName) return;
    setTaxCatLoading(true);
    setTaxCatError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tax-categories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTaxCatEditId('');
      setTaxCatEditName('');
      await loadTaxCategories();
      await loadTax();
    } catch (e) {
      setTaxCatError(e instanceof Error ? e.message : 'Failed to update category');
    } finally {
      setTaxCatLoading(false);
    }
  };

  const loadTaxAudit = async () => {
    setTaxAuditLoading(true);
    setTaxAuditError(null);
    try {
      const res = await apiFetch('/api/superadmin/audit?q=tax_');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTaxAuditEvents(Array.isArray(json?.events) ? json.events : []);
    } catch (e) {
      setTaxAuditError(e instanceof Error ? e.message : 'Failed to load audit');
    } finally {
      setTaxAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'invoices') return;
    if (invoiceTab !== 'all') return;
    void loadInvoices();
  }, [activeTab, invoiceTab, invoicePage, invoiceLimit, invoiceStatus, invoiceSearch, invoiceTier, invoiceFrom, invoiceTo]);

  useEffect(() => {
    if (activeTab !== 'pricing') return;
    void loadPlans();
    void loadPricingSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'rules') return;
    if (dunningSteps.length === 0) void loadDunning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openInvoiceDetail = async (id: string) => {
    setInvoiceDetailOpen(true);
    setInvoiceDetailLoading(true);
    setInvoiceDetail(null);
    try {
      const res = await apiFetch(`/api/superadmin/invoices/${encodeURIComponent(id)}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setInvoiceDetail(json?.invoice || null);
    } catch (e) {
      setInvoiceDetail({ error: e instanceof Error ? e.message : 'Failed to load invoice' });
    } finally {
      setInvoiceDetailLoading(false);
    }
  };

  const createManualInvoice = async () => {
    setManualInvLoading(true);
    setManualInvError(null);
    try {
      const tenantId = manualInvDraft.tenantId.trim();
      const description = manualInvDraft.description.trim();
      const amountEtb = Number(String(manualInvDraft.amountEtb || '').replace(/,/g, ''));
      const dueInDays = Number(String(manualInvDraft.dueInDays || '7'));
      const notes = manualInvDraft.notes.trim();

      if (!tenantId) throw new Error('tenant_required');
      if (!description) throw new Error('description_required');
      if (!Number.isFinite(amountEtb) || amountEtb <= 0) throw new Error('amount_invalid');
      if (!Number.isFinite(dueInDays) || dueInDays < 0 || dueInDays > 365) throw new Error('due_days_invalid');

      const res = await apiFetch('/api/superadmin/invoices/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, description, amountEtb, dueInDays, notes: notes || null }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setManualInvOpen(false);
      setManualInvDraft({ tenantId: '', description: '', amountEtb: '', dueInDays: '7', notes: '' });
      if (activeTab === 'invoices' && invoiceTab === 'all') await loadInvoices();
    } catch (e) {
      setManualInvError(e instanceof Error ? e.message : 'Failed to create invoice');
    } finally {
      setManualInvLoading(false);
    }
  };

  const envIsProd = draft.settings.environment === 'production';
  const activeCount = Number(Boolean(draft.telebirr.enabled)) + Number(Boolean(draft.chapa.enabled)) + Number(Boolean(draft.cbeBirr.enabled));
  const vatPct = draft.settings.vatEnabled ? 0.15 : 0;
  const starterBaseEtb = Number(plans.find((p) => String(p.tier) === 'Starter')?.pricing?.monthlyEtb || 0);
  const growthBaseEtb = Number(plans.find((p) => String(p.tier) === 'Growth')?.pricing?.monthlyEtb || 0);
  const starterTotal = Math.round(starterBaseEtb * (1 + vatPct));
  const growthTotal = Math.round(growthBaseEtb * (1 + vatPct));

  const InvoicesTab: React.FC = () => {
    const pageRows = invoiceRows;

    const statusPill = (status: string) => {
      const s = String(status || '').toLowerCase();
      if (s === 'paid') return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20';
      if (s === 'overdue') return 'bg-destructive/10 text-destructive border border-destructive/20';
      if (s === 'pending') return 'bg-primary/10 text-primary border border-primary/20';
      if (s === 'failed') return 'bg-orange-500/10 text-orange-600 border border-orange-500/20';
      return 'bg-muted text-muted-foreground border border-border';
    };

    const canPrev = invoicePage > 1;
    const canNext = invoicePage * invoiceLimit < invoiceTotal;
    const downloadInvoicesCsv = async () => {
      const params = new URLSearchParams();
      if (invoiceStatus) params.set('status', invoiceStatus);
      if (invoiceSearch.trim()) params.set('q', invoiceSearch.trim());
      if (invoiceTier) params.set('tier', invoiceTier);
      if (invoiceFrom) params.set('from', invoiceFrom);
      if (invoiceTo) params.set('to', invoiceTo);
      params.set('limit', '20000');

      const url = `/api/superadmin/invoices/export.csv?${params.toString()}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoices.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    const monthLabel = (() => {
      try {
        if (!invoiceStats?.monthStart) return 'This Month';
        return formatDeviceDateTime(invoiceStats.monthStart, { month: 'short' }) || 'This Month';
      } catch {
        return 'This Month';
      }
    })();

    const shownFrom = invoiceTotal === 0 ? 0 : (invoicePage - 1) * invoiceLimit + 1;
    const shownTo = Math.min(invoiceTotal, invoicePage * invoiceLimit);

    return (
      <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-foreground">Invoice Management</h1>
            <p className="text-muted-foreground max-w-2xl">Manage and track billing for cafe subscriptions. Customize invoice templates for Ethiopian tax compliance.</p>
          </div>

          <div className="flex gap-3">
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm font-medium hover:bg-accent transition-colors"
              type="button"
              onClick={() => void downloadInvoicesCsv()}
            >
              <AppIcon name="download" className="text-lg" size={18} />
              Export CSV
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-[0_0_15px_hsl(var(--primary)/0.2)]"
              type="button"
              onClick={() => {
                setManualInvError(null);
                setManualInvDraft({ tenantId: '', description: '', amountEtb: '', dueInDays: '7', notes: '' });
                setManualInvOpen(true);
              }}
            >
              <AppIcon name="add" className="text-lg" size={18} />
              Generate Invoice
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-1 relative overflow-hidden">
            <div className="absolute right-0 top-0 p-4 opacity-10">
              <AppIcon name="payments" className="text-6xl text-primary" size={60} />
            </div>
            <p className="text-muted-foreground text-sm font-medium z-10">Total Revenue ({monthLabel})</p>
            <div className="flex items-baseline gap-2 z-10">
              <span className="text-2xl font-bold text-foreground tracking-tight">ETB {(Number(invoiceStats?.revenueEtb || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-1 relative overflow-hidden">
            <div className="absolute right-0 top-0 p-4 opacity-10">
              <AppIcon name="pending_actions" className="text-6xl text-orange-400" size={60} />
            </div>
            <p className="text-muted-foreground text-sm font-medium z-10">Outstanding Invoices</p>
            <div className="flex items-baseline gap-2 z-10">
              <span className="text-2xl font-bold text-foreground tracking-tight">{Number(invoiceStats?.outstandingCount || 0)}</span>
              <span className="text-muted-foreground text-xs">Waiting payment</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-1 relative overflow-hidden">
            <div className="absolute right-0 top-0 p-4 opacity-10">
              <AppIcon name="analytics" className="text-6xl text-muted-foreground" size={60} />
            </div>
            <p className="text-muted-foreground text-sm font-medium z-10">Avg Invoice Value</p>
            <div className="flex items-baseline gap-2 z-10">
              <span className="text-2xl font-bold text-foreground tracking-tight">ETB {(Number(invoiceStats?.avgInvoiceEtb || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-border">
          <nav aria-label="Tabs" className="flex gap-8">
            <button
              type="button"
              onClick={() => {
                setInvoiceTab('all');
                setInvoicePage(1);
              }}
              className={`border-b-2 py-4 px-1 text-sm ${invoiceTab === 'all' ? 'font-bold text-primary border-primary' : 'font-medium text-muted-foreground border-transparent hover:border-border hover:text-foreground'} transition-colors`}
            >
              All Invoices
            </button>
            <button
              type="button"
              onClick={() => setInvoiceTab('recurring')}
              className={`border-b-2 py-4 px-1 text-sm ${invoiceTab === 'recurring' ? 'font-bold text-primary border-primary' : 'font-medium text-muted-foreground border-transparent hover:border-border hover:text-foreground'} transition-colors`}
            >
              Recurring Profiles
            </button>
            <button
              type="button"
              onClick={() => setInvoiceTab('template')}
              className={`border-b-2 py-4 px-1 text-sm ${invoiceTab === 'template' ? 'font-bold text-primary border-primary' : 'font-medium text-muted-foreground border-transparent hover:border-border hover:text-foreground'} transition-colors`}
            >
              Template Settings
            </button>
          </nav>
        </div>

        {invoiceTab === 'recurring' ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-xs text-muted-foreground font-bold uppercase">Total Active</div>
                <div className="mt-1 text-2xl font-black text-foreground">{Number(subsOverview?.totalActive || 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-xs text-muted-foreground font-bold uppercase">Verification Needed</div>
                <div className="mt-1 text-2xl font-black text-foreground">{Number(subsOverview?.pendingVerify || 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-xs text-muted-foreground font-bold uppercase">Monthly Revenue (ETB)</div>
                <div className="mt-1 text-2xl font-black text-foreground">{Number(subsOverview?.monthlyRevenueEtb || 0).toLocaleString()}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-xs text-muted-foreground font-bold uppercase">At Risk (24h)</div>
                <div className="mt-1 text-2xl font-black text-foreground">{Number(subsOverview?.atRisk || 0)}</div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="text-foreground font-bold">Subscription Billing Profiles</div>
                <button
                  onClick={() => void loadSubscriptions()}
                  className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
                  type="button"
                >
                  Refresh
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tenant</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cycle</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Bill</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {subsLoading ? (
                      <tr><td className="px-6 py-4 text-sm text-muted-foreground" colSpan={7}>Loading...</td></tr>
                    ) : subsError ? (
                      <tr><td className="px-6 py-4 text-sm text-destructive" colSpan={7}>{subsError}</td></tr>
                    ) : subsRows.length === 0 ? (
                      <tr><td className="px-6 py-4 text-sm text-muted-foreground" colSpan={7}>No subscriptions found.</td></tr>
                    ) : (
                      subsRows.map((r: any) => (
                        <tr key={String(r.tenantId)} className="hover:bg-muted/40 transition-colors">
                          <td className="px-6 py-4 text-sm text-foreground font-medium">{r.tenantName || r.tenantId}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{String(r.plan || '')}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{String(r.cycle || '')}</td>
                          <td className="px-6 py-4 text-sm text-foreground font-bold font-mono">ETB {Number(r.amountEtb || 0).toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{r.nextBillAt ? (formatDeviceDate(r.nextBillAt) || '-') : '-'}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{String(r.status || '')}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{String(r.method || '')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : invoiceTab === 'template' ? (
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-foreground font-bold">Invoice Template Settings</div>
                <div className="mt-1 text-sm text-muted-foreground">Stored in platform settings and used by PDF generator.</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void loadInvoiceTemplate()}
                  className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
                  type="button"
                >
                  Refresh
                </button>
                <button
                  onClick={() => void saveInvoiceTemplate()}
                  disabled={invoiceTplLoading}
                  className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  Save
                </button>
              </div>
            </div>

            {invoiceTplError ? <div className="mt-3 text-sm text-destructive">{invoiceTplError}</div> : null}

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company / Legal Name"><Input value={invoiceTemplate.companyName} onChange={(e) => setInvoiceTemplate((p) => ({ ...p, companyName: e.target.value }))} /></Field>
              <Field label="TIN"><Input value={invoiceTemplate.tin} onChange={(e) => setInvoiceTemplate((p) => ({ ...p, tin: e.target.value }))} /></Field>
              <Field label="VAT Registration No."><Input value={invoiceTemplate.vatRegNo} onChange={(e) => setInvoiceTemplate((p) => ({ ...p, vatRegNo: e.target.value }))} /></Field>
              <Field label="Address"><Input value={invoiceTemplate.address} onChange={(e) => setInvoiceTemplate((p) => ({ ...p, address: e.target.value }))} /></Field>
              <div className="md:col-span-2">
                <Field label="Footer Note"><Textarea value={invoiceTemplate.footerNote} onChange={(e) => setInvoiceTemplate((p) => ({ ...p, footerNote: e.target.value }))} /></Field>
              </div>
              {invoiceTplLoading ? <div className="md:col-span-2 text-sm text-muted-foreground">Saving/Loading...</div> : null}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col lg:flex-row gap-4 bg-card p-4 rounded-xl border border-border">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <AppIcon name="search" className="text-muted-foreground text-lg" size={18} />
                  </div>
                  <Input
                    value={invoiceSearch}
                    onChange={(e) => {
                      setInvoiceSearch(e.target.value);
                      setInvoicePage(1);
                    }}
                    className="pl-10"
                    placeholder="Search by Invoice ID or Cafe..."
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-1">From</label>
                    <Input type="date" value={invoiceFrom} onChange={(e) => { setInvoiceFrom(e.target.value); setInvoicePage(1); }} />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-1">To</label>
                    <Input type="date" value={invoiceTo} onChange={(e) => { setInvoiceTo(e.target.value); setInvoicePage(1); }} />
                  </div>
                </div>

                <div className="relative">
                  <select
                    value={invoiceStatus}
                    onChange={(e) => {
                      setInvoiceStatus(e.target.value);
                      setInvoicePage(1);
                    }}
                    className="block w-full h-10 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 py-2 pl-3 pr-10 appearance-none"
                  >
                    <option value="">All Statuses</option>
                    <option value="paid">Paid</option>
                    <option value="pending">Pending</option>
                    <option value="overdue">Overdue</option>
                    <option value="failed">Failed</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">
                    <AppIcon name="expand_more" className="text-lg" size={18} />
                  </div>
                </div>

                <div className="relative">
                  <select
                    value={invoiceTier}
                    onChange={(e) => {
                      setInvoiceTier(e.target.value);
                      setInvoicePage(1);
                    }}
                    className="block w-full h-10 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 py-2 pl-3 pr-10 appearance-none"
                  >
                    <option value="">All Tiers</option>
                    <option value="Trial">Trial</option>
                    <option value="Starter">Starter</option>
                    <option value="Growth">Growth</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">
                    <AppIcon name="expand_more" className="text-lg" size={18} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12" scope="col">
                        <input className="rounded border-border bg-background text-primary h-4 w-4" type="checkbox" />
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Invoice ID</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Cafe Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Date Issued</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Amount (ETB)</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Status</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider" scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {invoiceLoading ? (
                      <tr>
                        <td className="px-6 py-4 text-sm text-muted-foreground" colSpan={7}>Loading...</td>
                      </tr>
                    ) : invoiceError ? (
                      <tr>
                        <td className="px-6 py-4 text-sm text-destructive" colSpan={7}>{invoiceError}</td>
                      </tr>
                    ) : pageRows.length === 0 ? (
                      <tr>
                        <td className="px-6 py-4 text-sm text-muted-foreground" colSpan={7}>No invoices found.</td>
                      </tr>
                    ) : (
                      pageRows.map((r: any) => (
                        <tr key={r.id} className="group hover:bg-muted/40 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap w-12">
                            <input className="rounded border-border bg-background text-primary h-4 w-4" type="checkbox" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground font-mono">{r.invoiceNumber || r.id}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{r.tenantName || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground font-mono">{r.issueDate ? (formatDeviceDate(r.issueDate) || '-') : '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-bold font-mono">{Number(r.amountEtb || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusPill(r.status)}`}>{String(r.status || 'Unknown')}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => void openInvoiceDetail(String(r.id))}
                              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent/50 transition-colors"
                              type="button"
                            >
                              <AppIcon name="more_vert" className="text-lg" size={18} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-muted/40">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{shownFrom}</span> to <span className="font-medium text-foreground">{shownTo}</span> of <span className="font-medium text-foreground">{invoiceTotal}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canPrev}
                    onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center px-3 py-2 rounded-md border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AppIcon name="chevron_left" className="text-lg" size={18} />
                  </button>
                  <button
                    type="button"
                    disabled={!canNext}
                    onClick={() => setInvoicePage((p) => p + 1)}
                    className="inline-flex items-center px-3 py-2 rounded-md border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AppIcon name="chevron_right" className="text-lg" size={18} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const EditTierModal: React.FC = () => {
    return (
      <Modal
        open={editTierOpen}
        title={editTierDraft.tier ? `Edit Tier: ${editTierDraft.tier}` : 'Edit Tier'}
        onClose={() => {
          if (editTierLoading) return;
          setEditTierOpen(false);
          setEditTierError(null);
        }}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                if (editTierLoading) return;
                setEditTierOpen(false);
                setEditTierError(null);
              }}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
              disabled={editTierLoading}
            >
              Cancel
            </button>
            <button
              onClick={() => void updatePlanTier()}
              disabled={editTierLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {editTierLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {editTierError ? <div className="text-sm text-destructive">{editTierError}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Monthly (ETB)">
              <Input type="number" value={editTierDraft.monthlyEtb} onChange={(e) => setEditTierDraft((p) => ({ ...p, monthlyEtb: e.target.value }))} />
            </Field>
            <Field label="Yearly (ETB)">
              <Input type="number" value={editTierDraft.yearlyEtb} onChange={(e) => setEditTierDraft((p) => ({ ...p, yearlyEtb: e.target.value }))} />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Branch Limit">
              <Input type="number" value={editTierDraft.branchLimit} onChange={(e) => setEditTierDraft((p) => ({ ...p, branchLimit: e.target.value }))} />
            </Field>
            <Field label="Staff Limit">
              <Input type="number" value={editTierDraft.staffLimit} onChange={(e) => setEditTierDraft((p) => ({ ...p, staffLimit: e.target.value }))} />
            </Field>
          </div>

          <Field label="Modules (CSV)" hint="Comma-separated module keys">
            <Input value={editTierDraft.modulesCsv} onChange={(e) => setEditTierDraft((p) => ({ ...p, modulesCsv: e.target.value }))} placeholder="settings, pos, inventory" />
          </Field>
        </div>
      </Modal>
    );
  };

  const TaxationTab: React.FC = () => {
    const rules = taxRules;
    const [activeSubTab, setActiveSubTab] = useState<'rates' | 'exemptions' | 'reporting' | 'audit'>('rates');
    const [selectedCode, setSelectedCode] = useState<string>(() => rules[0]?.code || '');
    const selected = rules.find((r) => r.code === selectedCode) || rules[0] || null;

    const [draftRule, setDraftRule] = useState<typeof selected>(selected);

    useEffect(() => {
      setDraftRule(selected);
    }, [selected?.code]);

    useEffect(() => {
      if (!rules.length) {
        setSelectedCode('');
        return;
      }
      const stillValid = rules.some((r) => r.code === selectedCode);
      if (!stillValid) setSelectedCode(rules[0].code);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rules.length]);

    const updateDraft = (patch: Partial<(typeof rules)[number]>) => {
      setDraftRule((p) => (p ? ({ ...p, ...patch } as any) : p));
    };

    const formatPct = (n: number) => `${(Number(n) || 0).toFixed(2)}%`;
    const formatDate = (iso: string) => {
      try {
        if (!iso) return '-';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return formatDeviceDate(iso, { year: 'numeric', month: 'short', day: '2-digit' }) || iso;
      } catch {
        return iso;
      }
    };

    const [simBase, setSimBase] = useState<string>('1000');
    const base = Number(String(simBase || '0').replace(/,/g, '')) || 0;
    const rate = draftRule ? Number(draftRule.ratePct || 0) : 0;
    const logic = draftRule?.logic || 'exclusive';
    const taxAmount = logic === 'inclusive' ? (base * rate) / (100 + rate) : (base * rate) / 100;
    const total = logic === 'inclusive' ? base : base + taxAmount;

    const globalVat = (() => {
      const vat = rules.find((r) => String(r.code) === 'VAT-STD-15') || rules.find((r) => String(r.code).toLowerCase().includes('vat'));
      return vat ? Number(vat.ratePct || 0) : 0;
    })();

    return (
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">Taxation &amp; Compliance Engine</h1>
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
              <AppIcon name="public" className="text-sm" size={14} />
              <span>Region: Ethiopia (ET)</span>
              <span className="mx-1">•</span>
              <span>Fiscal Year 2023-2024</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 bg-card border border-border hover:bg-accent text-foreground px-4 py-2.5 rounded-lg text-sm font-bold transition-colors"
              type="button"
              onClick={() => {
                setTaxStatusDraft({
                  fiscalPrinterStatus: String(taxStatus?.fiscalPrinterStatus || ''),
                  fiscalSignatureOk: Boolean(taxStatus?.fiscalSignatureOk),
                  lastErcaSyncAt: taxStatus?.lastErcaSyncAt ? new Date(taxStatus.lastErcaSyncAt).toISOString().slice(0, 16) : '',
                  nextErcaSyncAt: taxStatus?.nextErcaSyncAt ? new Date(taxStatus.nextErcaSyncAt).toISOString().slice(0, 16) : '',
                });
                setTaxStatusOpen(true);
              }}
            >
              <AppIcon name="tune" className="text-[20px]" size={20} />
              Edit Status
            </button>
            <button
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-bold shadow-md transition-colors"
              type="button"
              onClick={() => {
                setAddTaxDraft({
                  code: '',
                  name: '',
                  ratePct: '15',
                  logic: 'exclusive',
                  status: 'active',
                  effectiveDate: new Date().toISOString().slice(0, 10),
                  categoriesCsv: '',
                });
                setAddTaxOpen(true);
              }}
            >
              <AppIcon name="add_circle" className="text-[20px]" size={20} />
              Add New Tax Class
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border relative overflow-hidden">
            <div className="absolute right-4 top-4 text-emerald-400 bg-emerald-500/10 p-1 rounded-md">
              <AppIcon name="print_connect" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">Fiscal Printer Status</p>
            <p className="text-foreground text-2xl font-bold tracking-tight">{taxStatus?.fiscalPrinterStatus ? String(taxStatus.fiscalPrinterStatus) : 'N/A'}</p>
            <div className="flex items-center gap-1 mt-2 text-xs text-emerald-400 font-medium">
              <AppIcon name="check_circle" className="text-[14px]" size={14} />
              <span>{taxStatus?.fiscalSignatureOk === true ? 'Signature OK' : 'Signature N/A'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border relative overflow-hidden">
            <div className="absolute right-4 top-4 text-primary bg-primary/10 p-1 rounded-md">
              <AppIcon name="percent" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">Global VAT Rate</p>
            <p className="text-foreground text-2xl font-bold tracking-tight">{Number.isFinite(globalVat) ? `${globalVat.toFixed(1)}%` : '15.0%'}</p>
            <p className="text-muted-foreground text-xs mt-2">Standard Rate (Goods &amp; Services)</p>
          </div>

          <div className="flex flex-col gap-1 rounded-xl p-5 bg-card border border-border relative overflow-hidden">
            <div className="absolute right-4 top-4 text-muted-foreground bg-muted/40 p-1 rounded-md">
              <AppIcon name="sync" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">Last ERCA Sync</p>
            <p className="text-foreground text-2xl font-bold tracking-tight">{taxStatus?.lastErcaSyncAt ? (formatDeviceDateTime(taxStatus.lastErcaSyncAt) || 'N/A') : 'N/A'}</p>
            <p className="text-muted-foreground text-xs mt-2">Next sync: {taxStatus?.nextErcaSyncAt ? (formatDeviceDateTime(taxStatus.nextErcaSyncAt) || 'N/A') : 'N/A'}</p>
          </div>
        </div>

        <div className="border-b border-border">
          <div className="flex gap-8 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveSubTab('rates')}
              className={`flex items-center pb-3 border-b-2 ${activeSubTab === 'rates' ? 'border-primary text-foreground font-bold' : 'border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm tracking-wide transition-colors`}
            >
              Active Rates
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('exemptions')}
              className={`flex items-center pb-3 border-b-2 ${activeSubTab === 'exemptions' ? 'border-primary text-foreground font-bold' : 'border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm tracking-wide transition-colors`}
            >
              Exemptions
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('reporting')}
              className={`flex items-center pb-3 border-b-2 ${activeSubTab === 'reporting' ? 'border-primary text-foreground font-bold' : 'border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm tracking-wide transition-colors`}
            >
              Reporting Config
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('audit')}
              className={`flex items-center pb-3 border-b-2 ${activeSubTab === 'audit' ? 'border-primary text-foreground font-bold' : 'border-transparent text-muted-foreground hover:text-foreground font-medium'} text-sm tracking-wide transition-colors`}
            >
              Audit Logs
            </button>
          </div>
        </div>

        {activeSubTab === 'exemptions' ? (
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-foreground font-bold">Tax Categories</div>
                <div className="mt-1 text-sm text-muted-foreground">Categories used to scope tax rules (exemptions/standard/reduced).</div>
              </div>
              <div className="flex items-center gap-2">
                <Input value={taxCatNewName} onChange={(e) => setTaxCatNewName(e.target.value)} placeholder="New category name" />
                <button
                  onClick={() => void createTaxCategory()}
                  disabled={taxCatLoading}
                  className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  Add
                </button>
              </div>
            </div>

            {taxCatError ? <div className="mt-3 text-sm text-destructive">{taxCatError}</div> : null}

            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {taxCatLoading ? (
                    <tr><td className="px-4 py-3 text-muted-foreground" colSpan={2}>Loading...</td></tr>
                  ) : taxCategories.length === 0 ? (
                    <tr><td className="px-4 py-3 text-muted-foreground" colSpan={2}>No categories yet.</td></tr>
                  ) : (
                    taxCategories.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 text-foreground">
                          {taxCatEditId === c.id ? (
                            <div className="flex items-center gap-2">
                              <Input value={taxCatEditName} onChange={(e) => setTaxCatEditName(e.target.value)} />
                              <button
                                type="button"
                                onClick={() => void updateTaxCategory(c.id, taxCatEditName)}
                                className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTaxCatEditId('');
                                  setTaxCatEditName('');
                                }}
                                className="h-10 px-3 rounded-lg bg-card border border-border text-foreground text-xs font-bold hover:bg-accent transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            c.name
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setTaxCatEditId(c.id);
                                setTaxCatEditName(c.name);
                              }}
                              className="h-10 w-10 rounded-lg bg-card border border-border hover:text-primary transition-colors"
                              type="button"
                              title="Rename"
                            >
                              <AppIcon name="edit" className="text-[18px]" size={18} />
                            </button>
                            <button
                              onClick={() => void deleteTaxCategory(c.id)}
                              className="h-10 w-10 rounded-lg bg-card border border-border hover:text-destructive transition-colors"
                              type="button"
                              title="Delete"
                            >
                              <AppIcon name="delete" className="text-[18px]" size={18} />
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
        ) : activeSubTab === 'reporting' ? (
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-foreground font-bold">Reporting</div>
                <div className="mt-1 text-sm text-muted-foreground">Export current tax rules + category mappings as CSV.</div>
              </div>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = '/api/superadmin/tax-reporting/export.csv';
                  a.download = 'tax-reporting.csv';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
                type="button"
              >
                Export CSV
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <div className="text-xs text-muted-foreground font-bold uppercase">Tax Rules</div>
                <div className="text-2xl text-foreground font-black mt-1">{taxRules.length}</div>
              </div>
              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <div className="text-xs text-muted-foreground font-bold uppercase">Categories</div>
                <div className="text-2xl text-foreground font-black mt-1">{taxCategories.length}</div>
              </div>
              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <div className="text-xs text-muted-foreground font-bold uppercase">VAT Standard</div>
                <div className="text-2xl text-foreground font-black mt-1">{Number.isFinite(globalVat) ? `${globalVat.toFixed(1)}%` : '-'}</div>
              </div>
            </div>
          </div>
        ) : activeSubTab === 'audit' ? (
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-foreground font-bold">Tax Audit</div>
                <div className="mt-1 text-sm text-muted-foreground">Recent tax-related changes from audit log.</div>
              </div>
              <button
                onClick={() => void loadTaxAudit()}
                className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
                type="button"
              >
                Refresh
              </button>
            </div>

            {taxAuditError ? <div className="mt-3 text-sm text-destructive">{taxAuditError}</div> : null}

            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {taxAuditLoading ? (
                    <tr><td className="px-4 py-3 text-muted-foreground" colSpan={3}>Loading...</td></tr>
                  ) : taxAuditEvents.length === 0 ? (
                    <tr><td className="px-4 py-3 text-muted-foreground" colSpan={3}>No events yet.</td></tr>
                  ) : (
                    taxAuditEvents.slice(0, 30).map((e: any) => (
                      <tr key={String(e.id)} className="hover:bg-muted/40">
                        <td className="px-4 py-3 text-muted-foreground font-mono">{e.at ? (formatDeviceDateTime(e.at) || '-') : '-'}</td>
                        <td className="px-4 py-3 text-foreground font-mono">{String(e.type || '')}</td>
                        <td className="px-4 py-3 text-muted-foreground">{String(e.details || '')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-3 min-w-0 bg-card rounded-xl border border-border flex flex-col min-h-[500px]">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <h3 className="font-bold text-foreground text-lg">Defined Tax Rules</h3>
                <button className="text-muted-foreground hover:text-foreground transition-colors" type="button">
                  <AppIcon name="filter_list" />
                </button>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-muted/40 text-muted-foreground text-xs uppercase font-semibold">
                    <tr>
                      <th className="p-4 border-b border-border">Code</th>
                      <th className="p-4 border-b border-border">Name</th>
                      <th className="p-4 border-b border-border text-right">Rate</th>
                      <th className="p-4 border-b border-border">Type</th>
                      <th className="p-4 border-b border-border">Effective Date</th>
                      <th className="p-4 border-b border-border">Status</th>
                      <th className="p-4 border-b border-border w-10" />
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {rules.length === 0 ? (
                      <tr>
                        <td className="p-4 text-muted-foreground" colSpan={7}>
                          No tax rules defined.
                        </td>
                      </tr>
                    ) : (
                      rules.map((r) => {
                        const activeRow = r.code === (selected?.code || '');
                        const statusColor =
                          r.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : r.status === 'suspended'
                              ? 'bg-orange-500/10 text-orange-400'
                              : 'bg-muted text-muted-foreground';
                        return (
                          <tr
                            key={r.code}
                            onClick={() => setSelectedCode(r.code)}
                            className={`group hover:bg-muted/40 transition-colors cursor-pointer border-l-4 ${activeRow ? 'border-l-primary bg-muted/40' : 'border-l-transparent'}`}
                          >
                            <td className={`p-4 border-b border-border font-mono ${activeRow ? 'text-primary' : 'text-muted-foreground'}`}>{r.code}</td>
                            <td className="p-4 border-b border-border font-medium text-foreground">{r.name}</td>
                            <td className="p-4 border-b border-border text-right font-mono text-foreground">{formatPct(r.ratePct)}</td>
                            <td className="p-4 border-b border-border text-muted-foreground">Percentage</td>
                            <td className="p-4 border-b border-border text-muted-foreground">{formatDate(r.effectiveDate)}</td>
                            <td className="p-4 border-b border-border">
                              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${statusColor}`}>{r.status}</span>
                            </td>
                            <td className="p-4 border-b border-border text-right">
                              <AppIcon name="chevron_right" className="text-muted-foreground text-sm" size={14} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-2 w-full min-w-0 flex flex-col gap-6 xl:sticky xl:top-6 self-start">
              <div className="bg-card rounded-xl border border-border flex flex-col">
                <div className="p-4 border-b border-border flex justify-between items-center bg-muted/40">
                  <h3 className="font-bold text-foreground text-lg flex items-center gap-2">
                    <AppIcon name="edit_document" className="text-primary" />
                    Configuration
                  </h3>
                  <div className="text-xs text-muted-foreground font-mono bg-muted/40 px-2 py-1 rounded">{selected?.code || '-'}</div>
                </div>

                <div className="p-6 flex flex-col gap-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Display Name</label>
                      <Input value={draftRule?.name || ''} onChange={(e) => draftRule && updateDraft({ name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Rate (%)</label>
                      <Input type="number" value={draftRule ? String(draftRule.ratePct) : ''} onChange={(e) => draftRule && updateDraft({ ratePct: Number(e.target.value || 0) })} className="font-mono font-bold text-right" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Tax Logic</label>
                      <select
                        value={draftRule?.logic || 'exclusive'}
                        onChange={(e) => draftRule && updateDraft({ logic: e.target.value === 'inclusive' ? 'inclusive' : 'exclusive' })}
                        className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="exclusive">Exclusive</option>
                        <option value="inclusive">Inclusive</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Applicability Categories</label>
                    <div className="p-3 bg-muted/40 border border-border rounded-md flex flex-wrap gap-2 min-h-[80px]">
                      {(draftRule?.applicabilityCategories || []).map((cat) => (
                        <span key={cat} className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded border border-border">
                          <span>{cat}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (!draftRule) return;
                              const next = (draftRule.applicabilityCategories || []).filter((c) => c !== cat);
                              updateDraft({ applicabilityCategories: next });
                            }}
                            className="leading-none"
                          >
                            <AppIcon name="close" className="text-[14px] hover:text-destructive" size={14} />
                          </button>
                        </span>
                      ))}

                      <div className="flex-1 min-w-0">
                        <select
                          value=""
                          onChange={(e) => {
                            const v = String(e.target.value || '').trim();
                            if (!v || !draftRule) return;
                            const next = Array.from(new Set([...(draftRule.applicabilityCategories || []), v]));
                            updateDraft({ applicabilityCategories: next });
                          }}
                          className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="">+ Add category…</option>
                          {taxCategories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Manage categories in the <span className="text-foreground font-bold">Exemptions</span> tab.
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => draftRule && void saveTaxRule(draftRule.code, draftRule)}
                      disabled={taxLoading || !draftRule}
                      className="flex-1 bg-primary text-primary-foreground font-bold py-2.5 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadTax()}
                      disabled={taxLoading}
                      className="sm:w-[140px] px-4 py-2.5 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-xl border border-border p-6">
                <h4 className="text-foreground text-sm font-bold mb-4 flex items-center gap-2">
                  <AppIcon name="calculate" className="text-muted-foreground" />
                  Calculation Simulator
                </h4>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label className="text-[10px] uppercase text-muted-foreground font-bold">Base Price (ETB)</label>
                      <Input className="mt-1 text-right font-mono" value={simBase} onChange={(e) => setSimBase(e.target.value)} />
                    </div>

                    <div className="min-w-0">
                      <label className="text-[10px] uppercase text-muted-foreground font-bold">Tax ({draftRule ? formatPct(draftRule.ratePct) : '0.00%'})</label>
                      <div className="h-10 mt-1 px-3 rounded-lg bg-muted/40 border border-border text-right text-primary text-sm font-mono font-bold flex items-center justify-end">
                        {taxAmount.toFixed(2)}
                      </div>
                    </div>

                    <div className="min-w-0 md:col-span-2">
                      <label className="text-[10px] uppercase text-muted-foreground font-bold">Total</label>
                      <div className="h-10 mt-1 px-3 rounded-lg bg-muted/40 border border-border text-right text-foreground text-sm font-mono font-bold flex items-center justify-end">
                        {total.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground italic text-center mt-2">
                    * Simulation based on {logic === 'inclusive' ? 'Inclusive' : 'Exclusive'} tax calculation logic currently selected.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-xs font-bold text-muted-foreground uppercase">Recent Modifications</h5>
                  <button
                    type="button"
                    onClick={() => void loadTaxAudit()}
                    className="text-xs font-bold text-primary hover:text-foreground transition-colors"
                  >
                    Refresh
                  </button>
                </div>
                {taxAuditError ? <div className="mt-2 text-xs text-destructive">{taxAuditError}</div> : null}
                <ul className="mt-3 space-y-3">
                  {taxAuditLoading ? (
                    <li className="text-xs text-muted-foreground">Loading...</li>
                  ) : taxAuditEvents.length === 0 ? (
                    <li className="text-xs text-muted-foreground">No recent changes.</li>
                  ) : (
                    taxAuditEvents.slice(0, 5).map((e: any) => (
                      <li key={String(e.id)} className="flex gap-3 items-start">
                        <div className="mt-0.5 size-2 rounded-full bg-primary flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs text-foreground font-mono">{String(e.type || '')}</p>
                          <p className="text-[10px] text-muted-foreground">{e.at ? (formatDeviceDateTime(e.at) || '') : ''}{e.details ? ` • ${String(e.details)}` : ''}</p>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const BillingRulesTab: React.FC = () => {
    const br = billingPolicy;
    const offline = offlineAccounts;

    if (!br) {
      return (
        <div className="max-w-[1400px] mx-auto">
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="text-foreground font-bold">Billing Rules</div>
            <div className="mt-2 text-sm text-muted-foreground">Loading...</div>
            {billingError ? <div className="mt-2 text-sm text-destructive">{billingError}</div> : null}
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">Billing Configuration</h1>
            <p className="text-muted-foreground max-w-2xl">
              Define global billing logic, grace periods, and payment workflows. Changes here affect all tenants.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              disabled={billingLoading}
              onClick={() => void loadBilling()}
              className="px-4 py-2 bg-card border border-border text-foreground text-sm font-bold rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Refresh
            </button>
            <button
              disabled={billingLoading}
              onClick={() => void saveBillingPolicy()}
              className="px-6 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              <AppIcon name="save" className="text-[18px]" size={18} />
              {billingLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {billingError ? <div className="text-sm text-destructive">{billingError}</div> : null}

        <div className="border-b border-border overflow-x-auto">
          <div className="flex gap-8 min-w-max">
            <button className="pb-3 border-b-2 border-primary text-foreground font-bold text-sm px-1" type="button">
              General Policy
            </button>
            <button className="pb-3 border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium text-sm px-1 transition-colors" type="button">
              Dunning &amp; Collections
            </button>
            <button className="pb-3 border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium text-sm px-1 transition-colors" type="button">
              Payment Methods
            </button>
            <button className="pb-3 border-b-2 border-transparent text-muted-foreground hover:text-foreground font-medium text-sm px-1 transition-colors" type="button">
              Taxation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <div className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <AppIcon name="autorenew" />
                </div>
                <h3 className="text-foreground text-lg font-bold">Subscription Lifecycle</h3>
              </div>
              <div className="space-y-6">
                <div className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-foreground font-medium text-sm">Auto-Renewal Default</span>
                    <span className="text-muted-foreground text-xs">New tenants default to auto-renew enabled</span>
                  </div>
                  <Toggle checked={br.autoRenewDefault !== false} onChange={(v) => setBillingPolicy((p) => (p ? { ...p, autoRenewDefault: v } : p))} />
                </div>
                <div className="w-full h-px bg-border" />
                <div className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-foreground font-medium text-sm">Proration on Upgrade</span>
                    <span className="text-muted-foreground text-xs">Charge immediate difference when upgrading mid-cycle</span>
                  </div>
                  <Toggle checked={br.prorationOnUpgrade !== false} onChange={(v) => setBillingPolicy((p) => (p ? { ...p, prorationOnUpgrade: v } : p))} />
                </div>
                <div className="w-full h-px bg-border" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-muted-foreground text-xs font-bold uppercase">Billing Cycle Anchor</label>
                    <select
                      value={br.billingCycleAnchor || 'signup_date'}
                      onChange={(e) => setBillingPolicy((p) => (p ? { ...p, billingCycleAnchor: e.target.value === 'first_of_month' ? 'first_of_month' : 'signup_date' } : p))}
                      className="w-full bg-background border border-border rounded-lg text-foreground text-sm focus:ring-1 focus:ring-primary/30"
                    >
                      <option value="signup_date">Signup Date</option>
                      <option value="first_of_month">1st of Month</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-muted-foreground text-xs font-bold uppercase">Currency Default</label>
                    <div className="mt-1 flex items-center">
                      <span className="text-foreground font-bold bg-background px-3 py-2 rounded-lg text-sm border border-border">
                        ETB (Ethiopian Birr)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
                  <AppIcon name="block" />
                </div>
                <h3 className="text-foreground text-lg font-bold">Suspension &amp; Grace Period</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-foreground font-medium text-sm">Grace Period (Days)</label>
                    <p className="text-muted-foreground text-xs mb-2">Days service remains active after due date</p>
                    <div className="flex items-center">
                      <Input
                        className="w-24 rounded-r-none"
                        type="number"
                        value={String(draft.settings.gracePeriodDays)}
                        onChange={(e) => setDraft((p) => ({ ...p, settings: { ...p.settings, gracePeriodDays: Number(e.target.value || 0) } }))}
                      />
                      <div className="bg-background border border-border text-muted-foreground text-sm px-3 py-2 rounded-r-lg border-l-0">Days</div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-foreground font-medium text-sm">Auto-Suspension Trigger</label>
                    <p className="text-muted-foreground text-xs mb-2">Lock account access after grace period ends</p>
                    <div className="flex items-center gap-3">
                      <Toggle checked={br.autoSuspensionTrigger !== false} onChange={(v) => setBillingPolicy((p) => (p ? { ...p, autoSuspensionTrigger: v } : p))} />
                      <span className="text-foreground text-sm">{br.autoSuspensionTrigger === false ? 'Disabled' : 'Enabled'}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 p-4 rounded-lg bg-muted/40 border border-orange-500/20 flex gap-3">
                <AppIcon name="warning" className="text-orange-400 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <p className="text-orange-400 text-sm font-bold">Impact Warning</p>
                  <p className="text-muted-foreground text-xs">Changing the grace period does not affect invoices already past due.</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                    <AppIcon name="payments" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-lg font-bold">Offline Payment Destinations</h3>
                    <p className="text-muted-foreground text-xs">Bank accounts displayed to tenants for manual transfers</p>
                  </div>
                </div>
                <button
                  className="text-primary text-sm font-bold hover:text-foreground flex items-center gap-1"
                  type="button"
                  onClick={() => {
                    setAddOfflineDraft({ bankName: '', accountNumber: '', accountHolder: '', active: true });
                    setAddOfflineOpen(true);
                  }}
                >
                  <AppIcon name="add" className="text-[18px]" size={18} /> Add Account
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm text-muted-foreground">
                  <thead className="bg-muted/40 text-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Bank Name</th>
                      <th className="px-4 py-3 font-medium">Account Number</th>
                      <th className="px-4 py-3 font-medium">Account Holder</th>
                      <th className="px-4 py-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {offline.length === 0 ? (
                      <tr>
                        <td className="px-4 py-3" colSpan={4}>
                          No accounts configured.
                        </td>
                      </tr>
                    ) : (
                      offline.map((a, idx) => (
                        <tr key={a.id} className="hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3">
                            <Input
                              value={a.bankName}
                              onChange={(e) => {
                                const next = offline.slice();
                                next[idx] = { ...a, bankName: e.target.value };
                                setOfflineAccounts(next);
                              }}
                              onBlur={() => void updateOfflineAccount(a.id, { bankName: a.bankName })}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono">
                            <Input
                              value={a.accountNumber}
                              onChange={(e) => {
                                const next = offline.slice();
                                next[idx] = { ...a, accountNumber: e.target.value };
                                setOfflineAccounts(next);
                              }}
                              onBlur={() => void updateOfflineAccount(a.id, { accountNumber: a.accountNumber })}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              value={a.accountHolder}
                              onChange={(e) => {
                                const next = offline.slice();
                                next[idx] = { ...a, accountHolder: e.target.value };
                                setOfflineAccounts(next);
                              }}
                              onBlur={() => void updateOfflineAccount(a.id, { accountHolder: a.accountHolder })}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Toggle
                                checked={!!a.active}
                                onChange={(v) => {
                                  const next = offline.slice();
                                  next[idx] = { ...a, active: v };
                                  setOfflineAccounts(next);
                                  void updateOfflineAccount(a.id, { active: v });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void deleteOfflineAccount(a.id)}
                                className="h-10 w-10 rounded-lg bg-card border border-border hover:text-destructive transition-colors flex items-center justify-center"
                                title="Delete"
                              >
                                <AppIcon name="delete" className="text-[18px]" size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <AppIcon name="info" className="text-[16px]" size={16} />
                <span>Tenants must upload a receipt image after transfer. Verification is manual.</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 xl:col-span-1">
            <div className="bg-card rounded-xl border border-border p-6 h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-purple-500/10 rounded-lg text-purple-300">
                  <AppIcon name="notifications_active" />
                </div>
                <h3 className="text-foreground text-lg font-bold">Dunning Schedule</h3>
              </div>
              <p className="text-muted-foreground text-sm mb-6">Configure automated reminders sent to tenant admins based on invoice due date.</p>
              {dunningError ? <div className="mb-3 text-sm text-destructive">{dunningError}</div> : null}
              <div className="relative pl-4 border-l border-border space-y-6">
                {dunningLoading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : dunningSteps.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No reminder steps configured.</div>
                ) : (
                  dunningSteps.map((s) => {
                    const label = s.offsetDays === 0 ? 'Due Date (T-0)' : s.offsetDays < 0 ? `${Math.abs(s.offsetDays)} Days Before` : `${s.offsetDays} Days Overdue`;
                    const dot = s.offsetDays === 0 ? 'bg-primary' : s.offsetDays < 0 ? 'bg-border' : 'bg-orange-400';
                    const editing = dunningEditId === s.id;
                    return (
                      <div key={s.id} className="relative">
                        <div className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full ${dot} ring-4 ring-background`} />
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className={`text-xs font-bold uppercase ${s.offsetDays === 0 ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setDunningEditId(s.id);
                                  setDunningEditDraft({
                                    offsetDays: String(s.offsetDays),
                                    title: String(s.title || ''),
                                    bodyTemplate: String(s.bodyTemplate || ''),
                                    channel: String(s.channel || 'email'),
                                    enabled: !!s.enabled,
                                    sortOrder: String(s.sortOrder || 0),
                                  });
                                }}
                                title="Edit"
                              >
                                <AppIcon name="edit" className="text-[18px]" size={18} />
                              </button>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => void deleteDunningStep(s.id)}
                                title="Delete"
                              >
                                <AppIcon name="delete" className="text-[18px]" size={18} />
                              </button>
                            </div>
                          </div>

                          <div className="bg-muted/40 p-3 rounded-lg border border-border">
                            {editing ? (
                              <div className="grid grid-cols-1 gap-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <Field label="Offset Days"><Input type="number" value={dunningEditDraft.offsetDays} onChange={(e) => setDunningEditDraft((p) => ({ ...p, offsetDays: e.target.value }))} /></Field>
                                  <Field label="Sort"><Input type="number" value={dunningEditDraft.sortOrder} onChange={(e) => setDunningEditDraft((p) => ({ ...p, sortOrder: e.target.value }))} /></Field>
                                  <Field label="Channel">
                                    <select
                                      value={dunningEditDraft.channel}
                                      onChange={(e) => setDunningEditDraft((p) => ({ ...p, channel: e.target.value }))}
                                      className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    >
                                      <option value="email">Email</option>
                                      <option value="sms">SMS</option>
                                    </select>
                                  </Field>
                                </div>
                                <Field label="Title"><Input value={dunningEditDraft.title} onChange={(e) => setDunningEditDraft((p) => ({ ...p, title: e.target.value }))} /></Field>
                                <Field label="Body Template"><Textarea value={dunningEditDraft.bodyTemplate} onChange={(e) => setDunningEditDraft((p) => ({ ...p, bodyTemplate: e.target.value }))} /></Field>
                                <div className="flex items-center justify-between gap-3">
                                  <Toggle checked={!!dunningEditDraft.enabled} onChange={(v) => setDunningEditDraft((p) => ({ ...p, enabled: v }))} label="Enabled" />
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="h-10 px-3 rounded-lg bg-card border border-border text-foreground text-xs font-bold hover:bg-accent transition-colors"
                                      onClick={() => setDunningEditId('')}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                                      onClick={() => void saveDunningStep(s.id)}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 mb-1">
                                  <AppIcon name="mail" className="text-xs text-foreground" size={12} />
                                  <span className="text-foreground text-sm font-bold">{s.title}</span>
                                  {!s.enabled ? <span className="text-[10px] text-muted-foreground">(disabled)</span> : null}
                                </div>
                                <p className="text-muted-foreground text-xs whitespace-pre-wrap">{String(s.bodyTemplate || '')}</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                <div className="relative pt-2">
                  <button
                    className="w-full py-2 border border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-border hover:bg-accent transition-all text-sm font-medium flex items-center justify-center gap-2"
                    type="button"
                    onClick={() => {
                      setDunningEditId('new');
                      setDunningEditDraft({ offsetDays: '0', title: '', bodyTemplate: '', channel: 'email', enabled: true, sortOrder: String((dunningSteps[dunningSteps.length - 1]?.sortOrder || 0) + 10) });
                    }}
                  >
                    <AppIcon name="add_circle" className="text-[18px]" size={18} />
                    Add Reminder Step
                  </button>
                </div>

                {dunningEditId === 'new' ? (
                  <div className="bg-muted/40 p-3 rounded-lg border border-border">
                    <div className="grid grid-cols-1 gap-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field label="Offset Days"><Input type="number" value={dunningEditDraft.offsetDays} onChange={(e) => setDunningEditDraft((p) => ({ ...p, offsetDays: e.target.value }))} /></Field>
                        <Field label="Sort"><Input type="number" value={dunningEditDraft.sortOrder} onChange={(e) => setDunningEditDraft((p) => ({ ...p, sortOrder: e.target.value }))} /></Field>
                        <Field label="Channel">
                          <select
                            value={dunningEditDraft.channel}
                            onChange={(e) => setDunningEditDraft((p) => ({ ...p, channel: e.target.value }))}
                            className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="Title"><Input value={dunningEditDraft.title} onChange={(e) => setDunningEditDraft((p) => ({ ...p, title: e.target.value }))} /></Field>
                      <Field label="Body Template"><Textarea value={dunningEditDraft.bodyTemplate} onChange={(e) => setDunningEditDraft((p) => ({ ...p, bodyTemplate: e.target.value }))} /></Field>
                      <div className="flex items-center justify-between gap-3">
                        <Toggle checked={!!dunningEditDraft.enabled} onChange={(v) => setDunningEditDraft((p) => ({ ...p, enabled: v }))} label="Enabled" />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="h-10 px-3 rounded-lg bg-card border border-border text-foreground text-xs font-bold hover:bg-accent transition-colors"
                            onClick={() => setDunningEditId('')}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                            onClick={() => void addDunningStep()}
                          >
                            Create
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const PricingTab: React.FC = () => {
    const tiers = useMemo(() => {
      const list = plans.map((p) => String(p.tier || '')).filter(Boolean);
      if (list.length) return list;
      return ['Trial', 'Starter', 'Growth', 'Enterprise'];
    }, [plans]);

    const byTier = useMemo(() => {
      const m = new Map<string, { tier: string; modules: string[]; limits: any; pricing: { monthlyEtb: number; yearlyEtb: number } }>();
      for (const p of plans) m.set(String(p.tier || ''), p);
      return m;
    }, [plans]);

    const discountPct = (monthlyEtb: number, yearlyEtb: number) => {
      const m = Number(monthlyEtb || 0);
      const y = Number(yearlyEtb || 0);
      if (!m || !y) return 0;
      const full = m * 12;
      if (!full) return 0;
      return Math.max(0, Math.round(((full - y) / full) * 100));
    };

    return (
      <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-foreground tracking-tight">Plans &amp; Pricing Models</h1>
          <p className="text-muted-foreground text-base max-w-3xl">
            Manage subscription tiers, feature entitlements, and pricing structures for the Ethiopian market. Prices are denominated in ETB.
          </p>
        </div>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-2 p-6 rounded-xl bg-card border border-border flex flex-col justify-center">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-bold text-foreground">Billing Cycles</h3>
                <p className="text-sm text-muted-foreground">Define which billing periods are available to customers.</p>
              </div>
              <button
                className="text-primary text-xs font-bold uppercase tracking-wider hover:text-foreground transition-colors"
                type="button"
                onClick={() => void savePricingSettings()}
                disabled={pricingSettingsLoading}
              >
                {pricingSettingsLoading ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className="flex gap-6 mt-4 flex-col md:flex-row">
              <div className="flex items-center gap-3 bg-muted/40 px-4 py-3 rounded-lg border border-border flex-1">
                <Toggle checked={pricingMonthlyEnabled} onChange={setPricingMonthlyEnabled} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-foreground">Monthly Billing</span>
                  <span className="text-xs text-muted-foreground">Standard cycle</span>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-muted/40 px-4 py-3 rounded-lg border border-border flex-1">
                <Toggle checked={pricingYearlyEnabled} onChange={setPricingYearlyEnabled} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-foreground">Yearly Billing</span>
                  <span className="text-xs text-muted-foreground">Upfront payment</span>
                </div>
              </div>
            </div>

            {pricingSettingsError ? <div className="mt-3 text-xs text-destructive">{pricingSettingsError}</div> : null}
          </div>

          <div className="col-span-1 p-6 rounded-xl bg-card border border-border flex flex-col justify-center">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-foreground">Yearly Discount</h3>
              <div className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">ACTIVE</div>
            </div>
            <div className="text-sm text-muted-foreground">Discount is derived from each plan’s monthly vs yearly price.</div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {plansLoading ? (
                <div className="text-xs text-muted-foreground">Loading...</div>
              ) : tiers.length === 0 ? (
                <div className="text-xs text-muted-foreground">No plans configured.</div>
              ) : (
                tiers.map((t) => {
                  const p = byTier.get(t);
                  const m = Number(p?.pricing?.monthlyEtb || 0);
                  const y = Number(p?.pricing?.yearlyEtb || 0);
                  const d = discountPct(m, y);
                  return (
                    <div key={t} className="flex items-center justify-between rounded-lg bg-muted/40 border border-border px-3 py-2">
                      <div className="text-xs text-foreground font-bold">{t}</div>
                      <div className="text-xs font-mono text-primary">{d}%</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <AppIcon name="layers" className="text-primary" />
              Subscription Tiers
            </h3>
            <button
              className="flex items-center gap-2 bg-border hover:bg-accent transition-colors text-xs font-bold text-foreground px-3 py-1.5 rounded"
              type="button"
              onClick={() => {
                setCreateTierError(null);
                setCreateTierDraft({ tier: '', monthlyEtb: '', yearlyEtb: '', modulesCsv: '', branchLimit: '', staffLimit: '' });
                setCreateTierOpen(true);
              }}
            >
              <AppIcon name="add" className="text-sm" size={14} />
              Create New Tier
            </button>
          </div>

          {plansError ? <div className="mb-4 text-sm text-destructive">{plansError}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {tiers.map((tier) => {
              const p = byTier.get(tier);
              const monthlyEtb = Number(p?.pricing?.monthlyEtb || 0);
              const yearlyEtb = Number(p?.pricing?.yearlyEtb || 0);
              const disc = discountPct(monthlyEtb, yearlyEtb);
              const lim = p?.limits && typeof p.limits === 'object' ? p.limits : {};
              const branchLimit = Number(lim.branchLimit) || 0;
              const staffLimit = Number(lim.staffLimit) || 0;
              const modulesCsv = Array.isArray(p?.modules) ? p?.modules.join(',') : '';

              return (
                <div key={tier} className="flex flex-col p-5 rounded-xl bg-card border border-border relative group hover:border-accent transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-xl font-bold text-foreground">{tier}</h4>
                      <p className="text-xs text-muted-foreground mt-1">Pricing from database</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="h-8 w-8 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center"
                        title="Edit"
                        onClick={() => {
                          setEditTierError(null);
                          setEditTierDraft({
                            tier,
                            monthlyEtb: String(monthlyEtb),
                            yearlyEtb: String(yearlyEtb),
                            branchLimit: String(branchLimit),
                            staffLimit: String(staffLimit),
                            modulesCsv: String(modulesCsv || ''),
                          });
                          setEditTierOpen(true);
                        }}
                      >
                        <AppIcon name="edit" className="text-[18px]" size={18} />
                      </button>
                      <div className="size-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 mb-6">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Monthly (ETB)</div>
                      <Input
                        type="number"
                        value={String(monthlyEtb)}
                        onChange={(e) => {
                          const v = Number(String(e.target.value || '0').replace(/,/g, ''));
                          setPlans((cur) => cur.map((x) => (String(x.tier) === tier ? { ...x, pricing: { ...x.pricing, monthlyEtb: v } } : x)));
                        }}
                        className="mt-1 text-right font-mono font-bold"
                        onBlur={(e) => void updatePlanPricing(tier, { monthlyEtb: Number(String(e.currentTarget.value || '0').replace(/,/g, '')) })}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Yearly (ETB)</div>
                      <Input
                        type="number"
                        value={String(yearlyEtb)}
                        onChange={(e) => {
                          const v = Number(String(e.target.value || '0').replace(/,/g, ''));
                          setPlans((cur) => cur.map((x) => (String(x.tier) === tier ? { ...x, pricing: { ...x.pricing, yearlyEtb: v } } : x)));
                        }}
                        className="mt-1 text-right font-mono font-bold"
                        onBlur={(e) => void updatePlanPricing(tier, { yearlyEtb: Number(String(e.currentTarget.value || '0').replace(/,/g, '')) })}
                      />
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                    <span>Computed discount</span>
                    <span className="font-mono text-primary font-bold">{disc}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="bg-background text-foreground h-full overflow-hidden flex flex-col">
      <header className="flex-none flex items-center justify-between whitespace-nowrap border-b border-solid border-border px-6 py-3 bg-background z-20">
        <div className="flex items-center gap-4 text-foreground">
          <div className="size-8 flex items-center justify-center bg-primary/10 rounded text-primary">
            <AppIcon name="account_balance_wallet" />
          </div>
          <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight">
            MirachPos <span className="text-muted-foreground font-medium text-lg">/ Admin</span>
          </h2>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-card px-3 py-1.5 rounded-lg border border-border">
            <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Environment</span>
            <Toggle
              checked={envIsProd}
              onChange={(next) => setDraft((p) => ({ ...p, settings: { ...p.settings, environment: next ? 'production' : 'sandbox' } }))}
            />
            <span className="text-primary text-sm font-bold">{envIsProd ? 'Production' : 'Sandbox'}</span>
          </div>

          <div className="h-6 w-px bg-border" />

          <div className="flex gap-3">
            <button
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="flex items-center justify-center rounded-lg h-9 px-4 bg-primary text-primary-foreground text-sm font-bold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              disabled={!dirty || saving}
              onClick={discard}
              className="flex items-center justify-center rounded-lg h-9 px-4 bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Discard
            </button>
          </div>

          <button
            onClick={() => void load()}
            className="h-9 px-3 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
            type="button"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="flex-none border-b border-border bg-background px-6 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton active={activeTab === 'gateways'} onClick={() => setActiveTab('gateways')} icon="account_balance_wallet" title="Gateways" />
            <TabButton active={activeTab === 'pricing'} onClick={() => setActiveTab('pricing')} icon="price_change" title="Plans & Pricing" />
            <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} icon="rule" title="Billing Rules" />
            <TabButton active={activeTab === 'vat'} onClick={() => setActiveTab('vat')} icon="receipt_long" title="Taxation & VAT" />
            <TabButton active={activeTab === 'invoices'} onClick={() => setActiveTab('invoices')} icon="description" title="Invoices" />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">Active Providers: <span className="text-foreground font-bold">{activeCount}</span></div>
            {loading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
            {dirty ? <div className="text-xs text-primary font-bold">Unsaved changes</div> : <div className="text-xs text-muted-foreground font-bold">Saved</div>}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto bg-background p-8 pb-20">
        {activeTab === 'pricing' ? (
          <PricingTab />
        ) : activeTab === 'rules' ? (
          <BillingRulesTab />
        ) : activeTab === 'vat' ? (
          <TaxationTab />
        ) : activeTab === 'invoices' ? (
          <InvoicesTab />
        ) : (
          <div className="max-w-5xl mx-auto flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-black text-foreground tracking-tight">Gateway Integrations</h1>
              <p className="text-muted-foreground text-base max-w-2xl">Configure and manage payment providers for the Ethiopian market.</p>
            </div>
            <>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <AppIcon name="check_circle" className="text-primary" />
                    Providers
                  </h3>
                  <button
                    onClick={() => {
                      try {
                        window.location.hash = '#/superadmin/audit';
                      } catch {
                        // ignore
                      }
                    }}
                    className="text-xs font-bold text-primary hover:text-foreground uppercase tracking-wider flex items-center gap-1"
                    type="button"
                  >
                    <AppIcon name="history" className="text-sm" size={14} />
                    View Audit Logs
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-5 rounded-xl bg-card border border-border hover:border-primary/50 transition-all shadow-lg relative">
                    <div className="flex items-start gap-4">
                      <div className="size-12 rounded-lg bg-white p-2 flex items-center justify-center flex-none">
                        <div className="w-full h-full bg-gradient-to-br from-white-500 to-cyan-400 rounded-md" />
                      </div>
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <h4 className="text-foreground font-bold text-lg">Telebirr Integration</h4>
                          <div className="flex flex-col items-end gap-1">
                            <Toggle
                              checked={draft.telebirr.enabled}
                              onChange={(v) => setDraft((p) => ({ ...p, telebirr: { ...p.telebirr, enabled: v } }))}
                              label="Billing"
                            />
                            <Toggle
                              checked={!!draft.telebirr.enabledForPos}
                              onChange={(v) => setDraft((p) => ({ ...p, telebirr: { ...p.telebirr, enabledForPos: v } }))}
                              label="POS / Waiter"
                            />
                          </div>
                        </div>
                        <p className="text-muted-foreground text-sm mb-4">Native mobile money handling. Supports direct API integration.</p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Short Code</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.telebirr.shortCode || ''))}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">App ID</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.telebirr.appId || ''))}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-auto pt-3 border-t border-border">
                          <button onClick={() => openConfigure('telebirr')} className="flex-1 h-9 rounded-lg bg-border hover:bg-accent text-foreground text-sm font-bold transition-colors" type="button">
                            Configure
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 rounded-xl bg-card border border-border hover:border-primary/50 transition-all shadow-lg relative">
                    <div className="flex items-start gap-4">
                      <div className="size-12 rounded-lg bg-white p-2 flex items-center justify-center flex-none">
                        <div className="w-full h-full bg-green-600 rounded-md relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1/2 h-full bg-green-500 skew-x-12 transform -translate-x-1" />
                        </div>
                      </div>
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <h4 className="text-foreground font-bold text-lg">Chapa</h4>
                          <div className="flex flex-col items-end gap-1">
                            <Toggle
                              checked={draft.chapa.enabled}
                              onChange={(v) => setDraft((p) => ({ ...p, chapa: { ...p.chapa, enabled: v } }))}
                              label="Billing"
                            />
                            <Toggle
                              checked={!!draft.chapa.enabledForPos}
                              onChange={(v) => setDraft((p) => ({ ...p, chapa: { ...p.chapa, enabledForPos: v } }))}
                              label="POS / Waiter"
                            />
                          </div>
                        </div>
                        <p className="text-muted-foreground text-sm mb-4">Payment aggregator for cards and local bank transfers.</p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Public Key</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.chapa.publicKey || ''))}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Webhook Secret</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.chapa.webhookSecret || ''))}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-auto pt-3 border-t border-border">
                          <button onClick={() => openConfigure('chapa')} className="flex-1 h-9 rounded-lg bg-border hover:bg-accent text-foreground text-sm font-bold transition-colors" type="button">
                            Configure
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 rounded-xl bg-card border border-border hover:border-primary/50 transition-all shadow-lg relative md:col-span-2">
                    <div className="flex items-start gap-4">
                      <div className="size-12 rounded-lg bg-white p-2 flex items-center justify-center flex-none opacity-90">
                        <div className="w-full h-full bg-purple-700 rounded-md" />
                      </div>
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h4 className="text-foreground font-bold text-lg">CBE Birr</h4>
                            <p className="text-muted-foreground text-sm">Commercial Bank of Ethiopia Wallet.</p>
                          </div>
                          <Toggle checked={draft.cbeBirr.enabled} onChange={(v) => setDraft((p) => ({ ...p, cbeBirr: { ...p.cbeBirr, enabled: v } }))} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Merchant ID</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.cbeBirr.merchantId || ''))}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">API Key</div>
                            <div className="font-mono text-sm text-foreground bg-muted/40 px-2 py-1 rounded border border-border truncate">{maskish(String(draft.cbeBirr.apiKey || ''))}</div>
                          </div>
                          <div className="flex items-end">
                            <button onClick={() => openConfigure('cbeBirr')} className="w-full h-9 rounded-lg bg-border hover:bg-accent text-foreground text-sm font-bold transition-colors" type="button">
                              Configure
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-xl bg-card border border-border shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <AppIcon name="account_balance" className="text-primary" />
                      Manual Bank Transfer
                    </h3>
                    <Toggle checked={draft.bankDetails.manualEnabled} onChange={(v) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, manualEnabled: v } }))} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Bank Name">
                      <Input value={draft.bankDetails.bankName} onChange={(e) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, bankName: e.target.value } }))} placeholder="CBE" />
                    </Field>
                    <Field label="Account Name">
                      <Input value={draft.bankDetails.accountName} onChange={(e) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, accountName: e.target.value } }))} placeholder="MirachPOS PLC" />
                    </Field>
                    <Field label="Account Number">
                      <Input value={draft.bankDetails.accountNumber} onChange={(e) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, accountNumber: e.target.value } }))} placeholder="1000..." />
                    </Field>
                    <Field label="Grace Period (Days)" hint="Controls how long a tenant can remain active after invoice due date.">
                      <Input
                        type="number"
                        value={String(draft.settings.gracePeriodDays)}
                        onChange={(e) => setDraft((p) => ({ ...p, settings: { ...p.settings, gracePeriodDays: Number(e.target.value || 0) } }))}
                        min={0}
                      />
                    </Field>
                  </div>

                  <div className="mt-4">
                    <Field label="Transfer Instructions">
                      <Textarea value={draft.bankDetails.instructions} onChange={(e) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, instructions: e.target.value } }))} placeholder="Step-by-step instructions shown to tenants." />
                    </Field>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-4 rounded-lg border border-border bg-muted/40">
                      <Toggle
                        checked={draft.bankDetails.requireImageUpload}
                        onChange={(v) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, requireImageUpload: v } }))}
                        label="Require Receipt Image Upload"
                      />
                      <div className="text-xs text-muted-foreground mt-2">If enabled, tenant must upload bank receipt image for verification.</div>
                    </div>
                    <div className="p-4 rounded-lg border border-border bg-muted/40">
                      <Toggle
                        checked={draft.bankDetails.autoGrantGracePeriod}
                        onChange={(v) => setDraft((p) => ({ ...p, bankDetails: { ...p.bankDetails, autoGrantGracePeriod: v } }))}
                        label="Auto Grant Grace Period"
                      />
                      <div className="text-xs text-muted-foreground mt-2">If disabled, access may be restricted immediately when invoice is due.</div>
                    </div>
                  </div>
                </div>

                <div className="p-6 rounded-xl bg-card border border-border shadow-lg">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
                    <AppIcon name="price_change" className="text-primary" />
                    VAT & Pricing Preview
                  </h3>

                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-sm font-bold text-foreground">VAT</div>
                      <div className="text-xs text-muted-foreground">Applied to plan totals (preview only).</div>
                    </div>
                    <Toggle checked={draft.settings.vatEnabled} onChange={(v) => setDraft((p) => ({ ...p, settings: { ...p.settings, vatEnabled: v } }))} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Starter Price (ETB)" hint="Pulled from Plans table">
                      <div className="h-10 px-3 rounded-lg bg-muted/40 border border-border text-foreground flex items-center justify-end font-mono font-bold">
                        {starterBaseEtb.toLocaleString()}
                      </div>
                    </Field>
                    <Field label="Growth Price (ETB)" hint="Pulled from Plans table">
                      <div className="h-10 px-3 rounded-lg bg-muted/40 border border-border text-foreground flex items-center justify-end font-mono font-bold">
                        {growthBaseEtb.toLocaleString()}
                      </div>
                    </Field>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-muted/40 border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Starter Total</div>
                      <div className="text-2xl font-black text-foreground">{starterTotal} ETB</div>
                      <div className="text-xs text-muted-foreground">Base: {starterBaseEtb} ETB {draft.settings.vatEnabled ? '(+15% VAT)' : ''}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/40 border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Growth Total</div>
                      <div className="text-2xl font-black text-foreground">{growthTotal} ETB</div>
                      <div className="text-xs text-muted-foreground">Base: {growthBaseEtb} ETB {draft.settings.vatEnabled ? '(+15% VAT)' : ''}</div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <Field label="Report Retention (Days)">
                      <Input
                        type="number"
                        value={String(draft.settings.reportRetentionDays)}
                        onChange={(e) => setDraft((p) => ({ ...p, settings: { ...p.settings, reportRetentionDays: Number(e.target.value || 0) } }))}
                        min={30}
                      />
                    </Field>
                  </div>
                </div>
              </section>
            </>
          </div>
        )}
      </main>

      <Modal
        open={!!configureOpen}
        title={configureOpen === 'telebirr' ? 'Configure Telebirr' : configureOpen === 'chapa' ? 'Configure Chapa' : 'Configure CBE Birr'}
        onClose={() => {
          setConfigureOpen(null);
          setConfigureDraft(null);
        }}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                setConfigureOpen(null);
                setConfigureDraft(null);
              }}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={applyConfigure}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
              type="button"
            >
              Apply
            </button>
          </div>
        }
      >
        {configureOpen === 'telebirr' ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Fabric App ID">
                <Input value={String(configureDraft?.fabricAppId || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), fabricAppId: e.target.value }))} placeholder="Fabric App ID" />
              </Field>
              <Field label="App Secret">
                <Input value={String(configureDraft?.appSecret || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), appSecret: e.target.value }))} placeholder="App Secret" />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Merchant ID (App ID)">
                <Input value={String(configureDraft?.merchantAppId || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), merchantAppId: e.target.value }))} placeholder="Merchant App ID" />
              </Field>
              <Field label="Merchant Code (Short Code)">
                <Input value={String(configureDraft?.merchantCode || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), merchantCode: e.target.value }))} placeholder="Merchant Code" />
              </Field>
            </div>
            <Field label="Base URL" hint="Telebirr API Base URL">
              <Input value={String(configureDraft?.baseUrl || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), baseUrl: e.target.value }))} placeholder="https://api.ethiotelecom.et" />
            </Field>
            <Field label="Private Key" hint="RSA Private Key for signing requests (Base64 or PEM content without headers)">
              <Textarea
                className="font-mono text-xs h-32"
                value={String(configureDraft?.privateKey || '')}
                onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), privateKey: e.target.value }))}
                placeholder="MIIEvgIBADANBgkqhki..."
              />
            </Field>
          </div>
        ) : null}

        {configureOpen === 'chapa' ? (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Public Key">
              <Input value={String(configureDraft?.publicKey || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), publicKey: e.target.value }))} placeholder="CHAPA_PUBLIC_KEY" />
            </Field>
            <Field label="Secret Key" hint="Saved to server env if provided.">
              <Input value={String(configureDraft?.secretKey || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), secretKey: e.target.value }))} placeholder="******" />
            </Field>
            <Field label="Webhook Secret" hint="Saved to server env if provided.">
              <Input value={String(configureDraft?.webhookSecret || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), webhookSecret: e.target.value }))} placeholder="******" />
            </Field>
            <Field label="Encryption Key" hint="Saved to server env if provided.">
              <Input value={String(configureDraft?.encryptionKey || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), encryptionKey: e.target.value }))} placeholder="******" />
            </Field>
          </div>
        ) : null}

        {configureOpen === 'cbeBirr' ? (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Merchant ID">
              <Input value={String(configureDraft?.merchantId || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), merchantId: e.target.value }))} placeholder="merchant_id" />
            </Field>
            <Field label="API Key" hint="If masked, leave as-is to keep current value.">
              <Input value={String(configureDraft?.apiKey || '')} onChange={(e) => setConfigureDraft((p: any) => ({ ...(p || {}), apiKey: e.target.value }))} placeholder="******" />
            </Field>
          </div>
        ) : null}
      </Modal>

      <EditTierModal />

      <Modal
        open={createTierOpen}
        title="Create New Tier"
        onClose={() => {
          setCreateTierOpen(false);
          setCreateTierError(null);
        }}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                setCreateTierOpen(false);
                setCreateTierError(null);
              }}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void createPlanTier()}
              disabled={createTierLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {createTierLoading ? 'Creating...' : 'Create Tier'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {createTierError ? <div className="text-sm text-red-300">{createTierError}</div> : null}

          <Field label="Tier Name" hint="Examples: Trial, Starter, Growth, Enterprise">
            <Input value={createTierDraft.tier} onChange={(e) => setCreateTierDraft((p) => ({ ...p, tier: e.target.value }))} placeholder="Starter" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Monthly (ETB)">
              <Input type="number" value={createTierDraft.monthlyEtb} onChange={(e) => setCreateTierDraft((p) => ({ ...p, monthlyEtb: e.target.value }))} placeholder="500" />
            </Field>
            <Field label="Yearly (ETB)">
              <Input type="number" value={createTierDraft.yearlyEtb} onChange={(e) => setCreateTierDraft((p) => ({ ...p, yearlyEtb: e.target.value }))} placeholder="5000" />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Branch Limit">
              <Input type="number" value={createTierDraft.branchLimit} onChange={(e) => setCreateTierDraft((p) => ({ ...p, branchLimit: e.target.value }))} placeholder="1" />
            </Field>
            <Field label="Staff Limit">
              <Input type="number" value={createTierDraft.staffLimit} onChange={(e) => setCreateTierDraft((p) => ({ ...p, staffLimit: e.target.value }))} placeholder="25" />
            </Field>
          </div>

          <Field label="Modules (CSV)" hint="Comma-separated module keys">
            <Input value={createTierDraft.modulesCsv} onChange={(e) => setCreateTierDraft((p) => ({ ...p, modulesCsv: e.target.value }))} placeholder="settings, pos, inventory" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={manualInvOpen}
        title="Generate Manual Invoice"
        onClose={() => {
          setManualInvOpen(false);
          setManualInvError(null);
        }}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                setManualInvOpen(false);
                setManualInvError(null);
              }}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void createManualInvoice()}
              disabled={manualInvLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {manualInvLoading ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {manualInvError ? <div className="text-sm text-red-300">{manualInvError}</div> : null}

          <Field label="Tenant ID" hint="Paste the tenant id (t_...)">
            <Input value={manualInvDraft.tenantId} onChange={(e) => setManualInvDraft((p) => ({ ...p, tenantId: e.target.value }))} placeholder="t_..." />
          </Field>

          <Field label="Description">
            <Input value={manualInvDraft.description} onChange={(e) => setManualInvDraft((p) => ({ ...p, description: e.target.value }))} placeholder="One-time charge (Support / Setup / Custom)" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Amount (ETB)">
              <Input type="number" value={manualInvDraft.amountEtb} onChange={(e) => setManualInvDraft((p) => ({ ...p, amountEtb: e.target.value }))} placeholder="1000" />
            </Field>
            <Field label="Due in (days)">
              <Input type="number" value={manualInvDraft.dueInDays} onChange={(e) => setManualInvDraft((p) => ({ ...p, dueInDays: e.target.value }))} placeholder="7" />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <Textarea value={manualInvDraft.notes} onChange={(e) => setManualInvDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="Internal notes for audit" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={invoiceDetailOpen}
        title="Invoice Details"
        onClose={() => {
          setInvoiceDetailOpen(false);
          setInvoiceDetail(null);
        }}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                setInvoiceDetailOpen(false);
                setInvoiceDetail(null);
              }}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Close
            </button>
            <button
              onClick={() => {
                try {
                  const id = String(invoiceDetail?.id || '');
                  if (!id) return;
                  window.open(`/api/superadmin/invoices/${encodeURIComponent(id)}/pdf`, '_blank');
                } catch {
                  // ignore
                }
              }}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Download PDF
            </button>
          </div>
        }
      >
        {invoiceDetailLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : invoiceDetail?.error ? (
          <div className="text-sm text-red-300">{String(invoiceDetail.error)}</div>
        ) : invoiceDetail ? (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Invoice No</div>
                <div className="text-lg font-mono text-foreground font-bold">{String(invoiceDetail.invoiceNumber || invoiceDetail.id)}</div>
                <div className="text-sm text-muted-foreground mt-1">{String(invoiceDetail.tenantName || '')}</div>
              </div>
              <div className="px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-muted/40 text-muted-foreground border border-border">
                {String(invoiceDetail.status || 'Unknown')}
              </div>
            </div>

            <div className="p-4 bg-muted/40 rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Billed To</div>
              <div className="text-foreground font-medium">{String(invoiceDetail.tenantName || '')}</div>
              {invoiceDetail?.tenantTin ? <div className="text-sm text-muted-foreground mt-1">TIN: {String(invoiceDetail.tenantTin)}</div> : null}
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Totals</div>
              <div className="flex justify-between text-sm py-2 border-b border-border">
                <span className="text-foreground">Amount</span>
                <span className="text-foreground font-mono">ETB {Number(invoiceDetail.totalEtb || invoiceDetail.amountEtb || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm py-2">
                <span className="text-foreground">Due Date</span>
                <span className="text-muted-foreground font-mono">{invoiceDetail.dueDate ? (formatDeviceDate(invoiceDetail.dueDate) || '-') : '-'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Select an invoice to view details.</div>
        )}
      </Modal>

      <Modal
        open={addOfflineOpen}
        title="Add Offline Account"
        onClose={() => setAddOfflineOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setAddOfflineOpen(false)}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void createOfflineAccount()}
              disabled={billingLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Add
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <Field label="Bank Name">
            <Input value={addOfflineDraft.bankName} onChange={(e) => setAddOfflineDraft((p) => ({ ...p, bankName: e.target.value }))} />
          </Field>
          <Field label="Account Number">
            <Input value={addOfflineDraft.accountNumber} onChange={(e) => setAddOfflineDraft((p) => ({ ...p, accountNumber: e.target.value }))} />
          </Field>
          <Field label="Account Holder">
            <Input value={addOfflineDraft.accountHolder} onChange={(e) => setAddOfflineDraft((p) => ({ ...p, accountHolder: e.target.value }))} />
          </Field>
          <div className="p-3 rounded-lg bg-muted/40 border border-border">
            <Toggle checked={addOfflineDraft.active} onChange={(v) => setAddOfflineDraft((p) => ({ ...p, active: v }))} label="Active" />
          </div>
          {billingError ? <div className="text-sm text-red-300">{billingError}</div> : null}
        </div>
      </Modal>

      <Modal
        open={addTaxOpen}
        title="Add New Tax Class"
        onClose={() => setAddTaxOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setAddTaxOpen(false)}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void createTaxRule()}
              disabled={taxLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Create
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Code">
            <Input value={addTaxDraft.code} onChange={(e) => setAddTaxDraft((p) => ({ ...p, code: e.target.value }))} placeholder="VAT-STD-15" />
          </Field>
          <Field label="Effective Date">
            <Input type="date" value={addTaxDraft.effectiveDate} onChange={(e) => setAddTaxDraft((p) => ({ ...p, effectiveDate: e.target.value }))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Name">
              <Input value={addTaxDraft.name} onChange={(e) => setAddTaxDraft((p) => ({ ...p, name: e.target.value }))} placeholder="VAT Standard" />
            </Field>
          </div>
          <Field label="Rate (%)">
            <Input type="number" value={addTaxDraft.ratePct} onChange={(e) => setAddTaxDraft((p) => ({ ...p, ratePct: e.target.value }))} className="font-mono font-bold text-right" />
          </Field>
          <Field label="Tax Logic">
            <select
              value={addTaxDraft.logic}
              onChange={(e) => setAddTaxDraft((p) => ({ ...p, logic: e.target.value === 'inclusive' ? 'inclusive' : 'exclusive' }))}
              className="w-full h-10 px-3 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="exclusive">Exclusive</option>
              <option value="inclusive">Inclusive</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={addTaxDraft.status}
              onChange={(e) => setAddTaxDraft((p) => ({ ...p, status: (e.target.value as any) }))}
              className="w-full h-10 px-3 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Applicability Categories (comma separated)">
              <Input value={addTaxDraft.categoriesCsv} onChange={(e) => setAddTaxDraft((p) => ({ ...p, categoriesCsv: e.target.value }))} placeholder="All Goods, Services (Standard)" />
            </Field>
          </div>
          {taxError ? <div className="md:col-span-2 text-sm text-red-300">{taxError}</div> : null}
        </div>
      </Modal>

      <Modal
        open={taxStatusOpen}
        title="Tax System Status"
        onClose={() => setTaxStatusOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setTaxStatusOpen(false)}
              className="h-10 px-4 rounded-lg bg-card border border-border text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveTaxSystemStatus()}
              disabled={taxLoading}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <Field label="Fiscal Printer Status">
            <Input value={taxStatusDraft.fiscalPrinterStatus} onChange={(e) => setTaxStatusDraft((p) => ({ ...p, fiscalPrinterStatus: e.target.value }))} placeholder="Connected (FSC)" />
          </Field>
          <div className="p-3 rounded-lg bg-muted/40 border border-border">
            <Toggle checked={taxStatusDraft.fiscalSignatureOk} onChange={(v) => setTaxStatusDraft((p) => ({ ...p, fiscalSignatureOk: v }))} label="Signature OK" />
          </div>
          <Field label="Last ERCA Sync (datetime)">
            <Input type="datetime-local" value={taxStatusDraft.lastErcaSyncAt} onChange={(e) => setTaxStatusDraft((p) => ({ ...p, lastErcaSyncAt: e.target.value }))} />
          </Field>
          <Field label="Next ERCA Sync (datetime)">
            <Input type="datetime-local" value={taxStatusDraft.nextErcaSyncAt} onChange={(e) => setTaxStatusDraft((p) => ({ ...p, nextErcaSyncAt: e.target.value }))} />
          </Field>
          {taxError ? <div className="text-sm text-red-300">{taxError}</div> : null}
        </div>
      </Modal>
    </div>
  );
};
