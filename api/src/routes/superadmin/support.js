const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { makeId } = require('../../utils/ids');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const {
  validateIdParam,
  validateSuperadminSupportTicketsQuery,
  validateSuperadminSupportReply,
  validateSuperadminSupportStatus,
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

const safeDateIso = (raw) => {
  try {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) return '';
    return new Date(t).toISOString();
  } catch {
    return '';
  }
};

const decodeCursor = (raw) => {
  try {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    const createdAt = safeDateIso(obj?.createdAt);
    const id = typeof obj?.id === 'string' ? obj.id.trim() : '';
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

const encodeCursor = ({ createdAt, id }) => {
  const createdAtIso = safeDateIso(createdAt);
  const idStr = typeof id === 'string' ? id.trim() : '';
  if (!createdAtIso || !idStr) return '';
  return Buffer.from(JSON.stringify({ createdAt: createdAtIso, id: idStr }), 'utf8').toString('base64');
};

const addDays = (iso, days) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const slaSecsForSeverity = (sev) => {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return 2 * 60 * 60;
  if (s === 'high') return 6 * 60 * 60;
  if (s === 'medium') return 24 * 60 * 60;
  return 48 * 60 * 60;
};

const calcSlaRemaining = (createdAt, severity) => {
  const createdMs = new Date(createdAt).getTime();
  const nowMs = Date.now();
  const budget = slaSecsForSeverity(severity) * 1000;
  if (!Number.isFinite(createdMs)) return { remainingSec: 0, breached: false };
  const remainingMs = budget - (nowMs - createdMs);
  const remainingSec = Math.floor(remainingMs / 1000);
  return { remainingSec, breached: remainingSec <= 0 };
};

const makeSuperadminSupportRouter = () => {
  const r = express.Router();

  r.get('/superadmin/support', requireSuperadmin, validateSuperadminSupportTicketsQuery, async (req, res, next) => {
    try {
      const {
        q: qRaw,
        status: statusRaw,
        severity: severityRaw,
        tenantId: tenantIdRaw,
        from: fromRaw,
        to: toRaw,
        cursor: cursorRaw,
        limit: limitRaw,
      } = req.validatedQuery || req.query;

      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 120 });
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const severity = sanitizeText(severityRaw, { maxLen: 40 });
      const tenantId = sanitizeText(tenantIdRaw, { maxLen: 64 });
      const fromIso = safeDateIso(fromRaw);
      const toIsoFilter = safeDateIso(toRaw);
      const cursor = decodeCursor(cursorRaw);

      const limit = clampInt(limitRaw, 200, 1, 500);

      let base = db().from({ st: 'support_tickets' });
      if (tenantId) base = base.where({ 'st.tenant_id': tenantId });
      if (status) base = base.where({ 'st.status': status });
      if (severity) base = base.where({ 'st.severity': severity });
      if (fromIso) base = base.where('st.created_at', '>=', fromIso);
      if (toIsoFilter) base = base.where('st.created_at', '<=', toIsoFilter);
      if (q) {
        base = base.andWhere((b) =>
          b
            .whereRaw('LOWER(st.subject) LIKE ?', [`%${q}%`])
            .orWhere('st.id', 'like', `%${q}%`)
        );
      }

      if (cursor) {
        base = base.andWhere((b) =>
          b
            .where('st.created_at', '<', cursor.createdAt)
            .orWhere((bb) => bb.where('st.created_at', '=', cursor.createdAt).andWhere('st.id', '<', cursor.id))
        );
      }

      let totalOut = null;
      if (!cursor) {
        const totalRow = await base.clone().count({ c: '*' }).first();
        totalOut = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;
      }

      const rows = await base
        .leftJoin({ t: 'tenants' }, 't.id', 'st.tenant_id')
        .select([
          'st.id',
          'st.tenant_id',
          'st.severity',
          'st.subject',
          'st.status',
          'st.created_at',
          't.name as tenant_name',
          't.plan as tenant_plan',
        ])
        .orderBy([{ column: 'st.created_at', order: 'desc' }, { column: 'st.id', order: 'desc' }])
        .limit(limit);

      const tickets = rows.map((t) => {
        const sev = String(t.severity || 'medium');
        const sla = calcSlaRemaining(t.created_at, sev);
        return {
          id: String(t.id),
          tenantId: String(t.tenant_id),
          tenantName: t.tenant_name ? String(t.tenant_name) : '',
          tenantPlan: t.tenant_plan ? String(t.tenant_plan) : '',
          severity: sev,
          subject: String(t.subject || ''),
          status: String(t.status || ''),
          createdAt: toIso(t.created_at),
          slaRemainingSec: sla.remainingSec,
          slaBreached: sla.breached,
        };
      });

      const nextCursor = rows.length
        ? encodeCursor({ createdAt: rows[rows.length - 1].created_at, id: String(rows[rows.length - 1].id) })
        : '';

      const totalOpenRow = await db().from('support_tickets').count({ c: '*' }).whereNotIn('status', ['resolved', 'closed']).first();
      const totalOpen = Number(totalOpenRow?.c ?? totalOpenRow?.count ?? totalOpenRow?.['count(*)'] ?? 0) || 0;
      const slaBreaches = tickets.filter((t) => t.slaBreached).length;
      const todayVolumeRow = await db().from('support_tickets').count({ c: '*' }).where('created_at', '>=', addDays(new Date().toISOString(), -1)).first();
      const todayVolume = Number(todayVolumeRow?.c ?? todayVolumeRow?.count ?? todayVolumeRow?.['count(*)'] ?? 0) || 0;

      return res.json({
        ok: true,
        stats: { totalOpen, slaBreaches, avgResponseMin: 12, todayVolume },
        tickets,
        total: totalOut,
        nextCursor,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/support/tickets/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      const ticket = await db().from('support_tickets').select(['*']).where({ id: ticketId }).first();
      if (!ticket) return res.status(404).json({ error: 'not_found' });

      const tenant = await db().from('tenants').select(['id', 'name', 'plan']).where({ id: ticket.tenant_id }).first();
      const replies = await db().from('support_ticket_replies').select(['id', 'staff_id', 'message', 'created_at']).where({ ticket_id: ticketId }).orderBy('created_at', 'asc');

      const activity = replies.map((rr) => ({
        id: String(rr.id),
        by: rr.staff_id ? 'Support' : 'Client',
        at: toIso(rr.created_at),
        message: String(rr.message || ''),
      }));

      const detail = {
        id: String(ticket.id),
        tenantId: String(ticket.tenant_id),
        severity: String(ticket.severity || ''),
        subject: String(ticket.subject || ''),
        status: String(ticket.status || ''),
        reportedByRole: String(ticket.reported_by_role || ''),
        description: String(ticket.description || ''),
        createdAt: toIso(ticket.created_at),
        updatedAt: toIso(ticket.updated_at),
        client: {
          name: String(tenant?.name || 'Tenant'),
          tier: String(tenant?.plan || ''),
          initials: String(tenant?.name || 'TN').slice(0, 2).toUpperCase(),
          ltvEtb: 0,
          healthPct: 90,
        },
        activity,
      };

      return res.json({ ok: true, ticket: detail });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/reply', requireSuperadmin, validateIdParam, validateSuperadminSupportReply, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      const { message } = req.validatedBody || req.body;
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const exists = await db().from('support_tickets').select(['id', 'tenant_id']).where({ id: ticketId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      await db().from('support_ticket_replies').insert({
        id: makeId('tkr'),
        ticket_id: ticketId,
        tenant_id: exists.tenant_id,
        staff_id: null,
        message,
        created_at: nowIso,
      });
      await db().from('support_tickets').where({ id: ticketId }).update({ status: 'in_progress', updated_at: nowIso });
      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/status', requireSuperadmin, validateIdParam, validateSuperadminSupportStatus, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      const { status } = req.validatedBody || req.body;
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      const normalized = String(status || '').trim();
      if (!normalized) return res.status(400).json({ error: 'invalid_status' });
      const nowIso = new Date().toISOString();
      const updated = await db().from('support_tickets').where({ id: ticketId }).update({ status: normalized, updated_at: nowIso });
      if (!updated) return res.status(404).json({ error: 'not_found' });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminSupportRouter };
