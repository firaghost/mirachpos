import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';

import { AppIcon } from '@/components/ui/app-icon';
type BillingRow = {
    tenantId: string;
    tenantName: string;
    plan: string;
    cycle: string;
    requestedPlan?: string;
    requestedCycle?: string;
    nextBillAt: string;
    amountEtb: number;
    method: string;
    status: string;
    graceEndsAt?: string;
};

export const PlansMatrixView = () => {
    const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tenants, setTenants] = useState<BillingRow[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState<string>('');

    const [plans, setPlans] = useState<Array<{ tier: string; modules: string[]; limits: any; pricing: { monthlyEtb: number; yearlyEtb: number } }>>([]);
    const [plansLoading, setPlansLoading] = useState(false);

    const [editOpen, setEditOpen] = useState(false);
    const [editTier, setEditTier] = useState('');
    const [editMonthly, setEditMonthly] = useState('');
    const [editYearly, setEditYearly] = useState('');
    const [editBranchLimit, setEditBranchLimit] = useState('');
    const [editStaffLimit, setEditStaffLimit] = useState('');
    const [editModules, setEditModules] = useState('');
    const [editSaving, setEditSaving] = useState(false);

    const SELECTED_TENANT_KEY = 'mirachpos.superadmin.selectedTenant.v1';

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await apiFetch('/api/superadmin/billing');
                const json = (await res.json().catch(() => null)) as any;
                if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                const rows = Array.isArray(json?.subscriptions) ? (json.subscriptions as BillingRow[]) : [];
                setTenants(rows);
                let remembered = '';
                try {
                    remembered = localStorage.getItem(SELECTED_TENANT_KEY) || '';
                } catch {
                    // ignore
                }
                const first = rows[0]?.tenantId || '';
                const nextId = (remembered && rows.some((r) => r.tenantId === remembered)) ? remembered : first;
                setSelectedTenantId((cur) => cur || nextId);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load tenants');
                setTenants([]);
            } finally {
                setLoading(false);
            }
        };
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const loadPlans = async () => {
            setPlansLoading(true);
            setError(null);
            try {
                const res = await apiFetch('/api/superadmin/plans');
                const json = (await res.json().catch(() => null)) as any;
                if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                const items = Array.isArray(json?.plans) ? json.plans : [];
                setPlans(items);
            } catch (e) {
                setPlans([]);
                setError(e instanceof Error ? e.message : 'Failed to load plans');
            } finally {
                setPlansLoading(false);
            }
        };
        loadPlans();
    }, []);

    useEffect(() => {
        if (!selectedTenantId) return;
        try {
            localStorage.setItem(SELECTED_TENANT_KEY, selectedTenantId);
        } catch {
            // ignore
        }
    }, [selectedTenantId]);

    const selectedTenant = useMemo(() => tenants.find((t) => t.tenantId === selectedTenantId) || null, [tenants, selectedTenantId]);
    const selectedPlan = String(selectedTenant?.plan || 'Trial');
    const selectedCycle = String(selectedTenant?.cycle || '').toLowerCase();

    const planRow = useMemo(() => {
        const t = String(selectedPlan || '').trim();
        return plans.find((p) => String(p.tier) === t) || null;
    }, [plans, selectedPlan]);

    useEffect(() => {
        // Auto-sync the matrix view to the tenant's billing cycle
        if (selectedCycle === 'yearly') setPeriod('yearly');
        if (selectedCycle === 'monthly') setPeriod('monthly');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCycle]);
    const suffix = period === 'yearly' ? '/yr' : '/mo';
    const selectedPrice = useMemo(() => {
        const p = planRow?.pricing;
        if (!p) return 0;
        return period === 'yearly' ? Number(p.yearlyEtb || 0) || 0 : Number(p.monthlyEtb || 0) || 0;
    }, [period, planRow?.pricing]);

    const sections = useMemo(
        () => [
            {
                title: 'Operational Limits',
                icon: 'domain',
                rows: [
                    { label: 'Max Locations', trial: '1', basic: '1', pro: '5', ent: 'Unlimited', entIcon: 'all_inclusive' },
                    { label: 'Max Registers (POS)', trial: '1', basic: '2', pro: '6', ent: 'Unlimited', entIcon: 'all_inclusive' },
                    { label: 'Max Staff Accounts', trial: '3', basic: '10', pro: '30', ent: 'Unlimited', entIcon: 'all_inclusive' },
                    { label: 'Max Menu Items', trial: '50', basic: '250', pro: '2000', ent: 'Unlimited', entIcon: 'all_inclusive' },
                    { label: 'Max Modifiers / Add-ons', trial: '30', basic: '150', pro: '1000', ent: 'Unlimited', entIcon: 'all_inclusive' },
                    { label: 'Max Tables (Dine-in)', trial: '20', basic: '60', pro: '200', ent: 'Unlimited', entIcon: 'all_inclusive' },
                ],
            },
            {
                title: 'Core Features',
                icon: 'verified',
                rows: [
                    { label: 'POS Orders', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Inventory Tracking', trial: 'Limited', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Customer Loyalty', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Kitchen Display (KDS)', trial: '—', basic: '—', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Discounts & Promotions', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Multi-Branch Management', trial: '—', basic: '—', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                ],
            },
            {
                title: 'Integrations & API',
                icon: 'hub',
                rows: [
                    { label: 'Public API', trial: 'Limited', basic: 'Limited', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Webhooks', trial: '—', basic: '—', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Custom Domain', trial: '—', basic: '—', pro: '—', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Custom Integrations', trial: '—', basic: '—', pro: '—', ent: 'Included', entIcon: 'check_circle' },
                ],
            },
            {
                title: 'Support & Security',
                icon: 'support_agent',
                rows: [
                    { label: 'Email Support', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Priority Support', trial: '—', basic: '—', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Dedicated Account Manager', trial: '—', basic: '—', pro: '—', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Audit Log', trial: '—', basic: '—', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Role-Based Access Control', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                ],
            },
        ],
        [],
    );

    const planKey = (p: string) => {
        const v = String(p || '').toLowerCase();
        if (v === 'basic') return 'basic';
        if (v === 'pro') return 'pro';
        if (v === 'enterprise') return 'ent';
        return 'trial';
    };

    const selectedKey = planKey(selectedPlan);

    const selectedHeader = useMemo(() => {
        const title = selectedKey === 'basic' ? 'Basic' : selectedKey === 'pro' ? 'Pro' : selectedKey === 'ent' ? 'Enterprise' : 'Free / Trial';
        const accent = selectedKey === 'basic';
        const hasCustom = selectedKey === 'ent' && selectedPrice === 0;
        return { title, price: hasCustom ? (null as number | null) : selectedPrice, accent };
    }, [selectedKey, selectedPrice]);

    const limitValue = useMemo(() => {
        const lim = planRow?.limits && typeof planRow.limits === 'object' ? planRow.limits : {};
        const branchLimit = Number(lim.branchLimit);
        const staffLimit = Number(lim.staffLimit);
        return {
            branchLimit: Number.isFinite(branchLimit) ? branchLimit : 0,
            staffLimit: Number.isFinite(staffLimit) ? staffLimit : 0,
        };
    }, [planRow?.limits]);

    const openEdit = () => {
        if (!planRow) return;
        setEditTier(String(planRow.tier || ''));
        setEditMonthly(String(Number(planRow.pricing?.monthlyEtb || 0) || 0));
        setEditYearly(String(Number(planRow.pricing?.yearlyEtb || 0) || 0));
        setEditBranchLimit(String(limitValue.branchLimit || 0));
        setEditStaffLimit(String(limitValue.staffLimit || 0));
        setEditModules((Array.isArray(planRow.modules) ? planRow.modules : []).join(','));
        setEditOpen(true);
    };

    const saveEdit = async () => {
        if (editSaving) return;
        if (!editTier) return;
        setEditSaving(true);
        setError(null);
        try {
            const monthlyEtb = Number(editMonthly);
            const yearlyEtb = Number(editYearly);
            const branchLimit = Number(editBranchLimit);
            const staffLimit = Number(editStaffLimit);
            if (!Number.isFinite(monthlyEtb) || monthlyEtb < 0) throw new Error('Invalid monthly price');
            if (!Number.isFinite(yearlyEtb) || yearlyEtb < 0) throw new Error('Invalid yearly price');
            if (!Number.isFinite(branchLimit) || branchLimit < 0) throw new Error('Invalid branch limit');
            if (!Number.isFinite(staffLimit) || staffLimit < 0) throw new Error('Invalid staff limit');

            const modules = editModules
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

            const res = await apiFetch(`/api/superadmin/plans/${encodeURIComponent(editTier)}` as any, {
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

            const res2 = await apiFetch('/api/superadmin/plans');
            const json2 = (await res2.json().catch(() => null)) as any;
            if (res2.ok) setPlans(Array.isArray(json2?.plans) ? json2.plans : []);
            setEditOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update plan');
        } finally {
            setEditSaving(false);
        }
    };

    const renderCell = (v: string, highlight?: boolean, icon?: string) => {
        const isDash = v === '—' || v === '';
        if (icon && v === 'Unlimited') {
            return (
                <span className="text-foreground font-bold text-lg flex items-center gap-2">
                    <AppIcon name={icon} className="text-primary text-[20px]" size={20} /> {v}
                </span>
            );
        }
        if (icon && (v === 'Included' || v === 'Limited')) {
            return (
                <span className={'inline-flex items-center gap-2 ' + (highlight ? 'text-primary font-bold' : 'text-foreground font-bold')}>
                    <span className={'material-symbols-outlined text-[18px] ' + (highlight ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
                    {v}
                </span>
            );
        }
        if (isDash) return <span className="text-muted-foreground">—</span>;
        return <span className={highlight ? 'text-primary font-bold text-lg' : 'text-foreground font-bold text-lg'}>{v}</span>;
    };
    return (
        <div className="flex flex-col">
            {editOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60" onClick={() => (editSaving ? null : setEditOpen(false))} />
                    <div className="relative w-full max-w-[720px] rounded-xl border border-border bg-card shadow-2xl">
                        <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
                            <div className="text-foreground font-black text-lg">Edit Plan: {editTier || '—'}</div>
                            <button
                                type="button"
                                disabled={editSaving}
                                onClick={() => setEditOpen(false)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Monthly Price (ETB)</label>
                                <input
                                    value={editMonthly}
                                    onChange={(e) => setEditMonthly(e.target.value)}
                                    className="h-11 rounded-lg border border-border bg-background px-3 text-foreground text-sm"
                                    disabled={editSaving}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Yearly Price (ETB)</label>
                                <input
                                    value={editYearly}
                                    onChange={(e) => setEditYearly(e.target.value)}
                                    className="h-11 rounded-lg border border-border bg-background px-3 text-foreground text-sm"
                                    disabled={editSaving}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Branch Limit</label>
                                <input
                                    value={editBranchLimit}
                                    onChange={(e) => setEditBranchLimit(e.target.value)}
                                    className="h-11 rounded-lg border border-border bg-background px-3 text-foreground text-sm"
                                    disabled={editSaving}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Staff Limit</label>
                                <input
                                    value={editStaffLimit}
                                    onChange={(e) => setEditStaffLimit(e.target.value)}
                                    className="h-11 rounded-lg border border-border bg-background px-3 text-foreground text-sm"
                                    disabled={editSaving}
                                />
                            </div>
                            <div className="flex flex-col gap-2 md:col-span-2">
                                <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Modules (comma-separated)</label>
                                <textarea
                                    value={editModules}
                                    onChange={(e) => setEditModules(e.target.value)}
                                    className="min-h-[92px] rounded-lg border border-border bg-background px-3 py-2 text-foreground text-sm"
                                    disabled={editSaving}
                                />
                                <div className="text-xs text-muted-foreground">Example: pos, orders, tables, inventory, menu, staff, branches, settings</div>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-border bg-muted/40 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setEditOpen(false)}
                                disabled={editSaving}
                                className="px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveEdit}
                                disabled={editSaving}
                                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-50"
                            >
                                {editSaving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="flex items-center justify-between mb-4">
                <div className="text-xs text-muted-foreground">
                    {plansLoading ? 'Loading plans…' : planRow ? `Plan source: MySQL (${String(planRow.tier)})` : 'Plan source: MySQL'}
                </div>
                <button
                    onClick={openEdit}
                    disabled={!planRow || editSaving}
                    className="px-3 py-2 rounded-lg border border-border bg-card text-sm font-bold text-foreground hover:bg-accent disabled:opacity-50"
                    type="button"
                >
                    Edit Selected Plan
                </button>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <div className="flex bg-card rounded-lg p-1 border border-border">
                    <button
                        onClick={() => setPeriod('monthly')}
                        className={
                            'px-6 py-2 rounded-md text-sm font-bold shadow-sm transition-all ' +
                            (period === 'monthly' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')
                        }
                        type="button"
                    >
                        Monthly Billing
                    </button>
                    <button
                        onClick={() => setPeriod('yearly')}
                        className={
                            'px-6 py-2 rounded-md text-sm font-bold transition-all ' +
                            (period === 'yearly' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')
                        }
                        type="button"
                    >
                        Yearly Billing
                    </button>
                </div>
                <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AppIcon name="storefront" className="text-[18px] text-primary" size={18} />
                        <span className="uppercase tracking-wider font-bold">Cafe</span>
                    </div>
                    <select
                        value={selectedTenantId}
                        onChange={(e) => setSelectedTenantId(e.target.value)}
                        className="bg-card rounded-lg p-2 border border-border text-sm text-foreground min-w-[280px]"
                        disabled={loading}
                    >
                        <option value="">Select cafe…</option>
                        {tenants.map((t) => (
                            <option key={t.tenantId} value={t.tenantId}>
                                {t.tenantName} — {t.plan} ({t.cycle})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground items-center">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary"></span><span>Warning Threshold</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-destructive"></span><span>Limit Reached</span></div>
                </div>
            </div>

            {error ? (
                <div className="mb-4 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
            ) : null}

            <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[900px]">
                        <thead>
                            <tr className="border-b border-border bg-muted/40">
                                <th className="sticky left-0 z-20 bg-muted/40 p-6 min-w-[200px] border-r border-border"><span className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Feature / Limit</span></th>
                                <th className={"p-6 min-w-[260px] " + 'bg-card'}>
                                    <div className="flex flex-col gap-1">
                                        <span className={
                                            'text-foreground text-sm font-bold uppercase tracking-wide ' +
                                            (selectedHeader.accent ? 'text-primary' : '')
                                        }>
                                            {selectedHeader.title}
                                        </span>
                                        <div className="flex items-baseline gap-1 mt-1">
                                            {selectedHeader.price === null ? (
                                                <span className="text-foreground text-2xl font-black">Custom</span>
                                            ) : (
                                                <>
                                                    <span className="text-foreground text-2xl font-black">ETB {selectedHeader.price}</span>
                                                    <span className="text-muted-foreground text-xs font-medium">{suffix}</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-2">
                                            Limits: {limitValue.branchLimit ? `Branches ${limitValue.branchLimit}` : 'Branches —'} • {limitValue.staffLimit ? `Staff ${limitValue.staffLimit}` : 'Staff —'}
                                        </div>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {sections.map((s) => (
                                <React.Fragment key={s.title}>
                                    <tr className="bg-muted/40">
                                        <td className="px-6 py-3 border-b border-border sticky left-0 z-10 bg-muted/40" colSpan={2}>
                                            <div className="flex items-center gap-2">
                                                <AppIcon name={s.icon} className="text-primary text-[18px]" size={18} />
                                                <span className="text-foreground font-bold text-sm uppercase tracking-wide">{s.title}</span>
                                            </div>
                                        </td>
                                    </tr>
                                    {s.rows.map((r) => (
                                        <tr key={r.label} className="group hover:bg-accent transition-colors border-b border-border/60">
                                            <td className="p-6 font-medium text-foreground sticky left-0 z-10 bg-card group-hover:bg-accent border-r border-border">{r.label}</td>
                                            <td className={"p-6 align-top bg-card/40"}>
                                                {selectedKey === 'trial'
                                                    ? renderCell(r.trial, false, r.trial === 'Included' ? 'check_circle' : r.trial === 'Limited' ? 'error' : undefined)
                                                    : selectedKey === 'basic'
                                                        ? renderCell(r.basic, false, r.basic === 'Included' ? 'check_circle' : r.basic === 'Limited' ? 'error' : undefined)
                                                        : selectedKey === 'pro'
                                                            ? renderCell(r.pro, false, r.pro === 'Included' ? 'check_circle' : r.pro === 'Limited' ? 'error' : undefined)
                                                            : renderCell(r.ent, false, r.entIcon)
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
