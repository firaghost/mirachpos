import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Header } from '../components/Header';
import { apiFetch } from '../api';
import { readSession } from '../session';
import { formatDeviceDate, formatDeviceDateTime, formatDeviceTime } from '../datetime';

type RangeKey = 'Today' | 'Yesterday' | '7 Days' | 'This Month';

type CashSession = {
  id: string;
  register: string;
  staffName: string;
  staffRole: string;
  openingCash: number;
  expectedCash: number;
  actualCash?: number;
  status: 'Active' | 'Closed' | 'Audit';
  openedAt: string;
  closedAt?: string;
};

type Expense = {
  id: string;
  category: string;
  title: string;
  vendor: string;
  amount: number;
  createdAt: string;
  icon: 'local_shipping' | 'build' | 'sanitizer' | 'receipt_long';
};

type PaymentTx = {
  id: string;
  total: number;
  tax: number;
  tip: number;
  discount: number;
  discountPct?: number;
  items?: Array<{ productId: string; name: string; qty: number; unitPrice: number }>;
  createdAt: string | null;
  paidAt: string | null;
  method: string;
  reference: string;
  tenderedAmount: number | null;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const startOfMonth = (d: Date) => {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
};

const addMonths = (d: Date, months: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
};

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const formatMoney = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  return `ETB ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtN = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatTime12 = (iso: string) => {
  return formatDeviceTime(iso, { hour: '2-digit', minute: '2-digit' });
};

const formatDateLabel = (d: Date) => formatDeviceDate(d, { month: 'short', day: '2-digit', year: 'numeric' });

export const Finance: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('Today');
  const [tab, setTab] = useState<'Cash Sessions' | 'Expenses'>('Cash Sessions');
  const [query, setQuery] = useState('');
  const [expenseEditingId, setExpenseEditingId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<{ category: string; title: string; vendor: string; amount: string }>({ category: 'Expense', title: '', vendor: '', amount: '' });
  const [expenseCreateOpen, setExpenseCreateOpen] = useState(false);
  const [expenseCreateDraft, setExpenseCreateDraft] = useState<{ category: string; title: string; vendor: string; amount: string; icon: Expense['icon'] }>(() => ({
    category: 'Expense',
    title: '',
    vendor: '',
    amount: '',
    icon: 'receipt_long',
  }));
  const [sessionEditingId, setSessionEditingId] = useState<string | null>(null);
  const [sessionCreateOpen, setSessionCreateOpen] = useState(false);
  const [sessionCreateDraft, setSessionCreateDraft] = useState<{ register: string; openingCash: string }>(() => ({ register: 'POS', openingCash: '' }));
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Closed' | 'Audit'>('All');
  const [registerFilter, setRegisterFilter] = useState<string>('All');
  const [staffFilter, setStaffFilter] = useState<string>('All');
  const [flash, setFlash] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);

  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<PaymentTx[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const resolveBranchId = () => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      const tokenBranchId = String(s?.branchId || '').trim();
      if (role !== 'Cafe Owner') return '';
      if (tokenBranchId && tokenBranchId !== 'global') return tokenBranchId;
    } catch {
      // ignore
    }
    try {
      const raw = String(localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '').trim();
      if (raw && raw !== 'global') return raw;
    } catch {
      // ignore
    }
    return '';
  };

  const updateCashSession = async (id: string, patch: Partial<CashSession>) => {
    const bid = resolveBranchId();
    const qs = new URLSearchParams();
    if (bid) qs.set('branchId', bid);
    const res = await apiFetch(`/api/manager/finance/cash-sessions/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  };

  const fetchFinanceRemote = async (rangeOverride?: RangeKey) => {
    const r = rangeOverride || range;
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = startOfMonth(now);
    const start =
      r === 'Today'
        ? todayStart
        : r === 'Yesterday'
          ? addDays(todayStart, -1)
          : r === 'This Month'
            ? monthStart
            : r === 'Last Month'
              ? addMonths(monthStart, -1)
              : addDays(todayStart, -6);
    const endExclusive =
      r === 'Yesterday'
        ? todayStart
        : r === 'This Month'
          ? addMonths(monthStart, 1)
          : r === 'Last Month'
            ? monthStart
            : addDays(todayStart, 1);
    const toInclusiveIso = new Date(endExclusive.getTime() - 1).toISOString();
    const fromIso = `${isoDate(start)}T00:00:00.000Z`;
    const bid = resolveBranchId();

    const qs = new URLSearchParams({ limit: '200', from: fromIso, to: toInclusiveIso });
    if (bid) qs.set('branchId', bid);

    const payQs = new URLSearchParams({ from: start.toISOString(), to: endExclusive.toISOString(), limit: '500' });
    if (bid) payQs.set('branchId', bid);

    const [csRes, exRes, payRes] = await Promise.all([
      apiFetch(`/api/manager/finance/cash-sessions?${qs.toString()}`),
      apiFetch(`/api/manager/finance/expenses?${qs.toString()}`),
      apiFetch(`/api/manager/payments?${payQs.toString()}`),
    ]);

    const csJson = (await csRes.json().catch(() => null)) as any;
    const exJson = (await exRes.json().catch(() => null)) as any;
    const payJson = (await payRes.json().catch(() => null)) as any;

    if (!csRes.ok) throw new Error(csJson?.error || `HTTP ${csRes.status}`);
    if (!exRes.ok) throw new Error(exJson?.error || `HTTP ${exRes.status}`);
    if (!payRes.ok) throw new Error(payJson?.error || `HTTP ${payRes.status}`);

    const nextCashSessions = Array.isArray(csJson?.cashSessions) ? (csJson.cashSessions as CashSession[]) : [];
    const nextExpenses: Expense[] = Array.isArray(exJson?.expenses)
      ? (exJson.expenses as any[])
          .map((e) => ({
            id: String(e?.id || ''),
            category: String(e?.category || 'Expense'),
            title: String(e?.title || ''),
            vendor: String(e?.vendor || ''),
            amount: Number(e?.amount ?? 0) || 0,
            createdAt: String(e?.createdAt || ''),
            icon: (String(e?.icon || 'receipt_long') as any) || 'receipt_long',
          }))
          .filter((e) => e.id)
      : [];
    const rows = Array.isArray(payJson?.payments) ? (payJson.payments as any[]) : [];
    const nextPayments: PaymentTx[] = rows
      .map((p) => ({
        id: String(p.id || ''),
        total: Number(p.total ?? 0) || 0,
        tax: Number(p.tax ?? 0) || 0,
        tip: Number(p.tip ?? 0) || 0,
        discount: Number(p.discount ?? 0) || 0,
        discountPct: p.discountPct == null ? undefined : Number(p.discountPct ?? 0) || 0,
        orderType: typeof p.orderType === 'string' ? p.orderType : undefined,
        takeawayFee: p.takeawayFee == null ? undefined : Number(p.takeawayFee ?? 0) || 0,
        items: Array.isArray((p as any)?.items)
          ? ((p as any).items as any[])
              .map((it) => ({
                productId: String((it as any)?.productId || ''),
                name: String((it as any)?.name || ''),
                qty: Number((it as any)?.qty ?? 0) || 0,
                unitPrice: Number((it as any)?.unitPrice ?? 0) || 0,
              }))
              .filter((it) => (it.productId || it.name) && Number.isFinite(it.qty) && it.qty > 0 && Number.isFinite(it.unitPrice) && it.unitPrice >= 0)
          : undefined,
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
        paidAt: typeof p.paidAt === 'string' ? p.paidAt : null,
        method: String(p.method || 'Unknown'),
        reference: String(p.reference || ''),
        tenderedAmount: p.tenderedAmount == null ? null : Number(p.tenderedAmount || 0) || 0,
      }))
      .filter((x) => x.id);

    return { start, end: endExclusive, cashSessions: nextCashSessions, expenses: nextExpenses, payments: nextPayments };
  };

  const loadRemote = async (rangeOverride?: RangeKey) => {
    try {
      setLoadingRemote(true);
      setRemoteError(null);
      const out = await fetchFinanceRemote(rangeOverride);
      setCashSessions(out.cashSessions);
      setExpenses(out.expenses);
      setPayments(out.payments);
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : 'Failed to load finance.');
      setCashSessions([]);
      setExpenses([]);
      setPayments([]);
    } finally {
      setLoadingRemote(false);
    }
  };

  useEffect(() => {
    void loadRemote(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(t);
  }, [flash]);

  const rangeWindow = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    if (range === 'Today') return { start: todayStart, end: addDays(todayStart, 1) };
    if (range === 'Yesterday') return { start: addDays(todayStart, -1), end: todayStart };
    if (range === 'This Month') {
      const m0 = startOfMonth(now);
      return { start: m0, end: addMonths(m0, 1) };
    }
    if (range === 'Last Month') {
      const m0 = startOfMonth(now);
      return { start: addMonths(m0, -1), end: m0 };
    }
    return { start: addDays(todayStart, -6), end: addDays(todayStart, 1) };
  }, [range]);

  const totalRevenue = useMemo(() => payments.reduce((s, p) => s + (p.total ?? 0), 0), [payments]);

  const paymentBreakdown = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>();
    for (const p of payments) {
      const key = p.method || 'Unknown';
      const cur = m.get(key) ?? { sum: 0, count: 0 };
      cur.sum += p.total ?? 0;
      cur.count += 1;
      m.set(key, cur);
    }
    return Array.from(m.entries());
  }, [payments]);

  const totalExpenses = useMemo(() => {
    const startMs = rangeWindow.start.getTime();
    const endMs = rangeWindow.end.getTime();
    return expenses
      .filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= startMs && t < endMs;
      })
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses, rangeWindow.end, rangeWindow.start]);

  const netProfit = useMemo(() => totalRevenue - totalExpenses, [totalExpenses, totalRevenue]);

  const openSessions = useMemo(() => cashSessions.filter((s) => s.status === 'Active'), [cashSessions]);

  const discrepancyTotal = useMemo(() => {
    return cashSessions.reduce((sum, s) => {
      if (s.status === 'Active') return sum;
      const actual = typeof s.actualCash === 'number' ? s.actualCash : s.expectedCash;
      return sum + (actual - s.expectedCash);
    }, 0);
  }, [cashSessions]);

  const netCashInHand = useMemo(() => {
    const openExpected = openSessions.reduce((sum, s) => sum + (s.expectedCash ?? 0), 0);
    const closedActual = cashSessions
      .filter((s) => s.status !== 'Active')
      .reduce((sum, s) => sum + (typeof s.actualCash === 'number' ? s.actualCash : 0), 0);
    return openExpected + closedActual;
  }, [cashSessions, openSessions]);

  const dayFlow = useMemo(() => {
    const buckets = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
    const byHour = new Map<string, { revenue: number; expenses: number }>();
    for (const b of buckets) byHour.set(b, { revenue: 0, expenses: 0 });
    const hourLabel = (iso: string) => {
      const d = new Date(iso);
      const h = d.getHours();
      const snapped = Math.max(8, Math.min(20, Math.round((h - 8) / 2) * 2 + 8));
      return `${String(snapped).padStart(2, '0')}:00`;
    };
    for (const p of payments) {
      const key = hourLabel(p.paidAt || p.createdAt || new Date().toISOString());
      const cur = byHour.get(key);
      if (cur) cur.revenue += p.total ?? 0;
    }
    for (const e of expenses) {
      const t = new Date(e.createdAt).getTime();
      if (t < rangeWindow.start.getTime() || t >= rangeWindow.end.getTime()) continue;
      const key = hourLabel(e.createdAt);
      const cur = byHour.get(key);
      if (cur) cur.expenses += e.amount;
    }
    const rows = buckets.map((b) => ({ time: b, ...(byHour.get(b) ?? { revenue: 0, expenses: 0 }) }));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.expenses)));
    return { rows, max };
  }, [expenses, payments, rangeWindow.end, rangeWindow.start]);

  const registers = useMemo(() => Array.from(new Set(cashSessions.map((s) => s.register))), [cashSessions]);
  const staffNames = useMemo(() => Array.from(new Set(cashSessions.map((s) => s.staffName))), [cashSessions]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cashSessions.filter((s) => {
      if (q) {
        const hit = s.id.toLowerCase().includes(q) || s.staffName.toLowerCase().includes(q) || s.register.toLowerCase().includes(q) || s.status.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;
      if (registerFilter !== 'All' && s.register !== registerFilter) return false;
      if (staffFilter !== 'All' && s.staffName !== staffFilter) return false;
      return true;
    });
  }, [cashSessions, query, registerFilter, staffFilter, statusFilter]);

  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) => e.id.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.vendor.toLowerCase().includes(q));
  }, [expenses, query]);

  const exportCsv = () => {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const downloadCsv = (filename: string, header: string[], rows: any[][]) => {
      const lines: string[] = [];
      lines.push(header.map(esc).join(','));
      for (const r of rows) lines.push(r.map(esc).join(','));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    const day = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // 1) Summary
    downloadCsv(
      `finance-summary-${day}.csv`,
      ['rangeLabel', 'rangeStart', 'rangeEnd', 'generatedAt', 'totalRevenue', 'totalExpenses', 'netProfit', 'cashExpected', 'cashActual', 'cashDiscrepancy'],
      [
        [
          range,
          rangeWindow.start.toISOString(),
          rangeWindow.end.toISOString(),
          nowIso,
          totalRevenue.toFixed(2),
          totalExpenses.toFixed(2),
          netProfit.toFixed(2),
          expectedCash.toFixed(2),
          actualCounted.toFixed(2),
          (actualCounted - expectedCash).toFixed(2),
        ],
      ],
    );

    // 2) Payment breakdown
    downloadCsv(
      `finance-payments-${day}.csv`,
      ['method', 'amount', 'count', 'rangeStart', 'rangeEnd'],
      paymentBreakdown.map(([method, v]) => [method, Number(v.sum || 0).toFixed(2), String(v.count), rangeWindow.start.toISOString(), rangeWindow.end.toISOString()]),
    );

    // 3) Cash sessions
    downloadCsv(
      `finance-cash-sessions-${day}.csv`,
      ['id', 'status', 'register', 'staffName', 'openedAt', 'closedAt', 'openingCash', 'expectedCash', 'actualCash', 'variance'],
      filteredSessions.map((s) => {
        const expected = Number(s.expectedCash ?? 0) || 0;
        const actual = typeof s.actualCash === 'number' ? (Number(s.actualCash) || 0) : null;
        const variance = actual == null ? null : actual - expected;
        return [
          s.id,
          s.status,
          s.register,
          s.staffName,
          s.openedAt,
          s.closedAt || '',
          (Number(s.openingCash ?? 0) || 0).toFixed(2),
          expected.toFixed(2),
          actual == null ? '' : actual.toFixed(2),
          variance == null ? '' : variance.toFixed(2),
        ];
      }),
    );

    // 4) Expenses
    downloadCsv(
      `finance-expenses-${day}.csv`,
      ['id', 'title', 'vendor', 'createdAt', 'amount'],
      filteredExpenses.map((e) => [e.id, e.title, e.vendor, e.createdAt, (Number(e.amount || 0) || 0).toFixed(2)]),
    );
  };

  const openPrintableReport = (opts: {
    title: string;
    generatedAt: string;
    rangeLabel: string;
    rangeStart: string;
    rangeEnd: string;
    cashSummary: {
      expected: number;
      actual: number;
      discrepancy: number;
      sessionsTotal: number;
      sessionsActive: number;
      sessionsClosed: number;
      sessionsAudit: number;
    };
    sessions: CashSession[];
    expensesRows: Expense[];
    totals: { revenue: number; expenses: number; net: number };
    payment: Array<[string, { sum: number; count: number }]>;
    paymentsRows: PaymentTx[];
  }) => {
    const esc = (s: string) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const productsMap = new Map<
      string,
      {
        name: string;
        qty: number;
        sales: number;
      }
    >();
    for (const p of opts.paymentsRows as any[]) {
      const items = Array.isArray((p as any)?.items) ? ((p as any).items as any[]) : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const productId = String((it as any).productId || (it as any).product_id || '').trim();
        const name = String((it as any).name || productId || 'Item').trim();
        const qty = Number((it as any).qty ?? (it as any).quantity ?? 0) || 0;
        const unitPrice = Number((it as any).unitPrice ?? (it as any).unit_price ?? 0) || 0;
        if (!name || qty <= 0 || unitPrice < 0) continue;
        const key = productId || name;
        const cur = productsMap.get(key) ?? { name, qty: 0, sales: 0 };
        cur.name = name || cur.name;
        cur.qty += qty;
        cur.sales += qty * unitPrice;
        productsMap.set(key, cur);
      }
    }
    const productRows = Array.from(productsMap.values())
      .filter((r) => r.qty > 0.0001)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 15);

    const sessionRows = opts.sessions
      .map((s) => {
        const actual = typeof s.actualCash === 'number' ? s.actualCash : null;
        const variance = (actual ?? s.expectedCash) - s.expectedCash;
        const opening = Number(s.openingCash ?? 0) || 0;
        const cashSales = (Number(s.expectedCash ?? 0) || 0) - opening;
        return `
          <tr>
            <td>${esc(`#${s.id}`)}</td>
            <td>${esc(s.register)}</td>
            <td>${esc(s.staffName)}</td>
            <td>${esc(s.status)}</td>
            <td>${esc(formatDeviceDateTime(s.openedAt, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '')}</td>
            <td>${esc(s.closedAt ? (formatDeviceDateTime(s.closedAt, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '') : '--')}</td>
            <td style="text-align:right">${esc(formatMoney(opening))}</td>
            <td style="text-align:right">${esc(formatMoney(Math.max(0, cashSales)))}</td>
            <td style="text-align:right">${esc(formatMoney(s.expectedCash))}</td>
            <td style="text-align:right">${esc(actual != null ? formatMoney(actual) : '--')}</td>
            <td style="text-align:right">${esc(actual != null ? (variance >= 0 ? '+' : '-') + formatMoney(Math.abs(variance)).replace('ETB ', 'ETB ') : '--')}</td>
          </tr>`;
      })
      .join('');

    const productSalesRows = productRows
      .map((r) => {
        return `
          <tr>
            <td>${esc(r.name)}</td>
            <td class="right">${esc(String(Math.round(r.qty)))}</td>
            <td class="right">${esc(formatMoney(r.sales))}</td>
          </tr>`;
      })
      .join('');

    const expenseRows = opts.expensesRows
      .map((e) => {
        return `
          <tr>
            <td>${esc(e.id)}</td>
            <td>${esc(e.title)}</td>
            <td>${esc(e.vendor)}</td>
            <td>${esc(formatDeviceDateTime(e.createdAt, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '')}</td>
            <td style="text-align:right">-${esc(formatMoney(e.amount))}</td>
          </tr>`;
      })
      .join('');

    const paymentRows = opts.payment
      .map(([method, v]) => {
        return `
          <tr>
            <td>${esc(method)}</td>
            <td style="text-align:right">${esc(formatMoney(v.sum))}</td>
            <td style="text-align:right">${esc(String(v.count))}</td>
          </tr>`;
      })
      .join('');

    const grossSales = Number(opts.totals.revenue || 0) || 0;
    const salesTax = opts.paymentsRows.reduce((s, p) => s + (p.tax ?? 0), 0);
    const discounts = opts.paymentsRows.reduce((s, p) => s + (p.discount ?? 0), 0);
    const tips = opts.paymentsRows.reduce((s, p) => s + (p.tip ?? 0), 0);
    const takeawayFees = opts.paymentsRows.reduce((s, p: any) => s + (Number(p.takeawayFee ?? 0) || 0), 0);
    const netSales = grossSales - salesTax;

    const tenderedTotal = opts.payment.reduce((s, [, v]) => s + (v.sum ?? 0), 0);

    const auditSessions = opts.sessions.filter((s) => s.status === 'Audit');
    const auditRows = auditSessions
      .map((s) => {
        const actual = typeof s.actualCash === 'number' ? s.actualCash : null;
        const variance = (actual ?? s.expectedCash) - s.expectedCash;
        return `
          <tr>
            <td>${esc(`#${s.id}`)}</td>
            <td>${esc(s.register)}</td>
            <td>${esc(s.staffName)}</td>
            <td style="text-align:right">${esc(formatMoney(s.expectedCash))}</td>
            <td style="text-align:right">${esc(actual != null ? formatMoney(actual) : '--')}</td>
            <td style="text-align:right">${esc((variance >= 0 ? '+' : '-') + formatMoney(Math.abs(variance)).replace('ETB ', 'ETB '))}</td>
          </tr>`;
      })
      .join('');

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${esc(opts.title)}</title>
          <style>
            :root { color-scheme: light; }
            body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"; background: #f3f4f6; color: #111827; }
            .paper { max-width: 420px; margin: 16px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
            .wrap { padding: 16px; }
            .center { text-align: center; }
            .title { font-size: 16px; font-weight: 900; letter-spacing: .02em; }
            .sub { font-size: 11px; color: #374151; margin-top: 4px; }
            .muted { color: #6b7280; }
            .sep { border-top: 1px dashed #9ca3af; margin: 12px 0; }
            .h { font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; margin: 10px 0 6px; }
            table { width: 100%; border-collapse: collapse; }
            td, th { font-size: 12px; padding: 4px 0; vertical-align: top; }
            th { text-align: left; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid #e5e7eb; padding: 6px 0; }
            .right { text-align: right; }
            .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
            .k { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; }
            .v { font-size: 14px; font-weight: 900; margin-top: 6px; }
            @media print {
              body { background: #fff; }
              .paper { box-shadow: none; margin: 0; border: none; border-radius: 0; }
            }
          </style>
        </head>
        <body>
          <div class="paper">
            <div class="wrap">
              <div class="center">
                <div class="title">${esc(opts.title)}</div>
                <div class="sub muted">MirachPOS    End of Day (Z Report)</div>
                <div class="sub">Generated: ${esc(formatDeviceDateTime(opts.generatedAt, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '')}</div>
                <div class="sub">Period: ${esc(opts.rangeLabel)}</div>
                <div class="sub muted">${esc(formatDeviceDateTime(opts.rangeStart, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '')} â†’ ${esc(formatDeviceDateTime(opts.rangeEnd, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '')}</div>
              </div>

              <div class="sep"></div>

              <div class="h">Sales Summary</div>
              <table>
                <tbody>
                  <tr><td>Gross Sales</td><td class="right">${esc(formatMoney(grossSales))}</td></tr>
                  <tr><td class="muted">Takeaway Fees (included)</td><td class="right">${esc(formatMoney(takeawayFees))}</td></tr>
                  <tr><td>Net Sales (excl. tax)</td><td class="right">${esc(formatMoney(netSales))}</td></tr>
                  <tr><td>Sales Tax</td><td class="right">${esc(formatMoney(salesTax))}</td></tr>
                  <tr><td>Discounts</td><td class="right">-${esc(formatMoney(discounts))}</td></tr>
                  <tr><td>Tips</td><td class="right">${esc(formatMoney(tips))}</td></tr>
                  <tr><td><strong>Expenses</strong></td><td class="right"><strong>-${esc(formatMoney(opts.totals.expenses))}</strong></td></tr>
                  <tr><td><strong>Net Profit</strong></td><td class="right"><strong>${esc(formatMoney(opts.totals.net))}</strong></td></tr>
                </tbody>
              </table>

              <div class="sep"></div>

              <div class="h">Tenders / Payments</div>
              <table>
                <thead>
                  <tr><th>Method</th><th class="right">Amount</th><th class="right">Count</th></tr>
                </thead>
                <tbody>
                  ${paymentRows || `<tr><td class="muted" colspan="3">No payments in range.</td></tr>`}
                  <tr><td class="muted">Total Expected Payments</td><td class="right">${esc(formatMoney(tenderedTotal))}</td><td class="right">${esc(String(opts.paymentsRows.length))}</td></tr>
                </tbody>
              </table>

              <div class="sep"></div>

              <div class="h">Products Sold (Top 15)</div>
              <table>
                <thead>
                  <tr><th>Product</th><th class="right">Qty</th><th class="right">Sales</th></tr>
                </thead>
                <tbody>
                  ${productSalesRows || `<tr><td class="muted" colspan="3">No products in range.</td></tr>`}
                </tbody>
              </table>

              <div class="sep"></div>

              <div class="h">Cash Drawer</div>
              <div class="grid2">
                <div class="box">
                  <div class="k">Cash Expected (Sum)</div>
                  <div class="v">${esc(formatMoney(opts.cashSummary.expected))}</div>
                  <div class="sub muted">From sessions opening + cash sales</div>
                </div>
                <div class="box">
                  <div class="k">Cash Counted (Sum)</div>
                  <div class="v">${esc(formatMoney(opts.cashSummary.actual))}</div>
                  <div class="sub muted">Entered by cashier/manager</div>
                </div>
                <div class="box">
                  <div class="k">Discrepancy</div>
                  <div class="v">${esc((opts.cashSummary.discrepancy >= 0 ? '' : '-') + formatMoney(Math.abs(opts.cashSummary.discrepancy)).replace('ETB ', 'ETB '))}</div>
                  <div class="sub muted">Expected vs counted</div>
                </div>
                <div class="box">
                  <div class="k">Sessions</div>
                  <div class="v">${esc(String(opts.cashSummary.sessionsTotal))}</div>
                  <div class="sub muted">Active ${esc(String(opts.cashSummary.sessionsActive))}    Closed ${esc(String(opts.cashSummary.sessionsClosed))}    Audit ${esc(String(opts.cashSummary.sessionsAudit))}</div>
                </div>
              </div>

              <div class="sep"></div>

              <div class="h">Cash Sessions Detail</div>
              <table>
                <thead>
                  <tr>
                    <th>ID</th><th>Register</th><th class="right">Expected</th><th class="right">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    opts.sessions
                      .map((s) => {
                        const actual = typeof s.actualCash === 'number' ? s.actualCash : null;
                        return `<tr><td>${esc(`#${s.id}`)}</td><td>${esc(s.register)}</td><td class="right">${esc(formatMoney(s.expectedCash))}</td><td class="right">${esc(actual != null ? formatMoney(actual) : '--')}</td></tr>`;
                      })
                      .join('') || `<tr><td class="muted" colspan="4">No sessions.</td></tr>`
                  }
                </tbody>
              </table>

              <div class="sep"></div>

              <div class="h">Expenses Detail</div>
              <table>
                <thead>
                  <tr><th>Description</th><th class="right">Amount</th></tr>
                </thead>
                <tbody>
                  ${
                    opts.expensesRows
                      .map((e) => `<tr><td>${esc(`${e.title}${e.vendor ? `    ${e.vendor}` : ''}`)}</td><td class="right">-${esc(formatMoney(e.amount))}</td></tr>`)
                      .join('') || `<tr><td class="muted" colspan="2">No expenses.</td></tr>`
                  }
                </tbody>
              </table>

              <div class="sep"></div>

              <div class="h">Exceptions / Audit</div>
              <div class="sub muted">Sessions marked Audit need review (counted cash missing or variance above threshold).</div>
              <table>
                <thead>
                  <tr><th>ID</th><th>Register</th><th>Staff</th><th class="right">Expected</th><th class="right">Actual</th><th class="right">Var</th></tr>
                </thead>
                <tbody>
                  ${auditRows || `<tr><td class="muted" colspan="6">No audit sessions.</td></tr>`}
                </tbody>
              </table>

              <div class="sep"></div>
              <div class="center sub muted">Powered by MirachPOS</div>
            </div>
          </div>
          <script>window.focus();</script>
        </body>
      </html>`;

    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      setFlash({ kind: 'warning', message: 'Popup blocked. Allow popups to print/save PDF.' });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.addEventListener('load', () => {
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    });
  };

  const expectedCash = useMemo(() => {
    return cashSessions.reduce((sum, s) => sum + (s.expectedCash ?? 0), 0);
  }, [cashSessions]);

  const actualCounted = useMemo(() => {
    return cashSessions.reduce((sum, s) => sum + (typeof s.actualCash === 'number' ? s.actualCash : 0), 0);
  }, [cashSessions]);

  const closeShiftAndGenerate = () => {
    const now = new Date().toISOString();
    (async () => {
      try {
        const actives = cashSessions.filter((s) => s.status === 'Active');
        await Promise.all(
          actives.map((s) =>
            updateCashSession(s.id, {
              status: 'Closed',
              closedAt: now,
              actualCash: typeof s.actualCash === 'number' ? s.actualCash : s.expectedCash,
            }),
          ),
        );

        const out = await fetchFinanceRemote(range);
        setCashSessions(out.cashSessions);
        setExpenses(out.expenses);
        setPayments(out.payments);

        setTab('Cash Sessions');
        setQuery('');
        setStatusFilter('Closed');
        setRegisterFilter('All');
        setStaffFilter('All');
        setLastGeneratedAt(now);
        setFlash({ kind: 'success', message: 'Shift closed. Generating report ¦' });

        const totals = {
          revenue: out.payments.reduce((s, p) => s + (p.total ?? 0), 0),
          expenses: out.expenses
            .filter((e) => {
              const t = new Date(e.createdAt).getTime();
              return t >= out.start.getTime() && t < out.end.getTime();
            })
            .reduce((s, e) => s + e.amount, 0),
          net: 0,
        };
        totals.net = totals.revenue - totals.expenses;

        const m = new Map<string, { sum: number; count: number }>();
        for (const p of out.payments) {
          const key = p.method || 'Unknown';
          const cur = m.get(key) ?? { sum: 0, count: 0 };
          cur.sum += p.total ?? 0;
          cur.count += 1;
          m.set(key, cur);
        }
        const paymentRows: Array<[string, { sum: number; count: number }]> = Array.from(m.entries());

        const sessionsTotal = out.cashSessions.length;
        const sessionsActive = out.cashSessions.filter((s) => s.status === 'Active').length;
        const sessionsAudit = out.cashSessions.filter((s) => s.status === 'Audit').length;
        const sessionsClosed = out.cashSessions.filter((s) => s.status === 'Closed').length;
        const expectedSum = out.cashSessions.reduce((sum, s) => sum + (Number(s.expectedCash ?? 0) || 0), 0);
        const actualSum = out.cashSessions.reduce((sum, s) => sum + (typeof s.actualCash === 'number' ? (Number(s.actualCash) || 0) : 0), 0);
        const discrepancySum = out.cashSessions.reduce((sum, s) => {
          if (s.status === 'Active') return sum;
          const actual = typeof s.actualCash === 'number' ? (Number(s.actualCash) || 0) : Number(s.expectedCash ?? 0) || 0;
          return sum + (actual - (Number(s.expectedCash ?? 0) || 0));
        }, 0);

        exportCsv();
        openPrintableReport({
          title: 'Daily Finance Report',
          generatedAt: now,
          rangeLabel: range,
          rangeStart: out.start.toISOString(),
          rangeEnd: out.end.toISOString(),
          cashSummary: {
            expected: expectedSum,
            actual: actualSum,
            discrepancy: discrepancySum,
            sessionsTotal,
            sessionsActive,
            sessionsClosed,
            sessionsAudit,
          },
          sessions: out.cashSessions,
          expensesRows: out.expenses,
          totals,
          payment: paymentRows,
          paymentsRows: out.payments,
        });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to close shift / generate report.' });
      }
    })();
  };

  const exportProfitPdf = () => {
    const nowIso = new Date().toISOString();
    const startMs = rangeWindow.start.getTime();
    const endMs = rangeWindow.end.getTime();

    const paymentsInRange = payments.filter((p) => {
      const t = new Date(p.paidAt || p.createdAt || '').getTime();
      return Number.isFinite(t) && t >= startMs && t < endMs;
    });

    const expensesInRange = expenses.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return Number.isFinite(t) && t >= startMs && t < endMs;
    });

    const sessionsInRange = cashSessions.filter((s) => {
      const t = new Date(s.openedAt).getTime();
      return Number.isFinite(t) && t >= startMs && t < endMs;
    });

    const totals = {
      revenue: paymentsInRange.reduce((s, p) => s + (p.total ?? 0), 0),
      expenses: expensesInRange.reduce((s, e) => s + (e.amount ?? 0), 0),
      net: 0,
    };
    totals.net = totals.revenue - totals.expenses;

    const m = new Map<string, { sum: number; count: number }>();
    for (const p of paymentsInRange) {
      const key = p.method || 'Unknown';
      const cur = m.get(key) ?? { sum: 0, count: 0 };
      cur.sum += p.total ?? 0;
      cur.count += 1;
      m.set(key, cur);
    }
    const paymentRows: Array<[string, { sum: number; count: number }]> = Array.from(m.entries());
    const paymentRowsForTable: Array<[string, { sum: number; count: number }]> = paymentRows.length ? paymentRows : [['—', { count: 0, sum: 0 }]];

    const tax = paymentsInRange.reduce((s, p) => s + (p.tax ?? 0), 0);
    const discounts = paymentsInRange.reduce((s, p) => s + (p.discount ?? 0), 0);
    const tips = paymentsInRange.reduce((s, p) => s + (p.tip ?? 0), 0);
    const takeawayFees = paymentsInRange.reduce((s, p: any) => s + (Number(p.takeawayFee ?? 0) || 0), 0);
    const netSales = totals.revenue - tax;

    const byCategory = new Map<string, { count: number; amount: number }>();
    for (const e of expensesInRange) {
      const cat = String(e.category || 'Expense');
      const cur = byCategory.get(cat) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(e.amount ?? 0) || 0;
      byCategory.set(cat, cur);
    }
    const categoryRows = Array.from(byCategory.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amount - a.amount);

    const productsMap = new Map<
      string,
      {
        name: string;
        qty: number;
        sales: number;
      }
    >();
    for (const p of paymentsInRange as any[]) {
      const items = Array.isArray((p as any)?.items) ? ((p as any).items as any[]) : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const productId = String((it as any).productId || (it as any).product_id || '').trim();
        const name = String((it as any).name || productId || 'Item').trim();
        const qty = Number((it as any).qty ?? (it as any).quantity ?? 0) || 0;
        const unitPrice = Number((it as any).unitPrice ?? (it as any).unit_price ?? 0) || 0;
        if (!name || qty <= 0 || unitPrice < 0) continue;
        const key = productId || name;
        const cur = productsMap.get(key) ?? { name, qty: 0, sales: 0 };
        cur.name = name || cur.name;
        cur.qty += qty;
        cur.sales += qty * unitPrice;
        productsMap.set(key, cur);
      }
    }
    const productRows = Array.from(productsMap.values())
      .filter((r) => r.qty > 0.0001)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 15);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Profit Report', margin, 48);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(
      [`Range: ${range}`, `Period: ${formatDateLabel(new Date(rangeWindow.start))}  ${formatDateLabel(new Date(rangeWindow.end.getTime() - 1))}`, `Generated: ${formatDeviceDateTime(nowIso) || nowIso}`],
      margin,
      66,
    );
    doc.setTextColor(0);

    let y = 98;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Metric', 'Amount (ETB)']],
      body: [
        ['Gross Sales (Total)', fmtN(totals.revenue)],
        ['Takeaway Fees (included)', fmtN(takeawayFees)],
        ['Net Sales (excl. tax)', fmtN(netSales)],
        ['Sales Tax', fmtN(tax)],
        ['Discounts', `-${fmtN(discounts)}`],
        ['Tips', fmtN(tips)],
        ['Expenses', `-${fmtN(totals.expenses)}`],
        ['Net Profit', fmtN(totals.net)],
      ],
      columnStyles: { 1: { halign: 'right' } },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 170;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Payment Breakdown', margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Method', 'Count', 'Amount (ETB)']],
      body: paymentRowsForTable.map(([method, v]) => [String(method), String(v.count ?? 0), fmtN(Number(v.sum ?? 0) || 0)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 160;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Expenses Breakdown', margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Category', 'Entries', 'Amount (ETB)']],
      body: (categoryRows.length ? categoryRows : [{ category: '—', count: 0, amount: 0 }]).map((r) => [String(r.category), String(r.count), `-${fmtN(r.amount)}`]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 160;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Products Sold (Top 15)', margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Product', 'Qty', 'Sales (ETB)']],
      body: (productRows.length ? productRows : [{ name: '—', qty: 0, sales: 0 }]).map((r) => [String(r.name), String(Math.round(r.qty)), fmtN(Number(r.sales ?? 0) || 0)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 160;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Expense Ledger (Top 25)', margin, y);
    y += 8;
    const ledgerRows = [...expensesInRange]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 25)
      .map((e) => [
        formatDeviceDateTime(e.createdAt, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || String(e.createdAt || ''),
        String(e.category || ''),
        String(e.title || ''),
        String(e.vendor || ''),
        `-${fmtN(Number(e.amount ?? 0) || 0)}`,
      ]);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Date', 'Category', 'Title', 'Vendor', 'Amount (ETB)']],
      body: ledgerRows.length ? ledgerRows : [['—', '—', '—', '—', '0.00']],
      columnStyles: { 4: { halign: 'right' } },
    });

    const fileName = `profit-${range.toLowerCase().replace(/\s+/g, '-')}-${isoDate(new Date(rangeWindow.start))}.pdf`;

    try {
      doc.save(fileName);
      return;
    } catch {
      // ignore
    }

    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 5000);
      return;
    } catch {
      // ignore
    }

    try {
      setFlash({ kind: 'warning', message: 'Failed to generate PDF. Please allow popups/downloads and try again.' });
    } catch {
      // ignore
    }
  };

  const exportOrdersSoldPdf = () => {
    const nowIso = new Date().toISOString();
    const startMs = rangeWindow.start.getTime();
    const endMs = rangeWindow.end.getTime();

    const paymentsInRange = payments.filter((p) => {
      const t = new Date(p.paidAt || p.createdAt || '').getTime();
      return Number.isFinite(t) && t >= startMs && t < endMs;
    });

    const productsMap = new Map<
      string,
      {
        name: string;
        qty: number;
        sales: number;
      }
    >();

    for (const p of paymentsInRange as any[]) {
      const items = Array.isArray((p as any)?.items) ? ((p as any).items as any[]) : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const productId = String((it as any).productId || (it as any).product_id || '').trim();
        const name = String((it as any).name || productId || 'Item').trim();
        const qty = Number((it as any).qty ?? (it as any).quantity ?? 0) || 0;
        const unitPrice = Number((it as any).unitPrice ?? (it as any).unit_price ?? 0) || 0;
        if (!name || qty <= 0 || unitPrice < 0) continue;
        const key = productId || name;
        const cur = productsMap.get(key) ?? { name, qty: 0, sales: 0 };
        cur.name = name || cur.name;
        cur.qty += qty;
        cur.sales += qty * unitPrice;
        productsMap.set(key, cur);
      }
    }

    const productRows = Array.from(productsMap.values())
      .filter((r) => r.qty > 0.0001)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 50);

    const totalQty = productRows.reduce((s, r) => s + (Number(r.qty || 0) || 0), 0);
    const totalSales = paymentsInRange.reduce((s, p) => s + (Number(p.total ?? 0) || 0), 0);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Orders Sold Report', margin, 48);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(
      [`Range: ${range}`, `Period: ${formatDateLabel(new Date(rangeWindow.start))}    ${formatDateLabel(new Date(rangeWindow.end.getTime() - 1))}`, `Generated: ${formatDeviceDateTime(nowIso) || nowIso}`],
      margin,
      66,
    );
    doc.setTextColor(0);

    let y = 98;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Metric', 'Value']],
      body: [
        ['Paid Orders', String(paymentsInRange.length)],
        ['Units Sold (Top items)', String(Math.round(totalQty))],
        ['Gross Sales (Total)', fmtN(totalSales)],
      ],
      columnStyles: { 1: { halign: 'right' } },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 170;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Products Sold (Top 50)', margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [34, 28, 16] },
      head: [['Product', 'Qty', 'Sales (ETB)']],
      body: (productRows.length ? productRows : [{ name: '—', qty: 0, sales: 0 }]).map((r) => [String(r.name), String(Math.round(r.qty)), fmtN(Number(r.sales ?? 0) || 0)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });

    const fileName = `orders-sold-${range.toLowerCase().replace(/\s+/g, '-')}-${isoDate(new Date(rangeWindow.start))}.pdf`;
    try {
      doc.save(fileName);
      return;
    } catch {
      // ignore
    }

    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 5000);
    } catch {
      setFlash({ kind: 'warning', message: 'Failed to generate Orders Sold PDF. Please allow popups/downloads and try again.' });
    }
  };

  const openNewSession = () => {
    setSessionCreateDraft({ register: 'POS', openingCash: '' });
    setSessionCreateOpen(true);
  };

  const submitNewSession = () => {
    const openingCash = Number(sessionCreateDraft.openingCash || 0) || 0;
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      setFlash({ kind: 'warning', message: 'Invalid opening cash.' });
      return;
    }
    const now = new Date().toISOString();
    (async () => {
      try {
        const bid = resolveBranchId();
        const qs = new URLSearchParams();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/finance/cash-sessions${qs.toString() ? `?${qs.toString()}` : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ register: sessionCreateDraft.register || 'POS', openingCash, openedAt: now }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        const id = String(json?.id || '');
        setSessionCreateOpen(false);
        await loadRemote(range);
        setTab('Cash Sessions');
        setQuery('');
        setStatusFilter('Active');
        setRegisterFilter('All');
        setStaffFilter('All');
        setSessionEditingId(id || null);
        setFlash({ kind: 'success', message: 'Cash session opened.' });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to open cash session.' });
      }
    })();
  };

  const setSessionActualCash = (id: string, amt: number) => {
    setCashSessions((prev) => prev.map((s) => (s.id === id ? { ...s, actualCash: amt } : s)));
    // Persist asynchronously (best-effort)
    (async () => {
      try {
        await updateCashSession(id, { actualCash: amt });
      } catch {
        // ignore
      }
    })();
  };

  const closeSession = (id: string) => {
    const now = new Date().toISOString();
    const target = cashSessions.find((s) => s.id === id);
    const actualCash = typeof target?.actualCash === 'number' ? target.actualCash : target?.expectedCash ?? 0;
    (async () => {
      try {
        const bid = resolveBranchId();
        const qs = new URLSearchParams();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/finance/cash-sessions/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Closed', closedAt: now, actualCash }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await loadRemote(range);
        setFlash({ kind: 'success', message: `Session #${id} closed.` });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to close session.' });
      }
    })();
  };

  const reconcileAllSessions = () => {
    const THRESHOLD = 0.01;

    const next = cashSessions.map((s) => {
      if (s.status === 'Active') return s;

      const hasActual = typeof s.actualCash === 'number' && Number.isFinite(s.actualCash);
      if (!hasActual) {
        // Without a real counted value, we cannot reconcile; force audit.
        return { ...s, status: 'Audit' as const };
      }

      const variance = (s.actualCash as number) - (s.expectedCash ?? 0);
      const statusNext: CashSession['status'] = Math.abs(variance) >= THRESHOLD ? 'Audit' : 'Closed';
      return { ...s, status: statusNext };
    });

    setCashSessions(next);
    setTab('Cash Sessions');
    setQuery('');
    setStatusFilter('All');
    setRegisterFilter('All');
    setStaffFilter('All');

    (async () => {
      try {
        await Promise.all(
          next
            .filter((s) => s.status !== 'Active')
            .map((s) => {
              const patch: any = { status: s.status };
              if (typeof s.actualCash === 'number' && Number.isFinite(s.actualCash)) patch.actualCash = s.actualCash;
              if ((s.status === 'Closed' || s.status === 'Audit') && !s.closedAt) patch.closedAt = new Date().toISOString();
              return updateCashSession(s.id, patch);
            }),
        );
        await loadRemote(range);
        setFlash({ kind: 'success', message: 'Reconciliation completed.' });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to sync reconciliation to server.' });
      }
    })();
  };

  const startEditExpense = (e: Expense) => {
    setExpenseEditingId(e.id);
    setExpenseDraft({ category: 'Expense', title: e.title, vendor: e.vendor, amount: String(e.amount) });
  };

  const saveExpenseEdit = (id: string) => {
    const category = String(expenseDraft.category || '').trim() || 'Expense';
    const amount = parseFloat(expenseDraft.amount || '0');
    if (!Number.isFinite(amount) || amount < 0) {
      setFlash({ kind: 'warning', message: 'Invalid amount.' });
      return;
    }
    (async () => {
      try {
        const bid = resolveBranchId();
        const qs = new URLSearchParams();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/finance/expenses/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, title: expenseDraft.title, vendor: expenseDraft.vendor, amount }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await loadRemote(range);
        setExpenseEditingId(null);
        setFlash({ kind: 'success', message: 'Expense saved.' });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to save expense.' });
      }
    })();
  };

  const deleteExpense = (id: string) => {
    (async () => {
      try {
        const bid = resolveBranchId();
        const qs = new URLSearchParams();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/finance/expenses/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`, { method: 'DELETE' });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await loadRemote(range);
        if (expenseEditingId === id) setExpenseEditingId(null);
        setFlash({ kind: 'success', message: 'Expense removed.' });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to delete expense.' });
      }
    })();
  };

  const addExpense = () => {
    setExpenseCreateDraft({ category: 'Expense', title: '', vendor: '', amount: '', icon: 'receipt_long' });
    setExpenseCreateOpen(true);
  };

  const submitNewExpense = () => {
    const category = String(expenseCreateDraft.category || '').trim() || 'Expense';
    const title = String(expenseCreateDraft.title || '').trim();
    const vendor = String(expenseCreateDraft.vendor || '').trim();
    const amount = Number(expenseCreateDraft.amount || 0);
    if (!title) {
      setFlash({ kind: 'warning', message: 'Title is required.' });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setFlash({ kind: 'warning', message: 'Invalid amount.' });
      return;
    }
    const now = new Date().toISOString();
    (async () => {
      try {
        const bid = resolveBranchId();
        const qs = new URLSearchParams();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/finance/expenses${qs.toString() ? `?${qs.toString()}` : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, title, vendor, amount, createdAt: now, icon: expenseCreateDraft.icon }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setExpenseCreateOpen(false);
        await loadRemote(range);
        setTab('Expenses');
        setQuery('');
        setFlash({ kind: 'success', message: 'Expense created.' });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to create expense.' });
      }
    })();
  };

  return (
    <div className="bg-background font-display text-foreground overflow-hidden h-full flex flex-col">
      <div className="flex-none border-b border-border">
        <Header title="Finance Overview" subtitle="Cash sessions, expenses, and daily cash flow" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {remoteError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3">
              <div>Failed to load finance: {remoteError}</div>
              <button
                onClick={() => loadRemote(range)}
                className="px-4 h-10 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              >
                Retry
              </button>
            </div>
          ) : null}
          {expenseCreateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="text-foreground font-bold">New Expense</div>
                  <button
                    onClick={() => setExpenseCreateOpen(false)}
                    className="size-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Category</div>
                    <input
                      value={expenseCreateDraft.category}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, category: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="Rent / Salary / Utilities / Supplies"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Title</div>
                    <input
                      value={expenseCreateDraft.title}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, title: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="Supplies / Utilities / etc"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Vendor</div>
                    <input
                      value={expenseCreateDraft.vendor}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, vendor: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="Supplier name"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Amount (ETB)</div>
                    <input
                      type="number"
                      value={expenseCreateDraft.amount}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, amount: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Icon</div>
                    <select
                      value={expenseCreateDraft.icon}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, icon: e.target.value as any }))}
                      className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none"
                    >
                      <option value="receipt_long">Receipt</option>
                      <option value="local_shipping">Shipping</option>
                      <option value="build">Maintenance</option>
                      <option value="sanitizer">Supplies</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <button
                    onClick={() => setExpenseCreateOpen(false)}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNewExpense}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {sessionCreateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="text-foreground font-bold">Open Cash Session</div>
                  <button
                    onClick={() => setSessionCreateOpen(false)}
                    className="size-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Register</div>
                    <input
                      value={sessionCreateDraft.register}
                      onChange={(e) => setSessionCreateDraft((d) => ({ ...d, register: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="POS"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-bold">Opening Cash (ETB)</div>
                    <input
                      type="number"
                      value={sessionCreateDraft.openingCash}
                      onChange={(e) => setSessionCreateDraft((d) => ({ ...d, openingCash: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <button
                    onClick={() => setSessionCreateOpen(false)}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNewSession}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {loadingRemote ? (
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground font-bold">
              Loading finance data ¦
            </div>
          ) : null}
          {flash && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                flash.kind === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300'
              }`}
            >
              {flash.message}
            </div>
          )}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-base">
                Financial summary: <span className="text-foreground font-medium">{range}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {formatDateLabel(new Date(rangeWindow.start))} â†’ {formatDateLabel(new Date(rangeWindow.end.getTime() - 1))}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex bg-card p-1 rounded-lg border border-border">
                {(['Today', 'Yesterday', '7 Days', 'This Month'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setRange(k)}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                      range === k ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <button
                onClick={exportCsv}
                className="flex items-center gap-2 bg-card hover:bg-accent text-foreground px-4 py-2.5 rounded-lg text-sm font-bold border border-border transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Export Report
              </button>

              <button
                onClick={exportOrdersSoldPdf}
                className="flex items-center gap-2 bg-card hover:bg-accent text-foreground px-4 py-2.5 rounded-lg text-sm font-bold border border-border transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                Orders Sold PDF
              </button>

              <button
                onClick={exportProfitPdf}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-black transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                Profit PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-primary">payments</span>
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">Total Revenue</p>
              <h3 className="text-foreground text-2xl font-bold font-mono">{formatMoney(totalRevenue)}</h3>
              <div className="flex items-center gap-1 mt-2 text-emerald-500 text-xs font-bold">
                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                <span>{payments.length} paid orders</span>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-emerald-500">account_balance_wallet</span>
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">Net Cash in Hand</p>
              <h3 className="text-foreground text-2xl font-bold font-mono">{formatMoney(netCashInHand)}</h3>
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-xs">
                <span>{openSessions.length} Active Sessions</span>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-destructive">receipt_long</span>
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">Total Expenses</p>
              <h3 className="text-foreground text-2xl font-bold font-mono">{formatMoney(totalExpenses)}</h3>
              <div className="flex items-center gap-1 mt-2 text-destructive text-xs font-bold">
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{expenses.length} entries</span>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-amber-500">warning</span>
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">Discrepancies</p>
              <h3 className="text-amber-600 dark:text-amber-300 text-2xl font-bold font-mono">{(discrepancyTotal >= 0 ? '' : '-') + formatMoney(Math.abs(discrepancyTotal))}</h3>
              <div className="flex items-center gap-1 mt-2 text-amber-600 dark:text-amber-300 text-xs font-bold">
                <span>{Math.abs(discrepancyTotal) > 0.001 ? 'Needs Review' : 'OK'}</span>
              </div>
            </div>
          </div>

          <div className="w-full bg-card rounded-xl p-6 border border-border shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-foreground text-lg font-bold">Daily Flow</h3>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="w-2 h-2 rounded-full bg-primary"></span> Revenue</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="w-2 h-2 rounded-full bg-destructive"></span> Expenses</span>
              </div>
            </div>

            <div className="w-full h-48 flex items-end gap-2 px-2 relative">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10">
                <div className="w-full h-px bg-border"></div>
                <div className="w-full h-px bg-border"></div>
                <div className="w-full h-px bg-border"></div>
                <div className="w-full h-px bg-border"></div>
                <div className="w-full h-px bg-border"></div>
              </div>

              {dayFlow.rows.map((r) => {
                const h = Math.max(6, Math.round((r.revenue / dayFlow.max) * 100));
                const expH = Math.max(2, Math.round((r.expenses / dayFlow.max) * 100));
                return (
                  <div key={r.time} className="flex-1 relative group h-full">
                    <div
                      className="absolute left-0 right-0 bottom-0 transition-all rounded-t-sm"
                      style={{
                        height: `${h}%`,
                        background: 'linear-gradient(180deg, hsl(var(--primary) / 0.35), hsl(var(--primary) / 0.16))',
                      }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 text-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity mb-1 font-mono">
                        {formatMoney(r.revenue)}
                      </div>
                    </div>
                    <div
                      className="absolute left-0 right-0 bottom-0 pointer-events-none"
                      style={{ height: `${expH}%`, background: 'linear-gradient(180deg, hsl(var(--destructive) / 0.35), hsl(var(--destructive) / 0.14))' }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs text-muted-foreground font-mono">
              {dayFlow.rows.map((r) => (
                <span key={r.time}>{r.time}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-xl border border-border shadow-lg flex flex-col">
              <div className="p-5 border-b border-border flex justify-between items-center">
                <h3 className="text-foreground text-lg font-bold">Cash Sessions</h3>
                <button onClick={() => setTab('Cash Sessions')} className="text-primary text-sm font-bold hover:underline">View All</button>
              </div>
              <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                      <th className="px-5 py-3 font-medium">Register</th>
                      <th className="px-5 py-3 font-medium">Staff</th>
                      <th className="px-5 py-3 font-medium text-right">Opening</th>
                      <th className="px-5 py-3 font-medium text-right">Closing</th>
                      <th className="px-5 py-3 font-medium text-right">Variance</th>
                      <th className="px-5 py-3 font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-border">
                    {cashSessions.slice(0, 6).map((s) => {
                      const actual = typeof s.actualCash === 'number' ? s.actualCash : undefined;
                      const variance = (actual ?? s.expectedCash) - s.expectedCash;
                      const varianceCls =
                        variance > 0.001
                          ? 'text-emerald-600 dark:text-emerald-300'
                          : variance < -0.001
                            ? 'text-amber-600 dark:text-amber-300 font-bold'
                            : 'text-emerald-600 dark:text-emerald-300';
                      const statusPill =
                        s.status === 'Active'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : s.status === 'Audit'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'bg-muted text-muted-foreground';
                      return (
                        <tr key={s.id} className="hover:bg-accent transition-colors group">
                          <td className="px-5 py-4 font-medium text-foreground">{s.register}</td>
                          <td className="px-5 py-4 text-muted-foreground">{s.staffName}</td>
                          <td className="px-5 py-4 text-right font-mono text-muted-foreground">{formatMoney(s.openingCash)}</td>
                          <td className="px-5 py-4 text-right font-mono text-foreground">{actual != null ? formatMoney(actual) : '--'}</td>
                          <td className={`px-5 py-4 text-right font-mono ${actual != null ? varianceCls : 'text-muted-foreground'}`}>{actual != null ? `${variance >= 0 ? '+' : ''}${formatMoney(variance)}` : '--'}</td>
                          <td className="px-5 py-4 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusPill}`}>{s.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-border mt-auto">
                <button
                  onClick={reconcileAllSessions}
                  className="w-full py-2 rounded-lg border border-primary/40 text-primary text-sm font-bold hover:bg-primary/10 transition-colors"
                >
                  Reconcile All Sessions
                </button>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg flex flex-col">
              <div className="p-5 border-b border-border flex justify-between items-center">
                <h3 className="text-foreground text-lg font-bold">Expenses</h3>
                <button
                  onClick={addExpense}
                  className="size-8 flex items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">add</span>
                </button>
              </div>
              <div className="flex-1 p-0 overflow-y-auto max-h-[300px]">
                <div className="flex flex-col">
                  {expenses.slice(0, 8).map((e) => (
                    <div key={e.id} className="flex items-center justify-between p-4 border-b border-border hover:bg-accent transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-muted flex items-center justify-center text-primary">
                          <span className="material-symbols-outlined text-[20px]">{e.icon}</span>
                        </div>
                        <div>
                          <p className="text-foreground text-sm font-medium">{e.title}</p>
                          <p className="text-muted-foreground text-xs">Vendor: {e.vendor}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-destructive text-sm font-mono font-bold">-{formatMoney(e.amount)}</p>
                        <p className="text-muted-foreground text-xs">{formatTime12(e.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 flex flex-wrap items-center justify-between gap-6 shadow-xl">
            <div className="flex flex-col">
              <h4 className="text-foreground text-base font-bold">Daily Reconciliation</h4>
              <p className="text-muted-foreground text-sm">Verify physical cash against recorded transactions.</p>
            </div>
            <div className="flex items-center gap-8">
              <div className="flex flex-col items-end">
                <span className="text-xs text-muted-foreground uppercase">Expected Cash</span>
                <span className="text-xl text-foreground font-mono font-bold">{formatMoney(expectedCash)}</span>
              </div>
              <div className="h-8 w-px bg-border"></div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-muted-foreground uppercase">Actual Counted</span>
                <span
                  className={`text-xl font-mono font-bold ${
                    Math.abs(actualCounted - expectedCash) < 0.01 ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'
                  }`}
                >
                  {formatMoney(actualCounted)}
                </span>
              </div>
            </div>
            <button
              onClick={closeShiftAndGenerate}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              Close Shift & Generate Report
            </button>
          </div>

          <div className="flex flex-col rounded-xl bg-card border border-border shadow-sm overflow-hidden">
            <div className="flex border-b border-border">
              <button
                onClick={() => setTab('Cash Sessions')}
                className={`px-6 py-4 text-sm font-bold border-b-2 ${tab === 'Cash Sessions' ? 'border-primary text-primary bg-primary/10' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                Cash Sessions
              </button>
              <button
                onClick={() => setTab('Expenses')}
                className={`px-6 py-4 text-sm font-bold border-b-2 ${tab === 'Expenses' ? 'border-primary text-primary bg-primary/10' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                Expenses
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-background">
              <div className="relative max-w-xl w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-muted-foreground text-lg">search</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/60 text-foreground"
                  placeholder="Search by staff, ID, vendor..."
                  type="text"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(['All','Active','Closed','Audit'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                        statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:bg-accent'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  <select
                    value={registerFilter}
                    onChange={(e) => setRegisterFilter(e.target.value)}
                    className="h-8 px-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none"
                  >
                    <option value="All">All Registers</option>
                    {registers.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <select
                    value={staffFilter}
                    onChange={(e) => setStaffFilter(e.target.value)}
                    className="h-8 px-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none"
                  >
                    <option value="All">All Staff</option>
                    {staffNames.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStatusFilter('All');
                    setRegisterFilter('All');
                    setStaffFilter('All');
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">filter_list</span>
                  Reset
                </button>
                <button
                  onClick={openNewSession}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-card border border-border rounded-lg shadow-sm hover:bg-accent transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">add</span>
                  Open Session
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {tab === 'Cash Sessions' ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-20">ID</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Staff Member</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terminal</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Expected</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actual</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Difference</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">Status</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredSessions.map((s) => {
                      const actual = typeof s.actualCash === 'number' ? s.actualCash : undefined;
                      const diff = actual != null ? actual - s.expectedCash : 0;
                      const diffCls =
                        diff < -0.01
                          ? 'text-destructive'
                          : diff > 0.01
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-emerald-600 dark:text-emerald-300';
                      const pill =
                        s.status === 'Active'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 animate-pulse'
                          : 'bg-muted text-muted-foreground';
                      return (
                        <tr key={s.id} className="hover:bg-accent transition-colors">
                          <td className="py-3 px-4 text-sm font-medium text-muted-foreground">#{s.id}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-muted bg-cover bg-center" />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-foreground">{s.staffName}</span>
                                <span className="text-xs text-muted-foreground">{s.staffRole}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-foreground">{s.register}</td>
                          <td className="py-3 px-4 text-sm text-muted-foreground">{formatTime12(s.openedAt)} - {s.status === 'Active' ? 'Active' : s.closedAt ? formatTime12(s.closedAt) : 'Closed'}</td>
                          <td className="py-3 px-4 text-sm text-right font-medium text-foreground">{formatMoney(s.expectedCash)}</td>
                          <td className="py-3 px-4 text-sm text-right font-medium text-foreground">
                            {s.status === 'Active' && sessionEditingId === s.id ? (
                              <input
                                type="number"
                                className="w-28 text-right bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
                                value={actual ?? ''}
                                onChange={(e) => setSessionActualCash(s.id, parseFloat(e.target.value || ''))}
                                onBlur={() => setSessionEditingId(null)}
                              />
                            ) : actual != null ? (
                              formatMoney(actual)
                            ) : (
                              '--'
                            )}
                          </td>
                          <td className={`py-3 px-4 text-sm text-right font-bold ${actual != null ? diffCls : 'text-muted-foreground'}`}>{actual != null ? `${diff < 0 ? '-' : '+'}${formatMoney(Math.abs(diff))}` : '--'}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${pill}`}>{s.status}</span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            {s.status === 'Active' && (
                              <button
                                onClick={() => setSessionEditingId(s.id)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">calculate</span>
                                Count
                              </button>
                            )}
                            {s.status === 'Active' && (
                              <button
                                onClick={() => closeSession(s.id)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">lock</span>
                                Close
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">ID</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vendor</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Amount</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredExpenses.map((e) => (
                      <tr key={e.id} className="hover:bg-accent transition-colors">
                        <td className="py-3 px-4 text-sm font-medium text-muted-foreground">{e.id}</td>
                        <td className="py-3 px-4 text-sm text-foreground">
                          {expenseEditingId === e.id ? (
                            <input
                              value={expenseDraft.title}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, title: ev.target.value }))}
                              className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
                            />
                          ) : (
                            e.title
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {expenseEditingId === e.id ? (
                            <input
                              value={expenseDraft.vendor}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, vendor: ev.target.value }))}
                              className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
                            />
                          ) : (
                            e.vendor
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">{formatTime12(e.createdAt)}</td>
                        <td className="py-3 px-4 text-sm text-right font-mono font-bold text-destructive">
                          {expenseEditingId === e.id ? (
                            <input
                              type="number"
                              value={expenseDraft.amount}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, amount: ev.target.value }))}
                              className="w-28 text-right bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
                            />
                          ) : (
                            `-${formatMoney(e.amount)}`
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {expenseEditingId === e.id ? (
                            <div className="space-x-2">
                              <button
                                onClick={() => saveExpenseEdit(e.id)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">save</span>
                                Save
                              </button>
                              <button
                                onClick={() => setExpenseEditingId(null)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">close</span>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="space-x-2">
                              <button
                                onClick={() => startEditExpense(e)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">edit</span>
                                Edit
                              </button>
                              <button
                                onClick={() => deleteExpense(e.id)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-destructive hover:bg-accent"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between p-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">1-{tab === 'Cash Sessions' ? filteredSessions.length : filteredExpenses.length}</span> of{' '}
                <span className="font-medium text-foreground">{tab === 'Cash Sessions' ? filteredSessions.length : filteredExpenses.length}</span> {tab === 'Cash Sessions' ? 'sessions' : 'expenses'}
              </p>
              <div className="flex gap-2">
                <button className="px-3 py-1 text-sm border border-border rounded bg-card disabled:opacity-50 text-muted-foreground hover:bg-accent" disabled>
                  Previous
                </button>
                <button className="px-3 py-1 text-sm border border-border rounded bg-card text-muted-foreground hover:bg-accent" disabled>
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
