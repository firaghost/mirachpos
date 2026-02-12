/**
 * Report Aggregation Service
 * 
 * Pre-aggregates sales data for fast report generation.
 * Runs as background job to build daily/hourly summaries.
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { invalidateOwnerReports } = require('../utils/cache');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const toDateString = (date) => {
    const s = String(date || '').trim();
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
};

const normalizePaymentKey = (method) => {
    const paymentMethod = String(method || 'Other').trim();
    return paymentMethod.toLowerCase().replace(/\s+/g, '_') || 'other';
};

const addDaysUtc = (dateStr, days) => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
};

const isIsoDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());

const getDayBounds = (dateStr) => {
    const d = String(dateStr || '').trim();
    if (!d) return null;
    // Use very wide bounds to catch orders across any timezone differences
    // Some systems store UTC, some store local time - cover both
    const prevDay = addDaysUtc(d, -2);
    const nextDay = addDaysUtc(d, 2);
    return {
        mysqlStart: `${prevDay} 00:00:00`,
        mysqlEnd: `${nextDay} 23:59:59`,
        isoStart: `${prevDay}T00:00:00.000Z`,
        isoEnd: `${nextDay}T23:59:59.999Z`,
    };
};

const getRangeBounds = (fromDateStr, toDateStr) => {
    const from = toDateString(fromDateStr);
    const to = toDateString(toDateStr);
    if (!from || !to) return null;

    const startMs = new Date(`${from}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${to}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;

    return {
        from,
        to,
        mysqlStart: `${from} 00:00:00`,
        mysqlEnd: `${to} 23:59:59`,
        isoStart: `${from}T00:00:00.000Z`,
        isoEnd: `${to}T23:59:59.999Z`,
    };
};

const getOrderStatusSummary = async ({ tenantId, branchId, fromDate, toDate }) => {
    const bounds = getRangeBounds(fromDate, toDate);
    if (!bounds) return { ok: false, error: 'invalid_range' };

    const { from, to, mysqlStart, mysqlEnd, isoStart, isoEnd } = bounds;

    const scopePaid = { tenant_id: tenantId, status: 'Paid' };
    const scopeAll = { tenant_id: tenantId };
    if (branchId) {
        scopePaid.branch_id = branchId;
        scopeAll.branch_id = branchId;
    }

    const [paidAggRow, statusRows, voidRefundAggRows] = await Promise.all([
        db()
            .from('orders')
            .where(scopePaid)
            .andWhere((qb) => {
                qb.whereBetween('paid_at', [mysqlStart, mysqlEnd]).orWhereBetween('paid_at', [isoStart, isoEnd]);
            })
            .sum({ total: 'total' })
            .count({ count: '*' })
            .first(),
        db()
            .from('orders')
            .where(scopeAll)
            .andWhere((qb) => {
                qb.whereBetween('created_at', [mysqlStart, mysqlEnd]).orWhereBetween('created_at', [isoStart, isoEnd]);
            })
            .select(['status'])
            .count({ count: '*' })
            .groupBy(['status']),
        db()
            .from({ v: 'void_refund_log' })
            .where({ 'v.tenant_id': tenantId })
            .modify((qb) => {
                if (branchId) qb.andWhere('v.branch_id', branchId);
            })
            .andWhere((qb) => {
                qb.whereBetween('v.occurred_at', [mysqlStart, mysqlEnd]).orWhereBetween('v.occurred_at', [isoStart, isoEnd]);
            })
            .select(['v.type'])
            .sum({ amount: 'v.amount_etb' })
            .count({ count: '*' })
            .groupBy(['v.type']),
    ]);

    const paid = {
        count: Number(paidAggRow?.count ?? 0) || 0,
        totalCollected: Number(paidAggRow?.total ?? 0) || 0,
    };

    const byStatus = {};
    for (const r of Array.isArray(statusRows) ? statusRows : []) {
        const st = String(r?.status || '').trim() || 'Unknown';
        byStatus[st] = Number(r?.count ?? 0) || 0;
    }

    const terminalStatuses = new Set(['Paid', 'Voided', 'Refunded']);
    const nonPaidCount = Object.entries(byStatus).reduce((acc, [st, cnt]) => (terminalStatuses.has(st) ? acc : acc + (Number(cnt) || 0)), 0);

    const voidRefund = {};
    for (const r of Array.isArray(voidRefundAggRows) ? voidRefundAggRows : []) {
        const tp = String(r?.type || '').trim() || 'unknown';
        voidRefund[tp] = {
            count: Number(r?.count ?? 0) || 0,
            amount: Number(r?.amount ?? 0) || 0,
        };
    }

    return {
        ok: true,
        from,
        to,
        paid,
        nonPaid: { count: nonPaidCount },
        byStatus,
        voidRefund,
    };
};

const listTenantBranchesWithOrdersOnDate = async ({ tenantId, date }) => {
    const dateStr = toDateString(date);
    const b = getDayBounds(dateStr);
    if (!b) return [];
    const rows = await db()
        .select(['branch_id'])
        .from('orders')
        .where({ tenant_id: tenantId, status: 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
        })
        .groupBy(['branch_id']);
    return rows.map((r) => String(r.branch_id || '').trim()).filter(Boolean);
};

const ensureAggregatedForRange = async ({ tenantId, branchId, fromDate, toDate }) => {
    const from = isIsoDateOnly(fromDate) ? String(fromDate) : toDateString(fromDate);
    const to = isIsoDateOnly(toDate) ? String(toDate) : toDateString(toDate);
    if (!from || !to) return { ok: false, error: 'invalid_range' };

    const startMs = new Date(`${from}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${to}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return { ok: false, error: 'invalid_range' };
    }

    const days = Math.min(120, Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1);
    let processed = 0;
    let errors = 0;

    let day = from;
    for (let i = 0; i < days; i++) {
        const dateObj = new Date(`${day}T00:00:00.000Z`);
        if (Number.isNaN(dateObj.getTime())) break;

        const branches = branchId
            ? [String(branchId).trim()].filter(Boolean)
            : await listTenantBranchesWithOrdersOnDate({ tenantId, date: dateObj });

        console.log(`[ReportAggregation] Processing day ${day}, found ${branches.length} branches with orders`);

        for (const bid of branches) {
            let okAny = false;

            try {
                console.log(`[ReportAggregation] Running aggregateDailySales for ${tenantId}/${bid}/${day}`);
                const result = await aggregateDailySales({ tenantId, branchId: bid, date: dateObj });
                console.log(`[ReportAggregation] aggregateDailySales result:`, result);
                okAny = true;
            } catch (e) {
                console.error('[ReportAggregation] aggregateDailySales failed', {
                    tenantId,
                    branchId: bid,
                    day,
                    error: e?.message || String(e),
                });
                errors += 1;
            }

            try {
                await aggregateHourlySales({ tenantId, branchId: bid, date: dateObj });
                okAny = true;
            } catch (e) {
                console.error('[ReportAggregation] aggregateHourlySales failed', {
                    tenantId,
                    branchId: bid,
                    day,
                    error: e?.message || String(e),
                });
                errors += 1;
            }

            try {
                await aggregateProductSales({ tenantId, branchId: bid, date: dateObj });
                okAny = true;
            } catch (e) {
                console.error('[ReportAggregation] aggregateProductSales failed', {
                    tenantId,
                    branchId: bid,
                    day,
                    error: e?.message || String(e),
                });
                errors += 1;
            }

            try {
                await aggregateCategorySales({ tenantId, branchId: bid, date: dateObj });
                okAny = true;
            } catch (e) {
                console.error('[ReportAggregation] aggregateCategorySales failed', {
                    tenantId,
                    branchId: bid,
                    day,
                    error: e?.message || String(e),
                });
                errors += 1;
            }

            try {
                await aggregateStaffSales({ tenantId, branchId: bid, date: dateObj });
                okAny = true;
            } catch (e) {
                console.error('[ReportAggregation] aggregateStaffSales failed', {
                    tenantId,
                    branchId: bid,
                    day,
                    error: e?.message || String(e),
                });
                errors += 1;
            }

            if (okAny) {
                processed += 1;
                try {
                    await invalidateOwnerReports({ tenantId, branchId: bid });
                } catch {
                    // ignore cache invalidation errors
                }
            }
        }

        const next = addDaysUtc(day, 1);
        if (!next) break;
        day = next;
    }

    return { ok: true, from, to, processed, errors };
};

// Aggregate daily sales for a specific tenant and branch
const aggregateDailySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const b = getDayBounds(dateStr);
    if (!b) return { orderCount: 0 };
    const nowIso = new Date().toISOString();

    // Get orders for the day
    const orders = await db()
        .select(['id', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload'])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
        });

    if (orders.length === 0) {
        // No orders, ensure empty record exists
        const existingId = `dss_${tenantId}_${branchId}_${dateStr}`;
        const record = {
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
        };

        const { id: _id, ...update } = record;
        await db().from('daily_sales_summary').insert(record).onConflict('id').merge(update);
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

    let totalCollected = 0;
    for (const order of orders) {
        orderCount++;

        const total = Number(order.total || 0) || 0;
        const orderTax = Number(order.tax || 0) || 0;
        const orderTip = Number(order.tip || 0) || 0;
        const orderDiscount = Number(order.discount || 0) || 0;

        // order.total includes tax + tip (and service charge). To avoid double-counting:
        const net = Math.max(0, total - orderTax - orderTip);
        const gross = net + Math.max(0, orderDiscount);

        grossSales += gross;
        discounts += orderDiscount;
        tax += orderTax;
        tips += orderTip;
        totalCollected += total;

        // Track first/last order
        const paidAt = order.paid_at;
        if (!firstOrderAt || (paidAt && paidAt < firstOrderAt)) firstOrderAt = paidAt;
        if (!lastOrderAt || (paidAt && paidAt > lastOrderAt)) lastOrderAt = paidAt;

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

        // Payment method breakdown (use collected total)
        const paymentMethod = String(payload.paymentMethod || payload.method || payload.tender || 'Other').trim();
        const pmKey = normalizePaymentKey(paymentMethod);
        paymentBreakdown[pmKey] = (paymentBreakdown[pmKey] || 0) + total;
    }

    const netSales = Math.max(0, grossSales - discounts);
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0;

    // Upsert the summary - delete first to avoid primary key conflicts, then insert
    const summaryId = `dss_${tenantId}_${branchId}_${dateStr}`;
    const record = {
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
    };

    const { id: _id, ...update } = record;
    await db().from('daily_sales_summary').insert(record).onConflict('id').merge(update);

    return { orderCount, netSales, itemCount };
};

// Aggregate staff sales (daily)
const aggregateStaffSales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const b = getDayBounds(dateStr);
    if (!b) return { staffCount: 0, orderCount: 0 };
    const nowIso = new Date().toISOString();

    const orders = await db()
        .select(['id', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload'])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
        });

    const byStaff = new Map();

    for (const order of orders) {
        const payload = safeJsonParse(order.payload, {});
        const staffId = String(payload?.createdByStaffId || payload?.created_by_staff_id || '').trim() || 'unknown';
        const staffName = String(payload?.createdByName || payload?.created_by_name || '').trim() || (staffId === 'unknown' ? 'Unknown' : '');

        const total = Number(order.total || 0) || 0;
        const orderTaxDb = Number(order.tax || 0) || 0;
        const orderTipDb = Number(order.tip || 0) || 0;
        const orderDiscount = Number(order.discount || 0) || 0;
        const paidAt = order.paid_at;

        // Tip is stored in orders.tip, but some historical payloads may keep it in payload.
        const tipFromPayload = Number(payload?.tip ?? payload?.tipAmount ?? payload?.tip_etb ?? payload?.tipETB ?? 0) || 0;
        const taxFromPayload = Number(payload?.tax ?? payload?.taxAmount ?? payload?.tax_etb ?? payload?.taxETB ?? 0) || 0;
        const orderTip = orderTipDb > 0 ? orderTipDb : tipFromPayload;
        const orderTax = orderTaxDb > 0 ? orderTaxDb : taxFromPayload;

        const net = Math.max(0, total - orderTax - orderTip);
        const gross = net + Math.max(0, orderDiscount);

        const pmKey = normalizePaymentKey(payload?.paymentMethod || payload?.method || payload?.tender);

        const cur = byStaff.get(staffId) || {
            staffId,
            staffName,
            orderCount: 0,
            grossSales: 0,
            discounts: 0,
            netSales: 0,
            tax: 0,
            tips: 0,
            totalCollected: 0,
            paymentBreakdown: {},
            firstOrderAt: null,
            lastOrderAt: null,
        };

        cur.orderCount += 1;
        cur.grossSales += gross;
        cur.discounts += orderDiscount;
        cur.netSales += net;
        cur.tax += orderTax;
        cur.tips += orderTip;
        cur.totalCollected += total;
        cur.paymentBreakdown[pmKey] = (cur.paymentBreakdown[pmKey] || 0) + total;

        if (!cur.firstOrderAt || (paidAt && paidAt < cur.firstOrderAt)) cur.firstOrderAt = paidAt;
        if (!cur.lastOrderAt || (paidAt && paidAt > cur.lastOrderAt)) cur.lastOrderAt = paidAt;

        if (!cur.staffName && staffName) cur.staffName = staffName;

        byStaff.set(staffId, cur);
    }

    // If there were no orders, we still do nothing. This avoids generating lots of empty rows.
    for (const row of byStaff.values()) {
        const avgTicket = row.orderCount > 0 ? row.netSales / row.orderCount : 0;
        const id = `sss_${tenantId}_${branchId}_${dateStr}_${row.staffId}`;

        try {
            const record = {
                id,
                tenant_id: tenantId,
                branch_id: branchId,
                report_date: dateStr,
                staff_id: row.staffId,
                staff_name: row.staffName || null,
                order_count: row.orderCount,
                gross_sales_etb: row.grossSales,
                discounts_etb: row.discounts,
                net_sales_etb: row.netSales,
                tax_etb: row.tax,
                tips_etb: row.tips,
                total_collected_etb: row.totalCollected,
                payment_breakdown_json: JSON.stringify(row.paymentBreakdown),
                avg_ticket_etb: Math.round(avgTicket * 100) / 100,
                first_order_at: row.firstOrderAt,
                last_order_at: row.lastOrderAt,
                computed_at: nowIso,
            };

            const { id: _id, ...update } = record;
            await db().from('staff_sales_summary').insert(record).onConflict('id').merge(update);
        } catch (e) {
            console.error('[ReportAggregation] Staff sales insert failed, retrying with update:', {
                id,
                staffId: row.staffId,
                error: e?.message || String(e),
            });
        }
    }

    return { staffCount: byStaff.size, orderCount: orders.length };
};

// Aggregate hourly sales
const aggregateHourlySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const b = getDayBounds(dateStr);
    if (!b) return { hoursProcessed: 0 };
    const nowIso = new Date().toISOString();

    // Get orders grouped by hour
    const hourlyData = await db()
        .select([
            db().raw('EXTRACT(HOUR FROM paid_at) as hour'),
            db().raw('COUNT(*) as order_count'),
            db().raw('COALESCE(SUM(GREATEST(0, COALESCE(total, 0) - COALESCE(tax, 0) - COALESCE(tip, 0))), 0) as net_sales'),
            db().raw('COALESCE(SUM(COALESCE(total, 0)), 0) as total_collected'),
        ])
        .from('orders')
        .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
        })
        .groupByRaw('EXTRACT(HOUR FROM paid_at)');

    for (const row of hourlyData) {
        const hour = Number(row.hour || 0);
        const summaryId = `hss_${tenantId}_${branchId}_${dateStr}_${hour}`;
        const record = {
            id: summaryId,
            tenant_id: tenantId,
            branch_id: branchId,
            report_date: dateStr,
            hour,
            order_count: Number(row.order_count || 0),
            net_sales_etb: Number(row.net_sales || 0),
            total_collected_etb: Number(row.total_collected || 0),
            computed_at: nowIso,
        };

        const { id: _id, ...update } = record;
        await db().from('hourly_sales_summary').insert(record).onConflict('id').merge(update);
    }

    return { hoursProcessed: hourlyData.length };
};

// Aggregate product sales
const aggregateProductSales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const b = getDayBounds(dateStr);
    if (!b) return { productsProcessed: 0 };
    const nowIso = new Date().toISOString();

    const productMap = new Map();

    // Aggregate from normalized order_items instead of JSON payload.
    // Some deployments might not have order_items dual-write populated, so we fall back to payload on error/empty.
    let itemRows = [];
    try {
        itemRows = await db()
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
            .where({ 'oi.tenant_id': tenantId, 'oi.branch_id': branchId, 'o.status': 'Paid' })
            .andWhere((qb) => {
                qb.whereBetween('o.paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('o.paid_at', [b.isoStart, b.isoEnd]);
            })
            .select([
                db().raw("COALESCE(NULLIF(TRIM(oi.product_id), ''), NULLIF(TRIM(oi.product_code), ''), TRIM(oi.name)) as product_key"),
                db().raw("COALESCE(NULLIF(TRIM(p.name), ''), TRIM(oi.name)) as product_name"),
                db().raw("COALESCE(NULLIF(TRIM(p.category), ''), '') as category"),
                db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))) as qty_sold'),
                db().raw('SUM(GREATEST(0, COALESCE(oi.voided_qty, 0))) as void_qty'),
                db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue_etb'),
            ])
            .groupBy(['product_key', 'product_name', 'category']);
    } catch {
        itemRows = [];
    }

    if (!Array.isArray(itemRows) || itemRows.length === 0) {
        try {
            itemRows = await db()
                .from({ oi: 'order_items' })
                .innerJoin({ o: 'orders' }, function () {
                    this.on('o.id', '=', 'oi.order_id')
                        .andOn('o.tenant_id', '=', 'oi.tenant_id')
                        .andOn('o.branch_id', '=', 'oi.branch_id');
                })
                .where({ 'oi.tenant_id': tenantId, 'oi.branch_id': branchId, 'o.status': 'Paid' })
                .andWhere((qb) => {
                    qb.whereBetween('o.paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('o.paid_at', [b.isoStart, b.isoEnd]);
                })
                .select([
                    db().raw("COALESCE(NULLIF(TRIM(oi.product_id), ''), NULLIF(TRIM(oi.product_code), ''), TRIM(oi.name)) as product_key"),
                    db().raw("COALESCE(NULLIF(TRIM(oi.name), ''), NULLIF(TRIM(oi.product_code), ''), NULLIF(TRIM(oi.product_id), ''), 'Unknown') as product_name"),
                    db().raw("'' as category"),
                    db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))) as qty_sold'),
                    db().raw('SUM(GREATEST(0, COALESCE(oi.voided_qty, 0))) as void_qty'),
                    db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue_etb'),
                ])
                .groupBy(['product_key', 'product_name', 'category']);
        } catch {
            itemRows = [];
        }
    }

    if (Array.isArray(itemRows) && itemRows.length > 0) {
        for (const r of itemRows) {
            const productId = String(r.product_key || '').trim();
            if (!productId) continue;
            const name = String(r.product_name || productId);
            const category = String(r.category || '');
            const qtySold = Number(r.qty_sold || 0) || 0;
            const revenue = Number(r.revenue_etb || 0) || 0;
            const voidQty = Number(r.void_qty || 0) || 0;

            const existing = productMap.get(productId) || {
                productId,
                name,
                category,
                qtySold: 0,
                revenue: 0,
                voidQty: 0,
            };

            existing.name = existing.name || name;
            existing.category = existing.category || category;
            existing.qtySold += qtySold;
            existing.revenue += revenue;
            existing.voidQty += voidQty;

            productMap.set(productId, existing);
        }
    } else {
        const orders = await db()
            .select(['payload'])
            .from('orders')
            .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
            .andWhere((qb) => {
                qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
            });

        for (const order of orders) {
            const payload = safeJsonParse(order.payload, {});
            const items = Array.isArray(payload.items) ? payload.items : [];

            for (const item of items) {
                const productId = String(item.productId || item.product_id || item.code || item.productCode || item.id || item.name || '').trim();
                if (!productId) continue;

                const qty = Number(item.qty || 0) || 0;
                const voidedQty = Number(item.voidedQty || 0) || 0;
                const soldQty = Math.max(0, qty - voidedQty);
                const unitPrice = Number(item.unitPrice || item.price || 0) || 0;
                const revenue = soldQty * unitPrice;

                const existing = productMap.get(productId) || {
                    productId,
                    name: item.name || productId,
                    category: item.category || '',
                    qtySold: 0,
                    revenue: 0,
                    voidQty: 0,
                };

                existing.name = existing.name || item.name || productId;
                existing.category = existing.category || item.category || '';
                existing.qtySold += soldQty;
                existing.revenue += revenue;
                existing.voidQty += voidedQty;

                productMap.set(productId, existing);
            }
        }
    }

    const unitCostByProductId = new Map();
    try {
        const ids = Array.from(productMap.keys());
        if (ids.length) {
            const recipeRows = await db()
                .from('menu_recipes')
                .where({ tenant_id: tenantId, branch_id: branchId })
                .whereIn('product_id', ids)
                .select(['product_id', 'recipe_json']);

            for (const r of recipeRows) {
                const pid = String(r.product_id || '').trim();
                if (!pid) continue;
                const recipe = safeJsonParse(r.recipe_json, {});
                const unitCost = Number(recipe?.totalCost ?? 0) || 0;
                if (unitCost > 0) unitCostByProductId.set(pid, unitCost);
            }
        }
    } catch {
        unitCostByProductId.clear();
    }

    // Upsert product summaries
    for (const [productId, data] of productMap) {
        const summaryId = `pss_${tenantId}_${branchId}_${productId}_${dateStr}`;

        const unitCost = Number(unitCostByProductId.get(productId) || 0) || 0;
        const cost = Math.max(0, data.qtySold) * unitCost;
        const profit = data.revenue - cost;

        const record = {
            id: summaryId,
            tenant_id: tenantId,
            branch_id: branchId,
            product_id: productId,
            product_name: data.name,
            category: data.category,
            report_date: dateStr,
            qty_sold: data.qtySold,
            revenue_etb: data.revenue,
            cost_etb: cost,
            profit_etb: profit,
            void_qty: data.voidQty,
            computed_at: nowIso,
        };

        const { id: _id, ...update } = record;
        await db().from('product_sales_summary').insert(record).onConflict('id').merge(update);
    }

    return { productsProcessed: productMap.size };
};

// Aggregate category sales
const aggregateCategorySales = async ({ tenantId, branchId, date }) => {
    const dateStr = toDateString(date);
    const nowIso = new Date().toISOString();

    const rows = await db()
        .from('product_sales_summary')
        .where({ tenant_id: tenantId, branch_id: branchId })
        .andWhere('report_date', '=', dateStr)
        .select([
            db().raw('COALESCE(NULLIF(TRIM(category), \'\'), \'Uncategorized\') as category'),
            db().raw('SUM(qty_sold) as qty_sold'),
            db().raw('SUM(revenue_etb) as revenue_etb'),
            db().raw('COUNT(DISTINCT product_id) as product_count'),
        ])
        .groupBy(['category']);

    for (const r of rows) {
        const category = String(r.category || 'Uncategorized');
        const qtySold = Number(r.qty_sold || 0) || 0;
        const revenue = Number(r.revenue_etb || 0) || 0;
        const productCount = Number(r.product_count || 0) || 0;

        await db()
            .from('category_sales_summary')
            .insert({
                id: makeId('css'),
                tenant_id: tenantId,
                branch_id: branchId,
                category,
                report_date: dateStr,
                qty_sold: qtySold,
                revenue_etb: revenue,
                order_count: productCount,
                computed_at: nowIso,
            })
            .onConflict(['tenant_id', 'branch_id', 'category', 'report_date'])
            .merge({
                qty_sold: qtySold,
                revenue_etb: revenue,
                order_count: productCount,
                computed_at: nowIso,
            });
    }

    return { categoriesProcessed: rows.length };
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

    const b = getDayBounds(dateStr);
    if (!b) return { date: dateStr, processed: 0, errors: 0 };

    console.log(`[ReportAggregation] Starting daily aggregation for ${dateStr}`);

    // Get all tenant-branch combinations with orders on that date
    const tenantBranches = await db()
        .select(['tenant_id', 'branch_id'])
        .from('orders')
        .where({ status: 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('paid_at', [b.mysqlStart, b.mysqlEnd]).orWhereBetween('paid_at', [b.isoStart, b.isoEnd]);
        })
        .groupBy(['tenant_id', 'branch_id']);

    let processed = 0;
    let errors = 0;

    for (const { tenant_id, branch_id } of tenantBranches) {
        try {
            await aggregateDailySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateHourlySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateProductSales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateCategorySales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            await aggregateStaffSales({ tenantId: tenant_id, branchId: branch_id, date: targetDate });
            processed++;
        } catch (e) {
            errors++;
            console.error(`[ReportAggregation] Error processing branch ${branch_id}:`, e);
        }
    }

    console.log(`[ReportAggregation] Completed: ${processed} processed, ${errors} errors`);

    return { date: dateStr, processed, errors };
};

const getDailySalesSummary = async ({ tenantId, branchId, fromDate, toDate, mode = 'daily' }) => {
    const fromDt = `${fromDate} 00:00:00`;
    const toDt = `${toDate} 23:59:59`;
    const fromIso = `${fromDate}T00:00:00.000Z`;
    const toIso = `${toDate}T23:59:59.999Z`;

    let ordersQ = db()
        .from({ o: 'orders' })
        .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
        });

    if (branchId) ordersQ = ordersQ.andWhere({ 'o.branch_id': branchId });

    const isRangeMode = mode === 'range';

    let orderAgg;
    if (isRangeMode) {
        const [row] = await ordersQ
            .select([
                db().raw('COUNT(*) as order_count'),
                db().raw('COALESCE(SUM(COALESCE(o.discount, 0)), 0) as discounts_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.tax, 0)), 0) as tax_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as tips_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.total, 0)), 0) as total_collected_etb'),
                db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as net_sales_etb'),
            ]);
        orderAgg = row ? [row] : [];
    } else {
        orderAgg = await ordersQ
            .select([
                db().raw('DATE(o.paid_at) as report_date'),
                'o.branch_id',
                db().raw('COUNT(*) as order_count'),
                db().raw('COALESCE(SUM(COALESCE(o.discount, 0)), 0) as discounts_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.tax, 0)), 0) as tax_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as tips_etb'),
                db().raw('COALESCE(SUM(COALESCE(o.total, 0)), 0) as total_collected_etb'),
                db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as net_sales_etb'),
            ])
            .groupBy(['report_date', 'o.branch_id'])
            .orderBy([{ column: db().raw('report_date'), order: 'asc' }, { column: 'o.branch_id', order: 'asc' }]);
    }

    let itemsQ = db()
        .from({ oi: 'order_items' })
        .innerJoin({ o: 'orders' }, function () {
            this.on('o.id', '=', 'oi.order_id')
                .andOn('o.tenant_id', '=', 'oi.tenant_id')
                .andOn('o.branch_id', '=', 'oi.branch_id');
        })
        .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
        });

    if (branchId) itemsQ = itemsQ.andWhere({ 'o.branch_id': branchId });

    let itemAgg;
    if (isRangeMode) {
        const [row] = await itemsQ
            .select([
                db().raw('COALESCE(SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))), 0) as item_count'),
            ]);
        itemAgg = row ? [row] : [];
    } else {
        itemAgg = await itemsQ
            .select([
                db().raw('DATE(o.paid_at) as report_date'),
                'o.branch_id',
                db().raw('COALESCE(SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))), 0) as item_count'),
            ])
            .groupBy(['report_date', 'o.branch_id']);
    }

    const itemCountByKey = new Map();
    for (const r of itemAgg) {
        if (isRangeMode) {
            itemCountByKey.set('range', Number(r.item_count || 0) || 0);
        } else {
            const d = r.report_date ? String(r.report_date).slice(0, 10) : '';
            const b = String(r.branch_id || '');
            const key = `${d}|${b}`;
            itemCountByKey.set(key, Number(r.item_count || 0) || 0);
        }
    }

    let paymentQ = db()
        .from({ o: 'orders' })
        .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
        })
        .select([
            db().raw('DATE(o.paid_at) as report_date'),
            'o.branch_id',
            'o.total',
            'o.payload',
        ]);
    if (branchId) paymentQ = paymentQ.andWhere({ 'o.branch_id': branchId });

    const paymentRows = await paymentQ;
    const paymentByKey = new Map();
    for (const r of paymentRows) {
        const d = r.report_date ? String(r.report_date).slice(0, 10) : '';
        const b = String(r.branch_id || '');
        const key = isRangeMode ? 'range' : `${d}|${b}`;
        const total = Number(r.total || 0) || 0;
        const payload = safeJsonParse(r.payload, {});
        const pmKey = normalizePaymentKey(payload?.paymentMethod || payload?.method || payload?.tender);

        const cur = paymentByKey.get(key) || {};
        cur[pmKey] = (cur[pmKey] || 0) + total;
        paymentByKey.set(key, cur);
    }

    return orderAgg.map((r, idx) => {
        const date = isRangeMode ? `${fromDate} to ${toDate}` : (r.report_date ? String(r.report_date).slice(0, 10) : '');
        const bid = isRangeMode ? (branchId || 'all') : String(r.branch_id || '');
        const key = isRangeMode ? 'range' : `${date}|${bid}`;

        const orderCount = Number(r.order_count || 0) || 0;
        const discounts = Number(r.discounts_etb || 0) || 0;
        const netSales = Number(r.net_sales_etb || 0) || 0;
        const tax = Number(r.tax_etb || 0) || 0;
        const tips = Number(r.tips_etb || 0) || 0;
        const totalCollected = Number(r.total_collected_etb || 0) || 0;

        const grossSales = netSales + discounts;
        const avgTicket = orderCount > 0 ? netSales / orderCount : 0;

        return {
            date,
            branchId: bid,
            orderCount,
            itemCount: itemCountByKey.get(key) || 0,
            grossSales,
            discounts,
            netSales,
            tax,
            tips,
            totalCollected,
            paymentBreakdown: paymentByKey.get(key) || {},
            avgTicket: Math.round(avgTicket * 100) / 100,
            computedAt: null,
        };
    });
};

const getHourlySalesHeatmap = async ({ tenantId, branchId, fromDate, toDate }) => {
    const q = db()
        .from('hourly_sales_summary')
        .where({ tenant_id: tenantId })
        .andWhere('report_date', '>=', fromDate)
        .andWhere('report_date', '<=', toDate)
        .select([
            'hour',
            db().raw('SUM(order_count) as order_count'),
            db().raw('SUM(total_collected_etb) as total_collected_etb'),
        ])
        .groupBy(['hour'])
        .orderBy('hour', 'asc');

    if (branchId) q.andWhere({ branch_id: branchId });

    const rows = await q;
    return rows.map((r) => {
        const hour = Number(r.hour || 0) || 0;
        const sales = Number(r.total_collected_etb || 0) || 0;
        const orderCount = Number(r.order_count || 0) || 0;
        const label = `${String(hour).padStart(2, '0')}:00`;
        return {
            hour,
            label,
            orderCount,
            sales,
            avgSales: orderCount > 0 ? Math.round((sales / orderCount) * 100) / 100 : 0,
        };
    });
};

const getProductPerformance = async ({ tenantId, branchId, fromDate, toDate, limit }) => {
    const fromDt = `${fromDate} 00:00:00`;
    const toDt = `${toDate} 23:59:59`;
    const fromIso = `${fromDate}T00:00:00.000Z`;
    const toIso = `${toDate}T23:59:59.999Z`;

    let q = db()
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
        .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
        .andWhere((qb) => {
            qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
        });

    if (branchId) q = q.andWhere({ 'o.branch_id': branchId });

    const baseRows = await q
        .select([
            db().raw("COALESCE(NULLIF(TRIM(oi.product_id), ''), NULLIF(TRIM(oi.product_code), ''), TRIM(oi.name)) as product_id"),
            db().raw("COALESCE(NULLIF(TRIM(p.name), ''), TRIM(oi.name)) as product_name"),
            db().raw("COALESCE(NULLIF(TRIM(p.category), ''), NULLIF(TRIM(oi.product_code), ''), '') as category"),
            db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))) as qty_sold'),
            db().raw('SUM(GREATEST(0, COALESCE(oi.voided_qty, 0))) as void_qty'),
            db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue_etb'),
        ])
        .groupBy(['product_id', 'product_name', 'category'])
        .orderBy(db().raw('SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0))'), 'desc')
        .limit(Math.max(1, Math.min(5000, Number(limit || 100) || 100)));

    const rows = baseRows.map((r) => ({
        productId: String(r.product_id || '').trim(),
        name: String(r.product_name || r.product_id || '').trim(),
        category: String(r.category || 'Uncategorized').trim() || 'Uncategorized',
        qtySold: Number(r.qty_sold || 0) || 0,
        revenue: Number(r.revenue_etb || 0) || 0,
        cost: 0,
        profit: 0,
        voidQty: Number(r.void_qty || 0) || 0,
    }));

    const recipeIds = rows.map((r) => r.productId).filter(Boolean);
    if (recipeIds.length) {
        try {
            let recipeQuery = db().from('menu_recipes').where({ tenant_id: tenantId });
            if (branchId) recipeQuery = recipeQuery.andWhere({ branch_id: branchId });
            const recipeRows = await recipeQuery.whereIn('product_id', recipeIds).select(['product_id', 'recipe_json']);

            const unitCostByProductId = new Map();
            for (const rr of recipeRows) {
                const pid = String(rr.product_id || '').trim();
                if (!pid) continue;
                const recipe = safeJsonParse(rr.recipe_json, {});
                const unitCost = Number(recipe?.totalCost ?? 0) || 0;
                if (unitCost > 0) unitCostByProductId.set(pid, unitCost);
            }

            for (const r of rows) {
                const unitCost = Number(unitCostByProductId.get(r.productId) || 0) || 0;
                if (unitCost <= 0) continue;
                r.cost = Math.max(0, r.qtySold) * unitCost;
                r.profit = r.revenue - r.cost;
            }
        } catch {
            // ignore
        }
    }

    return rows;
};

const getStaffSalesSummary = async ({ tenantId, branchId, fromDate, toDate, limit }) => {
    let query = db()
        .from('staff_sales_summary')
        .where({ tenant_id: tenantId })
        .andWhere('report_date', '>=', fromDate)
        .andWhere('report_date', '<=', toDate)
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

    if (branchId) query = query.andWhere({ branch_id: branchId });

    const rows = await query
        .groupBy(['staff_id', 'staff_name'])
        .orderBy(db().raw('SUM(net_sales_etb)'), 'desc')
        .limit(Math.max(1, Math.min(5000, Number(limit || 100) || 100)));

    return rows.map((r) => ({
        staffId: String(r.staff_id || ''),
        staffName: String(r.staff_name || ''),
        orderCount: Number(r.order_count || 0) || 0,
        netSales: Number(r.net_sales_etb || 0) || 0,
        grossSales: Number(r.gross_sales_etb || 0) || 0,
        discounts: Number(r.discounts_etb || 0) || 0,
        tax: Number(r.tax_etb || 0) || 0,
        tips: Number(r.tips_etb || 0) || 0,
        totalCollected: Number(r.total_collected_etb || 0) || 0,
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
        'staff_sales_summary',
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
    aggregateStaffSales,
    ensureAggregatedForRange,
    getDailySalesSummary,
    getProductPerformance,
    getStaffSalesSummary,
    getHourlySalesHeatmap,
    buildShiftReport,
    runDailyAggregation,
    cleanupOldReports,
    getOrderStatusSummary,
};
