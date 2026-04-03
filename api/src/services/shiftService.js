/**
 * Shift Service
 * 
 * Business logic for shift management including:
 * - Shift CRUD operations
 * - Shift validation and transitions
 * - Table assignment management during shift changes
 * - Cash reconciliation
 * - Audit logging
 */

const { uid } = require('../utils/ids');
const { db } = require('../db');

const ShiftType = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
};

const ShiftStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
};

const TableShiftType = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
  ALL: 'ALL',
};

/**
 * Get the current active shift for a branch with calculated metrics
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @returns {Promise<Object|null>} Current shift or null if none open
 */
const getCurrentShift = async ({ tenantId, branchId }) => {
  const shift = await db()
    .select(['*'])
    .from('shifts')
    .where({
      tenant_id: tenantId,
      branch_id: branchId,
      status: ShiftStatus.OPEN,
    })
    .first();

  if (!shift) return null;

  // Calculate actual metrics from orders for this shift
  const orderStats = await db()
    .count('id as order_count')
    .sum({ net_sales: db().raw('GREATEST(0, COALESCE(total, 0) - COALESCE(tax, 0) - COALESCE(tip, 0))') })
    .from('orders')
    .where({ shift_id: shift.id, status: 'Paid' })
    .first();

  return {
    ...shift,
    order_count: Number(orderStats?.order_count || 0),
    net_sales_etb: Number(orderStats?.net_sales || 0),
  };
};

/**
 * Check if shift management is enabled for a branch
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @returns {Promise<boolean>}
 */
const isShiftManagementEnabled = async ({ tenantId, branchId }) => {
  const branch = await db()
    .select(['enable_shift_management'])
    .from('branches')
    .where({ id: branchId, tenant_id: tenantId })
    .first();

  return branch?.enable_shift_management === 1 || branch?.enable_shift_management === true;
};

/**
 * Enable or disable shift management for a branch
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {boolean} params.enabled
 * @returns {Promise<void>}
 */
const setShiftManagementEnabled = async ({ tenantId, branchId, enabled }) => {
  await db()
    .from('branches')
    .where({ id: branchId, tenant_id: tenantId })
    .update({ enable_shift_management: enabled });
};

/**
 * Create and open a new shift
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {string} params.shiftType - 'DAY' or 'NIGHT'
 * @param {string} params.openedBy - Staff ID
 * @param {number} params.openingCash - Opening cash amount
 * @param {Date} [params.now] - Optional time override
 * @returns {Promise<Object>} Created shift
 */
