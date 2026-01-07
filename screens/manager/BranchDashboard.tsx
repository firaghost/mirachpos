import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { Button } from '../../components/ui/button';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const fmtEtb = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'ETB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `ETB ${v.toFixed(2)}`;
  }
};

const fmtPct = (n: number | null) => {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const diffPct = (today: number, yesterday: number): number | null => {
  const a = Number(today);
  const b = Number(yesterday);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= 0) return null;
  return ((a - b) / b) * 100;
};

const relTimeLabel = (iso: string): string => {
  const s = String(iso || '').trim();
  if (!s) return '';
  const ms = new Date().getTime() - new Date(s).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const formatTrendLabel = (key: string) => {
  const raw = key as any;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw || '').trim();
  if (!s) return '';

  // Hour buckets: "08:00" -> "8am"
  const hm = /^\d{2}:\d{2}$/.exec(s);
  if (hm) {
    const h = Number(s.slice(0, 2));
    if (Number.isFinite(h)) {
      const h12 = ((h + 11) % 12) + 1;
      const ampm = h >= 12 ? 'pm' : 'am';
      return `${h12}${ampm}`;
    }
  }

  // Date string (JS Date toString): "Tue Jan 06 2026 00:00:00 GMT+0300 (...)" -> "Jan 06"
  if (/[A-Za-z]{3} [A-Za-z]{3} \d{2} \d{4}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      try {
        return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      } catch {
        return s;
      }
    }
  }

  // ISO date: "2026-01-06" -> "Jan 06"
  const dm = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (dm) {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) {
      try {
        return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      } catch {
        return s;
      }
    }
  }

  return s;
};

const TrendTooltip = ({ active, payload, label }: any) => {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const revenue = payload.find((p: any) => p?.dataKey === 'revenue')?.value;
  const orders = payload.find((p: any) => p?.dataKey === 'orders')?.value;
  return (
    <div className="bg-[#221c10] border border-[#483c23] rounded-lg shadow-xl px-3 py-2">
      <p className="text-[10px] text-[#c9b792] uppercase tracking-wider">{formatTrendLabel(String(label || ''))}</p>
      <div className="mt-1 space-y-0.5">
        <p className="text-sm font-bold text-[#eead2b]">{fmtEtb(Number(revenue || 0) || 0)}</p>
        <p className="text-xs text-emerald-400">Orders: {Number(orders || 0) || 0}</p>
      </div>
    </div>
  );
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const BranchDashboard: React.FC<Props> = ({ onNavigate }) => {
  const { orders, products, refreshFromServer } = usePos();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [staffOnShift, setStaffOnShift] = useState(0);
  const [staffOnShiftList, setStaffOnShiftList] = useState<Array<{ id: string; name: string; roleName: string; statusLabel: string }>>([]);
  const [inventoryItems, setInventoryItems] = useState<
    Array<{ id: string; name: string; category: string; stock: number; unit: string; minStock: number; status: 'In Stock' | 'Low Stock' | 'Critical'; updatedAt: string | null }>
  >([]);
  const [topSelling, setTopSelling] = useState<Array<{ productId: string; name: string; qty: number; imageUrl: string }>>([]);
  const [liveOps, setLiveOps] = useState<Array<{ id: string; title: string; subtitle: string; at: string; tone: 'success' | 'info' | 'warn' }>>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [range, setRange] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [trend, setTrend] = useState<Array<{ key: string; revenue: number; orders: number }>>([]);
  const [recentPaid, setRecentPaid] = useState<Array<{ id: string; total: number; paidAt: string | null }>>([]);
  const [salesToday, setSalesToday] = useState(0);
  const [netProfitToday, setNetProfitToday] = useState(0);
  const [ordersToday, setOrdersToday] = useState(0);
  const [avgTicket, setAvgTicket] = useState(0);

  const [salesDeltaPct, setSalesDeltaPct] = useState<number | null>(null);
  const [profitDeltaPct, setProfitDeltaPct] = useState<number | null>(null);
  const [ordersDeltaPct, setOrdersDeltaPct] = useState<number | null>(null);
  const [avgTicketDeltaPct, setAvgTicketDeltaPct] = useState<number | null>(null);

  const inventoryAlerts = useMemo(() => {
    const rows = inventoryItems
      .filter((x) => x.status === 'Critical' || x.status === 'Low Stock')
      .sort((a, b) => {
        const sev = (s: string) => (s === 'Critical' ? 2 : s === 'Low Stock' ? 1 : 0);
        const sa = sev(a.status);
        const sb = sev(b.status);
        if (sa !== sb) return sb - sa;
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 6);

    const criticalCount = inventoryItems.filter((x) => x.status === 'Critical').length;
    const lowCount = inventoryItems.filter((x) => x.status === 'Low Stock').length;

    return { rows, criticalCount, lowCount };
  }, [inventoryItems]);

  const openOrders = useMemo(() => orders.filter((o) => o.status !== 'Paid').length, [orders]);

  const productsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      const id = String((p as any)?.id || '').trim();
      const img = String((p as any)?.image || '').trim();
      if (id && img) map.set(id, img);
    }
    return map;
  }, [products]);

  const productImageFromMenu = useCallback(
    (productId: string, name: string): string => {
      const pid = String(productId || '').trim();
      if (pid) {
        const hit = productsById.get(pid);
        if (hit) return hit;
      }

      const n = String(name || '').trim().toLowerCase();
      if (n) {
        const match = products.find((p) => String((p as any)?.name || '').trim().toLowerCase() === n);
        const img = String((match as any)?.image || '').trim();
        if (img) return img;
      }
      return '';
    },
    [products, productsById],
  );

  const resolveOwnerBranchOverride = () => {
    try {
      const raw = localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '';
      return String(raw || '').trim();
    } catch {
      return '';
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        await refreshFromServer();
      } catch {
        // ignore
      }

      const session = readSession<any>();
      const role = typeof session?.role === 'string' ? session.role : '';
      const tokenBranchId = typeof session?.branchId === 'string' ? session.branchId : '';
      const branchOverride = role === 'Cafe Owner' && (!tokenBranchId || tokenBranchId === 'global') ? resolveOwnerBranchOverride() : '';

      try {
        const br = await apiFetch('/api/branches');
        if (br.ok) {
          const data = (await br.json().catch(() => null)) as any;
          const branches = Array.isArray(data?.branches) ? data.branches : [];
          if (branchOverride) {
            const match = branches.find((b: any) => String(b?.id || '') === branchOverride);
            setBranchName(match ? String(match?.name || '') : '');
          } else {
            setBranchName(branches.length === 1 ? String(branches[0]?.name || '') : '');
          }
        }
      } catch {
        // ignore
      }

      const ovQs = new URLSearchParams({ range });
      if (branchOverride) ovQs.set('branchId', branchOverride);
      const ov = await apiFetch(`/api/manager/overview?${ovQs.toString()}`);
      const ovJson = (await ov.json().catch(() => null)) as any;
      if (!ov.ok) throw new Error(`HTTP ${ov.status}`);

      setStaffOnShift(Number(ovJson?.kpis?.staffOnShift ?? 0) || 0);
      const legacyTrend = Array.isArray(ovJson?.trend) ? ovJson.trend : [];
      const recentPaidArr = Array.isArray(ovJson?.recentPaid) ? (ovJson.recentPaid as any[]) : [];
      setRecentPaid(recentPaidArr as any);

      // Prefer server-driven aggregates for today's KPIs + trend.
      // Fall back to legacy overview trend and payments query if aggregates are not available.
      try {
        const now = new Date();
        const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const today = isoDate(startDay);
        const y = new Date(startDay);
        y.setDate(y.getDate() - 1);
        const yesterday = isoDate(y);

        const fetchPayments = async (fromIso: string, toIso: string) => {
          const qs = new URLSearchParams({ from: fromIso, to: toIso, limit: '500' });
          if (branchOverride) qs.set('branchId', branchOverride);
          const res = await apiFetch(`/api/manager/payments?${qs.toString()}`);
          const json = (await res.json().catch(() => null)) as any;
          const payments = res.ok && Array.isArray(json?.payments) ? (json.payments as any[]) : [];
          return { ok: res.ok, payments };
        };

        const qsToday = new URLSearchParams({ from: yesterday, to: today, limit: '10' });
        if (branchOverride) qsToday.set('branchId', branchOverride);
        const dailyRes = await apiFetch(`/api/manager/reports/daily?${qsToday.toString()}`);
        const dailyJson = (await dailyRes.json().catch(() => null)) as any;
        const dailyRows = Array.isArray(dailyJson?.daily) ? (dailyJson.daily as any[]) : [];
        const todayRow = dailyRows.find((r) => String(r?.date || '') === today) || null;
        const yRow = dailyRows.find((r) => String(r?.date || '') === yesterday) || null;

        const totalCollected = Number(todayRow?.totalCollected ?? 0) || 0;
        const netSales = Number(todayRow?.netSales ?? 0) || 0;
        const orderCount = Number(todayRow?.orderCount ?? 0) || 0;
        const avgTkt = orderCount > 0 ? totalCollected / orderCount : 0;

        const yCollected = Number(yRow?.totalCollected ?? 0) || 0;
        const yNetSales = Number(yRow?.netSales ?? 0) || 0;
        const yOrderCount = Number(yRow?.orderCount ?? 0) || 0;
        const yAvgTkt = yOrderCount > 0 ? yCollected / yOrderCount : 0;

        if (dailyRes.ok) {
          setSalesToday(totalCollected);
          setNetProfitToday(netSales);
          setOrdersToday(orderCount);
          setAvgTicket(avgTkt);

          setSalesDeltaPct(diffPct(totalCollected, yCollected));
          setProfitDeltaPct(diffPct(netSales, yNetSales));
          setOrdersDeltaPct(diffPct(orderCount, yOrderCount));
          setAvgTicketDeltaPct(diffPct(avgTkt, yAvgTkt));
        }

        // Fallback when daily summary exists but has no rows yet (common before aggregation jobs run).
        if (!dailyRes.ok || !todayRow) {
          const dayStartIso = startDay.toISOString();
          const dayEndIso = new Date(startDay.getTime() + 24 * 60 * 60 * 1000).toISOString();
          const yStartIso = y.toISOString();
          const yEndIso = new Date(y.getTime() + 24 * 60 * 60 * 1000).toISOString();

          const [pToday, pY] = await Promise.all([fetchPayments(dayStartIso, dayEndIso), fetchPayments(yStartIso, yEndIso)]);

          if (pToday.ok) {
            const rows = pToday.payments;
            const total = rows.reduce((sum, p) => sum + (Number(p?.total ?? 0) || 0), 0);
            const cnt = rows.length;
            setSalesToday(total);
            setOrdersToday(cnt);
            setNetProfitToday(0);
            setAvgTicket(cnt > 0 ? total / cnt : 0);

            // Trend fallback (hourly) for Today.
            if (range === 'Daily') {
              const buckets = new Map<string, { key: string; revenue: number; orders: number }>();
              for (const pay of rows) {
                const paidAt = String(pay?.paidAt || pay?.paid_at || '');
                const d = paidAt ? new Date(paidAt) : null;
                if (!d || Number.isNaN(d.getTime())) continue;
                const hour = d.getHours();
                const key = `${String(hour).padStart(2, '0')}:00`;
                const cur = buckets.get(key) || { key, revenue: 0, orders: 0 };
                cur.revenue += Number(pay?.total ?? 0) || 0;
                cur.orders += 1;
                buckets.set(key, cur);
              }
              const mapped = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
              if (mapped.length > 0) setTrend(mapped);
            }

            // Top selling fallback from payment items.
            if (topSelling.length === 0) {
              const counts = new Map<string, { productId: string; name: string; qty: number; imageUrl: string }>();
              for (const pay of rows) {
                const items = Array.isArray(pay?.items) ? (pay.items as any[]) : [];
                for (const it of items) {
                  const pid = String(it?.productId || it?.product_id || it?.id || '');
                  const name = String(it?.name || pid);
                  const qty = Number(it?.qty ?? it?.quantity ?? 0) || 0;
                  if ((!pid && !name) || qty <= 0) continue;
                  const key = pid || name;
                  const cur = counts.get(key);
                  if (cur) cur.qty += qty;
                  else {
                    const img = productImageFromMenu(pid || key, name);
                    counts.set(key, { productId: pid || key, name, qty, imageUrl: img || '' });
                  }
                }
              }
              const list = [...counts.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
              if (list.length > 0) setTopSelling(list);
            }
          }

          if (pToday.ok && pY.ok) {
            const totalT = pToday.payments.reduce((sum, p) => sum + (Number(p?.total ?? 0) || 0), 0);
            const totalY = pY.payments.reduce((sum, p) => sum + (Number(p?.total ?? 0) || 0), 0);
            const cntT = pToday.payments.length;
            const cntY = pY.payments.length;
            const avgT = cntT > 0 ? totalT / cntT : 0;
            const avgY = cntY > 0 ? totalY / cntY : 0;
            setSalesDeltaPct(diffPct(totalT, totalY));
            setProfitDeltaPct(null);
            setOrdersDeltaPct(diffPct(cntT, cntY));
            setAvgTicketDeltaPct(diffPct(avgT, avgY));
          }
        }

        if (range === 'Daily') {
          const qsHourly = new URLSearchParams({ date: today });
          if (branchOverride) qsHourly.set('branchId', branchOverride);
          const hRes = await apiFetch(`/api/manager/reports/hourly?${qsHourly.toString()}`);
          const hJson = (await hRes.json().catch(() => null)) as any;
          const hourly = Array.isArray(hJson?.hourly) ? (hJson.hourly as any[]) : [];
          const mapped = hourly
            .map((x) => {
              const hour = Number(x?.hour ?? 0) || 0;
              const key = `${String(hour).padStart(2, '0')}:00`;
              return {
                key,
                revenue: Number(x?.totalCollected ?? 0) || 0,
                orders: Number(x?.orderCount ?? 0) || 0,
              };
            })
            .filter((x) => x.key);
          if (hRes.ok && mapped.length > 0) setTrend(mapped);
          else setTrend(legacyTrend);
        } else {
          const days = range === 'Weekly' ? 7 : 30;
          const start = new Date(startDay);
          start.setDate(start.getDate() - (days - 1));
          const from = start.toISOString().slice(0, 10);
          const to = today;
          const qs = new URLSearchParams({ from, to, limit: String(days + 10) });
          if (branchOverride) qs.set('branchId', branchOverride);
          const dr = await apiFetch(`/api/manager/reports/daily?${qs.toString()}`);
          const dj = (await dr.json().catch(() => null)) as any;
          const rows = Array.isArray(dj?.daily) ? (dj.daily as any[]) : [];
          const mapped = rows
            .map((r) => ({
              key: String(r?.date || ''),
              revenue: Number(r?.totalCollected ?? 0) || 0,
              orders: Number(r?.orderCount ?? 0) || 0,
            }))
            .filter((x) => x.key)
            .slice(-days);
          if (dr.ok && mapped.length > 0) setTrend(mapped);
          else setTrend(legacyTrend);
        }

        if (!dailyRes.ok) {
          // Fallback to previous client-side computation if aggregates are missing.
          const qs = new URLSearchParams({ from: startDay.toISOString(), to: new Date(startDay.getTime() + 24 * 60 * 60 * 1000).toISOString(), limit: '500' });
          if (branchOverride) qs.set('branchId', branchOverride);
          const pay = await apiFetch(`/api/manager/payments?${qs.toString()}`);
          const payJson = (await pay.json().catch(() => null)) as any;
          if (pay.ok && Array.isArray(payJson?.payments)) {
            const rows = payJson.payments as any[];
            const total = rows.reduce((sum, p) => sum + (Number(p?.total ?? 0) || 0), 0);
            setSalesToday(total);
            setAvgTicket(rows.length > 0 ? total / rows.length : 0);
            setOrdersToday(rows.length);
            setNetProfitToday(0);
          } else {
            setSalesToday(0);
            setAvgTicket(0);
            setOrdersToday(0);
            setNetProfitToday(0);
          }

          setSalesDeltaPct(null);
          setProfitDeltaPct(null);
          setOrdersDeltaPct(null);
          setAvgTicketDeltaPct(null);
        }

        try {
          const qsProducts = new URLSearchParams({ from: today, to: today, limit: '5' });
          if (branchOverride) qsProducts.set('branchId', branchOverride);
          const pRes = await apiFetch(`/api/manager/reports/products?${qsProducts.toString()}`);
          const pJson = (await pRes.json().catch(() => null)) as any;
          const products = Array.isArray(pJson?.products) ? (pJson.products as any[]) : [];
          if (pRes.ok && products.length > 0) {
            setTopSelling(
              products
                .map((p) => {
                  const productId = String(p?.productId || '');
                  const name = String(p?.name || '');
                  const img = productImageFromMenu(productId, name);
                  return { productId, name, qty: Number(p?.qtySold ?? 0) || 0, imageUrl: img || '' };
                })
                .filter((x) => x.productId || x.name)
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5),
            );
          }
        } catch {
          // keep previous/fallback
        }

        try {
          const qsStaff = new URLSearchParams();
          if (branchOverride) qsStaff.set('branchId', branchOverride);
          const staffRes = await apiFetch(`/api/manager/reports?${qsStaff.toString()}`);
          const staffJson = (await staffRes.json().catch(() => null)) as any;
          const staffRows = Array.isArray(staffJson?.staff) ? (staffJson.staff as any[]) : [];
          const shiftRows = Array.isArray(staffJson?.shiftLogs) ? (staffJson.shiftLogs as any[]) : [];

          const activeStaffIds = new Set(
            shiftRows
              .filter((l) => !l?.clockOutAt)
              .map((l) => String(l?.staffId || ''))
              .filter(Boolean),
          );

          const list = staffRows
            .filter((s) => activeStaffIds.has(String(s?.id || '')))
            .map((s) => ({
              id: String(s?.id || ''),
              name: String(s?.name || ''),
              roleName: String(s?.role || s?.roleName || ''),
              statusLabel: 'On Shift',
            }))
            .filter((x) => x.id && x.name)
            .slice(0, 4);

          if (staffRes.ok) setStaffOnShiftList(list);
          else setStaffOnShiftList([]);
        } catch {
          setStaffOnShiftList([]);
        }

        try {
          const qsInv = new URLSearchParams({ limit: '200' });
          if (branchOverride) qsInv.set('branchId', branchOverride);
          const invRes = await apiFetch(`/api/inventory/items?${qsInv.toString()}`);
          const invJson = (await invRes.json().catch(() => null)) as any;
          const rows = invRes.ok && Array.isArray(invJson?.items) ? (invJson.items as any[]) : [];
          const mapped = rows
            .map((x) => {
              const statusRaw = String(x?.status || 'In Stock');
              const status: 'In Stock' | 'Low Stock' | 'Critical' =
                statusRaw === 'Critical' ? 'Critical' : statusRaw === 'Low Stock' ? 'Low Stock' : 'In Stock';
              return {
                id: String(x?.id || ''),
                name: String(x?.name || ''),
                category: String(x?.category || ''),
                stock: Number(x?.stock ?? 0) || 0,
                unit: String(x?.unit || ''),
                minStock: Number(x?.minStock ?? 0) || 0,
                status,
                updatedAt: x?.updatedAt ? String(x.updatedAt) : null,
              };
            })
            .filter((x) => x.id && x.name);
          if (invRes.ok) setInventoryItems(mapped);
          else setInventoryItems([]);
        } catch {
          setInventoryItems([]);
        }

        try {
          const qsEv = new URLSearchParams({ page: '1', pageSize: '20' });
          if (branchOverride) qsEv.set('branchId', branchOverride);
          const evRes = await apiFetch(`/api/manager/staff/activity?${qsEv.toString()}`);
          const evJson = (await evRes.json().catch(() => null)) as any;
          const events = Array.isArray(evJson?.events) ? (evJson.events as any[]) : [];
          const mapped = events
            .map((e) => {
              const type = String(e?.type || '');
              const at = String(e?.at || '');
              const payload = e?.payload && typeof e.payload === 'object' ? e.payload : {};

              const title =
                type === 'order_paid'
                  ? 'Payment Received'
                  : type === 'order_created'
                    ? 'New Order'
                    : type.startsWith('inventory.')
                      ? 'Inventory Alert'
                      : type === 'staff_created'
                        ? 'New Staff Added'
                        : type === 'staff_updated'
                          ? 'Staff Updated'
                          : type === 'staff_deleted'
                            ? 'Staff Removed'
                            : type || 'Activity';

              const subtitle = (() => {
                if (type === 'order_paid') {
                  const total = Number(payload?.total ?? payload?.amount ?? 0) || 0;
                  const orderNumber = String(payload?.number || payload?.orderNumber || payload?.orderId || '');
                  return `${orderNumber ? `Receipt #${orderNumber}` : 'Order paid'} • ${fmtEtb(total)}`;
                }
                if (type === 'order_created') {
                  const table = String(payload?.tableName || payload?.table || '');
                  const items = Number(payload?.items ?? payload?.itemCount ?? 0) || 0;
                  return `${table ? `${table} • ` : ''}${items ? `${items} items` : 'New order created'}`;
                }
                if (type.startsWith('inventory.')) {
                  const name = String(payload?.productName || payload?.itemName || payload?.name || '');
                  const level = payload?.level != null ? String(payload.level) : '';
                  return `${name || 'Low stock'}${level ? ` • Level: ${level}` : ''}`;
                }
                if (type === 'inventory_count' || type === 'inventory.count') {
                  return 'Inventory count recorded';
                }
                if (type === 'po_created') {
                  return 'New purchase order created';
                }
                if (type.startsWith('staff_')) {
                  const name = String(payload?.name || payload?.staffName || payload?.staffId || '');
                  return name ? `Staff: ${name}` : 'Staff change';
                }
                return '';
              })();

              const tone: 'success' | 'info' | 'warn' = type === 'order_paid' ? 'success' : type.startsWith('inventory.') ? 'warn' : 'info';
              return { id: String(e?.id || ''), title, subtitle, at, tone };
            })
            .filter((x) => x.id && x.title)
            .slice(0, 6);
          if (evRes.ok) setLiveOps(mapped);
          else setLiveOps([]);
        } catch {
          setLiveOps([]);
        }

        // Live operations fallback: if no events, render recent payments as activity.
        if (recentPaidArr.length > 0) {
          setLiveOps((cur) => {
            if (cur.length > 0) return cur;
            return recentPaidArr.slice(0, 8).map((r) => ({
              id: String(r?.id || ''),
              title: 'Payment Received',
              subtitle: `${r?.id ? `Order ${r.id}` : 'Payment'} • ${fmtEtb(Number(r?.total ?? 0) || 0)}`,
              at: String(r?.paidAt || ''),
              tone: 'success' as const,
            }));
          });
        }
      } catch {
        setTrend(legacyTrend);
        setSalesToday(0);
        setNetProfitToday(0);
        setOrdersToday(0);
        setAvgTicket(0);
        setSalesDeltaPct(null);
        setProfitDeltaPct(null);
        setOrdersDeltaPct(null);
        setAvgTicketDeltaPct(null);
        setTopSelling([]);
        setStaffOnShiftList([]);
        setInventoryItems([]);
        setLiveOps([]);
      }

      setLastUpdatedAt(new Date().toLocaleTimeString());
    } catch {
      setError('Start the API server (npm run dev or npm run dev:api from repo root).');
    } finally {
      setLoading(false);
    }
  }, [range, refreshFromServer]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="bg-[#221c10] text-white antialiased h-full overflow-hidden flex flex-col">
      <header className="h-16 shrink-0 border-b border-[#362b18] bg-[#221c10]/95 backdrop-blur flex items-center justify-between px-8 z-10">
        <div>
          <h2 className="text-white text-xl font-bold">Overview</h2>
          <p className="text-[#c9b792] text-xs">{branchName ? `${branchName} • ` : ''}{lastUpdatedAt ? `Updated ${lastUpdatedAt}` : ''}</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-[#221c10] p-1 rounded-lg border border-[#483c23]">
            <button
              onClick={() => setRange('Daily')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${range === 'Daily' ? 'bg-[#483c23] text-white shadow-sm' : 'text-[#c9b792] hover:text-white'}`}
            >
              Today
            </button>
            <button
              onClick={() => setRange('Weekly')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${range === 'Weekly' ? 'bg-[#483c23] text-white shadow-sm' : 'text-[#c9b792] hover:text-white'}`}
            >
              Week
            </button>
            <button
              onClick={() => setRange('Monthly')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${range === 'Monthly' ? 'bg-[#483c23] text-white shadow-sm' : 'text-[#c9b792] hover:text-white'}`}
            >
              Month
            </button>
          </div>

          <button
            onClick={refresh}
            className="size-9 rounded-full bg-[#362b18] text-[#c9b792] hover:text-white hover:bg-[#483c23] flex items-center justify-center transition-all"
            aria-label="Refresh"
          >
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>

          <button
            onClick={() => onNavigate(Screen.MANAGER_ORDERS)}
            className="h-10 px-4 bg-[#eead2b] hover:bg-[#eead2b]/90 text-[#221c10] rounded-lg font-bold text-sm flex items-center gap-2 transition-colors shadow-lg shadow-[#eead2b]/10"
          >
            <span className="material-symbols-outlined text-[20px]">receipt_long</span>
            <span>Orders</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}
          {loading ? <div className="text-xs text-[#c9b792]">Loading...</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#362b18] p-4 rounded-xl border border-[#483c23] flex flex-col gap-1 relative overflow-hidden group hover:border-[#eead2b]/30 transition-colors">
              <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-[64px] text-[#eead2b]">payments</span>
              </div>
              <p className="text-[#c9b792] text-sm font-medium">Total Sales (Today)</p>
              <h3 className="text-white text-2xl font-bold tracking-tight">{fmtEtb(salesToday)}</h3>
              <div className="flex items-center gap-1 mt-2">
                <span className={`material-symbols-outlined text-sm ${Number(salesDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{Number(salesDeltaPct || 0) >= 0 ? 'trending_up' : 'trending_down'}</span>
                <span className={`text-sm font-bold ${Number(salesDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtPct(salesDeltaPct) ?? '—'}</span>
                <span className="text-[#c9b792] text-xs ml-1">vs yesterday</span>
              </div>
            </div>

            <div className="bg-[#362b18] p-4 rounded-xl border border-[#483c23] flex flex-col gap-1 relative overflow-hidden group hover:border-[#eead2b]/30 transition-colors">
              <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-[64px] text-[#eead2b]">savings</span>
              </div>
              <p className="text-[#c9b792] text-sm font-medium">Net Profit</p>
              <h3 className="text-white text-2xl font-bold tracking-tight">{fmtEtb(netProfitToday)}</h3>
              <div className="flex items-center gap-1 mt-2">
                <span className={`material-symbols-outlined text-sm ${Number(profitDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{Number(profitDeltaPct || 0) >= 0 ? 'trending_up' : 'trending_down'}</span>
                <span className={`text-sm font-bold ${Number(profitDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtPct(profitDeltaPct) ?? '—'}</span>
                <span className="text-[#c9b792] text-xs ml-1">vs yesterday</span>
              </div>
            </div>

            <div className="bg-[#362b18] p-4 rounded-xl border border-[#483c23] flex flex-col gap-1 relative overflow-hidden group hover:border-[#eead2b]/30 transition-colors">
              <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-[64px] text-[#eead2b]">receipt_long</span>
              </div>
              <p className="text-[#c9b792] text-sm font-medium">Total Orders</p>
              <h3 className="text-white text-2xl font-bold tracking-tight">{ordersToday.toLocaleString()}</h3>
              <div className="flex items-center gap-1 mt-2">
                <span className={`material-symbols-outlined text-sm ${Number(ordersDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{Number(ordersDeltaPct || 0) >= 0 ? 'trending_up' : 'trending_down'}</span>
                <span className={`text-sm font-bold ${Number(ordersDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtPct(ordersDeltaPct) ?? '—'}</span>
                <span className="text-[#c9b792] text-xs ml-1">vs yesterday</span>
              </div>
            </div>

            <div className="bg-[#362b18] p-4 rounded-xl border border-[#483c23] flex flex-col gap-1 relative overflow-hidden group hover:border-[#eead2b]/30 transition-colors">
              <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-[64px] text-[#eead2b]">point_of_sale</span>
              </div>
              <p className="text-[#c9b792] text-sm font-medium">Avg. Ticket Size</p>
              <h3 className="text-white text-2xl font-bold tracking-tight">{fmtEtb(avgTicket)}</h3>
              <div className="flex items-center gap-1 mt-2">
                <span className={`material-symbols-outlined text-sm ${Number(avgTicketDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{Number(avgTicketDeltaPct || 0) >= 0 ? 'trending_up' : 'trending_down'}</span>
                <span className={`text-sm font-bold ${Number(avgTicketDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmtPct(avgTicketDeltaPct) ?? '—'}</span>
                <span className="text-[#c9b792] text-xs ml-1">vs yesterday</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-[#362b18] rounded-xl border border-[#483c23] p-5 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-white text-lg font-bold">Sales Trends ({range === 'Daily' ? 'Hourly' : 'Daily'})</h3>
                  <p className="text-[#c9b792] text-sm">Revenue & orders</p>
                </div>
              </div>

              <div className="flex-1 min-h-[220px] w-full relative rounded-lg border border-[#483c23] bg-[#221c10]">
                {trend.length === 0 ? (
                  <div className="h-full flex items-center justify-center px-6 text-center">
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-bold text-white">No sales trend yet</div>
                      <div className="text-xs text-[#c9b792]">This chart will populate after paid orders are recorded.</div>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={trend} margin={{ top: 16, right: 16, left: 0, bottom: 12 }}>
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#eead2b" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#eead2b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#483c23" strokeDasharray="3 3" />
                      <XAxis dataKey="key" stroke="#c9b792" tick={{ fontSize: 10 }} tickFormatter={formatTrendLabel} />
                      <YAxis stroke="#c9b792" tick={{ fontSize: 10 }} />
                      <Tooltip content={<TrendTooltip />} />
                      <Area type="monotone" dataKey="revenue" stroke="#eead2b" strokeWidth={2} fill="url(#trendFill)" dot={false} />
                      <Line type="monotone" dataKey="orders" stroke="#4ade80" strokeWidth={1.6} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-[#362b18] rounded-xl border border-[#483c23] p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white text-lg font-bold">Top Selling</h3>
                <button onClick={() => onNavigate(Screen.MANAGER_REPORTS)} className="text-[#eead2b] text-xs font-medium hover:underline">View All</button>
              </div>

              {topSelling.length === 0 ? (
                <div className="h-56 w-full rounded-lg border border-dashed border-[#483c23] bg-[#221c10] flex items-center justify-center px-6 text-center">
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-bold text-white">No items yet</div>
                    <div className="text-xs text-[#c9b792]">Top selling will appear after sales are recorded.</div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 pr-1">
                  {topSelling.map((p, idx) => {
                    const max = Math.max(1, ...topSelling.map((x) => x.qty));
                    const pct = Math.max(0, Math.min(100, (p.qty / max) * 100));
                    return (
                      <div key={p.productId || `${p.name}-${idx}`} className="flex items-center gap-3">
                        <div
                          className="size-10 rounded-lg bg-cover bg-center shrink-0 border border-[#483c23]"
                          style={{ backgroundImage: `url('${p.imageUrl}')` }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-white text-sm font-medium truncate">{p.name || p.productId}</p>
                            <p className="text-white text-sm font-bold">{p.qty}</p>
                          </div>
                          <div className="w-full bg-[#221c10] h-1.5 rounded-full overflow-hidden">
                            <div className="bg-[#eead2b] h-full rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#362b18] rounded-xl border border-[#483c23] flex flex-col h-full">
              <div className="p-4 border-b border-[#483c23] flex items-center justify-between">
                <h3 className="text-white text-lg font-bold">Live Operations</h3>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#eead2b] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#eead2b]" />
                </span>
              </div>

              <div className="flex flex-col">
                {liveOps.length === 0 ? (
                  <div className="p-6 text-sm text-[#c9b792]">No recent activity.</div>
                ) : (
                  liveOps.slice(0, 3).map((e) => {
                    const icon = e.tone === 'success' ? 'check_circle' : e.tone === 'warn' ? 'warning' : 'info';
                    const iconTone = e.tone === 'success' ? 'text-emerald-500 bg-emerald-500/10' : e.tone === 'warn' ? 'text-rose-500 bg-rose-500/10' : 'text-[#eead2b] bg-[#eead2b]/10';
                    const when = relTimeLabel(e.at);
                    return (
                      <div key={e.id} className="flex items-center gap-4 p-4 border-b border-[#483c23]/50 hover:bg-[#42351f] transition-colors">
                        <div className={`size-10 rounded-full flex items-center justify-center shrink-0 ${iconTone}`}>
                          <span className="material-symbols-outlined">{icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{e.title}</p>
                          <p className="text-[#c9b792] text-xs truncate">{e.subtitle}</p>
                        </div>
                        <span className="text-[#c9b792] text-xs font-medium whitespace-nowrap">{when}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 mt-auto border-t border-[#483c23] text-center">
                <button onClick={() => onNavigate(Screen.MANAGER_REPORTS)} className="text-xs text-[#c9b792] hover:text-white font-medium transition-colors">View All Activity</button>
              </div>
            </div>

            <div className="bg-[#362b18] rounded-xl border border-[#483c23] flex flex-col h-full">
              <div className="p-4 border-b border-[#483c23] flex items-center justify-between">
                <h3 className="text-white text-lg font-bold">Inventory Health</h3>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded border ${
                    inventoryAlerts.criticalCount > 0
                      ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                      : inventoryAlerts.lowCount > 0
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  }`}
                >
                  {inventoryAlerts.criticalCount > 0
                    ? `${inventoryAlerts.criticalCount} critical`
                    : inventoryAlerts.lowCount > 0
                      ? `${inventoryAlerts.lowCount} low`
                      : 'OK'}
                </span>
              </div>

              <div className="p-4 flex flex-col gap-4">
                <div className="rounded-xl border border-[#483c23] bg-[#221c10] p-4">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg border border-[#483c23] bg-[#362b18] flex items-center justify-center text-[#eead2b]">
                      <span className="material-symbols-outlined">dns</span>
                    </div>
                    <div>
                      <p className="text-white font-bold">System Health</p>
                      <p className="text-xs text-[#c9b792]">Inventory status for this branch</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`size-2 rounded-full ${
                            inventoryAlerts.criticalCount > 0
                              ? 'bg-rose-500'
                              : inventoryAlerts.lowCount > 0
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                          }`}
                        />
                        <span className="text-sm text-white">Inventory</span>
                      </div>
                      <span
                        className={`text-sm font-mono ${
                          inventoryAlerts.criticalCount > 0
                            ? 'text-rose-400'
                            : inventoryAlerts.lowCount > 0
                              ? 'text-amber-300'
                              : 'text-emerald-400'
                        }`}
                      >
                        {inventoryAlerts.criticalCount > 0
                          ? `${inventoryAlerts.criticalCount} critical`
                          : inventoryAlerts.lowCount > 0
                            ? `${inventoryAlerts.lowCount} low`
                            : 'OK'}
                      </span>
                    </div>
                  </div>
                </div>

                {inventoryAlerts.rows.length === 0 ? (
                  <div className="rounded-xl border border-[#483c23] bg-[#221c10] p-5">
                    <div className="flex items-center gap-3">
                      <span className="size-2 rounded-full bg-emerald-400" />
                      <div>
                        <p className="text-white font-bold">All inventory levels look good</p>
                        <p className="text-xs text-[#c9b792]">No low stock or critical items right now.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#483c23] bg-[#221c10] overflow-hidden">
                    <div className="divide-y divide-[#483c23]">
                      {inventoryAlerts.rows.map((it) => {
                        const isCritical = it.status === 'Critical';
                        const dot = isCritical ? 'bg-rose-500' : 'bg-amber-400';
                        const title = `${isCritical ? 'Critical' : 'Low Stock'}: ${it.name}`;
                        const subtitle = `${branchName || 'This branch'} has ${Number(it.stock || 0)} ${it.unit || ''}`.trim();
                        const when = it.updatedAt ? relTimeLabel(it.updatedAt) : 'now';
                        return (
                          <div key={it.id} className="p-4 hover:bg-[#42351f] transition-colors">
                            <div className="flex items-start gap-3">
                              <span className={`mt-1 size-2 rounded-full ${dot}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-bold truncate">{title}</p>
                                <p className="text-[#c9b792] text-sm truncate">{subtitle}</p>
                                <p className="text-[#c9b792]/70 text-xs mt-1">{when === 'now' ? 'Just now' : when}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <button
                    onClick={() => onNavigate(Screen.MANAGER_INVENTORY)}
                    className="text-xs text-[#c9b792] hover:text-white font-medium transition-colors"
                  >
                    Open Inventory
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
