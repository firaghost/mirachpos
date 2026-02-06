const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');
const { requireRole } = require('../middleware/permissions');
const { validateSupportTicketCreate, validateSupportTicketUpdate, validateIdParam } = require('../middleware/validators');

const makeSupportRouter = () => {
  const r = express.Router();

  r.get('/support/tickets', tenantMiddleware, requireAuth, requireRole('Cafe Owner', 'Branch Manager', 'Waiter'), async (req, res, next) => {
    try {
      if (!req.auth?.staffId) return res.status(401).json({ error: 'unauthorized' });

      const rows = await db()
        .select(['id', 'severity', 'subject', 'status', 'created_at', 'updated_at'])
        .from('support_tickets')
        .where({ tenant_id: req.tenant.id, staff_id: String(req.auth.staffId) })
        .orderBy('created_at', 'desc');

      const tickets = rows.map((t) => ({
        id: String(t.id),
        severity: String(t.severity || ''),
        subject: String(t.subject || ''),
        status: String(t.status || ''),
        createdAt: new Date(t.created_at).toISOString(),
        updatedAt: new Date(t.updated_at).toISOString(),
      }));

      return res.json({ ok: true, tickets });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/support/tickets',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    validateSupportTicketCreate,
    async (req, res, next) => {
    try {
      if (!req.auth?.staffId) return res.status(401).json({ error: 'unauthorized' });

      const { severity, subject, description } = req.validatedBody || req.body;
      if (!subject) return res.status(400).json({ error: 'subject_required' });

      const id = uid('tkt');
      const nowIso = new Date().toISOString();

      await db().from('support_tickets').insert({
        id,
        tenant_id: req.tenant.id,
        staff_id: String(req.auth.staffId),
        severity: severity || 'High',
        subject,
        description,
        status: 'Open',
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, ticketId: id });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/support/tickets/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    validateIdParam,
    validateSupportTicketUpdate,
    async (req, res, next) => {
    try {
      if (!req.auth?.staffId) return res.status(401).json({ error: 'unauthorized' });

      const { id } = req.validatedParams || req.params;
      if (!id) return res.status(400).json({ error: 'invalid_ticket_id' });

      const { status: statusRaw } = req.validatedBody || req.body;
      const status = statusRaw === 'Closed' ? 'Closed' : statusRaw === 'Open' ? 'Open' : '';
      if (!status) return res.status(400).json({ error: 'invalid_status' });

      const nowIso = new Date().toISOString();

      const updated = await db()
        .from('support_tickets')
        .where({ tenant_id: req.tenant.id, staff_id: String(req.auth.staffId), id })
        .update({ status, updated_at: nowIso });

      if (!updated) return res.status(404).json({ error: 'ticket_not_found' });

      return res.json({ ok: true, ticket: { id, status, updatedAt: nowIso } });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSupportRouter };
