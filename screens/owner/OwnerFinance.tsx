import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../../api';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { PortalMenu, type PortalMenuAnchorRect } from '../../components/PortalMenu';
import { Screen } from '../../types';
import { updateSession } from '../../session';

type FinanceKpis = {
  revenue: number;
  revenueDeltaPct: number;
  netProfit: number;
  netProfitDeltaPct: number;
  cogs: number;
  cogsDeltaPct: number;
  opex: number;
  opexDeltaPct: number;
};

type PnlPoint = { label: string; revenue: number; expenses: number };

type BranchPerf = { id: string; name: string; city: string; profit: number; deltaPct: number };

type BranchOpt = { id: string; name: string };

type LedgerRow = {
  id: string;
  date: string;
  transactionId: string;
  vendor: string;
  vendorInitial: string;
  category: string;
  branchId: string;
  branchName: string;
  amount: number;
  status: 'Paid' | 'Pending' | 'Overdue';
};

type ExpenseDraft = {
  id?: string;
  at: string;
  transactionId: string;
  vendor: string;
  category: string;
  branchId: string;
  amount: string;
  status: 'Paid' | 'Pending' | 'Overdue';
  dueAt: string;
};

type FinanceResp = {
  kpis: FinanceKpis;
  pnl?: PnlPoint[];
  trend?: Array<{ name: string; revenue: number; expenses: number }>; 
  branchPerformance: BranchPerf[];
  ledger: { items: LedgerRow[]; page: number; pageSize: number; total: number; categories: string[] };
  meta: { granularity: 'monthly' | 'quarterly' | 'yearly'; period: string };
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const fmtMoney = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'ETB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `ETB ${v.toFixed(2)}`;
  }
};

