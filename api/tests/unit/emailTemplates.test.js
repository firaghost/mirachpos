jest.unmock('../../src/services/emailTemplates');

describe('services/emailTemplates', () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv };
    process.env.APP_URL = 'https://app.example';
  });

  afterEach(() => {
    process.env = prevEnv;
  });

  describe('formatCurrency', () => {
    it('formats ETB with 2 decimal places', () => {
      const { formatCurrency } = require('../../src/services/emailTemplates');
      const s = formatCurrency(1000);
      expect(typeof s).toBe('string');
      expect(s).toContain('1,000.00');
    });
  });

  describe('paymentReminderTemplate', () => {
    it('renders urgent template when due today', () => {
      const { paymentReminderTemplate, formatCurrency } = require('../../src/services/emailTemplates');
      const html = paymentReminderTemplate({
        invoiceNumber: 'INV-1',
        amount: 100,
        dueDate: '2026-02-01T00:00:00.000Z',
        daysRemaining: 0,
      });

      expect(html).toContain('Payment URGENT');
      expect(html).toContain('INV-1');
      expect(html).toContain(formatCurrency(100));
      expect(html).toContain('TODAY');
      expect(html).toContain('https://app.example/#/owner/billing');
    });

    it('renders warning template when due soon', () => {
      const { paymentReminderTemplate } = require('../../src/services/emailTemplates');
      const html = paymentReminderTemplate({
        invoiceNumber: 'INV-2',
        amount: 200,
        dueDate: '2026-02-01T00:00:00.000Z',
        daysRemaining: 2,
      });

      expect(html).toContain('Payment REMINDER');
      expect(html).toContain('INV-2');
      expect(html).toContain('in 2 days');
    });

    it('renders info template when not due soon', () => {
      const { paymentReminderTemplate } = require('../../src/services/emailTemplates');
      const html = paymentReminderTemplate({
        invoiceNumber: 'INV-3',
        amount: 300,
        dueDate: '2026-02-01T00:00:00.000Z',
        daysRemaining: 10,
      });

      expect(html).toContain('Payment HEADS UP');
      expect(html).toContain('INV-3');
      expect(html).toContain('in 10 days');
    });
  });

  describe('overdueTemplate', () => {
    it('renders overdue invoice details', () => {
      const { overdueTemplate, formatCurrency } = require('../../src/services/emailTemplates');
      const html = overdueTemplate({
        invoiceNumber: 'INV-10',
        amount: 555.5,
        dueDate: '2026-02-01T00:00:00.000Z',
        daysOverdue: 3,
      });

      expect(html).toContain('OVERDUE');
      expect(html).toContain('INV-10');
      expect(html).toContain(formatCurrency(555.5));
      expect(html).toContain('3 days');
      expect(html).toContain('https://app.example/#/owner/billing');
    });

    it('uses singular day when daysOverdue is 1', () => {
      const { overdueTemplate } = require('../../src/services/emailTemplates');
      const html = overdueTemplate({
        invoiceNumber: 'INV-11',
        amount: 10,
        dueDate: '2026-02-01T00:00:00.000Z',
        daysOverdue: 1,
      });

      expect(html).toContain('1 day overdue');
    });
  });

  describe('suspendedTemplate', () => {
    it('renders tenant name and restore link', () => {
      const { suspendedTemplate } = require('../../src/services/emailTemplates');
      const html = suspendedTemplate({ tenantName: 'My Business' });

      expect(html).toContain('Account Suspended');
      expect(html).toContain('Hi My Business');
      expect(html).toContain('https://app.example/#/owner/billing');
    });

    it('falls back gracefully when tenantName is missing', () => {
      const { suspendedTemplate } = require('../../src/services/emailTemplates');
      const html = suspendedTemplate({});
      expect(html).toContain('Hi there');
    });
  });

  describe('welcomeTemplate', () => {
    it('renders login details and uses explicit loginUrl when provided', () => {
      const { welcomeTemplate } = require('../../src/services/emailTemplates');
      const html = welcomeTemplate({
        businessName: 'Biz',
        email: 'a@b.com',
        tempPassword: 'temp123',
        loginUrl: 'https://login.example',
      });

      expect(html).toContain('Welcome to MirachPOS');
      expect(html).toContain('Biz');
      expect(html).toContain('a@b.com');
      expect(html).toContain('temp123');
      expect(html).toContain('https://login.example');
    });

    it('falls back to APP_URL when loginUrl is not provided', () => {
      const { welcomeTemplate } = require('../../src/services/emailTemplates');
      const html = welcomeTemplate({
        businessName: 'Biz',
        email: 'a@b.com',
        tempPassword: 'temp123',
      });

      expect(html).toContain('https://app.example');
    });
  });
});
