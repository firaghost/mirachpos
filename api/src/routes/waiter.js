const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { validateWaiterAccount, validateWaiterHistoryQuery } = require('../middleware/validators');
const { sanitizeLikeInput, sanitizeText } = require('../utils/sanitize');

const makeWaiterRouter = () => {
  const r = express.Router();

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

  const parseIsoDateOnly = (s) => {
    const v = String(s || '').trim();
    if (!v) return '';
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
    if (!m) return '';
    const d = new Date(`${v}T00:00:00.000Z`);
    if (!Number.isFinite(d.getTime())) return '';
    return v;
  };

  const buildWaiterTodaySalesReport = async ({ tenantId, branchId, date }) => {
    const day = parseIsoDateOnly(date);
    if (!day) return { ok: false, error: 'invalid_range' };

    const fromDt = `${day} 00:00:00`;
    const toDt = `${day} 23:59:59`;
    const fromIso = `${day}T00:00:00.000Z`;
    const toIso = `${day}T23:59:59.999Z`;

    const orderAgg = await db()
      .from({ o: 'orders' })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw('COUNT(*) as order_count'),
        db().raw('COALESCE(SUM(COALESCE(o.discount, 0)), 0) as discounts_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.tax, 0)), 0) as tax_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as tips_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.total, 0)), 0) as total_collected_etb'),
        db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as net_sales_etb'),
      ])
      .first();

    const products = await db()
      .from({ oi: 'order_items' })
      .innerJoin({ o: 'orders' }, function () {
        this.on('o.id', '=', 'oi.order_id')
          .andOn('o.tenant_id', '=', 'oi.tenant_id')
          .andOn('o.branch_id', '=', 'oi.branch_id');
      })
      .leftJoin({ p: 'menu_products' }, function () {
        this.on('p.id', '=', 'oi.product_id')
          .andOn('p.tenant_id', '=', 'oi.tenant_id')
          .andOn('p.branch_id', '=', 'oi.branch_id');
      })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw("COALESCE(NULLIF(TRIM(oi.product_id), ''), NULLIF(TRIM(oi.product_code), ''), TRIM(oi.name)) as product_id"),
        db().raw("COALESCE(NULLIF(TRIM(p.name), ''), TRIM(oi.name)) as product_name"),
        db().raw("COALESCE(NULLIF(TRIM(p.category), ''), '') as category"),
        db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))) as qty_sold'),
        db().raw('SUM(GREATEST(0, COALESCE(oi.voided_qty, 0))) as void_qty'),
        db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue_etb'),
      ])
      .groupBy(['product_id', 'product_name', 'category'])
      .orderBy(db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0))'), 'desc')
      .limit(5000);

    const rows = products.map((r) => ({
      productId: String(r.product_id || '').trim(),
      name: String(r.product_name || r.product_id || '').trim(),
      category: String(r.category || 'Uncategorized').trim() || 'Uncategorized',
      qtySold: Number(r.qty_sold || 0) || 0,
      revenue: Number(r.revenue_etb || 0) || 0,
      voidQty: Number(r.void_qty || 0) || 0,
    }));

    const orderCount = Number(orderAgg?.order_count || 0) || 0;
    const discounts = Number(orderAgg?.discounts_etb || 0) || 0;
    const tax = Number(orderAgg?.tax_etb || 0) || 0;
    const tips = Number(orderAgg?.tips_etb || 0) || 0;
    const totalCollected = Number(orderAgg?.total_collected_etb || 0) || 0;
    const netSales = Number(orderAgg?.net_sales_etb || 0) || 0;
    const grossSales = netSales + discounts;

    return {
      ok: true,
      date: day,
      orderCount,
      grossSales,
      discounts,
      netSales,
      tax,
      tips,
      totalCollected,
      products: rows,
    };
  };

  const resolveBranchId = (req) => {
    const role = String(req.auth?.role || '').trim();
    const fromToken = String(req.auth?.branchId || '').trim();
    const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

    if (role === 'Waiter Manager') {
      if (fromToken && fromToken !== 'global') return fromToken;
      if (q && q !== 'global') return q;
      return '';
    }

    return fromToken;
  };

  const requireWaiter = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const branchId = resolveBranchId(req);
    if (!branchId || branchId === 'global') {
      res.status(400).json({ error: 'branch_required' });
      return false;
    }
    return true;
  };

  r.put(
    '/waiter/account',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    validateWaiterAccount,
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const staffId = String(req.auth?.staffId || '');
      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const { currentPassword, newPassword, currentPin, newPin } = req.validatedBody || req.body;

      if (!newPassword && !newPin) return res.status(400).json({ error: 'no_changes' });
      if (newPassword && newPassword.length < 4) return res.status(400).json({ error: 'password_too_short' });
      if (newPin && newPin.length < 3) return res.status(400).json({ error: 'pin_too_short' });

      const staff = await db()
        .select(['id', 'tenant_id', 'branch_id', 'role_name', 'password_hash', 'pin_hash'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: staffId, branch_id: branchId })
        .first();

      if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      if (role === 'Waiter' && String(staff.role_name || '') !== 'Waiter') return res.status(403).json({ error: 'forbidden' });

      if (newPassword) {
        const match = await bcrypt.compare(String(currentPassword || ''), String(staff.password_hash || ''));
        if (!match) return res.status(401).json({ error: 'invalid_credentials' });
      }

      if (newPin) {
        const pinHash = String(staff.pin_hash || '');
        if (pinHash) {
          const match = await bcrypt.compare(String(currentPin || ''), pinHash);
          if (!match) return res.status(401).json({ error: 'invalid_credentials' });
        }
      }

      const patch = {};
      if (newPassword) patch.password_hash = await bcrypt.hash(String(newPassword), 10);
      if (newPin) patch.pin_hash = await bcrypt.hash(String(newPin), 10);
      if (Object.keys(patch).length === 0) return res.json({ ok: true });

      await db().from('staff').where({ tenant_id: req.tenant.id, id: staffId }).update({ ...patch, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    validateWaiterHistoryQuery,
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const { q: qRaw, status: statusRaw, from: fromRaw, to: toRaw, page: pageRaw, pageSize: pageSizeRaw } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const page = Math.max(1, Number(pageRaw || 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(pageSizeRaw || 25) || 25));

      const parseIsoDateTime = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const d = new Date(v);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString();
      };

      const parseIsoDate = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
        if (!m) return null;
        const d = new Date(`${v}T00:00:00.000Z`);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };

      const fromDateOnly = parseIsoDate(fromRaw);
      const toDateOnly = parseIsoDate(toRaw);
      const fromIso = fromDateOnly ? `${fromDateOnly}T00:00:00.000Z` : parseIsoDateTime(fromRaw);
      const toIso = toDateOnly ? `${toDateOnly}T23:59:59.999Z` : parseIsoDateTime(toRaw);

      const base = db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) {
        if (status === 'Open') {
          base.whereNotIn('status', ['Paid', 'Voided']);
        } else {
          base.andWhere({ status });
        }
      }

      if (fromIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '>=', fromIso).orWhere('paid_at', '>=', fromIso);
        });
      }
      if (toIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '<=', toIso).orWhere('paid_at', '<=', toIso);
        });
      }

      if (role !== 'Waiter Manager') {
        base.andWhere({ created_by_staff_id: staffId });
      }

      if (q) {
        const qLike = `%${q}%`;
        base.andWhere((qb) => {
          qb.whereRaw('LOWER(COALESCE(display_number, \'\')) LIKE ?', [qLike])
            .orWhereRaw('LOWER(COALESCE(table_name, \'\')) LIKE ?', [qLike]);
        });
      }

      const countRow = await base.clone().clearSelect().clearOrder().count({ total: '*' }).first();
      const total = Number(countRow?.total || 0);

      const rows0 = await base
        .select([
          'id',
          'status',
          'total',
          'tax',
          'tip',
          'discount',
          'created_at',
          'paid_at',
          'payload',
          'display_number',
          'table_name',
          'created_by_staff_id',
          'created_by_name',
        ])
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const items = rows0.map((o) => {
        const payload = o.payload
          ? (() => {
              try {
                return JSON.parse(String(o.payload));
              } catch {
                return {};
              }
            })()
          : {};
        return {
          id: String(o.id),
          number: String(o.display_number || payload?.number || ''),
          tableName: String(o.table_name || payload?.tableName || ''),
          timeLabel: String(payload?.timeLabel || ''),
          createdByName: String(o.created_by_name || payload?.createdByName || ''),
          createdByStaffId: String(o.created_by_staff_id || payload?.createdByStaffId || ''),
          items: Array.isArray(payload?.items) ? payload.items : [],
          status: String(o.status || ''),
          total: Number(o.total || 0),
          createdAt: o.created_at ? new Date(o.created_at).toISOString() : '',
          paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : '',
        };
      });

      return res.json({ ok: true, orders: items, page, pageSize, total, branchId });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history/export/xlsx',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const today = new Date().toISOString().slice(0, 10);

      const agg = await buildWaiterTodaySalesReport({ tenantId: req.tenant.id, branchId, date: today });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'MirachPOS';
      wb.created = new Date();

      // Summary sheet: Centered header and full totals block
      const summary = wb.addWorksheet('Summary');
      const summaryMaxCol = 2;
      
            // Header rows
      summary.addRow([businessName]);
      summary.getRow(1).font = { bold: true, size: 16 };
      summary.getRow(1).alignment = { horizontal: 'center' };
      summary.mergeCells(1, 1, 1, summaryMaxCol);

      summary.addRow(['Waiter Daily Sales']);
      summary.getRow(2).font = { bold: true, size: 14 };
      summary.getRow(2).alignment = { horizontal: 'center' };
      summary.mergeCells(2, 1, 2, summaryMaxCol);

      summary.addRow([`Period: ${agg.date} to ${agg.date}`]);
      summary.getRow(3).font = { size: 11 };
      summary.getRow(3).alignment = { horizontal: 'center' };
      summary.mergeCells(3, 1, 3, summaryMaxCol);

      summary.addRow([]);

      // Data rows
      summary.addRow(['Orders Paid', agg.orderCount]);
      summary.addRow(['Gross Sales (ETB)', Number(agg.grossSales || 0).toFixed(2)]);
      summary.addRow(['Discounts (ETB)', Number(agg.discounts || 0).toFixed(2)]);
      summary.addRow(['Net Sales (ETB)', Number(agg.netSales || 0).toFixed(2)]);
      summary.addRow(['Tax (ETB)', Number(agg.tax || 0).toFixed(2)]);
      summary.addRow(['Tips (ETB)', Number(agg.tips || 0).toFixed(2)]);
      summary.addRow(['Total Collected (ETB)', Number(agg.totalCollected || 0).toFixed(2)]);
      
      summary.getColumn(1).width = 26;
      summary.getColumn(2).width = 18;
      summary.getColumn(2).alignment = { horizontal: 'right' };

      // Products sheet: Centered header and all columns from image example
      const products = wb.addWorksheet('Products');
      const prodMaxCol = 9;

      // Header rows
      products.addRow([businessName]);
      products.getRow(1).font = { bold: true, size: 16 };
      products.getRow(1).alignment = { horizontal: 'center' };
      products.mergeCells(1, 1, 1, prodMaxCol);

      products.addRow(['Product Performance']);
      products.getRow(2).font = { bold: true, size: 14 };
      products.getRow(2).alignment = { horizontal: 'center' };
      products.mergeCells(2, 1, 2, prodMaxCol);

      products.addRow([`Period: ${agg.date} to ${agg.date}`]);
      products.getRow(3).font = { size: 11 };
      products.getRow(3).alignment = { horizontal: 'center' };
      products.mergeCells(3, 1, 3, prodMaxCol);

      products.addRow([]);

      // Table Header row
      const headerCols = ['Product ID', 'Name', 'Category', 'Qty Sold', 'Unit Price', 'Revenue (ETB)', 'Cost (ETB)', 'Profit (ETB)', 'Void Qty'];
      products.addRow(headerCols);
      const headerRow = products.getRow(5);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

      products.columns = [
        { key: 'productId', width: 18 },
        { key: 'name', width: 32 },
        { key: 'category', width: 18 },
        { key: 'qtySold', width: 10 },
        { key: 'unitPrice', width: 14, style: { numFmt: '#,##0.00' } },
        { key: 'revenue', width: 16, style: { numFmt: '#,##0.00' } },
        { key: 'cost', width: 14, style: { numFmt: '#,##0.00' } },
        { key: 'profit', width: 14, style: { numFmt: '#,##0.00' } },
        { key: 'voidQty', width: 10 },
      ];

      for (const p of agg.products) {
        const qtySold = Number(p.qtySold || 0);
        const revenue = Number(p.revenue || 0);
        const unitPrice = qtySold > 0 ? revenue / qtySold : 0;
        products.addRow([
          String(p.productId || ''),
          String(p.name || ''),
          String(p.category || ''),
          qtySold,
          unitPrice,
          revenue,
          0, // cost not available for waiter
          revenue, // profit = revenue (cost not available)
          Number(p.voidQty || 0),
        ]);
      }

      products.views = [{ state: 'frozen', ySplit: 5 }];

      const buf = await wb.xlsx.writeBuffer();
      const filename = `waiter_daily_sales_${branchId}_${agg.date}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buf));
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history/export/pdf',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const today = new Date().toISOString().slice(0, 10);

      const agg = await buildWaiterTodaySalesReport({ tenantId: req.tenant.id, branchId, date: today });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);
      const { generateReportPDF } = require('../services/pdfService');

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
      const settingsRaw = settingsRow?.settings_json ? String(settingsRow.settings_json) : '';
      let logoDataUrl = '';
      try {
        const parsed = settingsRaw ? JSON.parse(settingsRaw) : {};
        logoDataUrl = typeof parsed?.receipt?.logoDataUrl === 'string' ? String(parsed.receipt.logoDataUrl) : '';
      } catch {
        logoDataUrl = '';
      }

      const totals = [
        { label: 'Orders', value: String(agg.orderCount || 0) },
        { label: 'Net Sales', value: `ETB ${(Number(agg.netSales || 0) || 0).toFixed(2)}` },
        { label: 'Tax', value: `ETB ${(Number(agg.tax || 0) || 0).toFixed(2)}` },
        { label: 'Collected', value: `ETB ${(Number(agg.totalCollected || 0) || 0).toFixed(2)}` },
      ];

      const columns = [
        { header: 'Product', key: 'name', width: 220 },
        { header: 'Category', key: 'category', width: 120 },
        { header: 'Qty Sold', key: 'qtySold', width: 70, align: 'right' },
        { header: 'Revenue (ETB)', key: 'revenue', width: 90, align: 'right', format: (n) => Number(n).toFixed(2) },
      ];

      const rows = agg.products.map((p) => ({
        name: String(p.name || ''),
        category: String(p.category || ''),
        qtySold: Number(p.qtySold || 0),
        revenue: Number(p.revenue || 0),
      }));

      const pdf = await generateReportPDF('Waiter Daily Sales', { from: agg.date, to: agg.date }, columns, rows, { businessName, totals, logoDataUrl });
      const filename = `waiter_daily_sales_${branchId}_${agg.date}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdf);
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/order/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const orderId = String(req.params?.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'order_id_required' });

      const row = await db()
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'payload'])
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .first();

      if (!row) return res.status(404).json({ error: 'not_found' });

      const payload = row.payload
        ? (() => {
            try {
              return JSON.parse(String(row.payload));
            } catch {
              return {};
            }
          })()
        : {};

      const order = {
        id: String(row.id),
        number: String(payload?.number || ''),
        tableName: String(payload?.tableName || ''),
        timeLabel: String(payload?.timeLabel || ''),
        createdByName: String(payload?.createdByName || ''),
        createdByStaffId: String(payload?.createdByStaffId || ''),
        items: Array.isArray(payload?.items) ? payload.items : [],
        status: String(row.status || ''),
        total: Number(row.total || 0),
        tax: Number(row.tax || 0),
        tip: Number(row.tip || 0),
        discount: Number(row.discount || 0),
        discountPct: payload?.discountPct == null ? 0 : Number(payload.discountPct || 0) || 0,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        payload,
      };

      if (role !== 'Waiter Manager' && String(order.createdByStaffId || '').trim() !== staffId) return res.status(403).json({ error: 'forbidden' });

      return res.json({ ok: true, branchId, order });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/shift-report',
    tenantMiddleware,
    requireAuth,
    requireRole('Waiter', 'Waiter Manager'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      if (role === 'Waiter Manager') {
        const staff = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
        if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      }

      const logs = await db()
        .select(['id', 'staff_id', 'clock_in_at', 'clock_out_at'])
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, staff_id: staffId })
        .orderBy('clock_in_at', 'desc')
        .limit(500);

      const staff = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
      const staffName = staff ? String(staff.name || '') : '';

      const shiftLogs = logs.map((l) => ({
        id: String(l.id),
        staffId: String(l.staff_id),
        staffName,
        clockInAt: new Date(l.clock_in_at).toISOString(),
        clockOutAt: l.clock_out_at ? new Date(l.clock_out_at).toISOString() : undefined,
      }));

      return res.json({ ok: true, branchId, staffId, shiftLogs });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeWaiterRouter };
