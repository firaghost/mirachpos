const normalizePrivateKey = (v) => String(v || '').replace(/\\n/g, '\n');

const resolveCredentials = (cfg) => {
  const envApiKey = String(process.env.AT_API_KEY || '').trim();
  const envUsername = String(process.env.AT_USERNAME || '').trim();
  const envSenderId = String(process.env.AT_SENDER_ID || '').trim();

  const cfgApiKey = String(cfg?.apiKey || cfg?.api_key || '').trim();
  const cfgUsername = String(cfg?.username || '').trim();
  const cfgSenderId = String(cfg?.senderId || cfg?.sender_id || '').trim();

  const apiKey = envApiKey || cfgApiKey;
  const username = envUsername || cfgUsername;
  const senderId = envSenderId || cfgSenderId || 'MIRACH';

  if (!apiKey || !username) return null;

  const source = envApiKey || envUsername || envSenderId ? 'env' : 'db';
  return { apiKey, username, senderId, source };
};

const normalizePhone = (v) => String(v || '').replace(/\s+/g, '');

const smsService = {
  async sendSMS({ to, message, config }) {
    const normalizedTo = normalizePhone(to);
    const credentials = resolveCredentials(config);
    if (!credentials) {
      const err = new Error('SMS credentials are missing');
      err.code = 'SMS_CREDENTIALS_MISSING';
      throw err;
    }

    let AfricasTalking;
    try {
      AfricasTalking = require('africastalking');
    } catch {
      const err = new Error('SMS provider dependency is missing (africastalking)');
      err.code = 'SMS_PROVIDER_NOT_INSTALLED';
      throw err;
    }

    const at = AfricasTalking({
      apiKey: normalizePrivateKey(credentials.apiKey),
      username: credentials.username,
    });

    const sms = at.SMS;

    const result = await sms.send({
      to: normalizedTo,
      message,
      from: credentials.senderId,
    });

    const messageId = result?.SMSMessageData?.Recipients?.[0]?.messageId;
    return { messageId: messageId ? String(messageId) : null, provider: 'africas_talking', source: credentials.source };
  },
};

module.exports = smsService;
