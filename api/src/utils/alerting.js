const { config } = require('../config');
const { createMailTransporter } = require('./mail');

const lastSentByKey = new Map();

const getCooldownMs = () => (process.env.ALERT_COOLDOWN_MS ? Number(process.env.ALERT_COOLDOWN_MS) : 300000);

const canSend = (key, cooldownMs) => {
  const now = Date.now();
  const last = lastSentByKey.get(key) || 0;
  if (now - last < cooldownMs) return false;
  lastSentByKey.set(key, now);
  return true;
};

const sendCriticalAlert = async ({ key = 'critical', subject, message, meta }) => {
  try {
    const cooldownMs = getCooldownMs();
    if (!canSend(key, cooldownMs)) return false;

    const transporter = createMailTransporter();
    if (!transporter) return false;

    const to = String(config.mail?.receiver || '').trim();
    const from = String(config.mail?.from || config.mail?.user || '').trim();
    if (!to || !from || !subject) return false;

    const metaBlock = meta ? `\n\nMeta:\n${JSON.stringify(meta, null, 2)}` : '';
    await transporter.sendMail({
      to,
      from,
      subject,
      text: `${message || ''}${metaBlock}`.trim(),
    });

    return true;
  } catch {
    return false;
  }
};

module.exports = { sendCriticalAlert };
