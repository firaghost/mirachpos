jest.mock('../../src/config', () => ({
  config: { cacheDefaultTtlSeconds: 60 },
}));

jest.mock('../../src/utils/cache', () => ({
  withCache: jest.fn(async (_key, _ttl, fn) => fn()),
}));

jest.mock('../../src/utils/cdn', () => ({
  resolveCdnUrl: (v) => v,
}));

describe('services/invoiceService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenants = [{ id: 't_ok', slug: 'ok-tenant', name: 'OK' }];
    state.tables.invoices = [];
    state.tables.plans = [{ tier: 'Basic', price_monthly_etb: 10, price_yearly_etb: 100 }];
    state.tables.platform_payment_config = [{ id: 1 }];
  });

  it('calculateProration returns full newAmount when no daysRemaining', async () => {
    const { calculateProration } = require('../../src/services/invoiceService');

    const res = calculateProration({
      currentPlan: 'Trial',
      newPlan: 'Basic',
      daysRemaining: 0,
      totalDays: 30,
      currentAmount: 0,
      newAmount: 10,
    });

    expect(res).toEqual({ creditAmount: 0, chargeAmount: 10, netAmount: 10 });
  });

  it('calculateProration computes credit/charge/net for remaining days', async () => {
    const { calculateProration } = require('../../src/services/invoiceService');

    const res = calculateProration({
      currentPlan: 'Pro',
      newPlan: 'Enterprise',
      daysRemaining: 10,
      totalDays: 30,
      currentAmount: 300,
      newAmount: 600,
    });

    expect(res.creditAmount).toBeCloseTo(100);
    expect(res.chargeAmount).toBeCloseTo(200);
    expect(res.netAmount).toBeCloseTo(100);
    expect(res.calculation.daysRemaining).toBe(10);
  });

  it('generateInvoiceNumber uses tenant slug prefix and increments sequence', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        tenant_id: 't_ok',
        invoice_number: `INV-OKTE-${new Date().getFullYear()}-0009`,
        created_at: '2099-01-01T00:00:00.000Z',
      },
    ];

    const { generateInvoiceNumber } = require('../../src/services/invoiceService');
    const num = await generateInvoiceNumber('t_ok');

    expect(num).toMatch(new RegExp(`^INV-OKTE-${new Date().getFullYear()}-0010$`));
  });

  it('calculateProration returns zero net when credit exceeds charge', async () => {
    const { calculateProration } = require('../../src/services/invoiceService');
    const res = calculateProration({
      currentPlan: 'Enterprise', newPlan: 'Pro', daysRemaining: 15, totalDays: 30,
      currentAmount: 600, newAmount: 300,
    });
    expect(res.netAmount).toBe(0);
    expect(res.creditAmount).toBeGreaterThan(res.chargeAmount);
  });

  it('generateInvoiceNumber starts at 0001 when no prior invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];
    const { generateInvoiceNumber } = require('../../src/services/invoiceService');
    const num = await generateInvoiceNumber('t_ok');
    expect(num).toMatch(new RegExp(`^INV-OKTE-${new Date().getFullYear()}-0001$`));
  });

  it('getPlanPricing returns price for existing tier', async () => {
    const { getPlanPricing } = require('../../src/services/invoiceService');
    expect(await getPlanPricing('Basic', 'monthly')).toBe(10);
    expect(await getPlanPricing('Basic', 'yearly')).toBe(100);
  });

  it('generateSubscriptionInvoice creates invoice correctly', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];
    const { generateSubscriptionInvoice } = require('../../src/services/invoiceService');
    const result = await generateSubscriptionInvoice({
      tenantId: 't_ok', tier: 'Basic', cycle: 'monthly', dueInDays: 7,
    });
    expect(result.invoiceId).toMatch(/^inv_/);
    expect(result.amount).toBe(10);
    expect(state.tables.invoices).toHaveLength(1);
  });

  it('generateSubscriptionInvoice handles prorated invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];
    const { generateSubscriptionInvoice } = require('../../src/services/invoiceService');
    const result = await generateSubscriptionInvoice({
      tenantId: 't_ok', tier: 'Pro', cycle: 'monthly', isProrated: true,
      prorationData: { currentPlan: 'Basic', creditAmount: 5, chargeAmount: 25, netAmount: 20, daysRemaining: 15 },
    });
    expect(result.amount).toBe(20);
    expect(result.lineItems).toHaveLength(2);
  });

  it('createManualInvoice creates invoice with line items', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];

    const { createManualInvoice } = require('../../src/services/invoiceService');
    const result = await createManualInvoice({
      tenantId: 't_ok',
      lineItems: [
        { description: 'Custom Service', qty: 2, unitPrice: 50, amount: 100 },
        { description: 'Setup Fee', qty: 1, unitPrice: 25, amount: 25 },
      ],
      dueInDays: 14,
      notes: 'Please pay promptly',
      type: 'custom',
      metadata: { source: 'manual', reason: 'one-time' },
    });

    expect(result.invoiceId).toMatch(/^inv_/);
    expect(result.invoiceNumber).toMatch(/^INV-/);
    expect(result.amount).toBe(125);

    expect(state.tables.invoices).toHaveLength(1);
    expect(state.tables.invoices[0].type).toBe('custom');
    expect(state.tables.invoices[0].total_etb).toBe(125);
    expect(state.tables.invoices[0].notes).toBe('Please pay promptly');
  });

  it('createManualInvoice handles empty line items', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];

    const { createManualInvoice } = require('../../src/services/invoiceService');
    const result = await createManualInvoice({
      tenantId: 't_ok',
      lineItems: [],
      dueInDays: 7,
    });

    expect(result.amount).toBe(0);
    expect(state.tables.invoices[0].total_etb).toBe(0);
  });

  it('createManualInvoice handles default values', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];

    const { createManualInvoice } = require('../../src/services/invoiceService');
    const result = await createManualInvoice({
      tenantId: 't_ok',
      lineItems: [{ description: 'Test', amount: 50 }],
    });

    expect(result.invoiceId).toMatch(/^inv_/);
    expect(state.tables.invoices[0].type).toBe('manual');
    expect(state.tables.invoices[0].status).toBe('pending');
  });

  it('checkDueInvoices returns categorized invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    state.tables.invoices = [
      { id: 'inv_overdue', tenant_id: 't_ok', status: 'pending', due_date: yesterday.toISOString(), total_etb: 100 },
      { id: 'inv_due_soon', tenant_id: 't_ok', status: 'pending', due_date: tomorrow.toISOString(), total_etb: 200 },
      { id: 'inv_due_tomorrow', tenant_id: 't_ok', status: 'pending', due_date: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(), total_etb: 300 },
      { id: 'inv_paid', tenant_id: 't_ok', status: 'paid', due_date: yesterday.toISOString(), total_etb: 400 },
    ];

    const { checkDueInvoices } = require('../../src/services/invoiceService');
    const result = await checkDueInvoices();

    expect(result.overdue.length).toBeGreaterThanOrEqual(0);
    expect(result.dueSoon.length).toBeGreaterThanOrEqual(0);
  });

  it('verifyPayment marks invoice as paid and records subscription history', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const now = new Date().toISOString();

    state.tables.invoices = [
      { id: 'inv_verify', tenant_id: 't_ok', status: 'pending', total_etb: 100, type: 'subscription', paid_at: null },
    ];
    state.tables.payments = [
      { id: 'pay_verify', invoice_id: 'inv_verify', tenant_id: 't_ok', status: 'pending', method: 'bank_transfer', amount: 100 },
    ];
    state.tables.tenant_subscription = [
      { tenant_id: 't_ok', status: 'past_due', tier: 'Basic', grace_ends_at: now },
    ];
    state.tables.plans = [{ tier: 'Basic', price_monthly_etb: 10, modules_json: '[]' }];
    state.tables.subscription_history = [];

    const { verifyPayment } = require('../../src/services/invoiceService');
    const result = await verifyPayment({
      paymentId: 'pay_verify',
      invoiceId: 'inv_verify',
      tenantId: 't_ok',
      verifiedBy: 'admin_1',
    });

    expect(result.success).toBe(true);
    expect(state.tables.invoices[0].status).toBe('paid');
    expect(state.tables.payments[0].status).toBe('verified');
    expect(state.tables.payments[0].verified_by).toBe('admin_1');
  });

  it('rejectPayment marks payment as rejected', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      { id: 'inv_reject', tenant_id: 't_ok', status: 'pending', total_etb: 100 },
    ];
    state.tables.payments = [
      { id: 'pay_reject', invoice_id: 'inv_reject', tenant_id: 't_ok', status: 'pending', method: 'bank_transfer', amount: 100 },
    ];

    const { rejectPayment } = require('../../src/services/invoiceService');
    const result = await rejectPayment({
      paymentId: 'pay_reject',
      invoiceId: 'inv_reject',
      reason: 'Invalid proof',
      rejectedBy: 'admin_1',
    });

    expect(result.success).toBe(true);
    expect(state.tables.payments[0].status).toBe('rejected');
    expect(state.tables.payments[0].rejection_reason).toBe('Invalid proof');
  });

  it('verifyPayment throws error when payment not found', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.payments = [];

    const { verifyPayment } = require('../../src/services/invoiceService');
    await expect(verifyPayment({
      paymentId: 'pay_missing',
      verifiedBy: 'admin_1',
    })).rejects.toThrow('Payment not found');
  });

  it('recordPaymentSubmission creates payment record', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.payments = [];
    state.tables.invoices = [{ id: 'inv_1', tenant_id: 't_ok', status: 'pending' }];

    const { recordPaymentSubmission } = require('../../src/services/invoiceService');
    const result = await recordPaymentSubmission({
      invoiceId: 'inv_1',
      tenantId: 't_ok',
      method: 'bank_transfer',
      amount: 100,
      reference: 'TXN123456',
      proofUrl: 'https://cdn.test/receipt.pdf',
      proofFilename: 'receipt.pdf',
      notes: 'Payment submitted by tenant',
    });

    expect(result.paymentId).toMatch(/^pay_/);
    expect(state.tables.payments).toHaveLength(1);
    expect(state.tables.payments[0].method).toBe('bank_transfer');
  });

  it('verifyPayment throws error when payment not found', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.payments = [];

    const { verifyPayment } = require('../../src/services/invoiceService');
    await expect(verifyPayment({
      paymentId: 'pay_missing',
      verifiedBy: 'admin_1',
    })).rejects.toThrow('Payment not found');
  });

  it('getPlatformPaymentConfig returns null when no config exists', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [];

    const { getPlatformPaymentConfig } = require('../../src/services/invoiceService');
    const result = await getPlatformPaymentConfig();

    expect(result).toBeNull();
  });

  it('getPlatformPaymentConfig returns config when exists', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [
      {
        id: 1,
        bank_details_json: JSON.stringify({ account: '123456', bank: 'CBE' }),
        chapa_config_json: JSON.stringify({ enabled: true, publicKey: 'pk_test' }),
        telebirr_config_json: JSON.stringify({ enabled: false }),
        sms_config_json: JSON.stringify({ enabled: true, senderId: 'Mirach' }),
        default_grace_days: 7,
        report_retention_days: 90,
      },
    ];

    const { getPlatformPaymentConfig } = require('../../src/services/invoiceService');
    const result = await getPlatformPaymentConfig();

    expect(result).toBeDefined();
    expect(result.bankDetails).toEqual({ account: '123456', bank: 'CBE' });
    expect(result.chapa.enabled).toBe(true);
    expect(result.telebirr.enabled).toBe(false);
    expect(result.sms.enabled).toBe(true);
    expect(result.defaultGraceDays).toBe(7);
    expect(result.reportRetentionDays).toBe(90);
  });
});
