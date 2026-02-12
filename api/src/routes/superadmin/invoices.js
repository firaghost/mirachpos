const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { makeId } = require('../../utils/ids');
const { logAudit } = require('../../utils/logger');
const {
  createManualInvoice,
  getInvoiceDetails,
  recordPaymentSubmission,
  verifyPayment,
  rejectPayment,
} = require('../../services/invoiceService');
const { generateInvoicePDF } = require('../../services/pdfService');
const {
  validateSuperadminInvoiceManual,
  validateSuperadminInvoicesQuery,
  validateSuperadminInvoiceIdParam,
  validateSuperadminInvoiceVerify,
  validateIdParam,
  validateSuperadminPaymentReject,
} = require('../../middleware/validators');

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

const makeSuperadminInvoicesRouter = () => {
  const r = express.Router();

  r.post('/superadmin/invoices/manual', requireSuperadmin, validateSuperadminInvoiceManual, async (req, res, next) => {
    try {
      const { tenantId, description, amountEtb, dueInDays, notes } = req.validatedBody || req.body;
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedDescription = String(description || '').trim();
      const normalizedAmount = Number(amountEtb || 0);
      const normalizedDue = Number(dueInDays ?? 7);
      const normalizedNotes = typeof notes === 'string' ? String(notes) : null;

      if (!normalizedTenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!normalizedDescription) return res.status(400).json({ error: 'description_required' });
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return res.status(400).json({ error: 'amount_invalid' });
      if (!Number.isFinite(normalizedDue) || normalizedDue < 0 || normalizedDue > 365) return res.status(400).json({ error: 'due_days_invalid' });

      const tenant = await db().select(['id']).from('tenants').where({ id: normalizedTenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const result = await createManualInvoice({
        tenantId: normalizedTenantId,
        dueInDays: normalizedDue,
        notes: normalizedNotes,
        type: 'manual',
        lineItems: [{ description: normalizedDescription, amount: normalizedAmount }],
      });

      await logAudit({
        tenantId: normalizedTenantId,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'invoice.manual_create',
        summary: `Created manual invoice ETB ${normalizedAmount}`,
        payload: {
          tenantId: normalizedTenantId,
          invoiceId: result.invoiceId,
          dueInDays: normalizedDue,
          description: normalizedDescription,
          amountEtb: normalizedAmount,
        },
        requestId: req.requestId,
      });

      return res.status(201).json({ ok: true, invoice: result });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/invoices', requireSuperadmin, validateSuperadminInvoicesQuery, async (req, res, next) => {
    try {
      const { page: pageRaw, limit: limitRaw, status, tenantId, q, tier, from, to } = req.validatedQuery || req.query;
      const page = clampInt(pageRaw, 1, 1, 1000000);
      const limit = clampInt(limitRaw, 50, 1, 200);
      const normalizedStatus = String(status || '').trim();
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedQuery = String(q || '').trim();
      const normalizedTier = String(tier || '').trim();
      const normalizedFrom = String(from || '').trim();
      const normalizedTo = String(to || '').trim();

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');

      if (normalizedStatus) base = base.where('invoices.status', normalizedStatus);
      if (normalizedTenantId) base = base.where('invoices.tenant_id', normalizedTenantId);
      if (normalizedQuery) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${normalizedQuery}%`).orWhere('tenants.name', 'like', `%${normalizedQuery}%`);
        });
      }

      if (normalizedTier) {
        const safeTier = normalizedTier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }
      if (normalizedFrom) {
        const fromDate = new Date(normalizedFrom);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (normalizedTo) {
        const toDate = new Date(normalizedTo);
        if (!Number.isNaN(toDate.getTime())) base = base.andWhere('invoices.issue_date', '<=', toDate.toISOString());
      }

      const countRow = await base.clone().count({ c: '*' }).first();
      const total = Number(countRow?.c || 0);

      const rows = await base
        .select([
          'invoices.id',
          'invoices.invoice_number',
          'invoices.type',
          'invoices.status',
          'invoices.total_etb',
          'invoices.issue_date',
          'invoices.due_date',
          'invoices.paid_at',
          'invoices.created_at',
          'invoices.tenant_id',
          'tenants.name as tenant_name',
        ])
        .orderBy('invoices.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

      const invoices = rows.map((r0) => ({
        id: r0.id,
        invoiceNumber: r0.invoice_number,
        type: r0.type,
        status: r0.status,
        amountEtb: Number(r0.total_etb || 0),
        issueDate: toIso(r0.issue_date),
        dueDate: toIso(r0.due_date),
        paidAt: toIso(r0.paid_at),
        createdAt: toIso(r0.created_at),
        tenantId: r0.tenant_id,
        tenantName: r0.tenant_name,
      }));

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const revenueRow = await db().from('invoices').whereNotNull('paid_at').andWhere('paid_at', '>=', monthStart).sum({ s: 'total_etb' }).first();
      const revenueEtb = Number(revenueRow?.s || 0);

      const outstandingRow = await db().from('invoices').whereIn('status', ['pending', 'overdue']).count({ c: '*' }).first();
      const outstandingCount = Number(outstandingRow?.c || 0);

      const avgRow = await db().from('invoices').whereNotNull('issue_date').andWhere('issue_date', '>=', monthStart).avg({ a: 'total_etb' }).first();
      const avgInvoiceEtb = Number(avgRow?.a || 0);

      return res.json({
        ok: true,
        invoices,
        page,
        limit,
        total,
        stats: {
          revenueEtb,
          outstandingCount,
          avgInvoiceEtb,
          monthStart: toIso(monthStart),
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/invoices/export.csv', requireSuperadmin, validateSuperadminInvoicesQuery, async (req, res, next) => {
    try {
      const { status, tenantId, q, tier, from, to, limit: limitRaw } = req.validatedQuery || req.query;
      const normalizedStatus = String(status || '').trim();
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedQuery = String(q || '').trim();
      const normalizedTier = String(tier || '').trim();
      const normalizedFrom = String(from || '').trim();
      const normalizedTo = String(to || '').trim();
      const limit = clampInt(limitRaw, 5000, 1, 20000);

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');
      if (normalizedStatus) base = base.where('invoices.status', normalizedStatus);
      if (normalizedTenantId) base = base.where('invoices.tenant_id', normalizedTenantId);
      if (normalizedQuery) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${normalizedQuery}%`).orWhere('tenants.name', 'like', `%${normalizedQuery}%`);
        });
      }

      if (normalizedTier) {
        const safeTier = normalizedTier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }
      if (normalizedFrom) {
        const fromDate = new Date(normalizedFrom);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (normalizedTo) {
        const toDate = new Date(normalizedTo);
        if (!Number.isNaN(toDate.getTime())) base = base.andWhere('invoices.issue_date', '<=', toDate.toISOString());
      }

      const rows = await base
        .select([
          'invoices.id',
          'invoices.invoice_number',
          'invoices.type',
          'invoices.status',
          'invoices.total_etb',
          'invoices.issue_date',
          'invoices.due_date',
          'invoices.paid_at',
          'invoices.created_at',
          'invoices.tenant_id',
          'tenants.name as tenant_name',
        ])
        .orderBy('invoices.created_at', 'desc')
        .limit(limit);

      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[\n\r,\"]/g.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
      };

      const header = ['invoice_id', 'invoice_number', 'tenant_id', 'tenant_name', 'type', 'status', 'total_etb', 'issue_date', 'due_date', 'paid_at', 'created_at'];
      const lines = [header.map(esc).join(',')];
      for (const r0 of rows) {
        lines.push(
          [
            r0.id,
            r0.invoice_number,
            r0.tenant_id,
            r0.tenant_name,
            r0.type,
            r0.status,
            Number(r0.total_etb || 0),
            toIso(r0.issue_date),
            toIso(r0.due_date),
            toIso(r0.paid_at),
            toIso(r0.created_at),
          ]
            .map(esc)
            .join(','),
        );
      }

      const out = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
      return res.status(200).send(out);
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/invoices/:id', requireSuperadmin, validateSuperadminInvoiceIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      console.log('[DEBUG] GET /superadmin/invoices/:id', { id: trimmedId });
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      console.log('[DEBUG] Calling getInvoiceDetails', { id: trimmedId });
      const invoice = await getInvoiceDetails(trimmedId);
      console.log('[DEBUG] Result', { found: !!invoice });
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      const tenant = await db().select('name').from('tenants').where({ id: invoice.tenantId }).first();
      invoice.tenantName = tenant?.name || 'Unknown';

      return res.json({ ok: true, invoice });
    } catch (e) {
      console.error('[DEBUG] Error in GET invoice details:', e);
      return next(e);
    }
  });

  r.get('/superadmin/invoices/:id/pdf', requireSuperadmin, validateSuperadminInvoiceIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const invoice = await getInvoiceDetails(trimmedId);
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      let pdfBuffer;
      try {
        pdfBuffer = await generateInvoicePDF(trimmedId);
      } catch (err) {
        console.error('[InvoicePDF] Failed to generate superadmin invoice PDF', { invoiceId: id, err });
        return res.status(500).json({ error: 'invoice_pdf_failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoiceNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/invoices/:id/verify', requireSuperadmin, validateSuperadminInvoiceIdParam, validateSuperadminInvoiceVerify, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const invoiceId = String(id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'id_required' });

      const body = req.validatedBody || req.body;
      const paymentId = String(body?.paymentId || '').trim();
      const method = String(body?.method || 'Cash').trim();

      const userId = 'superadmin';

      if (paymentId) {
        await verifyPayment({ paymentId, verifiedBy: userId });
      } else {
        const inv = await getInvoiceDetails(invoiceId);
        if (!inv) return res.status(404).json({ error: 'not_found' });

        if (inv.status === 'paid') return res.status(409).json({ error: 'already_paid' });

        const { paymentId: newPayId } = await recordPaymentSubmission({
          invoiceId,
          tenantId: inv.tenantId,
          method,
          amount: inv.totalEtb,
          notes: 'Manually verified by Super Admin',
        });

        await verifyPayment({ paymentId: newPayId, verifiedBy: userId });
      }

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'invoice.verify',
        summary: `Verified invoice ${invoiceId}`,
        payload: { invoiceId, paymentId, method },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/payments/:id/reject', requireSuperadmin, validateIdParam, validateSuperadminPaymentReject, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const paymentId = String(id || '').trim();
      if (!paymentId) return res.status(400).json({ error: 'id_required' });

      const body = req.validatedBody || req.body;
      const reason = String(body?.reason || 'Rejected by admin').trim();
      const userId = 'superadmin';

      await rejectPayment({ paymentId, rejectedBy: userId, reason });

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'payment.reject',
        summary: `Rejected payment ${paymentId}`,
        payload: { paymentId, reason },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminInvoicesRouter };
