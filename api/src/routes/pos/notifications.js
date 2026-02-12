const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { uid } = require('../../utils/ids');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');

const makePosNotificationsRouter = ({ resolveBranchId, mapAuditToNotification }) => {
  const r = express.Router();

  r.get(
    '/pos/notifications',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 100) || 100));

        const rows = await db()
          .from({ a: 'audit_log' })
          .leftJoin({ nr: 'notification_reads' }, function joinReads() {
            this.on('nr.notification_id', '=', 'a.id')
              .andOn('nr.tenant_id', '=', 'a.tenant_id')
              .andOn('nr.staff_id', '=', db().raw('?', [staffId]));
          })
          .where({ 'a.tenant_id': req.tenant.id, 'a.branch_id': branchId })
          .select(['a.id', 'a.type', 'a.summary', 'a.payload_json', 'a.created_at', 'nr.read_at'])
          .orderBy('a.created_at', 'desc')
          .limit(limit);

        const raw = rows
          .map((r0) => {
            const n = mapAuditToNotification(r0);
            if (!n) return null;
            return { ...n, read: !!r0.read_at };
          })
          .filter(Boolean);

        // De-dupe: collapse repeated notifications so one action doesn't spam the feed.
        // Strategy:
        // - For status updates: keep only the most recent per (orderId + status)
        // - For payments: keep only the most recent per (orderId + paymentRef/splitId/paymentMethod)
        // - For voids: keep only the most recent per orderId
        const deduped = [];
        const seen = new Set();
        for (const n of raw) {
          const action = String(n.action || '').trim();
          const orderId = String(n.orderId || '').trim();
          const meta = n.meta && typeof n.meta === 'object' ? n.meta : {};

          let key = n.id;
          if (action === 'order.status_changed') {
            key = `order.status_changed:${orderId}:${String(meta?.status || '').trim()}`;
          } else if (action === 'payment.recorded') {
            key = `payment.recorded:${orderId}:${String(meta?.splitId || '').trim()}:${String(meta?.paymentReference || '').trim()}:${String(meta?.paymentMethod || '').trim()}`;
          } else if (action === 'order.voided') {
            key = `order.voided:${orderId}`;
          } else if (action === 'order.item_voided') {
            key = `order.item_voided:${orderId}:${String(meta?.productId || '').trim()}:${String(meta?.qty || '').trim()}:${String(meta?.reason || '').trim()}`;
          } else if (action === 'order.placed') {
            key = `order.placed:${orderId}`;
          }

          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          deduped.push(n);
        }

        const notifications = deduped.filter((n) => n && n.id && n.createdAt);

        return res.json({ ok: true, branchId, notifications });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/pos/notifications/:id/read',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const notificationId = String(req.params?.id || '').trim();
        if (!notificationId) return res.status(400).json({ error: 'id_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : null;
        const read = body?.read === false ? false : true;

        if (!read) {
          await db().from('notification_reads').where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId }).del();
          return res.json({ ok: true, read: false });
        }

        const nowIso = new Date().toISOString();
        const existing = await db()
          .from('notification_reads')
          .where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId })
          .select(['id'])
          .first();

        if (existing && existing.id) {
          await db().from('notification_reads').where({ tenant_id: req.tenant.id, id: String(existing.id) }).update({ read_at: nowIso });
          return res.json({ ok: true, read: true });
        }

        await db().from('notification_reads').insert({ id: uid('nr'), tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId, read_at: nowIso });
        return res.json({ ok: true, read: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/notifications/read_all',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });
        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) return res.status(401).json({ error: 'unauthorized' });

        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 200) || 200));

        const ids = await db()
          .from('audit_log')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .select(['id'])
          .orderBy('created_at', 'desc')
          .limit(limit);

        const nowIso = new Date().toISOString();
        for (const r0 of ids) {
          const notificationId = String(r0?.id || '').trim();
          if (!notificationId) continue;
          const exists = await db()
            .from('notification_reads')
            .where({ tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId })
            .select(['id'])
            .first();
          if (exists && exists.id) continue;
          await db().from('notification_reads').insert({ id: uid('nr'), tenant_id: req.tenant.id, staff_id: staffId, notification_id: notificationId, read_at: nowIso });
        }

        return res.json({ ok: true, read: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosNotificationsRouter };
