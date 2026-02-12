jest.mock('../../src/utils/mail', () => ({
  createMailTransporter: jest.fn(),
}));

const { sendCriticalAlert } = require('../../src/utils/alerting');
const { createMailTransporter } = require('../../src/utils/mail');
const { config } = require('../../src/config');

describe('utils/alerting', () => {
  const originalEnv = process.env.ALERT_COOLDOWN_MS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALERT_COOLDOWN_MS;
    // Reset the internal cooldown map
    const alertingModule = require('../../src/utils/alerting');
    if (alertingModule.__resetCooldowns) {
      alertingModule.__resetCooldowns();
    }
  });

  afterAll(() => {
    process.env.ALERT_COOLDOWN_MS = originalEnv;
  });

  describe('sendCriticalAlert', () => {
    it('sends alert successfully', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({});
      createMailTransporter.mockReturnValue({ sendMail: mockSendMail });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      const result = await sendCriticalAlert({
        key: 'test-alert',
        subject: 'Test Alert',
        message: 'Something happened',
        meta: { detail: 'info' },
      });

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'admin@test.com',
        from: 'alerts@test.com',
        subject: 'Test Alert',
      }));
    });

    it('respects cooldown between same key alerts', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({});
      createMailTransporter.mockReturnValue({ sendMail: mockSendMail });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      // First alert should send
      const result1 = await sendCriticalAlert({
        key: 'cooldown-test',
        subject: 'First Alert',
        message: 'First',
      });
      expect(result1).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      // Second alert with same key should be blocked by cooldown
      const result2 = await sendCriticalAlert({
        key: 'cooldown-test',
        subject: 'Second Alert',
        message: 'Second',
      });
      expect(result2).toBe(false);
      expect(mockSendMail).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('allows different keys without cooldown conflict', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({});
      createMailTransporter.mockReturnValue({ sendMail: mockSendMail });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      const result1 = await sendCriticalAlert({
        key: 'alert-1',
        subject: 'Alert 1',
        message: 'First',
      });
      expect(result1).toBe(true);

      const result2 = await sendCriticalAlert({
        key: 'alert-2',
        subject: 'Alert 2',
        message: 'Second',
      });
      expect(result2).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it('returns false when transporter is null', async () => {
      createMailTransporter.mockReturnValue(null);
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      const result = await sendCriticalAlert({
        subject: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
    });

    it('returns false when mail config is missing', async () => {
      createMailTransporter.mockReturnValue({ sendMail: jest.fn() });
      config.mail = {};

      const result = await sendCriticalAlert({
        subject: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
    });

    it('returns false when subject is missing', async () => {
      createMailTransporter.mockReturnValue({ sendMail: jest.fn() });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      const result = await sendCriticalAlert({
        message: 'Test message without subject',
      });

      expect(result).toBe(false);
    });

    it('handles errors gracefully', async () => {
      createMailTransporter.mockImplementation(() => {
        throw new Error('Transporter error');
      });

      const result = await sendCriticalAlert({
        subject: 'Test',
        message: 'Test message',
      });

      expect(result).toBe(false);
    });

    it('uses custom cooldown from env', async () => {
      process.env.ALERT_COOLDOWN_MS = '1000'; // 1 second

      const mockSendMail = jest.fn().mockResolvedValue({});
      createMailTransporter.mockReturnValue({ sendMail: mockSendMail });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      // First alert
      await sendCriticalAlert({
        key: 'custom-cooldown',
        subject: 'First',
        message: 'First',
      });

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Second alert should now work
      const result2 = await sendCriticalAlert({
        key: 'custom-cooldown',
        subject: 'Second',
        message: 'Second',
      });

      expect(result2).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it('uses default key when not provided', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({});
      createMailTransporter.mockReturnValue({ sendMail: mockSendMail });
      config.mail = { receiver: 'admin@test.com', from: 'alerts@test.com' };

      // First alert with default key
      await sendCriticalAlert({
        subject: 'First',
        message: 'First',
      });

      // Second alert with same default key should be blocked
      const result2 = await sendCriticalAlert({
        subject: 'Second',
        message: 'Second',
      });

      expect(result2).toBe(false);
    });
  });
});
