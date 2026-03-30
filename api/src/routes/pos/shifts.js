/**
 * POS Shifts Router
 *
 * API routes for shift management:
 * - GET /pos/shifts/current - Get current active shift
 * - GET /pos/shifts - List shifts
 * - POST /pos/shifts - Create new shift
 * - PUT /pos/shifts/:id/close - Close a shift
 * - GET /pos/shifts/:id/verify-close - Validate shift can be closed
 * - GET /pos/shifts/:id/report - Get shift report
 * - GET /pos/shifts/settings - Get shift management settings
 * - PUT /pos/shifts/settings - Update shift management settings
 */

const express = require('express');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const {
  getCurrentShift,
  isShiftManagementEnabled,
  setShiftManagementEnabled,
  createShift,
  closeShift,
  getShiftReport,
  listShifts,
  validateShiftClose,
  ShiftType,
} = require('../../services/shiftService');

const makePosShiftsRouter = ({ resolveBranchId, setNoStore }) => {
  const r = express.Router();

  /**
   * GET /pos/shifts/current
   * Get the current active shift for the branch
   */
  r.get(
    '/pos/shifts/current',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        setNoStore(res);

        const enabled = await isShiftManagementEnabled({
          tenantId: req.tenant.id,
          branchId,
        });

        if (!enabled) {
          return res.json({
            ok: true,
            enabled: false,
            shift: null,
          });
        }

        const shift = await getCurrentShift({
          tenantId: req.tenant.id,
          branchId,
        });

        return res.json({
          ok: true,
          enabled: true,
          shift: shift
            ? {
                id: shift.id,
                shiftType: shift.shift_type,
                businessDate: shift.business_date,
                status: shift.status,
                openedAt: shift.opened_at,
                openedBy: shift.opened_by,
                openingCash: Number(shift.opening_cash_etb || 0),
                orderCount: shift.order_count,
                netSales: Number(shift.net_sales_etb || 0),
              }
            : null,
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * GET /pos/shifts
   * List shifts for the branch with pagination
   */
  r.get(
    '/pos/shifts',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        setNoStore(res);

        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50) || 50));
        const offset = Math.max(0, Number(req.query?.offset || 0) || 0);

        const filters = {};
        if (req.query?.status) {
          filters.status = String(req.query.status);
        }
        if (req.query?.shiftType) {
          filters.shiftType = String(req.query.shiftType);
        }
        if (req.query?.businessDate) {
          filters.businessDate = String(req.query.businessDate);
        }

        const result = await listShifts({
          tenantId: req.tenant.id,
          branchId,
          filters,
          limit,
          offset,
        });

        return res.json({
          ok: true,
          shifts: result.shifts,
          pagination: result.pagination,
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * POST /pos/shifts
   * Create and open a new shift (requires no existing open shift)
   */
  r.post(
    '/pos/shifts',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const shiftType = String(body?.shiftType || '').trim().toUpperCase();
        const openingCash = Number(body?.openingCash || 0) || 0;
        const notes = typeof body?.notes === 'string' ? body.notes.trim() : null;

        if (!shiftType || !['DAY', 'NIGHT'].includes(shiftType)) {
          return res.status(400).json({ error: 'invalid_shift_type' });
        }

        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) {
          return res.status(401).json({ error: 'staff_id_required' });
        }

        try {
          const shift = await createShift({
            tenantId: req.tenant.id,
            branchId,
            shiftType,
            openedBy: staffId,
            openingCash,
          });

          return res.status(201).json({
            ok: true,
            shift: {
              id: shift.id,
              shiftType: shift.shift_type,
              businessDate: shift.business_date,
              status: shift.status,
              openedAt: shift.opened_at,
              openedBy: shift.opened_by,
              openingCash: Number(shift.opening_cash_etb || 0),
              notes: shift.notes,
            },
          });
        } catch (error) {
          if (error.message === 'existing_shift_open') {
            return res.status(409).json({
              error: 'existing_shift_open',
              message: 'There is already an open shift. Close it before opening a new one.',
            });
          }
          throw error;
        }
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * PUT /pos/shifts/:id/close
   * Close a shift with cash reconciliation
   */
  r.put(
    '/pos/shifts/:id/close',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        const shiftId = String(req.params?.id || '').trim();
        if (!shiftId) {
          return res.status(400).json({ error: 'shift_id_required' });
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const closingCash = Number(body?.closingCash ?? 0);
        const notes = typeof body?.notes === 'string' ? body.notes.trim() : null;
        const force = body?.force === true;

        // Validate PIN if force closing with open orders
        if (force && body?.pin) {
          // TODO: Implement PIN validation if required
        }

        const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
        if (!staffId) {
          return res.status(401).json({ error: 'staff_id_required' });
        }

        try {
          const shift = await closeShift({
            shiftId,
            closedBy: staffId,
            closingCash,
            notes,
            force,
          });

          return res.json({
            ok: true,
            shift: {
              id: shift.id,
              shiftType: shift.shift_type,
              businessDate: shift.business_date,
              status: shift.status,
              openedAt: shift.opened_at,
              closedAt: shift.closed_at,
              openedBy: shift.opened_by,
              closedBy: shift.closed_by,
              openingCash: Number(shift.opening_cash_etb || 0),
              closingCash: Number(shift.closing_cash_etb || 0),
              expectedCash: Number(shift.expected_cash_etb || 0),
              cashDifference: Number(shift.cash_difference_etb || 0),
              notes: shift.notes,
            },
          });
        } catch (error) {
          if (error.message === 'shift_not_found') {
            return res.status(404).json({ error: 'shift_not_found' });
          }
          if (error.message === 'shift_already_closed') {
            return res.status(409).json({ error: 'shift_already_closed' });
          }
          if (error.message === 'open_orders_exist') {
            return res.status(409).json({
              error: 'open_orders_exist',
              message: 'Cannot close shift with open orders. Complete or void all orders first.',
            });
          }
          throw error;
        }
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * GET /pos/shifts/:id/verify-close
   * Validate if a shift can be closed (check for open orders, calculate expected cash)
   */
  r.get(
    '/pos/shifts/:id/verify-close',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        const shiftId = String(req.params?.id || '').trim();
        if (!shiftId) {
          return res.status(400).json({ error: 'shift_id_required' });
        }

        const validation = await validateShiftClose({ shiftId });

        return res.json({
          ok: true,
          canClose: validation.canClose,
          error: validation.error || null,
          expectedCash: validation.expectedCash,
          orderCount: validation.orderCount,
          openOrders: validation.openOrders || [],
          breakdowns: validation.breakdowns || null,
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * GET /pos/shifts/:id/report
   * Get detailed report for a shift
   */
  r.get(
    '/pos/shifts/:id/report',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        const shiftId = String(req.params?.id || '').trim();
        if (!shiftId) {
          return res.status(400).json({ error: 'shift_id_required' });
        }

        try {
          const report = await getShiftReport({ shiftId });

          return res.json({
            ok: true,
            report,
          });
        } catch (error) {
          if (error.message === 'shift_not_found') {
            return res.status(404).json({ error: 'shift_not_found' });
          }
          throw error;
        }
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * GET /pos/shifts/settings
   * Get shift management settings for the branch
   */
  r.get(
    '/pos/shifts/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        setNoStore(res);

        const enabled = await isShiftManagementEnabled({
          tenantId: req.tenant.id,
          branchId,
        });

        return res.json({
          ok: true,
          settings: {
            enabled,
          },
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  /**
   * PUT /pos/shifts/settings
   * Update shift management settings for the branch
   */
  r.put(
    '/pos/shifts/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) {
          return res.status(400).json({ error: 'branch_required' });
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const enabled = body?.enabled === true;

        await setShiftManagementEnabled({
          tenantId: req.tenant.id,
          branchId,
          enabled,
        });

        return res.json({
          ok: true,
          settings: {
            enabled,
          },
        });
      } catch (e) {
        return next(e);
      }
    }
  );

  return r;
};

module.exports = { makePosShiftsRouter };