const createShift = async ({ tenantId, branchId, shiftType, openedBy, openingCash = 0, now = new Date() }) => {
  // Validate there's no existing open shift
  const existingOpen = await getCurrentShift({ tenantId, branchId });
  if (existingOpen) {
    throw new Error('existing_shift_open');
  }

  const nowIso = now.toISOString();
  const businessDate = getBusinessDate(now);

  const shift = {
    id: uid('shift'),
    tenant_id: tenantId,
    branch_id: branchId,
    shift_type: shiftType,
    business_date: businessDate,
    status: ShiftStatus.OPEN,
    opened_at: nowIso,
    closed_at: null,
    opened_by: openedBy,
    closed_by: null,
    opening_cash_etb: openingCash,
    closing_cash_etb: null,
    expected_cash_etb: null,
    cash_difference_etb: null,
    order_count: 0,
    gross_sales_etb: 0,
    discounts_etb: 0,
    net_sales_etb: 0,
    tax_etb: 0,
    tips_etb: 0,
    payment_breakdown_json: null,
    notes: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  await db().from('shifts').insert(shift);

  // Log audit
  await logShiftAudit({
    tenantId,
    branchId,
    shiftId: shift.id,
    action: 'shift.opened',
    actorStaffId: openedBy,
    payload: { shiftType, openingCash, businessDate },
    now,
  });

  return shift;
};

/**
 * Close an existing shift with cash reconciliation
 * @param {Object} params
 * @param {string} params.shiftId
 * @param {string} params.closedBy - Staff ID
 * @param {number} params.closingCash - Actual cash counted
 * @param {string} [params.notes] - Optional notes
 * @param {boolean} [params.force] - Force close even with open orders (manager override)
 * @param {Date} [params.now] - Optional time override
 * @returns {Promise<Object>} Closed shift
 */
const closeShift = async ({ shiftId, closedBy, closingCash, notes, force = false, now = new Date() }) => {
  const shift = await db()
    .select(['*'])
    .from('shifts')
    .where({ id: shiftId })
    .first();

  if (!shift) {
    throw new Error('shift_not_found');
  }

  if (shift.status !== ShiftStatus.OPEN) {
    throw new Error('shift_already_closed');
  }

  // Check for open orders unless force closing
  if (!force) {
    const openOrders = await db()
      .count('id as count')
      .from('orders')
      .where({ shift_id: shiftId })
      .whereNotIn('status', ['Paid', 'Voided', 'Refunded'])
      .first();

    if (openOrders?.count > 0) {
      throw new Error('open_orders_exist');
    }
  }

  // Calculate expected cash and difference
  const expectedCash = await calculateExpectedCash({ shiftId });
  const cashDifference = closingCash - expectedCash;

  const nowIso = now.toISOString();

  await db()
    .from('shifts')
    .where({ id: shiftId })
    .update({
      status: ShiftStatus.CLOSED,
      closed_at: nowIso,
      closed_by: closedBy,
      closing_cash_etb: closingCash,
      expected_cash_etb: expectedCash,
      cash_difference_etb: cashDifference,
      notes: notes || null,
      updated_at: nowIso,
    });

  // Log audit
  await logShiftAudit({
    tenantId: shift.tenant_id,
    branchId: shift.branch_id,
    shiftId,
    action: 'shift.closed',
    actorStaffId: closedBy,
    payload: { closingCash, expectedCash, cashDifference, force },
    now,
  });

  return {
    ...shift,
    status: ShiftStatus.CLOSED,
    closed_at: nowIso,
    closed_by: closedBy,
    closing_cash_etb: closingCash,
    expected_cash_etb: expectedCash,
    cash_difference_etb: cashDifference,
  };
};

/**
 * Calculate expected cash for a shift
 * @param {Object} params
 * @param {string} params.shiftId
 * @returns {Promise<number>} Expected cash amount
 */
const calculateExpectedCash = async ({ shiftId }) => {
  const shift = await db()
    .select(['opening_cash_etb'])
    .from('shifts')
    .where({ id: shiftId })
    .first();

  if (!shift) {
    throw new Error('shift_not_found');
  }

  // Sum all cash payments in this shift (case-insensitive).
  // NOTE: order_payments does not have a 'status' column, so we do NOT filter by status.
  const cashPayments = await db()
    .sum('amount as total')
    .from('order_payments')
    .where({ shift_id: shiftId })
    .whereRaw("LOWER(method) = 'cash'")
    .first();

  const openingCash = Number(shift.opening_cash_etb || 0);
  const cashReceived = Number(cashPayments?.total || 0);

  return openingCash + cashReceived;
};

/**
 * Update shift metrics (called when orders are created/paid)
 * @param {Object} params
 * @param {string} params.shiftId
 * @param {Object} params.orderData - Order information
 * @returns {Promise<void>}
 */
const updateShiftMetrics = async ({ trx, shiftId, orderData }) => {
  const queryBuilder = trx || db();

  // Use forUpdate() if we are inside a transaction to prevent race conditions (locking)
  let shiftQuery = queryBuilder
    .select(['*'])
    .from('shifts')
    .where({ id: shiftId });
    
  if (trx) {
    shiftQuery = shiftQuery.forUpdate();
  }
  
  const shift = await shiftQuery.first();

  if (!shift || shift.status !== ShiftStatus.OPEN) {
    return; // Don't update closed shifts
  }

  const paymentBreakdown = JSON.parse(shift.payment_breakdown_json || '{}');
  const method = orderData.paymentMethod || 'Other';
  const methodKey = method.toLowerCase().replace(/\s+/g, '_');
  paymentBreakdown[methodKey] = (paymentBreakdown[methodKey] || 0) + (orderData.total || 0);

  await queryBuilder
    .from('shifts')
    .where({ id: shiftId })
    .update({
      order_count: Number(shift.order_count || 0) + 1,
      gross_sales_etb: Number(shift.gross_sales_etb || 0) + (orderData.subtotal || 0),
      discounts_etb: Number(shift.discounts_etb || 0) + (orderData.discount || 0),
      net_sales_etb: Number(shift.net_sales_etb || 0) + (orderData.total || 0),
      tax_etb: Number(shift.tax_etb || 0) + (orderData.tax || 0),
      tips_etb: Number(shift.tips_etb || 0) + (orderData.tip || 0),
      payment_breakdown_json: JSON.stringify(paymentBreakdown),
      updated_at: new Date().toISOString(),
    });
};

/**
 * Reset table assignments for a specific shift type
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {string} params.shiftType - 'DAY' or 'NIGHT'
 * @param {Date} [params.now]
 * @returns {Promise<void>}
 */
const resetTableAssignmentsForShiftChange = async ({ tenantId, branchId, shiftType, now = new Date() }) => {
  const nowIso = now.toISOString();

  // Only unassign staff from tables of the specific shift type that's ending
  // Tables with 'ALL' shift type keep their assignments across shifts
  await db()
    .from('restaurant_tables')
    .where({
      tenant_id: tenantId,
      branch_id: branchId,
      shift_type: shiftType,
    })
    .update({
      assigned_staff_id: null,
      assigned_staff_name: null,
      updated_at: nowIso,
    });

  // Note: We no longer clear 'ALL' table assignments - they persist across shifts
  // This ensures consistent table/waiter assignments regardless of shift changes
};

/**
 * Get shift report with aggregated metrics
 * @param {Object} params
 * @param {string} params.shiftId
 * @returns {Promise<Object>} Shift report data
 */
const getShiftReport = async ({ shiftId }) => {
  const shift = await db()
    .select(['*'])
    .from('shifts')
    .where({ id: shiftId })
    .first();

  if (!shift) {
    throw new Error('shift_not_found');
  }

  // Get orders in this shift
  const orders = await db()
    .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'paid_at'])
    .from('orders')
    .where({ shift_id: shiftId })
    .orderBy('created_at', 'desc');

  // Get payment breakdown.
  // NOTE: order_payments does not have a 'status' column, do NOT filter by status.
  const payments = await db()
    .select(['method', 'amount'])
    .from('order_payments')
    .where({ shift_id: shiftId });

  const paymentBreakdown = {};
  for (const p of payments) {
    const key = String(p.method || 'Other').toLowerCase().replace(/\s+/g, '_');
    paymentBreakdown[key] = (paymentBreakdown[key] || 0) + Number(p.amount || 0);
  }

  // Calculate metrics
  const paidOrders = orders.filter((o) => o.status === 'Paid');
  const voidedOrders = orders.filter((o) => o.status === 'Voided');
  const refundedOrders = orders.filter((o) => o.status === 'Refunded');

  const totalSales = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalTax = paidOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);
  const totalTips = paidOrders.reduce((sum, o) => sum + Number(o.tip || 0), 0);
  const totalDiscounts = paidOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);

  // Get staff performance breakdown
  const staffPerformance = await db()
    .from({ o: 'orders' })
    .where({ 'o.shift_id': shiftId, 'o.status': 'Paid' })
    .select([
      db().raw("COALESCE(NULLIF(TRIM(o.created_by_staff_id), ''), 'unknown') as staff_id"),
      db().raw("COALESCE(NULLIF(TRIM(o.created_by_name), ''), 'Unknown') as staff_name"),
      db().raw('COUNT(*) as order_count'),
      db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as total_sales'),
      db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as total_tips'),
    ])
    .groupBy('staff_id', 'staff_name')
    .orderBy(db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0)'), 'desc');

  // Get product sales breakdown
  const productSales = await db()
    .from({ oi: 'order_items' })
    .innerJoin({ o: 'orders' }, function () {
      this.on('o.id', '=', 'oi.order_id')
        .andOn('o.tenant_id', '=', 'oi.tenant_id')
        .andOn('o.branch_id', '=', 'oi.branch_id');
    })
    .leftJoin({ p: 'menu_products' }, function () {
      this.on('p.id', '=', 'oi.product_id')
        .andOn('p.tenant_id', '=', 'oi.tenant_id')
        .andOn('p.branch_id', '=', 'oi.branch_id');
    })
    .where({ 'o.shift_id': shiftId, 'o.status': 'Paid' })
    .select([
      db().raw("COALESCE(NULLIF(TRIM(oi.name), ''), 'Unknown') as product_name"),
      db().raw("COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') as category"),
      db().raw('SUM(COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) as qty_sold'),
      db().raw('COALESCE(AVG(oi.unit_price), 0) as unit_price'),
      db().raw('SUM((COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue'),
    ])
    .groupBy('product_name', 'category')
    .orderBy('revenue', 'desc');

  return {
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
    summary: {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      voidedOrders: voidedOrders.length,
      refundedOrders: refundedOrders.length,
      totalSales,
      totalTax,
      totalTips,
      totalDiscounts,
      netSales: totalSales - totalDiscounts,
    },
    paymentBreakdown,
    staffPerformance: staffPerformance.map(s => ({
      staffId: s.staff_id,
      staffName: s.staff_name,
      orderCount: Number(s.order_count || 0),
      totalSales: Number(s.total_sales || 0),
      totalTips: Number(s.total_tips || 0),
    })),
    products: productSales.map(p => ({
      name: p.product_name,
      category: p.category,
      qtySold: Number(p.qty_sold || 0),
      unitPrice: Number(p.unit_price || 0),
      revenue: Number(p.revenue || 0),
    })),
    orders,
  };
};

/**
 * List shifts for a branch with pagination
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {Object} [params.filters]
 * @param {number} [params.limit]
 * @param {number} [params.offset]
 * @returns {Promise<Object>} Shifts list with pagination
 */
const listShifts = async ({ tenantId, branchId, filters = {}, limit = 50, offset = 0 }) => {
  let query = db()
    .select(['*'])
    .from('shifts')
    .where({ tenant_id: tenantId, branch_id: branchId });

  if (filters.status) {
    query = query.andWhere('status', filters.status);
  }

  if (filters.shiftType) {
    query = query.andWhere('shift_type', filters.shiftType);
  }

  if (filters.businessDate) {
    query = query.andWhere('business_date', filters.businessDate);
  }

  const countQuery = query.clone();
  const totalResult = await countQuery.count('id as total').first();
  const total = Number(totalResult?.total || 0);

  const shifts = await query
    .orderBy('opened_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    shifts: shifts.map((s) => ({
      id: s.id,
      shiftType: s.shift_type,
      businessDate: s.business_date,
      status: s.status,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      openedBy: s.opened_by,
      closedBy: s.closed_by,
      orderCount: s.order_count,
      netSales: Number(s.net_sales_etb || 0),
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + shifts.length < total,
    },
  };
};

/**
 * Validate if a shift can be closed
 * @param {Object} params
 * @param {string} params.shiftId
 * @returns {Promise<Object>} Validation result with shift breakdowns
 */
const validateShiftClose = async ({ shiftId }) => {
  const shift = await db()
    .select(['*'])
    .from('shifts')
    .where({ id: shiftId })
    .first();

  if (!shift) {
    return { canClose: false, error: 'shift_not_found' };
  }

  if (shift.status !== ShiftStatus.OPEN) {
    return { canClose: false, error: 'shift_already_closed' };
  }

  // Check for open orders
  const openOrders = await db()
    .select(['id', 'status', 'display_number'])
    .from('orders')
    .where({ shift_id: shiftId })
    .whereNotIn('status', ['Paid', 'Voided', 'Refunded']);

  if (openOrders.length > 0) {
    return {
      canClose: false,
      error: 'open_orders_exist',
      openOrders: openOrders.map((o) => ({
        id: o.id,
        status: o.status,
        displayNumber: o.display_number,
      })),
    };
  }

  const expectedCash = await calculateExpectedCash({ shiftId });

  // NOTE: order_payments has no 'status' column, do NOT filter by status.
  const payments = await db()
    .select(['method', 'amount'])
    .from('order_payments')
    .where({ shift_id: shiftId });

  const paymentBreakdown = {};
  for (const p of payments) {
    const key = String(p.method || 'Other').toLowerCase().replace(/\s+/g, '_');
    paymentBreakdown[key] = (paymentBreakdown[key] || 0) + Number(p.amount || 0);
  }

  // Calculate cash received specifically (for expected cash calculation).
  // NOTE: order_payments has no 'status' column.
  const cashPaymentsRow = await db()
    .sum('amount as total')
    .from('order_payments')
    .where({ shift_id: shiftId })
    .whereRaw("LOWER(method) = 'cash'")
    .first();
  const cashReceived = Number(cashPaymentsRow?.total || 0);

  // Get orders summary
  const orders = await db()
    .select(['id', 'status', 'total', 'tax', 'tip', 'discount'])
    .from('orders')
    .where({ shift_id: shiftId });

  const paidOrders = orders.filter((o) => o.status === 'Paid');
  const voidedOrders = orders.filter((o) => o.status === 'Voided');
  const refundedOrders = orders.filter((o) => o.status === 'Refunded');

  const totalSales = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalTax = paidOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);
  const totalTips = paidOrders.reduce((sum, o) => sum + Number(o.tip || 0), 0);
  const totalDiscounts = paidOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);

  // Get staff performance with tips
  const staffPerformance = await db()
    .from({ o: 'orders' })
    .where({ 'o.shift_id': shiftId, 'o.status': 'Paid' })
    .select([
      db().raw("COALESCE(NULLIF(TRIM(o.created_by_staff_id), ''), 'unknown') as staff_id"),
      db().raw("COALESCE(NULLIF(TRIM(o.created_by_name), ''), 'Unknown') as staff_name"),
      db().raw('COUNT(*) as order_count'),
      db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as total_sales'),
      db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as total_tips'),
    ])
    .groupBy('staff_id', 'staff_name')
    .orderBy(db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0)'), 'desc');

  return {
    canClose: true,
    expectedCash,
    orderCount: shift.order_count,
    breakdowns: {
      summary: {
        totalOrders: orders.length,
        paidOrders: paidOrders.length,
        voidedOrders: voidedOrders.length,
        refundedOrders: refundedOrders.length,
        totalSales,
        totalTax,
        totalTips,
        totalDiscounts,
        netSales: totalSales - totalDiscounts,
      },
      paymentBreakdown,
      openingCash: Number(shift.opening_cash_etb || 0),
      cashReceived,
      expectedCash,
      staffTips: staffPerformance.map(s => ({
        staffId: s.staff_id,
        staffName: s.staff_name,
        orderCount: Number(s.order_count || 0),
        totalSales: Number(s.total_sales || 0),
        totalTips: Number(s.total_tips || 0),
      })).filter(s => s.totalTips > 0),
    },
  };
};

/**
 * Log shift-related audit events
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {string} params.shiftId
 * @param {string} params.action
 * @param {string} params.actorStaffId
 * @param {Object} [params.payload]
 * @param {Date} [params.now]
 * @returns {Promise<void>}
 */
const logShiftAudit = async ({ tenantId, branchId, shiftId, action, actorStaffId, payload = {}, now = new Date() }) => {
  try {
    await db().from('shift_audit_log').insert({
      id: uid('shft_audit'),
      tenant_id: tenantId,
      branch_id: branchId,
      shift_id: shiftId,
      action,
      actor_staff_id: actorStaffId,
      payload_json: JSON.stringify(payload),
      created_at: now.toISOString(),
    });
  } catch (e) {
    // Don't fail the main operation if audit logging fails
    console.error('Shift audit log failed:', e);
  }
};

const getBusinessDate = (date) => {
  const d = new Date(date);
  
  // Ethiopian time is UTC+3. Explicitly construct an EAT-shifted epoch to reliably 
  // extract the local hour without relying on the physical server's timezone
  const eatMs = d.getTime() + (3 * 60 * 60 * 1000);
  const eatDate = new Date(eatMs);
  
  const hour = eatDate.getUTCHours();

  // Business day starts at 07:00 (7 AM) EAT.
  // Hours 0-6 belong to the PREVIOUS business day.
  if (hour < 7) {
    eatDate.setUTCDate(eatDate.getUTCDate() - 1);
  }

  const yyyy = eatDate.getUTCFullYear();
  const mm = String(eatDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(eatDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Get tables filtered by shift type
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {string} params.activeShiftType - Current active shift type
 * @returns {Promise<Array>} Filtered tables
 */
const getTablesForShift = async ({ tenantId, branchId, activeShiftType }) => {
  const tables = await db()
    .select(['*'])
    .from('restaurant_tables')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .andWhere(function () {
      // Include tables with NULL, empty string, 'ALL', or matching the active shift type
      this.where('shift_type', 'ALL')
        .orWhere('shift_type', activeShiftType)
        .orWhereNull('shift_type')
        .orWhere('shift_type', '');
    })
    .orderBy('name', 'asc');

  return tables;
};

/**
 * Update table shift type
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.branchId
 * @param {string} params.tableId
 * @param {string} params.shiftType - 'DAY', 'NIGHT', or 'ALL'
 * @returns {Promise<void>}
 */
const updateTableShiftType = async ({ tenantId, branchId, tableId, shiftType }) => {
  if (!['DAY', 'NIGHT', 'ALL'].includes(shiftType)) {
    throw new Error('invalid_shift_type');
  }

  await db()
    .from('restaurant_tables')
    .where({ tenant_id: tenantId, branch_id: branchId, id: tableId })
    .update({
      shift_type: shiftType,
      updated_at: new Date().toISOString(),
    });
};

module.exports = {
  ShiftType,
  ShiftStatus,
  TableShiftType,
  getCurrentShift,
  isShiftManagementEnabled,
  setShiftManagementEnabled,
  createShift,
  closeShift,
  calculateExpectedCash,
  updateShiftMetrics,
  resetTableAssignmentsForShiftChange,
  getShiftReport,
  listShifts,
  validateShiftClose,
  logShiftAudit,
  getBusinessDate,
  getTablesForShift,
  updateTableShiftType,
};
