/**
 * Enhanced Reports Routes
 * 
 * Provides pre-aggregated and real-time reports for owners:
 * - Hourly sales heatmap
 * - Product performance
 * - Shift reports
 * - Void/refund analysis
 * - PDF export
 */

const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { config } = require('../config');
const { withCache } = require('../utils/cache');

const {
    getDailySalesSummary,
    getHourlySalesHeatmap,
    getProductPerformance,
    getStaffSalesSummary,
    aggregateDailySales,
    aggregateHourlySales,
    aggregateProductSales,
    ensureAggregatedForRange,
    getOrderStatusSummary,
} = require('../services/reportAggregationService');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const requireOwnerAuth = (req, res) => {
    if (req.auth?.tenantId !== req.tenant?.id) {
        res.status(403).json({ error: 'forbidden' });
        return false;
    }
    return true;
};

const toDateString = (d) => {
    const s = String(d || '').trim();
    if (!s) return '';

    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    try {
        const x = new Date(d);
        if (Number.isNaN(x.getTime())) return '';
        const year = x.getUTCFullYear();
        const month = String(x.getUTCMonth() + 1).padStart(2, '0');
        const day = String(x.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch {
        return '';
    }
};

const getOwnerBusinessName = async (tenantId) => {
    try {
        const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: tenantId }).first();
        const raw = row?.settings_json ? String(row.settings_json) : '';
        const parsed = safeJsonParse(raw, {});
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

const makeEnhancedReportsRouter = () => {
    const r = express.Router();

    // Get hourly sales heatmap
    r.get('/owner/reports/hourly', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? toDateString(fromIso)
                : toDateString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? toDateString(toIso)
                : toDateString(now);

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
            if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

            const cacheKey = `reports:owner:hourly:${req.tenant.id}:${branchId || 'all'}:${from}:${to}`;
            const heatmap = await withCache(cacheKey, config.cacheReportTtlSeconds, () =>
                getHourlySalesHeatmap({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to })
            );

            // Find peak hours
            const sortedByOrders = [...heatmap].sort((a, b) => b.orderCount - a.orderCount);
            const peakHours = sortedByOrders.slice(0, 3).filter(h => h.orderCount > 0);

            // Calculate total
            const totalOrders = heatmap.reduce((sum, h) => sum + h.orderCount, 0);
            const totalSales = heatmap.reduce((sum, h) => sum + h.sales, 0);

            return res.json({
                ok: true,
                heatmap,
                summary: {
                    totalOrders,
                    totalSales,
                    peakHours: peakHours.map(h => h.label),
                },
                dateRange: { from, to },
            });
        } catch (e) {
            return next(e);
        }
    });

    r.get('/owner/reports/status-summary', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const from = toDateString(req.query?.from);
            const to = toDateString(req.query?.to);

            if (!from || !to) return res.status(400).json({ error: 'invalid_range' });

            const summary = await getOrderStatusSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
            if (!summary?.ok) return res.status(400).json({ error: summary?.error || 'invalid_range' });

            return res.json({ ok: true, branchId, from, to, summary });
        } catch (e) {
            return next(e);
        }
    });

    // Get product performance
    r.get('/owner/reports/products', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';
            const limit = Math.min(5000, Math.max(1, parseInt(req.query?.limit, 10) || 20));

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? toDateString(fromIso)
                : toDateString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? toDateString(toIso)
                : toDateString(now);

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
            if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

            const products = await getProductPerformance({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit });

            // Group by category
            const byCategory = {};
            for (const p of products) {
                const cat = p.category || 'Uncategorized';
                if (!byCategory[cat]) byCategory[cat] = { name: cat, revenue: 0, qty: 0, products: [] };
                byCategory[cat].revenue += p.revenue;
                byCategory[cat].qty += p.qtySold;
                byCategory[cat].products.push(p);
            }

            const categories = Object.values(byCategory).sort((a, b) => b.revenue - a.revenue);

            return res.json({
                ok: true,
                products,
                categories,
                dateRange: { from, to },
            });
        } catch (e) {
            return next(e);
        }
    });

    // Get shift reports list
    r.get('/owner/reports/shifts', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';
            const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
            const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? new Date(fromIso).toISOString()
                : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? new Date(toIso).toISOString()
                : now.toISOString();

            let query = db()
                .select([
                    's.id',
                    's.branch_id',
                    's.staff_id',
                    's.staff_name',
                    's.status',
                    's.opened_at',
                    's.closed_at',
                    's.opening_cash_etb',
                    's.closing_cash_etb',
                    's.expected_cash_etb',
                    's.cash_difference_etb',
                    's.order_count',
                    's.net_sales_etb',
                    's.payment_breakdown_json',
                    'b.name as branch_name',
                ])
                .from({ s: 'shift_reports' })
                .leftJoin({ b: 'branches' }, function () {
                    this.on('b.id', '=', 's.branch_id').andOn('b.tenant_id', '=', 's.tenant_id');
                })
                .where({ 's.tenant_id': req.tenant.id })
                .andWhere('s.opened_at', '>=', from)
                .andWhere('s.opened_at', '<=', to);

            if (branchId) {
                query = query.andWhere('s.branch_id', branchId);
            }

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const cacheKey = `reports:owner:shifts:${req.tenant.id}:${branchId || 'all'}:${from}:${to}:${limit}:${offset}`;
            const { shifts, total } = await withCache(cacheKey, config.cacheReportTtlSeconds, async () => {
                const totalRow = await query.clone().count({ c: 's.id' }).first();
                const total = Number(totalRow?.c || 0);

                const shifts = await query
                    .orderBy('s.opened_at', 'desc')
                    .limit(limit)
                    .offset(offset);

                return { shifts, total };
            });

            return res.json({
                ok: true,
                shifts: shifts.map(s => ({
                    id: s.id,
                    branchId: s.branch_id,
                    branchName: s.branch_name || '',
                    staffId: s.staff_id,
                    staffName: s.staff_name || '',
                    status: s.status,
                    openedAt: s.opened_at,
                    closedAt: s.closed_at,
                    openingCash: Number(s.opening_cash_etb || 0),
                    closingCash: Number(s.closing_cash_etb || 0),
                    expectedCash: Number(s.expected_cash_etb || 0),
                    cashDifference: Number(s.cash_difference_etb || 0),
                    orderCount: Number(s.order_count || 0),
                    netSales: Number(s.net_sales_etb || 0),
                    paymentBreakdown: safeJsonParse(s.payment_breakdown_json, {}),
                })),
                total,
                dateRange: { from, to },
            });
        } catch (e) {
            return next(e);
        }
    });

    // Get single shift report
    r.get('/owner/reports/shifts/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const shiftId = String(req.params?.id || '').trim();
            if (!shiftId) return res.status(400).json({ error: 'shift_id_required' });

            const cacheKey = `reports:owner:shift:${req.tenant.id}:${shiftId}`;
            const payload = await withCache(cacheKey, config.cacheReportTtlSeconds, async () => {
                const shift = await db()
                    .select(['*'])
                    .from('shift_reports')
                    .where({ id: shiftId, tenant_id: req.tenant.id })
                    .first();

                if (!shift) return null;

                const branch = await db()
                    .select(['name'])
                    .from('branches')
                    .where({ id: shift.branch_id, tenant_id: req.tenant.id })
                    .first();

                return { shift, branchName: branch?.name || '' };
            });

            if (!payload) {
                return res.status(404).json({ error: 'not_found' });
            }

            const shift = payload.shift;

            return res.json({
                ok: true,
                shift: {
                    id: shift.id,
                    branchId: shift.branch_id,
                    branchName: payload.branchName,
                    staffId: shift.staff_id,
                    staffName: shift.staff_name || '',
                    status: shift.status,
                    openedAt: shift.opened_at,
                    closedAt: shift.closed_at,
                    openingCash: Number(shift.opening_cash_etb || 0),
                    closingCash: Number(shift.closing_cash_etb || 0),
                    expectedCash: Number(shift.expected_cash_etb || 0),
                    cashDifference: Number(shift.cash_difference_etb || 0),
                    orderCount: Number(shift.order_count || 0),
                    grossSales: Number(shift.gross_sales_etb || 0),
                    discounts: Number(shift.discounts_etb || 0),
                    netSales: Number(shift.net_sales_etb || 0),
                    tax: Number(shift.tax_etb || 0),
                    tips: Number(shift.tips_etb || 0),
                    voidCount: Number(shift.void_count || 0),
                    voidAmount: Number(shift.void_amount_etb || 0),
                    refundCount: Number(shift.refund_count || 0),
                    refundAmount: Number(shift.refund_amount_etb || 0),
                    paymentBreakdown: safeJsonParse(shift.payment_breakdown_json, {}),
                    notes: shift.notes || '',
                },
            });
        } catch (e) {
            return next(e);
        }
    });

    // Get void/refund analysis
    r.get('/owner/reports/voids-refunds', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? new Date(fromIso).toISOString()
                : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? new Date(toIso).toISOString()
                : now.toISOString();

            let query = db()
                .select([
                    'v.*',
                    'b.name as branch_name',
                    's.name as authorized_by_name',
                ])
                .from({ v: 'void_refund_log' })
                .leftJoin({ b: 'branches' }, function () {
                    this.on('b.id', '=', 'v.branch_id').andOn('b.tenant_id', '=', 'v.tenant_id');
                })
                .leftJoin({ s: 'staff' }, 's.id', 'v.authorized_by')
                .where({ 'v.tenant_id': req.tenant.id })
                .andWhere('v.occurred_at', '>=', from)
                .andWhere('v.occurred_at', '<=', to);

            if (branchId) {
                query = query.andWhere('v.branch_id', branchId);
            }

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const cacheKey = `reports:owner:voids:${req.tenant.id}:${branchId || 'all'}:${from}:${to}`;
            const logs = await withCache(cacheKey, config.cacheReportTtlSeconds, () =>
                query.orderBy('v.occurred_at', 'desc').limit(200)
            );

            // Aggregate by type
            const voidTotal = logs.filter(l => l.type === 'void').reduce((sum, l) => sum + Number(l.amount_etb || 0), 0);
            const refundTotal = logs.filter(l => l.type === 'refund').reduce((sum, l) => sum + Number(l.amount_etb || 0), 0);
            const voidCount = logs.filter(l => l.type === 'void').length;
            const refundCount = logs.filter(l => l.type === 'refund').length;

            // Aggregate by reason
            const byReason = {};
            for (const log of logs) {
                const reason = log.reason || 'No reason';
                if (!byReason[reason]) byReason[reason] = { reason, count: 0, amount: 0 };
                byReason[reason].count++;
                byReason[reason].amount += Number(log.amount_etb || 0);
            }
            const reasons = Object.values(byReason).sort((a, b) => b.amount - a.amount);

            // Aggregate by staff
            const byStaff = {};
            for (const log of logs) {
                const staffId = log.authorized_by || 'unknown';
                const staffName = log.authorized_by_name || 'Unknown';
                if (!byStaff[staffId]) byStaff[staffId] = { staffId, staffName, count: 0, amount: 0 };
                byStaff[staffId].count++;
                byStaff[staffId].amount += Number(log.amount_etb || 0);
            }
            const byStaffList = Object.values(byStaff).sort((a, b) => b.amount - a.amount);

            return res.json({
                ok: true,
                summary: {
                    voidTotal,
                    refundTotal,
                    voidCount,
                    refundCount,
                    totalAmount: voidTotal + refundTotal,
                    totalCount: voidCount + refundCount,
                },
                reasons,
                byStaff: byStaffList,
                items: logs.map(l => ({
                    id: l.id,
                    type: l.type,
                    orderId: l.order_id,
                    productId: l.product_id,
                    productName: l.product_name || '',
                    qty: Number(l.qty || 0),
                    amount: Number(l.amount_etb || 0),
                    reason: l.reason || '',
                    branchId: l.branch_id,
                    branchName: l.branch_name || '',
                    authorizedBy: l.authorized_by_name || '',
                    occurredAt: l.occurred_at,
                })),
                dateRange: { from, to },
            });
        } catch (e) {
            return next(e);
        }
    });

    // Trigger report aggregation (manual)
    r.post('/owner/reports/aggregate', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const dateStr = typeof req.body?.date === 'string' ? req.body.date.trim() : null;
            const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId.trim() : null;

            const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Get all branches if no specific branch
            let branches = [];
            if (branchId) {
                branches = [{ id: branchId }];
            } else {
                branches = await db()
                    .select(['id'])
                    .from('branches')
                    .where({ tenant_id: req.tenant.id });
            }

            let processed = 0;
            for (const branch of branches) {
                try {
                    await aggregateDailySales({ tenantId: req.tenant.id, branchId: branch.id, date });
                    await aggregateHourlySales({ tenantId: req.tenant.id, branchId: branch.id, date });
                    await aggregateProductSales({ tenantId: req.tenant.id, branchId: branch.id, date });
                    processed++;
                } catch (e) {
                    console.error(`Aggregation error for branch ${branch.id}:`, e);
                }
            }

            return res.json({
                ok: true,
                date: toDateString(date),
                branchesProcessed: processed,
            });
        } catch (e) {
            return next(e);
        }
    });

    // Export report data as PDF
    r.get('/owner/reports/export/pdf', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const reportType = typeof req.query?.type === 'string' ? req.query.type.trim() : 'daily';
            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso ? toDateString(fromIso) : toDateString(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000));
            const to = toIso ? toDateString(toIso) : toDateString(now);

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
            if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

            const { generateReportPDF } = require('../services/pdfService');
            const businessName = await getOwnerBusinessName(req.tenant.id);

            const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
            const settingsRaw = settingsRow?.settings_json ? String(settingsRow.settings_json) : '';
            const settingsParsed = safeJsonParse(settingsRaw, {});
            const receipt = settingsParsed?.receipt && typeof settingsParsed.receipt === 'object' ? settingsParsed.receipt : {};
            const logoDataUrl = typeof receipt.logoDataUrl === 'string' ? String(receipt.logoDataUrl) : '';

            let branchName = '';
            if (branchId) {
                const br = await db().select(['name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
                branchName = sanitizeFilenamePart(br?.name || '') || sanitizeFilenamePart(branchId);
            }
            const fileScope = branchName || 'all';

            let pdfBuffer = null;
            let filename = `owner_report_${fileScope}_${from}_to_${to}.pdf`;

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
                filename = `owner_daily_sales_${fileScope}_${from}_to_${to}.pdf`;
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
                filename = `owner_product_performance_${fileScope}_${from}_to_${to}.pdf`;
            }

            if (!pdfBuffer) return res.status(400).json({ error: 'invalid_type' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(pdfBuffer);
        } catch (e) {
            return next(e);
        }
    });

    // Get aggregated daily sales summary (dashboard / overview)
    r.get('/owner/reports/daily', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const from = toDateString(req.query?.from);
            const to = toDateString(req.query?.to);

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
    });

    // Schedule email reports
    r.post('/owner/reports/schedule-email', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : null;
            const frequency = typeof body?.frequency === 'string' ? body.frequency.trim().toLowerCase() : '';
            const emails = Array.isArray(body?.emails) ? body.emails.filter(e => typeof e === 'string' && e.includes('@')) : [];

            if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
                return res.status(400).json({ error: 'invalid_frequency', message: 'Must be daily, weekly, or monthly' });
            }
            if (emails.length === 0) {
                return res.status(400).json({ error: 'emails_required', message: 'At least one valid email required' });
            }

            const scheduleId = makeId('rse');
            const now = new Date().toISOString();

            await db()
                .from('report_email_schedules')
                .insert({
                    id: scheduleId,
                    tenant_id: req.tenant.id,
                    branch_id: branchId,
                    frequency,
                    emails: JSON.stringify(emails),
                    is_active: true,
                    created_at: now,
                    updated_at: now,
                })
                .onConflict(['tenant_id', 'branch_id', 'frequency'])
                .merge({
                    emails: JSON.stringify(emails),
                    is_active: true,
                    updated_at: now,
                });

            return res.json({ ok: true, scheduleId, frequency, emails });
        } catch (e) {
            return next(e);
        }
    });



    // Export report data as XLSX
    r.get('/owner/reports/export/xlsx', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const reportType = typeof req.query?.type === 'string' ? req.query.type.trim() : 'daily';
            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso ? toDateString(fromIso) : toDateString(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000));
            const to = toIso ? toDateString(toIso) : toDateString(now);

            if (new Date(to).getTime() < new Date(from).getTime()) {
                return res.status(400).json({ error: 'invalid_range' });
            }

            const agg = await ensureAggregatedForRange({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to });
            if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

            const businessName = await getOwnerBusinessName(req.tenant.id);

            const [daily, products, staff] = await Promise.all([
                getDailySalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to }),
                getProductPerformance({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 5000 }),
                getStaffSalesSummary({ tenantId: req.tenant.id, branchId, fromDate: from, toDate: to, limit: 5000 }),
            ]);

            const payments = sumPaymentBreakdown(daily);

            const voidsRes = await (async () => {
                const fromDt = `${from} 00:00:00`;
                const toDt = `${to} 23:59:59`;
                const fromIso = `${from}T00:00:00.000Z`;
                const toIso = `${to}T23:59:59.999Z`;

                let query = db()
                    .select([
                        'v.*',
                        'b.name as branch_name',
                        's.name as authorized_by_name',
                    ])
                    .from({ v: 'void_refund_log' })
                    .leftJoin({ b: 'branches' }, function () {
                        this.on('b.id', '=', 'v.branch_id').andOn('b.tenant_id', '=', 'v.tenant_id');
                    })
                    .leftJoin({ s: 'staff' }, 's.id', 'v.authorized_by')
                    .where({ 'v.tenant_id': req.tenant.id })
                    .andWhere((qb) => {
                        qb.whereBetween('v.occurred_at', [fromDt, toDt]).orWhereBetween('v.occurred_at', [fromIso, toIso]);
                    });

                if (branchId) {
                    query = query.andWhere('v.branch_id', branchId);
                }

                const rows = await query.orderBy('v.occurred_at', 'desc').limit(2000);
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
            })();

            const { buildOwnerReportWorkbook } = require('../services/reportXlsxExportService');

            const buf = await buildOwnerReportWorkbook({
                businessName,
                fromDate: from,
                toDate: to,
                daily,
                products,
                staff,
                payments,
                voids: voidsRes,
            });

            let branchName = '';
            if (branchId) {
                const br = await db().select(['name']).from('branches').where({ tenant_id: req.tenant.id, id: branchId }).first();
                branchName = sanitizeFilenamePart(br?.name || '') || sanitizeFilenamePart(branchId);
            }
            const fileScope = branchName || 'all';
            const filename = `owner_reports_${fileScope}_${from}_to_${to}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(buf);
        } catch (e) {
            return next(e);
        }
    });

    return r;
};

module.exports = { makeEnhancedReportsRouter };
