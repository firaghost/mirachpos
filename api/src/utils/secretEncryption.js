const crypto = require('crypto');

const ENC_PREFIX = 'enc:v1:';

const getMasterKey = () => {
  const raw = String(process.env.TENANT_GATEWAY_SECRETS_KEY || '').trim();
  if (!raw) return null;

  // Prefer base64-encoded 32 bytes.
  let buf = null;
  try {
    buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    // ignore
  }

  // Fallback: hex-encoded 32 bytes.
  try {
    buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  } catch {
    // ignore
  }

  throw new Error('invalid_tenant_gateway_secrets_key');
};

const encryptString = (plaintext) => {
  const key = getMasterKey();
  if (!key) throw new Error('tenant_gateway_secrets_key_missing');

  const s = String(plaintext ?? '');
  if (!s) return '';
  if (s.startsWith(ENC_PREFIX)) return s;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

const decryptString = (value) => {
  const s = String(value ?? '');
  if (!s) return '';
  if (!s.startsWith(ENC_PREFIX)) return s;

  const key = getMasterKey();
  if (!key) throw new Error('tenant_gateway_secrets_key_missing');

  const rest = s.slice(ENC_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) throw new Error('invalid_encrypted_secret');

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

const encryptConfigFields = (cfg, fields) => {
  const out = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  (fields || []).forEach((k) => {
    if (typeof out[k] === 'string' && out[k].trim()) {
      out[k] = encryptString(out[k]);
    }
  });
  return out;
};

const decryptConfigFields = (cfg, fields) => {
  const out = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  (fields || []).forEach((k) => {
    if (typeof out[k] === 'string' && out[k]) {
      out[k] = decryptString(out[k]);
    }
  });
  return out;
};

module.exports = {
  ENC_PREFIX,
  encryptString,
  decryptString,
  encryptConfigFields,
  decryptConfigFields,
};
