const express = require('express');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { db } = require('../../db');
const { uid } = require('../../utils/ids');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const {
  getCurrentShift,
  isShiftManagementEnabled,
  getTablesForShift,
} = require('../../services/shiftService');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makePosTablesRouter = ({
  resolveBranchId,
  setNoStore,
  backfillRestaurantTablesFromLegacyState,
  mapTableStatusFromOrderStatus,
  mapRestaurantTableRow,
  loadRestaurantTable,
  publish,
}) => {
  const r = express.Router();

  r.get(
    '/pos/tables',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        setNoStore(res);

        await backfillRestaurantTablesFromLegacyState({ tenantId: req.tenant.id, branchId });

        // Check if shift management is enabled and get current shift
        let rows;
        try {
          const shiftEnabled = await isShiftManagementEnabled({ tenantId: req.tenant.id, branchId });
          // Managers can request all tables with ?all=true query param
          const role = String(req.auth?.role || '').trim();
          const isManager = ['Cafe Owner', 'Branch Manager', 'Manager'].includes(role);
          const showAll = req.query?.all === 'true' || isManager;
          
          if (shiftEnabled && !showAll) {
            const currentShift = await getCurrentShift({ tenantId: req.tenant.id, branchId });
            if (currentShift) {
              // Filter tables by current shift type (DAY or NIGHT)
              rows = await getTablesForShift({
                tenantId: req.tenant.id,
                branchId,
                activeShiftType: currentShift.shift_type,
              });
            } else {
              // No active shift - show all tables but include shiftRequired flag
              // This allows users to see tables even when no shift is open
              rows = await db()
                .from('restaurant_tables')
                .where({ tenant_id: req.tenant.id, branch_id: branchId })
                .select(['id', 'name', 'area', 'status', 'seats', 'open_order_id', 'last_order_id', 'assigned_staff_id', 'assigned_staff_name', 'shift_type', 'updated_at'])
                .orderBy('name', 'asc');
              // Add shiftRequired flag to response
              return res.json({
                ok: true,
                tenantId: req.tenant.id,
                branchId,
                tables: (rows || []).map(mapRestaurantTableRow).filter(Boolean),
                shiftRequired: true,
              });
            }
          } else {
            // Shift management not enabled, manager request, or all=true - return all tables
            rows = await db()
              .from('restaurant_tables')
              .where({ tenant_id: req.tenant.id, branch_id: branchId })
              .select(['id', 'name', 'area', 'status', 'seats', 'open_order_id', 'last_order_id', 'assigned_staff_id', 'assigned_staff_name', 'shift_type', 'updated_at'])
              .orderBy('name', 'asc');
          }
        } catch {
          // Fallback to all tables if shift service fails
          rows = await db()
            .from('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId })
            .select(['id', 'name', 'area', 'status', 'seats', 'open_order_id', 'last_order_id', 'assigned_staff_id', 'assigned_staff_name', 'shift_type', 'updated_at'])
            .orderBy('name', 'asc');
        }

        // Derive open orders from the orders table so stale open_order_id never points at a Paid order.
        // We intentionally keep this dialect-safe by parsing payload JSON in JS.
        const openOrders = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .whereNotIn('status', ['Paid', 'Voided', 'Refunded'])
          .select(['id', 'status', 'created_at', 'payload'])
          .orderBy('created_at', 'desc')
          .limit(1000);

        const openByTableId = new Map();
        for (const o of openOrders || []) {
          const p = safeJsonParse(o?.payload, null);
          const tId = typeof p?.tableId === 'string' ? p.tableId.trim() : typeof p?.table_id === 'string' ? p.table_id.trim() : '';
          if (!tId) continue;
          if (openByTableId.has(tId)) continue;
          openByTableId.set(tId, { id: String(o?.id || ''), status: String(o?.status || '').trim() });
        }

        const effective = (rows || []).map((r0) => {
          const tId = String(r0?.id || '').trim();
          if (!tId) return r0;
          const open = openByTableId.get(tId);
          if (!open || !open.id) {
            return {
              ...r0,
              status: 'Free',
              open_order_id: null,
            };
          }
          return {
            ...r0,
            status: mapTableStatusFromOrderStatus(open.status),
            open_order_id: open.id,
            last_order_id: open.id,
          };
        });

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, tables: effective.map(mapRestaurantTableRow).filter(Boolean) });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/tables',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name_required' });

        let id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : '';
        if (!id) {
          const existingByName = await db()
            .from('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, name })
            .select(['id'])
            .first();
          id = existingByName?.id ? String(existingByName.id) : uid('tbl');
        }

        const nowIso = new Date().toISOString();
        const shiftType = typeof body?.shiftType === 'string' && ['DAY', 'NIGHT', 'ALL'].includes(body.shiftType.toUpperCase())
          ? body.shiftType.toUpperCase()
          : 'ALL';

        await db()
          .from('restaurant_tables')
          .insert({
            tenant_id: req.tenant.id,
            branch_id: branchId,
            id,
            name,
            area: typeof body?.area === 'string' && body.area.trim() ? body.area.trim() : null,
            status: typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Free',
            seats: Number.isFinite(Number(body?.seats)) ? Number(body.seats) : 4,
            shift_type: shiftType,
            open_order_id: null,
            last_order_id: null,
            assigned_staff_id: typeof body?.assignedStaffId === 'string' && body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null,
            assigned_staff_name: typeof body?.assignedStaffName === 'string' && body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null,
            updated_at: nowIso,
          })
          .onConflict(['tenant_id', 'branch_id', 'id'])
          .merge({
            name,
            area: typeof body?.area === 'string' && body.area.trim() ? body.area.trim() : null,
            status: typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : 'Free',
            seats: Number.isFinite(Number(body?.seats)) ? Number(body.seats) : 4,
            shift_type: shiftType,
            assigned_staff_id: typeof body?.assignedStaffId === 'string' && body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null,
            assigned_staff_name: typeof body?.assignedStaffName === 'string' && body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null,
            updated_at: nowIso,
          });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.upserted', data: { tableId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/pos/tables/:id/assign',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const patch = {};

        if (typeof body?.assignedStaffId === 'string') {
          patch.assigned_staff_id = body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null;
        }
        if (typeof body?.assignedStaffName === 'string') {
          patch.assigned_staff_name = body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null;
        }

        const nowIso = new Date().toISOString();
        patch.updated_at = nowIso;

        const updated = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update(patch);
        if (!updated) return res.status(404).json({ error: 'table_not_found' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.updated', data: { tableId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.delete(
    '/pos/tables/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });
        if (!row) return res.status(404).json({ error: 'table_not_found' });
        if (row.open_order_id) return res.status(409).json({ error: 'table_has_open_order' });

        await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .del();

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.deleted', data: { tableId: String(id) } });
        } catch {
          // ignore
        }

        return res.json({ ok: true, tenantId: req.tenant.id, branchId, deleted: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/pos/tables/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter Manager'),
    loadEntitlements,
    requireModule('pos'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'table_required' });

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const patch = {};
        if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim();
        if (body?.area == null) patch.area = null;
        if (typeof body?.area === 'string' && body.area.trim()) patch.area = body.area.trim();
        if (typeof body?.status === 'string' && body.status.trim()) patch.status = body.status.trim();
        if (Number.isFinite(Number(body?.seats))) patch.seats = Number(body.seats);

        if (typeof body?.shiftType === 'string' && ['DAY', 'NIGHT', 'ALL'].includes(body.shiftType.toUpperCase())) {
          patch.shift_type = body.shiftType.toUpperCase();
        }

        if (typeof body?.assignedStaffId === 'string') {
          patch.assigned_staff_id = body.assignedStaffId.trim() ? body.assignedStaffId.trim() : null;
        }
        if (typeof body?.assignedStaffName === 'string') {
          patch.assigned_staff_name = body.assignedStaffName.trim() ? body.assignedStaffName.trim() : null;
        }
        if (typeof body?.openOrderId === 'string') {
          patch.open_order_id = body.openOrderId.trim() ? body.openOrderId.trim() : null;
        }
        if (typeof body?.lastOrderId === 'string') {
          patch.last_order_id = body.lastOrderId.trim() ? body.lastOrderId.trim() : null;
        }

        const nowIso = new Date().toISOString();
        patch.updated_at = nowIso;

        const updated = await db()
          .from('restaurant_tables')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update(patch);
        if (!updated) return res.status(404).json({ error: 'table_not_found' });

        const row = await loadRestaurantTable({ tenantId: req.tenant.id, branchId, tableId: id });

        try {
          publish({ tenantId: String(req.tenant.id), branchId: String(branchId), type: 'pos.table.updated', data: { tableId: String(id) } });
        } catch {
          // ignore
        }
        return res.json({ ok: true, tenantId: req.tenant.id, branchId, table: mapRestaurantTableRow(row) });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosTablesRouter };
