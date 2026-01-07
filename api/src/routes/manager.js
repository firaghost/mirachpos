const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { requirePermission } = require('../middleware/permissions');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

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

const makeManagerRouter = () => {
  const r = express.Router();

  const requireManagerOrOwner = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const role = String(req.auth?.role || '');
    if (role !== 'Branch Manager' && role !== 'Cafe Owner') {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  const toIsoDateOnly = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
    if (!m) return '';
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return '';
    return s;
  };

  const normalizeInt = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  r.get(
    '/manager/overview',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });
      const role = String(req.auth?.role || '');
      if (role !== 'Branch Manager' && role !== 'Cafe Owner') return res.status(403).json({ error: 'forbidden' });

      const branchId = req.branchId || resolveBranchId(req);

      const range = typeof req.query?.range === 'string' ? req.query.range.trim() : 'Daily';
      const now = new Date();

      const days = range === 'Monthly' ? 180 : range === 'Weekly' ? 60 : 14;
      const from = startOfDayIso(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
      const to = endOfDayIso(now);

      const todayStart = startOfDayIso(now);
      const todayEnd = endOfDayIso(now);

      const todayAgg = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' })
        .andWhere('paid_at', '>=', todayStart)
        .andWhere('paid_at', '<=', todayEnd)
        .sum({ revenue: 'total' })
        .count({ cnt: '*' })
        .first();

      const salesToday = Number(todayAgg?.revenue || 0) || 0;
      const paidTodayCount = Number(todayAgg?.cnt ?? todayAgg?.count ?? todayAgg?.['count(*)'] ?? 0) || 0;
      const avgTicketToday = paidTodayCount > 0 ? salesToday / paidTodayCount : 0;

      const openOrdersRow = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhereNot({ status: 'Paid' })
        .count({ cnt: '*' })
        .first();
      const openOrders = Number(openOrdersRow?.cnt ?? openOrdersRow?.count ?? openOrdersRow?.['count(*)'] ?? 0) || 0;

      const staffOnShiftRow = await db()
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .whereNull('clock_out_at')
        .count({ cnt: '*' })
        .first();
      const staffOnShift = Number(staffOnShiftRow?.cnt ?? staffOnShiftRow?.count ?? staffOnShiftRow?.['count(*)'] ?? 0) || 0;

      let trendRows;
      if (range === 'Monthly') {
        trendRows = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' })
          .andWhere('paid_at', '>=', from)
          .andWhere('paid_at', '<=', to)
          .select([
            db().raw("DATE_FORMAT(paid_at, '%Y-%m') as k"),
            db().raw('COUNT(*) as orders'),
            db().raw('COALESCE(SUM(total), 0) as revenue'),
          ])
          .groupBy([db().raw("DATE_FORMAT(paid_at, '%Y-%m')")])
          .orderBy(db().raw("DATE_FORMAT(paid_at, '%Y-%m')"), 'asc');
      } else if (range === 'Weekly') {
        trendRows = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' })
          .andWhere('paid_at', '>=', from)
          .andWhere('paid_at', '<=', to)
          .select([
            db().raw("YEARWEEK(paid_at, 3) as k"),
            db().raw('COUNT(*) as orders'),
            db().raw('COALESCE(SUM(total), 0) as revenue'),
          ])
          .groupBy([db().raw('YEARWEEK(paid_at, 3)')])
          .orderBy(db().raw('YEARWEEK(paid_at, 3)'), 'asc');
      } else {
        trendRows = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' })
          .andWhere('paid_at', '>=', from)
          .andWhere('paid_at', '<=', to)
          .select([
            db().raw('DATE(paid_at) as k'),
            db().raw('COUNT(*) as orders'),
            db().raw('COALESCE(SUM(total), 0) as revenue'),
          ])
          .groupBy([db().raw('DATE(paid_at)')])
          .orderBy(db().raw('DATE(paid_at)'), 'asc');
      }

      const trend = (Array.isArray(trendRows) ? trendRows : []).map((r) => ({
        key: r.k != null ? String(r.k) : '',
        revenue: Number(r.revenue || 0) || 0,
        orders: Number(r.orders || 0) || 0,
      }));

      const recentRows = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'Paid' })
        .orderBy('paid_at', 'desc')
        .limit(10)
        .select(['id', 'total', 'paid_at']);

      const recentPaid = recentRows.map((x) => ({
        id: String(x.id),
        total: Number(x.total || 0) || 0,
        paidAt: x.paid_at ? new Date(x.paid_at).toISOString() : null,
      }));

      return res.json({
        ok: true,
        branchId,
        range,
        from,
        to,
        kpis: { salesToday, openOrders, staffOnShift, avgTicketToday },
        trend,
        recentPaid,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/manager/settings',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = req.branchId || resolveBranchId(req);

      const row = await db()
        .select(['settings_json'])
        .from('manager_settings')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .first();

      const settings = (() => {
        try {
          return row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          return {};
        }
      })();

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, settings });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/manager/settings',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.write'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const settings = body && body.settings && typeof body.settings === 'object' ? body.settings : null;
      if (!settings) return res.status(400).json({ error: 'invalid_settings' });

      const nowIso = new Date().toISOString();
      await db()
        .from('manager_settings')
        .insert({ tenant_id: req.tenant.id, branch_id: branchId, settings_json: JSON.stringify(settings), updated_at: nowIso })
        .onConflict(['tenant_id', 'branch_id'])
        .merge({ settings_json: JSON.stringify(settings), updated_at: nowIso });

      const row = await db()
        .select(['settings_json'])
        .from('manager_settings')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .first();

      const stored = (() => {
        try {
          return row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          return {};
        }
      })();

      return res.json({ ok: true, tenantId: req.tenant.id, branchId, settings: stored });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/manager/reports',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.export'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const parseIso = (raw) => {
        const s = typeof raw === 'string' ? raw.trim() : '';
        if (!s) return null;
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
      };

      const fromAt = parseIso(req.query?.from);
      const toAt = parseIso(req.query?.to);

      const businessHeader = (() => {
        return {
          businessName: '',
          legalName: '',
          tin: '',
          phone: '',
          email: '',
          address: '',
          receipt: { showTin: true, logoDataUrl: '' },
        };
      })();

      try {
        const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
        let settings;
        try {
          settings = row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          settings = {};
        }
        const business = settings?.business && typeof settings.business === 'object' ? settings.business : {};
        const receipt = settings?.receipt && typeof settings.receipt === 'object' ? settings.receipt : {};
        businessHeader.businessName = String(business.businessName || '').trim();
        businessHeader.legalName = String(business.legalName || '').trim();
        businessHeader.tin = String(business.tin || '').trim();
        businessHeader.phone = String(business.phone || '').trim();
        businessHeader.email = String(business.email || '').trim();
        businessHeader.address = String(business.address || '').trim();
        businessHeader.receipt = {
          showTin: typeof receipt.showTin === 'boolean' ? receipt.showTin : true,
          logoDataUrl: typeof receipt.logoDataUrl === 'string' ? receipt.logoDataUrl : '',
        };
      } catch {
        // ignore
      }

      const staffRows = await db()
        .from('staff')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .orderBy('name', 'asc')
        .select(['id', 'name', 'role_name', 'phone', 'status']);

      const staff = staffRows.map((s) => ({
        id: String(s.id),
        name: String(s.name || ''),
        role: String(s.role_name || ''),
        phone: String(s.phone || ''),
        status: String(s.status || 'Active'),
        shift: '',
        avatar: '',
      }));

      let shiftQ = db()
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId });

      // If a range is provided, fetch shifts overlapping the range.
      if (fromAt && toAt && toAt.getTime() >= fromAt.getTime()) {
        const fromIso = fromAt.toISOString();
        const toIso = toAt.toISOString();
        shiftQ = shiftQ
          .andWhere('clock_in_at', '<=', toIso)
          .andWhere(function () {
            this.whereNull('clock_out_at').orWhere('clock_out_at', '>=', fromIso);
          })
          .orderBy('clock_in_at', 'asc')
          .limit(2000);
      } else {
        shiftQ = shiftQ.orderBy('clock_in_at', 'desc').limit(200);
      }

      const shiftRows = await shiftQ.select(['id', 'staff_id', 'clock_in_at', 'clock_out_at']);

      const shiftLogs = shiftRows.map((l) => ({
        id: String(l.id),
        staffId: String(l.staff_id),
        clockInAt: l.clock_in_at ? new Date(l.clock_in_at).toISOString() : '',
        clockOutAt: l.clock_out_at ? new Date(l.clock_out_at).toISOString() : null,
      }));

      const safeJsonParse = (raw, fallback) => {
        try {
          if (!raw) return fallback;
          const parsed = JSON.parse(String(raw));
          return parsed ?? fallback;
        } catch {
          return fallback;
        }
      };

      const cashRows = await db()
        .from('finance_ledger')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, type: 'cash_session' })
        .orderBy('at', 'desc')
        .limit(200)
        .select(['id', 'payload_json', 'at', 'created_at']);

      const cashSessions = cashRows.map((row) => {
        const payload = safeJsonParse(row.payload_json, {});
        return {
          id: String(row.id),
          register: String(payload?.register || 'POS'),
          staffName: String(payload?.staffName || ''),
          staffRole: String(payload?.staffRole || ''),
          openingCash: Number(payload?.openingCash ?? 0) || 0,
          expectedCash: Number(payload?.expectedCash ?? 0) || 0,
          actualCash: payload?.actualCash == null ? undefined : Number(payload.actualCash ?? 0) || 0,
          status: String(payload?.status || 'Active'),
          openedAt: String(payload?.openedAt || row.at || row.created_at || new Date().toISOString()),
          closedAt: payload?.closedAt ? String(payload.closedAt) : undefined,
        };
      });

      const expenseRows = await db()
        .from('finance_ledger')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, type: 'expense' })
        .orderBy('at', 'desc')
        .limit(200)
        .select(['id', 'category', 'amount', 'memo', 'payload_json', 'at', 'created_at']);

      const expenses = expenseRows.map((row) => {
        const payload = safeJsonParse(row.payload_json, {});
        const icon =
          payload?.icon === 'local_shipping' ||
          payload?.icon === 'build' ||
          payload?.icon === 'sanitizer' ||
          payload?.icon === 'receipt_long'
            ? payload.icon
            : 'receipt_long';
        return {
          id: String(row.id),
          title: String(payload?.title || payload?.name || row.category || 'Expense'),
          vendor: String(payload?.vendor || row.memo || ''),
          amount: Number(row.amount ?? 0) || 0,
          createdAt: row.at ? new Date(row.at).toISOString() : row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          icon,
        };
      });

      return res.json({ ok: true, branchId, businessHeader, staff, shiftLogs, cashSessions, expenses });
    } catch (e) {
      return next(e);
    }
  });

  // Aggregated daily sales summary (fast reports)
  r.get(
    '/manager/reports/daily',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const from = toIsoDateOnly(req.query?.from);
      const to = toIsoDateOnly(req.query?.to);
      if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

      const limit = Math.max(1, Math.min(400, normalizeInt(req.query?.limit, 120)));

      const rows = await db()
        .from('daily_sales_summary')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('report_date', '>=', from)
        .andWhere('report_date', '<=', to)
        .orderBy('report_date', 'asc')
        .limit(limit)
        .select([
          'report_date',
          'order_count',
          'item_count',
          'gross_sales_etb',
          'discounts_etb',
          'net_sales_etb',
          'tax_etb',
          'tips_etb',
          'total_collected_etb',
          'void_count',
          'void_amount_etb',
          'refund_count',
          'refund_amount_etb',
          'payment_breakdown_json',
          'avg_ticket_etb',
          'first_order_at',
          'last_order_at',
          'computed_at',
        ]);

      const safeJsonParse = (raw, fallback) => {
        try {
          if (!raw) return fallback;
          const parsed = JSON.parse(String(raw));
          return parsed ?? fallback;
        } catch {
          return fallback;
        }
      };

      const daily = rows.map((r) => ({
        date: r.report_date ? new Date(r.report_date).toISOString().slice(0, 10) : '',
        orderCount: Number(r.order_count || 0) || 0,
        itemCount: Number(r.item_count || 0) || 0,
        grossSales: Number(r.gross_sales_etb || 0) || 0,
        discounts: Number(r.discounts_etb || 0) || 0,
        netSales: Number(r.net_sales_etb || 0) || 0,
        tax: Number(r.tax_etb || 0) || 0,
        tips: Number(r.tips_etb || 0) || 0,
        totalCollected: Number(r.total_collected_etb || 0) || 0,
        voidCount: Number(r.void_count || 0) || 0,
        voidAmount: Number(r.void_amount_etb || 0) || 0,
        refundCount: Number(r.refund_count || 0) || 0,
        refundAmount: Number(r.refund_amount_etb || 0) || 0,
        paymentBreakdown: safeJsonParse(r.payment_breakdown_json, {}),
        avgTicket: Number(r.avg_ticket_etb || 0) || 0,
        firstOrderAt: r.first_order_at ? new Date(r.first_order_at).toISOString() : null,
        lastOrderAt: r.last_order_at ? new Date(r.last_order_at).toISOString() : null,
        computedAt: r.computed_at ? new Date(r.computed_at).toISOString() : null,
      }));

      return res.json({ ok: true, branchId, from, to, daily });
    } catch (e) {
      return next(e);
    }
  });

  // Hourly sales summary (heatmap / peak hours)
  r.get(
    '/manager/reports/hourly',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const date = toIsoDateOnly(req.query?.date);
      if (!date) return res.status(400).json({ error: 'date_required' });

      const rows = await db()
        .from('hourly_sales_summary')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('report_date', '=', date)
        .orderBy('hour', 'asc')
        .select(['hour', 'order_count', 'net_sales_etb', 'total_collected_etb', 'computed_at']);

      const hourly = rows.map((r) => ({
        hour: Number(r.hour ?? 0) || 0,
        orderCount: Number(r.order_count || 0) || 0,
        netSales: Number(r.net_sales_etb || 0) || 0,
        totalCollected: Number(r.total_collected_etb || 0) || 0,
        computedAt: r.computed_at ? new Date(r.computed_at).toISOString() : null,
      }));

      return res.json({ ok: true, branchId, date, hourly });
    } catch (e) {
      return next(e);
    }
  });

  // Product performance (uses product_sales_summary)
  r.get(
    '/manager/reports/products',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const from = toIsoDateOnly(req.query?.from);
      const to = toIsoDateOnly(req.query?.to);
      if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

      const limit = Math.max(1, Math.min(200, normalizeInt(req.query?.limit, 50)));

      const rows = await db()
        .from('product_sales_summary')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('report_date', '>=', from)
        .andWhere('report_date', '<=', to)
        .select([
          'product_id',
          'product_name',
          'category',
          db().raw('SUM(qty_sold) as qty_sold'),
          db().raw('SUM(revenue_etb) as revenue_etb'),
          db().raw('SUM(cost_etb) as cost_etb'),
          db().raw('SUM(profit_etb) as profit_etb'),
          db().raw('SUM(void_qty) as void_qty'),
        ])
        .groupBy(['product_id', 'product_name', 'category'])
        .orderBy(db().raw('SUM(revenue_etb)'), 'desc')
        .limit(limit);

      const products = rows.map((r) => ({
        productId: String(r.product_id || ''),
        name: String(r.product_name || ''),
        category: String(r.category || ''),
        qtySold: Number(r.qty_sold || 0) || 0,
        revenue: Number(r.revenue_etb || 0) || 0,
        cost: Number(r.cost_etb || 0) || 0,
        profit: Number(r.profit_etb || 0) || 0,
        voidQty: Number(r.void_qty || 0) || 0,
      }));

      return res.json({ ok: true, branchId, from, to, products });
    } catch (e) {
      return next(e);
    }
  });

  // Category performance (uses category_sales_summary)
  r.get(
    '/manager/reports/categories',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const from = toIsoDateOnly(req.query?.from);
      const to = toIsoDateOnly(req.query?.to);
      if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

      const limit = Math.max(1, Math.min(200, normalizeInt(req.query?.limit, 50)));

      const rows = await db()
        .from('category_sales_summary')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('report_date', '>=', from)
        .andWhere('report_date', '<=', to)
        .select([
          'category',
          db().raw('SUM(qty_sold) as qty_sold'),
          db().raw('SUM(revenue_etb) as revenue_etb'),
          db().raw('SUM(order_count) as order_count'),
        ])
        .groupBy(['category'])
        .orderBy(db().raw('SUM(revenue_etb)'), 'desc')
        .limit(limit);

      const categories = rows.map((r) => ({
        category: String(r.category || ''),
        qtySold: Number(r.qty_sold || 0) || 0,
        revenue: Number(r.revenue_etb || 0) || 0,
        orderCount: Number(r.order_count || 0) || 0,
      }));

      return res.json({ ok: true, branchId, from, to, categories });
    } catch (e) {
      return next(e);
    }
  });

  // Shift reports (uses shift_reports)
  r.get(
    '/manager/reports/shifts',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const fromIso = String(req.query?.from || '').trim();
      const toIso = String(req.query?.to || '').trim();
      const from = fromIso && !Number.isNaN(new Date(fromIso).getTime()) ? new Date(fromIso).toISOString() : '';
      const to = toIso && !Number.isNaN(new Date(toIso).getTime()) ? new Date(toIso).toISOString() : '';
      if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

      const limit = Math.max(1, Math.min(500, normalizeInt(req.query?.limit, 100)));

      const safeJsonParse = (raw, fallback) => {
        try {
          if (!raw) return fallback;
          const parsed = JSON.parse(String(raw));
          return parsed ?? fallback;
        } catch {
          return fallback;
        }
      };

      const rows = await db()
        .from('shift_reports')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('opened_at', '>=', from)
        .andWhere('opened_at', '<=', to)
        .orderBy('opened_at', 'desc')
        .limit(limit)
        .select([
          'id',
          'staff_id',
          'staff_name',
          'status',
          'opened_at',
          'closed_at',
          'opening_cash_etb',
          'closing_cash_etb',
          'expected_cash_etb',
          'cash_difference_etb',
          'order_count',
          'gross_sales_etb',
          'discounts_etb',
          'net_sales_etb',
          'tax_etb',
          'tips_etb',
          'payment_breakdown_json',
          'void_count',
          'void_amount_etb',
          'refund_count',
          'refund_amount_etb',
          'notes',
        ]);

      const shifts = rows.map((r) => ({
        id: String(r.id),
        staffId: r.staff_id ? String(r.staff_id) : '',
        staffName: String(r.staff_name || ''),
        status: String(r.status || ''),
        openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
        closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
        openingCash: Number(r.opening_cash_etb || 0) || 0,
        closingCash: r.closing_cash_etb == null ? null : Number(r.closing_cash_etb || 0) || 0,
        expectedCash: r.expected_cash_etb == null ? null : Number(r.expected_cash_etb || 0) || 0,
        cashDifference: r.cash_difference_etb == null ? null : Number(r.cash_difference_etb || 0) || 0,
        orderCount: Number(r.order_count || 0) || 0,
        grossSales: Number(r.gross_sales_etb || 0) || 0,
        discounts: Number(r.discounts_etb || 0) || 0,
        netSales: Number(r.net_sales_etb || 0) || 0,
        tax: Number(r.tax_etb || 0) || 0,
        tips: Number(r.tips_etb || 0) || 0,
        paymentBreakdown: safeJsonParse(r.payment_breakdown_json, {}),
        voidCount: Number(r.void_count || 0) || 0,
        voidAmount: Number(r.void_amount_etb || 0) || 0,
        refundCount: Number(r.refund_count || 0) || 0,
        refundAmount: Number(r.refund_amount_etb || 0) || 0,
        notes: String(r.notes || ''),
      }));

      return res.json({ ok: true, branchId, from, to, shifts });
    } catch (e) {
      return next(e);
    }
  });

  // Void/refund detailed log (uses void_refund_log)
  r.get(
    '/manager/reports/voids',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;
      const branchId = req.branchId || resolveBranchId(req);

      const fromIso = String(req.query?.from || '').trim();
      const toIso = String(req.query?.to || '').trim();
      const from = fromIso && !Number.isNaN(new Date(fromIso).getTime()) ? new Date(fromIso).toISOString() : '';
      const to = toIso && !Number.isNaN(new Date(toIso).getTime()) ? new Date(toIso).toISOString() : '';
      if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

      const limit = Math.max(1, Math.min(1000, normalizeInt(req.query?.limit, 200)));
      const type = typeof req.query?.type === 'string' ? req.query.type.trim().toLowerCase() : '';

      let q = db()
        .from('void_refund_log')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('occurred_at', '>=', from)
        .andWhere('occurred_at', '<=', to);
      if (type === 'void' || type === 'refund') q = q.andWhere('type', '=', type);

      const rows = await q
        .orderBy('occurred_at', 'desc')
        .limit(limit)
        .select([
          'id',
          'order_id',
          'type',
          'product_id',
          'product_name',
          'qty',
          'amount_etb',
          'reason',
          'authorized_by',
          'performed_by',
          'occurred_at',
        ]);

      const events = rows.map((r) => ({
        id: String(r.id),
        orderId: String(r.order_id || ''),
        type: String(r.type || ''),
        productId: r.product_id ? String(r.product_id) : '',
        productName: String(r.product_name || ''),
        qty: Number(r.qty || 0) || 0,
        amount: Number(r.amount_etb || 0) || 0,
        reason: String(r.reason || ''),
        authorizedBy: String(r.authorized_by || ''),
        performedBy: String(r.performed_by || ''),
        occurredAt: r.occurred_at ? new Date(r.occurred_at).toISOString() : null,
      }));

      return res.json({ ok: true, branchId, from, to, events });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerRouter };
