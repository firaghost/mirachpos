import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { apiFetch } from '../api';

type RangeKey = 'Today' | 'Yesterday' | '7 Days';

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

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const formatMoney = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  return `ETB ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatTime12 = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

const formatDateLabel = (d: Date) => d.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });

export const Finance: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('Today');
  const [tab, setTab] = useState<'Cash Sessions' | 'Expenses'>('Cash Sessions');
  const [query, setQuery] = useState('');
  const [expenseEditingId, setExpenseEditingId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<{ title: string; vendor: string; amount: string }>({ title: '', vendor: '', amount: '' });
  const [expenseCreateOpen, setExpenseCreateOpen] = useState(false);
  const [expenseCreateDraft, setExpenseCreateDraft] = useState<{ title: string; vendor: string; amount: string; icon: Expense['icon'] }>(() => ({
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

  const updateCashSession = async (id: string, patch: Partial<CashSession>) => {
    const res = await apiFetch(`/api/manager/finance/cash-sessions/${encodeURIComponent(id)}`, {
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
    const start = r === 'Today' ? todayStart : r === 'Yesterday' ? addDays(todayStart, -1) : addDays(todayStart, -6);
    const end = r === 'Yesterday' ? todayStart : addDays(todayStart, 1);
    const from = `${isoDate(start)}T00:00:00.000Z`;
    const to = `${isoDate(end)}T23:59:59.999Z`;

    const qs = new URLSearchParams({ limit: '200', from, to });
    const [csRes, exRes, payRes] = await Promise.all([
      apiFetch(`/api/manager/finance/cash-sessions?${qs.toString()}`),
      apiFetch(`/api/manager/finance/expenses?${qs.toString()}`),
      apiFetch(`/api/manager/payments?${new URLSearchParams({ from: start.toISOString(), to: end.toISOString(), limit: '500' }).toString()}`),
    ]);

    const csJson = (await csRes.json().catch(() => null)) as any;
    const exJson = (await exRes.json().catch(() => null)) as any;
    const payJson = (await payRes.json().catch(() => null)) as any;

    if (!csRes.ok) throw new Error(csJson?.error || `HTTP ${csRes.status}`);
    if (!exRes.ok) throw new Error(exJson?.error || `HTTP ${exRes.status}`);
    if (!payRes.ok) throw new Error(payJson?.error || `HTTP ${payRes.status}`);

    const nextCashSessions = Array.isArray(csJson?.cashSessions) ? (csJson.cashSessions as CashSession[]) : [];
    const nextExpenses = Array.isArray(exJson?.expenses) ? (exJson.expenses as Expense[]) : [];
    const rows = Array.isArray(payJson?.payments) ? (payJson.payments as any[]) : [];
    const nextPayments: PaymentTx[] = rows
      .map((p) => ({
        id: String(p.id || ''),
        total: Number(p.total ?? 0) || 0,
        tax: Number(p.tax ?? 0) || 0,
        tip: Number(p.tip ?? 0) || 0,
        discount: Number(p.discount ?? 0) || 0,
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
        paidAt: typeof p.paidAt === 'string' ? p.paidAt : null,
        method: String(p.method || 'Unknown'),
        reference: String(p.reference || ''),
        tenderedAmount: p.tenderedAmount == null ? null : Number(p.tenderedAmount || 0) || 0,
      }))
      .filter((x) => x.id);

    return { start, end, cashSessions: nextCashSessions, expenses: nextExpenses, payments: nextPayments };
  };

  const loadRemote = async (rangeOverride?: RangeKey) => {
    try {
      setLoadingRemote(true);
      const out = await fetchFinanceRemote(rangeOverride);
      setCashSessions(out.cashSessions);
      setExpenses(out.expenses);
      setPayments(out.payments);
    } catch {
      // Keep UI usable even if API is down
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
  }) => {
    const esc = (s: string) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

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
            <td>${esc(new Date(s.openedAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }))}</td>
            <td>${esc(s.closedAt ? new Date(s.closedAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : '--')}</td>
            <td style="text-align:right">${esc(formatMoney(opening))}</td>
            <td style="text-align:right">${esc(formatMoney(Math.max(0, cashSales)))}</td>
            <td style="text-align:right">${esc(formatMoney(s.expectedCash))}</td>
            <td style="text-align:right">${esc(actual != null ? formatMoney(actual) : '--')}</td>
            <td style="text-align:right">${esc(actual != null ? (variance >= 0 ? '+' : '-') + formatMoney(Math.abs(variance)).replace('ETB ', 'ETB ') : '--')}</td>
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
            <td>${esc(new Date(e.createdAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }))}</td>
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
    const salesTax = payments.reduce((s, p) => s + (p.tax ?? 0), 0);
    const discounts = payments.reduce((s, p) => s + (p.discount ?? 0), 0);
    const tips = payments.reduce((s, p) => s + (p.tip ?? 0), 0);
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
                <div class="sub">Generated: ${esc(new Date(opts.generatedAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }))}</div>
                <div class="sub">Period: ${esc(opts.rangeLabel)}</div>
                <div class="sub muted">${esc(new Date(opts.rangeStart).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }))} â†’ ${esc(new Date(opts.rangeEnd).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }))}</div>
              </div>

              <div class="sep"></div>

              <div class="h">Sales Summary</div>
              <table>
                <tbody>
                  <tr><td>Gross Sales</td><td class="right">${esc(formatMoney(grossSales))}</td></tr>
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
                  <tr><td class="muted">Total Expected Payments</td><td class="right">${esc(formatMoney(tenderedTotal))}</td><td class="right">${esc(String(payments.length))}</td></tr>
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
        const paymentRows = Array.from(m.entries());

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
        });
      } catch {
        setFlash({ kind: 'warning', message: 'Failed to close shift / generate report.' });
      }
    })();
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
        const res = await apiFetch('/api/manager/finance/cash-sessions', {
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
        const res = await apiFetch(`/api/manager/finance/cash-sessions/${encodeURIComponent(id)}`, {
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
    setExpenseDraft({ title: e.title, vendor: e.vendor, amount: String(e.amount) });
  };

  const saveExpenseEdit = (id: string) => {
    const amount = parseFloat(expenseDraft.amount || '0');
    if (!Number.isFinite(amount) || amount < 0) {
      setFlash({ kind: 'warning', message: 'Invalid amount.' });
      return;
    }
    (async () => {
      try {
        const res = await apiFetch(`/api/manager/finance/expenses/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: expenseDraft.title, vendor: expenseDraft.vendor, amount }),
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
        const res = await apiFetch(`/api/manager/finance/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    setExpenseCreateDraft({ title: '', vendor: '', amount: '', icon: 'receipt_long' });
    setExpenseCreateOpen(true);
  };

  const submitNewExpense = () => {
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
        const res = await apiFetch('/api/manager/finance/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, vendor, amount, createdAt: now, icon: expenseCreateDraft.icon }),
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-none border-b border-border">
        <Header title="Finance Overview" subtitle="Manage cash sessions, expenses, and reports" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {expenseCreateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="text-white font-bold">Add Expense</div>
                  <button
                    onClick={() => setExpenseCreateOpen(false)}
                    className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-light text-text-muted hover:text-white"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs text-text-muted font-bold">Title</div>
                    <input
                      value={expenseCreateDraft.title}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, title: e.target.value }))}
                      className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm text-white"
                      placeholder="e.g. Milk purchase"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-text-muted font-bold">Vendor</div>
                    <input
                      value={expenseCreateDraft.vendor}
                      onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, vendor: e.target.value }))}
                      className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm text-white"
                      placeholder="e.g. ABC Supplier"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-text-muted font-bold">Amount (ETB)</div>
                      <input
                        type="number"
                        value={expenseCreateDraft.amount}
                        onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, amount: e.target.value }))}
                        className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm text-white"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-text-muted font-bold">Icon</div>
                      <select
                        value={expenseCreateDraft.icon}
                        onChange={(e) => setExpenseCreateDraft((d) => ({ ...d, icon: e.target.value as any }))}
                        className="w-full h-10 px-2 rounded-lg border border-border bg-surface text-sm text-text-muted focus:outline-none"
                      >
                        <option value="receipt_long">Receipt</option>
                        <option value="local_shipping">Shipping</option>
                        <option value="build">Maintenance</option>
                        <option value="sanitizer">Supplies</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <button
                    onClick={() => setExpenseCreateOpen(false)}
                    className="px-4 py-2 rounded-lg border border-border text-text-muted hover:text-white hover:bg-surface"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNewExpense}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-[#221c10] font-bold"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {sessionCreateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="text-white font-bold">Open Cash Session</div>
                  <button
                    onClick={() => setSessionCreateOpen(false)}
                    className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-light text-text-muted hover:text-white"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs text-text-muted font-bold">Register</div>
                    <input
                      value={sessionCreateDraft.register}
                      onChange={(e) => setSessionCreateDraft((d) => ({ ...d, register: e.target.value }))}
                      className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm text-white"
                      placeholder="POS"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-text-muted font-bold">Opening Cash (ETB)</div>
                    <input
                      type="number"
                      value={sessionCreateDraft.openingCash}
                      onChange={(e) => setSessionCreateDraft((d) => ({ ...d, openingCash: e.target.value }))}
                      className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm text-white"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <button
                    onClick={() => setSessionCreateOpen(false)}
                    className="px-4 py-2 rounded-lg border border-border text-text-muted hover:text-white hover:bg-surface"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNewSession}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-[#221c10] font-bold"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {loadingRemote ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-muted font-bold">
              Loading finance data ¦
            </div>
          ) : null}
          {flash && (
            <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${flash.kind === 'success' ? 'bg-success/10 border-success/20 text-success' : 'bg-warning/10 border-warning/20 text-warning'}`}>
              {flash.message}
            </div>
          )}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-white text-3xl font-black tracking-tight">Finance Overview</h1>
              <p className="text-text-muted text-base">
                Daily financial summary for <span className="text-white font-medium">{formatDateLabel(new Date(rangeWindow.start))}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex bg-surface p-1 rounded-lg border border-border">
                {(['Today', 'Yesterday', '7 Days'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setRange(k)}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                      range === k ? 'bg-primary text-[#221c10] shadow-md' : 'text-text-muted hover:text-white'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <button
                onClick={exportCsv}
                className="flex items-center gap-2 bg-surface hover:bg-surface-light text-white px-4 py-2.5 rounded-lg text-sm font-bold border border-border transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Export Report
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-primary">payments</span>
              </div>
              <p className="text-text-muted text-sm font-medium mb-1">Total Revenue</p>
              <h3 className="text-white text-2xl font-bold font-mono">{formatMoney(totalRevenue)}</h3>
              <div className="flex items-center gap-1 mt-2 text-success text-xs font-bold">
                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                <span>{payments.length} paid orders</span>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-success">account_balance_wallet</span>
              </div>
              <p className="text-text-muted text-sm font-medium mb-1">Net Cash in Hand</p>
              <h3 className="text-white text-2xl font-bold font-mono">{formatMoney(netCashInHand)}</h3>
              <div className="flex items-center gap-1 mt-2 text-text-muted text-xs">
                <span>{openSessions.length} Active Sessions</span>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-danger">receipt_long</span>
              </div>
              <p className="text-text-muted text-sm font-medium mb-1">Total Expenses</p>
              <h3 className="text-white text-2xl font-bold font-mono">{formatMoney(totalExpenses)}</h3>
              <div className="flex items-center gap-1 mt-2 text-danger text-xs font-bold">
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                <span>{expenses.length} entries</span>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-5 border border-border shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-4xl text-warning">warning</span>
              </div>
              <p className="text-text-muted text-sm font-medium mb-1">Discrepancies</p>
              <h3 className="text-warning text-2xl font-bold font-mono">{(discrepancyTotal >= 0 ? '' : '-') + formatMoney(Math.abs(discrepancyTotal))}</h3>
              <div className="flex items-center gap-1 mt-2 text-warning text-xs font-bold">
                <span>{Math.abs(discrepancyTotal) > 0.001 ? 'Needs Review' : 'OK'}</span>
              </div>
            </div>
          </div>

          <div className="w-full bg-surface rounded-xl p-6 border border-border shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-white text-lg font-bold">Daily Flow</h3>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-text-muted"><span className="w-2 h-2 rounded-full bg-primary"></span> Revenue</span>
                <span className="flex items-center gap-1 text-xs text-text-muted"><span className="w-2 h-2 rounded-full bg-danger"></span> Expenses</span>
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
                  <div key={r.time} className="flex-1 relative group">
                    <div className="w-full bg-primary/20 hover:bg-primary/40 transition-all rounded-t-sm" style={{ height: `${h}%` }}>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity mb-1 font-mono">
                        {formatMoney(r.revenue)}
                      </div>
                    </div>
                    <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: `${expH}%`, background: 'linear-gradient(180deg, rgba(244,63,94,0.35), rgba(244,63,94,0.10))' }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs text-text-muted font-mono">
              {dayFlow.rows.map((r) => (
                <span key={r.time}>{r.time}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-surface rounded-xl border border-border shadow-lg flex flex-col">
              <div className="p-5 border-b border-border flex justify-between items-center">
                <h3 className="text-white text-lg font-bold">Cash Sessions</h3>
                <button onClick={() => setTab('Cash Sessions')} className="text-primary text-sm font-bold hover:underline">View All</button>
              </div>
              <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs text-text-muted uppercase tracking-wider border-b border-border">
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
                      const varianceCls = variance > 0.001 ? 'text-success' : variance < -0.001 ? 'text-warning font-bold' : 'text-success';
                      const statusPill =
                        s.status === 'Active'
                          ? 'bg-success/10 text-success'
                          : s.status === 'Audit'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-surface-light text-text-muted';
                      return (
                        <tr key={s.id} className="hover:bg-surface-light transition-colors group">
                          <td className="px-5 py-4 font-medium text-white">{s.register}</td>
                          <td className="px-5 py-4 text-text-muted">{s.staffName}</td>
                          <td className="px-5 py-4 text-right font-mono text-text-muted">{formatMoney(s.openingCash)}</td>
                          <td className="px-5 py-4 text-right font-mono text-white">{actual != null ? formatMoney(actual) : '--'}</td>
                          <td className={`px-5 py-4 text-right font-mono ${actual != null ? varianceCls : 'text-text-muted'}`}>{actual != null ? `${variance >= 0 ? '+' : ''}${formatMoney(variance)}` : '--'}</td>
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
                <button onClick={reconcileAllSessions} className="w-full py-2 rounded-lg border border-primary text-primary text-sm font-bold hover:bg-primary/10 transition-colors">
                  Reconcile All Sessions
                </button>
              </div>
            </div>

            <div className="bg-surface rounded-xl border border-border shadow-lg flex flex-col">
              <div className="p-5 border-b border-border flex justify-between items-center">
                <h3 className="text-white text-lg font-bold">Expenses</h3>
                <button
                  onClick={addExpense}
                  className="size-8 flex items-center justify-center rounded-lg bg-primary hover:bg-primary-hover text-[#221c10] transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">add</span>
                </button>
              </div>
              <div className="flex-1 p-0 overflow-y-auto max-h-[300px]">
                <div className="flex flex-col">
                  {expenses.slice(0, 8).map((e) => (
                    <div key={e.id} className="flex items-center justify-between p-4 border-b border-border hover:bg-surface-light transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-surface-light flex items-center justify-center text-primary">
                          <span className="material-symbols-outlined text-[20px]">{e.icon}</span>
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{e.title}</p>
                          <p className="text-text-muted text-xs">Vendor: {e.vendor}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-danger text-sm font-mono font-bold">-{formatMoney(e.amount)}</p>
                        <p className="text-text-muted text-xs">{formatTime12(e.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-6 flex flex-wrap items-center justify-between gap-6 shadow-xl">
            <div className="flex flex-col">
              <h4 className="text-white text-base font-bold">Daily Reconciliation</h4>
              <p className="text-text-muted text-sm">Verify physical cash against recorded transactions.</p>
            </div>
            <div className="flex items-center gap-8">
              <div className="flex flex-col items-end">
                <span className="text-xs text-text-muted uppercase">Expected Cash</span>
                <span className="text-xl text-white font-mono font-bold">{formatMoney(expectedCash)}</span>
              </div>
              <div className="h-8 w-px bg-white/10"></div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-text-muted uppercase">Actual Counted</span>
                <span className={`text-xl font-mono font-bold ${Math.abs(actualCounted - expectedCash) < 0.01 ? 'text-success' : 'text-warning'}`}>{formatMoney(actualCounted)}</span>
              </div>
            </div>
            <button
              onClick={closeShiftAndGenerate}
              className="bg-primary hover:bg-primary-hover text-[#221c10] px-6 py-3 rounded-lg font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              Close Shift & Generate Report
            </button>
          </div>

          <div className="flex flex-col rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
            <div className="flex border-b border-border">
              <button
                onClick={() => setTab('Cash Sessions')}
                className={`px-6 py-4 text-sm font-bold border-b-2 ${tab === 'Cash Sessions' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-text-muted hover:text-white hover:bg-surface-light'}`}
              >
                Cash Sessions
              </button>
              <button
                onClick={() => setTab('Expenses')}
                className={`px-6 py-4 text-sm font-bold border-b-2 ${tab === 'Expenses' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-text-muted hover:text-white hover:bg-surface-light'}`}
              >
                Expenses
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-surface-light">
              <div className="relative max-w-xl w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-muted text-lg">search</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-surface focus:ring-2 focus:ring-primary focus:outline-none placeholder:text-text-muted text-white"
                  placeholder="Search by staff, ID, vendor..."
                  type="text"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(['All','Active','Closed','Audit'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border ${statusFilter === s ? 'bg-primary text-[#221c10] border-primary' : 'bg-surface text-text-muted border-border hover:bg-surface-light'}`}
                    >
                      {s}
                    </button>
                  ))}
                  <select
                    value={registerFilter}
                    onChange={(e) => setRegisterFilter(e.target.value)}
                    className="h-8 px-2 rounded-lg border border-border bg-surface text-sm text-text-muted focus:outline-none"
                  >
                    <option value="All">All Registers</option>
                    {registers.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <select
                    value={staffFilter}
                    onChange={(e) => setStaffFilter(e.target.value)}
                    className="h-8 px-2 rounded-lg border border-border bg-surface text-sm text-text-muted focus:outline-none"
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
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-muted hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">filter_list</span>
                  Reset
                </button>
                <button onClick={openNewSession} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-surface border border-border rounded-lg shadow-sm hover:bg-surface-light transition-colors">
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
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted w-20">ID</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Staff Member</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Terminal</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Time</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Expected</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Actual</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Difference</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-center">Status</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredSessions.map((s) => {
                      const actual = typeof s.actualCash === 'number' ? s.actualCash : undefined;
                      const diff = actual != null ? actual - s.expectedCash : 0;
                      const diffCls = diff < -0.01 ? 'text-danger' : diff > 0.01 ? 'text-success' : 'text-success';
                      const pill =
                        s.status === 'Active'
                          ? 'bg-success/10 text-success animate-pulse'
                          : 'bg-surface-light text-text-muted';
                      return (
                        <tr key={s.id} className="hover:bg-surface-light transition-colors">
                          <td className="py-3 px-4 text-sm font-medium text-text-muted">#{s.id}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-surface-light bg-cover bg-center" />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-white">{s.staffName}</span>
                                <span className="text-xs text-text-muted">{s.staffRole}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-white">{s.register}</td>
                          <td className="py-3 px-4 text-sm text-text-muted">{formatTime12(s.openedAt)} - {s.status === 'Active' ? 'Active' : s.closedAt ? formatTime12(s.closedAt) : 'Closed'}</td>
                          <td className="py-3 px-4 text-sm text-right font-medium text-white">{formatMoney(s.expectedCash)}</td>
                          <td className="py-3 px-4 text-sm text-right font-medium text-white">
                            {s.status === 'Active' && sessionEditingId === s.id ? (
                              <input
                                type="number"
                                className="w-28 text-right bg-surface-light border border-border rounded px-2 py-1 text-sm text-white"
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
                          <td className={`py-3 px-4 text-sm text-right font-bold ${actual != null ? diffCls : 'text-text-muted'}`}>{actual != null ? `${diff < 0 ? '-' : '+'}${formatMoney(Math.abs(diff))}` : '--'}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${pill}`}>{s.status}</span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            {s.status === 'Active' && (
                              <button onClick={() => setSessionEditingId(s.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-white hover:bg-surface">
                                <span className="material-symbols-outlined text-sm">calculate</span>
                                Count
                              </button>
                            )}
                            {s.status === 'Active' && (
                              <button onClick={() => closeSession(s.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-white hover:bg-surface">
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
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">ID</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Description</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Vendor</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Time</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Amount</th>
                      <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredExpenses.map((e) => (
                      <tr key={e.id} className="hover:bg-surface-light transition-colors">
                        <td className="py-3 px-4 text-sm font-medium text-text-muted">{e.id}</td>
                        <td className="py-3 px-4 text-sm text-white">
                          {expenseEditingId === e.id ? (
                            <input
                              value={expenseDraft.title}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, title: ev.target.value }))}
                              className="w-full bg-surface-light border border-border rounded px-2 py-1 text-sm text-white"
                            />
                          ) : (
                            e.title
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-text-muted">
                          {expenseEditingId === e.id ? (
                            <input
                              value={expenseDraft.vendor}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, vendor: ev.target.value }))}
                              className="w-full bg-surface-light border border-border rounded px-2 py-1 text-sm text-white"
                            />
                          ) : (
                            e.vendor
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-text-muted">{formatTime12(e.createdAt)}</td>
                        <td className="py-3 px-4 text-sm text-right font-mono font-bold text-danger">
                          {expenseEditingId === e.id ? (
                            <input
                              type="number"
                              value={expenseDraft.amount}
                              onChange={(ev) => setExpenseDraft((d) => ({ ...d, amount: ev.target.value }))}
                              className="w-28 text-right bg-surface-light border border-border rounded px-2 py-1 text-sm text-white"
                            />
                          ) : (
                            `-${formatMoney(e.amount)}`
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {expenseEditingId === e.id ? (
                            <div className="space-x-2">
                              <button onClick={() => saveExpenseEdit(e.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-white hover:bg-surface">
                                <span className="material-symbols-outlined text-sm">save</span>
                                Save
                              </button>
                              <button onClick={() => setExpenseEditingId(null)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-white hover:bg-surface">
                                <span className="material-symbols-outlined text-sm">close</span>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="space-x-2">
                              <button onClick={() => startEditExpense(e)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-white hover:bg-surface">
                                <span className="material-symbols-outlined text-sm">edit</span>
                                Edit
                              </button>
                              <button onClick={() => deleteExpense(e.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-danger hover:bg-surface">
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
              <p className="text-sm text-text-muted">
                Showing <span className="font-medium text-white">1-{tab === 'Cash Sessions' ? filteredSessions.length : filteredExpenses.length}</span> of{' '}
                <span className="font-medium text-white">{tab === 'Cash Sessions' ? filteredSessions.length : filteredExpenses.length}</span> {tab === 'Cash Sessions' ? 'sessions' : 'expenses'}
              </p>
              <div className="flex gap-2">
                <button className="px-3 py-1 text-sm border border-border rounded bg-surface disabled:opacity-50 text-text-muted hover:bg-surface-light" disabled>
                  Previous
                </button>
                <button className="px-3 py-1 text-sm border border-border rounded bg-surface text-text-muted hover:bg-surface-light" disabled>
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
