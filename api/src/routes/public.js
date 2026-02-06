const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { config } = require('../config');
const { loginWithEmailPassword } = require('../services/authService');
const paymentGatewayService = require('../services/paymentGatewayService');
const { provisionTenant } = require('../services/provisionService');
const { fetch } = require('undici');

const { safeJsonParse } = require('../utils/json');
const { createMailTransporter } = require('../utils/mail');
const {
  validatePublicSignup,
  validateTokenParam,
  validateChapaInitiate,
  validateDemoRequest,
  validateAcceptInvite,
  validateContactAdmin,
} = require('../middleware/validators');

const makePublicRouter = () => {
  const r = express.Router();

  const normalizePublicBaseUrl = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    return s.replace(/\/+$/, '');
  };

  const publicBaseUrlFromReq = (req) => {
    const configured = normalizePublicBaseUrl(config?.app?.publicLinksUrl);
    if (configured) return configured;
    const xfProto = String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const proto = xfProto || req.protocol;
    return proto + '://' + req.get('host');
  };

  const apiBaseUrlFromReq = (req) => {
    const configured = normalizePublicBaseUrl(config?.app?.apiPublicUrl);
    if (configured) return configured;
    const xfProto = String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const proto = xfProto || req.protocol;
    return proto + '://' + req.get('host');
  };

  const safeIso = (v) => {
    try {
      if (!v) return '';
      return new Date(v).toISOString();
    } catch {
      return '';
    }
  };

  const verifyTurnstile = async ({ token, ip }) => {
    const secret = String(config.turnstileSecretKey || '').trim();
    const t = String(token || '').trim();
    if (!secret) return { ok: false, error: 'turnstile_not_configured' };
    if (!t) return { ok: false, error: 'turnstile_token_missing' };

    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', t);
    const ipStr = typeof ip === 'string' ? ip.replace(/^::ffff:/, '').trim() : '';
    if (ipStr) form.append('remoteip', ipStr);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, error: 'turnstile_verify_failed' };
    if (!json || json.success !== true) return { ok: false, error: 'turnstile_invalid', details: json?.['error-codes'] };
    return { ok: true };
  };

  const escapeHtml = (value = '') =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const renderBrandedEmail = ({ appName, appUrl, logoUrl, title, subtitle, bodyHtml, ctaLabel, ctaUrl, footerNote }) => {
    const brandAccent = '#C8A870';
    const headerBg = '#0f141b';
    const pageBg = '#0b0f14';
    const creamBg = '#f6f1e8';
    const safeAppName = escapeHtml(appName);
    const safeTitle = escapeHtml(title);
    const safeSubtitle = escapeHtml(subtitle);
    const safeFooterNote = footerNote ? escapeHtml(footerNote) : '';
    const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : '';
    const hasCta = Boolean(ctaLabel && ctaUrl);

    return `
      <div style="margin:0;padding:0;background:${pageBg};">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${pageBg};padding:24px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="680" style="width:680px;max-width:100%;border-collapse:separate;border-spacing:0;">
                <tr>
                  <td style="background:${headerBg};border-radius:18px 18px 0 0;overflow:hidden;border:1px solid rgba(255,255,255,.10);">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:18px 18px 10px 18px;font-family:Arial,Helvetica,sans-serif;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                            <tr>
                              <td style="vertical-align:middle;">
                                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                                  <tr>
                                    ${safeLogoUrl ? `<td style="vertical-align:middle;padding-right:10px;"><img src="${safeLogoUrl}" width="34" height="34" alt="${safeAppName}" style="display:block;border-radius:10px;"/></td>` : ''}
                                    <td style="vertical-align:middle;">
                                      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.72);font-weight:700;">${safeAppName}</div>
                                      <div style="margin-top:4px;font-size:18px;line-height:1.2;color:#ffffff;font-weight:900;">${safeSubtitle}</div>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                              <td align="right" style="vertical-align:middle;">
                                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;">
                                  <tr>
                                    <td style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);padding:8px 10px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#e2e8f0;">Welcome</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="height:4px;line-height:4px;font-size:4px;background:${brandAccent};">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="background:${creamBg};border-left:1px solid rgba(255,255,255,.10);border-right:1px solid rgba(255,255,255,.10);padding:18px 18px 0 18px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:22px;line-height:1.25;font-weight:900;color:#111827;">${safeTitle}</div>
                  </td>
                </tr>
                <tr>
                  <td style="background:${creamBg};border-left:1px solid rgba(255,255,255,.10);border-right:1px solid rgba(255,255,255,.10);padding:10px 18px 0 18px;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:14px;line-height:1.7;">
                    ${bodyHtml}
                  </td>
                </tr>

                ${hasCta ? `
                <tr>
                  <td style="background:${creamBg};border-left:1px solid rgba(255,255,255,.10);border-right:1px solid rgba(255,255,255,.10);padding:16px 18px 0 18px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td bgcolor="${brandAccent}" style="border-radius:12px;">
                          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 16px;font-size:13px;font-weight:900;color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;letter-spacing:.02em;">${escapeHtml(ctaLabel)}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ` : ''}

                <tr>
                  <td style="background:${headerBg};border-radius:0 0 18px 18px;overflow:hidden;border:1px solid rgba(255,255,255,.10);border-top:0;padding:14px 18px 16px 18px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:12px;line-height:1.7;color:#94a3b8;">
                      <div style="font-weight:700;color:#e2e8f0;">${safeAppName}</div>
                      <div><a href="${escapeHtml(appUrl)}" style="color:#93c5fd;text-decoration:none;font-weight:700;">${escapeHtml(String(appUrl).replace(/^https?:\/\//, ''))}</a></div>
                      ${safeFooterNote ? `<div style="margin-top:10px;color:#cbd5e1;">${safeFooterNote}</div>` : ''}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
  };

  const renderPremiumAutoReplyEmail = ({
    title,
    intro,
    detailsTitle,
    detailsRows,
    ctaLabel,
    ctaUrl,
    footerNote,
    footerLinks,
    brandAccent,
    logoUrl,
    contactLineHtml,
    brandName,
    showWhatNow,
  }) => {
    const safeTitle = escapeHtml(title);
    const safeBrandName = escapeHtml(brandName || 'MirachPOS');
    const safeIntro = intro ? escapeHtml(intro) : '';
    const safeDetailsTitle = detailsTitle ? escapeHtml(detailsTitle) : '';
    const safeFooterNote = footerNote ? escapeHtml(footerNote) : '';
    const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : '';
    const shouldShowWhatNow = showWhatNow !== false;
    const accent = brandAccent || '#C8A870';
    const headerBg = '#0f141b';
    const pageBg = '#0b0f14';
    const creamBg = '#f6f1e8';

    const safeCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : '';
    const safeCtaUrl = ctaUrl ? escapeHtml(ctaUrl) : '';
    const hasCta = Boolean(safeCtaLabel && safeCtaUrl);

    const safeLinks = Array.isArray(footerLinks) ? footerLinks.filter((l) => l && l.url) : [];

    const detailsHtml = Array.isArray(detailsRows)
      ? detailsRows
          .filter((row) => row && (row.label || row.valueHtml || row.value))
          .map((row) => {
            const isFullWidth = Boolean(row.fullWidth);
            const label = escapeHtml(row.label || '');
            const value = row.valueHtml ? row.valueHtml : escapeHtml(row.value ?? '');
            if (isFullWidth) {
              return `
                <tr>
                  <td colspan="2" style="padding:12px 14px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#111827;">
                    ${value}
                  </td>
                </tr>
              `;
            }
            return `
              <tr>
                <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;width:36%;border-top:1px solid #e5e7eb;">${label}</td>
                <td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;border-top:1px solid #e5e7eb;">${value}</td>
              </tr>
            `;
          })
          .join('')
      : '';

    const linksHtml = safeLinks.length
      ? safeLinks
          .map((link) => {
            const label = link.label ? String(link.label) : 'Link';
            return `
              <td style="padding-right:12px;">
                <a href="${escapeHtml(link.url)}" style="color:#93c5fd;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${escapeHtml(label)}</a>
              </td>
            `;
          })
          .join('')
      : '';

    const safeContactLine = contactLineHtml ? String(contactLineHtml) : '';

    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${safeBrandName}</title>
  </head>
  <body style="margin:0;padding:0;background:${pageBg};">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${pageBg};">
      <tr>
        <td align="center" style="padding:36px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;">
            <tr>
              <td style="background:${headerBg};border-radius:18px 18px 0 0;overflow:hidden;border:1px solid rgba(255,255,255,.10);border-bottom:0;padding:18px 18px 16px 18px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="left" style="font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;font-weight:900;font-size:14px;letter-spacing:.08em;text-transform:uppercase;">
                      ${safeLogoUrl ? `<img src="${safeLogoUrl}" alt="${safeBrandName}" height="26" style="display:inline-block;vertical-align:middle;border:0;outline:0;" />` : safeBrandName}
                    </td>
                    <td align="right" style="font-family:Arial,Helvetica,sans-serif;color:#94a3b8;font-size:12px;font-weight:700;">
                      ${safeBrandName}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="background:${creamBg};border:1px solid rgba(255,255,255,.10);border-top:0;padding:22px 18px 18px 18px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:22px;line-height:1.25;color:#0f172a;font-weight:900;margin:0 0 12px 0;">${safeTitle}</div>
                      ${safeIntro ? `<div style="font-size:14px;line-height:1.75;color:#1f2937;margin:0 0 14px 0;">${safeIntro}</div>` : ''}
                    </td>
                  </tr>
                </table>

                ${safeDetailsTitle || detailsHtml ? `
                <div style="margin-top:14px;">
                  ${safeDetailsTitle ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;letter-spacing:.08em;text-transform:uppercase;font-weight:900;margin:0 0 8px 0;">${safeDetailsTitle}</div>` : ''}
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#ffffff;">
                    ${detailsHtml}
                  </table>
                </div>
                ` : ''}

                ${shouldShowWhatNow ? `
                <div style="margin-top:18px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;letter-spacing:.08em;text-transform:uppercase;font-weight:900;margin:0 0 8px 0;">What happens next</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.75;color:#1f2937;">You can sign in immediately using the email and password you created during signup.</div>
                </div>
                ` : ''}

                ${hasCta ? `
                <div style="margin-top:16px;">
                  <a href="${safeCtaUrl}" style="display:inline-block;background:${escapeHtml(accent)};color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:13px;letter-spacing:.02em;padding:12px 16px;border-radius:12px;">${safeCtaLabel}</a>
                </div>
                ` : ''}

                ${safeContactLine ? `
                <div style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#475569;">${safeContactLine}</div>
                ` : ''}
              </td>
            </tr>

            <tr>
              <td style="background:${headerBg};border-radius:0 0 18px 18px;overflow:hidden;border:1px solid rgba(255,255,255,.10);border-top:0;padding:14px 18px 16px 18px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:12px;line-height:1.7;color:#94a3b8;">
                  <div style="font-weight:700;color:#e2e8f0;">${safeBrandName}</div>
                  ${safeFooterNote ? `<div style="margin-top:10px;color:#cbd5e1;">${safeFooterNote}</div>` : ''}
                  ${linksHtml ? `
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;">
                    <tr>
                      ${linksHtml}
                    </tr>
                  </table>
                  ` : ''}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim();
  };

  const sendWelcomeEmail = async ({ toEmail, toName, tenantSlug, tenantName, trialEndsAt }) => {
    const transporter = createMailTransporter();
    if (!transporter) return { ok: false, error: 'mail_not_configured' };

    const appName = String(config.app?.name || 'MirachPOS');
    const appsUrl = String(config.app?.appsUrl || 'https://apps.mirachpos.com');
    const fromEmail = String(config.mail?.from || config.mail?.user || '').trim();
    if (!fromEmail) return { ok: false, error: 'mail_from_missing' };

    const safeTo = String(toEmail || '').trim();
    if (!safeTo) return { ok: false, error: 'mail_to_missing' };

    const loginUrl = `${appsUrl}`;
    const subject = `Welcome to ${appName} — your workspace is ${tenantSlug}`;

    const intro = `Hi ${toName || 'there'},`;
    const bodyText = [
      intro,
      '',
      `Your ${appName} workspace is ready.`,
      '',
      `Workspace (Tenant): ${tenantSlug}`,
      `Restaurant: ${tenantName}`,
      '',
      `Login here: ${loginUrl}`,
      '',
      `Use the email and password you created during signup.`,
      '',
      trialEndsAt ? `Your 14-day Pro trial ends on: ${trialEndsAt}` : '',
    ].filter(Boolean).join('\n');

    const appUrl = String(config.app?.url || 'https://mirachpos.com');
    const logoUrl = `${appUrl.replace(/\/+$/, '')}/logos/Logo.Icon.png`;

    const footerLinks = [
      { label: 'Website', url: appUrl },
      { label: 'Apps', url: loginUrl },
    ];

    const bodyHtml = renderPremiumAutoReplyEmail({
      title: `Welcome to ${appName}`,
      intro: `Hi ${toName || 'there'}, your workspace is ready. Use the details below to sign in.`,
      detailsTitle: 'Workspace details',
      detailsRows: [
        { label: 'Workspace (Tenant)', value: String(tenantSlug || '') },
        { label: 'Restaurant', value: String(tenantName || '') },
        ...(trialEndsAt ? [{ label: 'Trial ends', value: String(trialEndsAt) }] : []),
        { label: 'Login', valueHtml: ` <a href="${escapeHtml(loginUrl)}" style="color:#2563eb;text-decoration:none;font-weight:700;">${escapeHtml(loginUrl)}</a> ` },
      ],
      ctaLabel: 'Open MirachPOS',
      ctaUrl: loginUrl,
      footerNote: 'Tip: Workspace should match your tenant slug. Save this email for later.',
      footerLinks,
      brandAccent: '#C8A870',
      logoUrl,
      contactLineHtml: '',
      brandName: appName,
      showWhatNow: true,
    });

    await transporter.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: safeTo,
      subject,
      text: bodyText,
      html: bodyHtml,
    });
    return { ok: true };
  };

  const slugifyWorkspace = (name) => {
    const s = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (s || 'cafe').slice(0, 28);
  };

  r.post('/public/signup', validatePublicSignup, async (req, res, next) => {
    try {
      const { restaurantName, ownerName, email, password, turnstileToken, meta } = req.validatedBody || req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const phone = typeof meta?.phone === 'string' ? meta.phone.trim() : '';
      const city = typeof meta?.cityRegion === 'string' ? meta.cityRegion.trim() : '';
      const address1 = typeof meta?.addressLine === 'string' ? meta.addressLine.trim() : '';

      if (!restaurantName) return res.status(400).json({ ok: false, error: 'restaurant_name_required' });
      if (!ownerName) return res.status(400).json({ ok: false, error: 'owner_name_required' });
      if (!normalizedEmail) return res.status(400).json({ ok: false, error: 'email_required' });
      if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'password_too_short' });

      const turnstile = await verifyTurnstile({ token: turnstileToken, ip: req.ip });
      if (!turnstile.ok) return res.status(400).json({ ok: false, error: turnstile.error, details: turnstile.details });

      const existingStaff = await db().select(['id']).from('staff').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
      if (existingStaff) return res.status(409).json({ ok: false, error: 'email_in_use' });

      const baseSlug = slugifyWorkspace(restaurantName);

      let provisionOut = null;
      for (let i = 0; i < 5; i += 1) {
        const suffix = i === 0 ? '' : `-${Math.random().toString(16).slice(2, 6)}`;
        const slug = `${baseSlug}${suffix}`.slice(0, 32).replace(/-+$/g, '');
        const out = await provisionTenant({
          slug,
          name: restaurantName,
          trialDays: 14,
          ownerName,
          ownerEmail: normalizedEmail,
          ownerPassword: password,
          branchName: 'Main Branch',
          ownerPhone: phone,
          city,
          address1,
        });
        if (out && out.ok) {
          provisionOut = out;
          break;
        }
        if (!out || out.error !== 'slug_in_use') {
          provisionOut = out;
          break;
        }
      }

      if (!provisionOut || !provisionOut.ok) {
        const err = provisionOut?.error ? String(provisionOut.error) : 'signup_failed';
        const code = err === 'slug_in_use' ? 409 : 400;
        return res.status(code).json({ ok: false, error: err });
      }

      const tenantId = String(provisionOut.tenant?.id || '');
      const out = await loginWithEmailPassword({ tenantId, email: normalizedEmail, password, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(401).json({ ok: false, error: out.error });

      try {
        const trialEndsAt = safeIso(provisionOut.tenant?.trialEndsAt || provisionOut.tenant?.trial_ends_at || '');
        await sendWelcomeEmail({
          toEmail: normalizedEmail,
          toName: ownerName,
          tenantSlug: String(provisionOut.tenant?.slug || ''),
          tenantName: restaurantName,
          trialEndsAt,
        });
      } catch {
        // ignore
      }

      return res.status(201).json({ ok: true, signup: provisionOut, auth: out });
    } catch (e) {
      return next(e);
    }
  });

  const sanitizeChapaText = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    return s
      .replace(/[^A-Za-z0-9\-_. ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const clampMoney = (v) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1000000, Math.round(n * 100) / 100));
  };

  const mapTableStatusFromOrderStatus = (orderStatus) => {
    const st = String(orderStatus || '').trim();
    if (!st) return 'Occupied';
    if (st === 'Paid' || st === 'Voided' || st === 'Refunded') return 'Free';
    if (st === 'Served') return 'Payment';
    if (st === 'Ready') return 'Ready';
    if (st === 'Cooking') return 'Cooking';
    if (st === 'Pending') return 'Pending';
    return 'Occupied';
  };

  const syncRestaurantTableForOrder = async ({ tenantId, branchId, tableId, orderId, nextStatus, nowIso }) => {
    try {
      const tid = String(tenantId || '').trim();
      const bid = String(branchId || '').trim();
      const tbl = String(tableId || '').trim();
      const oid = String(orderId || '').trim();
      const st = String(nextStatus || '').trim();
      if (!tid || !bid || !tbl || !oid) return;

      const terminal = st === 'Paid' || st === 'Voided' || st === 'Refunded';
      if (!terminal) {
        await db()
          .from('restaurant_tables')
          .where({ tenant_id: tid, branch_id: bid, id: tbl })
          .update({ status: mapTableStatusFromOrderStatus(st), open_order_id: oid, last_order_id: oid, updated_at: nowIso });
        return;
      }

      await db().transaction(async (trx) => {
        const row = await trx('restaurant_tables')
          .where({ tenant_id: tid, branch_id: bid, id: tbl })
          .select(['open_order_id'])
          .first();
        const curOpen = row?.open_order_id ? String(row.open_order_id) : '';
        const patch = {
          status: curOpen && curOpen !== oid ? undefined : 'Free',
          open_order_id: curOpen && curOpen !== oid ? undefined : null,
          last_order_id: oid,
          updated_at: nowIso,
        };
        const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        await trx('restaurant_tables')
          .where({ tenant_id: tid, branch_id: bid, id: tbl })
          .update(filtered);
      });
    } catch {
      // ignore
    }
  };

  const loadLink = async ({ token, purpose }) => {
    const row = await db()
      .from('pos_public_order_links')
      .where({ token: String(token || '').trim(), purpose: String(purpose || '').trim() })
      .select(['tenant_id', 'branch_id', 'order_id', 'expires_at', 'meta_json'])
      .first();
    if (!row) return null;
    const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (exp && Number.isFinite(exp) && Date.now() > exp) return { expired: true };
    return {
      tenantId: String(row.tenant_id || ''),
      branchId: String(row.branch_id || ''),
      orderId: String(row.order_id || ''),
      meta: safeJsonParse(row.meta_json, {}),
    };
  };

  r.get('/public/platform-settings', async (_req, res, next) => {
    try {
      // Super Admin UI stores settings in platform_settings_admin.
      // Public clients (index.html branding) should reflect those changes.
      let row = null;
      try {
        row = await db().select(['settings_json']).from('platform_settings_admin').where({ id: 1 }).first();
      } catch {
        row = null;
      }

      if (!row) {
        row = await db().select(['settings_json']).from('platform_settings').where({ id: 1 }).first();
      }

      const settings = (() => {
        try {
          return row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          return {};
        }
      })();
      return res.json({ ok: true, settings });
    } catch (e) {
      // Production safety: do not block login if platform_settings is missing/misconfigured.
      try {
        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        const looksLikeMissing =
          code === 'ER_NO_SUCH_TABLE' ||
          code === 'SQLITE_ERROR' ||
          /no such table/i.test(msg) ||
          /platform_settings/i.test(msg) ||
          /platform_settings_admin/i.test(msg);
        if (looksLikeMissing) return res.json({ ok: true, settings: {} });
      } catch {
        // ignore
      }
      return next(e);
    }
  });

  r.get('/public/pos-links/:token', validateTokenParam, async (req, res, next) => {
    try {
      const { token } = req.validatedParams || req.params;
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'payer' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'tip', 'payload', 'paid_at'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const payload = safeJsonParse(orderRow.payload, {});
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const productIds = Array.from(
        new Set(
          items
            .map((it) => String(it?.productId || it?.product_id || '').trim())
            .filter(Boolean),
        ),
      );
      const imageByProductId = new Map();
      if (productIds.length) {
        const productRows = await db()
          .from('menu_products')
          .where({ tenant_id: link.tenantId })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', link.branchId))
          .whereIn('id', productIds)
          .select(['id', 'product_json']);
        for (const row of productRows) {
          const pj = safeJsonParse(row.product_json, {});
          const img = String(pj?.image || '').trim();
          if (img) imageByProductId.set(String(row.id), img);
        }
      }
      const itemsWithImages = items.map((it) => {
        const pid = String(it?.productId || it?.product_id || '').trim();
        return { ...it, image: imageByProductId.get(pid) || '' };
      });
      const orderNumber = typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : '';
      const tableName = typeof payload?.tableName === 'string' ? String(payload.tableName) : '';

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';

      const tin = typeof settings?.business?.tin === 'string' ? String(settings.business.tin).trim() : '';

      const total = Number(orderRow.total ?? payload?.totalWithTip ?? payload?.paidTotal ?? payload?.total ?? 0) || 0;
      const rowTip = Number(orderRow.tip ?? 0) || 0;
      const payloadTipAmount = Number(payload?.tipAmount ?? 0) || 0;
      const payloadTipPctAmount = Number(payload?.tipPctAmount ?? 0) || 0;
      const payloadHasTipBreakdown = payloadTipAmount > 0 || payloadTipPctAmount > 0;
      const tip = payloadHasTipBreakdown ? (payloadTipAmount + payloadTipPctAmount) : rowTip;

      const payloadSubtotal = Number(payload?.subtotal ?? 0) || 0;
      const payloadTax = Number(payload?.tax ?? 0) || 0;
      const payloadService = Number(payload?.serviceCharge ?? 0) || 0;
      const payloadHasBreakdown = payloadSubtotal > 0 || payloadTax > 0 || payloadService > 0;

      const baseBeforeTip = Math.max(0, total - tip);
      const subtotal = payloadHasBreakdown ? payloadSubtotal : baseBeforeTip;
      const tax = payloadHasBreakdown ? payloadTax : 0;
      const serviceCharge = payloadHasBreakdown ? payloadService : 0;

      const receiptRow = await db()
        .from('pos_public_order_links')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, order_id: link.orderId, purpose: 'receipt' })
        .orderBy('created_at', 'desc')
        .select(['token'])
        .first();

      const receiptToken = receiptRow?.token ? String(receiptRow.token) : '';

      const baseUrl = publicBaseUrlFromReq(req);

      return res.json({
        ok: true,
        cafeName: bizName || 'MirachPOS',
        orderId: String(orderRow.id || link.orderId),
        orderNumber: orderNumber || String(orderRow.id || link.orderId),
        tableName,
        items: itemsWithImages,
        subtotal,
        tax,
        serviceCharge,
        tip,
        total,
        currency: 'ETB',
        paid: String(orderRow.status || '') === 'Paid' || Boolean(orderRow.paid_at),
        receiptUrl: receiptToken ? `${baseUrl}/r/${encodeURIComponent(receiptToken)}` : '',
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/pos-links/:token/initiate-chapa', validateTokenParam, validateChapaInitiate, async (req, res, next) => {
    try {
      const { token } = req.validatedParams || req.params;
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'payer' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'tip', 'payload', 'paid_at'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
      if (String(orderRow.status || '') === 'Paid' || orderRow.paid_at) return res.status(409).json({ error: 'order_already_paid' });

      const { tipAmount, tipPct: tipPctInput } = req.validatedBody || req.body;
      const tipAmountSafe = clampMoney(tipAmount);
      const tipPctValue = (() => {
        const n = Number(tipPctInput);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
      })();

      const baseAmount = clampMoney(orderRow.total);
      const pctAmount = clampMoney((baseAmount * tipPctValue) / 100);
      const tipTotal = clampMoney(tipAmountSafe + pctAmount);
      const total = clampMoney(baseAmount + tipTotal);

      const payload = safeJsonParse(orderRow.payload, {});
      const orderNumber = typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : '';

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';

      const shortOrder = String(orderRow.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || String(orderRow.id).slice(0, 12);
      const rand = Math.random().toString(16).slice(2, 10);
      const txRef = `pos_${shortOrder}_${rand}`;

      const payBaseUrl = publicBaseUrlFromReq(req);
      const apiBaseUrl = apiBaseUrlFromReq(req);
      const callbackUrl = `${apiBaseUrl}/api/webhooks/payment/chapa`;
      const returnUrl = `${payBaseUrl}/p/${encodeURIComponent(token)}?chapa=success`;

      const init = await paymentGatewayService.chapaInitializeForTenantPos({
        tenantId: link.tenantId,
        amount: total,
        currency: 'ETB',
        email: 'pos.customer@mirachpos.com',
        firstName: 'Customer',
        lastName: 'Customer',
        txRef,
        callbackUrl,
        returnUrl,
        customization: {
          title: sanitizeChapaText(bizName) || 'MirachPOS',
          description:
            sanitizeChapaText(orderNumber ? `Order ${orderNumber}` : `Order ${orderRow.id}`) +
            ' . Powered by MirachPOS',
        },
      });

      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      payload.tipAmount = tipAmountSafe;
      payload.tipPct = tipPctValue;
      payload.tipPctAmount = pctAmount;
      payload.totalWithTip = total;
      payload.tip = tipTotal;
      payload.total = total;
      payload.paidTotal = total;
      payload.paymentMethod = 'Mobile Pay';
      payload.chapaTxRef = txRef;

      await db().transaction(async (trx) => {
        await trx.from('pos_payment_gateway_transactions').insert({
          id: makeId('pgt'),
          tenant_id: link.tenantId,
          branch_id: link.branchId,
          order_id: String(orderRow.id),
          gateway: 'chapa',
          method: 'mobile_money',
          tx_ref: txRef,
          gateway_tx_id: null,
          checkout_url: init.checkoutUrl,
          amount: total,
          currency: 'ETB',
          status: 'pending',
          expires_at: expiresAt,
          paid_at: null,
          init_response_json: JSON.stringify(init),
          verify_response_json: null,
          webhook_payload_json: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx
          .from('orders')
          .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: String(orderRow.id) })
          .update({ payload: JSON.stringify(payload), tip: tipTotal, total });

        await trx
          .from('pos_public_order_links')
          .where({ token, purpose: 'payer' })
          .update({ meta_json: JSON.stringify({ ...(link.meta || {}), tipAmount: tipAmountSafe, tipPct: tipPctValue, tipPctAmount: pctAmount, totalWithTip: total }), updated_at: nowIso });
      });

      return res.json({ ok: true, checkoutUrl: init.checkoutUrl });
    } catch (e) {
      const err = String(e?.message || e || '').trim();
      if (err === 'tenant_chapa_not_configured') {
        return res.status(400).json({ ok: false, error: 'tenant_chapa_not_configured', message: 'This cafe has not configured Chapa for POS payments.' });
      }
      const msg = (() => {
        try {
          if (typeof e?.message === 'string' && e.message.trim()) return e.message.trim();
          if (typeof e === 'string' && e.trim()) return e.trim();
          return 'Failed to start payment';
        } catch {
          return 'Failed to start payment';
        }
      })();
      return res.status(500).json({ ok: false, error: 'initiate_chapa_failed', message: msg });
    }
  });

  r.post('/public/pos-links/:token/verify-chapa', validateTokenParam, async (req, res, next) => {
    try {
      const { token } = req.validatedParams || req.params;
      if (!token) return res.status(400).json({ ok: false, error: 'token_required' });

      const link = await loadLink({ token, purpose: 'payer' });
      if (!link) return res.status(404).json({ ok: false, error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ ok: false, error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'payload'])
        .first();
      if (!orderRow) return res.status(404).json({ ok: false, error: 'order_not_found' });

      if (String(orderRow.status || '') === 'Paid' || orderRow.paid_at) {
        return res.json({ ok: true, paid: true });
      }

      const tx = await db()
        .from('pos_payment_gateway_transactions')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, order_id: link.orderId, gateway: 'chapa' })
        .orderBy('created_at', 'desc')
        .select(['id', 'tx_ref', 'status'])
        .first();

      const txRef = tx?.tx_ref ? String(tx.tx_ref).trim() : '';
      if (!txRef) return res.status(409).json({ ok: false, error: 'no_pending_transaction' });

      const verify = await paymentGatewayService.chapaVerifyForTenantPos({ tenantId: link.tenantId, txRef });
      const st = String(verify?.status || '').toLowerCase();
      const success = st === 'success';
      if (!success) return res.json({ ok: true, paid: false, status: st || 'pending' });

      const nowIso = new Date().toISOString();
      const payload = safeJsonParse(orderRow.payload, {});
      payload.paidAt = nowIso;
      payload.paymentMethod = 'Mobile Money';
      payload.paymentReference = txRef;
      payload.chapaVerified = verify?.rawResponse || null;

      await db().transaction(async (trx) => {
        await trx
          .from('orders')
          .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
          .update({ status: 'Paid', paid_at: nowIso, payload: JSON.stringify(payload) });

        const tableId = typeof payload?.tableId === 'string' ? payload.tableId.trim() : '';
        if (tableId) {
          await syncRestaurantTableForOrder({ tenantId: link.tenantId, branchId: link.branchId, tableId, orderId: link.orderId, nextStatus: 'Paid', nowIso });
        }

        if (tx?.id) {
          await trx
            .from('pos_payment_gateway_transactions')
            .where({ id: String(tx.id) })
            .update({ status: 'completed', paid_at: nowIso, verify_response_json: JSON.stringify(verify?.rawResponse || null), updated_at: nowIso });
        }
      });

      return res.json({ ok: true, paid: true });
    } catch (e) {
      const err = String(e?.message || e || '').trim();
      if (err === 'tenant_chapa_not_configured') {
        return res.status(400).json({ ok: false, error: 'tenant_chapa_not_configured', message: 'This cafe has not configured Chapa for POS payments.' });
      }
      return next(e);
    }
  });

  r.get('/public/pos-receipt/:token', validateTokenParam, async (req, res, next) => {
    try {
      const { token } = req.validatedParams || req.params;
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'receipt' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'tip', 'payload', 'paid_at'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const payload = safeJsonParse(orderRow.payload, {});
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const productIds = Array.from(
        new Set(
          items
            .map((it) => String(it?.productId || it?.product_id || '').trim())
            .filter(Boolean),
        ),
      );
      const imageByProductId = new Map();
      if (productIds.length) {
        const productRows = await db()
          .from('menu_products')
          .where({ tenant_id: link.tenantId })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', link.branchId))
          .whereIn('id', productIds)
          .select(['id', 'product_json']);
        for (const row of productRows) {
          const pj = safeJsonParse(row.product_json, {});
          const img = String(pj?.image || '').trim();
          if (img) imageByProductId.set(String(row.id), img);
        }
      }
      const itemsWithImages = items.map((it) => {
        const pid = String(it?.productId || it?.product_id || '').trim();
        return { ...it, image: imageByProductId.get(pid) || '' };
      });

      const tableName = typeof payload?.tableName === 'string' ? String(payload.tableName).trim() : '';
      const waiterName = typeof payload?.createdByName === 'string' ? String(payload.createdByName).trim() : '';
      const operatorName = typeof payload?.paidByName === 'string' ? String(payload.paidByName).trim() : '';
      const paymentReference = typeof payload?.paymentReference === 'string' ? String(payload.paymentReference).trim() : '';
      const paymentMethod = typeof payload?.paymentMethod === 'string' ? String(payload.paymentMethod).trim() : '';

      const total = Number(orderRow.total ?? payload?.totalWithTip ?? payload?.paidTotal ?? payload?.total ?? 0) || 0;

      const rowTip = Number(orderRow.tip ?? 0) || 0;
      const payloadTipAmount = Number(payload?.tipAmount ?? 0) || 0;
      const payloadTipPctAmount = Number(payload?.tipPctAmount ?? 0) || 0;
      const payloadHasTipBreakdown = payloadTipAmount > 0 || payloadTipPctAmount > 0;
      const tip = payloadHasTipBreakdown ? payloadTipAmount + payloadTipPctAmount : rowTip;

      const payloadSubtotal = Number(payload?.subtotal ?? 0) || 0;
      const payloadTax = Number(payload?.tax ?? 0) || 0;
      const payloadService = Number(payload?.serviceCharge ?? 0) || 0;
      const payloadHasBreakdown = payloadSubtotal > 0 || payloadTax > 0 || payloadService > 0;

      const baseBeforeTip = Math.max(0, total - tip);
      const subtotal = payloadHasBreakdown ? payloadSubtotal : baseBeforeTip;
      const tax = payloadHasBreakdown ? payloadTax : 0;
      const serviceCharge = payloadHasBreakdown ? payloadService : 0;

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';
      const tin = typeof settings?.business?.tin === 'string' ? String(settings.business.tin).trim() : '';
      const phone = typeof settings?.business?.phone === 'string' ? String(settings.business.phone).trim() : '';
      const address = typeof settings?.business?.address === 'string' ? String(settings.business.address).trim() : '';

      return res.json({
        ok: true,
        cafeName: bizName || 'MirachPOS',
        tin,
        phone,
        address,
        orderId: String(orderRow.id),
        orderNumber: typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : String(orderRow.id),
        tableName,
        waiterName,
        operatorName,
        paymentReference,
        paymentMethod,
        status: String(orderRow.status || ''),
        paidAt: payload?.paidAt || orderRow.paid_at || null,
        currency: 'ETB',
        items: itemsWithImages,
        subtotal,
        tax,
        serviceCharge,
        tipAmount: payloadHasTipBreakdown ? payloadTipAmount : tip,
        tipPct: payloadHasTipBreakdown ? Number(payload?.tipPct ?? 0) : 0,
        tipPctAmount: payloadHasTipBreakdown ? payloadTipPctAmount : 0,
        total,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/public/pos-display/:token', validateTokenParam, async (req, res, next) => {
    try {
      const { token } = req.validatedParams || req.params;
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'display' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const includeMenuRaw = String(req.query?.includeMenu || '').trim().toLowerCase();
      const includeMenu = includeMenuRaw === '1' || includeMenuRaw === 'true';

      const displayModeRaw = typeof link?.meta?.mode === 'string' ? link.meta.mode : 'payment';
      const displayMode = ['menu', 'payment', 'receipt'].includes(displayModeRaw) ? displayModeRaw : 'payment';

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';

      const managerRow = await db()
        .select(['settings_json'])
        .from('manager_settings')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId })
        .first();
      const managerSettings = safeJsonParse(managerRow?.settings_json, {});
      const overrideRaw = String(managerSettings?.customerDisplay?.mode || '').trim().toLowerCase();
      const overrideMode = ['menu', 'payment', 'receipt'].includes(overrideRaw) ? overrideRaw : 'auto';
      const effectiveMode = overrideMode !== 'auto' ? overrideMode : displayMode;
      const baseUrl = publicBaseUrlFromReq(req);

      const paymentDetails = (() => {
        const payments = managerSettings?.payments && typeof managerSettings.payments === 'object' ? managerSettings.payments : {};
        const qrCodes = payments?.qrCodes && typeof payments.qrCodes === 'object' ? payments.qrCodes : {};
        const qrDetails = payments?.qrDetails && typeof payments.qrDetails === 'object' ? payments.qrDetails : {};
        const normalize = (v) => (typeof v === 'string' ? String(v).trim() : '');
        const normalizeUrl = (v) => {
          const raw = normalize(v);
          if (!raw) return '';
          if (/^https?:\/\//i.test(raw)) return raw;
          if (raw.startsWith('/')) return baseUrl + raw;
          return raw;
        };
        const normalizeObj = (rawObj, legacyImage) => {
          const o = rawObj && typeof rawObj === 'object' ? rawObj : {};
          return {
            image: normalizeUrl(o.image) || normalizeUrl(legacyImage),
            accountName: normalize(o.accountName),
            phone: normalize(o.phone),
            merchantId: normalize(o.merchantId),
            accountNumber: normalize(o.accountNumber),
            bankName: normalize(o.bankName),
            note: normalize(o.note),
          };
        };

        return {
          telebirr: normalizeObj(qrDetails.telebirr, qrCodes.telebirr),
          bankTransfer: normalizeObj(qrDetails.bank_transfer, qrCodes.bank_transfer),
          card: normalizeObj(qrDetails.card, qrCodes.card),
        };
      })();

      const loadMenuData = async () => {
        let base = db().from('menu_products').where({ tenant_id: link.tenantId });
        base = base.andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', link.branchId));
        const rows = await base.select(['id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at']);

        const products = rows.map((row) => {
          const pj = safeJsonParse(row.product_json, {});
          return {
            id: String(row.id),
            name: String(row.name || ''),
            price: Number(row.price || 0) || 0,
            category: String(row.category || 'Uncategorized'),
            image: String(pj?.image || ''),
            description: String(pj?.description || ''),
            status: String(row.status || 'Active'),
          };
        });

        const categoriesRows = await db()
          .from('menu_products')
          .where({ tenant_id: link.tenantId })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', link.branchId))
          .distinct('category as c');

        const categories = Array.from(new Set(categoriesRows.map((x) => String(x.c || 'Uncategorized'))))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        return { categories, products };
      };

      if (effectiveMode === 'menu') {
        const menu = await loadMenuData();
        return res.json({
          ok: true,
          mode: 'menu',
          modeOverride: overrideMode !== 'auto' ? overrideMode : null,
          cafeName: bizName || 'MirachPOS',
          currency: 'ETB',
          menu,
        });
      }

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'tip', 'payload', 'paid_at', 'payment_method', 'payment_reference'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const payload = safeJsonParse(orderRow.payload, {});
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const productIds = Array.from(
        new Set(
          items
            .map((it) => String(it?.productId || it?.product_id || '').trim())
            .filter(Boolean),
        ),
      );
      const imageByProductId = new Map();
      if (productIds.length) {
        const productRows = await db()
          .from('menu_products')
          .where({ tenant_id: link.tenantId })
          .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', link.branchId))
          .whereIn('id', productIds)
          .select(['id', 'product_json']);
        for (const row of productRows) {
          const pj = safeJsonParse(row.product_json, {});
          const img = String(pj?.image || '').trim();
          if (img) imageByProductId.set(String(row.id), img);
        }
      }
      const itemsWithImages = items.map((it) => {
        const pid = String(it?.productId || it?.product_id || '').trim();
        return { ...it, image: imageByProductId.get(pid) || '' };
      });

      const tableName = typeof payload?.tableName === 'string' ? String(payload.tableName).trim() : '';

      const total = Number(orderRow.total ?? payload?.totalWithTip ?? payload?.paidTotal ?? payload?.total ?? 0) || 0;
      const rowTip = Number(orderRow.tip ?? 0) || 0;
      const payloadTipAmount = Number(payload?.tipAmount ?? 0) || 0;
      const payloadTipPctAmount = Number(payload?.tipPctAmount ?? 0) || 0;
      const payloadHasTipBreakdown = payloadTipAmount > 0 || payloadTipPctAmount > 0;
      const tip = payloadHasTipBreakdown ? payloadTipAmount + payloadTipPctAmount : rowTip;

      const payloadSubtotal = Number(payload?.subtotal ?? 0) || 0;
      const payloadTax = Number(payload?.tax ?? 0) || 0;
      const payloadService = Number(payload?.serviceCharge ?? 0) || 0;
      const payloadHasBreakdown = payloadSubtotal > 0 || payloadTax > 0 || payloadService > 0;

      const baseBeforeTip = Math.max(0, total - tip);
      const subtotal = payloadHasBreakdown ? payloadSubtotal : baseBeforeTip;
      const tax = payloadHasBreakdown ? payloadTax : 0;
      const serviceCharge = payloadHasBreakdown ? payloadService : 0;
      const linkPaymentMethod = typeof link?.meta?.paymentMethod === 'string' ? link.meta.paymentMethod : '';
      const linkPaymentUrl = typeof link?.meta?.paymentUrl === 'string' ? link.meta.paymentUrl : '';
      const paymentMethod = String(payload?.paymentMethod || orderRow?.payment_method || linkPaymentMethod || '').trim();
      const paymentReference = String(payload?.paymentReference || orderRow?.payment_reference || '').trim();

      const menu = includeMenu ? await loadMenuData() : null;

      return res.json({
        ok: true,
        mode: effectiveMode,
        modeOverride: overrideMode !== 'auto' ? overrideMode : null,
        cafeName: bizName || 'MirachPOS',
        orderId: String(orderRow.id),
        orderNumber: typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : String(orderRow.id),
        tableName,
        status: String(orderRow.status || ''),
        paidAt: payload?.paidAt || orderRow.paid_at || null,
        paymentMethod,
        paymentReference,
        paymentUrl: linkPaymentUrl,
        paymentDetails,
        currency: 'ETB',
        items: itemsWithImages,
        subtotal,
        tax,
        serviceCharge,
        tipAmount: payloadHasTipBreakdown ? payloadTipAmount : tip,
        total,
        ...(menu ? { menu } : {}),
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/demo-requests', validateDemoRequest, async (req, res, next) => {
    try {
      const { name, email, phone, company, country, source, message } = req.validatedBody || req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!normalizedEmail) return res.status(400).json({ error: 'email_required' });

      const id = makeId('demo');
      const nowIso = new Date().toISOString();

      const meta = {
        ip: typeof req.ip === 'string' ? req.ip : '',
        userAgent: typeof req.header('user-agent') === 'string' ? req.header('user-agent') : '',
        referer: typeof req.header('referer') === 'string' ? req.header('referer') : '',
      };

      await db().from('demo_requests').insert({
        id,
        status: 'New',
        name,
        email: normalizedEmail,
        phone: phone || null,
        company: company || null,
        country: country || null,
        source: source || null,
        message: message || null,
        meta_json: JSON.stringify(meta),
        provisioned_tenant_id: null,
        processed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, requestId: id });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/accept-invite', validateAcceptInvite, async (req, res, next) => {
    try {
      const { code, name, email, password } = req.validatedBody || req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!code) return res.status(400).json({ error: 'invite_code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!normalizedEmail) return res.status(400).json({ error: 'email_required' });
      if (!password || password.length < 6) return res.status(400).json({ error: 'password_too_short' });

      const inv = await db()
        .select(['id', 'tenant_id', 'role_name', 'branch_id', 'expires_at', 'used_at'])
        .from('owner_invites')
        .where({ code })
        .first();
      if (!inv) return res.status(404).json({ error: 'invite_not_found' });
      if (inv.used_at) return res.status(409).json({ error: 'invite_already_used' });

      const exp = inv.expires_at ? new Date(inv.expires_at).getTime() : 0;
      if (exp && Number.isFinite(exp) && Date.now() > exp) return res.status(410).json({ error: 'invite_expired' });

      const tenantId = String(inv.tenant_id || '');
      if (!tenantId) return res.status(400).json({ error: 'invite_invalid_tenant' });

      const roleName = String(inv.role_name || '').trim();
      const allowed = new Set(['Branch Manager', 'Waiter']);
      if (!allowed.has(roleName)) return res.status(400).json({ error: 'invite_invalid_role' });

      const tenant = await db().select(['id', 'slug', 'name']).from('tenants').where({ id: tenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const existing = await db().select(['id']).from('staff').where({ tenant_id: tenantId, email: normalizedEmail }).first();
      if (existing) return res.status(409).json({ error: 'email_in_use' });

      const branchId = inv.branch_id ? String(inv.branch_id) : '';
      const branch = branchId ? await db().select(['id', 'name']).from('branches').where({ tenant_id: tenantId, id: branchId }).first() : null;
      if (branchId && !branch) return res.status(400).json({ error: 'invite_invalid_branch' });

      const staffId = makeId('stf');
      const nowIso = new Date().toISOString();
      const passwordHash = await bcrypt.hash(password, 10);

      await db().transaction(async (trx) => {
        await trx.from('staff').insert({
          id: staffId,
          tenant_id: tenantId,
          branch_id: branchId || null,
          role_id: null,
          role_name: roleName,
          name,
          email: normalizedEmail,
          phone: null,
          code: null,
          password_hash: passwordHash,
          pin_hash: null,
          status: 'Active',
          last_login_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx
          .from('owner_invites')
          .where({ id: String(inv.id) })
          .update({ used_at: nowIso, used_by_staff_id: staffId });
      });

      const out = await loginWithEmailPassword({ tenantId, email: normalizedEmail, password, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(401).json({ error: out.error });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/contact-admin', validateContactAdmin, async (req, res, next) => {
    try {
      const { name, email, phone, message } = req.validatedBody || req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!normalizedEmail) return res.status(400).json({ error: 'email_required' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const id = makeId('demo');
      const nowIso = new Date().toISOString();
      const meta = {
        ip: typeof req.ip === 'string' ? req.ip : '',
        userAgent: typeof req.header('user-agent') === 'string' ? req.header('user-agent') : '',
        referer: typeof req.header('referer') === 'string' ? req.header('referer') : '',
        type: 'contact_admin',
      };

      await db().from('demo_requests').insert({
        id,
        status: 'New',
        name,
        email,
        phone: phone || null,
        company: null,
        country: null,
        source: 'contact_admin',
        message,
        meta_json: JSON.stringify(meta),
        provisioned_tenant_id: null,
        processed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, requestId: id });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makePublicRouter };
