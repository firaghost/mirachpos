const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    return JSON.parse(String(raw)) ?? fallback;
  } catch {
    return fallback;
  }
};

const { computeTenantEntitlements, getOrCreateTenantSubscription, normalizeTier, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');
const {
  getPlatformPaymentConfig,
  generateSubscriptionInvoice,
  getTenantInvoices,
  getInvoiceDetails,
  recordPaymentSubmission,
  calculateProration,
  getPlanPricing,
} = require('../services/invoiceService');
const {
  getAvailablePaymentMethods,
  initializePayment,
} = require('../services/paymentGatewayService');

// Configure multer for payment proof uploads
const uploadsDir = path.join(__dirname, '../../uploads/payment_proofs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `proof_${req.tenant?.id || 'unknown'}_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPG, PNG, PDF, GIF, WEBP'));
    }
  },
});

const logAudit = async ({ tenantId, branchId, actorStaffId, actorRole, type, summary, payload }) => {
  try {
    await db().from('audit_log').insert({
      id: makeId('aud'),
      tenant_id: tenantId,
      branch_id: branchId || null,
      actor_staff_id: actorStaffId || null,
      actor_role: actorRole || null,
      type,
      summary: summary || null,
      payload_json: payload != null ? JSON.stringify(payload) : null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // ignore
  }
};

const makeSubscriptionRouter = () => {
  const r = express.Router();

  // Get current subscription and entitlements
  r.get('/owner/subscription', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      await getOrCreateTenantSubscription(req.tenant);
      const ent = await computeTenantEntitlements({ tenant: req.tenant });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: req.tenant.id, entitlements: ent });
      return res.json(ent);
    } catch (e) {
      return next(e);
    }
  });

  // List available subscription plans
  r.get('/owner/plans', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const rows = await db()
        .select(['tier', 'modules_json', 'limits_json', 'price_monthly_etb', 'price_yearly_etb'])
        .from('plans')
        .orderBy('tier', 'asc');

      const plans = (rows || []).map((r) => ({
        tier: String(r.tier || ''),
        modules: safeJsonParse(r.modules_json, []),
        limits: safeJsonParse(r.limits_json, {}),
        pricing: {
          monthlyEtb: Number(r.price_monthly_etb || 0),
          yearlyEtb: Number(r.price_yearly_etb || 0),
        },
      }));

      return res.json({ ok: true, plans });
    } catch (e) {
      return next(e);
    }
  });

  // Request subscription change (creates invoice)
  r.post('/owner/subscription', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      await getOrCreateTenantSubscription(req.tenant);
      const subRow = await db().select(['status', 'tier', 'cycle', 'amount_etb', 'next_bill_at']).from('tenant_subscription').where({ tenant_id: req.tenant.id }).first();
      const curStatus = String(subRow?.status || '').toLowerCase().replace(/\s+/g, '_');

      // Check for pending invoice
      const pendingInvoice = await db()
        .select(['id'])
        .from('invoices')
        .where({ tenant_id: req.tenant.id, status: 'pending' })
        .first();

      if (pendingInvoice) {
        return res.status(409).json({
          error: 'pending_invoice_exists',
          message: 'You have a pending invoice. Please complete payment or wait for it to be processed.',
          invoiceId: pendingInvoice.id,
        });
      }

      const tier = typeof req.body?.tier === 'string' ? req.body.tier.trim() : '';
      const cycle = typeof req.body?.cycle === 'string' ? req.body.cycle.trim() : '';
      if (!tier) return res.status(400).json({ error: 'tier_required' });

      const nowIso = new Date().toISOString();
      const nextTier = normalizeTier(tier);
      const nextCycle = cycle || 'Monthly';

      // Calculate if proration is needed
      const currentTier = subRow?.tier || 'Trial';
      const currentCycle = subRow?.cycle || 'Monthly';
      const currentAmount = Number(subRow?.amount_etb || 0) || 0;
      const newAmount = await getPlanPricing(nextTier, nextCycle);

      let prorationData = null;
      let isProrated = false;

      if (currentTier !== 'Trial' && currentTier !== nextTier && subRow?.next_bill_at) {
        const nextBillDate = new Date(subRow.next_bill_at);
        const now = new Date();
        const daysRemaining = Math.max(0, Math.ceil((nextBillDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        const isYearly = currentCycle.toLowerCase() === 'yearly';
        const totalDays = isYearly ? 365 : 30;

        if (daysRemaining > 0) {
          isProrated = true;
          prorationData = calculateProration({
            currentPlan: currentTier,
            newPlan: nextTier,
            daysRemaining,
            totalDays,
            currentAmount,
            newAmount,
          });
        }
      }

      // Generate invoice
      const invoice = await generateSubscriptionInvoice({
        tenantId: req.tenant.id,
        tier: nextTier,
        cycle: nextCycle,
        isProrated,
        prorationData,
        dueInDays: 7,
      });

      // Enterprise flow: keep current subscription active until payment is verified.
      // Track requested change, and let invoice/payment lifecycle drive verification.
      await db()
        .from('tenant_subscription')
        .where({ tenant_id: req.tenant.id })
        .update({
          requested_tier: nextTier,
          requested_cycle: nextCycle,
          requested_at: nowIso,
          updated_at: nowIso,
        });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.subscription.requested',
        summary: `Requested subscription change to ${nextTier} (${nextCycle})`,
        payload: { tier: nextTier, cycle: nextCycle, invoiceId: invoice.invoiceId },
      });

      const ent = await computeTenantEntitlements({ tenant: req.tenant });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: req.tenant.id, entitlements: ent });

      return res.status(202).json({
        ok: true,
        status: curStatus || 'active',
        message: 'Invoice created. Please complete payment.',
        invoice: {
          id: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          dueDate: invoice.dueDate,
        },
        entitlements: ent,
      });
    } catch (e) {
      return next(e);
    }
  });

  // Get payment instructions and available methods
  r.get('/owner/payment-instructions', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const methods = await getAvailablePaymentMethods();

      return res.json({
        ok: true,
        methods,
      });
    } catch (e) {
      return next(e);
    }
  });

  // List invoices for tenant
  r.get('/owner/invoices', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);

      const invoices = await getTenantInvoices({
        tenantId: req.tenant.id,
        limit,
        offset,
      });

      return res.json({ ok: true, invoices });
    } catch (e) {
      return next(e);
    }
  });

  // Get single invoice details
  r.get('/owner/invoices/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const invoiceId = String(req.params?.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });

      const invoice = await getInvoiceDetails(invoiceId);

      if (!invoice) {
        return res.status(404).json({ error: 'not_found' });
      }

      if (invoice.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: 'forbidden' });
      }

      return res.json({ ok: true, invoice });
    } catch (e) {
      return next(e);
    }
  });

  // Download Invoice PDF
  r.get('/owner/invoices/:id/pdf', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const invoiceId = String(req.params?.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });

      const invoice = await getInvoiceDetails(invoiceId);
      if (!invoice) return res.status(404).json({ error: 'not_found' });
      if (invoice.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      // Dynamically require
      const { generateInvoicePDF } = require('../services/pdfService');
      let pdfBuffer;
      try {
        pdfBuffer = await generateInvoicePDF(invoiceId);
      } catch (err) {
        console.error('[InvoicePDF] Failed to generate owner invoice PDF', { invoiceId, tenantId: req.tenant.id, err });
        return res.status(500).json({ error: 'invoice_pdf_failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoiceNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (e) {
      return next(e);
    }
  });

  // Submit payment proof (bank transfer)
  r.post('/owner/invoices/:id/pay', tenantMiddleware, requireAuth, upload.single('proof'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const invoiceId = String(req.params?.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });

      const invoice = await getInvoiceDetails(invoiceId);

      if (!invoice) {
        return res.status(404).json({ error: 'invoice_not_found' });
      }

      if (invoice.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: 'forbidden' });
      }

      if (invoice.status === 'paid') {
        return res.status(409).json({ error: 'invoice_already_paid' });
      }

      const method = String(req.body?.method || 'bank_transfer').trim();
      const reference = String(req.body?.reference || '').trim();
      const notes = String(req.body?.notes || '').trim();

      if (!req.file) {
        return res.status(400).json({ error: 'proof_required', message: 'Payment proof attachment is required' });
      }

      let proofUrl = null;
      let proofFilename = null;

      proofUrl = `/uploads/payment_proofs/${req.file.filename}`;
      proofFilename = req.file.originalname;

      const { paymentId } = await recordPaymentSubmission({
        invoiceId,
        tenantId: req.tenant.id,
        method,
        amount: invoice.totalEtb,
        reference,
        proofUrl,
        proofFilename,
        notes,
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.payment.submitted',
        summary: `Payment submitted for invoice ${invoice.invoiceNumber}`,
        payload: { invoiceId, paymentId, method, reference },
      });

      return res.status(201).json({
        ok: true,
        message: 'Payment submitted for verification.',
        paymentId,
      });
    } catch (e) {
      return next(e);
    }
  });

  // Initialize payment gateway (Chapa, Telebirr, CBE Birr)
  r.post('/owner/invoices/:id/pay-online', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const invoiceId = String(req.params?.id || '').trim();
      const gateway = String(req.body?.gateway || '').trim(); // chapa, telebirr, cbe_birr

      if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });
      if (!gateway) return res.status(400).json({ error: 'gateway_required' });

      const invoice = await getInvoiceDetails(invoiceId);

      if (!invoice) {
        return res.status(404).json({ error: 'invoice_not_found' });
      }

      if (invoice.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: 'forbidden' });
      }

      if (invoice.status === 'paid') {
        return res.status(409).json({ error: 'invoice_already_paid' });
      }

      // Get tenant info for payment
      const tenant = await db()
        .select(['name'])
        .from('tenants')
        .where({ id: req.tenant.id })
        .first();

      const staff = await db()
        .select(['name', 'email', 'phone'])
        .from('staff')
        .where({ id: req.auth?.staffId })
        .first();

      const baseUrl = req.protocol + '://' + req.get('host');
      const callbackUrl = `${baseUrl}/api/webhooks/payment/${gateway}`;
      const returnUrl = `${baseUrl}/owner/billing?invoice=${invoiceId}`;

      try {
        const result = await initializePayment({
          gateway,
          invoiceId,
          tenantId: req.tenant.id,
          amount: invoice.totalEtb,
          email: staff?.email || '',
          phone: staff?.phone || '',
          firstName: String(staff?.name || tenant?.name || 'Customer').split(' ')[0],
          lastName: String(staff?.name || '').split(' ').slice(1).join(' ') || 'Customer',
          callbackUrl,
          returnUrl,
        });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.payment.gateway.init',
          summary: `Initialized ${gateway} payment for invoice ${invoice.invoiceNumber}`,
          payload: { invoiceId, gateway, txRef: result.txRef },
        });

        return res.json({
          ok: true,
          gateway,
          checkoutUrl: result.checkoutUrl,
          txRef: result.txRef,
          ...(result.telebirr ? { telebirr: result.telebirr } : {}),
        });
      } catch (gatewayError) {
        const msg = (() => {
          try {
            if (gatewayError && typeof gatewayError === 'object' && typeof gatewayError.message === 'string') return gatewayError.message;
            return String(gatewayError || '').trim() || '';
          } catch {
            return '';
          }
        })();
        return res.status(400).json({
          error: 'gateway_error',
          gateway,
          message: msg || 'Failed to initialize payment gateway',
        });
      }
    } catch (e) {
      return next(e);
    }
  });

  // Get tenant payment preferences
  r.get('/owner/payment-prefs', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const prefs = await db()
        .select(['*'])
        .from('tenant_payment_prefs')
        .where({ tenant_id: req.tenant.id })
        .first();

      if (!prefs) {
        return res.json({
          ok: true,
          prefs: {
            preferredMethod: null,
            autoPayEnabled: false,
            emailReminders: true,
            smsReminders: false,
            billingEmail: null,
            billingPhone: null,
          },
        });
      }

      return res.json({
        ok: true,
        prefs: {
          preferredMethod: prefs.preferred_method,
          autoPayEnabled: Boolean(prefs.auto_pay_enabled),
          emailReminders: Boolean(prefs.email_reminders),
          smsReminders: Boolean(prefs.sms_reminders),
          billingEmail: prefs.billing_email,
          billingPhone: prefs.billing_phone,
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  // Update tenant payment preferences
  r.put('/owner/payment-prefs', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const nowIso = new Date().toISOString();
      const body = req.body || {};

      const data = {
        tenant_id: req.tenant.id,
        preferred_method: typeof body.preferredMethod === 'string' ? body.preferredMethod : null,
        auto_pay_enabled: Boolean(body.autoPayEnabled),
        email_reminders: body.emailReminders !== false,
        sms_reminders: Boolean(body.smsReminders),
        billing_email: typeof body.billingEmail === 'string' ? body.billingEmail.trim() : null,
        billing_phone: typeof body.billingPhone === 'string' ? body.billingPhone.trim() : null,
        updated_at: nowIso,
      };

      await db()
        .from('tenant_payment_prefs')
        .insert(data)
        .onConflict('tenant_id')
        .merge(data);

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSubscriptionRouter };
