const mockCreateMailTransporter = jest.fn();
jest.mock('../../src/utils/mail', () => ({ createMailTransporter: (...args) => mockCreateMailTransporter(...args) }));

const mockSendSMS = jest.fn();
jest.mock('../../src/services/smsService', () => ({ sendSMS: (...args) => mockSendSMS(...args) }));

const mockCheckDueInvoices = jest.fn();
jest.mock('../../src/services/invoiceService', () => ({ checkDueInvoices: (...args) => mockCheckDueInvoices(...args) }));

const mockRunDailyAggregation = jest.fn();
const mockCleanupOldReports = jest.fn();
jest.mock('../../src/services/reportAggregationService', () => ({
  runDailyAggregation: (...args) => mockRunDailyAggregation(...args),
  cleanupOldReports: (...args) => mockCleanupOldReports(...args),
}));

const mockPaymentReminderTemplate = jest.fn(() => '<html></html>');
const mockOverdueTemplate = jest.fn(() => '<html></html>');
const mockSuspendedTemplate = jest.fn(() => '<html></html>');
jest.mock('../../src/services/emailTemplates', () => ({
  paymentReminderTemplate: (...args) => mockPaymentReminderTemplate(...args),
  overdueTemplate: (...args) => mockOverdueTemplate(...args),
  suspendedTemplate: (...args) => mockSuspendedTemplate(...args),
}));

const scheduler = require('../../src/services/schedulerService');

describe('services/schedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockRunDailyAggregation.mockResolvedValue({ ok: true });
    mockCleanupOldReports.mockResolvedValue({ deleted: 0, cutoffDate: '' });
    mockCheckDueInvoices.mockResolvedValue({ dueSoon: [], dueTomorrow: [], overdue: [] });
    mockSendSMS.mockResolvedValue({ ok: true });
    mockCreateMailTransporter.mockReturnValue({ sendMail: jest.fn(async () => undefined) });

    global.__MIRACHPOS_DB_MOCK__?.reset?.();
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.platform_payment_config = [
      {
        id: 1,
        sms_config_json: JSON.stringify({ enabled: true, senderId: 'X' }),
      },
    ];
    state.tables.billing_notifications = [];
    state.tables.tenant_payment_prefs = [];
    state.tables.staff = [];
  });

  it('sendNotification(email) records failed when transporter is missing', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    mockCreateMailTransporter.mockReturnValue(null);

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'email',
      recipient: 'a@b.com',
      subject: 'S',
      message: 'M',
    });

    expect(res.status).toBe('failed');
    expect(state.tables.billing_notifications).toHaveLength(1);
    expect(state.tables.billing_notifications[0].status).toBe('failed');
  });

  it('sendNotification(sms) records sent when sms enabled', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'sms',
      recipient: '+251900000000',
      message: 'M',
    });

    expect(res.status).toBe('sent');
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(state.tables.billing_notifications).toHaveLength(1);
    expect(state.tables.billing_notifications[0].status).toBe('sent');
  });

  it('runPaymentReminderJob sends notifications for dueSoon invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_payment_prefs = [
      {
        tenant_id: 't1',
        billing_email: 'a@b.com',
        billing_phone: '+251900000000',
        email_reminders: true,
        sms_reminders: true,
      },
    ];

    mockCheckDueInvoices.mockResolvedValue({
      dueSoon: [{ id: 'inv1', tenant_id: 't1', invoice_number: 'INV-1', total_etb: 10, due_date: new Date().toISOString() }],
      dueTomorrow: [],
      overdue: [],
    });

    const mail = { sendMail: jest.fn(async () => undefined) };
    mockCreateMailTransporter.mockReturnValue(mail);

    await scheduler.runPaymentReminderJob();

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(state.tables.billing_notifications).toHaveLength(2);
    expect(state.tables.billing_notifications.map((n) => n.status)).toEqual(['sent', 'sent']);
  });

  it('runReportAggregationJob runs aggregation and cleanup', async () => {
    mockRunDailyAggregation.mockResolvedValue({ ok: true, date: '2026-01-01', processed: 5 });
    mockCleanupOldReports.mockResolvedValue({ deleted: 10, cutoffDate: '2025-01-01' });

    await scheduler.runReportAggregationJob();

    expect(mockRunDailyAggregation).toHaveBeenCalledTimes(1);
    expect(mockCleanupOldReports).toHaveBeenCalledTimes(1);
  });

  it('runReportAggregationJob handles errors gracefully', async () => {
    mockRunDailyAggregation.mockRejectedValue(new Error('Aggregation failed'));

    await scheduler.runReportAggregationJob();

    expect(mockRunDailyAggregation).toHaveBeenCalledTimes(1);
  });

  it('runGracePeriodExpirationJob suspends tenants when grace period expired', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenant_subscription = [
      { tenant_id: 't1', status: 'past_due', grace_ends_at: pastDate },
    ];
    state.tables.payments = [];

    await scheduler.runGracePeriodExpirationJob();

    expect(state.tables.tenant_subscription[0].status).toBe('suspended');
  });

  it('runGracePeriodExpirationJob skips tenants with pending payments', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenant_subscription = [
      { tenant_id: 't1', status: 'past_due', grace_ends_at: pastDate },
    ];
    state.tables.payments = [{ tenant_id: 't1', status: 'pending' }];

    await scheduler.runGracePeriodExpirationJob();

    expect(state.tables.tenant_subscription[0].status).toBe('past_due');
  });

  it('sendNotification(email) records sent when successful', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const mail = { sendMail: jest.fn(async () => undefined) };
    mockCreateMailTransporter.mockReturnValue(mail);

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'email',
      recipient: 'a@b.com',
      subject: 'Test',
      message: 'Test message',
      html: '<html></html>',
    });

    expect(res.status).toBe('sent');
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(state.tables.billing_notifications[0].status).toBe('sent');
  });

  it('sendNotification(sms) records failed when SMS fails', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    mockSendSMS.mockRejectedValue(new Error('SMS failed'));

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'sms',
      recipient: '+251900000000',
      message: 'M',
    });

    expect(res.status).toBe('failed');
    expect(state.tables.billing_notifications[0].status).toBe('failed');
  });

  it('sendNotification handles missing mail transporter for email', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    mockCreateMailTransporter.mockReturnValue(null);

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'email',
      recipient: 'a@b.com',
      subject: 'Test',
      message: 'M',
    });

    expect(res.status).toBe('failed');
  });

  it('sendNotification handles SMS without SMS config', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.platform_payment_config = [{ id: 1, sms_config_json: JSON.stringify({ enabled: false }) }];

    const res = await scheduler.sendNotification({
      tenantId: 't1',
      invoiceId: 'inv1',
      type: 'reminder_3day',
      channel: 'sms',
      recipient: '+251900000000',
      message: 'M',
    });

    expect(res.status).toBe('failed');
  });

  it('runReportAggregationJob runs aggregation and cleanup', async () => {
    mockRunDailyAggregation.mockResolvedValue({ ok: true, date: '2026-01-01', processed: 5 });
    mockCleanupOldReports.mockResolvedValue({ deleted: 10, cutoffDate: '2025-01-01' });

    await scheduler.runReportAggregationJob();

    expect(mockRunDailyAggregation).toHaveBeenCalledTimes(1);
    expect(mockCleanupOldReports).toHaveBeenCalledTimes(1);
  });

  it('runReportAggregationJob handles errors gracefully', async () => {
    mockRunDailyAggregation.mockRejectedValue(new Error('Aggregation failed'));

    await scheduler.runReportAggregationJob();

    expect(mockRunDailyAggregation).toHaveBeenCalledTimes(1);
  });

  it('runGracePeriodExpirationJob suspends tenants when grace period expired', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenant_subscription = [
      { tenant_id: 't1', status: 'past_due', grace_ends_at: pastDate },
    ];
    state.tables.payments = [];

    await scheduler.runGracePeriodExpirationJob();

    expect(state.tables.tenant_subscription[0].status).toBe('suspended');
  });

  it('runGracePeriodExpirationJob skips tenants with pending payments', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    state.tables.tenant_subscription = [
      { tenant_id: 't1', status: 'past_due', grace_ends_at: pastDate },
    ];
    state.tables.payments = [{ tenant_id: 't1', status: 'pending' }];

    await scheduler.runGracePeriodExpirationJob();

    expect(state.tables.tenant_subscription[0].status).toBe('past_due');
  });
});
