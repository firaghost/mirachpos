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
  getOrderStatusSummary,
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

const sanitizeFilenamePart = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 60);
};

const makeManagerRouter = () => {
  const r = express.Router();

  r.get('/manager/dashboard', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true });
  });

  r.get('/manager/orders', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true, orders: [] });
  });

  r.get('/manager/inventory', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true, items: [] });
  });

  r.post('/manager/inventory/adjust', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true });
  });

  r.get('/manager/tables', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true, tables: [] });
  });

  r.post('/manager/tables', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.status(201).json({ ok: true });
  });

  r.get('/manager/menu', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.json({ ok: true, items: [] });
  });

  r.post('/manager/menu/items', tenantMiddleware, requireAuth, requireRole('Branch Manager', 'Cafe Owner'), async (_req, res) => {
    return res.status(201).json({ ok: true });
  });

  const toIsoDateOnly = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return '';
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return '';
    }
  };

  const normalizeInt = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const getDailySalesSummary = async ({ tenantId, branchId, fromDate, toDate }) => {
    const from = toIsoDateOnly(fromDate);
    const to = toIsoDateOnly(toDate);
    
    const rows = await db()
      .from('daily_sales_summary')
      .where({ tenant_id: tenantId, branch_id: branchId })
      .andWhere('report_date', '>=', from)
      .andWhere('report_date', '<=', to)
      .orderBy('report_date', 'asc')
      .select([
        'report_date as date',
        'order_count as orderCount',
        'item_count as itemCount',
        'gross_sales_etb as grossSales',
        'discounts_etb as discounts',
        'net_sales_etb as netSales',
        'tax_etb as tax',
        'tips_etb as tips',
        'total_collected_etb as totalCollected',
        'avg_ticket_etb as avgTicket',
        'payment_breakdown_json',
      ]);

    return rows.map(r => ({
      ...r,
      paymentBreakdown: safeJsonParse(r.payment_breakdown_json, {}),
    }));
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

  // Manager Overview: Professional data flow
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
        let branchId = req.branchId || resolveBranchId(req);
        if (!branchId) {
          const row = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc').first();
          branchId = row?.id ? String(row.id) : '';
        }
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const from = toIsoDateOnly(req.query?.from);
        const to = toIsoDateOnly(req.query?.to);

        if (!from || !to) {
          // Default to last 14 days if no range provided
          const now = new Date();
          const toDate = toIsoDateOnly(now);
          const fromDate = toIsoDateOnly(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000));
          return res.redirect(`${req.baseUrl}/manager/overview?from=${fromDate}&to=${toDate}`);
        }

        const daily = await getDailySalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        
        // KPIs based on selected range
        const salesTotal = daily.reduce((s, r) => s + (Number(r.grossSales) || 0), 0);
        const ordersTotal = daily.reduce((s, r) => s + (Number(r.orderCount) || 0), 0);
        const avgTicket = ordersTotal > 0 ? salesTotal / ordersTotal : 0;

        // Open orders count (current state)
        const openOrdersRow = await db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId }).andWhereNot({ status: 'Paid' }).count({ cnt: '*' }).first();
        const openOrders = Number(openOrdersRow?.cnt ?? 0) || 0;

        return res.json({
          ok: true,
          branchId,
          from,
          to,
          kpis: { salesTotal, ordersTotal, avgTicket, openOrders },
          trend: daily.map(d => ({ key: d.date, revenue: d.grossSales, orders: d.orderCount })),
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  r.get(
    '/manager/reports/status-summary',
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

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

        const summary = await getOrderStatusSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!summary?.ok) return res.status(400).json({ error: summary?.error || 'invalid_range' });

        return res.json({ ok: true, branchId, from, to, summary });
      } catch (e) {
        return next(e);
      }
    }
  );

  r.get(
    '/manager/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.read'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);

        const row = await db().select(['settings_json']).from('manager_settings').where({ tenant_id: req.tenant.id, branch_id: branchId }).first();

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
    requireRole('Branch Manager', 'Cafe Owner', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    requireBranchId(),
    async (req, res, next) => {
      try {
        const branchId = req.branchId || resolveBranchId(req);
        const settings = req.body?.settings || {};

        await db()
          .from('manager_settings')
          .insert({
            tenant_id: req.tenant.id,
            branch_id: branchId,
            settings_json: JSON.stringify(settings),
          })
          .onConflict(['tenant_id', 'branch_id'])
          .merge({
            settings_json: JSON.stringify(settings),
          });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    });

  r.post(
    '/manager/uploads/image',
    tenantMiddleware,
    requireAuth,
    requireRole('Branch Manager', 'Cafe Owner'),
    loadEntitlements,
    requirePermission('settings.write'),
    async (req, res, next) => {
      try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: 'missing_image' });

        const parts = image.split(';base64,');
        if (parts.length !== 2) return res.status(400).json({ error: 'invalid_image_format' });

        const meta = parts[0];
        const b64 = parts[1];

        const ext = meta.includes('image/png')
          ? 'png'
          : meta.includes('image/jpeg')
            ? 'jpg'
            : meta.includes('image/webp')
              ? 'webp'
              : '';

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

        const businessHeader = {
          businessName: '',
          legalName: '',
          tin: '',
          phone: '',
          email: '',
          address: '',
          receipt: { showTin: true, logoDataUrl: '' },
        };

        try {
          const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
          let settings = {};
          try {
            settings = row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
          } catch (e) {}
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
        } catch (e) {}

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

        const shiftRowsResult = await shiftQ.select(['id', 'staff_id', 'clock_in_at', 'clock_out_at']);

        const shiftLogs = shiftRowsResult.map((l) => ({
          id: String(l.id),
          staffId: String(l.staff_id),
          clockInAt: l.clock_in_at ? new Date(l.clock_in_at).toISOString() : '',
          clockOutAt: l.clock_out_at ? new Date(l.clock_out_at).toISOString() : null,
        }));

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

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

        const daily = await getDailySalesSummary({
          tenantId: req.tenant.id,
          branchId,
          fromDate: from,
          toDate: to,
        });

        return res.json({ ok: true, branchId, from, to, daily });
      } catch (e) {
        return next(e);
      }
    }
  );

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

        const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
        if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

        const [
          daily,
          products,
          staff,
          voids,
        ] = await Promise.all([
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
        const bizName = await getTenantBusinessName(req.tenant.id);
        const buf = await buildOwnerReportWorkbook({
          businessName: bizName,
          fromDate: from,
          toDate: to,
          daily,
          products,
          staff,
          payments,
          voids,
        });

        const branchRow = await db().select(['name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
        const branchName = sanitizeFilenamePart(branchRow?.name || '') || sanitizeFilenamePart(branchId) || 'branch';
        const filename = `mirachpos_reports_${branchName}_${from}_to_${to}.xlsx`;
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

        const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
        const settingsRaw = settingsRow?.settings_json ? String(settingsRow.settings_json) : '';
        const settingsParsed = settingsRaw ? safeJsonParse(settingsRaw, {}) : {};
        const receipt = settingsParsed?.receipt && typeof settingsParsed.receipt === 'object' ? settingsParsed.receipt : {};
        const logoDataUrl = typeof receipt.logoDataUrl === 'string' ? String(receipt.logoDataUrl) : '';

        const { generateReportPDF } = require('../services/pdfService');

        let pdfBuffer = null;
        let filename = `report_${branchId}_${from}_to_${to}.pdf`;

        const branchRow = await db().select(['name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
        const branchName = sanitizeFilenamePart(branchRow?.name || '') || sanitizeFilenamePart(branchId) || 'branch';

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

          pdfBuffer = await generateReportPDF('Daily Sales Summary', { from, to }, columns, data, { businessName, totals, logoDataUrl });
          filename = `daily_sales_${branchName}_${from}_to_${to}.pdf`;
        }

        if (reportType === 'products') {
          const data = await getProductPerformance({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 5000 });
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

          pdfBuffer = await generateReportPDF('Product Performance', { from, to }, columns, data, { businessName, totals, logoDataUrl });
          filename = `product_performance_${branchName}_${from}_to_${to}.pdf`;
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

        // Query the live `shifts` table (shift_reports is a legacy/unused table)
        const rows = await db()
          .from({ s: 'shifts' })
          .leftJoin({ st: 'staff' }, 'st.id', 's.opened_by')
          .where({ 's.tenant_id': req.tenant.id, 's.branch_id': branchId })
          .andWhere('s.opened_at', '>=', from)
          .andWhere('s.opened_at', '<=', to)
          .orderBy('s.opened_at', 'desc')
          .limit(limit)
          .select([
            's.id',
            's.shift_type',
            's.business_date',
            's.status',
            's.opened_at',
            's.closed_at',
            's.opened_by',
            's.closed_by',
            's.opening_cash_etb',
            's.closing_cash_etb',
            's.expected_cash_etb',
            's.cash_difference_etb',
            's.order_count',
            's.gross_sales_etb',
            's.discounts_etb',
            's.net_sales_etb',
            's.tax_etb',
            's.tips_etb',
            's.payment_breakdown_json',
            's.notes',
            db().raw("COALESCE(st.name, '') as opener_name"),
          ]);

        const shifts = rows.map((r) => ({
          id: String(r.id),
          shiftType: String(r.shift_type || ''),
          businessDate: String(r.business_date || ''),
          staffId: r.opened_by ? String(r.opened_by) : '',
          staffName: String(r.opener_name || ''),
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
          // totalCollected is an alias for netSales used by the frontend ShiftAggRow type
          totalCollected: Number(r.net_sales_etb || 0) || 0,
          tax: Number(r.tax_etb || 0) || 0,
          tips: Number(r.tips_etb || 0) || 0,
          paymentBreakdown: safeJsonParse(r.payment_breakdown_json, {}),
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