const fmtMoneyCompact = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `ETB ${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `ETB ${(v / 1_000).toFixed(1)}k`;
  return fmtMoney(v);
};

const badge = (kind: 'up' | 'down' | 'flat', pct: number) => {
  if (kind === 'up') {
    return (
      <span className="text-xs font-bold text-green-400 flex items-center gap-1 bg-green-400/10 px-2 py-1 rounded">
        <span className="material-symbols-outlined text-[14px]">trending_up</span>
        {pct.toFixed(1)}%
      </span>
    );
  }
  if (kind === 'down') {
    return (
      <span className="text-xs font-bold text-red-400 flex items-center gap-1 bg-red-400/10 px-2 py-1 rounded">
        <span className="material-symbols-outlined text-[14px]">trending_down</span>
        {Math.abs(pct).toFixed(1)}%
      </span>
    );
  }
  return <span className="text-xs font-bold text-[#c9b792] flex items-center gap-1 bg-[#483c23] px-2 py-1 rounded">0.0%</span>;
};

const statusBadgeClass = (s: LedgerRow['status']) => {
  if (s === 'Paid') return 'bg-primary/20 text-primary border border-primary/20';
  if (s === 'Overdue') return 'bg-red-500/10 text-red-400 border border-red-500/20';
  return 'bg-[#483c23] text-[#c9b792] border border-white/5';
};

export const OwnerFinance: React.FC = () => {
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FinanceResp | null>(null);

  const [search, setSearch] = useState('');
  const [ledgerCategory, setLedgerCategory] = useState('');
  const [ledgerSort, setLedgerSort] = useState<'newest' | 'oldest' | 'amount_desc'>('newest');
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>(() => ({
    at: new Date().toISOString().slice(0, 10),
    transactionId: '',
    vendor: '',
    category: '',
    branchId: '',
    amount: '',
    status: 'Pending',
    dueAt: '',
  }));
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<PortalMenuAnchorRect | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchOpt[]>([]);

  const goToBranches = () => {
    try {
      updateSession({ screen: Screen.OWNER_BRANCHES });
      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }
      try {
        window.location.hash = `#${String(Screen.OWNER_BRANCHES)}`;
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const periodLabel = useMemo(() => {
    const [yy, mm] = period.split('-');
    const d = new Date(Number(yy), Math.max(0, Number(mm) - 1), 1);
    return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  }, [period]);

  const periods = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const value = `${y}-${m}`;
      out.push({ value, label: d.toLocaleString(undefined, { month: 'short', year: 'numeric' }) });
    }
    return out;
  }, []);

  useEffect(() => {
    setPage(1);
  }, [ledgerCategory, ledgerSort, search, granularity, period]);

  const fetchFinance = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('granularity', granularity);
      params.set('period', period);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (ledgerCategory) params.set('category', ledgerCategory);
      if (ledgerSort) params.set('sort', ledgerSort);
      if (search.trim()) params.set('q', search.trim());
      const res = await apiFetch(`/api/owner/finance?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as FinanceResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await apiFetch('/api/branches');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      const rows = Array.isArray(json?.branches) ? (json.branches as any[]) : [];
      setBranches(
        rows
          .map((b) => ({ id: String(b.id || ''), name: String(b.name || '') }))
          .filter((b) => b.id && b.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      setBranches([]);
    }
  };

  const openAddExpense = () => {
    setExpenseDraft({
      at: new Date().toISOString().slice(0, 10),
      transactionId: '',
      vendor: '',
      category: '',
      branchId: '',
      amount: '',
      status: 'Pending',
      dueAt: '',
    });
    setExpenseModalOpen(true);
  };

  const openEditExpense = (r: LedgerRow) => {
    setExpenseDraft({
      id: r.id,
      at: r.date || new Date().toISOString().slice(0, 10),
      transactionId: r.transactionId || '',
      vendor: r.vendor || '',
      category: r.category || '',
      branchId: r.branchId || '',
      amount: String(r.amount ?? ''),
      status: r.status || 'Pending',
      dueAt: '',
    });
    setExpenseModalOpen(true);
  };

  const closeExpenseModal = () => {
    if (expenseSaving) return;
    setExpenseModalOpen(false);
  };

  const submitExpense = async () => {
    if (expenseSaving) return;
    const category = expenseDraft.category.trim() || 'Uncategorized';
    const vendor = expenseDraft.vendor.trim();
    const transactionId = expenseDraft.transactionId.trim();
    const amount = Number(expenseDraft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Invalid amount.');
      return;
    }
    const atIso = expenseDraft.at && !Number.isNaN(new Date(expenseDraft.at).getTime()) ? new Date(expenseDraft.at).toISOString() : '';
    if (!atIso) {
      setError('Invalid date.');
      return;
    }

    setExpenseSaving(true);
    setError(null);
    try {
      const body = {
        category,
        amount,
        at: atIso,
        vendor,
        transactionId,
        status: expenseDraft.status,
        dueAt: expenseDraft.dueAt || '',
        branchId: expenseDraft.branchId,
      };

      const res = await apiFetch(
        expenseDraft.id ? `/api/owner/finance/expenses/${encodeURIComponent(expenseDraft.id)}` : '/api/owner/finance/expenses',
        {
          method: expenseDraft.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setExpenseModalOpen(false);
      await fetchFinance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save expense.');
    } finally {
      setExpenseSaving(false);
    }
  };

  const deleteExpense = async (id: string) => {
    if (!id) return;
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const confirmDeleteExpense = async () => {
    const id = deleteTargetId;
    if (!id) return;
    try {
      const res = await apiFetch(`/api/owner/finance/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      await fetchFinance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete expense.');
    } finally {
      closeDeleteConfirm();
    }
  };

  useEffect(() => {
    fetchFinance();
    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, period, page, pageSize, ledgerCategory, ledgerSort, search]);

  const exportReport = () => {
    if (!data) return;
    const rows = data.ledger.items;
    const header = ['date', 'transactionId', 'vendor', 'category', 'branch', 'amount', 'status'];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.date,
          r.transactionId,
          r.vendor,
          r.category,
          r.branchName,
          r.amount.toFixed(2),
          r.status,
        ]
          .map(esc)
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-${granularity}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const kpis = data?.kpis;
  const pnl = useMemo<PnlPoint[]>(() => {
    const d = data as any;
    if (Array.isArray(d?.pnl)) return d.pnl as PnlPoint[];
    if (Array.isArray(d?.trend)) {
      return (d.trend as any[]).map((x) => ({
        label: String(x?.name ?? ''),
        revenue: Number(x?.revenue) || 0,
        expenses: Number(x?.expenses) || 0,
      }));
    }
    return [];
  }, [data]);
  const branchPerf = data?.branchPerformance || [];
  const ledger = data?.ledger;

  const maxPnl = useMemo(() => {
    const max = pnl.reduce((acc, p) => Math.max(acc, p.revenue, p.expenses), 0);
    return max || 1;
  }, [pnl]);

  const chartData = useMemo(() => {
    const rows = pnl.slice(-6);
    if (rows.length) return rows;
    return Array.from({ length: 6 }).map((_, i) => ({ label: String(i), revenue: 0, expenses: 0 }));
  }, [pnl]);

  const pageCount = useMemo(() => {
    const total = ledger?.total ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [ledger?.total, pageSize]);

  return (
    <div className="bg-gray-50 dark:bg-[#221c10] font-display text-white overflow-hidden h-full flex flex-col">
      <OwnerPageHeader
        title="Finance"
        rightSlot={
          <div className="flex items-center gap-3">
            <div className="hidden md:block relative w-96">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9b792] material-symbols-outlined text-[20px]">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#393328] border-none rounded-lg py-2 pl-10 pr-4 text-sm text-white placeholder:text-[#b9b09d] focus:ring-0"
                placeholder="Search invoices, transactions, branches..."
                type="text"
              />
            </div>
            <button className="size-10 flex items-center justify-center rounded-lg hover:bg-[#483c23] text-[#c9b792] hover:text-white transition-colors relative" type="button">
              <span className="absolute top-2.5 right-2.5 size-2 bg-red-500 rounded-full border border-[#221c10]"></span>
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="size-10 flex items-center justify-center rounded-lg hover:bg-[#483c23] text-[#c9b792] hover:text-white transition-colors" type="button">
              <span className="material-symbols-outlined">help</span>
            </button>
            <button className="size-10 flex items-center justify-center rounded-lg hover:bg-[#483c23] text-[#c9b792] hover:text-white transition-colors" type="button">
              <span className="material-symbols-outlined">settings</span>
            </button>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6 pb-20 scroll-smooth">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <nav className="flex items-center gap-2 text-sm text-[#c9b792]">
              <span className="hover:text-primary transition-colors">Dashboard</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span className="text-white font-medium">Finance &amp; Accounting</span>
            </nav>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center bg-[#483c23] rounded-lg p-1 border border-white/5">
                <button
                  type="button"
                  onClick={() => setGranularity('monthly')}
                  className={cx('px-3 py-1.5 text-xs rounded transition-colors', granularity === 'monthly' ? 'font-bold bg-primary text-[#221c10] shadow-sm' : 'font-medium text-[#c9b792] hover:text-white hover:bg-white/5')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setGranularity('quarterly')}
                  className={cx('px-3 py-1.5 text-xs rounded transition-colors', granularity === 'quarterly' ? 'font-bold bg-primary text-[#221c10] shadow-sm' : 'font-medium text-[#c9b792] hover:text-white hover:bg-white/5')}
                >
                  Quarterly
                </button>
                <button
                  type="button"
                  onClick={() => setGranularity('yearly')}
                  className={cx('px-3 py-1.5 text-xs rounded transition-colors', granularity === 'yearly' ? 'font-bold bg-primary text-[#221c10] shadow-sm' : 'font-medium text-[#c9b792] hover:text-white hover:bg-white/5')}
                >
                  Yearly
                </button>
              </div>

              <div className="relative">
                <div className="flex items-center gap-2 bg-[#483c23] border border-white/5 hover:border-primary/50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all">
                  <span className="material-symbols-outlined text-[18px] text-primary">calendar_month</span>
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="bg-transparent border-none text-sm text-white focus:ring-0 cursor-pointer appearance-none pr-2"
                  >
                    {periods.map((p) => (
                      <option key={p.value} value={p.value} className="text-black">
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined text-[18px] text-[#c9b792]">expand_more</span>
                </div>
              </div>

              <button
                type="button"
                onClick={exportReport}
                className="flex items-center gap-2 bg-primary hover:bg-[#d49a26] text-[#221c10] px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-primary/10 transition-all disabled:opacity-60"
                disabled={!data || loading}
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                <span>Export Report</span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="bg-[#2c241b] border border-red-500/30 rounded-xl p-4 text-sm text-red-200 flex items-center justify-between gap-3">
              <div>Failed to load finance: {error}</div>
              <button onClick={fetchFinance} className="px-4 h-10 rounded-lg bg-primary hover:bg-[#d49a26] text-[#221c10] font-bold">
                Retry
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#2c241b] border border-[#483c23] p-5 rounded-xl flex flex-col gap-4 hover:border-primary/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-[#483c23] rounded-lg text-[#c9b792] group-hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">account_balance_wallet</span>
                </div>
                {badge((kpis?.revenueDeltaPct ?? 0) > 0 ? 'up' : (kpis?.revenueDeltaPct ?? 0) < 0 ? 'down' : 'flat', kpis?.revenueDeltaPct ?? 0)}
              </div>
              <div>
                <p className="text-[#c9b792] text-sm font-medium mb-1">Total Revenue</p>
                <h3 className="text-2xl font-bold text-white tracking-tight tabular-nums">{fmtMoney(kpis?.revenue ?? 0)}</h3>
              </div>
            </div>

            <div className="bg-[#2c241b] border border-[#483c23] p-5 rounded-xl flex flex-col gap-4 hover:border-primary/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-[#483c23] rounded-lg text-[#c9b792] group-hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">savings</span>
                </div>
                {badge((kpis?.netProfitDeltaPct ?? 0) > 0 ? 'up' : (kpis?.netProfitDeltaPct ?? 0) < 0 ? 'down' : 'flat', kpis?.netProfitDeltaPct ?? 0)}
              </div>
              <div>
                <p className="text-[#c9b792] text-sm font-medium mb-1">Net Profit</p>
                <h3 className="text-2xl font-bold text-primary tracking-tight tabular-nums">{fmtMoney(kpis?.netProfit ?? 0)}</h3>
              </div>
            </div>

            <div className="bg-[#2c241b] border border-[#483c23] p-5 rounded-xl flex flex-col gap-4 hover:border-primary/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-[#483c23] rounded-lg text-[#c9b792] group-hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">inventory</span>
                </div>
                {badge((kpis?.cogsDeltaPct ?? 0) > 0 ? 'down' : (kpis?.cogsDeltaPct ?? 0) < 0 ? 'up' : 'flat', kpis?.cogsDeltaPct ?? 0)}
              </div>
              <div>
                <p className="text-[#c9b792] text-sm font-medium mb-1">Total COGS</p>
                <h3 className="text-2xl font-bold text-white tracking-tight tabular-nums">{fmtMoney(kpis?.cogs ?? 0)}</h3>
              </div>
            </div>

            <div className="bg-[#2c241b] border border-[#483c23] p-5 rounded-xl flex flex-col gap-4 hover:border-primary/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-[#483c23] rounded-lg text-[#c9b792] group-hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">shopping_cart</span>
                </div>
                {badge((kpis?.opexDeltaPct ?? 0) > 0 ? 'down' : (kpis?.opexDeltaPct ?? 0) < 0 ? 'up' : 'flat', kpis?.opexDeltaPct ?? 0)}
              </div>
              <div>
                <p className="text-[#c9b792] text-sm font-medium mb-1">Operating Expenses</p>
                <h3 className="text-2xl font-bold text-white tracking-tight tabular-nums">{fmtMoney(kpis?.opex ?? 0)}</h3>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-[#2c241b] border border-[#483c23] rounded-xl p-6 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">Profit &amp; Loss Overview</h3>
                <button className="text-[#c9b792] hover:text-white" type="button" onClick={fetchFinance}>
                  <span className="material-symbols-outlined">refresh</span>
                </button>
              </div>

              <div className="min-h-[320px]">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#483c23" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#c9b792', fontSize: 12 }} axisLine={{ stroke: '#483c23' }} tickLine={{ stroke: '#483c23' }} />
                    <YAxis
                      tick={{ fill: '#c9b792', fontSize: 12 }}
                      axisLine={{ stroke: '#483c23' }}
                      tickLine={{ stroke: '#483c23' }}
                      width={60}
                      tickFormatter={(v) => fmtMoneyCompact(Number(v))}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(72,60,35,0.25)' }}
                      contentStyle={{ background: '#ffffff', border: '1px solid #e6e2db', borderRadius: 10, color: '#221c10' }}
                      labelStyle={{ color: '#221c10', fontWeight: 800 }}
                      formatter={(v: any) => fmtMoney(Number(v))}
                    />
                    <Legend
                      wrapperStyle={{ color: '#c9b792' }}
                      iconType="circle"
                      formatter={(value) => <span style={{ color: '#c9b792', fontWeight: 600 }}>{String(value)}</span>}
                    />
                    <Bar dataKey="revenue" name="Revenue" fill="#eead2b" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#483c23" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-[#2c241b] border border-[#483c23] rounded-xl p-6 flex flex-col">
              <h3 className="text-lg font-bold text-white mb-6">Branch Performance</h3>
              <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2">
                {(loading && !data ? [] : branchPerf).map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-[#483c23]/30 transition-colors border border-transparent hover:border-[#483c23]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg bg-[#221c11] border border-[#483c23] flex items-center justify-center text-[#c9b792]">
                        <span className="material-symbols-outlined">store</span>
                      </div>
                      <div>
                        <p className="text-white text-sm font-bold">{b.name}</p>
                        <p className="text-[#c9b792] text-xs">{b.city}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[#c9b792] text-sm font-bold tabular-nums">{fmtMoney(b.profit)}</p>
                      <p className={cx('text-xs font-medium tabular-nums', b.deltaPct >= 0 ? 'text-[#34c759]' : 'text-[#ff3b3f]')}>
                        {b.deltaPct.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                ))}

                {!loading && (!branchPerf || branchPerf.length === 0) ? (
                  <div className="text-sm text-[#c9b792]">No branches found.</div>
                ) : null}

                <button
                  type="button"
                  onClick={goToBranches}
                  className="mt-auto w-full py-2 text-sm text-primary font-bold hover:bg-[#483c23] rounded-lg transition-colors"
                >
                  View All Branches
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[#2c241b] border border-[#483c23] rounded-xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-[#483c23] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-white">Expense Ledger</h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openAddExpense}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-[#d49a26] text-[#221c10] text-sm font-bold"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#c9b792] material-symbols-outlined text-[18px]">filter_list</span>
                  <select
                    value={ledgerCategory}
                    onChange={(e) => setLedgerCategory(e.target.value)}
                    className="bg-[#483c23] border-none text-sm text-white rounded-lg pl-9 pr-8 py-2 focus:ring-1 focus:ring-primary cursor-pointer appearance-none"
                  >
                    <option value="">All Categories</option>
                    {(ledger?.categories || []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#c9b792] material-symbols-outlined text-[18px]">sort</span>
                  <select
                    value={ledgerSort}
                    onChange={(e) => setLedgerSort(e.target.value as any)}
                    className="bg-[#483c23] border-none text-sm text-white rounded-lg pl-9 pr-8 py-2 focus:ring-1 focus:ring-primary cursor-pointer appearance-none"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="amount_desc">Amount: High to Low</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#483c23]/30 border-b border-[#483c23]">
                    <th className="p-4 pl-6 text-xs font-bold text-[#c9b792] uppercase tracking-wider">Date</th>
                    <th className="p-4 text-xs font-bold text-[#c9b792] uppercase tracking-wider">Transaction ID</th>
                    <th className="p-4 text-xs font-bold text-[#c9b792] uppercase tracking-wider">Vendor / Payee</th>
                    <th className="p-4 text-xs font-bold text-[#c9b792] uppercase tracking-wider">Category</th>
                    <th className="p-4 text-xs font-bold text-[#c9b792] uppercase tracking-wider">Branch</th>
                    <th className="p-4 text-xs font-bold text-[#c9b792] uppercase tracking-wider text-right">Amount</th>
                    <th className="p-4 pr-6 text-xs font-bold text-[#c9b792] uppercase tracking-wider text-center">Status</th>
                    <th className="p-4 pr-6 text-xs font-bold text-[#c9b792] uppercase tracking-wider text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#483c23]">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-sm text-[#c9b792]">
                        Loading ¦
                      </td>
                    </tr>
                  ) : ledger?.items?.length ? (
                    ledger.items.map((r) => (
                      <tr key={r.id} className="hover:bg-[#483c23]/20 transition-colors group cursor-pointer">
                        <td className="p-4 pl-6 text-sm text-white font-medium">{r.date}</td>
                        <td className="p-4 text-sm text-[#c9b792] font-mono">{r.transactionId}</td>
                        <td className="p-4 text-sm text-white font-bold flex items-center gap-2">
                          <div className="size-6 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">{r.vendorInitial}</div>
                          {r.vendor}
                        </td>
                        <td className="p-4 text-sm text-[#c9b792]">{r.category}</td>
                        <td className="p-4 text-sm text-[#c9b792]">{r.branchName}</td>
                        <td className="p-4 text-sm text-white font-bold text-right tabular-nums">{fmtMoney(r.amount)}</td>
                        <td className="p-4 pr-6 text-center">
                          <span className={cx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold', statusBadgeClass(r.status))}>{r.status}</span>
                        </td>
                        <td className="p-4 pr-6 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="text-[#c9b792] hover:text-white transition-colors"
                            onMouseDown={(ev) => {
                              ev.stopPropagation();
                            }}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              let rect: any = null;
                              try {
                                rect = (ev.currentTarget as any)?.getBoundingClientRect?.() || null;
                              } catch {
                                rect = null;
                              }
                              setRowMenuId((prev) => {
                                const next = prev === r.id ? null : r.id;
                                if (!next) {
                                  setRowMenuAnchor(null);
                                  return null;
                                }
                                if (rect) {
                                  setRowMenuAnchor({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                                } else {
                                  setRowMenuAnchor(null);
                                }
                                return next;
                              });
                            }}
                          >
                            <span className="material-symbols-outlined">more_vert</span>
                          </button>
                          <PortalMenu
                            open={rowMenuId === r.id}
                            anchorRect={rowMenuId === r.id ? rowMenuAnchor : null}
                            onClose={() => {
                              setRowMenuId(null);
                              setRowMenuAnchor(null);
                            }}
                            width={220}
                          >
                            <button
                              type="button"
                              className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b]"
                              onClick={() => {
                                openEditExpense(r);
                                setRowMenuId(null);
                                setRowMenuAnchor(null);
                              }}
                            >
                              Edit
                            </button>
                            <div className="h-px bg-[#675532]/40" />
                            <button
                              type="button"
                              className="w-full px-4 py-3 text-left text-sm hover:bg-[#2c241b] text-red-300"
                              onClick={async () => {
                                setRowMenuId(null);
                                setRowMenuAnchor(null);
                                await deleteExpense(r.id);
                              }}
                            >
                              Delete
                            </button>
                          </PortalMenu>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-6 text-sm text-[#c9b792]">
                        No transactions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-[#483c23] flex items-center justify-between text-sm text-[#c9b792]">
              <span>
                Showing {(ledger?.total ?? 0) ? (page - 1) * pageSize + 1 : 0}-{(ledger?.total ?? 0) ? Math.min(ledger!.total, page * pageSize) : 0} of {ledger?.total ?? 0} transactions
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="size-8 flex items-center justify-center rounded hover:bg-[#483c23] text-white disabled:opacity-50"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                <button type="button" className="size-8 flex items-center justify-center rounded bg-primary text-[#221c10] font-bold">
                  {page}
                </button>
                <button
                  type="button"
                  className="size-8 flex items-center justify-center rounded hover:bg-[#483c23] text-white hover:text-primary disabled:opacity-50"
                  disabled={page >= pageCount || loading}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
          </div>

          <div className="text-xs text-[#c9b792] opacity-70">Period: {periodLabel}</div>
        </div>
      </main>

      {expenseModalOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeExpenseModal();
          }}
        >
          <div className="w-full max-w-xl rounded-2xl bg-[#2c241b] border border-[#483c23] overflow-hidden">
            <div className="p-5 border-b border-[#483c23] flex items-center justify-between">
              <div>
                <div className="text-white font-extrabold">{expenseDraft.id ? 'Edit Expense' : 'Add Expense'}</div>
                <div className="text-xs text-[#c9b792] mt-1">Saved to MySQL finance ledger</div>
              </div>
              <button type="button" className="text-[#c9b792] hover:text-white" onClick={closeExpenseModal}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Date</span>
                <input
                  value={expenseDraft.at}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, at: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="date"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Status</span>
                <select
                  value={expenseDraft.status}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, status: e.target.value as any }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                >
                  <option value="Pending">Pending</option>
                  <option value="Paid">Paid</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Vendor / Payee</span>
                <input
                  value={expenseDraft.vendor}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, vendor: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="text"
                  placeholder="e.g., DailyFresh"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Category</span>
                <input
                  value={expenseDraft.category}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, category: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="text"
                  placeholder="e.g., Utilities"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Amount (ETB)</span>
                <input
                  value={expenseDraft.amount}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, amount: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Transaction ID</span>
                <input
                  value={expenseDraft.transactionId}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, transactionId: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="text"
                  placeholder="Auto"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Due Date</span>
                <input
                  value={expenseDraft.dueAt}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, dueAt: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                  type="date"
                />
              </label>

              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#c9b792]">Branch</span>
                <select
                  value={expenseDraft.branchId}
                  onChange={(e) => setExpenseDraft((d) => ({ ...d, branchId: e.target.value }))}
                  className="h-11 rounded-lg bg-[#483c23] border border-white/5 px-3 text-sm text-white"
                >
                  <option value="">All / Not specific</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="p-5 border-t border-[#483c23] flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-11 px-4 rounded-lg border border-[#483c23] text-[#c9b792] hover:text-white hover:bg-[#483c23]/40"
                onClick={closeExpenseModal}
                disabled={expenseSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-11 px-5 rounded-lg bg-primary hover:bg-[#d49a26] text-[#221c10] font-bold disabled:opacity-60"
                onClick={submitExpense}
                disabled={expenseSaving}
              >
                {expenseSaving ? 'Saving ¦' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDeleteConfirm();
          }}
        >
          <div className="w-full max-w-[520px] rounded-2xl border border-[#483c23] bg-[#221c10] shadow-2xl">
            <div className="p-5 border-b border-[#483c23] flex items-start justify-between gap-4">
              <div>
                <div className="text-white text-lg font-black">Delete Expense</div>
                <div className="text-[#c9b792] text-sm mt-1">This cannot be undone.</div>
              </div>
              <button type="button" onClick={closeDeleteConfirm} className="p-1.5 rounded-md hover:bg-[#483c23] text-[#c9b792] hover:text-white">
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>
            <div className="p-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-11 px-4 rounded-lg border border-[#483c23] text-[#c9b792] hover:text-white hover:bg-[#483c23]/40"
                onClick={closeDeleteConfirm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-11 px-5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold"
                onClick={confirmDeleteExpense}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default OwnerFinance;
