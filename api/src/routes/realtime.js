const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { subscribe } = require('../services/realtimeHub');

const makeRealtimeRouter = () => {
  const r = express.Router();

  const isTestEnv =
    process.env.NODE_ENV === 'test' ||
    String(process.env.JEST_WORKER_ID || '').trim() !== '' ||
    String(process.env.JEST || '').trim() !== '';

  // Server-Sent Events stream for realtime POS updates.
  // Auth: supports Authorization: Bearer <token> OR ?token=... (needed for EventSource)
  // Tenant: provided via X-Tenant header OR query (?tenant=...)
  // optional branch filter via ?branchId=...
  r.get(
    '/realtime/pos',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    (req, res) => {
    const tenantId = req.auth?.tenantId ? String(req.auth.tenantId) : '';
    if (!tenantId) return res.status(401).json({ error: 'unauthorized' });

    if (!req.tenant || !req.tenant.id || String(req.tenant.id) !== tenantId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const branchId = typeof req.query?.branchId === 'string' ? String(req.query.branchId).trim() : '';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial ping so clients mark connection as open.
    res.write(`event: ready\n`);
    res.write(`data: ${JSON.stringify({ ok: true, tenantId, branchId: branchId || null, at: new Date().toISOString() })}\n\n`);

    const onEvent = (evt) => {
      try {
        if (!evt || typeof evt !== 'object') return;
        if (String(evt.tenantId || '') !== tenantId) return;
        // Allow tenant-wide (global) events (no branchId) to reach branch-scoped clients.
        if (branchId && evt.branchId && String(evt.branchId || '') !== branchId) return;

        res.write(`event: pos\n`);
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {
        // ignore
      }
    };

    const unsubscribe = subscribe(onEvent);

    const keepAlive = setInterval(() => {
      try {
        res.write(`event: ping\n`);
        res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      } catch {
        // ignore
      }
    }, 25000);

    if (isTestEnv && typeof keepAlive?.unref === 'function') keepAlive.unref();

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        clearInterval(keepAlive);
      } catch {
        // ignore
      }
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    };

    req.on('close', () => {
      cleanup();
    });

    res.on('close', cleanup);
    res.on('finish', cleanup);
    },
  );

  return r;
};

module.exports = { makeRealtimeRouter };
