import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Modal } from '../../components/Modal';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';
import { readSession, updateSession } from '../../session';
import { Screen } from '../../types';

import { AppIcon } from '@/components/ui/app-icon';
export const SA_TenantDetails: React.FC<{ onBack: () => void; onNavigate?: (screen: Screen) => void }> = ({ onBack, onNavigate }) => {
  const SELECTED_TENANT_KEY = 'mirachpos.sa.selectedTenantId.v1';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingModules, setSavingModules] = useState(false);
  const [tab, setTab] = useState<'branches' | 'users' | 'feature_access' | 'integrations' | 'payments'>('branches');
  const [search, setSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);

  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [posChapaEnabled, setPosChapaEnabled] = useState(false);
  const [posChapaSecretKey, setPosChapaSecretKey] = useState('');
  const [posChapaPublicKey, setPosChapaPublicKey] = useState('');
  const [posChapaWebhookSecret, setPosChapaWebhookSecret] = useState('');
  const [posChapaSecretMasked, setPosChapaSecretMasked] = useState('');
  const [posChapaPublicMasked, setPosChapaPublicMasked] = useState('');
  const [posChapaWebhookMasked, setPosChapaWebhookMasked] = useState('');

  const [posSantimEnabled, setPosSantimEnabled] = useState(false);
  const [posSantimMerchantId, setPosSantimMerchantId] = useState('');
  const [posSantimPrivateKey, setPosSantimPrivateKey] = useState('');
  const [posSantimPublicKey, setPosSantimPublicKey] = useState('');
  const [posSantimMerchantIdMasked, setPosSantimMerchantIdMasked] = useState('');
  const [posSantimPrivateKeyMasked, setPosSantimPrivateKeyMasked] = useState('');
  const [posSantimPublicKeyMasked, setPosSantimPublicKeyMasked] = useState('');
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
      const planRaw = String(t?.plan || 'Pro');
      const plan = (() => {
        const p = planRaw.trim().toLowerCase();
        if (p === 'trial') return 'Trial';
        if (p === 'starter' || p === 'basic') return 'Starter';
        if (p === 'growth') return 'Growth';
        if (p === 'pro' || p === 'enterprise') return 'Pro';
        return planRaw;
      })();

      const base = plan === 'Trial'
        ? ['pos', 'orders', 'tables', 'staff']
        : plan === 'Starter'
          ? ['pos', 'orders', 'tables', 'staff', 'reports']
          : plan === 'Growth'
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

  const resetOwnerPassword = async () => {
    if (!tenant?.id) return;
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch('/api/superadmin/tenants/reset-owner-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const pw = String(json?.tempPassword || '');
      const em = String(json?.ownerEmail || '');
      setToast(`Owner temp password${em ? ` (${em})` : ''}: ${pw}`);
      setTimeout(() => setToast(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset owner password failed');
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

  const loadPayments = async () => {
    if (!selectedTenantId) return;
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}/pos-payment-gateways`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const rows = Array.isArray(json?.gateways) ? json.gateways : [];
      const chapa = rows.find((r: any) => String(r?.gateway || '') === 'chapa') || null;
      const santim = rows.find((r: any) => String(r?.gateway || '') === 'santimpay') || null;
      setPosChapaEnabled(Boolean(chapa?.enabled));
      setPosChapaSecretMasked(String(chapa?.config?.secretKeyMasked || ''));
      setPosChapaPublicMasked(String(chapa?.config?.publicKeyMasked || ''));
      setPosChapaWebhookMasked(String(chapa?.config?.webhookSecretMasked || ''));
      setPosChapaSecretKey('');
      setPosChapaPublicKey('');
      setPosChapaWebhookSecret('');

      setPosSantimEnabled(Boolean(santim?.enabled));
      setPosSantimMerchantIdMasked(String(santim?.config?.merchantIdMasked || ''));
      setPosSantimPrivateKeyMasked(String(santim?.config?.privateKeyMasked || ''));
      setPosSantimPublicKeyMasked(String(santim?.config?.publicKeyMasked || ''));
      setPosSantimMerchantId('');
      setPosSantimPrivateKey('');
      setPosSantimPublicKey('');
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Failed to load payment gateways');
    } finally {
      setPayLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'payments') return;
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedTenantId]);

  const savePayments = async () => {
    if (!selectedTenantId) return;
    if (paySaving) return;

    const hasStoredSecret = Boolean(String(posChapaSecretMasked || '').trim() && String(posChapaSecretMasked || '').trim() !== '—' && String(posChapaSecretMasked || '').trim() !== '-');
    const hasStoredWebhook = Boolean(String(posChapaWebhookMasked || '').trim() && String(posChapaWebhookMasked || '').trim() !== '—' && String(posChapaWebhookMasked || '').trim() !== '-');
    const willHaveSecret = Boolean(posChapaSecretKey.trim() || hasStoredSecret);
    const willHaveWebhook = Boolean(posChapaWebhookSecret.trim() || hasStoredWebhook);
    if (posChapaEnabled && (!willHaveSecret || !willHaveWebhook)) {
      setPayError('To enable Chapa, you must provide both Secret Key and Webhook Secret (or have them already stored).');
      return;
    }

    const hasStoredSantimMerchantId = Boolean(String(posSantimMerchantIdMasked || '').trim() && String(posSantimMerchantIdMasked || '').trim() !== '—' && String(posSantimMerchantIdMasked || '').trim() !== '-');
    const hasStoredSantimPriv = Boolean(String(posSantimPrivateKeyMasked || '').trim() && String(posSantimPrivateKeyMasked || '').trim() !== '—' && String(posSantimPrivateKeyMasked || '').trim() !== '-');
    const hasStoredSantimPub = Boolean(String(posSantimPublicKeyMasked || '').trim() && String(posSantimPublicKeyMasked || '').trim() !== '—' && String(posSantimPublicKeyMasked || '').trim() !== '-');
    const willHaveSantimMerchantId = Boolean(posSantimMerchantId.trim() || hasStoredSantimMerchantId);
    const willHaveSantimPriv = Boolean(posSantimPrivateKey.trim() || hasStoredSantimPriv);
    const willHaveSantimPub = Boolean(posSantimPublicKey.trim() || hasStoredSantimPub);
    if (posSantimEnabled && (!willHaveSantimMerchantId || !willHaveSantimPriv || !willHaveSantimPub)) {
      setPayError('To enable SantimPay, you must provide Merchant ID, Private Key (ES256 PEM), and Public Key (PEM) (or have them already stored).');
      return;
    }

    setPaySaving(true);
    setPayError(null);
    setToast(null);
    try {
      const chapaBody: any = { enabled: Boolean(posChapaEnabled), config: {} };
      if (posChapaSecretKey.trim()) chapaBody.config.secretKey = posChapaSecretKey.trim();
      if (posChapaPublicKey.trim()) chapaBody.config.publicKey = posChapaPublicKey.trim();
      if (posChapaWebhookSecret.trim()) chapaBody.config.webhookSecret = posChapaWebhookSecret.trim();

      const santimBody: any = { enabled: Boolean(posSantimEnabled), config: {} };
      if (posSantimMerchantId.trim()) santimBody.config.merchantId = posSantimMerchantId.trim();
      if (posSantimPrivateKey.trim()) santimBody.config.privateKey = posSantimPrivateKey;
      if (posSantimPublicKey.trim()) santimBody.config.publicKey = posSantimPublicKey;

      const [resChapa, resSantim] = await Promise.all([
        apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}/pos-payment-gateways/chapa`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chapaBody),
        }),
        apiFetch(`/api/superadmin/tenants/${encodeURIComponent(selectedTenantId)}/pos-payment-gateways/santimpay`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(santimBody),
        }),
      ]);

      const jsonChapa = (await resChapa.json().catch(() => null)) as any;
      if (!resChapa.ok) throw new Error(jsonChapa?.error || `HTTP ${resChapa.status}`);
      const jsonSantim = (await resSantim.json().catch(() => null)) as any;
      if (!resSantim.ok) throw new Error(jsonSantim?.error || `HTTP ${resSantim.status}`);

      setToast('Payment gateway settings updated');
      setTimeout(() => setToast(null), 3000);
      await loadPayments();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Failed to update payment gateway settings');
    } finally {
      setPaySaving(false);
    }
  };

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
    return formatDeviceDate(raw, { year: 'numeric', month: 'short', day: 'numeric' }) || raw;
  })();

  const graceLabel = (() => {
    const raw = String(subInfo?.graceEndsAt || '').trim();
    if (!raw) return '';
    return formatDeviceDate(raw, { year: 'numeric', month: 'short', day: 'numeric' }) || raw;
  })();
  const incidents = Array.isArray(tenant?.incidents) ? tenant!.incidents! : [];

  const statusPill = (() => {
    const st = String(tenant?.status || '').toLowerCase();
    if (st === 'active') return { cls: 'bg-green-500/20 text-green-400 border border-green-500/30', label: 'Active' };
    if (st === 'suspended') return { cls: 'bg-red-900/20 text-red-400 border border-red-900/50', label: 'Suspended' };
    if (st === 'trial') return { cls: 'bg-muted/40 text-muted-foreground border border-border', label: 'New' };
    return { cls: 'bg-muted/40 text-muted-foreground border border-border', label: tenant?.status || 'Unknown' };
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
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between whitespace-nowrap border-b border-border px-6 py-3 bg-background z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-foreground mr-1">
            <AppIcon name="arrow_back" />
          </button>
          <div className="hidden md:flex flex-col">
            <h2 className="text-foreground text-lg font-bold leading-tight tracking-[-0.015em]">Tenant Details</h2>
          </div>
        </div>
        <div className="flex flex-1 justify-end gap-6">
          <div className="hidden md:flex items-center w-full max-w-md">
            <div className="flex w-full items-stretch rounded-lg h-10 bg-card border border-border focus-within:ring-2 focus-within:ring-primary/30 transition-colors">
              <div className="text-muted-foreground flex items-center justify-center pl-3">
                <AppIcon name="search" />
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex w-full bg-transparent border-none text-foreground focus:ring-0 placeholder:text-muted-foreground px-3 text-sm"
                placeholder="Search tenants, branches, or logs..."
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-muted-foreground hover:text-foreground relative">
              <AppIcon name="notifications" />
              <span className="absolute top-0 right-0 size-2 bg-red-500 rounded-full"></span>
            </button>
            <button className="text-muted-foreground hover:text-foreground">
              <AppIcon name="help" />
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
          <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{toast}</div>
        ) : null}

        {loading && !tenant ? (
          <div className="mb-6 text-sm text-muted-foreground">Loading tenant...</div>
        ) : null}

        <nav className="flex items-center text-sm">
          <button onClick={onBack} className="text-muted-foreground hover:text-primary transition-colors font-medium">Tenants</button>
          <span className="text-muted-foreground mx-2">/</span>
          <span className="text-foreground font-medium">{tenant?.name || 'Tenant'}</span>
        </nav>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-border pb-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">{tenant?.name || 'Tenant'}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusPill.cls}`}>{statusPill.label}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AppIcon name="fingerprint" className="text-[18px]" size={18} />
              <span className="font-mono text-sm">ID: {tenant?.id || selectedTenantId || '-'}</span>
              <button
                className="text-muted-foreground hover:text-foreground ml-1"
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
                <AppIcon name="content_copy" className="text-[16px]" size={16} />
              </button>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => impersonate('Cafe Owner', Screen.OWNER_DASHBOARD)}
              disabled={!tenant || loading}
              className="flex items-center gap-2 h-10 px-4 bg-card hover:bg-accent border border-border rounded-lg text-foreground text-sm font-bold transition-colors"
            >
              <AppIcon name="admin_panel_settings" className="text-[20px]" size={20} />
              <span>Impersonate</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-2 h-10 px-4 bg-card hover:bg-accent border border-border rounded-lg text-foreground text-sm font-bold transition-colors"
              onClick={() => setEditOpen(true)}
            >
              <AppIcon name="edit" className="text-[20px]" size={20} />
              <span>Edit Config</span>
            </button>
            <button
              onClick={() => updateTenant({ status: isSuspended ? 'Active' : 'Suspended' })}
              disabled={!tenant || loading}
              className="flex items-center gap-2 h-10 px-4 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 rounded-lg text-red-400 text-sm font-bold transition-colors"
            >
              <AppIcon name="block" className="text-[20px]" size={20} />
              <span>{isSuspended ? 'Reactivate' : 'Suspend'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-muted-foreground text-sm font-medium">Total Branches</p>
              <AppIcon name="store" className="text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground">{Number(metrics.branches ?? tenant?.branches ?? 0) || 0}</p>
            <div className="flex items-center gap-1 text-xs text-green-400 mt-1">
              <AppIcon name="trending_up" className="text-[16px]" size={16} />
              <span>+{Number(metrics.branchesNewMonth || 0) || 0} this month</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-muted-foreground text-sm font-medium">Active Users</p>
              <AppIcon name="group" className="text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground">{Number(metrics.users ?? tenant?.users ?? 0) || 0}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <span>Stable</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-muted-foreground text-sm font-medium">Monthly Orders</p>
              <AppIcon name="shopping_cart" className="text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground">{fmtCompact(Number(metrics.ordersMonth || 0) || 0)}</p>
            <div className="flex items-center gap-1 text-xs text-green-400 mt-1">
              <AppIcon name="trending_up" className="text-[16px]" size={16} />
              <span>+{Number(metrics.ordersPct || 0) || 0}% vs last mo</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <p className="text-muted-foreground text-sm font-medium">Current MRR</p>
              <AppIcon name="payments" className="text-primary" />
            </div>
            <p className="text-2xl font-bold text-foreground">{fmtEtb(Number(metrics.mrrEtb || 0) || 0)}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <span className="bg-primary/10 text-primary px-1 rounded">{tenant?.plan || 'Plan'}</span>
            </div>
          </div>
        </div>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Profile & Usage */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="h-24 bg-gradient-to-r from-muted to-muted/40 relative">
                  <div className="absolute -bottom-8 left-6 border-4 border-card rounded-full">
                    <div className="size-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-black">{initials}</div>
                  </div>
                </div>
                <div className="pt-10 px-6 pb-6">
                  <h3 className="text-lg font-bold text-foreground mb-4">Tenant Profile</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Owner</p>
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <AppIcon name="person" className="text-[18px] text-primary" size={18} />
                        {String(profile?.ownerName || profile?.contactName || profile?.owner || '-')}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Contact</p>
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <AppIcon name="mail" className="text-[18px] text-primary" size={18} />
                        {String(profile?.contactEmail || '-')}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-foreground mt-1">
                        <AppIcon name="call" className="text-[18px] text-primary" size={18} />
                        {String(profile?.contactPhone || '-')}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Location</p>
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <AppIcon name="location_on" className="text-[18px] text-primary" size={18} />
                        {String(profile?.city || '-')}{profile?.country ? `, ${String(profile.country)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-border">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Next Billing</span>
                      <span className="text-foreground font-medium">{nextInvoiceLabel}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm mt-2">
                      <span className="text-muted-foreground">Payment Method</span>
                      <span className="text-foreground font-medium">{String(subInfo?.method || subInfo?.cycle || 'manual')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-bold text-foreground mb-4">Usage vs Limits</h3>
                <div className="space-y-5">
                  {(() => {
                    const used = Number(metrics.branches ?? tenant?.branches ?? 0) || 0;
                    const limit = Number((planLimits as any)?.branchLimit || (planLimits as any)?.branches || 0) || 0;
                    const pct = limit ? Math.min(100, (used / Math.max(1, limit)) * 100) : 0;
                    return (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Branches Used</span>
                          <span className="text-foreground font-bold">{used} / {limit || '-'}</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }}></div>
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
                          <span className="text-muted-foreground">Storage (Cloud)</span>
                          <span className="text-foreground font-bold">{used ? `${used} GB` : '-'}{limit ? ` / ${limit} GB` : ''}</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
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
                          <span className="text-muted-foreground">API Calls (Monthly)</span>
                          <span className="text-foreground font-bold">{pct ? `${pct}%` : '-'}</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
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
              <div className="flex items-center gap-2">
              {[{ key: 'branches', label: 'Branches' }, { key: 'users', label: 'Users' }, { key: 'feature_access', label: 'Feature Access' }, { key: 'integrations', label: 'Integrations' }, { key: 'payments', label: 'Payments' }].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key as any)}
                  className={`px-6 py-3 text-sm transition-colors ${
                    tab === t.key
                      ? 'font-bold text-primary border-b-2 border-primary'
                      : 'font-medium text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

              {tab === 'branches' ? (
              <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
                <div className="p-4 flex justify-between items-center border-b border-border">
                  <h3 className="font-bold text-foreground">Branch Status</h3>
                  <button
                    type="button"
                    onClick={reload}
                    className="text-xs font-bold text-primary flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <AppIcon name="refresh" className="text-[16px]" size={16} />
                    Refresh Data
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border text-xs uppercase text-muted-foreground font-bold tracking-wider">
                        <th className="px-6 py-3">Branch Name</th>
                        <th className="px-6 py-3">Location ID</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">POS Version</th>
                        <th className="px-6 py-3 text-right">Last Sync</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-border">
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
                          <td colSpan={5} className="px-6 py-6 text-center text-sm text-muted-foreground">No branches found.</td>
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
                            <tr key={String(b?.id || i)} className="hover:bg-muted/40 transition-colors">
                              <td className="px-6 py-4 font-medium text-foreground">{String(b?.name || '-')}</td>
                              <td className="px-6 py-4 font-mono text-muted-foreground">{String(b?.locationId || b?.location || b?.id || '-')}</td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium ${st.cls}`}>
                                  <span className={`size-1.5 rounded-full ${st.dot}`}></span>
                                  {st.label}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-muted-foreground">{String(b?.posVersion || '-')}</td>
                              <td className="px-6 py-4 text-right text-muted-foreground">{lastSyncLabel || '-'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="bg-muted/40 p-3 border-t border-border flex justify-center">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1"
                    type="button"
                    onClick={() => {
                      setTab('branches');
                      setSearch('');
                    }}
                  >
                    View All Branches <AppIcon name="arrow_forward" className="text-[16px]" size={16} />
                  </button>
                </div>
              </div>
              ) : null}

              {tab === 'users' ? (
                <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
                  <div className="p-4 flex justify-between items-center border-b border-border">
                    <h3 className="font-bold text-foreground">Users</h3>
                    <button
                      type="button"
                      onClick={fetchUsers}
                      disabled={usersLoading}
                      className="text-xs font-bold text-primary flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-60"
                    >
                      <AppIcon name="refresh" className={`text-[16px] ${usersLoading ? 'animate-spin' : ''}`} size={16} />
                      Refresh
                    </button>
                  </div>
                  {usersError ? (
                    <div className="p-4 text-sm text-red-300">{usersError}</div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border text-xs uppercase text-muted-foreground font-bold tracking-wider">
                          <th className="px-6 py-3">Name</th>
                          <th className="px-6 py-3">Role</th>
                          <th className="px-6 py-3">Email</th>
                          <th className="px-6 py-3">Phone</th>
                          <th className="px-6 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-border">
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
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">Loading users...</td>
                              </tr>
                            );
                          }
                          if (rows.length === 0) {
                            return (
                              <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">No users found.</td>
                              </tr>
                            );
                          }
                          return rows.map((u: any) => (
                            <tr key={String(u.id)} className="hover:bg-muted/40 transition-colors">
                              <td className="px-6 py-4 font-medium text-foreground">{String(u.name || '-')}</td>
                              <td className="px-6 py-4 text-muted-foreground">{String(u.role || '-')}</td>
                              <td className="px-6 py-4 text-muted-foreground">{String(u.email || '-')}</td>
                              <td className="px-6 py-4 text-muted-foreground">{String(u.phone || '-')}</td>
                              <td className="px-6 py-4 text-right">
                                <span className="inline-flex items-center rounded-md bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground border border-border">
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
                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Feature Access</h3>
                      <div className="text-xs text-muted-foreground">Manage tenant modules and feature flags</div>
                    </div>
                    <button
                      type="button"
                      onClick={saveModules}
                      disabled={savingModules || loading || !hasUnsavedAccessChanges}
                      className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-60"
                    >
                      {savingModules ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-muted/40 border border-border rounded-lg p-4">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Subscription Modules</div>
                      {[{ key: 'inventory', icon: 'inventory_2', label: 'Inventory' }, { key: 'reports', icon: 'bar_chart', label: 'Reports' }, { key: 'menu', icon: 'restaurant_menu', label: 'Menu' }, { key: 'staff', icon: 'group', label: 'Staff' }, { key: 'finance', icon: 'payments', label: 'Finance' }, { key: 'settings', icon: 'settings', label: 'Settings' }].map((m) => {
                        const allowedByTier = tierModules.includes(m.key);
                        const active = enabledModules.includes(m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            disabled={!allowedByTier}
                            onClick={() => toggleModule(m.key)}
                            className="w-full flex items-center justify-between p-3 hover:bg-accent rounded-md transition-colors disabled:opacity-60"
                          >
                            <div className="flex items-center gap-3">
                              <AppIcon name={m.icon} className="text-muted-foreground" />
                              <div className="flex flex-col items-start">
                                <span className="text-foreground text-sm">{m.label}</span>
                                {!allowedByTier ? <span className="text-[11px] text-muted-foreground">Not in plan</span> : null}
                              </div>
                            </div>
                            <AppIcon name={active ? 'toggle_on' : 'toggle_off'} className={`text-[20px] ${active ? 'text-primary' : 'text-muted-foreground opacity-50'}`} size={20} />
                          </button>
                        );
                      })}
                    </div>

                    <div className="bg-muted/40 border border-border rounded-lg p-4">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Feature Flags</div>
                      {[{ key: 'loyalty', icon: 'loyalty', label: 'Loyalty Program' }, { key: 'kds', icon: 'restaurant', label: 'Kitchen Display (KDS)' }, { key: 'public_api', icon: 'api', label: 'Public API' }].map((f) => {
                        const active = features.includes(f.key);
                        return (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => toggleFeature(f.key)}
                            className="w-full flex items-center justify-between p-3 hover:bg-accent rounded-md transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <AppIcon name={f.icon} className="text-muted-foreground" />
                              <span className="text-foreground text-sm">{f.label}</span>
                            </div>
                            <AppIcon name={active ? 'toggle_on' : 'toggle_off'} className={`text-[20px] ${active ? 'text-primary' : 'text-muted-foreground opacity-50'}`} size={20} />
                          </button>
                        );
                      })}

                      <div className="mt-3 text-xs">
                        {hasUnsavedAccessChanges ? (
                          <div className="text-primary font-semibold">Unsaved changes</div>
                        ) : (
                          <div className="text-muted-foreground">No pending changes</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === 'integrations' ? (
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="text-lg font-bold text-foreground">Integrations</h3>
                  <div className="text-sm text-muted-foreground mt-2">No integrations configured yet.</div>
                </div>
              ) : null}

              {tab === 'payments' ? (
                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Payment Integrations</h3>
                      <div className="text-xs text-muted-foreground">Super Admin manages gateway credentials. Tenant can only enable/disable usage.</div>
                    </div>
                    <button
                      type="button"
                      onClick={savePayments}
                      disabled={paySaving || payLoading}
                      className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-60"
                    >
                      {paySaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>

                  {payError ? (
                    <div className="mt-4 rounded-lg border border-red-600/40 bg-red-500/10 text-red-200 px-4 py-3 text-sm">{payError}</div>
                  ) : null}

                  <div className="mt-5 bg-muted/40 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-foreground font-bold">Chapa (POS)</div>
                        <div className="text-xs text-muted-foreground mt-1">Funds settle to tenant merchant account (strict mode).</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPosChapaEnabled((v) => !v)}
                        className="flex items-center gap-2 text-sm font-bold"
                        disabled={payLoading || paySaving}
                      >
                        <AppIcon name={posChapaEnabled ? 'toggle_on' : 'toggle_off'} className={`text-[22px] ${posChapaEnabled ? 'text-primary' : 'text-muted-foreground opacity-60'}`} size={22} />
                        <span className={posChapaEnabled ? 'text-primary' : 'text-muted-foreground'}>{posChapaEnabled ? 'Enabled' : 'Disabled'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div>
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Secret Key</div>
                        <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posChapaSecretMasked || '—'}</span></div>
                        <input
                          value={posChapaSecretKey}
                          onChange={(e) => setPosChapaSecretKey(e.target.value)}
                          placeholder="Enter new secret key (optional)"
                          className="h-11 w-full rounded-lg border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          type="password"
                          name="pos_chapa_secret_key"
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Webhook Secret</div>
                        <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posChapaWebhookMasked || '—'}</span></div>
                        <input
                          value={posChapaWebhookSecret}
                          onChange={(e) => setPosChapaWebhookSecret(e.target.value)}
                          placeholder="Enter new webhook secret (optional)"
                          className="h-11 w-full rounded-lg border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          type="password"
                          name="pos_chapa_webhook_secret"
                          autoComplete="new-password"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div>
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Public Key (optional)</div>
                        <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posChapaPublicMasked || '—'}</span></div>
                        <input
                          value={posChapaPublicKey}
                          onChange={(e) => setPosChapaPublicKey(e.target.value)}
                          placeholder="Enter public key (optional)"
                          className="h-11 w-full rounded-lg border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          type="text"
                          name="pos_chapa_public_key"
                          autoComplete="off"
                        />
                      </div>
                      <div />
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Tip: If you enable Chapa while no keys are stored, the API will return <span className="font-mono text-foreground">chapa_keys_required</span>.
                    </div>
                  </div>
                <div className="mt-5 bg-muted/40 border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-foreground font-bold">SantimPay (POS)</div>
                      <div className="text-xs text-muted-foreground mt-1">Tenant wallet settlement via SantimPay channels.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPosSantimEnabled((v) => !v)}
                      className="flex items-center gap-2 text-sm font-bold"
                      disabled={payLoading || paySaving}
                    >
                      <AppIcon name={posSantimEnabled ? 'toggle_on' : 'toggle_off'} className={`text-[22px] ${posSantimEnabled ? 'text-primary' : 'text-muted-foreground opacity-60'}`} size={22} />
                      <span className={posSantimEnabled ? 'text-primary' : 'text-muted-foreground'}>{posSantimEnabled ? 'Enabled' : 'Disabled'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Merchant ID</div>
                      <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posSantimMerchantIdMasked || '—'}</span></div>
                      <input
                        value={posSantimMerchantId}
                        onChange={(e) => setPosSantimMerchantId(e.target.value)}
                        placeholder="Enter merchant id (optional)"
                        className="h-11 w-full rounded-lg border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        type="text"
                        name="pos_santimpay_merchant_id"
                        autoComplete="off"
                      />
                    </div>
                    <div />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Private Key (ES256 PEM)</div>
                      <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posSantimPrivateKeyMasked || '—'}</span></div>
                      <textarea
                        value={posSantimPrivateKey}
                        onChange={(e) => setPosSantimPrivateKey(e.target.value)}
                        placeholder="Paste private key PEM (optional)"
                        className="min-h-[110px] w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        name="pos_santimpay_private_key"
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">Public Key (PEM)</div>
                      <div className="text-xs text-muted-foreground mb-2">Stored: <span className="font-mono text-foreground">{posSantimPublicKeyMasked || '—'}</span></div>
                      <textarea
                        value={posSantimPublicKey}
                        onChange={(e) => setPosSantimPublicKey(e.target.value)}
                        placeholder="Paste public key PEM (optional)"
                        className="min-h-[110px] w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        name="pos_santimpay_public_key"
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground">
                    Tip: If you enable SantimPay while missing keys, the API will return <span className="font-mono text-foreground">santimpay_keys_required</span>.
                  </div>
                </div>
              </div>
              ) : null}

              <div className="bg-card border border-border rounded-lg p-6">
                <div className="flex justify-between items-end mb-4">
                  <h3 className="text-lg font-bold text-foreground">Incident History & Logs</h3>
                  <button type="button" onClick={() => setAuditOpen(true)} className="text-sm text-primary hover:text-foreground">View Full Audit Log</button>
                </div>
                <div className="relative pl-4 border-l border-border space-y-6">
                  {(() => {
                    const items = activity.length ? activity : incidents;
                    const needle = search.trim().toLowerCase();
                    const filtered = needle
                      ? items.filter((x: any) => String(x?.type || '').toLowerCase().includes(needle) || String(x?.message || '').toLowerCase().includes(needle))
                      : items;
                    return filtered;
                  })().length === 0 ? (
                    <div className="text-sm text-muted-foreground">No incidents yet.</div>
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
                      const ts = at ? (formatDeviceDateTime(at, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '-') : '-';
                      const type = String(ev?.type || 'event');
                      const desc = String(ev?.message || ev?.summary || ev?.details || '');
                      const sev = String(ev?.severity || type).toLowerCase();
                      const dot = sev.includes('error') ? 'bg-red-500' : sev.includes('warn') ? 'bg-primary' : 'bg-green-500';
                      return (
                        <div key={String(ev?.id || i)} className="relative pl-6">
                          <div className={`absolute -left-[21px] top-1 size-3 ${dot} rounded-full border-2 border-card`}></div>
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                            <div>
                              <p className="text-sm font-bold text-foreground">{type}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{desc || `Branch: ${String(ev?.branchId || 'global')}`}</p>
                            </div>
                            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{ts}</span>
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
            <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="font-bold text-foreground">Edit Tenant Config</div>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditOpen(false)}>
                  <AppIcon name="close" />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Tenant Name</div>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Owner</div>
                  <input
                    value={editOwner}
                    onChange={(e) => setEditOwner(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Email</div>
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Phone</div>
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">City</div>
                  <input
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Country</div>
                  <input
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="p-4 border-t border-border flex items-center justify-end gap-2">
                <button type="button" className="h-10 px-4 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent" onClick={() => setEditOpen(false)}>Cancel</button>
                <button type="button" className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-60" onClick={saveEditConfig} disabled={loading}>Save</button>
              </div>
            </div>
          </div>
        ) : null}

        {auditOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-xl">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="font-bold text-foreground">Audit Log (Recent)</div>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setAuditOpen(false)}>
                  <AppIcon name="close" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                {(() => {
                  const items = activity.length ? activity : incidents;
                  const needle = search.trim().toLowerCase();
                  const filtered = needle
                    ? items.filter((x: any) => String(x?.type || '').toLowerCase().includes(needle) || String(x?.message || '').toLowerCase().includes(needle))
                    : items;
                  if (filtered.length === 0) return <div className="text-sm text-muted-foreground">No audit events.</div>;
                  return (
                    <div className="space-y-3">
                      {filtered.slice(0, 50).map((ev: any) => (
                        <div key={String(ev?.id)} className="rounded-lg border border-border bg-muted/40 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-bold text-foreground">{String(ev?.type || 'event')}</div>
                            <div className="text-xs font-mono text-muted-foreground">{String(ev?.at ? (formatDeviceDateTime(ev.at) || '') : '')}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{String(ev?.message || '')}</div>
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
