const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validators');
const { config } = require('../config');
const { db } = require('../db');
const { loginWithEmailPassword, loginWithCodePin } = require('../services/authService');
const bcrypt = require('bcryptjs');
const { makeId } = require('../utils/ids');

const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');

const safeIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const createMailTransporter = (overrides) => {
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch {
    return null;
  }

  const host = String(config.mail?.host || '').trim();
  const port = Number(overrides?.port || config.mail?.port || 587);
  const user = String(config.mail?.user || '').trim();
  const pass = String(config.mail?.pass || '').trim();
  if (!host || !user || !pass) return null;

  const secure =
    typeof overrides?.secure === 'boolean'
      ? overrides.secure
      : typeof config.mail?.secure === 'boolean'
        ? config.mail.secure
        : port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Windows sometimes prefers IPv6 first; forcing IPv4 avoids hanging greetings on some hosts.
    family: 4,
    requireTLS: !secure && port === 587,
    tls: { minVersion: 'TLSv1.2', servername: host },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
};

const randomOtp = () => {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
};

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizePermissions = (raw) => {
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
};

const readRolePermissions = async ({ tenantId, roleName }) => {
  const tn = String(tenantId || '').trim();
  const rn = String(roleName || '').trim();
  if (!tn || !rn) return [];
  const row = await db().select(['permissions']).from('roles').where({ tenant_id: tn, name: rn }).first();
  if (!row) return [];
  return normalizePermissions(row.permissions);
};

const maybeDowngradeDueSubscription = async (tenantId) => {
  const sub = await db().select(['tenant_id', 'tier', 'status', 'next_bill_at']).from('tenant_subscription').where({ tenant_id: tenantId }).first();
  if (!sub) return;
  const status = String(sub.status || 'active').toLowerCase().replace(/\s+/g, '_');
  if (status !== 'active') return;

  const nextBillIso = safeIso(sub.next_bill_at);
  if (!nextBillIso) return;
  const nextBillMs = new Date(nextBillIso).getTime();
  if (!Number.isFinite(nextBillMs)) return;
  if (Date.now() < nextBillMs) return;

  const nowIso = new Date().toISOString();
  const graceEndsAt = nextBillIso;
  await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({
    status: 'past_due',
    grace_ends_at: graceEndsAt,
    updated_at: nowIso,
  });
};

const makeAuthRouter = () => {
  const r = express.Router();

  const handler = async (req, res, next) => {
    try {
      // Use validated data from Zod middleware
      const { email, password } = req.validatedBody || req.body;

      const out = await loginWithEmailPassword({
        tenantId: req.tenant.id,
        email,
        password,
        jwtSecret: config.jwtSecret,
      });

      if (!out.ok) return res.status(401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }

  };

  // New API - with validation
  r.post('/login', tenantMiddleware, validateLogin, handler);
  // Backward-compatible: existing frontend calls /api/auth/login
  r.post('/auth/login', tenantMiddleware, validateLogin, handler);

  r.post('/login-pin', tenantMiddleware, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
      const out = await loginWithCodePin({ tenantId: req.tenant.id, code, pin, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(out.error === 'forbidden' ? 403 : 401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/auth/login-pin', tenantMiddleware, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
      const out = await loginWithCodePin({ tenantId: req.tenant.id, code, pin, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(out.error === 'forbidden' ? 403 : 401).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/auth/forgot-password/request', tenantMiddleware, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!email) return res.status(400).json({ error: 'email_required' });

      const staff = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, email }).first();

      const otp = randomOtp();
      const otpHash = await bcrypt.hash(otp, 10);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
      const requestIp = typeof req.ip === 'string' ? req.ip.slice(0, 64) : null;

      await db().from('password_reset_otps').insert({
        id: makeId('pwotp'),
        tenant_id: req.tenant.id,
        email,
        otp_hash: otpHash,
        attempts: 0,
        expires_at: expiresAt.toISOString(),
        used_at: null,
        request_ip: requestIp,
        created_at: now.toISOString(),
      });

      // Prevent email enumeration: always return ok.
      // In production: only send email if the account exists.
      // In development: attempt to send regardless so SMTP can be tested easily.
      const dev = config.env !== 'production';
      const debug = dev
        ? {
            mail: {
              configured: false,
              attempted: false,
              sent: false,
              error: '',
              env: { host: '', port: 0, user: '', hasPass: false, from: '' },
              transport: { ok: false, hasFrom: false },
            },
          }
        : null;
      if (staff || dev) {
        const transporter = createMailTransporter();
        const appName = String(config.app?.name || 'MirachPOS');
        const tenantSlug = String(req.tenant?.slug || '').trim();
        const tenantName = String(req.tenant?.name || '').trim();
        const expiresInMin = 10;
        const expiresAtIso = expiresAt.toISOString();
        const fromEmail = String(config.mail?.from || config.mail?.user || '').trim();
        if (debug) {
          debug.mail.env.host = String(config.mail?.host || '');
          debug.mail.env.port = Number(config.mail?.port || 0) || 0;
          debug.mail.env.user = String(config.mail?.user || '');
          debug.mail.env.hasPass = Boolean(String(config.mail?.pass || '').trim());
          debug.mail.env.from = fromEmail;
        }
        if (debug) {
          debug.mail.transport.ok = Boolean(transporter);
          debug.mail.transport.hasFrom = Boolean(fromEmail);
          debug.mail.configured = Boolean(transporter) && Boolean(fromEmail);
          debug.mail.attempted = debug.mail.configured;

          if (!debug.mail.configured && !debug.mail.error) {
            const host = String(config.mail?.host || '').trim();
            const user = String(config.mail?.user || '').trim();
            const pass = String(config.mail?.pass || '').trim();
            if (!host) debug.mail.error = 'mail_host_missing';
            else if (!user) debug.mail.error = 'mail_username_missing';
            else if (!pass) debug.mail.error = 'mail_password_missing';
            else if (!fromEmail) debug.mail.error = 'mail_from_missing';
            else if (!transporter) {
              let nodemailerOk = false;
              try {
                // eslint-disable-next-line global-require
                require('nodemailer');
                nodemailerOk = true;
              } catch {
                nodemailerOk = false;
              }
              debug.mail.error = nodemailerOk
                ? `transporter_null(host_len=${host.length} user_len=${user.length} pass_len=${pass.length})`
                : 'nodemailer_not_available';
            } else {
              debug.mail.error = 'mail_not_configured';
            }
          }
        }
        if (transporter && fromEmail) {
          const subject = `${appName} OTP — reset password for ${tenantSlug || 'workspace'}`;
          const headerLines = [
            `Workspace (Tenant): ${tenantSlug || ''}`,
            tenantName ? `Restaurant: ${tenantName}` : '',
          ].filter(Boolean).join('\n');
          const text = [
            `Your ${appName} password reset code is: ${otp}`,
            '',
            headerLines,
            '',
            `This code expires in ${expiresInMin} minutes.`,
            `Expires at (UTC): ${expiresAtIso}`,
          ].filter(Boolean).join('\n');

          const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;">` +
            `<p style="margin:0 0 10px 0;">Use this OTP code to reset your <b>${appName}</b> password.</p>` +
            (tenantSlug ? `<div style="margin:0 0 8px 0;color:#6b7280;"><b>Workspace (Tenant):</b> ${tenantSlug}</div>` : '') +
            (tenantName ? `<div style="margin:0 0 12px 0;color:#6b7280;"><b>Restaurant:</b> ${tenantName}</div>` : '') +
            `<div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:16px 0;padding:10px 14px;border-radius:12px;background:#0f172a;color:#fff;display:inline-block;">${otp}</div>` +
            `<div style="margin-top:8px;color:#6b7280;">Expires in <b>${expiresInMin} minutes</b> (UTC: ${expiresAtIso}).</div>` +
            `</div>`;
          try {
            if (dev) {
              try {
                await transporter.verify();
              } catch (e) {
                if (debug) debug.mail.error = e instanceof Error ? e.message : String(e);
              }
            }

            await transporter.sendMail({
              from: `"${appName}" <${fromEmail}>`,
              to: email,
              subject,
              text,
              html,
            });

            if (debug) debug.mail.sent = true;
          } catch (e) {
            const code = String(e?.code || '');
            const curPort = Number(config.mail?.port || 587);
            const shouldRetry = (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') && curPort === 587;
            if (shouldRetry) {
              try {
                const transporter465 = createMailTransporter({ port: 465, secure: true });
                if (transporter465) {
                  await transporter465.sendMail({
                    from: `"${appName}" <${fromEmail}>`,
                    to: email,
                    subject,
                    text,
                    html,
                  });
                  if (debug) debug.mail.sent = true;
                  return;
                }
              } catch (e2) {
                if (debug) debug.mail.error = e2 instanceof Error ? e2.message : String(e2);
                try {
                  if (req.log?.error)
                    req.log.error(
                      { err: e2, to: email, host: String(config.mail?.host || ''), port: 465 },
                      'forgot-password email send failed (retry 465)'
                    );
                } catch {
                  // ignore
                }
              }
            }

            if (debug) debug.mail.error = e instanceof Error ? e.message : String(e);
            try {
              if (req.log?.error)
                req.log.error({ err: e, to: email, host: String(config.mail?.host || ''), port: Number(config.mail?.port || 0) }, 'forgot-password email send failed');
              // eslint-disable-next-line no-console
              else console.error('forgot-password email send failed', e);
            } catch {
              // ignore
            }
          }
        } else {
          try {
            if (req.log?.warn) req.log.warn({ host: String(config.mail?.host || ''), user: String(config.mail?.user || ''), hasPass: Boolean(String(config.mail?.pass || '').trim()), from: fromEmail }, 'mail not configured; cannot send forgot-password OTP');
          } catch {
            // ignore
          }
        }
      }

      return res.json(dev && debug ? { ok: true, debug } : { ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/auth/forgot-password/confirm', tenantMiddleware, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const passwordConfirm = typeof req.body?.passwordConfirm === 'string' ? req.body.passwordConfirm : '';

      if (!email) return res.status(400).json({ error: 'email_required' });
      if (!otp) return res.status(400).json({ error: 'otp_required' });
      if (!password || password.length < 6) return res.status(400).json({ error: 'password_too_short' });
      if (password !== passwordConfirm) return res.status(400).json({ error: 'password_mismatch' });

      const nowIso = new Date().toISOString();
      const row = await db()
        .select(['id', 'otp_hash', 'attempts', 'expires_at', 'used_at'])
        .from('password_reset_otps')
        .where({ tenant_id: req.tenant.id, email })
        .orderBy('created_at', 'desc')
        .first();

      if (!row) return res.status(400).json({ error: 'invalid_otp' });
      if (row.used_at) return res.status(400).json({ error: 'invalid_otp' });

      const expIso = safeIso(row.expires_at);
      const expMs = expIso ? new Date(expIso).getTime() : NaN;
      if (!Number.isFinite(expMs) || Date.now() > expMs) return res.status(400).json({ error: 'otp_expired' });

      const attempts = Number(row.attempts || 0) || 0;
      if (attempts >= 5) return res.status(429).json({ error: 'too_many_attempts' });

      const match = await bcrypt.compare(otp, String(row.otp_hash || ''));
      if (!match) {
        await db().from('password_reset_otps').where({ id: String(row.id) }).update({ attempts: attempts + 1 });
        return res.status(400).json({ error: 'invalid_otp' });
      }

      const staffRow = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, email }).first();
      if (!staffRow) return res.status(400).json({ error: 'invalid_otp' });

      const hash = await bcrypt.hash(password, 10);
      await db().from('staff').where({ tenant_id: req.tenant.id, id: String(staffRow.id) }).update({ password_hash: hash, updated_at: nowIso });
      await db().from('password_reset_otps').where({ id: String(row.id) }).update({ used_at: nowIso });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  const meHandler = async (req, res, next) => {
    try {
      if (!req.auth?.tenantId) return res.status(401).json({ error: 'unauthorized' });

      const tenant = await db()
        .select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at'])
        .from('tenants')
        .where({ id: String(req.auth.tenantId) })
        .first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });
      if (String(tenant.status) === 'suspended') return res.status(403).json({ error: 'tenant_suspended' });

      await maybeDowngradeDueSubscription(String(tenant.id));

      const staffId = typeof req.auth?.staffId === 'string' ? req.auth.staffId : '';
      const role = typeof req.auth?.role === 'string' ? req.auth.role : '';
      const branchId = typeof req.auth?.branchId === 'string' ? req.auth.branchId : 'global';

      let staffName = '';
      if (staffId) {
        const staff = await db().select(['id', 'name']).from('staff').where({ tenant_id: tenant.id, id: staffId }).first();
        staffName = staff?.name ? String(staff.name) : '';
      }

      const branch = await (async () => {
        if (!branchId || branchId === 'global') return { id: 'global', name: 'Global' };
        const b = await db().select(['id', 'name']).from('branches').where({ tenant_id: tenant.id, id: branchId }).first();
        if (!b) return { id: String(branchId), name: '' };
        return { id: String(b.id), name: String(b.name || '') };
      })();

      const ent = await computeTenantEntitlements({ tenant });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: tenant.id, entitlements: ent });

      const permissions = role ? await readRolePermissions({ tenantId: tenant.id, roleName: role }) : [];

      return res.json({
        ok: true,
        me: {
          tenantId: String(tenant.id),
          branchId,
          staffId,
          role,
          staffName,
          permissions,
        },
        tenant: { id: String(tenant.id), slug: String(tenant.slug || ''), name: String(tenant.name || '') },
        branch,
        subscription: ent?.subscription || { tier: 'Trial', modules: [] },
        billing: ent?.billing || { cycle: 'Monthly', status: 'active', method: 'manual', nextBillAt: '', amountEtb: 0, graceEndsAt: '' },
        limits: ent?.limits || {},
      });
    } catch (e) {
      return next(e);
    }
  };

  r.get('/auth/me', requireAuth, meHandler);
  r.get('/me', requireAuth, meHandler);

  return r;
};

module.exports = { makeAuthRouter };
