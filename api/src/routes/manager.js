const express = require('express');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { requirePermission, requireRole } = require('../middleware/permissions');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { resolveCdnUrl } = require('../utils/cdn');

const {
  aggregateDailySales,
  aggregateHourlySales,
  aggregateProductSales,
  aggregateCategorySales,
  aggregateStaffSales,
  ensureAggregatedForRange,
  getDailySalesSummary,
  getProductPerformance,
  getStaffSalesSummary,
} = require('../services/reportAggregationService');

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

const sumPaymentBreakdown = (dailyRows) => {
  const totals = new Map();
  const rows = Array.isArray(dailyRows) ? dailyRows : [];
  for (const r of rows) {
    const pb = r?.paymentBreakdown && typeof r.paymentBreakdown === 'object' ? r.paymentBreakdown : {};
    for (const [k, v] of Object.entries(pb)) {
      const key = String(k || '').trim();
      if (!key) continue;
      const amt = Number(v || 0) || 0;
      totals.set(key, (totals.get(key) || 0) + amt);
    }
  }
  return Array.from(totals.entries())
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
};

const getTenantBusinessName = async (tenantId) => {
  try {
    const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: tenantId }).first();
    const raw = row?.settings_json ? String(row.settings_json) : '';
    const parsed = raw ? JSON.parse(raw) : {};
    const business = parsed?.business && typeof parsed.business === 'object' ? parsed.business : {};
    const name = String(business.businessName || business.legalName || '').trim();
    return name || 'MirachPOS';
  } catch {
    return 'MirachPOS';
  }
};

const makeManagerRouter = () => {
  const r = express.Router();

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

  const safeJsonParse = (raw, fallback) => {
    try {
      if (!raw) return fallback;
      const parsed = JSON.parse(String(raw));
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  };

  r.get(
    '/manager/overview',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    async (req, res, next) => {
      try {
        try {
          res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
          res.set('Pragma', 'no-cache');
          res.set('Expires', '0');
          res.set('Vary', 'Origin, Authorization, X-Tenant');
        } catch {
          // ignore
        }

        let branchId = req.branchId || resolveBranchId(req);
        if (!branchId) {
          const row = await db()
            .select(['id'])
            .from('branches')
            .where({ tenant_id: req.tenant.id })
            .orderBy('name', 'asc')
            .first();
          branchId = row?.id ? String(row.id) : '';
        }
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const rangeRaw = typeof req.query?.range === 'string' ? req.query.range.trim() : 'Daily';
        const rangeKey = String(rangeRaw.split(':')[0] || '').trim();
        const range = ['Daily', 'Weekly', 'Monthly'].includes(rangeKey) ? rangeKey : 'Daily';

        // Log warning if range was malformed (like Daily:1)
        if (rangeRaw !== range && rangeRaw !== 'Daily') {
          try {
            if (req.log?.warn) req.log.warn({ rangeRaw, range }, 'manager/overview received malformed range parameter');
            else console.warn(`manager/overview received malformed range parameter: "${rangeRaw}"`);
          } catch { /* ignore */ }
        }

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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.write'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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

  // Integrations (read-only for Branch Manager UI)
  r.get(
    '/manager/integrations',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const rows = await db()
          .from({ ti: 'tenant_integrations' })
          .leftJoin({ ic: 'integrations_catalog' }, 'ic.id', 'ti.integration_id')
          .select([
            'ti.id',
            'ti.integration_id',
            'ti.status',
            'ti.installed_at',
            'ti.updated_at',
            'ic.code',
            'ic.name',
            'ic.category',
            'ic.integration_type',
            'ic.is_available',
          ])
          .where({ 'ti.tenant_id': req.tenant.id })
          .orderBy('ti.updated_at', 'desc')
          .limit(500);

        const installed = (rows || []).map((r0) => ({
          id: String(r0.id),
          integrationId: String(r0.integration_id || ''),
          code: r0.code != null ? String(r0.code) : '',
          name: r0.name != null ? String(r0.name) : '',
          category: r0.category != null ? String(r0.category) : '',
          integrationType: r0.integration_type != null ? String(r0.integration_type) : '',
          isAvailable: Boolean(r0.is_available),
          status: String(r0.status || 'installed'),
          installedAt: r0.installed_at ? new Date(r0.installed_at).toISOString() : '',
          updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
        }));

        return res.json({ ok: true, installed });
      } catch (e) {
        return next(e);
      }
    });

  // Add-ons (read-only for Branch Manager UI)
  r.get(
    '/manager/addons',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const rows = await db()
          .from({ tas: 'tenant_addon_subscriptions' })
          .leftJoin({ ap: 'addon_packages' }, 'ap.id', 'tas.addon_id')
          .select([
            'tas.id',
            'tas.addon_id',
            'tas.status',
            'tas.billing_frequency',
            'tas.price_paid_etb',
            'tas.activation_date',
            'tas.next_renewal_date',
            'tas.cancellation_date',
            'ap.code',
            'ap.name',
            'ap.category',
          ])
          .where({ 'tas.tenant_id': req.tenant.id })
          .orderBy('tas.updated_at', 'desc')
          .limit(500);

        const subscriptions = (rows || []).map((r0) => ({
          id: String(r0.id),
          addonId: String(r0.addon_id || ''),
          code: r0.code != null ? String(r0.code) : '',
          name: r0.name != null ? String(r0.name) : '',
          category: r0.category != null ? String(r0.category) : '',
          status: String(r0.status || ''),
          billingFrequency: String(r0.billing_frequency || 'monthly'),
          pricePaidEtb: Number(r0.price_paid_etb || 0) || 0,
          activationDate: r0.activation_date ? new Date(r0.activation_date).toISOString() : '',
          nextRenewalDate: r0.next_renewal_date ? new Date(r0.next_renewal_date).toISOString() : '',
          cancellationDate: r0.cancellation_date ? new Date(r0.cancellation_date).toISOString() : '',
        }));

        return res.json({ ok: true, subscriptions });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/manager/uploads/image',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    requirePermission('manager.settings.write'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const dataUrl = String(req.body?.dataUrl || '').trim();
        if (!dataUrl.startsWith('data:')) return res.status(400).json({ error: 'invalid_dataUrl' });

        const m = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
        if (!m) return res.status(400).json({ error: 'invalid_dataUrl' });
        const mime = String(m[1] || '').toLowerCase();
        const b64 = String(m[2] || '');

        const allowed = new Map([
          ['image/png', 'png'],
          ['image/jpeg', 'jpg'],
          ['image/jpg', 'jpg'],
          ['image/webp', 'webp'],
          ['image/gif', 'gif'],
        ]);
        const ext = allowed.get(mime);
        if (!ext) return res.status(400).json({ error: 'unsupported_image_type' });

        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) return res.status(400).json({ error: 'empty_file' });
        if (buf.length > 1024 * 1024 * 2) return res.status(400).json({ error: 'file_too_large' });

        const safeTenant = String(req.tenant.id || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '_');
        const baseDir = path.join(__dirname, '..', '..', 'uploads', safeTenant);
        fs.mkdirSync(baseDir, { recursive: true });

        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        const outName = `${hash}.${ext}`;
        const outPath = path.join(baseDir, outName);

        if (!fs.existsSync(outPath)) {
          try {
            fs.writeFileSync(outPath, buf, { flag: 'wx' });
          } catch (e) {
            if (!fs.existsSync(outPath)) throw e;
          }
        }

        const url = resolveCdnUrl(`/api/uploads/${safeTenant}/${outName}`);
        return res.status(201).json({ ok: true, url });
      } catch (e) {
        return next(e);
      }
    });

  r.get(
    '/manager/reports',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.export'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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

  // Export: XLSX (multi-sheet)
  r.get(
    '/manager/reports/export/xlsx',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.export'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);
        if (!from || !to) return res.status(400).json({ error: 'invalid_range' });
        if (new Date(`${to}T00:00:00.000Z`).getTime() < new Date(`${from}T00:00:00.000Z`).getTime()) {
          return res.status(400).json({ error: 'invalid_range' });
        }

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

        const businessName = await getTenantBusinessName(req.tenant.id);

        const [daily, products, staff, voids] = await Promise.all([
          getDailySalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to }),
          getProductPerformance({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 5000 }),
          getStaffSalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 5000 }),
          (async () => {
            const fromDt = `${from} 00:00:00`;
            const toDt = `${to} 23:59:59`;
            const fromIso = `${from}T00:00:00.000Z`;
            const toIso = `${to}T23:59:59.999Z`;

            const rows = await db()
              .select(['v.*', 's.name as authorized_by_name'])
              .from({ v: 'void_refund_log' })
              .leftJoin({ s: 'staff' }, 's.id', 'v.authorized_by')
              .where({ 'v.tenant_id': req.tenant.id, 'v.branch_id': branchId })
              .andWhere((qb) => {
                qb.whereBetween('v.occurred_at', [fromDt, toDt]).orWhereBetween('v.occurred_at', [fromIso, toIso]);
              })
              .orderBy('v.occurred_at', 'desc')
              .limit(2000);

            return rows.map((l) => ({
              id: l.id,
              type: l.type,
              orderId: l.order_id,
              productId: l.product_id,
              productName: l.product_name || '',
              qty: Number(l.qty || 0),
              amount: Number(l.amount_etb || 0),
              reason: l.reason || '',
              authorizedBy: l.authorized_by_name || '',
              occurredAt: l.occurred_at,
            }));
          })(),
        ]);

        const payments = sumPaymentBreakdown(daily);

        const { buildOwnerReportWorkbook } = require('../services/reportXlsxExportService');
        const buf = await buildOwnerReportWorkbook({
          businessName,
          fromDate: from,
          toDate: to,
          daily,
          products,
          staff,
          payments,
          voids,
        });

        const filename = `mirachpos_reports_${branchId}_${from}_to_${to}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
      } catch (e) {
        return next(e);
      }
    },
  );

  // Export: PDF (professional template)
  r.get(
    '/manager/reports/export/pdf',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.export'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const reportType = typeof req.query?.type === 'string' ? req.query.type.trim() : 'daily';
        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);
        if (!from || !to) return res.status(400).json({ error: 'invalid_range' });
        if (new Date(`${to}T00:00:00.000Z`).getTime() < new Date(`${from}T00:00:00.000Z`).getTime()) {
          return res.status(400).json({ error: 'invalid_range' });
        }

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

        const businessName = await getTenantBusinessName(req.tenant.id);
        const { generateReportPDF } = require('../services/pdfService');

        let pdfBuffer = null;
        let filename = `report_${branchId}_${from}_to_${to}.pdf`;

        if (reportType === 'daily') {
          const data = await getDailySalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
          const totals = (() => {
            const orders = data.reduce((s, r) => s + (Number(r.orderCount || 0) || 0), 0);
            const netSales = data.reduce((s, r) => s + (Number(r.netSales || 0) || 0), 0);
            const tax = data.reduce((s, r) => s + (Number(r.tax || 0) || 0), 0);
            const tips = data.reduce((s, r) => s + (Number(r.tips || 0) || 0), 0);
            const collected = data.reduce((s, r) => s + (Number(r.totalCollected || 0) || 0), 0);
            return [
              { label: 'Orders', value: String(orders) },
              { label: 'Net Sales', value: `ETB ${netSales.toFixed(2)}` },
              { label: 'Tax', value: `ETB ${tax.toFixed(2)}` },
              { label: 'Tips', value: `ETB ${tips.toFixed(2)}` },
              { label: 'Total Collected', value: `ETB ${collected.toFixed(2)}` },
            ];
          })();

          const columns = [
            { header: 'Date', key: 'date', width: 70 },
            { header: 'Orders', key: 'orderCount', width: 60, align: 'center' },
            { header: 'Gross', key: 'grossSales', width: 80, align: 'right', format: (n) => Number(n).toFixed(2) },
            { header: 'Net', key: 'netSales', width: 80, align: 'right', format: (n) => Number(n).toFixed(2) },
          ];

          pdfBuffer = await generateReportPDF('Daily Sales Summary', { from, to }, columns, data, { businessName, totals });
          filename = `daily_sales_${branchId}_${from}_to_${to}.pdf`;
        }

        if (reportType === 'products') {
          const data = await getProductPerformance({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 500 });
          const totals = (() => {
            const qty = data.reduce((s, r) => s + (Number(r.qtySold || 0) || 0), 0);
            const revenue = data.reduce((s, r) => s + (Number(r.revenue || 0) || 0), 0);
            const cost = data.reduce((s, r) => s + (Number(r.cost || 0) || 0), 0);
            const profit = data.reduce((s, r) => s + (Number(r.profit || 0) || 0), 0);
            return [
              { label: 'Units Sold', value: String(qty) },
              { label: 'Revenue', value: `ETB ${revenue.toFixed(2)}` },
              { label: 'Cost', value: `ETB ${cost.toFixed(2)}` },
              { label: 'Profit', value: `ETB ${profit.toFixed(2)}` },
            ];
          })();

          const columns = [
            { header: 'Product', key: 'name', width: 160 },
            { header: 'Category', key: 'category', width: 100 },
            { header: 'Qty', key: 'qtySold', width: 60, align: 'center' },
            { header: 'Revenue', key: 'revenue', width: 80, align: 'right', format: (n) => Number(n).toFixed(2) },
            { header: 'Profit', key: 'profit', width: 80, align: 'right', format: (n) => Number(n).toFixed(2) },
          ];

          pdfBuffer = await generateReportPDF('Product Performance', { from, to }, columns, data, { businessName, totals });
          filename = `product_performance_${branchId}_${from}_to_${to}.pdf`;
        }

        if (!pdfBuffer) return res.status(400).json({ error: 'invalid_type' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(pdfBuffer);
      } catch (e) {
        return next(e);
      }
    },
  );

  // Hourly sales summary (heatmap / peak hours)
  r.get(
    '/manager/reports/hourly',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);
        if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

        const limit = Math.max(1, Math.min(5000, normalizeInt(req.query?.limit, 50)));

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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

  // Staff performance (uses staff_sales_summary)
  r.get(
    '/manager/reports/staff',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);
        if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

        const staffId = typeof req.query?.staffId === 'string' ? req.query.staffId.trim() : '';

        const limit = Math.max(1, Math.min(500, normalizeInt(req.query?.limit, 100)));

        let q = db()
          .from('staff_sales_summary')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .andWhere('report_date', '>=', from)
          .andWhere('report_date', '<=', to)
          .select([
            'staff_id',
            'staff_name',
            db().raw('SUM(order_count) as order_count'),
            db().raw('SUM(net_sales_etb) as net_sales_etb'),
            db().raw('SUM(gross_sales_etb) as gross_sales_etb'),
            db().raw('SUM(discounts_etb) as discounts_etb'),
            db().raw('SUM(tax_etb) as tax_etb'),
            db().raw('SUM(tips_etb) as tips_etb'),
            db().raw('SUM(total_collected_etb) as total_collected_etb'),
          ]);

        if (staffId) q = q.andWhere({ staff_id: staffId });

        const rows = await q.groupBy(['staff_id', 'staff_name']).orderBy(db().raw('SUM(net_sales_etb)'), 'desc').limit(limit);

        const staff = rows.map((r) => ({
          staffId: r.staff_id ? String(r.staff_id) : '',
          staffName: String(r.staff_name || ''),
          orderCount: Number(r.order_count || 0) || 0,
          netSales: Number(r.net_sales_etb || 0) || 0,
          grossSales: Number(r.gross_sales_etb || 0) || 0,
          discounts: Number(r.discounts_etb || 0) || 0,
          tax: Number(r.tax_etb || 0) || 0,
          tips: Number(r.tips_etb || 0) || 0,
          totalCollected: Number(r.total_collected_etb || 0) || 0,
        }));

        return res.json({ ok: true, branchId, from, to, staff });
      } catch (e) {
        return next(e);
      }
    });

  // Trigger report aggregation for a date or date range (manager/owner only)
  r.post(
    '/manager/reports/aggregate',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const dateStr = toIsoDateOnly(req.query?.date);
        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);

        const parseDateOnly = (s) => {
          const m = /^\d{4}-\d{2}-\d{2}$/.exec(String(s || ''));
          if (!m) return null;
          const d = new Date(`${s}T00:00:00.000Z`);
          return Number.isNaN(d.getTime()) ? null : d;
        };
        const addDays = (d, days) => {
          const x = new Date(d);
          x.setUTCDate(x.getUTCDate() + days);
          return x;
        };

        const start = dateStr ? parseDateOnly(dateStr) : from ? parseDateOnly(from) : null;
        const end = dateStr ? start : to ? parseDateOnly(to) : null;
        if (!start) return res.status(400).json({ error: 'date_required' });
        if (!end) return res.status(400).json({ error: 'invalid_range' });
        if (end.getTime() < start.getTime()) return res.status(400).json({ error: 'invalid_range' });

        const nowIso = new Date().toISOString();
        let daysProcessed = 0;
        let errors = 0;

        for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
          try {
            await aggregateDailySales({ tenantId: req.tenant.id, branchId, date: d });
            await aggregateHourlySales({ tenantId: req.tenant.id, branchId, date: d });
            await aggregateProductSales({ tenantId: req.tenant.id, branchId, date: d });
            await aggregateCategorySales({ tenantId: req.tenant.id, branchId, date: d });
            await aggregateStaffSales({ tenantId: req.tenant.id, branchId, date: d });
            daysProcessed++;
          } catch {
            errors++;
          }
        }

        return res.json({ ok: true, branchId, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), daysProcessed, errors, requestedAt: nowIso });
      } catch (e) {
        return next(e);
      }
    });

  // Shift reports (uses shift_reports)
  r.get(
    '/manager/reports/shifts',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
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

  r.post(
    '/manager/settings/test-fiscal',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('manager.settings.read'),
    async (req, res, next) => {
      try {
        const { ip, port, provider } = req.body;

        if (!ip) return res.status(400).json({ error: 'IP Address is required' });

        // Simulator is always successful from backend perspective if reachable
        if (provider === 'Simulator') {
          return res.json({ ok: true, message: 'Simulator active' });
        }

        if (provider === 'EthioFiscal' || provider === 'Generic') {
          if (!port) return res.status(400).json({ error: 'Port is required for network devices' });

          const net = require('net');
          return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(3000);

            socket.on('connect', () => {
              socket.destroy();
              resolve(res.json({ ok: true, message: `Successfully connected to ${ip}:${port}` }));
            });

            socket.on('timeout', () => {
              socket.destroy();
              // Return 200 with success:false so the frontend handles it as a "check result" not a "server error"
              resolve(res.json({ ok: false, error: `Connection timed out to ${ip}:${port}` }));
            });

            socket.on('error', (err) => {
              socket.destroy();
              resolve(res.json({ ok: false, error: `Connection failed: ${err.message}` }));
            });

            // Attempt connection
            socket.connect(Number(port), ip);
          });
        }

        return res.json({ ok: true, message: 'Check skipped (unknown provider)' });
      } catch (e) {
        return next(e);
      }
    });

  return r;
};

module.exports = { makeManagerRouter };
