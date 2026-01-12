
import React, { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Label } from '@/components/ui/label';
import { cn } from '../../components/lib/utils';
import { apiFetch, authHeader } from '../../api';
import { formatDeviceDate } from '../../datetime';

// Get API base URL for FormData requests
const getApiBase = (): string => {
    const envBase = (import.meta as any)?.env?.VITE_API_BASE;
    if (typeof envBase === 'string' && envBase.trim()) return envBase.trim().replace(/\/+$/, '');
    const host = typeof window !== 'undefined' ? window.location?.hostname : '';
    return (host === 'localhost' || host === '127.0.0.1') ? 'http://127.0.0.1:3001' : '';
};

const fmtMoney = (n: number) => {
    return new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB' }).format(n);
};

const fmtDate = (iso: string) => {
    try {
        return formatDeviceDate(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || iso;
    } catch {
        return iso;
    }
};

const fmtShortDate = (iso: string) => {
    try {
        const month = formatDeviceDate(iso, { month: 'short', day: 'numeric' }) || iso;
        const year = (() => {
          try {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? '' : d.getFullYear().toString();
          } catch {
            return '';
          }
        })();
        return { month, year };
    } catch {
        return { month: iso, year: '' };
    }
};

const getDaysRemaining = (iso: string) => {
    try {
        const d = new Date(iso);
        const now = new Date();
        const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : 0;
    } catch {
        return 0;
    }
};

type PlanCycle = 'Monthly' | 'Yearly';

const gatewayInfo: Record<string, { icon: string; gradient: string; name: string }> = {
    bank_transfer: { icon: 'account_balance', gradient: 'from-indigo-600 to-indigo-800', name: 'Bank Transfer' },
    chapa: { icon: 'credit_card', gradient: 'from-green-500 to-green-700', name: 'Chapa' },
    telebirr: { icon: 'phone_android', gradient: 'from-white-500 to-white-700', name: 'Telebirr' },
    cbe_birr: { icon: 'account_balance_wallet', gradient: 'from-purple-500 to-purple-700', name: 'CBE Birr' }
};

export const OwnerBilling: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [subscription, setSubscription] = useState<any>(null);
    const [invoices, setInvoices] = useState<any[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<any>(null);

    const [autoOpenInvoiceId] = useState<string>(() => {
        try {
            return localStorage.getItem('mirachpos.ownerBilling.openInvoiceId.v1') || '';
        } catch {
            return '';
        }
    });

    const [plans, setPlans] = useState<Array<{ tier: string; modules: string[]; limits: any; pricing: { monthlyEtb: number; yearlyEtb: number } }>>([]);
    const [plansError, setPlansError] = useState<string | null>(null);

    // Change plan modal
    const [planModalOpen, setPlanModalOpen] = useState(false);
    const [planDraft, setPlanDraft] = useState<{ tier: string; cycle: PlanCycle }>({ tier: '', cycle: 'Monthly' });
    const [planSubmitting, setPlanSubmitting] = useState(false);

    // Modal states
    const [payModalOpen, setPayModalOpen] = useState(false);
    const [payingInvoice, setPayingInvoice] = useState<any>(null);
    const [selectedGateway, setSelectedGateway] = useState<string | null>(null);
    const [bankRef, setBankRef] = useState('');
    const [bankProof, setBankProof] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const [subRes, invRes, methodsRes] = await Promise.all([
                apiFetch('/api/owner/subscription'),
                apiFetch('/api/owner/invoices'),
                apiFetch('/api/owner/payment-instructions'),
            ]);

            if (subRes.ok) setSubscription(await subRes.json());
            if (invRes.ok) {
                const data = await invRes.json();
                const list = Array.isArray(data?.invoices) ? data.invoices : [];
                setInvoices(list);

                if (autoOpenInvoiceId) {
                    const inv = list.find((i: any) => String(i?.id || '') === String(autoOpenInvoiceId));
                    if (inv) {
                        setPayingInvoice(inv);
                        setSelectedGateway(null);
                        setBankRef('');
                        setBankProof(null);
                        setPayModalOpen(true);
                    }
                    try {
                        localStorage.removeItem('mirachpos.ownerBilling.openInvoiceId.v1');
                    } catch {
                    }
                }
            }
            if (methodsRes.ok) {
                const data = await methodsRes.json();
                setPaymentMethods(data?.methods || null);
            }

            // Plans
            try {
                const plansRes = await apiFetch('/api/owner/plans');
                const data = await plansRes.json().catch(() => null);
                if (!plansRes.ok) throw new Error(data?.error || 'Failed to load plans');
                setPlans(Array.isArray(data?.plans) ? data.plans : []);
                setPlansError(null);
            } catch (e) {
                setPlans([]);
                setPlansError(e instanceof Error ? e.message : 'Failed to load plans');
            }
        } catch (e) {
            setError('Failed to load billing data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const executePayment = async () => {
        if (!selectedGateway || !payingInvoice) return;
        setIsSubmitting(true);
        setError(null);
        try {
            if (selectedGateway === 'bank_transfer') {
                if (!bankRef.trim()) throw new Error('Transaction reference is required');
                if (!bankProof) throw new Error('Payment proof attachment is required');
                const formData = new FormData();
                formData.append('method', 'bank_transfer');
                formData.append('reference', bankRef);
                formData.append('proof', bankProof);

                const apiBase = getApiBase();
                const res = await fetch(`${apiBase}/api/owner/invoices/${payingInvoice.id}/pay`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        ...authHeader(),
                        'X-Tenant': localStorage.getItem('mirachpos.lastWorkspace.v1') || '',
                    },
                });
                if (!res.ok) throw new Error('Payment submission failed');
                setSuccess('Payment proof submitted. Awaiting verification.');
                setPayModalOpen(false);
                setBankRef('');
                setBankProof(null);
            } else {
                const res = await apiFetch(`/api/owner/invoices/${payingInvoice.id}/pay-online`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gateway: selectedGateway }),
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
                if (data?.checkoutUrl) window.location.href = data.checkoutUrl;
                else throw new Error('gateway_unavailable');
            }
            load(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Payment failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const requestPlanChange = async () => {
        if (!planDraft.tier) {
            setError('Please select a plan');
            return;
        }
        setPlanSubmitting(true);
        setError(null);
        try {
            const res = await apiFetch('/api/owner/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier: planDraft.tier, cycle: planDraft.cycle }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.message || data?.error || 'Failed to request plan change');

            const createdInv = data?.invoice;
            if (createdInv?.id) {
                setSuccess('Invoice created. Select a payment method and confirm to complete payment.');
            } else {
                setSuccess('Plan change requested. Please complete payment from your invoices.');
            }

            setPlanModalOpen(false);
            await load(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to request plan change');
        } finally {
            setPlanSubmitting(false);
        }
    };

    const handlePayNow = (invoice?: any) => {
        const inv = invoice || invoices.find(i => i.status === 'pending') || invoices[0];
        if (inv) {
            setPayingInvoice(inv);
            setSelectedGateway(null);
            setBankRef('');
            setPayModalOpen(true);
        }
    };

    const downloadInvoice = async (invoice: any) => {
        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/owner/invoices/${invoice.id}/pdf`, {
                headers: {
                    ...authHeader(),
                    'X-Tenant': localStorage.getItem('mirachpos.lastWorkspace.v1') || '',
                },
            });
            if (!res.ok) throw new Error('Failed to download invoice');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `invoice_${invoice.invoiceNumber || invoice.id}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            setError('Failed to download invoice');
        }
    };

    // Compute display values
    const billingStatus = subscription?.billing?.status || 'inactive';
    const isActive = billingStatus === 'active';
    const nextBillDate = subscription?.billing?.nextBillAt || '';
    const amountDue = subscription?.billing?.amountEtb || 0;
    const planTier = subscription?.subscription?.tier || 'Basic';
    const billingCycle = subscription?.billing?.cycle || 'Monthly';
    const daysRemaining = getDaysRemaining(nextBillDate);

    const pendingInvoice = invoices.find((i) => String(i?.status || '').toLowerCase() === 'pending') || null;

    // Plan features (dynamic based on tier)
    const planFeatures = subscription?.subscription?.modules?.length > 0
        ? ['Full Inventory Management', 'Advanced Analytics & Reporting', 'Unlimited Staff Accounts', 'Priority Support']
        : ['Basic POS Features', 'Order Management', 'Basic Reports'];

    const enabledGateways = {
        chapa: Boolean(paymentMethods?.chapa?.enabled),
        telebirr: Boolean(paymentMethods?.telebirr?.enabled),
        cbe_birr: Boolean(paymentMethods?.cbeBirr?.enabled),
        bank_transfer: Boolean(paymentMethods?.bankTransfer?.enabled),
    };

    const header = (
        <Header
            title="Subscription & Billing"
            subtitle="Manage your cafe plan, payments, and view billing history"
            action={
                <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-9 px-3 gap-2 text-muted-foreground hover:text-foreground">
                    <span className={cn("material-symbols-outlined text-[18px]", refreshing && "animate-spin")}>sync</span>
                    Refresh
                </Button>
            }
        />
    );

    const content = (
        <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-8 pb-32">
            {/* Error/Success Alerts */}
            {error && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex justify-between items-center">
                    <p className="text-sm font-medium">{error}</p>
                    <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 size-6 p-0 rounded-full"><span className="material-symbols-outlined text-sm">close</span></Button>
                </div>
            )}

            {success && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex justify-between items-center">
                    <p className="text-sm font-medium">{success}</p>
                    <Button variant="ghost" size="sm" onClick={() => setSuccess(null)} className="h-6 size-6 p-0 rounded-full"><span className="material-symbols-outlined text-sm">close</span></Button>
                </div>
            )}

            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-foreground text-3xl md:text-4xl font-black tracking-tight">Subscription & Billing</h1>
                    <p className="text-muted-foreground text-base">Manage your cafe plan, payments, and view billing history.</p>
                </div>
                <button className="text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">help</span>
                    Billing Support
                </button>
            </div>

            {/* Stats Overview - 3 Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Status Card */}
                <Card className="relative overflow-hidden group border-border/50">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <span className={cn("material-symbols-outlined text-6xl", isActive ? "text-emerald-500" : "text-amber-500")}>
                            {isActive ? 'check_circle' : 'warning'}
                        </span>
                    </div>
                    <CardContent className="p-5">
                        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Subscription Status</p>
                        <div className="flex items-center gap-2 mt-2">
                            <span className={cn("size-2 rounded-full shadow-lg", isActive ? "bg-emerald-500 shadow-emerald-500/40" : "bg-amber-500 shadow-amber-500/40")}></span>
                            <p className="text-foreground text-2xl font-bold capitalize">{billingStatus}</p>
                        </div>
                        <p className={cn("text-xs mt-2", isActive ? "text-emerald-500" : "text-amber-500")}>
                            {isActive ? 'Auto-renewal enabled' : 'Payment required'}
                        </p>
                    </CardContent>
                </Card>

                {/* Next Billing Date Card */}
                <Card className="relative overflow-hidden group border-border/50">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <span className="material-symbols-outlined text-6xl text-primary">calendar_month</span>
                    </div>
                    <CardContent className="p-5">
                        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Next Billing Date</p>
                        <p className="text-foreground text-2xl font-bold mt-2">{fmtDate(nextBillDate)}</p>
                        <p className="text-muted-foreground text-xs mt-2">{daysRemaining} days remaining</p>
                    </CardContent>
                </Card>

                {/* Amount Due Card */}
                <Card className="relative overflow-hidden border-primary/30 shadow-lg shadow-primary/5">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <span className="material-symbols-outlined text-6xl text-primary">payments</span>
                    </div>
                    <CardContent className="p-5">
                        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Amount Due</p>
                        <p className="text-foreground text-3xl font-extrabold mt-2 tracking-tight">
                            {fmtMoney(amountDue).replace('ETB', 'ETB ')}
                        </p>
                        <p className="text-primary text-xs mt-2 font-medium">{billingCycle} billing cycle</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Grid: Plan & Payment | History */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Plan & Payment Method */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    {/* Current Plan Card */}
                    <Card className="border-border/50">
                        <CardHeader className="pb-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle className="text-lg font-bold">Current Plan Details</CardTitle>
                                    <p className="text-muted-foreground text-sm">Features included in your subscription</p>
                                </div>
                                <Badge className="bg-primary/20 text-primary border-primary/30 font-bold uppercase text-xs">
                                    {planTier}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col md:flex-row gap-6 items-stretch">
                                {/* Plan Visual */}
                                <div className="w-full md:w-1/3 bg-gradient-to-br from-card to-muted rounded-lg min-h-[140px] flex items-center justify-center border border-border/50">
                                    <div className="text-center p-4">
                                        <p className="text-foreground font-bold text-xl">{planTier}</p>
                                        <p className="text-muted-foreground text-sm">{subscription?.subscription?.modules?.length || 0} Modules</p>
                                    </div>
                                </div>
                                {/* Features List */}
                                <div className="flex-1 flex flex-col justify-center gap-3">
                                    {planFeatures.map((feature, i) => (
                                        <div key={i} className="flex items-center gap-3 text-sm text-foreground">
                                            <span className="material-symbols-outlined text-primary text-[20px]">check</span>
                                            {feature}
                                        </div>
                                    ))}
                                    <div className="mt-2 flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPlanDraft({ tier: planTier, cycle: (String(billingCycle).toLowerCase() === 'yearly' ? 'Yearly' : 'Monthly') as PlanCycle });
                                                setPlanModalOpen(true);
                                            }}
                                            className="text-primary text-sm font-medium hover:underline w-fit"
                                        >
                                            Change plan
                                        </button>
                                        {plansError ? <span className="text-xs text-destructive">{plansError}</span> : null}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Checkout (enterprise) */}
                    <Card className="border-border/50">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-lg font-bold">Checkout</CardTitle>
                            <p className="text-muted-foreground text-sm">Pay only when you have a pending invoice.</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {pendingInvoice ? (
                                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Invoice</span>
                                            <span className="text-foreground font-mono text-sm">{pendingInvoice.invoiceNumber}</span>
                                        </div>
                                        <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20">Pending Payment</Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground text-sm">Amount</span>
                                        <span className="text-foreground font-bold">{fmtMoney(Number(pendingInvoice.totalEtb || 0))}</span>
                                    </div>
                                    <div className="flex items-center justify-end">
                                        <Button onClick={() => handlePayNow(pendingInvoice)} className="h-11 px-6 font-bold shadow-lg shadow-primary/20">
                                            Pay now
                                            <span className="material-symbols-outlined text-[18px] ml-2">arrow_forward</span>
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 rounded-xl bg-muted/30 border border-border text-muted-foreground text-sm">
                                    No pending invoice. Choose a plan to generate an invoice.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Billing Contact & History */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                    {/* Billing Contact Card */}
                    <Card className="border-border/50">
                        <CardHeader className="pb-3">
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-base font-bold">Billing Contact</CardTitle>
                                <button className="text-primary text-xs font-medium hover:underline">Edit</button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-3 mb-3">
                                <div className="size-8 rounded-full bg-muted flex items-center justify-center text-foreground font-bold text-xs">
                                    {subscription?.tenant?.name?.slice(0, 2)?.toUpperCase() || 'CA'}
                                </div>
                                <div className="flex flex-col">
                                    <p className="text-foreground text-sm font-medium">{subscription?.tenant?.name || 'Cafe Owner'}</p>
                                    <p className="text-muted-foreground text-xs">{subscription?.tenant?.email || 'owner@cafe.com'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground text-xs">
                                <span className="material-symbols-outlined text-[16px]">location_on</span>
                                Addis Ababa, Ethiopia
                            </div>
                        </CardContent>
                    </Card>

                    {/* Billing History Card */}
                    <Card className="border-border/50 flex-1 flex flex-col">
                        <CardHeader className="pb-3 border-b border-border">
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-base font-bold">Billing History</CardTitle>
                                <button className="text-muted-foreground hover:text-foreground transition-colors">
                                    <span className="material-symbols-outlined">filter_list</span>
                                </button>
                            </div>
                        </CardHeader>
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-muted-foreground text-xs border-b border-border">
                                        <th className="px-5 py-3 font-medium">Date</th>
                                        <th className="px-5 py-3 font-medium">Amount</th>
                                        <th className="px-5 py-3 font-medium text-right">Invoice</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {invoices.slice(0, 5).map((inv) => {
                                        const dateInfo = fmtShortDate(inv.issueDate);
                                        return (
                                            <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                                                <td className="px-5 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-foreground font-medium">{dateInfo.month}</span>
                                                        <span className="text-muted-foreground text-xs">{dateInfo.year}</span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4 text-foreground font-medium">{fmtMoney(inv.totalEtb)}</td>
                                                <td className="px-5 py-4 text-right">
                                                    <button
                                                        onClick={() => downloadInvoice(inv)}
                                                        className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-muted"
                                                    >
                                                        <span className="material-symbols-outlined text-[20px]">download</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {invoices.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground text-sm">
                                                No invoices yet
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {invoices.length > 5 && (
                            <div className="p-4 border-t border-border text-center">
                                <button className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">View all invoices</button>
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col md:flex-row justify-between items-center text-muted-foreground text-xs pb-6 gap-2">
                <p>© {new Date().getFullYear()} MirachPos. All rights reserved.</p>
                <div className="flex gap-4">
                    <a className="hover:text-foreground transition-colors" href="#">Terms of Service</a>
                    <a className="hover:text-foreground transition-colors" href="#">Privacy Policy</a>
                </div>
            </div>
        </div>
    );

    return (
        <div className={cn("flex flex-col h-full bg-background text-foreground overflow-hidden", embedded && "bg-transparent")}>
            {!embedded && header}
            <ScrollArea className="flex-1">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <span className="material-symbols-outlined text-4xl animate-spin text-primary">sync</span>
                    </div>
                ) : content}
            </ScrollArea>

            {/* Payment Modal */}
            <Modal open={payModalOpen} onClose={() => setPayModalOpen(false)} title="Complete Payment">
                <div className="max-h-[75vh] overflow-y-auto pr-1 space-y-6 p-1">
                    {error && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex justify-between items-start gap-3">
                            <p className="text-sm font-medium">{error}</p>
                            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 size-6 p-0 rounded-full">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </Button>
                        </div>
                    )}

                    {payingInvoice && (
                        <div className="p-4 rounded-xl bg-muted/40 border border-border">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-muted-foreground text-xs uppercase font-semibold">Invoice</span>
                                <span className="text-foreground font-mono text-sm">{payingInvoice.invoiceNumber}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground text-xs uppercase font-semibold">Amount</span>
                                <span className="text-foreground font-bold text-xl">{fmtMoney(payingInvoice.totalEtb)}</span>
                            </div>
                        </div>
                    )}

                    <div className="space-y-3">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select Payment Method</Label>
                        <p className="text-xs text-muted-foreground">
                            Disabled methods are not configured on the server. Configure gateways in Super Admin → Payment Configuration.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            {Object.entries(gatewayInfo).map(([id, info]) => {
                                const isEnabled =
                                    id === 'chapa'
                                        ? enabledGateways.chapa
                                        : id === 'telebirr'
                                            ? enabledGateways.telebirr
                                            : id === 'cbe_birr'
                                                ? enabledGateways.cbe_birr
                                                : id === 'bank_transfer'
                                                    ? enabledGateways.bank_transfer
                                                    : false;
                                return (
                                <button
                                    key={id}
                                    onClick={() => isEnabled && setSelectedGateway(id)}
                                    className={cn(
                                        "p-4 rounded-xl border-2 text-left transition-all group relative overflow-hidden",
                                        selectedGateway === id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 bg-muted/20"
                                    , !isEnabled && "opacity-50 cursor-not-allowed")}
                                >
                                    <div className={cn("size-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3 transition-transform group-hover:scale-110", info.gradient)}>
                                        <span className="material-symbols-outlined text-white">{info.icon}</span>
                                    </div>
                                    <h4 className="text-sm font-bold">{info.name}</h4>
                                    {selectedGateway === id && (
                                        <div className="absolute top-3 right-3">
                                            <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                                        </div>
                                    )}
                                </button>
                                );
                            })}
                        </div>
                    </div>

                    {selectedGateway === 'bank_transfer' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bank Details</p>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">{paymentMethods?.bankTransfer?.bankName || 'Commercial Bank of Ethiopia'}</p>
                                    <p className="text-lg font-bold font-mono">{paymentMethods?.bankTransfer?.accountNumber || '1000123456789'}</p>
                                    <p className="text-xs text-muted-foreground uppercase">{paymentMethods?.bankTransfer?.accountName || 'MirachPos Technologies'}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transaction Reference</Label>
                                <Input
                                    value={bankRef}
                                    onChange={(e) => setBankRef(e.target.value)}
                                    placeholder="Enter transaction reference..."
                                    className="h-12 font-mono"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upload Payment Proof</Label>
                                <Input
                                    type="file"
                                    accept="image/*,.pdf"
                                    onChange={(e) => setBankProof(e.target.files?.[0] || null)}
                                    className="h-12"
                                />
                                {bankProof ? (
                                    <p className="text-xs text-muted-foreground">Selected: <span className="font-mono">{bankProof.name}</span></p>
                                ) : null}
                            </div>
                        </div>
                    )}

                    <Button
                        disabled={!selectedGateway || isSubmitting || (selectedGateway === 'bank_transfer' && (!bankRef.trim() || !bankProof))}
                        onClick={executePayment}
                        className="w-full h-12 font-bold text-sm"
                    >
                        {isSubmitting ? (
                            <>
                                <span className="material-symbols-outlined text-[18px] animate-spin mr-2">sync</span>
                                Processing...
                            </>
                        ) : (
                            'Confirm Payment'
                        )}
                    </Button>
                </div>
            </Modal>

            <Modal open={planModalOpen} onClose={() => setPlanModalOpen(false)} title="Change Plan">
                <div className="space-y-5 p-1">
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billing Cycle</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <Button type="button" variant={planDraft.cycle === 'Monthly' ? 'default' : 'outline'} onClick={() => setPlanDraft((p) => ({ ...p, cycle: 'Monthly' }))}>
                                Monthly
                            </Button>
                            <Button type="button" variant={planDraft.cycle === 'Yearly' ? 'default' : 'outline'} onClick={() => setPlanDraft((p) => ({ ...p, cycle: 'Yearly' }))}>
                                Yearly
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Choose Plan</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {plans.map((p) => {
                                const isCurrent = String(p.tier).toLowerCase() === String(planTier).toLowerCase();
                                const isSelected = String(p.tier).toLowerCase() === String(planDraft.tier || '').toLowerCase();
                                const price = planDraft.cycle === 'Yearly' ? Number(p.pricing.yearlyEtb || 0) : Number(p.pricing.monthlyEtb || 0);
                                return (
                                    <button
                                        key={p.tier}
                                        type="button"
                                        onClick={() => !isCurrent && setPlanDraft((prev) => ({ ...prev, tier: p.tier }))}
                                        className={cn(
                                            'p-4 rounded-xl border-2 text-left transition-all relative',
                                            isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 bg-muted/10',
                                            isCurrent && 'opacity-60 cursor-not-allowed'
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-sm font-bold truncate">{p.tier}</h4>
                                                    {isCurrent ? (
                                                        <Badge className="bg-muted text-muted-foreground border-border text-[10px]">Current</Badge>
                                                    ) : null}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {Array.isArray(p.modules) ? `${p.modules.length} modules` : 'Plan'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-extrabold text-foreground">{fmtMoney(price)}</div>
                                                <div className="text-[10px] text-muted-foreground">/{planDraft.cycle === 'Yearly' ? 'year' : 'month'}</div>
                                            </div>
                                        </div>
                                        {isSelected ? (
                                            <div className="absolute top-3 right-3">
                                                <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                                            </div>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                        {!plans.length ? (
                            <div className="text-xs text-muted-foreground">No plans found.</div>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button type="button" variant="ghost" onClick={() => setPlanModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void requestPlanChange()} disabled={planSubmitting}>
                            {planSubmitting ? 'Creating Invoice...' : 'Continue to Payment'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default OwnerBilling;
