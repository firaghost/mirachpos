import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { PortalMenu } from '../../components/PortalMenu';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
const apiBase = (): string => {
  try {
    const envBase = (import.meta as any)?.env?.VITE_API_BASE;
    const s = typeof envBase === 'string' ? envBase.trim() : '';
    if (s) return s.replace(/\/+$/, '');
  } catch {
    // ignore
  }

  // Dev fallback
  return 'http://127.0.0.1:3001';
};

const resolveProofUrl = (u: string): string => {
  const v = String(u || '').trim();
  if (!v) return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('/uploads/')) return `${apiBase()}${v}`;
  return v;
};

type BillingOverview = {
  totalActive: number;
  pendingVerify: number;
  monthlyRevenueEtb: number;
  atRisk: number;
};

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

type PendingPaymentRow = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  tenantId: string;
  tenantName: string;
  method: string;
  amountEtb: number;
  reference: string;
  submittedAt: string;
  proofUrl: string;
  proofFilename: string;
};

const fmtEtb = (n: number) => {
  try {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
};

const fmtDate = (iso: string) => {
  if (!iso) return '';
  return formatDeviceDate(iso) || iso;
};

const fmtDateTime = (iso: string) => {
  if (!iso) return '';
  return formatDeviceDateTime(iso) || iso;
};

const SubscriptionsView: React.FC<{ manualInvoiceTick: number }> = ({ manualInvoiceTick }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overview, setOverview] = useState<BillingOverview>({ totalActive: 0, pendingVerify: 0, monthlyRevenueEtb: 0, atRisk: 0 });
    const [rows, setRows] = useState<BillingRow[]>([]);
    const [pendingPayments, setPendingPayments] = useState<PendingPaymentRow[]>([]);
    const [saving, setSaving] = useState<string | null>(null);
    const [showAtRiskOnly, setShowAtRiskOnly] = useState(false);

    const [q, setQ] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [planFilter, setPlanFilter] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
    const [actionsAnchor, setActionsAnchor] = useState<any>(null);

    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [invoiceTenantId, setInvoiceTenantId] = useState('');
    const [invoiceAmountEtb, setInvoiceAmountEtb] = useState('');
    const [invoiceDueAt, setInvoiceDueAt] = useState('');
    const [invoiceMethod, setInvoiceMethod] = useState('Cash');
    const [invoiceNotes, setInvoiceNotes] = useState('');

    const [editOpen, setEditOpen] = useState(false);
    const [editKind, setEditKind] = useState<'nextbill' | 'grace'>('nextbill');
    const [editTenantId, setEditTenantId] = useState('');
    const [editValue, setEditValue] = useState('');

    const lastManualInvoiceTick = useRef<number>(manualInvoiceTick);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch('/api/superadmin/billing');
            const json = (await res.json().catch(() => null)) as any;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setOverview(json?.overview || { totalActive: 0, pendingVerify: 0, monthlyRevenueEtb: 0, atRisk: 0 });
            setRows(Array.isArray(json?.subscriptions) ? json.subscriptions : []);

            const payRes = await apiFetch('/api/superadmin/payments/pending?limit=50');
            const payJson = (await payRes.json().catch(() => null)) as any;
            if (payRes.ok) {
              const list = Array.isArray(payJson?.pendingPayments) ? payJson.pendingPayments : [];
              const uniq = new Map<string, PendingPaymentRow>();
              for (const x of list) {
                const id = String(x?.paymentId || '').trim();
                if (!id || uniq.has(id)) continue;
                uniq.set(id, {
                  paymentId: id,
                  invoiceId: String(x?.invoiceId || ''),
                  invoiceNumber: String(x?.invoiceNumber || ''),
                  tenantId: String(x?.tenantId || ''),
                  tenantName: String(x?.tenantName || x?.tenantId || ''),
                  method: String(x?.method || ''),
                  amountEtb: Number(x?.amountEtb || 0) || 0,
                  reference: String(x?.reference || ''),
                  submittedAt: String(x?.submittedAt || ''),
                  proofUrl: String(x?.proofUrl || ''),
                  proofFilename: String(x?.proofFilename || ''),
                });
              }
              setPendingPayments(Array.from(uniq.values()));
            } else {
              setPendingPayments([]);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load billing');
            setRows([]);
            setPendingPayments([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        // Open Manual Invoice modal only when the tick increments (not when switching tabs).
        if (manualInvoiceTick > lastManualInvoiceTick.current) {
            setInvoiceOpen(true);
        }
        lastManualInvoiceTick.current = manualInvoiceTick;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manualInvoiceTick]);

    const verify = async (tenantId: string) => {
        if (saving) return;
        setSaving(tenantId);
        setError(null);
        try {
            const res = await apiFetch('/api/superadmin/billing/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId }),
            });
            const json = (await res.json().catch(() => null)) as any;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Verify failed');
        } finally {
            setSaving(null);
        }
    };

    const submitManualInvoice = async () => {
        if (saving) return;
        const tenantId = invoiceTenantId.trim();
        const amountEtb = Number(invoiceAmountEtb);
        if (!tenantId) {
            setError('Tenant ID is required');
            return;
        }
        if (!Number.isFinite(amountEtb) || amountEtb <= 0) {
            setError('Amount must be > 0');
            return;
        }
        setSaving('manual');
        setError(null);
        try {
            const res = await apiFetch('/api/superadmin/billing/manual-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId,
                    amountEtb,
                    dueAt: invoiceDueAt.trim(),
                    method: invoiceMethod.trim() || 'Cash',
                    notes: invoiceNotes.trim(),
                }),
            });
            const json = (await res.json().catch(() => null)) as any;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setInvoiceOpen(false);
            setInvoiceTenantId('');
            setInvoiceAmountEtb('');
            setInvoiceDueAt('');
            setInvoiceMethod('Cash');
            setInvoiceNotes('');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Manual invoice failed');
        } finally {
            setSaving(null);
        }
    };

    const postSet = async (path: string, payload: Record<string, unknown>) => {
        if (saving) return;
        setSaving(payload.tenantId ? String(payload.tenantId) : 'action');
        setError(null);
        try {
            const res = await apiFetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = (await res.json().catch(() => null)) as any;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Action failed');
        } finally {
            setSaving(null);
        }
    };

    const openEdit = (kind: 'nextbill' | 'grace', tenantId: string, initial: string) => {
        setEditKind(kind);
        setEditTenantId(tenantId);
        setEditValue(initial || '');
        setEditOpen(true);
        setOpenActionsFor(null);
    };

    const submitEdit = async () => {
        if (!editTenantId) return;
        if (editKind === 'nextbill') {
            await postSet('/api/superadmin/billing/set-nextbill', { tenantId: editTenantId, nextBillAt: editValue.trim() });
        } else {
            await postSet('/api/superadmin/billing/set-grace', { tenantId: editTenantId, graceEndsAt: editValue.trim() });
        }
        setEditOpen(false);
    };

    const atRiskRows = useMemo(() => {
        const now = Date.now();
        return rows.filter((r) => {
            if (!r.graceEndsAt) return false;
            const ms = new Date(r.graceEndsAt).getTime() - now;
            return ms > 0 && ms <= 24 * 60 * 60 * 1000;
        });
    }, [rows]);

    const visibleRows = useMemo(() => {
        let base = rows;
        if (showAtRiskOnly) {
          const atRiskIds = new Set(atRiskRows.map((r) => r.tenantId));
          base = base.filter((r) => atRiskIds.has(r.tenantId));
        }
        const query = q.trim().toLowerCase();
        if (query) {
          base = base.filter((r) => {
            const name = String(r.tenantName || '').toLowerCase();
            const id = String(r.tenantId || '').toLowerCase();
            return name.includes(query) || id.includes(query);
          });
        }
        if (statusFilter) {
          const s = statusFilter.toLowerCase();
          base = base.filter((r) => String(r.status || '').toLowerCase() === s);
        }
        if (planFilter) {
          const p = planFilter.toLowerCase();
          base = base.filter((r) => String(r.cycle || '').toLowerCase() === p);
        }
        return base;
    }, [atRiskRows, planFilter, q, rows, showAtRiskOnly, statusFilter]);

    useEffect(() => {
      setPage(1);
    }, [q, statusFilter, planFilter, showAtRiskOnly]);

    const pendingQueue = useMemo(() => {
      const uniq = new Map<string, PendingPaymentRow>();
      for (const p of pendingPayments) {
        const id = String(p.paymentId || '').trim();
        if (!id || uniq.has(id)) continue;
        uniq.set(id, p);
      }
      return Array.from(uniq.values());
    }, [pendingPayments]);

    const verifyPendingPayment = async (p: PendingPaymentRow) => {
      if (!p.invoiceId || !p.paymentId) return;
      if (saving) return;
      setSaving(p.paymentId);
      setError(null);
      try {
        const res = await apiFetch(`/api/superadmin/invoices/${encodeURIComponent(p.invoiceId)}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: p.paymentId, method: p.method || 'Cash' }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Verify failed');
      } finally {
        setSaving(null);
      }
    };

    const rejectPendingPayment = async (p: PendingPaymentRow) => {
      if (!p.paymentId) return;
      if (saving) return;
      setSaving(p.paymentId);
      setError(null);
      try {
        const res = await apiFetch(`/api/superadmin/payments/${encodeURIComponent(p.paymentId)}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Rejected by admin' }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setSaving(null);
      }
    };

    const totalPages = Math.max(1, Math.ceil(visibleRows.length / Math.max(1, pageSize)));
    const safePage = Math.min(totalPages, Math.max(1, page));
    const pagedRows = useMemo(() => {
      const start = (safePage - 1) * pageSize;
      return visibleRows.slice(start, start + pageSize);
    }, [pageSize, safePage, visibleRows]);

    const showingFrom = visibleRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const showingTo = Math.min(visibleRows.length, safePage * pageSize);

    const badgeForLifecycle = (r: BillingRow) => {
      const s = String(r.status || '').toLowerCase();
      if (s === 'active') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-green-500/20 bg-green-500/10 text-green-400 text-xs font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Active
          </span>
        );
      }
      if (s === 'verification needed' || s === 'verification_needed') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wide">
            <AppIcon name="pending" className="text-[14px]" size={14} />
            Pending
          </span>
        );
      }
      if (s === 'past due' || s === 'past_due') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-warning/30 bg-warning/10 text-warning text-xs font-bold uppercase tracking-wide">
            <AppIcon name="warning" className="text-[14px]" size={14} />
            Grace Period
          </span>
        );
      }
      if (s === 'suspended') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wide">
            <AppIcon name="lock" className="text-[14px]" size={14} />
            Suspended
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/40 text-muted-foreground text-xs font-bold uppercase tracking-wide">
          {r.status || 'Unknown'}
        </span>
      );
    };

    const toggleActions = (tenantId: string, ev?: React.MouseEvent) => {
        const next = openActionsFor === tenantId ? null : tenantId;
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

    return (
    <div className="flex flex-col gap-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden group hover:border-accent transition-colors">
                <div className="flex justify-between items-start z-10">
                    <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Monthly Revenue (MRR)</span>
                    <AppIcon name="payments" className="text-primary/80" />
                </div>
                <div className="flex items-baseline gap-1 z-10">
                    <span className="text-muted-foreground text-sm font-medium">ETB</span>
                    <span className="text-2xl font-bold text-foreground">{fmtEtb(overview.monthlyRevenueEtb || 0)}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-green-400 z-10">
                    <AppIcon name="trending_up" className="text-[14px]" size={14} />
                    <span>+0.0% vs last month</span>
                </div>
                <div className="absolute -right-6 -top-6 w-20 h-20 bg-primary/5 rounded-full group-hover:bg-primary/10 transition-colors"></div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden hover:border-accent transition-colors">
                <div className="flex justify-between items-start z-10">
                    <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Pending Validations</span>
                    <AppIcon name="pending" className="text-warning" />
                </div>
                <div className="flex items-center gap-2 z-10">
                    <span className="text-2xl font-bold text-foreground">{overview.pendingVerify || 0}</span>
                    <span className="px-2 py-0.5 rounded-full bg-warning/20 border border-warning/30 text-warning text-[10px] font-bold uppercase">Action Required</span>
                </div>
                <div className="text-xs text-muted-foreground z-10">Total Value: ETB {fmtEtb(overview.monthlyRevenueEtb || 0)}</div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden hover:border-accent transition-colors">
                <div className="flex justify-between items-start z-10">
                    <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">At Risk (Grace Period)</span>
                    <AppIcon name="warning" className="text-red-400" />
                </div>
                <div className="flex items-center gap-2 z-10">
                    <span className="text-2xl font-bold text-foreground">{overview.atRisk || 0}</span>
                    <span className="text-xs text-muted-foreground">Accounts</span>
                </div>
                <div className="text-xs text-red-300 z-10 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    0 Suspensions imminent
                </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden hover:border-accent transition-colors">
                <div className="flex justify-between items-start z-10">
                    <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Active Subscriptions</span>
                    <AppIcon name="groups" className="text-muted-foreground" />
                </div>
                <span className="text-2xl font-bold text-foreground z-10">{overview.totalActive || 0}</span>
                <div className="w-full bg-black/30 h-1.5 rounded-full mt-auto z-10">
                    <div className="bg-primary h-full rounded-full" style={{ width: '88%' }} />
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5 z-10">88% Paid on time</span>
            </div>
        </div>

        {atRiskRows.length > 0 ? (
          <div className="flex items-center gap-4 p-4 rounded bg-red-900/10 border border-red-900/50 backdrop-blur-sm">
              <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
                  <AppIcon name="report" className="text-red-500" />
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between w-full gap-4">
                  <div>
                      <h3 className="text-red-200 text-sm font-bold uppercase tracking-wider">Suspension Warning</h3>
                      <p className="text-muted-foreground text-sm mt-1">
                        {atRiskRows.length} Cafes have exceeded their grace period limit. Platform access may be revoked soon.
                      </p>
                  </div>
                  <button
                    onClick={() => setShowAtRiskOnly(true)}
                    className="px-4 py-2 bg-red-900/40 border border-red-700/50 hover:bg-red-900/60 text-red-200 text-xs font-bold uppercase tracking-wider rounded transition-colors whitespace-nowrap"
                    type="button"
                  >
                    Review Suspensions
                  </button>
              </div>
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
                <div className="flex flex-col gap-1">
                    <h2 className="text-foreground text-lg font-bold">Manual Payment Verification Queue</h2>
                    <p className="text-muted-foreground text-sm">Review bank transfers (CBE) and manual cash payments requiring admin approval.</p>
                </div>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-muted/40 border-b border-border text-xs uppercase text-muted-foreground font-bold tracking-wider">
                            <th className="p-4 w-1/4">Originating Cafe</th>
                            <th className="p-4">Reference / Transaction ID</th>
                            <th className="p-4">Amount</th>
                            <th className="p-4">Date Submitted</th>
                            <th className="p-4">Proof</th>
                            <th className="p-4 text-right">Decision</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-sm">
                        {pendingQueue.length === 0 ? (
                          <tr>
                            <td className="p-4 text-muted-foreground" colSpan={6}>No pending payments.</td>
                          </tr>
                        ) : null}
                        {pendingQueue.map((r) => {
                          const initials = (r.tenantName || 'T').split(' ').slice(0, 2).map((x) => x.slice(0, 1).toUpperCase()).join('') || 'T';
                          const ref = String(r.reference || '').trim();
                          const proofName = String(r.proofFilename || '').trim() || (String(r.proofUrl || '').trim() ? 'Attachment' : '');
                          return (
                            <tr key={r.paymentId} className="hover:bg-muted/40 transition-colors group">
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold text-xs border border-primary/20">{initials}</div>
                                  <div>
                                    <p className="text-foreground font-semibold">{r.tenantName}</p>
                                    <p className="text-muted-foreground text-xs">ID: {r.tenantId}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex flex-col">
                                  <span className="text-foreground font-mono">{ref || r.invoiceNumber || r.invoiceId || '-'}</span>
                                  <span className="text-muted-foreground text-xs">{r.method || 'Manual'}</span>
                                </div>
                              </td>
                              <td className="p-4 text-foreground font-bold font-mono">ETB {(Number(r.amountEtb || 0) || 0).toFixed(2)}</td>
                              <td className="p-4 text-muted-foreground">{r.submittedAt ? fmtDateTime(r.submittedAt) : '—'}</td>
                              <td className="p-4">
                                {r.proofUrl ? (
                                  <a
                                    className="flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                                    href={resolveProofUrl(r.proofUrl)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <AppIcon name="attachment" className="text-[16px]" size={16} />
                                    {proofName || 'Attachment'}
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground text-xs italic">No attachment</span>
                                )}
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    className="p-2 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                                    title="Reject"
                                    type="button"
                                    onClick={() => rejectPendingPayment(r)}
                                    disabled={saving === r.paymentId}
                                  >
                                    <AppIcon name="close" className="text-[20px]" size={20} />
                                  </button>
                                  <button
                                    className="px-3 py-1.5 rounded bg-primary/10 border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground font-bold text-xs transition-colors uppercase tracking-wide disabled:opacity-60"
                                    type="button"
                                    disabled={saving === r.paymentId}
                                    onClick={() => verifyPendingPayment(r)}
                                  >
                                    {saving === r.paymentId ? 'Verifying...' : 'Verify Payment'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                </table>
                <div className="bg-muted/40 p-2 border-t border-border text-center">
                    <button
                      className="text-xs text-muted-foreground hover:text-primary font-medium flex items-center justify-center gap-1 w-full py-1"
                      type="button"
                    >
                      View all pending ({pendingQueue.length})
                      <AppIcon name="expand_more" className="text-[14px]" size={14} />
                    </button>
                </div>
            </div>
        </section>

        <section className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row justify-between items-end lg:items-center gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-foreground text-lg font-bold">Subscription Management</h2>
                    <p className="text-muted-foreground text-sm">Detailed billing status for all tenant cafes.</p>
                </div>
                <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                    <div className="relative group grow lg:grow-0">
                        <AppIcon name="search" className="absolute left-3 top-2.5 text-muted-foreground" />
                        <input
                          value={q}
                          onChange={(e) => setQ(e.target.value)}
                          className="pl-10 pr-4 py-2 bg-card border border-border rounded text-sm text-foreground focus:ring-2 focus:ring-primary/30 focus:border-border placeholder:text-muted-foreground w-full lg:w-64"
                          placeholder="Search Tenant ID or Name..."
                          type="text"
                        />
                    </div>
                    <div className="h-9 w-px bg-border mx-2 hidden lg:block" />
                    <select
                      value={statusFilter || 'all'}
                      onChange={(e) => setStatusFilter(e.target.value === 'all' ? '' : e.target.value)}
                      className="bg-card border border-border text-foreground text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer hover:bg-accent"
                    >
                      <option value="all">Status: All</option>
                      <option value="Active">Active</option>
                      <option value="Past Due">Grace Period</option>
                      <option value="Suspended">Suspended</option>
                      <option value="Verification Needed">Pending</option>
                    </select>
                    <select
                      value={planFilter || 'all'}
                      onChange={(e) => setPlanFilter(e.target.value === 'all' ? '' : e.target.value)}
                      className="bg-card border border-border text-foreground text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer hover:bg-accent"
                    >
                      <option value="all">Plan: All</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-xl shadow-black/20">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-muted/40 border-b border-border text-xs uppercase text-muted-foreground font-bold tracking-wider">
                                <th className="p-5">Cafe &amp; Tenant Info</th>
                                <th className="p-5">Current Plan</th>
                                <th className="p-5">Lifecycle Status</th>
                                <th className="p-5 text-right">Billing (ETB)</th>
                                <th className="p-5">Next Bill Date</th>
                                <th className="p-5">Method</th>
                                <th className="p-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-sm">
                            {pagedRows.length === 0 && !loading ? (
                                <tr>
                                    <td className="p-5 text-muted-foreground" colSpan={7}>No subscription records yet.</td>
                                </tr>
                            ) : null}

                            {pagedRows.map((r) => {
                                const initials = (r.tenantName || 'T').split(' ').slice(0, 2).map((x) => x.slice(0, 1).toUpperCase()).join('') || 'T';
                                const verifyNeeded = String(r.status) === 'Verification Needed';
                                return (
                                    <tr key={r.tenantId} className={
                                      verifyNeeded
                                        ? 'bg-warning/5 border-l-2 border-l-warning hover:bg-warning/10 transition-colors'
                                        : 'hover:bg-muted/40 transition-colors'
                                    }>
                                        <td className="p-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-muted/40 flex items-center justify-center text-muted-foreground font-bold border border-border">{initials}</div>
                                                <div>
                                                    <p className="text-foreground font-bold text-base">{r.tenantName}</p>
                                                    <p className="text-muted-foreground text-xs">ID: {r.tenantId}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-foreground font-medium">{r.plan || 'Trial'}</span>
                                                <span className="text-muted-foreground text-xs">{r.cycle || 'Monthly'} Cycle</span>
                                            </div>
                                        </td>
                                        <td className="p-5">{badgeForLifecycle(r)}</td>
                                        <td className="p-5 text-right font-mono text-foreground">{(Number(r.amountEtb || 0) || 0).toFixed(2)}</td>
                                        <td className={"p-5 " + (verifyNeeded ? 'text-red-300 font-bold' : 'text-foreground')}>
                                            {r.nextBillAt ? fmtDate(r.nextBillAt) : '--'}
                                            <div className="text-muted-foreground text-xs mt-0.5">{verifyNeeded ? 'Payment Failed' : 'Autopay On'}</div>
                                        </td>
                                        <td className="p-5 text-muted-foreground text-xs">
                                            <div className="flex items-center gap-2">
                                                <AppIcon name="payments" className="text-[18px]" size={18} />
                                                {r.method || 'Manual'}
                                            </div>
                                        </td>
                                        <td className="p-5 text-right">
                                            {verifyNeeded ? (
                                              <div className="flex justify-end gap-2">
                                                <button
                                                  className="px-3 py-1 text-xs font-bold text-muted-foreground hover:text-foreground border border-transparent hover:border-border rounded transition-colors"
                                                  type="button"
                                                  onClick={() => openEdit('grace', r.tenantId, r.graceEndsAt || '')}
                                                >
                                                  Extend
                                                </button>
                                                <button
                                                  className="px-3 py-1 text-xs font-bold bg-warning/20 text-warning hover:bg-warning hover:text-black rounded transition-colors uppercase"
                                                  type="button"
                                                  onClick={() => verify(r.tenantId)}
                                                  disabled={saving === r.tenantId}
                                                >
                                                  {saving === r.tenantId ? '...' : 'Invoice'}
                                                </button>
                                              </div>
                                            ) : (
                                              <button
                                                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                                                type="button"
                                                onClick={(ev) => toggleActions(r.tenantId, ev)}
                                              >
                                                <AppIcon name="more_horiz" />
                                              </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center justify-between p-4 border-t border-border bg-muted/40">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Rows per page:</span>
                        <select
                          value={String(pageSize)}
                          onChange={(e) => setPageSize(Math.max(1, Number(e.target.value) || 10))}
                          className="bg-card border border-border text-xs text-foreground rounded px-2 py-1 outline-none cursor-pointer"
                        >
                          <option value="10">10</option>
                          <option value="20">20</option>
                          <option value="50">50</option>
                        </select>
                        <span className="text-xs text-muted-foreground ml-2">Showing {showingFrom}-{showingTo} of {visibleRows.length}</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                          className="px-3 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                          disabled={safePage <= 1}
                          type="button"
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </button>
                        <button
                          className="px-3 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                          disabled={safePage >= totalPages}
                          type="button"
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </button>
                    </div>
                </div>
            </div>
        </section>

        {invoiceOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-[520px] rounded-xl border border-border bg-card overflow-hidden shadow-2xl">
                    <div className="p-5 border-b border-border bg-muted/40 flex items-center justify-between">
                        <div className="text-foreground font-bold">Manual Invoice</div>
                        <button
                            onClick={() => setInvoiceOpen(false)}
                            className="text-muted-foreground hover:text-foreground"
                            type="button"
                        >
                            <AppIcon name="close" />
                        </button>
                    </div>
                    <div className="p-5 space-y-4">
                        <div className="flex flex-col gap-2">
                            <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Tenant</div>
                            <select
                                value={invoiceTenantId}
                                onChange={(e) => setInvoiceTenantId(e.target.value)}
                                className="w-full bg-card border border-border rounded-lg py-2 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                <option value="">Select tenant </option>
                                {rows.map((r) => (
                                    <option key={r.tenantId} value={r.tenantId}>{r.tenantName} ({r.tenantId})</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Amount (ETB)</div>
                                <input
                                    value={invoiceAmountEtb}
                                    onChange={(e) => setInvoiceAmountEtb(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg py-2 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    placeholder="e.g. 1500"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Method</div>
                                <input
                                    value={invoiceMethod}
                                    onChange={(e) => setInvoiceMethod(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg py-2 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    placeholder="Cash / Bank Transfer"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Due At (ISO, optional)</div>
                            <input
                                value={invoiceDueAt}
                                onChange={(e) => setInvoiceDueAt(e.target.value)}
                                className="w-full bg-card border border-border rounded-lg py-2 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                placeholder="2025-01-01T00:00:00.000Z"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Notes (optional)</div>
                            <textarea
                                value={invoiceNotes}
                                onChange={(e) => setInvoiceNotes(e.target.value)}
                                className="w-full bg-card border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none h-20"
                                placeholder="Internal note for this invoice"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setInvoiceOpen(false)}
                                className="px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-bold hover:text-foreground hover:bg-accent"
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitManualInvoice}
                                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
                                type="button"
                                disabled={saving === 'manual'}
                            >
                                {saving === 'manual' ? 'Creating ' : 'Create Invoice'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        ) : null}

        {editOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-[520px] rounded-xl border border-border bg-card overflow-hidden shadow-2xl">
                    <div className="p-5 border-b border-border bg-muted/40 flex items-center justify-between">
                        <div className="text-foreground font-bold">{editKind === 'nextbill' ? 'Set Next Bill' : 'Set Grace Ends'}</div>
                        <button
                            onClick={() => setEditOpen(false)}
                            className="text-muted-foreground hover:text-foreground"
                            type="button"
                        >
                            <AppIcon name="close" />
                        </button>
                    </div>
                    <div className="p-5 space-y-4">
                        <div className="text-xs text-muted-foreground">Tenant: <span className="text-foreground font-mono">{editTenantId}</span></div>
                        <input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full bg-card border border-border rounded-lg py-2 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder={editKind === 'nextbill' ? '2025-01-01T00:00:00.000Z' : '2025-01-01T00:00:00.000Z'}
                        />
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setEditOpen(false)}
                                className="px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm font-bold hover:text-foreground hover:bg-accent"
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitEdit}
                                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
                                type="button"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        ) : null}

        {error ? (
            <div className="mb-6 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        <PortalMenu
          open={Boolean(openActionsFor) && Boolean(actionsAnchor)}
          anchorRect={actionsAnchor}
          onClose={() => {
            setOpenActionsFor(null);
            setActionsAnchor(null);
          }}
          width={224}
        >
          {(() => {
            const r = visibleRows.find((x) => x.tenantId === openActionsFor) as any;
            if (!r) return null;
            return (
              <>
                <button
                  onClick={() => {
                    setInvoiceOpen(true);
                    setInvoiceTenantId(r.tenantId);
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent"
                  type="button"
                >
                  Manual Invoice
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-status', { tenantId: r.tenantId, status: 'Verification Needed' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Mark Verification Needed
                </button>
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-status', { tenantId: r.tenantId, status: 'Active' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Mark Active
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-cycle', { tenantId: r.tenantId, cycle: 'Monthly' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Cycle: Monthly
                </button>
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-cycle', { tenantId: r.tenantId, cycle: 'Yearly' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Cycle: Yearly
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-method', { tenantId: r.tenantId, method: 'Cash' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Method: Cash
                </button>
                <button
                  onClick={() => {
                    postSet('/api/superadmin/billing/set-method', { tenantId: r.tenantId, method: 'Bank Transfer' });
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Method: Bank Transfer
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={() => {
                    openEdit('nextbill', r.tenantId, r.nextBillAt);
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Next Bill
                </button>
                <button
                  onClick={() => {
                    openEdit('grace', r.tenantId, r.graceEndsAt || '');
                    setOpenActionsFor(null);
                    setActionsAnchor(null);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                  type="button"
                >
                  Set Grace Ends
                </button>
              </>
            );
          })()}
        </PortalMenu>
    </div>
);
};

const PlansMatrixView = () => {
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
                    { label: 'Kitchen Display (KDS)', trial: ' ”', basic: ' ”', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Discounts & Promotions', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Multi-Branch Management', trial: ' ”', basic: ' ”', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                ],
            },
            {
                title: 'Integrations & API',
                icon: 'hub',
                rows: [
                    { label: 'Public API', trial: 'Limited', basic: 'Limited', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Webhooks', trial: ' ”', basic: ' ”', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Custom Domain', trial: ' ”', basic: ' ”', pro: ' ”', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Custom Integrations', trial: ' ”', basic: ' ”', pro: ' ”', ent: 'Included', entIcon: 'check_circle' },
                ],
            },
            {
                title: 'Support & Security',
                icon: 'support_agent',
                rows: [
                    { label: 'Email Support', trial: 'Included', basic: 'Included', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Priority Support', trial: ' ”', basic: ' ”', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Dedicated Account Manager', trial: ' ”', basic: ' ”', pro: ' ”', ent: 'Included', entIcon: 'check_circle' },
                    { label: 'Audit Log', trial: ' ”', basic: ' ”', pro: 'Included', ent: 'Included', entIcon: 'check_circle' },
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
        const isDash = v === ' ”' || v === '';
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
        if (isDash) return <span className="text-muted-foreground"> ”</span>;
        return <span className={highlight ? 'text-primary font-bold text-lg' : 'text-foreground font-bold text-lg'}>{v}</span>;
    };
    return (
    <div className="flex flex-col">
        {editOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60" onClick={() => (editSaving ? null : setEditOpen(false))} />
                <div className="relative w-full max-w-[720px] rounded-xl border border-border bg-card shadow-2xl">
                    <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
                        <div className="text-foreground font-black text-lg">Edit Plan: {editTier || ' ”'}</div>
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
                                className="h-11 rounded-lg border border-border bg-card px-3 text-foreground text-sm"
                                disabled={editSaving}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Yearly Price (ETB)</label>
                            <input
                                value={editYearly}
                                onChange={(e) => setEditYearly(e.target.value)}
                                className="h-11 rounded-lg border border-border bg-card px-3 text-foreground text-sm"
                                disabled={editSaving}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Branch Limit</label>
                            <input
                                value={editBranchLimit}
                                onChange={(e) => setEditBranchLimit(e.target.value)}
                                className="h-11 rounded-lg border border-border bg-card px-3 text-foreground text-sm"
                                disabled={editSaving}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Staff Limit</label>
                            <input
                                value={editStaffLimit}
                                onChange={(e) => setEditStaffLimit(e.target.value)}
                                className="h-11 rounded-lg border border-border bg-card px-3 text-foreground text-sm"
                                disabled={editSaving}
                            />
                        </div>
                        <div className="flex flex-col gap-2 md:col-span-2">
                            <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Modules (comma-separated)</label>
                            <textarea
                                value={editModules}
                                onChange={(e) => setEditModules(e.target.value)}
                                className="min-h-[92px] rounded-lg border border-border bg-card px-3 py-2 text-foreground text-sm"
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
                            {editSaving ? 'Saving ' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        ) : null}

        <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-muted-foreground">
                {plansLoading ? 'Loading plans ' : planRow ? `Plan source: MySQL (${String(planRow.tier)})` : 'Plan source: MySQL'}
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
                    <option value="">Select cafe </option>
                    {tenants.map((t) => (
                        <option key={t.tenantId} value={t.tenantId}>
                            {t.tenantName}  ” {t.plan} ({t.cycle})
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground items-center">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary"></span><span>Warning Threshold</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Limit Reached</span></div>
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
                            <th className={"p-6 min-w-[260px] " + 'bg-muted/40'}>
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
                                        Limits: {limitValue.branchLimit ? `Branches ${limitValue.branchLimit}` : 'Branches  ”'}    {limitValue.staffLimit ? `Staff ${limitValue.staffLimit}` : 'Staff  ”'}
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
                                        <td className={"p-6 align-top bg-muted/40"}>
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
                        {/* More rows would go here similar to the HTML */}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
);
};

export const SA_Billing: React.FC = () => {
  const [manualInvoiceTick, setManualInvoiceTick] = useState(0);

  const exportLedger = async () => {
    try {
      const res = await apiFetch('/api/superadmin/invoices?limit=200');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const invoices = Array.isArray(json?.invoices) ? json.invoices : [];
      const header = ['invoiceNumber', 'tenantId', 'tenantName', 'status', 'amountEtb', 'issueDate', 'dueDate', 'paidAt'];
      const lines = [header.join(',')].concat(
        invoices.map((i: any) => header.map((k) => JSON.stringify(i?.[k] ?? '')).join(',')),
      );
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mirachpos_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const manualInvoice = async () => {
    // Trigger SubscriptionsView prompt + backend call by bumping tick.
    setManualInvoiceTick((x) => x + 1);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1600px] mx-auto flex flex-col">
          <div className="bg-muted/40 border-b border-border px-8 py-5 flex flex-col gap-6 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Platform</span>
                  <span className="text-primary">•</span>
                  <span>Financials</span>
                </div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Billing &amp; Subscriptions</h1>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={exportLedger}
                  className="flex items-center gap-2 px-4 py-2 rounded border border-border bg-transparent text-muted-foreground text-sm font-medium hover:text-foreground hover:bg-accent transition-colors"
                  type="button"
                >
                  <AppIcon name="download" className="text-[18px]" size={18} />
                  Export Ledger
                </button>
                <button
                  onClick={manualInvoice}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors shadow-[0_0_20px_rgba(238,173,43,0.2)]"
                  type="button"
                >
                  <AppIcon name="add" className="text-[18px]" size={18} />
                  New Invoice
                </button>
              </div>
            </div>
          </div>

          <div className="p-8">
            <SubscriptionsView manualInvoiceTick={manualInvoiceTick} />
          </div>
        </div>
      </div>
    </div>
  );
};
