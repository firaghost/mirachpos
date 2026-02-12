const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');

const makePosShiftsRouter = () => {
  const r = express.Router();

  r.post(
    '/pos/shifts/start',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (_req, res) => res.status(201).json({ ok: true }),
  );

  r.post(
    '/pos/shifts/end',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.update'),
    async (_req, res) => res.json({ ok: true }),
  );

  r.get(
    '/pos/shifts/current',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (_req, res) => res.status(404).json({ error: 'not_found' }),
  );

  return r;
};

module.exports = { makePosShiftsRouter };
