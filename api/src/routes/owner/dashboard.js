const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { safeJsonParse } = require('../../utils/errors');

const makeOwnerDashboardRouter = ({ requireOwnerAuth, clampInt }) => {
  const r = express.Router();

  // Helper: compute percentage delta
  const pctDelta = (cur, prev) => {
    const a = Number(cur || 0) || 0;
    const b = Number(prev || 0) || 0;
    if (!b) return a ? 100 : 0;
    return ((a - b) / Math.abs(b)) * 100;
  };

  // Helper: date boundaries
  const startOfDayIso = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString();
  };

  const endOfDayIso = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.toISOString();
  };

  // Dashboard redirect
  r.get(
    '/owner/dashboard',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('owner_dashboard'),
    async (req, res, next) => {
      try {
        req.url = '/owner/overview';
        return next('route');
      } catch (e) {
        return next(e);
      }
    },
  );

  // Overview (main dashboard data)
  r.get(
    '/owner/overview',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('owner_dashboard'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
        const rangeRaw = typeof req.query?.range === 'string' ? req.query.range.trim() : '';
        const range = rangeRaw === 'Weekly' ? 'Weekly' : rangeRaw === 'Monthly' ? 'Monthly' : 'Daily';
        const now = new Date();
        const monthStart = startOfDayIso(new Date(now.getFullYear(), now.getMonth(), 1));
        const monthEnd = endOfDayIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        const prevMonthStart = startOfDayIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const prevMonthEnd = endOfDayIso(new Date(now.getFullYear(), now.getMonth(), 0));
        const start = startOfDayIso(now);
        const end = endOfDayIso(now);

        let monthOrders = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', monthStart).andWhere('paid_at', '<=', monthEnd);
        if (branchId) monthOrders = monthOrders.andWhere({ branch_id: branchId });

        const monthAgg = await monthOrders.clone().sum({ revenue: 'total' }).count({ cnt: '*' }).first();
        const totalRevenueMonth = Number(monthAgg?.revenue || 0) || 0;
        const totalOrders = Number(monthAgg?.cnt ?? monthAgg?.count ?? monthAgg?.['count(*)'] ?? 0) || 0;

        let prevMonthOrders = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', prevMonthStart).andWhere('paid_at', '<=', prevMonthEnd);
        if (branchId) prevMonthOrders = prevMonthOrders.andWhere({ branch_id: branchId });
        const prevMonthAgg = await prevMonthOrders.clone().sum({ revenue: 'total' }).count({ cnt: '*' }).first();
        const prevRevenueMonth = Number(prevMonthAgg?.revenue || 0) || 0;
        const prevOrdersMonth = Number(prevMonthAgg?.cnt ?? prevMonthAgg?.count ?? prevMonthAgg?.['count(*)'] ?? 0) || 0;

        let opexQ = db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', monthStart).andWhere('at', '<=', monthEnd);
        if (branchId) opexQ = opexQ.andWhere({ branch_id: branchId });
        const opexRow = await opexQ.clone().sum({ s: 'amount' }).first();
        const opex = Number(opexRow?.s || 0) || 0;

        let prevOpexQ = db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', prevMonthStart).andWhere('at', '<=', prevMonthEnd);
        if (branchId) prevOpexQ = prevOpexQ.andWhere({ branch_id: branchId });
        const prevOpexRow = await prevOpexQ.clone().sum({ s: 'amount' }).first();
        const prevOpex = Number(prevOpexRow?.s || 0) || 0;

        const cogs = 0;
        const prevCogs = 0;
        const netProfit = totalRevenueMonth - cogs - opex;
        const prevNetProfit = prevRevenueMonth - prevCogs - prevOpex;

        let trend = [];
        try {
          if (range === 'Daily') {
            let base = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', start).andWhere('paid_at', '<=', end);
            if (branchId) base = base.andWhere({ branch_id: branchId });
            const rows = await base
              .clone()
              .select([
                db().raw('HOUR(paid_at) as h'),
                db().raw('COUNT(*) as orderCount'),
                db().raw('COALESCE(SUM(total), 0) as total'),
              ])
              .groupBy([db().raw('HOUR(paid_at)')])
              .orderBy(db().raw('HOUR(paid_at)'), 'asc');

            trend = rows
              .map((r) => {
                const h = Number(r.h ?? 0) || 0;
                const label = `${String(h).padStart(2, '0')}:00`;
                return {
                  key: label,
                  revenue: Number(r.total || 0) || 0,
                  orders: Number(r.orderCount || 0) || 0,
                };
              })
              .filter((x) => x.key);
          } else {
            const days = range === 'Weekly' ? 7 : 30;
            const endDay = endOfDayIso(now);
            const startDay = startOfDayIso(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
            let base = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', startDay).andWhere('paid_at', '<=', endDay);
            if (branchId) base = base.andWhere({ branch_id: branchId });
            const rows = await base
              .clone()
              .select([
                db().raw('DATE(paid_at) as d'),
                db().raw('COUNT(*) as orderCount'),
                db().raw('COALESCE(SUM(total), 0) as total'),
              ])
              .groupBy([db().raw('DATE(paid_at)')])
              .orderBy(db().raw('DATE(paid_at)'), 'asc');
            trend = rows
              .map((r) => {
                const key = r.d ? String(r.d) : '';
                return {
                  key,
                  revenue: Number(r.total || 0) || 0,
                  orders: Number(r.orderCount || 0) || 0,
                };
              })
              .filter((x) => x.key);
          }
        } catch {
          trend = [];
        }

        let branchesQ = db()
          .select([
            'b.id',
            'b.name',
            'b.status',
            db().raw('COALESCE(SUM(o.total), 0) as revenueToday'),
            db().raw('COUNT(DISTINCT o.id) as ordersToday'),
          ])
          .from({ b: 'branches' })
          .leftJoin({ o: 'orders' }, function joinOrders() {
            this.on('o.branch_id', '=', 'b.id')
              .andOn('o.tenant_id', '=', 'b.tenant_id')
              .andOn('o.paid_at', '>=', db().raw('?', [start]))
              .andOn('o.paid_at', '<=', db().raw('?', [end]));
          })
          .where({ 'b.tenant_id': req.tenant.id });

        if (branchId) branchesQ = branchesQ.andWhere('b.id', branchId);

        const branchRows = await branchesQ.groupBy(['b.id', 'b.name', 'b.status']).orderBy('b.name', 'asc');

        const branchIds = branchRows.map((b) => String(b.id));
        const managerRows = branchIds.length
          ? await db()
              .select(['branch_id', 'name'])
              .from('staff')
              .where({ tenant_id: req.tenant.id })
              .whereIn('branch_id', branchIds)
              .andWhere((q) => q.where('role_name', 'like', '%Manager%').orWhere('role_name', 'like', '%manager%'))
          : [];
        const managerByBranch = new Map();
        for (const m of managerRows) {
          const bid = m.branch_id ? String(m.branch_id) : '';
          if (!bid || managerByBranch.has(bid)) continue;
          managerByBranch.set(bid, String(m.name || ''));
        }

        const branches = branchRows.map((x) => ({
          id: String(x.id),
          name: String(x.name || ''),
          manager: managerByBranch.get(String(x.id)) || '',
          revenueToday: Number(x.revenueToday || 0) || 0,
          ordersToday: Number(x.ordersToday || 0) || 0,
          rating: 0,
          status: String(x.status || 'Open') === 'Closed' ? 'Closed' : 'Open',
        }));

        const totalBranches = branchId ? (branches.length ? 1 : 0) : Number(await db().from('branches').where({ tenant_id: req.tenant.id }).count({ c: '*' }).first().then((r) => r?.c ?? r?.count ?? r?.['count(*)'] ?? 0));
        const activeBranches = branches.filter((b) => b.status === 'Open').length;

        let lowStockCount = 0;
        let criticalStockCount = 0;
        try {
          let invQ = db().from('inventory_items').where({ tenant_id: req.tenant.id });
          if (branchId) invQ = invQ.andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId));

          const lowRow = await invQ
            .clone()
            .whereRaw('COALESCE(on_hand, 0) > 0')
            .andWhereRaw('COALESCE(reorder_level, 0) > 0')
            .andWhereRaw('COALESCE(on_hand, 0) < COALESCE(reorder_level, 0)')
            .count({ c: '*' })
            .first();
          lowStockCount = Number(lowRow?.c ?? lowRow?.count ?? lowRow?.['count(*)'] ?? 0) || 0;

          const critRow = await invQ
            .clone()
            .whereRaw('COALESCE(on_hand, 0) <= 0')
            .count({ c: '*' })
            .first();
          criticalStockCount = Number(critRow?.c ?? critRow?.count ?? critRow?.['count(*)'] ?? 0) || 0;
        } catch {
          lowStockCount = 0;
          criticalStockCount = 0;
        }

        let overdueInvoiceCount = 0;
        try {
          let inv = db().from('invoices').where({ tenant_id: req.tenant.id }).whereNull('paid_at');
          inv = inv.andWhere((q) => q.where('status', 'pending').orWhere('status', 'overdue'));
          inv = inv.andWhere('due_date', '<', now.toISOString());
          const row = await inv.clone().count({ c: '*' }).first();
          overdueInvoiceCount = Number(row?.c ?? row?.count ?? row?.['count(*)'] ?? 0) || 0;
        } catch {
          overdueInvoiceCount = 0;
        }

        const alerts = [];
        if (criticalStockCount > 0) {
          alerts.push({
            title: 'Critical stock items',
            detail: `${criticalStockCount} SKU(s) are out of stock.`,
            severity: 'Critical',
            icon: 'inventory_2',
          });
        } else if (lowStockCount > 0) {
          alerts.push({
            title: 'Low stock',
            detail: `${lowStockCount} SKU(s) are below reorder level.`,
            severity: 'Warning',
            icon: 'inventory_2',
          });
        }

        if (overdueInvoiceCount > 0) {
          alerts.push({
            title: 'Overdue invoices',
            detail: `${overdueInvoiceCount} invoice(s) are overdue.`,
            severity: 'Critical',
            icon: 'receipt_long',
          });
        }

        const health = [
          {
            label: 'Inventory',
            value: criticalStockCount > 0 ? `${criticalStockCount} critical` : lowStockCount > 0 ? `${lowStockCount} low` : 'OK',
            status: criticalStockCount > 0 ? 'Bad' : lowStockCount > 0 ? 'Warn' : 'Good',
          },
          {
            label: 'Invoices',
            value: overdueInvoiceCount > 0 ? `${overdueInvoiceCount} overdue` : 'OK',
            status: overdueInvoiceCount > 0 ? 'Warn' : 'Good',
          },
        ];

        return res.json({
          ok: true,
          meta: { range },
          kpis: {
            totalRevenueMonth,
            revenueDeltaPct: pctDelta(totalRevenueMonth, prevRevenueMonth),
            activeBranches,
            totalBranches: Number(totalBranches || 0) || 0,
            totalOrders,
            ordersDeltaPct: pctDelta(totalOrders, prevOrdersMonth),
            netProfit,
            netProfitDeltaPct: pctDelta(netProfit, prevNetProfit),
          },
          trend,
          branches,
          alerts,
          health,
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  // Reports
  r.get(
    '/owner/reports',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
        const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
        const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

        const toBounds = (rawFrom, rawTo) => {
          const fromRaw = String(rawFrom || '').trim();
          const toRaw = String(rawTo || '').trim();

          const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
          const safeDate = (s) => {
            const d = new Date(s);
            return Number.isNaN(d.getTime()) ? null : d;
          };

          const fallbackFrom = startOfDayIso(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
          const fallbackTo = endOfDayIso(new Date());

          if (!fromRaw && !toRaw) return { from: fallbackFrom, to: fallbackTo };

          if (isDateOnly(fromRaw) && isDateOnly(toRaw)) {
            const fromD = safeDate(`${fromRaw}T00:00:00.000`);
            const toD = safeDate(`${toRaw}T00:00:00.000`);
            if (!fromD || !toD) return { from: fallbackFrom, to: fallbackTo };
            return { from: startOfDayIso(fromD), to: endOfDayIso(toD) };
          }

          const fromD = fromRaw ? safeDate(fromRaw) : null;
          const toD = toRaw ? safeDate(toRaw) : null;
          return {
            from: fromD ? fromD.toISOString() : fallbackFrom,
            to: toD ? toD.toISOString() : fallbackTo,
          };
        };

        const { from, to } = toBounds(fromIso, toIso);

        let base = db().from('orders').where({ tenant_id: req.tenant.id, status: 'Paid' });
        if (branchId) base = base.andWhere({ branch_id: branchId });
        base = base.andWhere('paid_at', '>=', from).andWhere('paid_at', '<=', to);

        const sumRow = await base.clone().sum({ netSales: 'total' }).sum({ tax: 'tax' }).sum({ tips: 'tip' }).sum({ discounts: 'discount' }).count({ txCount: '*' }).first();
        const totals = {
          txCount: Number(sumRow?.txCount ?? sumRow?.count ?? sumRow?.['count(*)'] ?? 0) || 0,
          netSales: Number(sumRow?.netSales || 0) || 0,
          tax: Number(sumRow?.tax || 0) || 0,
          tips: Number(sumRow?.tips || 0) || 0,
          discounts: Number(sumRow?.discounts || 0) || 0,
          totalCollected: (Number(sumRow?.netSales || 0) || 0) + (Number(sumRow?.tax || 0) || 0) + (Number(sumRow?.tips || 0) || 0) - (Number(sumRow?.discounts || 0) || 0),
        };

        const dailyRows = await base
          .clone()
          .select([
            db().raw('DATE(paid_at) as d'),
            db().raw('COUNT(*) as txCount'),
            db().raw('COALESCE(SUM(total), 0) as netSales'),
            db().raw('COALESCE(SUM(tax), 0) as tax'),
            db().raw('COALESCE(SUM(tip), 0) as tips'),
            db().raw('COALESCE(SUM(discount), 0) as discounts'),
          ])
          .groupBy([db().raw('DATE(paid_at)')])
          .orderBy(db().raw('DATE(paid_at)'), 'asc');

        const ledger = dailyRows.map((r) => {
          const netSales = Number(r.netSales || 0) || 0;
          const tax = Number(r.tax || 0) || 0;
          const tips = Number(r.tips || 0) || 0;
          const discounts = Number(r.discounts || 0) || 0;
          return {
            date: r.d ? String(r.d) : '',
            txCount: Number(r.txCount || 0) || 0,
            netSales,
            tax,
            tips,
            discounts,
            totalCollected: netSales + tax + tips - discounts,
          };
        });

        const ymMap = new Map();
        for (const r of ledger) {
          const ym = r.date ? String(r.date).slice(0, 7) : '';
          if (!ym) continue;
          const prev = ymMap.get(ym) || { ym, name: ym, revenue: 0, expenses: 0 };
          prev.revenue += Number(r.totalCollected || 0) || 0;
          ymMap.set(ym, prev);
        }
        const trend = Array.from(ymMap.values()).sort((a, b) => String(a.ym).localeCompare(String(b.ym)));

        const categories = [
          { name: 'Net Sales', value: totals.netSales },
          { name: 'Tax', value: totals.tax },
          { name: 'Tips', value: totals.tips },
          { name: 'Discounts', value: Math.max(0, totals.discounts) },
        ].filter((x) => Number(x.value) > 0);

        let branchBreakdown = [];
        if (!branchId) {
          const bRows = await db()
            .from({ o: 'orders' })
            .leftJoin({ b: 'branches' }, function joinBranches() {
              this.on('b.id', '=', 'o.branch_id').andOn('b.tenant_id', '=', 'o.tenant_id');
            })
            .where({ 'o.tenant_id': req.tenant.id })
            .andWhere('o.paid_at', '>=', from)
            .andWhere('o.paid_at', '<=', to)
            .select([
              'o.branch_id',
              'b.name as branch_name',
              'b.status as branch_status',
              db().raw('COUNT(*) as txCount'),
              db().raw('COALESCE(SUM(o.total), 0) as netSales'),
              db().raw('COALESCE(SUM(o.tax), 0) as tax'),
              db().raw('COALESCE(SUM(o.tip), 0) as tips'),
              db().raw('COALESCE(SUM(o.discount), 0) as discounts'),
            ])
            .groupBy(['o.branch_id', 'b.name', 'b.status'])
            .orderBy(db().raw('COALESCE(SUM(o.total), 0)'), 'desc');

          branchBreakdown = bRows.map((x) => {
            const netSales = Number(x.netSales || 0) || 0;
            const tax = Number(x.tax || 0) || 0;
            const tips = Number(x.tips || 0) || 0;
            const discounts = Number(x.discounts || 0) || 0;
            return {
              branchId: String(x.branch_id),
              name: String(x.branch_name || ''),
              status: String(x.branch_status || ''),
              txCount: Number(x.txCount || 0) || 0,
              netSales,
              tax,
              tips,
              discounts,
              totalCollected: netSales + tax + tips - discounts,
            };
          });
        }

        // What is sold: derive from orders.payload.items
        let soldItems = [];
        let soldCategories = [];
        let paymentMethods = [];
        try {
          const rows0 = await base.clone().select(['payload', 'total']).orderBy('paid_at', 'desc').limit(2000);
          const byProduct = new Map();
          const productIds = new Set();

          const normalizePm = (raw) => {
            const s = String(raw || '').trim().toLowerCase();
            if (!s) return 'Other';
            if (s === 'cash') return 'Cash';
            if (s === 'card') return 'Card';
            if (s === 'telebirr') return 'Telebirr';
            if (s === 'loyalty') return 'Loyalty';
            return 'Other';
          };

          const byPm = new Map();

          const addPm = (pm, amount) => {
            const key = normalizePm(pm);
            const prev = byPm.get(key) || { name: key, txCount: 0, amount: 0 };
            prev.txCount += 1;
            prev.amount += Number(amount || 0) || 0;
            byPm.set(key, prev);
          };

          for (const r0 of rows0) {
            const p0 = safeJsonParse(r0.payload, null);

            const splits = Array.isArray(p0?.splits)
              ? p0.splits
              : Array.isArray(p0?.order?.splits)
                ? p0.order.splits
                : [];

            if (Array.isArray(splits) && splits.length) {
              for (const sp of splits) {
                const status = String(sp?.status || '').trim().toLowerCase();
                if (status && status !== 'paid') continue;
                const amt = Number(sp?.total ?? sp?.amount ?? 0) || 0;
                addPm(sp?.paymentMethod || sp?.method || p0?.paymentMethod || p0?.method, amt);
              }
            } else {
              const amt = Number(r0.total || 0) || 0;
              addPm(p0?.paymentMethod || p0?.method || p0?.tender || p0?.paidBy, amt);
            }

            const items = Array.isArray(p0?.items) ? p0.items : Array.isArray(p0?.order?.items) ? p0.order.items : [];
            for (const it of items) {
              const productId = String(it?.productId || it?.id || '').trim();
              if (!productId) continue;
              const name = String(it?.name || '').trim() || productId;
              const unitPrice = Number(it?.unitPrice || it?.price || 0) || 0;
              const qty0 = Number(it?.qty || 0) || 0;
              const voided = Number(it?.voidedQty || 0) || 0;
              const qty = Math.max(0, qty0 - voided);
              if (!qty) continue;

              productIds.add(productId);
              const prev = byProduct.get(productId) || { productId, name, qty: 0, revenue: 0, category: '' };
              prev.name = prev.name || name;
              prev.qty += qty;
              prev.revenue += qty * unitPrice;
              byProduct.set(productId, prev);
            }
          }

          let categoryByProduct = new Map();
          try {
            const ids = Array.from(productIds);
            if (ids.length) {
              const prodRows = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).select(['id', 'category', 'product_json']);
              categoryByProduct = new Map(
                prodRows.map((x) => {
                  const pj = safeJsonParse(x.product_json, {});
                  const cat = String(x.category || pj?.category || '').trim();
                  return [String(x.id), cat];
                }),
              );
            }
          } catch {
            categoryByProduct = new Map();
          }

          soldItems = Array.from(byProduct.values())
            .map((x) => ({
              productId: String(x.productId),
              name: String(x.name || x.productId),
              category: String(categoryByProduct.get(String(x.productId)) || x.category || 'Uncategorized'),
              qty: Number(x.qty || 0) || 0,
              revenue: Number(x.revenue || 0) || 0,
            }))
            .sort((a, b) => (b.revenue - a.revenue) || (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)))
            .slice(0, 30);

          const byCat = new Map();
          for (const it of Array.from(byProduct.values())) {
            const cat = String(categoryByProduct.get(String(it.productId)) || it.category || 'Uncategorized');
            const prev = byCat.get(cat) || { name: cat, qty: 0, revenue: 0 };
            prev.qty += Number(it.qty || 0) || 0;
            prev.revenue += Number(it.revenue || 0) || 0;
            byCat.set(cat, prev);
          }
          soldCategories = Array.from(byCat.values())
            .sort((a, b) => (b.revenue - a.revenue) || (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)))
            .slice(0, 12);

          paymentMethods = Array.from(byPm.values())
            .map((x) => ({ name: String(x.name), txCount: Number(x.txCount || 0) || 0, amount: Number(x.amount || 0) || 0 }))
            .sort((a, b) => (b.amount - a.amount) || (b.txCount - a.txCount) || String(a.name).localeCompare(String(b.name)));
        } catch {
          soldItems = [];
          soldCategories = [];
          paymentMethods = [];
        }

        return res.json({
          kpis: { totalRevenueNet: totals.netSales, cogs: 0, laborCost: 0 },
          trend,
          categories,
          soldItems,
          soldCategories,
          paymentMethods,
          branchBreakdown,
          ledger,
          totals,
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerDashboardRouter };
