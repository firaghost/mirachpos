/**
 * Report Aggregation Service
 * 
 * Pre-aggregates sales data for fast report generation.
 * Runs as background job to build daily/hourly summaries.
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const toDateString = (date) => {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
};

// Aggregate daily sales for a specific tenant and branch
const aggregateDailySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;
    const nowIso = new Date().toISOString();

    // Get orders for the day
    const orders = await db()
        .select(['id', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload'])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .andWhere('paid_at', '>=', startOfDay)
        .andWhere('paid_at', '<=', endOfDay);

    if (orders.length === 0) {
        // No orders, ensure empty record exists
        const existingId = `dss_${tenantId}_${branchId}_${dateStr}`;
        const existing = await db()
            .select(['id'])
            .from('daily_sales_summary')
            .where({ id: existingId })
            .first();

        if (!existing) {
            await db().from('daily_sales_summary').insert({
                id: existingId,
                tenant_id: tenantId,
                branch_id: branchId,
                report_date: dateStr,
                order_count: 0,
                item_count: 0,
                gross_sales_etb: 0,
                discounts_etb: 0,
                net_sales_etb: 0,
                tax_etb: 0,
                tips_etb: 0,
                total_collected_etb: 0,
                void_count: 0,
                void_amount_etb: 0,
                refund_count: 0,
                refund_amount_etb: 0,
                payment_breakdown_json: JSON.stringify({}),
                avg_ticket_etb: 0,
                first_order_at: null,
                last_order_at: null,
                computed_at: nowIso,
            });
        }
        return { orderCount: 0 };
    }

    // Calculate aggregates
    let orderCount = 0;
    let itemCount = 0;
    let grossSales = 0;
    let discounts = 0;
    let tax = 0;
    let tips = 0;
    let voidCount = 0;
    let voidAmount = 0;
    let refundCount = 0;
    let refundAmount = 0;
    const paymentBreakdown = {};
    let firstOrderAt = null;
    let lastOrderAt = null;

    for (const order of orders) {
        orderCount++;

        const total = Number(order.total || 0) || 0;
        const orderTax = Number(order.tax || 0) || 0;
        const orderTip = Number(order.tip || 0) || 0;
        const orderDiscount = Number(order.discount || 0) || 0;

        grossSales += total + orderDiscount;
        discounts += orderDiscount;
        tax += orderTax;
        tips += orderTip;

        // Track first/last order
        const paidAt = order.paid_at;
        if (!firstOrderAt || paidAt < firstOrderAt) firstOrderAt = paidAt;
        if (!lastOrderAt || paidAt > lastOrderAt) lastOrderAt = paidAt;

        // Parse payload for items and payment method
        const payload = safeJsonParse(order.payload, {});
        const items = Array.isArray(payload.items) ? payload.items : [];

        for (const item of items) {
            const qty = Number(item.qty || 0) || 0;
            const voidedQty = Number(item.voidedQty || 0) || 0;
            itemCount += Math.max(0, qty - voidedQty);

            if (voidedQty > 0) {
                voidCount += voidedQty;
                voidAmount += voidedQty * (Number(item.unitPrice || item.price || 0) || 0);
            }
        }

        // Payment method breakdown
        const paymentMethod = String(payload.paymentMethod || payload.method || payload.tender || 'Other').trim();
        const pmKey = paymentMethod.toLowerCase().replace(/\s+/g, '_') || 'other';
        paymentBreakdown[pmKey] = (paymentBreakdown[pmKey] || 0) + total;
    }

    const netSales = grossSales - discounts;
    const totalCollected = netSales + tax + tips;
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0;

    // Upsert the summary
    const summaryId = `dss_${tenantId}_${branchId}_${dateStr}`;

    await db()
        .from('daily_sales_summary')
        .insert({
            id: summaryId,
            tenant_id: tenantId,
            branch_id: branchId,
            report_date: dateStr,
            order_count: orderCount,
            item_count: itemCount,
            gross_sales_etb: grossSales,
            discounts_etb: discounts,
            net_sales_etb: netSales,
            tax_etb: tax,
            tips_etb: tips,
            total_collected_etb: totalCollected,
            void_count: voidCount,
            void_amount_etb: voidAmount,
            refund_count: refundCount,
            refund_amount_etb: refundAmount,
            payment_breakdown_json: JSON.stringify(paymentBreakdown),
            avg_ticket_etb: Math.round(avgTicket * 100) / 100,
            first_order_at: firstOrderAt,
            last_order_at: lastOrderAt,
            computed_at: nowIso,
        })
        .onConflict(['tenant_id', 'branch_id', 'report_date'])
        .merge({
            order_count: orderCount,
            item_count: itemCount,
            gross_sales_etb: grossSales,
            discounts_etb: discounts,
            net_sales_etb: netSales,
            tax_etb: tax,
            tips_etb: tips,
            total_collected_etb: totalCollected,
            void_count: voidCount,
            void_amount_etb: voidAmount,
            refund_count: refundCount,
            refund_amount_etb: refundAmount,
            payment_breakdown_json: JSON.stringify(paymentBreakdown),
            avg_ticket_etb: Math.round(avgTicket * 100) / 100,
            first_order_at: firstOrderAt,
            last_order_at: lastOrderAt,
            computed_at: nowIso,
        });

    return { orderCount, netSales, itemCount };
};

// Aggregate hourly sales
const aggregateHourlySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const nowIso = new Date().toISOString();

    // Get orders grouped by hour
    const hourlyData = await db()
        .select([
            db().raw('EXTRACT(HOUR FROM paid_at) as hour'),
            db().raw('COUNT(*) as order_count'),
            db().raw('COALESCE(SUM(total), 0) as net_sales'),
            db().raw('COALESCE(SUM(total + COALESCE(tax, 0) + COALESCE(tip, 0)), 0) as total_collected'),
        ])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .andWhereRaw('DATE(paid_at) = ?', [dateStr])
        .groupByRaw('EXTRACT(HOUR FROM paid_at)');

    for (const row of hourlyData) {
        const hour = Number(row.hour || 0);
        const summaryId = `hss_${tenantId}_${branchId}_${dateStr}_${hour}`;

        await db()
            .from('hourly_sales_summary')
            .insert({
                id: summaryId,
                tenant_id: tenantId,
                branch_id: branchId,
                report_date: dateStr,
                hour,
                order_count: Number(row.order_count || 0),
                net_sales_etb: Number(row.net_sales || 0),
                total_collected_etb: Number(row.total_collected || 0),
                computed_at: nowIso,
            })
            .onConflict(['tenant_id', 'branch_id', 'report_date', 'hour'])
            .merge({
                order_count: Number(row.order_count || 0),
                net_sales_etb: Number(row.net_sales || 0),
                total_collected_etb: Number(row.total_collected || 0),
                computed_at: nowIso,
            });
    }

    return { hoursProcessed: hourlyData.length };
};

// Aggregate product sales
const aggregateProductSales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;
    const nowIso = new Date().toISOString();

    // Get orders for the day
    const orders = await db()
        .select(['payload'])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .andWhere('paid_at', '>=', startOfDay)
        .andWhere('paid_at', '<=', endOfDay);

    const productMap = new Map();

    for (const order of orders) {
        const payload = safeJsonParse(order.payload, {});
        const items = Array.isArray(payload.items) ? payload.items : [];

        for (const item of items) {
            const productId = String(item.productId || item.id || '').trim();
            if (!productId) continue;

            const qty = Number(item.qty || 0) || 0;
            const voidedQty = Number(item.voidedQty || 0) || 0;
            const soldQty = Math.max(0, qty - voidedQty);
            const unitPrice = Number(item.unitPrice || item.price || 0) || 0;
            const revenue = soldQty * unitPrice;

            const existing = productMap.get(productId) || {
                productId,
                name: item.name || '',
                category: item.category || '',
                qtySold: 0,
                revenue: 0,
                voidQty: 0,
            };

            existing.name = existing.name || item.name || '';
            existing.category = existing.category || item.category || '';
            existing.qtySold += soldQty;
            existing.revenue += revenue;
            existing.voidQty += voidedQty;

            productMap.set(productId, existing);
        }
    }

    // Upsert product summaries
    for (const [productId, data] of productMap) {
        const summaryId = `pss_${tenantId}_${branchId}_${productId}_${dateStr}`;

        await db()
            .from('product_sales_summary')
            .insert({
                id: summaryId,
                tenant_id: tenantId,
                branch_id: branchId,
                product_id: productId,
                product_name: data.name,
                category: data.category,
                report_date: dateStr,
                qty_sold: data.qtySold,
                revenue_etb: data.revenue,
                cost_etb: 0, // Would need cost data from inventory
                profit_etb: data.revenue, // Simplified - revenue only
                void_qty: data.voidQty,
                computed_at: nowIso,
            })
            .onConflict(['tenant_id', 'branch_id', 'product_id', 'report_date'])
            .merge({
                product_name: data.name,
                category: data.category,
                qty_sold: data.qtySold,
                revenue_etb: data.revenue,
                void_qty: data.voidQty,
                computed_at: nowIso,
            });
    }

    return { productsProcessed: productMap.size };
};

// Aggregate category sales
const aggregateCategorySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const nowIso = new Date().toISOString();

    // Get from product summaries
    const productSummaries = await db()
        .select([
            'category',
            db().raw('SUM(qty_sold) as qty_sold'),
            db().raw('SUM(revenue_etb) as revenue'),
            db().raw('COUNT(DISTINCT product_id) as product_count'),
        ])
        .from('product_sales_summary')
        .where({ tenant_id: tenantId, branch_id: branchId, report_date: dateStr })
        .groupBy('category');

    for (const row of productSummaries) {
        const category = String(row.category || 'Uncategorized');
        const summaryId = `css_${tenantId}_${branchId}_${category.replace(/\s+/g, '_')}_${dateStr}`;

        await db()
            .from('category_sales_summary')
            .insert({
                id: summaryId,
                tenant_id: tenantId,
                branch_id: branchId,
                category,
                report_date: dateStr,
                qty_sold: Number(row.qty_sold || 0),
                revenue_etb: Number(row.revenue || 0),
                order_count: Number(row.product_count || 0),
                computed_at: nowIso,
            })
            .onConflict(['tenant_id', 'branch_id', 'category', 'report_date'])
            .merge({
                qty_sold: Number(row.qty_sold || 0),
                revenue_etb: Number(row.revenue || 0),
                order_count: Number(row.product_count || 0),
                computed_at: nowIso,
            });
    }

    return { categoriesProcessed: productSummaries.length };
};

// Build shift report
const buildShiftReport = async ({ shiftId }) => {
    const nowIso = new Date().toISOString();

    const shift = await db()
        .select(['*'])
        .from('shift_reports')
        .where({ id: shiftId })
        .first();

    if (!shift) return null;

    // Get orders during this shift
    const orders = await db()
        .select(['id', 'total', 'tax', 'tip', 'discount', 'payload'])
        .from('orders')
        .where({ tenant_id: shift.tenant_id, branch_id: shift.branch_id })
        .andWhere('paid_at', '>=', shift.opened_at)
        .andWhere(function () {
            if (shift.closed_at) {
                this.andWhere('paid_at', '<=', shift.closed_at);
            }
        });

    let orderCount = 0;
    let grossSales = 0;
    let discounts = 0;
    let tax = 0;
    let tips = 0;
    let voidCount = 0;
    let voidAmount = 0;
    const paymentBreakdown = {};

    for (const order of orders) {
        orderCount++;

        const total = Number(order.total || 0) || 0;
        const orderTax = Number(order.tax || 0) || 0;
        const orderTip = Number(order.tip || 0) || 0;
        const orderDiscount = Number(order.discount || 0) || 0;

        grossSales += total + orderDiscount;
        discounts += orderDiscount;
        tax += orderTax;
        tips += orderTip;

        const payload = safeJsonParse(order.payload, {});
        const paymentMethod = String(payload.paymentMethod || payload.method || 'Other').trim();
        const pmKey = paymentMethod.toLowerCase().replace(/\s+/g, '_') || 'other';
        paymentBreakdown[pmKey] = (paymentBreakdown[pmKey] || 0) + total;

        const items = Array.isArray(payload.items) ? payload.items : [];
        for (const item of items) {
            const voidedQty = Number(item.voidedQty || 0) || 0;
            if (voidedQty > 0) {
                voidCount += voidedQty;
                voidAmount += voidedQty * (Number(item.unitPrice || item.price || 0) || 0);
            }
        }
    }

    const netSales = grossSales - discounts;
    const expectedCash = Number(shift.opening_cash_etb || 0) + (paymentBreakdown.cash || 0);

    await db()
        .from('shift_reports')
        .where({ id: shiftId })
        .update({
            order_count: orderCount,
            gross_sales_etb: grossSales,
            discounts_etb: discounts,
            net_sales_etb: netSales,
            tax_etb: tax,
            tips_etb: tips,
            payment_breakdown_json: JSON.stringify(paymentBreakdown),
            void_count: voidCount,
            void_amount_etb: voidAmount,
            expected_cash_etb: expectedCash,
            updated_at: nowIso,
        });

    return { orderCount, netSales };
};

// Daily aggregation job - runs for all tenants
const runDailyAggregation = async (date = null) => {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
    const dateStr = toDateString(targetDate);

    console.log(`[ReportAggregation] Starting daily aggregation for ${dateStr}`);

    // Get all tenant-branch combinations with orders on that date
    const tenantBranches = await db()
        .select(['tenant_id', 'branch_id'])
        .from('orders')
        .whereRaw('DATE(paid_at) = ?', [dateStr])
        .groupBy(['tenant_id', 'branch_id']);

    let processed = 0;
    let errors = 0;

    for (const { tenant_id, branch_id } of tenantBranches) {
        try {
            await aggregateDailySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateHourlySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateProductSales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateCategorySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            processed++;
        } catch (error) {
            console.error(`[ReportAggregation] Error for ${tenant_id}/${branch_id}:`, error);
            errors++;
        }
    }

    console.log(`[ReportAggregation] Completed: ${processed} processed, ${errors} errors`);

    return { date: dateStr, processed, errors };
};

// Get pre-aggregated daily sales
const getDailySalesSummary = async ({ tenantId, branchId = null, fromDate, toDate }) => {
    let query = db()
        .select(['*'])
        .from('daily_sales_summary')
        .where({ tenant_id: tenantId })
        .andWhere('report_date', '>=', fromDate)
        .andWhere('report_date', '<=', toDate);

    if (branchId) {
        query = query.andWhere({ branch_id: branchId });
    }

    const rows = await query.orderBy('report_date', 'asc');

    return rows.map((r) => ({
        date: r.report_date,
        branchId: r.branch_id,
        orderCount: Number(r.order_count || 0),
        itemCount: Number(r.item_count || 0),
        grossSales: Number(r.gross_sales_etb || 0),
        discounts: Number(r.discounts_etb || 0),
        netSales: Number(r.net_sales_etb || 0),
        tax: Number(r.tax_etb || 0),
        tips: Number(r.tips_etb || 0),
        totalCollected: Number(r.total_collected_etb || 0),
        voidCount: Number(r.void_count || 0),
        voidAmount: Number(r.void_amount_etb || 0),
        refundCount: Number(r.refund_count || 0),
        refundAmount: Number(r.refund_amount_etb || 0),
        paymentBreakdown: safeJsonParse(r.payment_breakdown_json, {}),
        avgTicket: Number(r.avg_ticket_etb || 0),
        firstOrderAt: r.first_order_at,
        lastOrderAt: r.last_order_at,
    }));
};

// Get hourly sales heatmap data
const getHourlySalesHeatmap = async ({ tenantId, branchId = null, fromDate, toDate }) => {
    let query = db()
        .select([
            'hour',
            db().raw('SUM(order_count) as total_orders'),
            db().raw('SUM(net_sales_etb) as total_sales'),
            db().raw('AVG(net_sales_etb) as avg_sales'),
        ])
        .from('hourly_sales_summary')
        .where({ tenant_id: tenantId })
        .andWhere('report_date', '>=', fromDate)
        .andWhere('report_date', '<=', toDate);

    if (branchId) {
        query = query.andWhere({ branch_id: branchId });
    }

    const rows = await query.groupBy('hour').orderBy('hour', 'asc');

    // Build 24-hour array
    const heatmap = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        label: `${String(i).padStart(2, '0')}:00`,
        orderCount: 0,
        sales: 0,
        avgSales: 0,
    }));

    for (const row of rows) {
        const hour = Number(row.hour || 0);
        if (hour >= 0 && hour < 24) {
            heatmap[hour] = {
                hour,
                label: `${String(hour).padStart(2, '0')}:00`,
                orderCount: Number(row.total_orders || 0),
                sales: Number(row.total_sales || 0),
                avgSales: Number(row.avg_sales || 0),
            };
        }
    }

    return heatmap;
};

// Get product performance
const getProductPerformance = async ({ tenantId, branchId = null, fromDate, toDate, limit = 20 }) => {
    let query = db()
        .select([
            'product_id',
            'product_name',
            'category',
            db().raw('SUM(qty_sold) as total_qty'),
            db().raw('SUM(revenue_etb) as total_revenue'),
            db().raw('SUM(void_qty) as total_voids'),
        ])
        .from('product_sales_summary')
        .where({ tenant_id: tenantId })
        .andWhere('report_date', '>=', fromDate)
        .andWhere('report_date', '<=', toDate);

    if (branchId) {
        query = query.andWhere({ branch_id: branchId });
    }

    const rows = await query
        .groupBy(['product_id', 'product_name', 'category'])
        .orderBy(db().raw('SUM(revenue_etb)'), 'desc')
        .limit(limit);

    return rows.map((r) => ({
        productId: r.product_id,
        name: r.product_name || r.product_id,
        category: r.category || 'Uncategorized',
        qtySold: Number(r.total_qty || 0),
        revenue: Number(r.total_revenue || 0),
        voidQty: Number(r.total_voids || 0),
    }));
};

// Clean up old report data based on retention policy
const cleanupOldReports = async () => {
    const config = await db()
        .select(['report_retention_days'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

    const retentionDays = Number(config?.report_retention_days || 365);
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffStr = toDateString(cutoffDate);

    const tables = [
        'daily_sales_summary',
        'hourly_sales_summary',
        'product_sales_summary',
        'category_sales_summary',
    ];

    let totalDeleted = 0;

    for (const table of tables) {
        const result = await db()
            .from(table)
            .where('report_date', '<', cutoffStr)
            .del();

        totalDeleted += result;
    }

    console.log(`[ReportAggregation] Cleanup: deleted ${totalDeleted} old records`);

    return { deleted: totalDeleted, cutoffDate: cutoffStr };
};

module.exports = {
    aggregateDailySales,
    aggregateHourlySales,
    aggregateProductSales,
    aggregateCategorySales,
    buildShiftReport,
    runDailyAggregation,
    getDailySalesSummary,
    getHourlySalesHeatmap,
    getProductPerformance,
    cleanupOldReports,
};
