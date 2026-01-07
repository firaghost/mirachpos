const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makeSyncRouter = () => {
  const r = express.Router();

  r.post('/sync/push', tenantMiddleware, requireAuth, loadEntitlements, requireModule('orders'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const events = Array.isArray(body?.events) ? body.events : [];
      if (events.length === 0) return res.json({ ok: true, acked_event_ids: [], rejected: [], new_cursor: null });

      const acked = [];
      const rejected = [];
      let lastCursor = null;

      // NOTE: event_id is the primary id; cursor is auto-increment (016_sync_cursor.js)
      for (const raw of events) {
        const e = raw && typeof raw === 'object' ? raw : null;
        const eventId = typeof e?.event_id === 'string' ? e.event_id.trim() : '';
        const tenantId = typeof e?.tenant_id === 'string' ? e.tenant_id.trim() : '';
        const branchId = typeof e?.branch_id === 'string' ? e.branch_id.trim() : '';
        const deviceId = typeof e?.device_id === 'string' ? e.device_id.trim() : '';
        const type = typeof e?.event_type === 'string' ? e.event_type.trim() : '';
        const createdAtLocal = typeof e?.created_at_local === 'string' ? e.created_at_local : '';
        const payload = e?.payload && typeof e.payload === 'object' ? e.payload : null;

        if (!eventId || !type) {
          rejected.push({ event_id: eventId || '', reason: 'invalid_event' });
          continue;
        }
        if (tenantId && tenantId !== req.tenant.id) {
          rejected.push({ event_id: eventId, reason: 'tenant_mismatch' });
          continue;
        }

        try {
          await db().from('sync_events').insert({
            id: eventId,
            tenant_id: req.tenant.id,
            branch_id: branchId || null,
            device_id: deviceId || null,
            type,
            payload_json: payload ? JSON.stringify(payload) : null,
            created_at: createdAtLocal ? new Date(createdAtLocal).toISOString() : new Date().toISOString(),
          });

          // Maintain draft materialized view for Draft Inbox feature.
          if (type.startsWith('order.draft_')) {
            const draftId = typeof payload?.draft_id === 'string' ? payload.draft_id : typeof e?.aggregate_id === 'string' ? e.aggregate_id : '';
            if (draftId) {
              const existing = await db().select(['id', 'draft_json']).from('sync_drafts').where({ id: draftId, tenant_id: req.tenant.id }).first();
              const cur = existing ? safeJsonParse(existing.draft_json, {}) : {};
              const next = { ...(cur && typeof cur === 'object' ? cur : {}) };
              next.draft_id = draftId;
              next.tenant_id = req.tenant.id;
              next.branch_id = branchId || next.branch_id || '';
              next.updated_at_server = new Date().toISOString();
              if (!next.created_by_staff_id && typeof payload?.created_by_staff_id === 'string') next.created_by_staff_id = payload.created_by_staff_id;

              if (type === 'order.draft_created') {
                next.status = next.status || 'LOCAL';
              }
              if (type === 'order.draft_notes_set') {
                next.notes = typeof payload?.notes === 'string' ? payload.notes : next.notes;
              }
              if (type === 'order.draft_item_upserted') {
                next.items = Array.isArray(next.items) ? next.items : [];
                const pid = typeof payload?.product_id === 'string' ? payload.product_id : '';
                const qty = Number(payload?.qty ?? 0);
                if (pid && Number.isFinite(qty) && qty > 0) {
                  const idx = next.items.findIndex((it) => it && typeof it === 'object' && String(it.product_id || '') === pid);
                  const rec = {
                    product_id: pid,
                    name: typeof payload?.name === 'string' ? payload.name : '',
                    image: typeof payload?.image === 'string' ? payload.image : '',
                    unit_price: Number(payload?.unit_price ?? 0),
                    qty,
                    note: typeof payload?.note === 'string' ? payload.note : '',
                  };
                  if (idx >= 0) next.items[idx] = { ...(next.items[idx] || {}), ...rec };
                  else next.items.push(rec);
                }
              }
              if (type === 'order.draft_submitted') {
                next.status = 'SUBMITTED';
                if (typeof payload?.submitted_at_local === 'string') next.submitted_at_local = payload.submitted_at_local;
              }

              // recompute summary
              const items = Array.isArray(next.items) ? next.items : [];
              const itemsCount = items.reduce((sum, it) => sum + (Number(it?.qty ?? 0) || 0), 0);
              const total = items.reduce((sum, it) => sum + (Number(it?.unit_price ?? 0) || 0) * (Number(it?.qty ?? 0) || 0), 0);
              next.summary = { items: itemsCount, total: Number(total.toFixed(2)) };

              const nowIso = new Date().toISOString();
              if (existing) {
                await db().from('sync_drafts').where({ tenant_id: req.tenant.id, id: draftId }).update({
                  branch_id: next.branch_id || null,
                  status: String(next.status || 'SUBMITTED'),
                  draft_json: JSON.stringify(next),
                  updated_at: nowIso,
                });
              } else {
                await db().from('sync_drafts').insert({
                  id: draftId,
                  tenant_id: req.tenant.id,
                  branch_id: next.branch_id || null,
                  status: String(next.status || 'SUBMITTED'),
                  draft_json: JSON.stringify(next),
                  created_at: nowIso,
                  updated_at: nowIso,
                });
              }
            }
          }

          const inserted = await db().select(['cursor']).from('sync_events').where({ id: eventId, tenant_id: req.tenant.id }).first();
          lastCursor = inserted?.cursor ?? lastCursor;
          acked.push(eventId);
        } catch (err) {
          // duplicate id means already applied
          if (String(err?.code || '') === 'ER_DUP_ENTRY') {
            acked.push(eventId);
            continue;
          }
          rejected.push({ event_id: eventId, reason: 'apply_failed' });
        }
      }

      return res.json({ ok: true, acked_event_ids: acked, rejected, new_cursor: lastCursor });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/sync/pull', tenantMiddleware, requireAuth, loadEntitlements, requireModule('orders'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const cursor = Number(req.query?.cursor || 0);
      const limitRaw = Number(req.query?.limit || 200);
      const limit = Math.min(500, Math.max(10, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 200));

      const rows = await db()
        .select(['cursor', 'id', 'tenant_id', 'branch_id', 'device_id', 'type', 'payload_json', 'created_at'])
        .from('sync_events')
        .where({ tenant_id: req.tenant.id })
        .andWhere('cursor', '>', Number.isFinite(cursor) ? cursor : 0)
        .orderBy('cursor', 'asc')
        .limit(limit);

      const events = rows.map((r0) => ({
        cursor: Number(r0.cursor) || 0,
        event_id: String(r0.id),
        tenant_id: String(r0.tenant_id),
        branch_id: r0.branch_id ? String(r0.branch_id) : '',
        device_id: r0.device_id ? String(r0.device_id) : '',
        event_type: String(r0.type),
        created_at_local: r0.created_at ? new Date(r0.created_at).toISOString() : '',
        payload: safeJsonParse(r0.payload_json, {}),
      }));

      const newCursor = events.length ? Number(events[events.length - 1].cursor) : (Number.isFinite(cursor) ? cursor : 0);
      return res.json({ ok: true, events, new_cursor: newCursor });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/sync/drafts/inbox', tenantMiddleware, requireAuth, loadEntitlements, requireModule('orders'), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : 'SUBMITTED';

      const q = db().select(['id', 'tenant_id', 'branch_id', 'status', 'draft_json', 'updated_at']).from('sync_drafts').where({ tenant_id: req.tenant.id });
      if (branchId) q.andWhere({ branch_id: branchId });
      if (status) q.andWhere({ status });
      const rows = await q.orderBy('updated_at', 'desc').limit(500);

      const drafts = rows.map((d) => {
        const parsed = safeJsonParse(d.draft_json, {});
        // Ensure the UI gets the legacy field names it expects.
        const obj = parsed && typeof parsed === 'object' ? parsed : {};
        return {
          draft_id: String(obj.draft_id || d.id),
          tenant_id: String(obj.tenant_id || d.tenant_id),
          branch_id: String(obj.branch_id || d.branch_id || ''),
          created_by_staff_id: typeof obj.created_by_staff_id === 'string' ? obj.created_by_staff_id : '',
          status: typeof obj.status === 'string' ? obj.status : String(d.status || ''),
          notes: typeof obj.notes === 'string' ? obj.notes : '',
          summary: obj.summary && typeof obj.summary === 'object' ? obj.summary : { items: 0, total: 0 },
          items: Array.isArray(obj.items) ? obj.items : [],
          submitted_at_local: typeof obj.submitted_at_local === 'string' ? obj.submitted_at_local : '',
          updated_at_server: typeof obj.updated_at_server === 'string' ? obj.updated_at_server : (d.updated_at ? new Date(d.updated_at).toISOString() : ''),
          order_id: typeof obj.order_id === 'string' ? obj.order_id : '',
          table_id: typeof obj.table_id === 'string' ? obj.table_id : '',
          rejected_reason: typeof obj.rejected_reason === 'string' ? obj.rejected_reason : '',
        };
      });

      return res.json({ ok: true, branchId, status, drafts });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSyncRouter };
