const {
  getOrderStatusSummary,
  ensureAggregatedForRange,
  getDailySalesSummary,
  getHourlySalesHeatmap,
  getProductPerformance,
  aggregateProductSales,
  aggregateDailySales,
  aggregateStaffSales,
  aggregateHourlySales,
  aggregateCategorySales,
  getStaffSalesSummary,
  buildShiftReport,
  runDailyAggregation,
  cleanupOldReports,
} = require('../../src/services/reportAggregationService');

jest.mock('../../src/utils/cache', () => ({
  invalidateOwnerReports: jest.fn(async () => {}),
}));

describe('services/reportAggregationService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.orders = [];
    state.tables.void_refund_log = [];

    state.tables.daily_sales_summary = [];
    state.tables.hourly_sales_summary = [];
    state.tables.product_sales_summary = [];
    state.tables.category_sales_summary = [];
    state.tables.staff_sales_summary = [];

    state.tables.order_items = [];
    state.tables.hourly_sales_summary = [];

    state.tables.shift_reports = [];
    state.tables.menu_recipes = [];

    state.tables.category_sales_summary = [];
  });

  it('getOrderStatusSummary returns invalid_range for bad date input', async () => {
    const res = await getOrderStatusSummary({ tenantId: 't_test', fromDate: 'x', toDate: 'y' });
    expect(res).toEqual({ ok: false, error: 'invalid_range' });
  });

  it('getOrderStatusSummary aggregates paid totals, byStatus, nonPaid and void/refund', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const from = '2026-02-01';
    const to = '2026-02-02';

    state.tables.orders = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        total: 100,
                created_at: `${from} 09:00:00`,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        total: 50,
                created_at: `${to}T11:00:00.000Z`,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Pending',
        total: 0,
        created_at: `${to} 13:00:00`,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Voided',
        total: 0,
        created_at: `${to} 14:00:00`,
      },
    ];

    state.tables.void_refund_log = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        type: 'void',
        amount_etb: 10,
        occurred_at: `${from} 12:00:00`,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        type: 'refund',
        amount_etb: 5,
        occurred_at: `${to}T15:00:00.000Z`,
      },
    ];

    const res = await getOrderStatusSummary({
      tenantId: 't_test',
      branchId: 'b_1',
      fromDate: from,
      toDate: to,
    });

    expect(res.ok).toBe(true);
    expect(res.from).toBe(from);
    expect(res.to).toBe(to);

    expect(res.paid).toEqual({ count: 2, totalCollected: 150 });
    expect(res.byStatus).toEqual({ Paid: 2, Pending: 1, Voided: 1 });
    expect(res.nonPaid).toEqual({ count: 1 });

    expect(res.voidRefund.void).toEqual({ count: 1, amount: 10 });
    expect(res.voidRefund.refund).toEqual({ count: 1, amount: 5 });
  });

  it('cleanupOldReports deletes old records across summary tables', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.daily_sales_summary = [
      { report_date: '2025-01-01' },
      { report_date: '2099-01-01' },
    ];

    state.tables.hourly_sales_summary = [{ report_date: '2025-01-01' }];
    state.tables.product_sales_summary = [{ report_date: '2025-01-01' }];
    state.tables.category_sales_summary = [{ report_date: '2025-01-01' }];
    state.tables.staff_sales_summary = [{ report_date: '2025-01-01' }];

    const res = await cleanupOldReports({ daysToKeep: 1 });

    expect(res.deleted).toBeGreaterThan(0);
    expect(res.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getDailySalesSummary returns daily rows with computed totals and payment breakdown', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const from = '2026-02-01';
    const to = '2026-02-02';

    state.tables.orders = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: `${from} 10:00:00`,
        report_date: from,
        order_count: 2,
        discounts_etb: 10,
        net_sales_etb: 90,
        tax_etb: 5,
        tips_etb: 0,
        total_collected_etb: 95,
        total: 50,
        payload: JSON.stringify({ paymentMethod: 'Cash' }),
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: `${to}T10:00:00.000Z`,
        report_date: to,
        order_count: 1,
        discounts_etb: 0,
        net_sales_etb: 100,
        tax_etb: 0,
        tips_etb: 0,
        total_collected_etb: 100,
        total: 100,
        payload: JSON.stringify({ method: 'Card Payment' }),
      },
    ];

    state.tables.order_items = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: `${from} 10:00:00`,
        report_date: from,
        item_count: 5,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: `${to}T10:00:00.000Z`,
        report_date: to,
        item_count: 2,
      },
    ];

    const rows = await getDailySalesSummary({
      tenantId: 't_test',
      branchId: 'b_1',
      fromDate: from,
      toDate: to,
      mode: 'daily',
    });

    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      date: from,
      branchId: 'b_1',
      orderCount: 2,
      itemCount: 5,
      grossSales: 100,
      discounts: 10,
      netSales: 90,
      totalCollected: 95,
      avgTicket: 45,
    });
    expect(rows[0].paymentBreakdown).toEqual({ cash: 50 });

    expect(rows[1].paymentBreakdown).toEqual({ card_payment: 100 });
  });

  it('getDailySalesSummary supports range mode and normalizes payment method key', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const from = '2026-02-01';
    const to = '2026-02-02';

    state.tables.orders = [
      {
        tenant_id: 't_test',
        status: 'Paid',
        created_at: `${from} 10:00:00`,
        order_count: 3,
        discounts_etb: 0,
        net_sales_etb: 300,
        tax_etb: 0,
        tips_etb: 0,
        total_collected_etb: 300,
        total: 300,
        payload: JSON.stringify({ tender: 'Bank Transfer' }),
      },
    ];

    state.tables.order_items = [
      {
        tenant_id: 't_test',
        status: 'Paid',
        created_at: `${from} 10:00:00`,
        item_count: 7,
      },
    ];

    const rows = await getDailySalesSummary({
      tenantId: 't_test',
      fromDate: from,
      toDate: to,
      mode: 'range',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(`${from} to ${to}`);
    expect(rows[0].branchId).toBe('all');
    expect(rows[0].orderCount).toBe(3);
    expect(rows[0].itemCount).toBe(7);
    expect(rows[0].avgTicket).toBe(100);
    expect(rows[0].paymentBreakdown).toEqual({ bank_transfer: 300 });
  });

  it('getHourlySalesHeatmap maps rows and applies branch filter', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.hourly_sales_summary = [
      { tenant_id: 't_test', branch_id: 'b_1', report_date: '2026-02-01', hour: 9, order_count: 2, total_collected_etb: 100 },
      { tenant_id: 't_test', branch_id: 'b_2', report_date: '2026-02-01', hour: 9, order_count: 1, total_collected_etb: 50 },
    ];

    const rows = await getHourlySalesHeatmap({ tenantId: 't_test', branchId: 'b_1', fromDate: '2026-02-01', toDate: '2026-02-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ hour: 9, label: '09:00', orderCount: 2, sales: 100, avgSales: 50 });
  });

  it('ensureAggregatedForRange returns invalid_range when date range is invalid', async () => {
    const res = await ensureAggregatedForRange({ tenantId: 't_test', fromDate: 'x', toDate: 'y' });
    expect(res).toEqual({ ok: false, error: 'invalid_range' });
  });

  it('ensureAggregatedForRange returns ok with processed=0 when no branches found and no branchId is provided', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.orders = [];

    const res = await ensureAggregatedForRange({ tenantId: 't_test', fromDate: '2026-02-01', toDate: '2026-02-01' });
    expect(res.ok).toBe(true);
    expect(res.processed).toBe(0);
    expect(res.errors).toBe(0);
  });

  it('ensureAggregatedForRange runs aggregation when branchId is provided', async () => {
    const res = await ensureAggregatedForRange({ tenantId: 't_test', branchId: 'b_1', fromDate: '2026-02-01', toDate: '2026-02-02' });
    expect(res.ok).toBe(true);
    expect(res.processed).toBeGreaterThan(0);
    expect(res.errors).toBe(0);
  });

  it('getProductPerformance returns products with cost/profit when recipes provide unit cost', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    // Our Jest DB mock doesn't execute joins/aggregations; seed rows in the shape the service expects post-aggregation.
    state.tables.order_items = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',

        product_id: 'p1',
        product_name: 'Coffee',
        category: 'Drinks',
        qty_sold: 2,
        void_qty: 0,
        revenue_etb: 20,
      },
    ];
    state.tables.menu_recipes = [
      { tenant_id: 't_test', branch_id: 'b_1', product_id: 'p1', recipe_json: JSON.stringify({ totalCost: 3 }) },
    ];

    const rows = await getProductPerformance({
      tenantId: 't_test',
      branchId: 'b_1',
      fromDate: '2026-02-01',
      toDate: '2026-02-01',
      limit: 50,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      productId: 'p1',
      name: 'Coffee',
      category: 'Drinks',
      qtySold: 2,
      revenue: 20,
      cost: 6,
      profit: 14,
      voidQty: 0,
    });
  });

  it('getProductPerformance keeps cost/profit at 0 when no recipes exist', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.order_items = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        product_id: 'p2',
        product_name: 'Tea',
        category: '',
        qty_sold: 1,
        void_qty: 0,
        revenue_etb: 5,
      },
    ];
    state.tables.menu_recipes = [];

    const rows = await getProductPerformance({ tenantId: 't_test', branchId: 'b_1', fromDate: '2026-02-01', toDate: '2026-02-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(0);
    expect(rows[0].profit).toBe(0);
    expect(rows[0].category).toBe('Uncategorized');
  });

  it('getProductPerformance ignores invalid recipe JSON', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.order_items = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        product_id: 'p3',
        product_name: 'Cake',
        category: 'Dessert',
        qty_sold: 2,
        void_qty: 0,
        revenue_etb: 20,
      },
    ];
    state.tables.menu_recipes = [
      { tenant_id: 't_test', branch_id: 'b_1', product_id: 'p3', recipe_json: '{not-json' },
    ];

    const rows = await getProductPerformance({ tenantId: 't_test', branchId: 'b_1', fromDate: '2026-02-01', toDate: '2026-02-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(0);
    expect(rows[0].profit).toBe(0);
  });

  it('aggregateProductSales upserts product summaries from pre-aggregated order_items rows and applies recipe unit cost', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.order_items = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        product_key: 'p1',
        product_name: 'Coffee',
        category: 'Drinks',
        qty_sold: 2,
        void_qty: 0,
        revenue_etb: 20,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:05:00',
        product_key: 'p2',
        product_name: 'Tea',
        category: '',
        qty_sold: 1,
        void_qty: 0,
        revenue_etb: 5,
      },
    ];

    state.tables.menu_recipes = [
      { tenant_id: 't_test', branch_id: 'b_1', product_id: 'p1', recipe_json: JSON.stringify({ totalCost: 3 }) },
    ];

    const res = await aggregateProductSales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res.productsProcessed).toBe(2);

    const rows = state.tables.product_sales_summary;
    expect(rows).toHaveLength(2);

    const coffee = rows.find((r) => r.product_id === 'p1');
    expect(coffee).toMatchObject({
      tenant_id: 't_test',
      branch_id: 'b_1',
      product_id: 'p1',
      product_name: 'Coffee',
      category: 'Drinks',
      report_date: '2026-02-01',
      qty_sold: 2,
      revenue_etb: 20,
      cost_etb: 6,
      profit_etb: 14,
      void_qty: 0,
    });

    const tea = rows.find((r) => r.product_id === 'p2');
    expect(tea).toMatchObject({
      product_id: 'p2',
      product_name: 'Tea',
      category: '',
      qty_sold: 1,
      revenue_etb: 5,
      cost_etb: 0,
      profit_etb: 5,
    });
  });

  it('aggregateProductSales falls back to order payload items when no order_items rows are available', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.order_items = [];
    state.tables.orders = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        payload: JSON.stringify({
          items: [
            { productId: 'p9', name: 'Cookie', category: 'Snacks', qty: 2, voidedQty: 1, unitPrice: 10 },
          ],
        }),
      },
    ];

    const res = await aggregateProductSales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res.productsProcessed).toBe(1);

    expect(state.tables.product_sales_summary).toHaveLength(1);
    expect(state.tables.product_sales_summary[0]).toMatchObject({
      product_id: 'p9',
      product_name: 'Cookie',
      category: 'Snacks',
      qty_sold: 1,
      revenue_etb: 10,
      void_qty: 1,
    });
  });

  it('aggregateDailySales inserts an empty daily summary when there are no orders', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.orders = [];

    const res = await aggregateDailySales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res).toEqual({ orderCount: 0 });

    expect(state.tables.daily_sales_summary).toHaveLength(1);
    expect(state.tables.daily_sales_summary[0]).toMatchObject({
      tenant_id: 't_test',
      branch_id: 'b_1',
      report_date: '2026-02-01',
      order_count: 0,
      item_count: 0,
      net_sales_etb: 0,
      total_collected_etb: 0,
    });
  });

  it('aggregateDailySales aggregates items, voids and payment breakdown from payload', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.orders = [
      {
        id: 'o1',
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        total: 100,
        tax: 5,
        tip: 0,
        discount: 10,
        created_at: '2026-02-01 10:00:00',
        payload: JSON.stringify({
          paymentMethod: 'Cash',
          items: [
            { qty: 2, voidedQty: 1, unitPrice: 20 },
            { qty: 1, voidedQty: 0, unitPrice: 10 },
          ],
        }),
      },
    ];

    const res = await aggregateDailySales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res.orderCount).toBe(1);
    expect(res.itemCount).toBe(2);

    const row = state.tables.daily_sales_summary[0];
    expect(row.order_count).toBe(1);
    expect(row.item_count).toBe(2);
    expect(row.discounts_etb).toBe(10);
    expect(row.tax_etb).toBe(5);
    expect(row.total_collected_etb).toBe(100);
    expect(row.void_count).toBe(1);
    expect(row.void_amount_etb).toBe(20);

    const pb = JSON.parse(row.payment_breakdown_json);
    expect(pb).toMatchObject({ cash: 100 });
  });

  it('aggregateStaffSales uses tip/tax from payload when db fields are 0 and upserts staff rows', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.orders = [
      {
        id: 'o1',
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        total: 110,
        tax: 0,
        tip: 0,
        discount: 0,
        created_at: '2026-02-01 10:00:00',
        payload: JSON.stringify({
          createdByStaffId: 's1',
          createdByName: 'Alice',
          tip: 5,
          tax: 10,
          tender: 'Card Payment',
        }),
      },
    ];

    const res = await aggregateStaffSales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res).toEqual({ staffCount: 1, orderCount: 1 });

    expect(state.tables.staff_sales_summary).toHaveLength(1);
    const row = state.tables.staff_sales_summary[0];
    expect(row.staff_id).toBe('s1');
    expect(row.staff_name).toBe('Alice');
    expect(row.order_count).toBe(1);
    expect(row.tax_etb).toBe(10);
    expect(row.tips_etb).toBe(5);

    const pb = JSON.parse(row.payment_breakdown_json);
    expect(pb).toMatchObject({ card_payment: 110 });
  });

  it('aggregateHourlySales upserts hourly summaries (mocked rows)', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    // Mock orders with paid_at timestamps that will be parsed by JS
    state.tables.orders = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        total: 100,
        tax: 5,
        tip: 0,
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:30:00',
        total: 50,
        tax: 0,
        tip: 0,
      },
    ];

    const res = await aggregateHourlySales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res.hoursProcessed).toBe(1); // Only hour 10 has data
    // New implementation creates 24 rows (one for each hour)
    expect(state.tables.hourly_sales_summary).toHaveLength(24);
    // Check that hour 10 has the correct aggregated data
    const hour10 = state.tables.hourly_sales_summary.find(h => h.hour === 10);
    expect(hour10).toMatchObject({
      tenant_id: 't_test',
      branch_id: 'b_1',
      report_date: '2026-02-01',
      hour: 10,
      order_count: 2,
      net_sales_etb: 145, // (100-5) + (50-0) = 95 + 50 = 145
      total_collected_etb: 150, // 100 + 50
    });
  });

  it('aggregateCategorySales upserts category summaries from product_sales_summary (mocked rows)', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.product_sales_summary = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        report_date: '2026-02-01',
        category: 'Drinks',
        qty_sold: 3,
        revenue_etb: 30,
        product_count: 2,
      },
    ];

    const res = await aggregateCategorySales({ tenantId: 't_test', branchId: 'b_1', date: '2026-02-01' });
    expect(res.categoriesProcessed).toBe(1);
    expect(state.tables.category_sales_summary).toHaveLength(1);
    expect(state.tables.category_sales_summary[0]).toMatchObject({
      tenant_id: 't_test',
      branch_id: 'b_1',
      category: 'Drinks',
      report_date: '2026-02-01',
      qty_sold: 3,
      revenue_etb: 30,
      order_count: 2,
    });
  });

  it('buildShiftReport returns null when shift is not found', async () => {
    const res = await buildShiftReport({ shiftId: 'missing' });
    expect(res).toBeNull();
  });

  it('buildShiftReport updates shift report totals and expected cash', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.shift_reports = [
      {
        id: 'sh_1',
        tenant_id: 't_test',
        branch_id: 'b_1',
        opened_at: '2026-02-01 08:00:00',
        closed_at: '2026-02-01 12:00:00',
        opening_cash_etb: 50,
      },
    ];
    state.tables.orders = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',

        status: 'Paid',
        created_at: '2026-02-01 09:00:00',
        total: 100,
        tax: 5,
        tip: 0,
        discount: 10,
        payload: JSON.stringify({
          paymentMethod: 'Cash',
          items: [{ qty: 1, voidedQty: 1, unitPrice: 20 }],
        }),
      },
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        status: 'Paid',
        created_at: '2026-02-01 10:00:00',
        total: 50,
        tax: 0,
        tip: 0,
        discount: 0,
        payload: JSON.stringify({ method: 'Card Payment', items: [] }),
      },
    ];

    const res = await buildShiftReport({ shiftId: 'sh_1' });
    expect(res).toEqual({ orderCount: 2, netSales: 150 });

    expect(state.tables.shift_reports[0].order_count).toBe(2);
    expect(state.tables.shift_reports[0].gross_sales_etb).toBe(160);
    expect(state.tables.shift_reports[0].discounts_etb).toBe(10);
    expect(state.tables.shift_reports[0].net_sales_etb).toBe(150);
    expect(state.tables.shift_reports[0].expected_cash_etb).toBe(150);

    const pb = JSON.parse(state.tables.shift_reports[0].payment_breakdown_json);
    expect(pb).toEqual({ cash: 100, card_payment: 50 });
    expect(state.tables.shift_reports[0].void_count).toBe(1);
    expect(state.tables.shift_reports[0].void_amount_etb).toBe(20);
  });

  it('getStaffSalesSummary maps aggregated rows', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.staff_sales_summary = [
      {
        tenant_id: 't_test',
        branch_id: 'b_1',
        report_date: '2026-02-01',
        staff_id: 's1',
        staff_name: 'Alice',
        order_count: 2,
        net_sales_etb: 90,
        gross_sales_etb: 100,
        discounts_etb: 10,
        tax_etb: 5,
        tips_etb: 0,
        total_collected_etb: 95,
      },
    ];

    const rows = await getStaffSalesSummary({
      tenantId: 't_test',
      branchId: 'b_1',
      fromDate: '2026-02-01',
      toDate: '2026-02-01',
      limit: 100,
    });

    expect(rows).toEqual([
      {
        staffId: 's1',
        staffName: 'Alice',
        orderCount: 2,
        netSales: 90,
        grossSales: 100,
        discounts: 10,
        tax: 5,
        tips: 0,
        totalCollected: 95,
      },
    ]);
  });

  it('runDailyAggregation processes tenant-branch combinations and counts errors', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.orders = [
      { tenant_id: 't_test', branch_id: 'b_1', status: 'Paid', created_at: '2026-02-10 10:00:00' },
      { tenant_id: 't_test', branch_id: 'b_2', status: 'Paid', created_at: '2026-02-10 11:00:00' },
    ];

    const result = await runDailyAggregation(new Date('2026-02-10T00:00:00.000Z'));

    expect(result.date).toBe('2026-02-10');
    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('ensureAggregatedForRange invalidates report caches after successful aggregation', async () => {
    const { invalidateOwnerReports } = require('../../src/utils/cache');
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const from = '2026-02-01';
    const to = '2026-02-01';

    state.tables.orders = [
      {
        tenant_id: 't_inv',
        branch_id: 'b_1',
        status: 'Paid',
        total: 100,
                created_at: `${from} 09:00:00`,
      },
    ];

    await ensureAggregatedForRange({ tenantId: 't_inv', branchId: 'b_1', fromDate: from, toDate: to });

    expect(invalidateOwnerReports).toHaveBeenCalledWith({ tenantId: 't_inv', branchId: 'b_1' });
  });
});
