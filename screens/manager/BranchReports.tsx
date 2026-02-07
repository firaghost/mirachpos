import React, { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { readSession, updateSession } from '../../session';
import { formatDeviceDate, formatDeviceDateTime } from '../../datetime';
import {
  formatCurrency,
  formatReadableDate,
  formatReadableDateTime,
} from '../../utils/exportUtils';

import { AppIcon } from '@/components/ui/app-icon';
type Period = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

type DateMode = 'Period' | 'Custom';

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

type DailyAggPoint = {
  date: string;
  orderCount: number;
  netSales: number;
  totalCollected: number;
  paymentBreakdown?: Record<string, any>;
};

type HourlyAggPoint = {
  hour: number;
  orderCount: number;
  netSales: number;
  totalCollected: number;
};

type ProductAggRow = {
  productId: string;
  name: string;
  category: string;
  qtySold: number;
  revenue: number;
  cost: number;
  profit: number;
  voidQty: number;
};

type CategoryAggRow = {
  category: string;
  qtySold: number;
  revenue: number;
  orderCount: number;
};

type StaffAggRow = {
  staffId: string;
  staffName: string;
  orderCount: number;
  netSales: number;
  grossSales: number;
  discounts: number;
  tax: number;
  tips: number;
  totalCollected: number;
};

type ShiftAggRow = {
  id: string;
  staffName: string;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number | null;
  closingCash: number | null;
  cashDifference: number | null;
  totalCollected: number;
  orderCount: number;
};

type VoidRefundEvent = {
  id: string;
  occurredAt: string | null;
  type: string;
  orderId: string;
  productName: string;
  qty: number;
  amount: number;
  reason: string;
  authorizedBy: string;
  performedBy: string;
};

type Expense = {
  id: string;
  title: string;
  vendor: string;
  amount: number;
  createdAt: string;
  icon: 'local_shipping' | 'build' | 'sanitizer' | 'receipt_long';
};

type StaffMember = {
  id: string;
  name: string;
  role: string;
  phone: string;
  status: 'Active' | 'On Leave';
  shift: string;
  avatar: string;
};

type ShiftLog = {
  id: string;
  staffId: string;
  clockInAt: string;
  clockOutAt?: string;
};

type BusinessHeader = {
  businessName: string;
  legalName: string;
  tin: string;
  phone: string;
  email: string;
  address: string;
  receipt: { showTin: boolean; logoDataUrl: string };
};

type ManagerReportsResp = {
  ok: boolean;
  branchId: string;
  businessHeader?: BusinessHeader;
  staff: StaffMember[];
  shiftLogs: ShiftLog[];
  cashSessions: CashSession[];
  expenses: Expense[];
};

type StatusSummaryResp = {
  ok: boolean;
  branchId: string;
  from: string;
  to: string;
  summary: {
    from: string;
    to: string;
    paid: { count: number; totalCollected: number };
    nonPaid: { count: number };
    byStatus: Record<string, number>;
    voidRefund: Record<string, { count: number; amount: number }>;
  };
};

type PaymentTx = {
  id: string;
  number: string;
  tableName: string;
  createdByStaffId: string;
  createdByName: string;
  items: Array<{ productId: string; name: string; qty: number; unitPrice: number }>;
  total: number;
  tax: number;
  tip: number;
  discount: number;
  discountPct?: number;
  createdAt: string | null;
  paidAt: string | null;
  method: string;
  reference: string;
  tenderedAmount: number | null;
};

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

const isWorkerRole = (role: string) => {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return true;
  if (r.includes('owner')) return false;
  if (r.includes('manager')) return false;
  if (r.includes('admin')) return false;
  return true;
};

const formatDateLabel = (d: Date) => formatDeviceDate(d, { month: 'short', day: '2-digit', year: 'numeric' });

const toLocalDateOnly = (d: Date) => {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseIsoDate = (iso: string) => {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(String(iso ?? ''));
  if (!m) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const BranchReports: React.FC = () => {
  const [remote, setRemote] = useState<ManagerReportsResp | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [statusSummary, setStatusSummary] = useState<StatusSummaryResp['summary'] | null>(null);
  const [payments, setPayments] = useState<PaymentTx[]>([]);
  const [paymentsPrev, setPaymentsPrev] = useState<PaymentTx[]>([]);
  const [dailyAgg, setDailyAgg] = useState<DailyAggPoint[]>([]);
  const [hourlyAgg, setHourlyAgg] = useState<HourlyAggPoint[]>([]);
  const [productAgg, setProductAgg] = useState<ProductAggRow[]>([]);
  const [categoryAgg, setCategoryAgg] = useState<CategoryAggRow[]>([]);
  const [shiftAgg, setShiftAgg] = useState<ShiftAggRow[]>([]);
  const [voidAgg, setVoidAgg] = useState<VoidRefundEvent[]>([]);
  const [staffAgg, setStaffAgg] = useState<StaffAggRow[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [period, setPeriod] = useState<Period>('Daily');
  const [showAll, setShowAll] = useState(false);
  const [dateMode, setDateMode] = useState<DateMode>('Period');
  const [fromDate, setFromDate] = useState<string>(() => toLocalDateOnly(startOfDay(new Date())));
  const [toDate, setToDate] = useState<string>(() => toLocalDateOnly(startOfDay(new Date())));
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const rangeWindow = useMemo(() => {
    const now = new Date();
    const end = startOfDay(now);
    if (period === 'Daily') return { start: end, end: end };
    if (period === 'Weekly') return { start: addDays(end, -6), end };
    if (period === 'Monthly') return { start: addDays(end, -29), end };
    return { start: addDays(end, -364), end };
  }, [period]);

  const effectiveRange = useMemo(() => {
    if (dateMode !== 'Custom') return rangeWindow;
    const from = parseIsoDate(fromDate);
    const to = parseIsoDate(toDate);
    if (!from || !to) return rangeWindow;
    const start = startOfDay(from);
    const end = startOfDay(to);
    return { start, end };
  }, [dateMode, fromDate, rangeWindow, toDate]);

  useEffect(() => {
    if (dateMode !== 'Period') return;
    setFromDate(toLocalDateOnly(rangeWindow.start));
    setToDate(toLocalDateOnly(rangeWindow.end));
  }, [dateMode, rangeWindow.end, rangeWindow.start]);

  const prevRangeWindow = useMemo(() => {
    const days = dateMode === 'Custom' ? Math.max(1, Math.round((effectiveRange.end.getTime() - effectiveRange.start.getTime()) / (1000 * 60 * 60 * 24))) : period === 'Daily' ? 1 : period === 'Weekly' ? 7 : 30;
    const end = effectiveRange.start;
    const start = addDays(end, -days);
    return { start, end };
  }, [dateMode, effectiveRange.end, effectiveRange.start, period]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const session = readSession<any>();

        const role = typeof session?.role === 'string' ? session.role : '';
        const branchId = typeof session?.branchId === 'string' ? session.branchId : '';
        const branchOverride =
          role === 'Cafe Owner' && (!branchId || branchId === 'global')
            ? (() => {
              try {
                return localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
              } catch {
                return '';
              }
            })()
            : '';

        if (role === 'Cafe Owner' && (!branchId || branchId === 'global') && !branchOverride) {
          throw new Error('select_branch');
        }

        const qs = new URLSearchParams();
        if (branchOverride) qs.set('branchId', branchOverride);
        qs.set('from', toLocalDateOnly(effectiveRange.start));
        qs.set('to', toLocalDateOnly(effectiveRange.end));
        const url = `/api/manager/reports?${qs.toString()}`;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ManagerReportsResp;
        if (!mounted) return;
        setRemote(json);
      } catch (e) {
        if (!mounted) return;
        setRemote(null);
        setRemoteError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!mounted) return;
        setRemoteLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [effectiveRange.end, effectiveRange.start]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/branches');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.branches) ? (json.branches as any[]) : [];
        const next = rows
          .map((b) => ({ id: String(b?.id || ''), name: String(b?.name || '') }))
          .filter((b) => b.id && b.name);
        if (!mounted) return;
        setBranches(next);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const session = readSession<any>();
        const role = typeof session?.role === 'string' ? session.role : '';
        const branchId = typeof session?.branchId === 'string' ? session.branchId : '';
        const branchOverride =
          role === 'Cafe Owner' && (!branchId || branchId === 'global')
            ? (() => {
              try {
                return localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
              } catch {
                return '';
              }
            })()
            : '';

        const fetchRange = async (from: string, to: string) => {
          const qs = new URLSearchParams({ from, to, limit: '500' });
          if (branchOverride) qs.set('branchId', branchOverride);
          const res = await apiFetch(`/api/manager/payments?${qs.toString()}`);
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
          const rows = Array.isArray(json?.payments) ? (json.payments as any[]) : [];
          return rows
            .map((p) => ({
              id: String(p.id || ''),
              number: String(p.number || ''),
              tableName: String(p.tableName || ''),
              createdByStaffId: String(p.createdByStaffId || ''),
              createdByName: String(p.createdByName || ''),
              items: Array.isArray(p.items)
                ? p.items
                  .map((it: any) => ({
                    productId: String(it?.productId || ''),
                    name: String(it?.name || ''),
                    qty: Number(it?.qty ?? 0) || 0,
                    unitPrice: Number(it?.unitPrice ?? 0) || 0,
                  }))
                  .filter((it: any) => (it.productId || it.name) && Number(it.qty) > 0)
                : [],
              total: Number(p.total ?? 0) || 0,
              tax: Number(p.tax ?? 0) || 0,
              tip: Number(p.tip ?? 0) || 0,
              discount: Number(p.discount ?? 0) || 0,
              discountPct: p.discountPct == null ? undefined : Number(p.discountPct ?? 0) || 0,
              createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
              paidAt: typeof p.paidAt === 'string' ? p.paidAt : null,
              method: String(p.method || 'Unknown'),
              reference: String(p.reference || ''),
              tenderedAmount: p.tenderedAmount == null ? null : Number(p.tenderedAmount ?? 0) || 0,
            }))
            .filter((x) => x.id);
        };

        const from = toLocalDateOnly(effectiveRange.start);
        const to = toLocalDateOnly(effectiveRange.end);
        const fromPrev = toLocalDateOnly(prevRangeWindow.start);
        const toPrev = toLocalDateOnly(prevRangeWindow.end);

        const [cur, prev] = await Promise.all([fetchRange(from, to), fetchRange(fromPrev, toPrev)]);

        if (!mounted) return;
        setPayments(cur);
        setPaymentsPrev(prev);
      } catch {
        if (!mounted) return;
        setPayments([]);
        setPaymentsPrev([]);
      }
    };
    run();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRange.end, effectiveRange.start, prevRangeWindow.end, prevRangeWindow.start]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const session = readSession<any>();
        const role = typeof session?.role === 'string' ? session.role : '';
        const branchId = typeof session?.branchId === 'string' ? session.branchId : '';
        const branchOverride =
          role === 'Cafe Owner' && (!branchId || branchId === 'global')
            ? (() => {
              try {
                return localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
              } catch {
                return '';
              }
            })()
            : '';

        const fromDate = toLocalDateOnly(effectiveRange.start);
        const toDate = toLocalDateOnly(effectiveRange.end);
        const qsDaily = new URLSearchParams({ from: fromDate, to: toDate, limit: '400' });
        if (branchOverride) qsDaily.set('branchId', branchOverride);

        const dailyRes = await apiFetch(`/api/manager/reports/daily?${qsDaily.toString()}`);
        const dailyJson = (await dailyRes.json().catch(() => null)) as any;
        const dailyRows = Array.isArray(dailyJson?.daily) ? (dailyJson.daily as any[]) : [];

        const mappedDaily: DailyAggPoint[] = dailyRows
          .map((r) => ({
            date: String(r?.date || ''),
            orderCount: Number(r?.orderCount ?? 0) || 0,
            netSales: Number(r?.netSales ?? 0) || 0,
            totalCollected: Number(r?.totalCollected ?? 0) || 0,
            paymentBreakdown: r?.paymentBreakdown && typeof r.paymentBreakdown === 'object' ? r.paymentBreakdown : undefined,
          }))
          .filter((r) => r.date);

        let mappedHourly: HourlyAggPoint[] = [];
        if (period === 'Daily') {
          const day = toLocalDateOnly(effectiveRange.start);
          const qsHourly = new URLSearchParams({ date: day });
          if (branchOverride) qsHourly.set('branchId', branchOverride);
          const hRes = await apiFetch(`/api/manager/reports/hourly?${qsHourly.toString()}`);
          const hJson = (await hRes.json().catch(() => null)) as any;
          const hrs = Array.isArray(hJson?.hourly) ? (hJson.hourly as any[]) : [];
          mappedHourly = hrs
            .map((x) => ({
              hour: Number(x?.hour ?? 0) || 0,
              orderCount: Number(x?.orderCount ?? 0) || 0,
              netSales: Number(x?.netSales ?? 0) || 0,
              totalCollected: Number(x?.totalCollected ?? 0) || 0,
            }))
            .filter((x) => x.hour >= 0 && x.hour <= 23);
        }

        const qsProd = new URLSearchParams({ from: fromDate, to: toDate, limit: '50' });
        if (branchOverride) qsProd.set('branchId', branchOverride);
        const pRes = await apiFetch(`/api/manager/reports/products?${qsProd.toString()}`);
        const pJson = (await pRes.json().catch(() => null)) as any;
        const prodRows = Array.isArray(pJson?.products) ? (pJson.products as any[]) : [];
        const mappedProducts: ProductAggRow[] = prodRows
          .map((r) => ({
            productId: String(r?.productId || ''),
            name: String(r?.name || ''),
            category: String(r?.category || ''),
            qtySold: Number(r?.qtySold ?? 0) || 0,
            revenue: Number(r?.revenue ?? 0) || 0,
            cost: Number(r?.cost ?? 0) || 0,
            profit: Number(r?.profit ?? 0) || 0,
            voidQty: Number(r?.voidQty ?? 0) || 0,
          }))
          .filter((r) => r.productId || r.name);

        const qsCat = new URLSearchParams({ from: fromDate, to: toDate, limit: '50' });
        if (branchOverride) qsCat.set('branchId', branchOverride);
        const cRes = await apiFetch(`/api/manager/reports/categories?${qsCat.toString()}`);
        const cJson = (await cRes.json().catch(() => null)) as any;
        const catRows = Array.isArray(cJson?.categories) ? (cJson.categories as any[]) : [];
        const mappedCategories: CategoryAggRow[] = catRows
          .map((r) => ({
            category: String(r?.category || ''),
            qtySold: Number(r?.qtySold ?? 0) || 0,
            revenue: Number(r?.revenue ?? 0) || 0,
            orderCount: Number(r?.orderCount ?? 0) || 0,
          }))
          .filter((r) => r.category);

        const shiftFrom = `${toLocalDateOnly(effectiveRange.start)}T00:00:00.000Z`;
        const shiftTo = `${toLocalDateOnly(effectiveRange.end)}T23:59:59.999Z`;
        const qsShift = new URLSearchParams({ from: shiftFrom, to: shiftTo, limit: '100' });
        if (branchOverride) qsShift.set('branchId', branchOverride);
        const sRes = await apiFetch(`/api/manager/reports/shifts?${qsShift.toString()}`);
        const sJson = (await sRes.json().catch(() => null)) as any;
        const shiftRows = Array.isArray(sJson?.shifts) ? (sJson.shifts as any[]) : [];
        const mappedShifts: ShiftAggRow[] = shiftRows
          .map((r) => ({
            id: String(r?.id || ''),
            staffName: String(r?.staffName || ''),
            status: String(r?.status || ''),
            openedAt: r?.openedAt ? String(r.openedAt) : null,
            closedAt: r?.closedAt ? String(r.closedAt) : null,
            openingCash: Number(r?.openingCash ?? 0) || 0,
            expectedCash: r?.expectedCash == null ? null : Number(r.expectedCash ?? 0) || 0,
            closingCash: r?.closingCash == null ? null : Number(r.closingCash ?? 0) || 0,
            cashDifference: r?.cashDifference == null ? null : Number(r.cashDifference ?? 0) || 0,
            totalCollected: Number(r?.totalCollected ?? r?.netSales ?? 0) || 0,
            orderCount: Number(r?.orderCount ?? 0) || 0,
          }))
          .filter((r) => r.id);

        const voidFrom = `${toLocalDateOnly(effectiveRange.start)}T00:00:00.000Z`;
        const voidTo = `${toLocalDateOnly(effectiveRange.end)}T23:59:59.999Z`;
        const qsVoid = new URLSearchParams({ from: voidFrom, to: voidTo, limit: '200' });
        if (branchOverride) qsVoid.set('branchId', branchOverride);
        const vRes = await apiFetch(`/api/manager/reports/voids?${qsVoid.toString()}`);
        const vJson = (await vRes.json().catch(() => null)) as any;
        const vRows = Array.isArray(vJson?.events) ? (vJson.events as any[]) : [];
        const mappedVoids: VoidRefundEvent[] = vRows
          .map((r) => ({
            id: String(r?.id || ''),
            occurredAt: r?.occurredAt ? String(r.occurredAt) : null,
            type: String(r?.type || ''),
            orderId: String(r?.orderId || ''),
            productName: String(r?.productName || ''),
            qty: Number(r?.qty ?? 0) || 0,
            amount: Number(r?.amount ?? 0) || 0,
            reason: String(r?.reason || ''),
            authorizedBy: String(r?.authorizedBy || ''),
            performedBy: String(r?.performedBy || ''),
          }))
          .filter((r) => r.id);

        const qsStaff = new URLSearchParams({ from: fromDate, to: toDate, limit: '300' });
        if (branchOverride) qsStaff.set('branchId', branchOverride);
        const stRes = await apiFetch(`/api/manager/reports/staff?${qsStaff.toString()}`);
        const stJson = (await stRes.json().catch(() => null)) as any;
        const stRows = Array.isArray(stJson?.staff) ? (stJson.staff as any[]) : [];
        const mappedStaff: StaffAggRow[] = stRows
          .map((r) => ({
            staffId: String(r?.staffId || ''),
            staffName: String(r?.staffName || ''),
            orderCount: Number(r?.orderCount ?? 0) || 0,
            netSales: Number(r?.netSales ?? 0) || 0,
            grossSales: Number(r?.grossSales ?? 0) || 0,
            discounts: Number(r?.discounts ?? 0) || 0,
            tax: Number(r?.tax ?? 0) || 0,
            tips: Number(r?.tips ?? 0) || 0,
            totalCollected: Number(r?.totalCollected ?? 0) || 0,
          }))
          .filter((r) => r.staffId || r.staffName);

        const qsStatus = new URLSearchParams({ from: fromDate, to: toDate });
        if (branchOverride) qsStatus.set('branchId', branchOverride);
        const statusRes = await apiFetch(`/api/manager/reports/status-summary?${qsStatus.toString()}`);
        const statusJson = (await statusRes.json().catch(() => null)) as any;
        const summary =
          statusRes.ok && statusJson?.summary && typeof statusJson.summary === 'object'
            ? (statusJson.summary as StatusSummaryResp['summary'])
            : null;

        if (!mounted) return;
        if (dailyRes.ok) setDailyAgg(mappedDaily);
        if (mappedHourly.length > 0) setHourlyAgg(mappedHourly);
        else setHourlyAgg([]);
        if (pRes.ok) setProductAgg(mappedProducts);
        if (cRes.ok) setCategoryAgg(mappedCategories);
        if (sRes.ok) setShiftAgg(mappedShifts);
        if (vRes.ok) setVoidAgg(mappedVoids);
        if (stRes.ok) setStaffAgg(mappedStaff);
        setStatusSummary(summary);
      } catch {
        if (!mounted) return;
        setDailyAgg([]);
        setHourlyAgg([]);
        setProductAgg([]);
        setCategoryAgg([]);
        setShiftAgg([]);
        setVoidAgg([]);
        setStaffAgg([]);
        setStatusSummary(null);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [effectiveRange.end, effectiveRange.start, period]);

  const nonPaidRows = useMemo(() => {
    const s = statusSummary;
    if (!s) return [] as Array<{ status: string; count: number }>;
    const terminal = new Set(['Paid', 'Voided', 'Refunded']);
    const rows = Object.entries(s.byStatus || {})
      .map(([status, count]) => ({ status, count: Number(count || 0) || 0 }))
      .filter((r) => r.count > 0 && !terminal.has(r.status));
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [statusSummary]);

  const voidRefundTotals = useMemo(() => {
    const s = statusSummary;
    if (!s) return { voidCount: 0, voidAmount: 0, refundCount: 0, refundAmount: 0 };
    const v = s.voidRefund || {};
    const voidRow = v.void || v.VOID || v.Void;
    const refundRow = v.refund || v.REFUND || v.Refund;
    return {
      voidCount: Number(voidRow?.count ?? 0) || 0,
      voidAmount: Number(voidRow?.amount ?? 0) || 0,
      refundCount: Number(refundRow?.count ?? 0) || 0,
      refundAmount: Number(refundRow?.amount ?? 0) || 0,
    };
  }, [statusSummary]);

  const openBranchSelect = () => {
    try {
      updateSession({ screen: Screen.BRANCH_SELECT });
    } catch {
      // ignore
    }
    window.location.reload();
  };

  const expenses = useMemo(() => (remote?.expenses && Array.isArray(remote.expenses) ? remote.expenses : []), [remote]);
  const staff = useMemo(() => (remote?.staff && Array.isArray(remote.staff) ? remote.staff : []), [remote]);
  const shiftLogs = useMemo(() => (remote?.shiftLogs && Array.isArray(remote.shiftLogs) ? remote.shiftLogs : []), [remote]);
  const cashSessions = useMemo(() => (remote?.cashSessions && Array.isArray(remote.cashSessions) ? remote.cashSessions : []), [remote]);

  const paymentsScoped = useMemo(() => {
    if (!selectedStaffId) return payments;
    return payments.filter((p) => String(p.createdByStaffId || '') === String(selectedStaffId));
  }, [payments, selectedStaffId]);

  const paymentsPrevScoped = useMemo(() => {
    if (!selectedStaffId) return paymentsPrev;
    return paymentsPrev.filter((p) => String(p.createdByStaffId || '') === String(selectedStaffId));
  }, [paymentsPrev, selectedStaffId]);

  const businessHeader = useMemo<BusinessHeader | null>(() => {
    const bh = remote?.businessHeader && typeof remote.businessHeader === 'object' ? (remote.businessHeader as any) : null;
    if (!bh) return null;
    const receipt = bh.receipt && typeof bh.receipt === 'object' ? bh.receipt : {};
    return {
      businessName: String(bh.businessName || '').trim(),
      legalName: String(bh.legalName || '').trim(),
      tin: String(bh.tin || '').trim(),
      phone: String(bh.phone || '').trim(),
      email: String(bh.email || '').trim(),
      address: String(bh.address || '').trim(),
      receipt: {
        showTin: typeof receipt.showTin === 'boolean' ? receipt.showTin : true,
        logoDataUrl: typeof receipt.logoDataUrl === 'string' ? receipt.logoDataUrl : '',
      },
    };
  }, [remote]);

  const paymentsSorted = useMemo(() => {
    return [...paymentsScoped].sort((a, b) => {
      const atA = new Date(a.paidAt ?? a.createdAt ?? '').getTime();
      const atB = new Date(b.paidAt ?? b.createdAt ?? '').getTime();
      return (Number.isFinite(atB) ? atB : 0) - (Number.isFinite(atA) ? atA : 0);
    });
  }, [paymentsScoped]);

  const totalRevenue = useMemo(() => paymentsScoped.reduce((sum, p) => sum + (p.total ?? 0), 0), [paymentsScoped]);
  const ordersProcessed = useMemo(() => paymentsScoped.length, [paymentsScoped.length]);
  const avgOrderValue = useMemo(() => (ordersProcessed ? totalRevenue / ordersProcessed : 0), [ordersProcessed, totalRevenue]);

  const totalRevenuePrev = useMemo(() => paymentsPrevScoped.reduce((sum, p) => sum + (p.total ?? 0), 0), [paymentsPrevScoped]);
  const ordersProcessedPrev = useMemo(() => paymentsPrevScoped.length, [paymentsPrevScoped.length]);
  const avgOrderValuePrev = useMemo(() => (ordersProcessedPrev ? totalRevenuePrev / ordersProcessedPrev : 0), [ordersProcessedPrev, totalRevenuePrev]);

  const expensesInRange = useMemo(() => {
    const startMs = effectiveRange.start.getTime();
    const endMs = effectiveRange.end.getTime();
    return expenses.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= startMs && t < endMs;
    });
  }, [effectiveRange.end, effectiveRange.start, expenses]);

  const expensesPrev = useMemo(() => {
    const startMs = prevRangeWindow.start.getTime();
    const endMs = prevRangeWindow.end.getTime();
    return expenses.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= startMs && t < endMs;
    });
  }, [expenses, prevRangeWindow.end, prevRangeWindow.start]);

  const totalExpenses = useMemo(() => expensesInRange.reduce((sum, e) => sum + (e.amount ?? 0), 0), [expensesInRange]);
  const totalExpensesPrev = useMemo(() => expensesPrev.reduce((sum, e) => sum + (e.amount ?? 0), 0), [expensesPrev]);
  const netProfit = useMemo(() => totalRevenue - totalExpenses, [totalExpenses, totalRevenue]);
  const netProfitPrev = useMemo(() => totalRevenuePrev - totalExpensesPrev, [totalExpensesPrev, totalRevenuePrev]);

  const pctDelta = (cur: number, prev: number) => {
    const p = Number.isFinite(prev) && Math.abs(prev) > 0.000001 ? prev : 0;
    if (!p) return cur ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  };

  const revenueDelta = useMemo(() => pctDelta(totalRevenue, totalRevenuePrev), [totalRevenue, totalRevenuePrev]);
  const profitDelta = useMemo(() => pctDelta(netProfit, netProfitPrev), [netProfit, netProfitPrev]);
  const ordersDelta = useMemo(() => pctDelta(ordersProcessed, ordersProcessedPrev), [ordersProcessed, ordersProcessedPrev]);
  const aovDelta = useMemo(() => pctDelta(avgOrderValue, avgOrderValuePrev), [avgOrderValue, avgOrderValuePrev]);

  const paymentBreakdown = useMemo(() => {
    if (selectedStaffId) {
      const m = new Map<string, { sum: number; count: number }>();
      for (const p of paymentsScoped) {
        const key = p.method || 'Unknown';
        const cur = m.get(key) ?? { sum: 0, count: 0 };
        cur.sum += p.total ?? 0;
        cur.count += 1;
        m.set(key, cur);
      }
      return Array.from(m.entries()).sort((a, b) => b[1].sum - a[1].sum);
    }

    const agg = new Map<string, { sum: number; count: number }>();
    for (const d of dailyAgg) {
      const pb = d.paymentBreakdown && typeof d.paymentBreakdown === 'object' ? d.paymentBreakdown : null;
      if (!pb) continue;
      for (const [k, raw] of Object.entries(pb)) {
        const key = String(k || '').trim() || 'Unknown';
        const amount = Number(raw ?? 0) || 0;
        const cur = agg.get(key) ?? { sum: 0, count: 0 };
        cur.sum += amount;
        cur.count += amount !== 0 ? 1 : 0;
        agg.set(key, cur);
      }
    }
    if (agg.size > 0) return Array.from(agg.entries()).sort((a, b) => b[1].sum - a[1].sum);

    const m = new Map<string, { sum: number; count: number }>();
    for (const p of paymentsScoped) {
      const key = p.method || 'Unknown';
      const cur = m.get(key) ?? { sum: 0, count: 0 };
      cur.sum += p.total ?? 0;
      cur.count += 1;
      m.set(key, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].sum - a[1].sum);
  }, [dailyAgg, paymentsScoped, selectedStaffId]);

  const topCategories = useMemo(() => {
    if (categoryAgg.length > 0) {
      const sorted = [...categoryAgg].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
      const max = Math.max(1, ...sorted.map((s) => s.revenue));
      return sorted.map((s) => {
        const rev = Number((s as any)?.revenue ?? 0) || 0;
        const pct = max > 0 ? (rev / max) * 100 : 0;
        return { ...s, pct: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0 };
      });
    }
    const map = new Map<string, number>();
    for (const p of paymentsScoped) {
      for (const it of p.items) {
        const cat = String((it as any)?.category || '').trim() || 'Uncategorized';
        map.set(cat, (map.get(cat) ?? 0) + (it.qty ?? 0));
      }
    }
    const sorted = Array.from(map.entries())
      .map(([category, qty]) => ({ category, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
    const max = Math.max(1, ...sorted.map((s) => s.qty));
    return sorted.map((s) => {
      const qty = Number((s as any)?.qty ?? 0) || 0;
      const pct = max > 0 ? (qty / max) * 100 : 0;
      return { ...s, pct: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0 };
    });
  }, [categoryAgg, paymentsScoped]);

  const staffPerformance = useMemo(() => {
    const startMs = effectiveRange.start.getTime();
    const endMs = effectiveRange.end.getTime();
    const hoursByStaffId = new Map<string, number>();
    const shiftsByStaffId = new Map<string, number>();

    for (const l of shiftLogs) {
      const inAt = new Date(l.clockInAt).getTime();
      const outAt = new Date(l.clockOutAt ?? new Date().toISOString()).getTime();
      const overlapStart = Math.max(inAt, startMs);
      const overlapEnd = Math.min(outAt, endMs);
      if (overlapEnd <= overlapStart) continue;
      const hours = (overlapEnd - overlapStart) / (1000 * 60 * 60);
      hoursByStaffId.set(l.staffId, (hoursByStaffId.get(l.staffId) ?? 0) + hours);
      shiftsByStaffId.set(l.staffId, (shiftsByStaffId.get(l.staffId) ?? 0) + 1);
    }

    const revenueByStaffId = new Map<string, number>();
    const ordersByStaffId = new Map<string, number>();
    const tipsByStaffId = new Map<string, number>();
    const byStaffName = new Map<string, string>();

    if (staffAgg.length > 0) {
      for (const s of staffAgg) {
        const sid = s.staffId;
        if (!sid) continue;
        revenueByStaffId.set(sid, (revenueByStaffId.get(sid) ?? 0) + (s.netSales ?? 0));
        ordersByStaffId.set(sid, (ordersByStaffId.get(sid) ?? 0) + (s.orderCount ?? 0));
        tipsByStaffId.set(sid, (tipsByStaffId.get(sid) ?? 0) + (s.tips ?? 0));
        if (s.staffName) byStaffName.set(sid, s.staffName);
      }
    } else {
      for (const p of paymentsScoped) {
        const sid = p.createdByStaffId;
        if (!sid) continue;
        revenueByStaffId.set(sid, (revenueByStaffId.get(sid) ?? 0) + (p.total ?? 0));
        ordersByStaffId.set(sid, (ordersByStaffId.get(sid) ?? 0) + 1);
        tipsByStaffId.set(sid, (tipsByStaffId.get(sid) ?? 0) + (p.tip ?? 0));
        if (p.createdByName) byStaffName.set(sid, p.createdByName);
      }
    }

    const staffById: Map<string, StaffMember> = new Map(staff.map((s) => [s.id, s] as [string, StaffMember]));
    const ids = new Set<string>([
      ...Array.from(hoursByStaffId.keys()),
      ...Array.from(revenueByStaffId.keys()),
      ...staff.filter((s) => isWorkerRole(s.role)).map((s) => s.id),
    ]);

    const rows = Array.from(ids)
      .map((id) => {
        const s = staffById.get(id);
        const name = s?.name ?? byStaffName.get(id) ?? 'Unknown';
        const role = s?.role ?? 'Service';
        const hours = hoursByStaffId.get(id) ?? 0;
        const orderCount = ordersByStaffId.get(id) ?? 0;
        const revenue = revenueByStaffId.get(id) ?? 0;
        const tips = tipsByStaffId.get(id) ?? 0;
        const aov = orderCount ? revenue / orderCount : 0;
        const revPerHour = hours > 0.01 ? revenue / hours : 0;
        const shifts = shiftsByStaffId.get(id) ?? 0;
        return { id, name, role, hours, orderCount, revenue, tips, aov, revPerHour, shifts };
      })
      .filter((r) => r.name)
      .filter((r) => isWorkerRole(r.role))
      .sort((a, b) => b.revenue - a.revenue);

    const filteredRows = selectedStaffId ? rows.filter((r) => r.id === selectedStaffId) : rows;

    const totalHours = filteredRows.reduce((sum, r) => sum + r.hours, 0);
    const top = filteredRows[0];
    return { allRows: rows, rows: filteredRows, totalHours, top };
  }, [effectiveRange.end, effectiveRange.start, paymentsScoped, shiftLogs, staff, staffAgg, selectedStaffId]);

  const cashSummary = useMemo(() => {
    const startMs = effectiveRange.start.getTime();
    const endMs = effectiveRange.end.getTime();
    const inRange = cashSessions.filter((s) => {
      const t = new Date(s.openedAt).getTime();
      return t >= startMs && t < endMs;
    });
    const open = inRange.filter((s) => s.status === 'Active');
    const closed = inRange.filter((s) => s.status !== 'Active');
    const opening = inRange.reduce((sum, s) => sum + (Number(s.openingCash ?? 0) || 0), 0);
    const expected = inRange.reduce((sum, s) => sum + (s.expectedCash ?? 0), 0);
    const actual = inRange.reduce((sum, s) => sum + (typeof s.actualCash === 'number' ? s.actualCash : 0), 0);
    const discrepancy = closed.reduce((sum, s) => {
      const a = typeof s.actualCash === 'number' ? s.actualCash : s.expectedCash;
      return sum + (a - s.expectedCash);
    }, 0);
    return { inRange, openCount: open.length, closedCount: closed.length, opening, expected, actual, discrepancy };
  }, [cashSessions, effectiveRange.end, effectiveRange.start]);

  const trendData = useMemo(() => {
    if (period === 'Daily' && hourlyAgg.length > 0) {
      const buckets = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
      const byHour = new Map<number, number>();
      for (const h of hourlyAgg) byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + (h.totalCollected ?? 0));
      const snapTo2 = (h: number) => Math.max(8, Math.min(20, Math.round((h - 8) / 2) * 2 + 8));
      const sumByBucket = new Map<string, number>();
      for (const b of buckets) sumByBucket.set(b, 0);
      for (const [h, v] of byHour.entries()) {
        const k = `${String(snapTo2(h)).padStart(2, '0')}:00`;
        sumByBucket.set(k, (sumByBucket.get(k) ?? 0) + v);
      }
      return buckets.map((t) => ({ label: t, revenue: sumByBucket.get(t) ?? 0 }));
    }

    if (dailyAgg.length > 0) {
      const rows = [...dailyAgg];
      const days = period === 'Weekly' ? 7 : 30;
      const tail = rows.slice(Math.max(0, rows.length - days));
      return tail.map((r) => {
        const d = new Date(`${r.date}T00:00:00`);
        return {
          label: period === 'Weekly' ? (formatDeviceDate(d, { weekday: 'short' }) || '') : (formatDeviceDate(d, { month: 'short', day: '2-digit' }) || ''),
          revenue: r.totalCollected ?? 0,
        };
      });
    }

    // Fallback to legacy client-side computation if aggregates are not present.
    if (period === 'Daily') {
      const buckets = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
      const map = new Map<string, number>();
      for (const b of buckets) map.set(b, 0);
      for (const p of payments) {
        const d = new Date(p.paidAt ?? p.createdAt ?? '');
        const h = d.getHours();
        const snapped = Math.max(8, Math.min(20, Math.round((h - 8) / 2) * 2 + 8));
        const key = `${String(snapped).padStart(2, '0')}:00`;
        map.set(key, (map.get(key) ?? 0) + (p.total ?? 0));
      }
      return buckets.map((t) => ({ label: t, revenue: map.get(t) ?? 0 }));
    }

    const days = period === 'Weekly' ? 7 : 30;
    const start = startOfDay(rangeWindow.start);
    const points = Array.from({ length: days }, (_, i) => addDays(start, i));
    const map = new Map<string, number>();
    for (const p of points) map.set(toLocalDateOnly(p), 0);
    for (const p of payments) {
      const key = toLocalDateOnly(new Date(p.paidAt ?? p.createdAt ?? ''));
      map.set(key, (map.get(key) ?? 0) + (p.total ?? 0));
    }
    return points.map((d) => ({
      label: period === 'Weekly' ? (formatDeviceDate(d, { weekday: 'short' }) || '') : (formatDeviceDate(d, { month: 'short', day: '2-digit' }) || ''),
      revenue: map.get(toLocalDateOnly(d)) ?? 0,
    }));
  }, [dailyAgg, hourlyAgg, payments, period, rangeWindow.start]);

  const topProducts = useMemo(() => {
    if (productAgg.length > 0) {
      const sorted = [...productAgg]
        .map((p) => ({ name: p.name || p.productId, qty: p.qtySold }))
        .filter((x) => x.name)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      const max = Math.max(1, ...sorted.map((s) => s.qty));
      return sorted.map((s) => ({ ...s, pct: (s.qty / max) * 100 }));
    }

    // Fallback: derive from payments when aggregates are missing.
    const map = new Map<string, number>();
    for (const p of payments) {
      for (const it of p.items) {
        const name = it.name || it.productId;
        map.set(name, (map.get(name) ?? 0) + (it.qty ?? 0));
      }
    }
    const sorted = Array.from(map.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    const max = Math.max(1, ...sorted.map((s) => s.qty));
    return sorted.map((s) => ({ ...s, pct: (s.qty / max) * 100 }));
  }, [payments, productAgg]);

  const recentTransactions = useMemo(() => {
    return paymentsSorted.slice(0, 10).map((p) => {
      return {
        id: p.number ? `#${p.number}` : `#${p.id}`,
        date: formatDeviceDateTime(p.paidAt ?? p.createdAt ?? '', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        payment: p.method ?? 'Unknown',
        amount: p.total ?? 0,
        statusLabel: 'Completed',
        statusTone: 'success' as const,
      };
    });
  }, [paymentsSorted]);

  const branchName = useMemo(() => {
    const bid = remote?.branchId ? String(remote.branchId) : '';
    if (!bid) return '';
    const hit = branches.find((b) => b.id === bid);
    return hit?.name || '';
  }, [branches, remote?.branchId]);

  const exportPdf = async () => {
    const dateFrom = toLocalDateOnly(effectiveRange.start);
    const dateTo = toLocalDateOnly(effectiveRange.end);

    const qs = new URLSearchParams();
    qs.set('type', 'daily');
    qs.set('from', dateFrom);
    qs.set('to', dateTo);

    try {
      const res = await apiFetch(`/api/manager/reports/export/pdf?${qs.toString()}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ? String(m[1]) : `sales_report_${branchName || 'branch'}_${dateFrom}_${dateTo}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF export error:', e);
    }
  };

  const exportExcel = async () => {
    const dateFrom = toLocalDateOnly(effectiveRange.start);
    const dateTo = toLocalDateOnly(effectiveRange.end);

    const qs = new URLSearchParams();
    qs.set('from', dateFrom);
    qs.set('to', dateTo);
    try {
      const res = await apiFetch(`/api/manager/reports/export/xlsx?${qs.toString()}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ? String(m[1]) : `report_${branchName || 'branch'}_${dateFrom}_${dateTo}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Excel export error:', e);
    }
  };

  const exportFullCsv = () => {};
  const exportCsv = () => {};
  const exportStaffCsv = () => {};

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-2xl font-black tracking-tight">Analytics</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {branchName ? `${branchName} • ` : ''}
                  {formatDateLabel(effectiveRange.start)} → {formatDateLabel(effectiveRange.end)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-background">
                  <span className="text-xs font-extrabold text-muted-foreground">Staff</span>
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className="h-8 rounded-md bg-background text-foreground text-sm font-bold outline-none"
                  >
                    <option value="">All</option>
                    {staffPerformance.allRows
                      .map((r) => ({ staffId: r.id, staffName: r.name }))
                      .filter((s) => s.staffId && s.staffName)
                      .map((s) => (
                        <option key={s.staffId} value={s.staffId}>
                          {s.staffName}
                        </option>
                      ))}
                  </select>
                </div>
                {/* Export Dropdown Menu */}
                <div className="relative">
                  <button
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold flex items-center gap-2"
                  >
                    <AppIcon name="download" className="text-lg" size={18} />
                    Export Report
                    <AppIcon name={exportMenuOpen ? 'expand_less' : 'expand_more'} className="text-lg" size={18} />
                  </button>
                  {exportMenuOpen && (
                    <>
                      {/* Backdrop to close menu */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setExportMenuOpen(false)}
                      />
                      {/* Dropdown menu */}
                      <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-card shadow-xl py-2">
                        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-accent/50 border-b border-border">
                          Export Professional Reports
                        </div>
                        <button
                          onClick={() => { exportExcel(); setExportMenuOpen(false); }}
                          className="w-full px-4 py-3 text-left hover:bg-accent flex items-center gap-3 text-foreground"
                        >
                          <AppIcon name="description" className="text-emerald-500" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">Excel Spreadsheet</span>
                            <span className="text-[10px] text-muted-foreground">Comprehensive multi-sheet report</span>
                          </div>
                        </button>
                        <button
                          onClick={() => { exportPdf(); setExportMenuOpen(false); }}
                          className="w-full px-4 py-3 text-left hover:bg-accent flex items-center gap-3 text-foreground border-t border-border"
                        >
                          <AppIcon name="picture_as_pdf" className="text-rose-500" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">PDF Document</span>
                            <span className="text-[10px] text-muted-foreground">Print-ready professional summary</span>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {remoteLoading ? <div className="text-xs text-muted-foreground font-bold">Loading analytics…</div> : null}
          </div>
          {remoteError === 'select_branch' ? (
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="text-sm font-extrabold">Select a branch to view reports</div>
              <div className="text-xs text-muted-foreground mt-1">Owner reports are branch-specific. Choose a branch first.</div>
              <div className="mt-3">
                <button
                  onClick={openBranchSelect}
                  className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold"
                >
                  Choose Branch
                </button>
              </div>
            </div>
          ) : null}

          {remoteError && remoteError !== 'select_branch' ? (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{remoteError}</div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Date Range</span>
              <button
                onClick={() => setDateMode('Period')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${dateMode === 'Period' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
              >
                Period
              </button>
              <button
                onClick={() => setDateMode('Custom')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${dateMode === 'Custom' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
              >
                Custom
              </button>
            </div>

            {dateMode === 'Period' ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPeriod('Daily')}
                  className={`h-9 px-3 rounded-lg border text-sm font-bold ${period === 'Daily' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
                  type="button"
                >
                  Today
                </button>
                <button
                  onClick={() => setPeriod('Weekly')}
                  className={`h-9 px-3 rounded-lg border text-sm font-bold ${period === 'Weekly' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
                  type="button"
                >
                  Weekly
                </button>
                <button
                  onClick={() => setPeriod('Monthly')}
                  className={`h-9 px-3 rounded-lg border text-sm font-bold ${period === 'Monthly' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
                  type="button"
                >
                  Monthly
                </button>
                <button
                  onClick={() => setPeriod('Yearly')}
                  className={`h-9 px-3 rounded-lg border text-sm font-bold ${period === 'Yearly' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
                  type="button"
                >
                  Yearly
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setDateMode('Custom');
                  }}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setDateMode('Custom');
                  }}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                />
              </div>
              <button
                onClick={() => {
                  setDateMode('Period');
                  const now = startOfDay(new Date());
                  setFromDate(toLocalDateOnly(addDays(now, -6)));
                  setToDate(toLocalDateOnly(now));
                }}
                className="h-9 px-3 rounded-lg border border-border bg-background text-muted-foreground text-sm font-bold hover:text-foreground hover:bg-accent"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2 rounded-xl p-5 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-start">
                <p className="text-muted-foreground text-sm font-medium">Total Revenue</p>
                <AppIcon name="payments" className="text-primary bg-primary/10 p-1 rounded" />
              </div>
              <p className="text-foreground text-2xl font-bold tracking-tight font-mono">{formatMoney(totalRevenue)}</p>
              <div className="flex items-center gap-1">
                <AppIcon name={revenueDelta >= 0 ? 'trending_up' : 'trending_down'} className={`text-sm ${revenueDelta >= 0 ? 'text-green-300' : 'text-red-300'}`} size={14} />
                <p className={`${revenueDelta >= 0 ? 'text-green-300' : 'text-red-300'} text-sm font-medium`}>{revenueDelta >= 0 ? '+' : ''}{revenueDelta.toFixed(1)}% <span className="text-muted-foreground font-normal">vs prev</span></p>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl p-5 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-start">
                <p className="text-muted-foreground text-sm font-medium">Net Profit</p>
                <AppIcon name="account_balance_wallet" className="text-primary bg-primary/10 p-1 rounded" />
              </div>
              <p className="text-foreground text-2xl font-bold tracking-tight font-mono">{formatMoney(netProfit)}</p>
              <div className="flex items-center gap-1">
                <AppIcon name={profitDelta >= 0 ? 'trending_up' : 'trending_down'} className={`text-sm ${profitDelta >= 0 ? 'text-green-300' : 'text-red-300'}`} size={14} />
                <p className={`${profitDelta >= 0 ? 'text-green-300' : 'text-red-300'} text-sm font-medium`}>{profitDelta >= 0 ? '+' : ''}{profitDelta.toFixed(1)}% <span className="text-muted-foreground font-normal">vs prev</span></p>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl p-5 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-start">
                <p className="text-muted-foreground text-sm font-medium">Orders Processed</p>
                <AppIcon name="receipt_long" className="text-primary bg-primary/10 p-1 rounded" />
              </div>
              <p className="text-foreground text-2xl font-bold tracking-tight">{ordersProcessed}</p>
              <div className="flex items-center gap-1">
                <AppIcon name={ordersDelta >= 0 ? 'trending_up' : 'trending_down'} className={`text-sm ${ordersDelta >= 0 ? 'text-green-300' : 'text-red-300'}`} size={14} />
                <p className={`${ordersDelta >= 0 ? 'text-green-300' : 'text-red-300'} text-sm font-medium`}>{ordersDelta >= 0 ? '+' : ''}{ordersDelta.toFixed(1)}% <span className="text-muted-foreground font-normal">vs prev</span></p>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl p-5 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-start">
                <p className="text-muted-foreground text-sm font-medium">Avg Order Value</p>
                <AppIcon name="shopping_basket" className="text-primary bg-primary/10 p-1 rounded" />
              </div>
              <p className="text-foreground text-2xl font-bold tracking-tight font-mono">{formatMoney(avgOrderValue)}</p>
              <div className="flex items-center gap-1">
                <AppIcon name={aovDelta >= 0 ? 'trending_up' : 'trending_down'} className={`text-sm ${aovDelta >= 0 ? 'text-green-300' : 'text-red-300'}`} size={14} />
                <p className={`${aovDelta >= 0 ? 'text-green-300' : 'text-red-300'} text-sm font-medium`}>{aovDelta >= 0 ? '+' : ''}{aovDelta.toFixed(1)}% <span className="text-muted-foreground font-normal">vs prev</span></p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Revenue Trend</h3>
                  <p className="text-muted-foreground text-sm">Paid orders only</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground font-mono">{formatMoney(totalRevenue)}</span>
                  <span className="text-sm font-medium text-green-300">Live</span>
                </div>
              </div>
              <div className="relative w-full aspect-[2/1] min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" stroke="hsl(var(--border))" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))', borderRadius: 10 }} formatter={(v: any) => formatMoney(Number(v))} />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Top Selling Products</h3>
                  <p className="text-muted-foreground text-sm">By quantity sold</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{topProducts.reduce((s, x) => s + x.qty, 0)}</span>
                  <span className="text-sm font-medium text-muted-foreground">Items</span>
                </div>
              </div>
              <div className="flex flex-col gap-4 justify-center h-full">
                {topProducts.length ? (
                  topProducts.map((p) => (
                    <div key={p.name} className="grid grid-cols-[140px_1fr_56px] items-center gap-3">
                      <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${p.pct}%` }}></div>
                      </div>
                      <span className="text-xs font-bold text-muted-foreground text-right">{p.qty}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No sales in this period.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Top Categories</h3>
                  <p className="text-muted-foreground text-sm">By revenue (total collected)</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 justify-center h-full">
                {topCategories.length ? (
                  topCategories.map((c: any) => (
                    <div key={c.category} className="grid grid-cols-[140px_1fr_96px] items-center gap-3">
                      <span className="text-sm font-medium text-foreground truncate">{c.category}</span>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Number.isFinite(Number(c.pct)) ? Math.max(0, Math.min(100, Number(c.pct))) : 0}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-bold text-muted-foreground text-right font-mono">{formatMoney(c.revenue ?? 0)}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No category summary in this period.</div>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Shift Reports</h3>
                  <p className="text-muted-foreground text-sm">Cash reconciliation (server-driven)</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-card">
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Opened</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Staff</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Expected</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Actual</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shiftAgg.length ? (
                      shiftAgg.slice(0, 8).map((s) => (
                        <tr key={s.id} className="hover:bg-accent transition-colors">
                          <td className="px-5 py-3 text-sm text-foreground">{s.openedAt ? (formatDeviceDateTime(s.openedAt) || '') : ' ”'}</td>
                          <td className="px-5 py-3 text-sm text-foreground">{s.staffName || ' ”'}</td>
                          <td className="px-5 py-3 text-sm text-muted-foreground">{s.status || ' ”'}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{s.expectedCash == null ? ' ”' : formatMoney(s.expectedCash)}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{s.closingCash == null ? ' ”' : formatMoney(s.closingCash)}</td>
                          <td className={`px-5 py-3 text-sm text-right font-mono ${s.cashDifference == null ? 'text-muted-foreground' : Math.abs(s.cashDifference) < 0.01 ? 'text-green-300' : 'text-orange-300'}`}>
                            {s.cashDifference == null ? ' ”' : formatMoney(s.cashDifference)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-5 py-6 text-sm text-muted-foreground" colSpan={6}>No shift reports in this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
            <div className="flex justify-between items-end mb-4">
              <div>
                <h3 className="text-foreground text-lg font-bold">Voids & Refunds</h3>
                <p className="text-muted-foreground text-sm">Audit trail (server-driven)</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Time</th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Item</th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Qty</th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Amount</th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {voidAgg.length ? (
                    voidAgg.slice(0, 12).map((e) => (
                      <tr key={e.id} className="hover:bg-accent transition-colors">
                        <td className="px-5 py-3 text-sm text-foreground">{e.occurredAt ? (formatDeviceDateTime(e.occurredAt) || '') : ' ”'}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground">{e.type || ' ”'}</td>
                        <td className="px-5 py-3 text-sm text-foreground">{e.productName || ' ”'}</td>
                        <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{e.qty}</td>
                        <td className="px-5 py-3 text-sm text-right font-mono font-bold text-foreground">{formatMoney(e.amount)}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground">{e.reason || ' ”'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-6 text-sm text-muted-foreground" colSpan={6}>No void/refund events in this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Cash & Reconciliation</h3>
                  <p className="text-muted-foreground text-sm">Expected vs counted cash sessions</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Expected</div>
                    <div className="text-foreground font-mono font-bold">{formatMoney(cashSummary.expected)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Actual</div>
                    <div className="text-foreground font-mono font-bold">{formatMoney(cashSummary.actual)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Discrepancy</div>
                    <div className={`font-mono font-bold ${Math.abs(cashSummary.discrepancy) < 0.01 ? 'text-green-300' : 'text-orange-300'}`}>{formatMoney(cashSummary.discrepancy)}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Sessions</div>
                  <div className="text-foreground font-bold mt-1">{cashSummary.inRange.length}</div>
                  <div className="text-muted-foreground text-sm">Open {cashSummary.openCount}    Closed {cashSummary.closedCount}</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Expenses</div>
                  <div className="text-foreground font-mono font-bold mt-1">{formatMoney(totalExpenses)}</div>
                  <div className="text-muted-foreground text-sm">{expensesInRange.length} entries</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Net Margin</div>
                  <div className="text-foreground font-bold mt-1">{totalRevenue > 0 ? `${Math.max(-999, Math.min(999, (netProfit / totalRevenue) * 100)).toFixed(1)}%` : '0.0%'}</div>
                  <div className="text-muted-foreground text-sm">Profit vs revenue</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Payment Mix</h3>
                  <p className="text-muted-foreground text-sm">By method</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {paymentBreakdown.length ? (
                  paymentBreakdown.slice(0, 6).map(([method, v]) => {
                    const pct = totalRevenue > 0 ? Math.round((v.sum / totalRevenue) * 100) : 0;
                    return (
                      <div key={method} className="flex flex-col gap-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground font-medium truncate">{method}</span>
                          <span className="text-muted-foreground font-mono">{formatMoney(v.sum)}</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-muted-foreground">No payments in this period.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Staff Performance</h3>
                  <p className="text-muted-foreground text-sm">Waiter & team metrics for this period</p>
                </div>
                <div className="flex items-end gap-6">
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Total Hours</div>
                    <div className="text-foreground font-mono font-bold">{staffPerformance.totalHours.toFixed(1)}h</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Top Performer</div>
                    <div className="text-foreground font-bold">{staffPerformance.top?.name ?? ' ”'}</div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-card">
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Staff</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Role</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Hours</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Orders</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Revenue</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Rev/Hour</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Avg Ticket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {staffPerformance.rows.length ? (
                      staffPerformance.rows.slice(0, 12).map((r, idx) => (
                        <tr key={r.id} className="hover:bg-accent transition-colors">
                          <td className="px-5 py-3 text-sm text-foreground font-medium">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                                <AppIcon name="person" className="text-muted-foreground" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-foreground">{idx === 0 ? `#1 ${r.name}` : r.name}</span>
                                <span className="text-xs text-muted-foreground">{r.shifts} shifts</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-muted-foreground">{r.role}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{r.hours.toFixed(1)}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{r.orderCount}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono font-bold text-foreground">{formatMoney(r.revenue)}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{formatMoney(r.revPerHour)}</td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-foreground">{formatMoney(r.aov)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-5 py-6 text-sm text-muted-foreground" colSpan={7}>No staff metrics yet. Clock-in/out and order assignment will populate this.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs text-muted-foreground">
                Staff revenue uses paid orders with `createdByStaffId`. Hours use shift logs overlapping the selected period.
              </div>
            </div>

            <div className="flex flex-col rounded-xl p-6 bg-card border border-border shadow-sm">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h3 className="text-foreground text-lg font-bold">Service KPIs</h3>
                  <p className="text-muted-foreground text-sm">Operational snapshot</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Active Staff</div>
                  <div className="text-foreground font-bold mt-1">{staff.filter((s) => s.status === 'Active').length}</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">On Leave</div>
                  <div className="text-foreground font-bold mt-1">{staff.filter((s) => s.status === 'On Leave').length}</div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Orders / Staff (avg)</div>
                  <div className="text-foreground font-bold mt-1">{staffPerformance.rows.length ? (ordersProcessed / staffPerformance.rows.length).toFixed(1) : '0.0'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-foreground text-lg font-bold">Recent Transactions</h3>
              <button onClick={() => setShowAll((s) => !s)} className="text-primary hover:text-primary/90 text-sm font-bold flex items-center gap-1">
                {showAll ? 'Show Less' : 'View All'} <AppIcon name="arrow_forward" className="text-sm" size={14} />
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border bg-background shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Date/Time</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Order ID</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Payment</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Amount</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(showAll ? recentTransactions : recentTransactions.slice(0, 10)).length ? (
                    (showAll ? recentTransactions : recentTransactions.slice(0, 10)).map((t) => {
                      const pill =
                        t.statusTone === 'success'
                          ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                          : t.statusTone === 'muted'
                            ? 'bg-muted text-muted-foreground border border-border'
                            : 'bg-orange-500/10 text-orange-300 border border-orange-500/20';
                      const icon = t.payment.toLowerCase().includes('card') ? 'credit_card' : t.payment.toLowerCase().includes('cash') ? 'payments' : 'smartphone';
                      return (
                        <tr key={t.id} className="hover:bg-accent transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-medium">{t.date}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground font-mono">{t.id}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground flex items-center gap-2">
                            <AppIcon name={icon} className="text-lg text-muted-foreground" size={18} />
                            {t.payment}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-bold text-right font-mono">{formatMoney(t.amount)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${pill}`}>{t.statusLabel}</span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-6 py-6 text-sm text-muted-foreground" colSpan={5}>No transactions in this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
