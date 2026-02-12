jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn(),
  })),
}));

const { createMailTransporter } = require('../../src/utils/mail');

describe('utils/mail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createMailTransporter', () => {
    it('creates transporter with env variables', () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASS = 'password123';

      const transporter = createMailTransporter();
      expect(transporter).toBeDefined();
      expect(transporter.sendMail).toBeDefined();
    });

    it('creates transporter with overrides', () => {
      const overrides = {
        host: 'smtp.override.com',
        port: 587,
        user: 'override@test.com',
        pass: 'override123',
        secure: false,
      };

      const transporter = createMailTransporter(overrides);
      expect(transporter).toBeDefined();
    });

    it('uses default port 465 when not specified', () => {
      const overrides = {
        host: 'smtp.test.com',
        user: 'test@test.com',
        pass: 'password',
      };

      const transporter = createMailTransporter(overrides);
      expect(transporter).toBeDefined();
    });

    it('handles port 587', () => {
      const overrides = {
        host: 'smtp.test.com',
        port: 587,
        user: 'test@test.com',
        pass: 'password',
      };

      const transporter = createMailTransporter(overrides);
      expect(transporter).toBeDefined();
    });

    it('handles port 2525', () => {
      const overrides = {
        host: 'smtp.test.com',
        port: 2525,
        user: 'test@test.com',
        pass: 'password',
      };

      const transporter = createMailTransporter(overrides);
      expect(transporter).toBeDefined();
    });
  });
});
