const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { resolveCdnUrl } = require('../../utils/cdn');
const {
  validateSuperadminBillingVerify,
  validateSuperadminBillingManualInvoice,
  validateSuperadminBillingSetNextBill,
  validateSuperadminBillingSetGrace,
  validateSuperadminBillingSetStatus,
  validateSuperadminBillingSetCycle,
  validateSuperadminBillingSetMethod,
  validateSuperadminPaymentsPendingQuery,
} = require('../../middleware/validators');
const { createManualInvoice } = require('../../services/invoiceService');

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  const x = Number.isFinite(n) ? n : def;
  return Math.max(min, Math.min(max, x));
};

const makeSuperadminBillingRouter = () => {
  const r = express.Router();

  r.get('/superadmin/billing', requireSuperadmin, async (_req, res, next) => {
    try {
      const subs = await db()
        .from({ s: 'tenant_subscription' })
        .leftJoin({ t: 'tenants' }, 't.id', 's.tenant_id')
        .select([
          's.tenant_id',
          's.tier',
          's.cycle',
          's.status',
          's.method',
          's.next_bill_at',
          's.amount_etb',
          's.grace_ends_at',
          't.name as tenant_name',
        ])
        .orderBy('t.name', 'asc');

      const nowMs = Date.now();
      let totalActive = 0;
      let atRisk = 0;
      for (const s of subs) {
        if (String(s.status || '').toLowerCase() === 'active') totalActive += 1;
        const grace = s.grace_ends_at ? new Date(s.grace_ends_at).getTime() : NaN;
        if (Number.isFinite(grace) && grace < nowMs) atRisk += 1;
      }

      const pendingPaymentsRow = await db().from('payments').count({ c: '*' }).where({ status: 'pending' }).first();
      const pendingVerify = Number(pendingPaymentsRow?.c ?? pendingPaymentsRow?.count ?? pendingPaymentsRow?.['count(*)'] ?? 0) || 0;

      const subscriptions = subs.map((s) => ({
        tenantId: String(s.tenant_id),
        tenantName: String(s.tenant_name || ''),
        plan: String(s.tier || ''),
        cycle: String(s.cycle || ''),
        requestedPlan: '',
        requestedCycle: '',
        nextBillAt: toIso(s.next_bill_at),
        amountEtb: Number(s.amount_etb || 0) || 0,
        method: String(s.method || ''),
        status: String(s.status || ''),
        graceEndsAt: toIso(s.grace_ends_at),
      }));

      return res.json({
        ok: true,
        overview: { totalActive, pendingVerify, monthlyRevenueEtb: 0, atRisk },
        subscriptions,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/verify', requireSuperadmin, validateSuperadminBillingVerify, async (req, res, next) => {
    try {
      const { tenantId } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ status: 'active', updated_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/manual-invoice', requireSuperadmin, validateSuperadminBillingManualInvoice, async (req, res, next) => {
    try {
      const { tenantId, amountEtb, dueAt, notes } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const amount = Number(amountEtb || 0);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });

      let dueInDays = 7;
      if (dueAt) {
        const dueMs = new Date(dueAt).getTime();
        const nowMs = Date.now();
        if (Number.isFinite(dueMs) && dueMs > nowMs) {
          dueInDays = Math.max(1, Math.ceil((dueMs - nowMs) / (24 * 60 * 60 * 1000)));
        }
      }

      const invoice = await createManualInvoice({
        tenantId,
        lineItems: [{ description: 'Manual invoice', qty: 1, unitPrice: amount, amount }],
        dueInDays,
        notes: notes || null,
      });

      return res.status(201).json({ ok: true, invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-nextbill', requireSuperadmin, validateSuperadminBillingSetNextBill, async (req, res, next) => {
    try {
      const { tenantId, nextBillAt } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ next_bill_at: nextBillAt, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-grace', requireSuperadmin, validateSuperadminBillingSetGrace, async (req, res, next) => {
    try {
      const { tenantId, graceEndsAt } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ grace_ends_at: graceEndsAt, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-status', requireSuperadmin, validateSuperadminBillingSetStatus, async (req, res, next) => {
    try {
      const { tenantId, status } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ status, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-cycle', requireSuperadmin, validateSuperadminBillingSetCycle, async (req, res, next) => {
    try {
      const { tenantId, cycle } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ cycle, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-method', requireSuperadmin, validateSuperadminBillingSetMethod, async (req, res, next) => {
    try {
      const { tenantId, method } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ method, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/payments/pending', requireSuperadmin, validateSuperadminPaymentsPendingQuery, async (req, res, next) => {
    try {
      const { limit: limitRaw } = req.validatedQuery || req.query;
      const limit = clampInt(limitRaw, 50, 1, 200);
      const rows = await db()
        .from({ p: 'payments' })
        .leftJoin({ i: 'invoices' }, 'i.id', 'p.invoice_id')
        .leftJoin({ t: 'tenants' }, 't.id', 'p.tenant_id')
        .select([
          'p.id as payment_id',
          'p.invoice_id',
          'i.invoice_number',
          'p.tenant_id',
          't.name as tenant_name',
          'p.method',
          'p.amount_etb',
          'p.reference',
          'p.proof_url',
          'p.proof_filename',
          'p.created_at',
        ])
        .where({ 'p.status': 'pending' })
        .orderBy('p.created_at', 'desc')
        .limit(limit);

      const pendingPayments = rows.map((r) => ({
        paymentId: String(r.payment_id),
        invoiceId: String(r.invoice_id || ''),
        invoiceNumber: String(r.invoice_number || ''),
        tenantId: String(r.tenant_id || ''),
        tenantName: String(r.tenant_name || ''),
        method: String(r.method || ''),
        amountEtb: Number(r.amount_etb || 0) || 0,
        reference: String(r.reference || ''),
        submittedAt: toIso(r.created_at),
        proofUrl: resolveCdnUrl(String(r.proof_url || '')),
        proofFilename: String(r.proof_filename || ''),
      }));

      return res.json({ ok: true, pendingPayments });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminBillingRouter };
