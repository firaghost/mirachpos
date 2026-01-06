/**
 * Enhanced Reports Routes
 * 
 * Provides pre-aggregated and real-time reports for owners:
 * - Hourly sales heatmap
 * - Product performance
 * - Shift reports
 * - Void/refund analysis
 * - PDF/CSV export
 */

const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const {
    getDailySalesSummary,
    getHourlySalesHeatmap,
    getProductPerformance,
    aggregateDailySales,
    aggregateHourlySales,
    aggregateProductSales,
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
    const x = new Date(d);
    return x.toISOString().split('T')[0];
};

const makeEnhancedReportsRouter = () => {
    const r = express.Router();

    // Get hourly sales heatmap
    r.get('/owner/reports/hourly', tenantMiddleware, requireAuth, async (req, res, next) => {
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

            const heatmap = await getHourlySalesHeatmap({
                tenantId: req.tenant.id,
                branchId,
                fromDate: from,
                toDate: to,
            });

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

    // Get product performance
    r.get('/owner/reports/products', tenantMiddleware, requireAuth, async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';
            const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? toDateString(fromIso)
                : toDateString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? toDateString(toIso)
                : toDateString(now);

            const products = await getProductPerformance({
                tenantId: req.tenant.id,
                branchId,
                fromDate: from,
                toDate: to,
                limit,
            });

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
    r.get('/owner/reports/shifts', tenantMiddleware, requireAuth, async (req, res, next) => {
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

            const totalRow = await query.clone().count({ c: 's.id' }).first();
            const total = Number(totalRow?.c || 0);

            const shifts = await query
                .orderBy('s.opened_at', 'desc')
                .limit(limit)
                .offset(offset);

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
    r.get('/owner/reports/shifts/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const shiftId = String(req.params?.id || '').trim();
            if (!shiftId) return res.status(400).json({ error: 'shift_id_required' });

            const shift = await db()
                .select(['*'])
                .from('shift_reports')
                .where({ id: shiftId, tenant_id: req.tenant.id })
                .first();

            if (!shift) {
                return res.status(404).json({ error: 'not_found' });
            }

            // Get branch name
            const branch = await db()
                .select(['name'])
                .from('branches')
                .where({ id: shift.branch_id, tenant_id: req.tenant.id })
                .first();

            return res.json({
                ok: true,
                shift: {
                    id: shift.id,
                    branchId: shift.branch_id,
                    branchName: branch?.name || '',
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
    r.get('/owner/reports/voids-refunds', tenantMiddleware, requireAuth, async (req, res, next) => {
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

            const logs = await query.orderBy('v.occurred_at', 'desc').limit(200);

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
    r.post('/owner/reports/aggregate', tenantMiddleware, requireAuth, async (req, res, next) => {
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

    // Export report data as CSV
    r.get('/owner/reports/export/csv', tenantMiddleware, requireAuth, async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const reportType = typeof req.query?.type === 'string' ? req.query.type.trim() : 'daily';
            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? toDateString(fromIso)
                : toDateString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? toDateString(toIso)
                : toDateString(now);

            let csvContent = '';
            let filename = 'report.csv';

            if (reportType === 'daily') {
                const data = await getDailySalesSummary({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                });

                csvContent = 'Date,Branch ID,Orders,Items,Gross Sales,Discounts,Net Sales,Tax,Tips,Total Collected,Avg Ticket\n';
                for (const row of data) {
                    csvContent += `${row.date},${row.branchId},${row.orderCount},${row.itemCount},${row.grossSales},${row.discounts},${row.netSales},${row.tax},${row.tips},${row.totalCollected},${row.avgTicket}\n`;
                }
                filename = `daily_sales_${from}_to_${to}.csv`;
            } else if (reportType === 'products') {
                const data = await getProductPerformance({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                    limit: 500,
                });

                csvContent = 'Product ID,Name,Category,Qty Sold,Revenue,Void Qty\n';
                for (const row of data) {
                    csvContent += `${row.productId},"${row.name.replace(/"/g, '""')}","${row.category.replace(/"/g, '""')}",${row.qtySold},${row.revenue},${row.voidQty}\n`;
                }
                filename = `product_performance_${from}_to_${to}.csv`;
            } else if (reportType === 'hourly') {
                const data = await getHourlySalesHeatmap({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                });

                csvContent = 'Hour,Label,Order Count,Sales,Avg Sales\n';
                for (const row of data) {
                    csvContent += `${row.hour},${row.label},${row.orderCount},${row.sales},${row.avgSales}\n`;
                }
                filename = `hourly_sales_${from}_to_${to}.csv`;
            }

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(csvContent);
        } catch (e) {
            return next(e);
        }
    });

    // Export report data as PDF
    r.get('/owner/reports/export/pdf', tenantMiddleware, requireAuth, async (req, res, next) => {
        try {
            if (!requireOwnerAuth(req, res)) return;

            const reportType = typeof req.query?.type === 'string' ? req.query.type.trim() : 'daily';
            const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : null;
            const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
            const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

            const now = new Date();
            const from = fromIso && !Number.isNaN(new Date(fromIso).getTime())
                ? toDateString(fromIso)
                : toDateString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
            const to = toIso && !Number.isNaN(new Date(toIso).getTime())
                ? toDateString(toIso)
                : toDateString(now);

            // Dynamically require to ensure service is available
            const { generateReportPDF } = require('../services/pdfService');

            let pdfBuffer = null;
            let filename = 'report.pdf';

            if (reportType === 'daily') {
                const data = await getDailySalesSummary({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                });

                const columns = [
                    { header: 'Date', key: 'date', width: 70 },
                    { header: 'Orders', key: 'orderCount', width: 60, align: 'center' },
                    { header: 'Gross', key: 'grossSales', width: 80, align: 'right', format: n => Number(n).toFixed(2) },
                    { header: 'Net', key: 'netSales', width: 80, align: 'right', format: n => Number(n).toFixed(2) },
                ];

                pdfBuffer = await generateReportPDF('Daily Sales Summary', { from, to }, columns, data);
                filename = `daily_sales_${from}_to_${to}.pdf`;

            } else if (reportType === 'products') {
                const data = await getProductPerformance({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                    limit: 100,
                });

                const columns = [
                    { header: 'Product', key: 'name', width: 150 },
                    { header: 'Category', key: 'category', width: 100 },
                    { header: 'Qty', key: 'qtySold', width: 60, align: 'center' },
                    { header: 'Revenue', key: 'revenue', width: 80, align: 'right', format: n => Number(n).toFixed(2) },
                ];

                pdfBuffer = await generateReportPDF('Product Performance', { from, to }, columns, data);
                filename = `product_performance_${from}_to_${to}.pdf`;

            } else if (reportType === 'hourly') {
                const data = await getHourlySalesHeatmap({
                    tenantId: req.tenant.id,
                    branchId,
                    fromDate: from,
                    toDate: to,
                });

                const columns = [
                    { header: 'Time', key: 'label', width: 80 },
                    { header: 'Orders', key: 'orderCount', width: 80, align: 'center' },
                    { header: 'Sales', key: 'sales', width: 100, align: 'right', format: n => Number(n).toFixed(2) },
                    { header: 'Avg Tkt', key: 'avgSales', width: 100, align: 'right', format: n => Number(n).toFixed(2) },
                ];

                pdfBuffer = await generateReportPDF('Hourly Sales Analysis', { from, to }, columns, data);
                filename = `hourly_sales_${from}_to_${to}.pdf`;
            }

            if (!pdfBuffer) return res.status(400).json({ error: 'invalid_type' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(pdfBuffer);
        } catch (e) {
            return next(e);
        }
    });

    return r;
};

module.exports = { makeEnhancedReportsRouter };
