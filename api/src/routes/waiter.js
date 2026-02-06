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

  const buildWaiterDailyByProduct = async ({ tenantId, branchId, fromDateOnly, toDateOnly }) => {
    const from = parseIsoDateOnly(fromDateOnly);
    const to = parseIsoDateOnly(toDateOnly);
    if (!from || !to) return { ok: false, error: 'invalid_range' };

    const fromIso = `${from} 00:00:00`;
    const toIso = `${to} 23:59:59`;

    const rows = await db()
      .select(['id', 'total', 'paid_at', 'payload'])
      .from('orders')
      .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
      .andWhere('paid_at', '>=', fromIso)
      .andWhere('paid_at', '<=', toIso);

    const byKey = new Map();
    let ordersPaid = 0;
    let totalCollected = 0;

    for (const o of rows) {
      ordersPaid += 1;
      totalCollected += Number(o.total || 0) || 0;

      let payload = {};
      try {
        payload = o?.payload ? JSON.parse(String(o.payload)) : {};
      } catch {
        payload = {};
      }

      const items = Array.isArray(payload?.items) ? payload.items : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const productId = String(it.productId || it.product_id || it.id || '').trim();
        const name = String(it.name || it.productName || '').trim();
        const qty = Number(it.qty ?? 0) || 0;
        const unitPrice = Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0) || 0;
        if (!productId && !name) continue;
        if (qty <= 0) continue;

        const key = productId || name.toLowerCase();
        const prev = byKey.get(key) || { productId, productName: name, qty: 0, total: 0 };
        prev.productId = prev.productId || productId;
        prev.productName = prev.productName || name;
        prev.qty += qty;
        prev.total += qty * unitPrice;
        byKey.set(key, prev);
      }
    }

    const products = Array.from(byKey.values())
      .filter((p) => (p.productId || p.productName) && p.qty > 0)
      .sort((a, b) => b.total - a.total);

    return { ok: true, from, to, ordersPaid, totalCollected, products };
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
      const from = typeof req.query?.from === 'string' ? req.query.from.trim() : today;
      const to = typeof req.query?.to === 'string' ? req.query.to.trim() : today;

      const agg = await buildWaiterDailyByProduct({ tenantId: req.tenant.id, branchId, fromDateOnly: from, toDateOnly: to });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'MirachPOS';
      wb.created = new Date();

      const summary = wb.addWorksheet('Summary');
      summary.addRow([businessName]);
      summary.getRow(summary.rowCount).font = { bold: true, size: 14 };
      summary.addRow(['Waiter Daily Sales']);
      summary.getRow(summary.rowCount).font = { bold: true, size: 12 };
      summary.addRow([`${agg.from} → ${agg.to}`]);
      summary.addRow([]);
      summary.addRow(['Orders Paid', agg.ordersPaid]);
      summary.addRow(['Total Collected (ETB)', Number(agg.totalCollected || 0).toFixed(2)]);
      summary.getColumn(1).width = 26;
      summary.getColumn(2).width = 18;

      const products = wb.addWorksheet('Products');
      products.addRow(['Product ID', 'Product Name', 'Qty', 'Total (ETB)']);
      products.getRow(1).font = { bold: true };
      products.columns = [
        { key: 'productId', width: 18 },
        { key: 'productName', width: 34 },
        { key: 'qty', width: 10 },
        { key: 'total', width: 16, style: { numFmt: '#,##0.00' } },
      ];

      for (const p of agg.products) {
        products.addRow([String(p.productId || ''), String(p.productName || ''), Number(p.qty || 0), Number(p.total || 0)]);
      }

      const buf = await wb.xlsx.writeBuffer();
      const filename = `waiter_daily_sales_${branchId}_${agg.from}_to_${agg.to}.xlsx`;
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
      const from = typeof req.query?.from === 'string' ? req.query.from.trim() : today;
      const to = typeof req.query?.to === 'string' ? req.query.to.trim() : today;

      const agg = await buildWaiterDailyByProduct({ tenantId: req.tenant.id, branchId, fromDateOnly: from, toDateOnly: to });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);
      const { generateReportPDF } = require('../services/pdfService');

      const totals = [
        { label: 'Orders Paid', value: String(agg.ordersPaid || 0) },
        { label: 'Total Collected', value: `ETB ${(Number(agg.totalCollected || 0) || 0).toFixed(2)}` },
      ];

      const columns = [
        { header: 'Product ID', key: 'productId', width: 120 },
        { header: 'Product', key: 'productName', width: 200 },
        { header: 'Qty', key: 'qty', width: 60, align: 'right' },
        { header: 'Total (ETB)', key: 'total', width: 90, align: 'right', format: (n) => Number(n).toFixed(2) },
      ];

      const rows = agg.products.map((p) => ({
        productId: String(p.productId || ''),
        productName: String(p.productName || ''),
        qty: Number(p.qty || 0),
        total: Number(p.total || 0),
      }));

      const pdf = await generateReportPDF('Waiter Daily Sales', { from: agg.from, to: agg.to }, columns, rows, { businessName, totals });
      const filename = `waiter_daily_sales_${branchId}_${agg.from}_to_${agg.to}.pdf`;
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
