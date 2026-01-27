const required = (name) => {
  const v = String(process.env[name] || '').trim();
  return v ? { ok: true, value: v } : { ok: false, value: '' };
};

const validateEnv = () => {
  const isProd = String(process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;

  const missing = [];

  if (!required('JWT_SECRET').ok) missing.push('JWT_SECRET');

  if (!required('DB_HOST').ok) missing.push('DB_HOST');
  if (!required('DB_USER').ok) missing.push('DB_USER');
  if (!required('DB_PASSWORD').ok) missing.push('DB_PASSWORD');
  if (!required('DB_NAME').ok) missing.push('DB_NAME');

  const signupEnabled = String(process.env.ENABLE_PUBLIC_SIGNUP || '1').trim() === '1';
  if (signupEnabled && !required('TURNSTILE_SECRET_KEY').ok) missing.push('TURNSTILE_SECRET_KEY');

  if (missing.length > 0) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    const err = new Error(msg);
    err.code = 'ENV_MISSING';
    throw err;
  }
};

module.exports = { validateEnv };
