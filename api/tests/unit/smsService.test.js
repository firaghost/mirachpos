const smsService = require('../../src/services/smsService');

describe('smsService', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();
  });

  it('throws a credentials missing error when no credentials are provided', async () => {
    await expect(
      smsService.sendSMS({ to: '+251900000000', message: 'hi', config: {} }),
    ).rejects.toMatchObject({ code: 'SMS_CREDENTIALS_MISSING' });
  });

  it('uses DB config credentials when env vars are not set', async () => {
    delete process.env.AT_API_KEY;
    delete process.env.AT_USERNAME;
    delete process.env.AT_SENDER_ID;

    const res = await smsService.sendSMS({
      to: '+251900000000',
      message: 'hello',
      config: { apiKey: 'db-key', username: 'db-user', senderId: 'DBSENDER' },
    });

    expect(res).toEqual({
      messageId: 'test-message-id',
      provider: 'africas_talking',
      source: 'db',
    });
  });

  it('prefers env credentials over DB config and marks source as env', async () => {
    process.env.AT_API_KEY = 'env-key';
    process.env.AT_USERNAME = 'env-user';
    process.env.AT_SENDER_ID = 'ENVSENDER';

    const res = await smsService.sendSMS({
      to: '+251900000000',
      message: 'hello',
      config: { apiKey: 'db-key', username: 'db-user', senderId: 'DBSENDER' },
    });

    expect(res).toEqual({
      messageId: 'test-message-id',
      provider: 'africas_talking',
      source: 'env',
    });
  });

  it('returns null messageId when provider response is missing messageId', async () => {
    let resPromise;

    jest.isolateModules(() => {
      jest.resetModules();
      jest.doMock(
        'africastalking',
        () =>
          () => ({
            SMS: {
              send: jest.fn(async () => ({ SMSMessageData: { Recipients: [{}] } })),
            },
          }),
        { virtual: true },
      );

      const isolatedSmsService = require('../../src/services/smsService');
      resPromise = isolatedSmsService.sendSMS({
        to: '+251900000000',
        message: 'hello',
        config: { apiKey: 'db-key', username: 'db-user', senderId: 'DBSENDER' },
      });
    });

    const res = await resPromise;

    expect(res).toEqual({ messageId: null, provider: 'africas_talking', source: 'db' });
  });

  it('handles phone number with spaces', async () => {
    let resPromise;

    jest.isolateModules(() => {
      jest.resetModules();
      jest.doMock(
        'africastalking',
        () =>
          () => ({
            SMS: {
              send: jest.fn(async () => ({
                SMSMessageData: { Recipients: [{ messageId: 'test-message-id' }] },
              })),
            },
          }),
        { virtual: true },
      );

      const isolatedSmsService = require('../../src/services/smsService');
      resPromise = isolatedSmsService.sendSMS({
        to: ' +251 900 000 000 ',
        message: 'hello',
        config: { apiKey: 'k', username: 'u', senderId: 'S' },
      });
    });

    const res = await resPromise;
    expect(res.messageId).toBe('test-message-id');
  });

  it('handles API errors gracefully', async () => {
    let resPromise;

    jest.isolateModules(() => {
      jest.resetModules();
      jest.doMock(
        'africastalking',
        () =>
          () => ({
            SMS: {
              send: jest.fn(async () => { throw new Error('API Error'); }),
            },
          }),
        { virtual: true },
      );

      const isolatedSmsService = require('../../src/services/smsService');
      resPromise = isolatedSmsService.sendSMS({
        to: '+251900000000',
        message: 'hello',
        config: { apiKey: 'k', username: 'u', senderId: 'S' },
      });
    });

    await expect(resPromise).rejects.toThrow('API Error');
  });
});
