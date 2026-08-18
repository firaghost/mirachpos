const {
  calculateExpectedCash,
  validateShiftClose,
} = require('../../src/services/shiftService');

describe('services/shiftService - Cash Drawer Reconciliation', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.shifts = [];
    state.tables.orders = [];
    state.tables.order_payments = [];
  });

  it('correctly isolates cash tips from electronic tips in Cash Drawer Reconciliation', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const shiftId = 'shift_test_123';

    // 1. Shift opened with ETB 500 float
    state.tables.shifts = [
      {
        id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        shift_type: 'DAY',
        status: 'OPEN',
        opening_cash_etb: 500,
        order_count: 3,
      },
    ];

    // 2. Orders with mixed payment methods:
    // Order 1: Cash payment 800 (product 700 + cash tip 100)
    // Order 2: Telebirr payment 2700 (product 1700 + telebirr tip 1000)
    // Order 3: Card payment 1500 (product 1400 + card tip 100)
    state.tables.orders = [
      {
        id: 'ord_1',
        shift_id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        status: 'Paid',
        payment_method: 'Cash',
        total: 800,
        tax: 0,
        tip: 100,
        discount: 0,
        takeaway_fee: 0,
        created_by_staff_id: 'st_waiter',
        created_by_name: 'Eyerus',
      },
      {
        id: 'ord_2',
        shift_id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        status: 'Paid',
        payment_method: 'Telebirr',
        total: 2700,
        tax: 0,
        tip: 1000,
        discount: 0,
        takeaway_fee: 0,
        created_by_staff_id: 'st_waiter',
        created_by_name: 'Eyerus',
      },
      {
        id: 'ord_3',
        shift_id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        status: 'Paid',
        payment_method: 'Card',
        total: 1500,
        tax: 0,
        tip: 100,
        discount: 0,
        takeaway_fee: 0,
        created_by_staff_id: 'st_waiter',
        created_by_name: 'Eyerus',
      },
    ];

    state.tables.order_payments = [
      { id: 'pm_1', shift_id: shiftId, order_id: 'ord_1', method: 'Cash', amount: 800 },
      { id: 'pm_2', shift_id: shiftId, order_id: 'ord_2', method: 'Telebirr', amount: 2700 },
      { id: 'pm_3', shift_id: shiftId, order_id: 'ord_3', method: 'Card', amount: 1500 },
    ];

    // calculateExpectedCash should be:
    // Opening Float (500) + Cash Collected (800) - Cash Tips Paid Out (100) = 1,200
    // (Telebirr 1000 tip and Card 100 tip are ignored for cash drawer)
    const expectedCash = await calculateExpectedCash({ shiftId });
    expect(expectedCash).toBe(1200);

    // validateShiftClose preview checks
    const preview = await validateShiftClose({ shiftId });
    expect(preview.canClose).toBe(true);
    expect(preview.expectedCash).toBe(1200);

    // Cash Drawer Reconciliation breakdowns
    expect(preview.breakdowns.openingCash).toBe(500);
    expect(preview.breakdowns.cashReceived).toBe(800);
    expect(preview.breakdowns.cashTips).toBe(100);
    expect(preview.breakdowns.expectedCash).toBe(1200);

    // Overall summary and other sheets must retain TOTAL tips (100 + 1000 + 100 = 1200)
    expect(preview.breakdowns.summary.totalTips).toBe(1200);
    expect(preview.breakdowns.summary.totalCollection).toBe(5000);
    expect(preview.breakdowns.staffTips[0].staffId).toBe('st_waiter');
    expect(preview.breakdowns.staffTips[0].staffName).toBe('Eyerus');
    expect(preview.breakdowns.staffTips[0].totalTips).toBe(1200);
  });

  it('correctly aggregates Cash Collected including takeaway fee but still nets out tip correctly', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const shiftId = 'shift_test_456';

    state.tables.shifts = [
      {
        id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        shift_type: 'DAY',
        status: 'OPEN',
        opening_cash_etb: 100,
        order_count: 1,
      },
    ];

    // Order 1: Cash payment 500 (product 400 + takeaway fee 50 + cash tip 50)
    state.tables.orders = [
      {
        id: 'ord_1',
        shift_id: shiftId,
        tenant_id: 't_test',
        branch_id: 'b_main',
        status: 'Paid',
        payment_method: 'Cash',
        total: 500,
        tax: 0,
        tip: 50,
        discount: 0,
        takeaway_fee: 50,
        created_by_staff_id: 'st_waiter',
        created_by_name: 'Eyerus',
      }
    ];

    state.tables.order_payments = [
      { id: 'pm_1', shift_id: shiftId, order_id: 'ord_1', method: 'Cash', amount: 500 }
    ];

    // calculateExpectedCash:
    // Opening Float (100) + Cash Collected (500) - Cash Tips Paid Out (50) = 550
    const expectedCash = await calculateExpectedCash({ shiftId });
    expect(expectedCash).toBe(550);

    const preview = await validateShiftClose({ shiftId });
    expect(preview.canClose).toBe(true);
    expect(preview.expectedCash).toBe(550);

    // Cash Drawer Reconciliation breakdowns
    expect(preview.breakdowns.openingCash).toBe(100);
    expect(preview.breakdowns.cashReceived).toBe(500); // 400 product + 50 takeaway + 50 tip
    expect(preview.breakdowns.cashTips).toBe(50);
    expect(preview.breakdowns.expectedCash).toBe(550);

    // Payment Breakdown should equal Total Collection without double-counting takeaway fee
    expect(preview.breakdowns.paymentBreakdown.cash).toBe(500);
    expect(preview.breakdowns.summary.totalCollection).toBe(500);
  });
});
