const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { config } = require('../config');
const { loginWithEmailPassword } = require('../services/authService');
const paymentGatewayService = require('../services/paymentGatewayService');

const makePublicRouter = () => {
  const r = express.Router();

  const sanitizeChapaText = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    return s
      .replace(/[^A-Za-z0-9\-_. ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const safeJsonParse = (raw, fallback) => {
    try {
      if (raw == null) return fallback;
      if (typeof raw === 'object') return raw;
      return JSON.parse(String(raw));
    } catch {
      return fallback;
    }
  };

  const clampMoney = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100) / 100);
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
      const row = await db().select(['settings_json']).from('platform_settings').where({ id: 1 }).first();
      const settings = (() => {
        try {
          return row?.settings_json ? JSON.parse(String(row.settings_json)) : {};
        } catch {
          return {};
        }
      })();
      return res.json({ ok: true, settings });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/public/pos-links/:token', async (req, res, next) => {
    try {
      const token = String(req.params.token || '').trim();
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
      const orderNumber = typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : '';
      const tableName = typeof payload?.tableName === 'string' ? String(payload.tableName) : '';

      const subtotal = Number(payload?.subtotal ?? 0) || 0;
      const tax = Number(payload?.tax ?? 0) || 0;
      const serviceCharge = Number(payload?.serviceCharge ?? 0) || 0;

      const tipFromBreakdown = (Number(payload?.tipAmount ?? 0) || 0) + (Number(payload?.tipPctAmount ?? 0) || 0);
      const tip = Number(orderRow.tip ?? payload?.tip ?? tipFromBreakdown ?? 0) || 0;

      const total = Number(orderRow.total ?? payload?.totalWithTip ?? payload?.paidTotal ?? payload?.total ?? 0) || 0;

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';
      const tin = typeof settings?.business?.tin === 'string' ? String(settings.business.tin).trim() : '';
      const phone = typeof settings?.business?.phone === 'string' ? String(settings.business.phone).trim() : '';
      const address = typeof settings?.business?.address === 'string' ? String(settings.business.address).trim() : '';

      const receiptRow = await db()
        .from('pos_public_order_links')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, order_id: link.orderId, purpose: 'receipt' })
        .orderBy('created_at', 'desc')
        .select(['token'])
        .first();

      const receiptToken = receiptRow?.token ? String(receiptRow.token) : '';

      const baseUrl = req.protocol + '://' + req.get('host');

      return res.json({
        ok: true,
        cafeName: bizName || 'MirachPOS',
        orderId: String(orderRow.id || link.orderId),
        orderNumber: orderNumber || String(orderRow.id || link.orderId),
        tableName,
        items,
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

  r.post('/public/pos-links/:token/initiate-chapa', async (req, res, next) => {
    try {
      const token = String(req.params.token || '').trim();
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'payer' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'payload', 'paid_at'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
      if (String(orderRow.status || '') === 'Paid' || orderRow.paid_at) return res.status(409).json({ error: 'order_already_paid' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const tipAmount = clampMoney(body.tipAmount);
      const tipPct = (() => {
        const n = Number(body.tipPct);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
      })();

      const baseAmount = clampMoney(orderRow.total);
      const pctAmount = clampMoney((baseAmount * tipPct) / 100);
      const tipTotal = clampMoney(tipAmount + pctAmount);
      const total = clampMoney(baseAmount + tipTotal);

      const payload = safeJsonParse(orderRow.payload, {});
      const orderNumber = typeof payload?.number === 'string' && payload.number.trim() ? String(payload.number).trim() : '';

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: link.tenantId }).first();
      const settings = safeJsonParse(settingsRow?.settings_json, {});
      const bizName = typeof settings?.business?.businessName === 'string' ? String(settings.business.businessName).trim() : '';

      const shortOrder = String(orderRow.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || String(orderRow.id).slice(0, 12);
      const rand = Math.random().toString(16).slice(2, 10);
      const txRef = `pos_${shortOrder}_${rand}`;

      const baseUrl = req.protocol + '://' + req.get('host');
      const callbackUrl = `${baseUrl}/api/webhooks/payment/chapa`;
      const returnUrl = `${baseUrl}/p/${encodeURIComponent(token)}?chapa=success`;

      const init = await paymentGatewayService.chapaInitialize({
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

      payload.tipAmount = tipAmount;
      payload.tipPct = tipPct;
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
          .update({ meta_json: JSON.stringify({ ...(link.meta || {}), tipAmount, tipPct, tipPctAmount: pctAmount, totalWithTip: total }), updated_at: nowIso });
      });

      return res.json({ ok: true, checkoutUrl: init.checkoutUrl });
    } catch (e) {
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

  r.get('/public/pos-receipt/:token', async (req, res, next) => {
    try {
      const token = String(req.params.token || '').trim();
      if (!token) return res.status(400).json({ error: 'token_required' });

      const link = await loadLink({ token, purpose: 'receipt' });
      if (!link) return res.status(404).json({ error: 'link_not_found' });
      if (link.expired) return res.status(410).json({ error: 'link_expired' });

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: link.tenantId, branch_id: link.branchId, id: link.orderId })
        .select(['id', 'status', 'total', 'payload', 'paid_at'])
        .first();
      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const payload = safeJsonParse(orderRow.payload, {});
      const items = Array.isArray(payload?.items) ? payload.items : [];

      const tableName = typeof payload?.tableName === 'string' ? String(payload.tableName).trim() : '';
      const waiterName = typeof payload?.createdByName === 'string' ? String(payload.createdByName).trim() : '';
      const operatorName = typeof payload?.paidByName === 'string' ? String(payload.paidByName).trim() : '';
      const paymentReference = typeof payload?.paymentReference === 'string' ? String(payload.paymentReference).trim() : '';
      const paymentMethod = typeof payload?.paymentMethod === 'string' ? String(payload.paymentMethod).trim() : '';

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
        items,
        subtotal: Number(payload?.subtotal ?? 0),
        tax: Number(payload?.tax ?? 0),
        serviceCharge: Number(payload?.serviceCharge ?? 0),
        tipAmount: Number(payload?.tipAmount ?? 0),
        tipPct: Number(payload?.tipPct ?? 0),
        tipPctAmount: Number(payload?.tipPctAmount ?? 0),
        total: Number(payload?.totalWithTip ?? orderRow.total ?? 0),
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/public/demo-requests', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const company = typeof body?.company === 'string' ? body.company.trim() : '';
      const country = typeof body?.country === 'string' ? body.country.trim() : '';
      const source = typeof body?.source === 'string' ? body.source.trim() : '';
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });

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
        email,
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

  r.post('/public/accept-invite', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body?.password === 'string' ? body.password : '';

      if (!code) return res.status(400).json({ error: 'invite_code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });
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

      const existing = await db().select(['id']).from('staff').where({ tenant_id: tenantId, email }).first();
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
          email,
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

      const out = await loginWithEmailPassword({ tenantId, email, password, jwtSecret: config.jwtSecret });
      if (!out.ok) return res.status(401).json({ error: out.error });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/contact-admin', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!email) return res.status(400).json({ error: 'email_required' });
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
