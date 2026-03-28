const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { loadEntitlements, requireFeature, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { validateWaiterAccount, validateWaiterHistoryQuery } = require('../middleware/validators');
const { sanitizeLikeInput, sanitizeText } = require('../utils/sanitize');
const { uid } = require('../utils/ids');
const { createOrFireTicketForOrder, EVENT_TYPE } = require('../services/kdsService');

const makeWaiterRouter = () => {
  const r = express.Router();

  r.get('/waiter/floor', tenantMiddleware, requireAuth, loadEntitlements, requireRole('Waiter', 'Waiter Manager'), requireFeature('waiter_floor'), async (_req, res) => {
    return res.json({ ok: true, tables: [] });
  });

  r.get('/waiter/menu', tenantMiddleware, requireAuth, loadEntitlements, requireRole('Waiter', 'Waiter Manager'), requireFeature('waiter_menu'), async (_req, res) => {
    return res.json({ ok: true, menu: [] });
  });

  r.post(
    '/waiter/orders',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_menu'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { items, tableId, tableName, customer, note, discountPct, tip } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items_required' });
      }

      // Calculate totals
      const subtotal = items.reduce((sum, item) => {
        return sum + (Number(item.qty) || 0) * (Number(item.price) || 0);
      }, 0);
      const discountAmount = discountPct ? subtotal * (Number(discountPct) / 100) : 0;
      const taxRate = 0.15; // 15% tax rate
      const taxableAmount = subtotal - discountAmount;
      const tax = taxableAmount * taxRate;
      const total = taxableAmount + tax + (Number(tip) || 0);

      // Generate order ID and display number
      const orderId = uid('ord');
      const nowIso = new Date().toISOString();
      
      // Generate display number
      const today = nowIso.slice(0, 10);
      const countResult = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .whereRaw("DATE(created_at) = ?", [today])
        .count({ count: '*' })
        .first();
      const seq = (Number(countResult?.count || 0) || 0) + 1;
      const displayNumber = `${String(seq).padStart(3, '0')}`;

      // Get waiter name
      const staffRow = await db()
        .select(['name'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId })
        .first();
      const waiterName = staffRow?.name ? String(staffRow.name) : '';

      // Build payload
      const payload = {
        items: items.map(item => ({
          id: uid('itm'),
          productId: String(item.productId || item.id || ''),
          name: String(item.name || ''),
          qty: Number(item.qty) || 1,
          unitPrice: Number(item.price) || 0,
          notes: String(item.note || item.notes || ''),
          modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        })),
        subtotal,
        discount: discountAmount,
        discountPct: Number(discountPct) || 0,
        tax,
        tip: Number(tip) || 0,
        total,
        tableId: String(tableId || ''),
        tableName: String(tableName || ''),
        customer,
        note: String(note || ''),
        createdByStaffId: staffId,
        createdByName: waiterName,
        timeLabel: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        number: displayNumber,
      };

      // Save order to database
      await db().transaction(async (trx) => {
        await trx
          .from('orders')
          .insert({
            id: orderId,
            tenant_id: req.tenant.id,
            branch_id: branchId,
            status: 'Pending',
            total,
            tax,
            tip: Number(tip) || 0,
            discount: discountAmount,
            created_at: nowIso,
            paid_at: null,
            display_number: displayNumber,
            table_id: String(tableId || ''),
            table_name: String(tableName || ''),
            created_by_staff_id: staffId,
            created_by_name: waiterName,
            notes: String(note || ''),
            updated_at: nowIso,
            payload: JSON.stringify(payload),
          });

        // Insert order items
        const orderItems = payload.items.map(item => ({
          id: uid('oi'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: orderId,
          product_id: String(item.productId || ''),
          product_code: '',
          name: item.name,
          qty: item.qty,
          unit_price: item.unitPrice,
          voided_qty: 0,
          notes: item.notes || '',
          created_at: nowIso,
        }));

        if (orderItems.length > 0) {
          await trx('order_items').insert(orderItems);
        }

        // Update table status if tableId provided
        if (tableId) {
          await trx('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: tableId })
            .update({
              status: 'Occupied',
              open_order_id: orderId,
              last_order_id: orderId,
              updated_at: nowIso,
            });
        }
      });

      // Create KDS ticket for kitchen
      try {
        const actor = { staffId, role: req.auth?.role };
        const actionId = `kds:auto_fire:${orderId}`;
        const out = await createOrFireTicketForOrder({
          tenantId: String(req.tenant.id),
          branchId: String(branchId),
          orderId: String(orderId),
          station: 'kitchen',
          courseNo: 1,
          priority: 0,
          slaMs: null,
          actionId,
          actor,
          nowIso,
          reqLog: req.log,
        });

        if (out?.ticket?.id) {
          // Publish KDS event
          try {
            const { publish } = require('../services/realtimeHub');
            if (publish) {
              publish({
                tenantId: String(req.tenant.id),
                branchId: String(branchId),
                type: 'pos.kds.ticket',
                data: { ticketId: String(out.ticket.id), eventType: EVENT_TYPE.TICKET_FIRED, orderId: String(orderId) },
              });
            }
          } catch {
            // Ignore publish errors
          }
        }
      } catch (kdsErr) {
        // Log but don't fail order creation
        console.error('KDS ticket creation failed:', kdsErr);
      }

      return res.status(201).json({
        ok: true,
        id: orderId,
        displayNumber,
        total,
        createdAt: nowIso,
      });
    } catch (e) {
      return next(e);
    }
    },
  );

  r.get(
    '/waiter/orders/active',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_orders_active'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');

      // Get active orders (not Paid, Voided, or Refunded)
      const baseQuery = db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .whereNotIn('status', ['Paid', 'Voided', 'Refunded']);

      // Waiters can only see their own orders
      if (role === 'Waiter' && staffId) {
        baseQuery.andWhere({ created_by_staff_id: staffId });
      }

      const rows = await baseQuery
        .select([
          'id',
          'status',
          'total',
          'tax',
          'tip',
          'discount',
          'created_at',
          'display_number',
          'table_id',
          'table_name',
          'created_by_staff_id',
          'created_by_name',
          'payload',
        ])
        .orderBy('created_at', 'desc')
        .limit(100);

      const orders = rows.map((o) => {
        const payload = o.payload
          ? (() => {
              try {
                return JSON.parse(String(o.payload));
              } catch {
                return {};
              }
            })()
          : {};

        return {
          id: String(o.id),
          number: String(o.display_number || payload?.number || ''),
          tableName: String(o.table_name || payload?.tableName || ''),
          tableId: String(o.table_id || payload?.tableId || ''),
          timeLabel: String(payload?.timeLabel || ''),
          createdByName: String(o.created_by_name || payload?.createdByName || ''),
          createdByStaffId: String(o.created_by_staff_id || payload?.createdByStaffId || ''),
          items: Array.isArray(payload?.items) ? payload.items : [],
          status: String(o.status || 'Pending'),
          total: Number(o.total || 0),
          tax: Number(o.tax || 0),
          tip: Number(o.tip || 0),
          discount: Number(o.discount || 0),
          createdAt: o.created_at ? new Date(o.created_at).toISOString() : '',
          payload,
        };
      });

      return res.json({ ok: true, orders, branchId });
    } catch (e) {
      return next(e);
    }
    },
  );

  r.post(
    '/waiter/payments',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_payments'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { orderId, method, amount, reference } = body;

      if (!orderId) return res.status(400).json({ error: 'order_id_required' });
      if (!method) return res.status(400).json({ error: 'payment_method_required' });

      const nowIso = new Date().toISOString();

      // Get the order
      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });
      if (orderRow.status === 'Paid') return res.status(400).json({ error: 'order_already_paid' });
      if (orderRow.status === 'Voided') return res.status(400).json({ error: 'order_voided' });

      const total = Number(orderRow.total || 0);
      const tendered = Number(amount) || 0;
      const change = Math.max(0, tendered - total);

      // Get staff name
      const staffRow = await db()
        .select(['name'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: staffId })
        .first();
      const staffName = staffRow?.name ? String(staffRow.name) : '';

      // Process payment
      await db().transaction(async (trx) => {
        // Update order status
        await trx('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .update({
            status: 'Paid',
            paid_at: nowIso,
            paid_by_staff_id: staffId,
            paid_by_name: staffName,
            payment_method: String(method || ''),
            payment_reference: String(reference || ''),
            tendered_amount: tendered,
            updated_at: nowIso,
          });

        // Insert payment record
        await trx('order_payments').insert({
          id: uid('pmt'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          order_id: orderId,
          method: String(method || 'cash'),
          amount: total,
          tendered_amount: tendered,
          change_amount: change,
          reference: String(reference || ''),
          created_at: nowIso,
        });

        // Bump KDS tickets
        await trx('kds_tickets')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId })
          .whereIn('status', ['pending', 'fired'])
          .update({
            status: 'ready',
            updated_at: nowIso,
          });

        // Free up the table
        if (orderRow.table_id) {
          await trx('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderRow.table_id })
            .update({
              status: 'Free',
              open_order_id: null,
              last_order_id: orderId,
              updated_at: nowIso,
            });
        }
      });

      return res.json({
        ok: true,
        orderId,
        status: 'Paid',
        paidAt: nowIso,
        total,
        tendered,
        change,
      });
    } catch (e) {
      return next(e);
    }
    },
  );

  r.post(
    '/waiter/orders/:id/void',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_voids'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      const role = String(req.auth?.role || '').trim();
      const orderId = String(req.params?.id || '').trim();

      if (!orderId) return res.status(400).json({ error: 'order_id_required' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (!reason) return res.status(400).json({ error: 'reason_required' });

      const nowIso = new Date().toISOString();

      // Get the order
      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      // Check permissions - waiter can only void their own orders
      if (role === 'Waiter') {
        const existingOwner = String(orderRow.created_by_staff_id || '');
        if (existingOwner && existingOwner !== staffId) {
          return res.status(403).json({ error: 'forbidden' });
        }
      }

      // Void the order
      await db().transaction(async (trx) => {
        await trx('orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
          .update({
            status: 'Voided',
            updated_at: nowIso,
          });

        // Void associated KDS tickets
        await trx('kds_tickets')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, order_id: orderId })
          .whereIn('status', ['pending', 'fired'])
          .update({
            status: 'voided',
            updated_at: nowIso,
          });

        // Free up the table if it was assigned
        if (orderRow.table_id) {
          await trx('restaurant_tables')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderRow.table_id })
            .update({
              status: 'Free',
              open_order_id: null,
              updated_at: nowIso,
            });
        }
      });

      return res.json({ ok: true, orderId, voidedAt: nowIso });
    } catch (e) {
      return next(e);
    }
    },
  );

  r.get(
    '/waiter/kds',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_kds'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const station = String(req.query?.station || 'kitchen').toLowerCase();

      // Get active KDS tickets
      const ticketRows = await db()
        .from('kds_tickets')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .whereIn('status', ['pending', 'fired'])
        .orderBy('priority', 'desc')
        .orderBy('created_at', 'asc')
        .limit(200);

      const ticketIds = ticketRows.map(t => String(t.id));

      // Get ticket items
      let ticketItems = [];
      if (ticketIds.length > 0) {
        ticketItems = await db()
          .from('kds_ticket_items')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .whereIn('ticket_id', ticketIds);
      }

      const itemsByTicket = {};
      for (const item of ticketItems) {
        const tid = String(item.ticket_id);
        if (!itemsByTicket[tid]) itemsByTicket[tid] = [];
        itemsByTicket[tid].push({
          id: String(item.id),
          productId: String(item.product_id || ''),
          name: String(item.name || ''),
          qty: Number(item.qty || 0),
          notes: String(item.notes || ''),
          courseNo: Number(item.course_no || 1),
          status: String(item.status || 'pending'),
        });
      }

      const tickets = ticketRows.map(t => {
        const payload = t.payload_json
          ? (() => {
              try {
                return JSON.parse(String(t.payload_json));
              } catch {
                return {};
              }
            })()
          : {};

        return {
          id: String(t.id),
          orderId: String(t.order_id || ''),
          status: String(t.status || 'pending'),
          priority: Number(t.priority || 0),
          station: String(t.station || 'kitchen'),
          courseNo: Number(t.course_no || 1),
          displayNumber: String(t.display_number || payload?.displayNumber || ''),
          tableName: String(t.table_name || payload?.tableName || ''),
          tableId: String(t.table_id || payload?.tableId || ''),
          waiterName: String(t.created_by_name || payload?.createdByName || ''),
          createdAt: t.created_at ? new Date(t.created_at).toISOString() : '',
          firedAt: t.fired_at ? new Date(t.fired_at).toISOString() : null,
          items: itemsByTicket[String(t.id)] || [],
          elapsedMs: t.fired_at ? Date.now() - new Date(t.fired_at).getTime() : Date.now() - new Date(t.created_at).getTime(),
        };
      });

      return res.json({ ok: true, tickets, branchId, station });
    } catch (e) {
      return next(e);
    }
  });

  const getTenantBusinessName = async (tenantId) => {
    try {
      const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: tenantId }).first();
      const raw = row?.settings_json ? String(row.settings_json) : '';
      const parsed = raw ? JSON.parse(raw) : {};
      const business = parsed?.business && typeof parsed.business === 'object' ? parsed.business : {};
      const name = String(business.businessName || business.legalName || '').trim();
      return name || 'MirachPOS';
    } catch {
      return 'MirachPOS';
    }
  };

  const parseIsoDateOnly = (s) => {
    const v = String(s || '').trim();
    if (!v) return '';
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
    if (!m) return '';
    const d = new Date(`${v}T00:00:00.000Z`);
    if (!Number.isFinite(d.getTime())) return '';
    return v;
  };

  const buildWaiterTodaySalesReport = async ({ tenantId, branchId, date }) => {
    const day = parseIsoDateOnly(date);
    if (!day) return { ok: false, error: 'invalid_range' };

    const fromDt = `${day} 00:00:00`;
    const toDt = `${day} 23:59:59`;
    const fromIso = `${day}T00:00:00.000Z`;
    const toIso = `${day}T23:59:59.999Z`;

    // Order aggregations
    const orderAgg = await db()
      .from({ o: 'orders' })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw('COUNT(*) as order_count'),
        db().raw('COALESCE(SUM(COALESCE(o.discount, 0)), 0) as discounts_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.tax, 0)), 0) as tax_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as tips_etb'),
        db().raw('COALESCE(SUM(COALESCE(o.total, 0)), 0) as total_collected_etb'),
        db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as net_sales_etb'),
        db().raw('COALESCE(AVG(COALESCE(o.total, 0)), 0) as avg_order_value'),
      ])
      .first();

    // Payment methods breakdown
    const paymentMethods = await db()
      .from({ o: 'orders' })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw("COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Other') as payment_method"),
        db().raw('COUNT(*) as count'),
        db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0))), 0) as total'),
      ])
      .groupBy('payment_method');

    // Staff performance breakdown
    const staffPerformance = await db()
      .from({ o: 'orders' })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw("COALESCE(NULLIF(TRIM(o.created_by_staff_id), ''), 'unknown') as staff_id"),
        db().raw("COALESCE(NULLIF(TRIM(o.created_by_name), ''), 'Unknown') as staff_name"),
        db().raw('COUNT(*) as order_count'),
        db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as total_sales'),
        db().raw('COALESCE(SUM(COALESCE(o.tip, 0)), 0) as total_tips'),
      ])
      .groupBy('staff_id', 'staff_name')
      .orderBy(db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0)'), 'desc');

    // Hourly breakdown
    const hourlySales = await db()
      .from({ o: 'orders' })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw("DATE_FORMAT(o.paid_at, '%H:00') as hour"),
        db().raw('COUNT(*) as order_count'),
        db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as total'),
      ])
      .groupBy('hour')
      .orderBy('hour');

    // Voids and refunds
    const voids = await db()
      .from({ oi: 'order_items' })
      .innerJoin({ o: 'orders' }, function () {
        this.on('o.id', '=', 'oi.order_id')
          .andOn('o.tenant_id', '=', 'oi.tenant_id')
          .andOn('o.branch_id', '=', 'oi.branch_id');
      })
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .andWhere((qb) => {
        qb.where('oi.voided_qty', '>', 0);
      })
      .select([
        db().raw('COUNT(*) as void_count'),
        db().raw('COALESCE(SUM(COALESCE(oi.voided_qty, 0) * COALESCE(oi.unit_price, 0)), 0) as void_amount'),
      ])
      .first();

    // Products performance - join with menu_products to get category
    const productRowsRaw = await db()
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
      .where({ 'o.tenant_id': tenantId, 'o.branch_id': branchId, 'o.status': 'Paid' })
      .andWhere((qb) => {
        qb.whereBetween('o.paid_at', [fromDt, toDt]).orWhereBetween('o.paid_at', [fromIso, toIso]);
      })
      .select([
        db().raw('COALESCE(NULLIF(TRIM(oi.name), \'\'), \'Unknown\') as product_name'),
        db().raw('COALESCE(NULLIF(TRIM(p.category), \'\'), \'Uncategorized\') as category'),
        db().raw('SUM(COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) as qty_sold'),
        db().raw('COALESCE(AVG(oi.unit_price), 0) as unit_price'),
        db().raw('SUM((COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) * COALESCE(oi.unit_price, 0)) as revenue_etb'),
        db().raw('COALESCE(oi.product_id, \'\') as product_id'),
        db().raw('SUM(COALESCE(oi.voided_qty, 0)) as void_qty'),
      ])
      .groupBy('product_name', 'category', 'oi.product_id');

    const rows = productRowsRaw
      .map((r) => ({
        productId: String(r.product_id || ''),
        name: String(r.product_name || ''),
        category: String(r.category || 'Uncategorized'),
        qtySold: Number(r.qty_sold || 0),
        revenue: Number(r.revenue_etb || 0),
        voidQty: Number(r.void_qty || 0),
      }))
      .filter((r) => r.qtySold > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const orderCount = Number(orderAgg?.order_count || 0) || 0;
    const discounts = Number(orderAgg?.discounts_etb || 0) || 0;
    const tax = Number(orderAgg?.tax_etb || 0) || 0;
    const tips = Number(orderAgg?.tips_etb || 0) || 0;
    const totalCollected = Number(orderAgg?.total_collected_etb || 0) || 0;
    const netSales = Number(orderAgg?.net_sales_etb || 0) || 0;
    const grossSales = netSales + discounts;
    const avgOrderValue = Number(orderAgg?.avg_order_value || 0) || 0;

    // Format payment methods
    const paymentBreakdown = paymentMethods.map((p) => ({
      method: String(p.payment_method || 'Other'),
      count: Number(p.count || 0),
      total: Number(p.total || 0),
    }));

    // Format staff performance
    const staffBreakdown = staffPerformance.map((s) => ({
      staffId: String(s.staff_id || 'unknown'),
      staffName: String(s.staff_name || 'Unknown'),
      orderCount: Number(s.order_count || 0),
      totalSales: Number(s.total_sales || 0),
      totalTips: Number(s.total_tips || 0),
    }));

    // Format hourly sales
    const hourlyBreakdown = hourlySales.map((h) => ({
      hour: String(h.hour || '00:00'),
      orderCount: Number(h.order_count || 0),
      total: Number(h.total || 0),
    }));

    return {
      ok: true,
      date: day,
      orderCount,
      grossSales,
      discounts,
      netSales,
      tax,
      tips,
      totalCollected,
      avgOrderValue,
      voidCount: Number(voids?.void_count || 0),
      voidAmount: Number(voids?.void_amount || 0),
      products: rows,
      paymentMethods: paymentBreakdown,
      staffPerformance: staffBreakdown,
      hourlySales: hourlyBreakdown,
    };
  };

  const resolveBranchId = (req) => {
    const role = String(req.auth?.role || '').trim();
    const fromToken = String(req.auth?.branchId || '').trim();
    const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

    if (role === 'Waiter Manager') {
      if (fromToken && fromToken !== 'global') return fromToken;
      if (q && q !== 'global') return q;
      return '';
    }

    return fromToken;
  };

  const requireWaiter = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const branchId = resolveBranchId(req);
    if (!branchId || branchId === 'global') {
      res.status(400).json({ error: 'branch_required' });
      return false;
    }
    return true;
  };

  r.put(
    '/waiter/account',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_account'),
    validateWaiterAccount,
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const staffId = String(req.auth?.staffId || '');
      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const { currentPassword, newPassword, currentPin, newPin } = req.validatedBody || req.body;

      if (!newPassword && !newPin) return res.status(400).json({ error: 'no_changes' });
      if (newPassword && newPassword.length < 4) return res.status(400).json({ error: 'password_too_short' });
      if (newPin && newPin.length < 3) return res.status(400).json({ error: 'pin_too_short' });

      const staff = await db()
        .select(['id', 'tenant_id', 'branch_id', 'role_name', 'password_hash', 'pin_hash'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: staffId, branch_id: branchId })
        .first();

      if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      if (role === 'Waiter' && String(staff.role_name || '') !== 'Waiter') return res.status(403).json({ error: 'forbidden' });

      if (newPassword) {
        const match = await bcrypt.compare(String(currentPassword || ''), String(staff.password_hash || ''));
        if (!match) return res.status(401).json({ error: 'invalid_credentials' });
      }

      if (newPin) {
        const pinHash = String(staff.pin_hash || '');
        if (pinHash) {
          const match = await bcrypt.compare(String(currentPin || ''), pinHash);
          if (!match) return res.status(401).json({ error: 'invalid_credentials' });
        }
      }

      const patch = {};
      if (newPassword) patch.password_hash = await bcrypt.hash(String(newPassword), 10);
      if (newPin) patch.pin_hash = await bcrypt.hash(String(newPin), 10);
      if (Object.keys(patch).length === 0) return res.json({ ok: true });

      await db().from('staff').where({ tenant_id: req.tenant.id, id: staffId }).update({ ...patch, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_history'),
    validateWaiterHistoryQuery,
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const { q: qRaw, status: statusRaw, from: fromRaw, to: toRaw, page: pageRaw, pageSize: pageSizeRaw } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const page = Math.max(1, Number(pageRaw || 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(pageSizeRaw || 25) || 25));

      const parseIsoDateTime = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const d = new Date(v);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString();
      };

      const parseIsoDate = (s) => {
        const v = String(s || '').trim();
        if (!v) return null;
        const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
        if (!m) return null;
        const d = new Date(`${v}T00:00:00.000Z`);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };

      const fromDateOnly = parseIsoDate(fromRaw);
      const toDateOnly = parseIsoDate(toRaw);
      const fromIso = fromDateOnly ? `${fromDateOnly}T00:00:00.000Z` : parseIsoDateTime(fromRaw);
      const toIso = toDateOnly ? `${toDateOnly}T23:59:59.999Z` : parseIsoDateTime(toRaw);

      const base = db().from('orders').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) {
        if (status === 'Open') {
          base.whereNotIn('status', ['Paid', 'Voided']);
        } else {
          base.andWhere({ status });
        }
      }

      if (fromIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '>=', fromIso).orWhere('paid_at', '>=', fromIso);
        });
      }
      if (toIso) {
        base.andWhere((qb) => {
          qb.where('created_at', '<=', toIso).orWhere('paid_at', '<=', toIso);
        });
      }

      if (role !== 'Waiter Manager') {
        base.andWhere({ created_by_staff_id: staffId });
      }

      if (q) {
        const qLike = `%${q}%`;
        base.andWhere((qb) => {
          qb.whereRaw('LOWER(COALESCE(display_number, \'\')) LIKE ?', [qLike])
            .orWhereRaw('LOWER(COALESCE(table_name, \'\')) LIKE ?', [qLike]);
        });
      }

      const countRow = await base.clone().clearSelect().clearOrder().count({ total: '*' }).first();
      const total = Number(countRow?.total || 0);

      const rows0 = await base
        .select([
          'id',
          'status',
          'total',
          'tax',
          'tip',
          'discount',
          'created_at',
          'paid_at',
          'payload',
          'display_number',
          'table_name',
          'created_by_staff_id',
          'created_by_name',
        ])
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const items = rows0.map((o) => {
        const payload = o.payload
          ? (() => {
              try {
                return JSON.parse(String(o.payload));
              } catch {
                return {};
              }
            })()
          : {};
        return {
          id: String(o.id),
          number: String(o.display_number || payload?.number || ''),
          tableName: String(o.table_name || payload?.tableName || ''),
          timeLabel: String(payload?.timeLabel || ''),
          createdByName: String(o.created_by_name || payload?.createdByName || ''),
          createdByStaffId: String(o.created_by_staff_id || payload?.createdByStaffId || ''),
          items: Array.isArray(payload?.items) ? payload.items : [],
          status: String(o.status || ''),
          total: Number(o.total || 0),
          createdAt: o.created_at ? new Date(o.created_at).toISOString() : '',
          paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : '',
        };
      });

      return res.json({ ok: true, orders: items, page, pageSize, total, branchId });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history/export/xlsx',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter Manager'),
    requireFeature('waiter_history'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const today = new Date().toISOString().slice(0, 10);

      const agg = await buildWaiterTodaySalesReport({ tenantId: req.tenant.id, branchId, date: today });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'MirachPOS';
      wb.created = new Date();

      // Summary sheet: Centered header and full totals block
      const summary = wb.addWorksheet('Summary');
      const summaryMaxCol = 2;
      
            // Header rows
      summary.addRow([businessName]);
      summary.getRow(1).font = { bold: true, size: 16 };
      summary.getRow(1).alignment = { horizontal: 'center' };
      summary.mergeCells(1, 1, 1, summaryMaxCol);

      summary.addRow(['Waiter Daily Sales']);
      summary.getRow(2).font = { bold: true, size: 14 };
      summary.getRow(2).alignment = { horizontal: 'center' };
      summary.mergeCells(2, 1, 2, summaryMaxCol);

      summary.addRow([`Period: ${agg.date} to ${agg.date}`]);
      summary.getRow(3).font = { size: 11 };
      summary.getRow(3).alignment = { horizontal: 'center' };
      summary.mergeCells(3, 1, 3, summaryMaxCol);

      summary.addRow([]);

      // Data rows
      summary.addRow(['Orders Paid', agg.orderCount]);
      summary.addRow(['Gross Sales (ETB)', Number(agg.grossSales || 0).toFixed(2)]);
      summary.addRow(['Discounts (ETB)', Number(agg.discounts || 0).toFixed(2)]);
      summary.addRow(['Net Sales (ETB)', Number(agg.netSales || 0).toFixed(2)]);
      summary.addRow(['Tax (ETB)', Number(agg.tax || 0).toFixed(2)]);
      summary.addRow(['Tips (ETB)', Number(agg.tips || 0).toFixed(2)]);
      summary.addRow(['Total Collected (ETB)', Number(agg.totalCollected || 0).toFixed(2)]);
      
      summary.getColumn(1).width = 26;
      summary.getColumn(2).width = 18;
      summary.getColumn(2).alignment = { horizontal: 'right' };

      // Products sheet: Centered header and all columns from image example
      // Create Daily Summary sheet first (main overview like Smartsheet template)
      const summarySheet = wb.addWorksheet('Daily Summary');
      
      // Title section with styling
      summarySheet.addRow([businessName]);
      summarySheet.getRow(1).font = { bold: true, size: 20, color: { argb: '1A365D' } };
      summarySheet.getRow(1).alignment = { horizontal: 'center' };
      summarySheet.mergeCells(1, 1, 1, 4);
      
      summarySheet.addRow(['DAILY SALES REPORT']);
      summarySheet.getRow(2).font = { bold: true, size: 16, color: { argb: '2C5282' } };
      summarySheet.getRow(2).alignment = { horizontal: 'center' };
      summarySheet.mergeCells(2, 1, 2, 4);
      
      summarySheet.addRow([`Date: ${agg.date}`]);
      summarySheet.getRow(3).font = { size: 12, color: { argb: '718096' } };
      summarySheet.getRow(3).alignment = { horizontal: 'center' };
      summarySheet.mergeCells(3, 1, 3, 4);
      summarySheet.addRow([]);
      
      // Sales Summary Section
      summarySheet.addRow(['SALES SUMMARY']);
      summarySheet.getRow(5).font = { bold: true, size: 12, color: { argb: '1A365D' } };
      summarySheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };
      
      const summaryData = [
        ['Total Orders:', agg.orderCount || 0, 'Gross Sales:', `ETB ${(Number(agg.grossSales || 0)).toFixed(2)}`],
        ['Net Sales:', `ETB ${(Number(agg.netSales || 0)).toFixed(2)}`, 'Discounts:', `ETB ${(Number(agg.discounts || 0)).toFixed(2)}`],
        ['Tax:', `ETB ${(Number(agg.tax || 0)).toFixed(2)}`, 'Tips:', `ETB ${(Number(agg.tips || 0)).toFixed(2)}`],
        ['Total Collected:', `ETB ${(Number(agg.totalCollected || 0)).toFixed(2)}`, 'Avg Order:', `ETB ${(Number(agg.avgOrderValue || 0)).toFixed(2)}`],
      ];
      
      summaryData.forEach((row, idx) => {
        const rowNum = 6 + idx;
        summarySheet.addRow(row);
        summarySheet.getRow(rowNum).font = { size: 11 };
        summarySheet.getRow(rowNum).getCell(1).font = { bold: true, size: 11 };
        summarySheet.getRow(rowNum).getCell(3).font = { bold: true, size: 11 };
      });
      
      summarySheet.addRow([]);
      
      // Payment Settlements Section
      summarySheet.addRow(['PAYMENT SETTLEMENTS']);
      summarySheet.getRow(10).font = { bold: true, size: 12, color: { argb: '1A365D' } };
      summarySheet.getRow(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };
      
      if (agg.paymentMethods && agg.paymentMethods.length > 0) {
        agg.paymentMethods.forEach((pm, idx) => {
          const rowNum = 11 + idx;
          summarySheet.addRow([`${pm.method}:`, `${pm.count} orders`, `ETB ${Number(pm.total || 0).toFixed(2)}`, '']);
          summarySheet.getRow(rowNum).font = { size: 11 };
          summarySheet.getRow(rowNum).getCell(1).font = { bold: true, size: 11 };
        });
        // Total row
        const totalRowNum = 11 + agg.paymentMethods.length;
        summarySheet.addRow(['Total Settlements:', `${agg.orderCount} orders`, `ETB ${agg.paymentMethods.reduce((sum, pm) => sum + Number(pm.total || 0), 0).toFixed(2)}`, '']);
        summarySheet.getRow(totalRowNum).font = { bold: true, size: 11, color: { argb: '1A365D' } };
      }
      
      // Staff Performance Summary
      if (agg.staffPerformance && agg.staffPerformance.length > 0) {
        summarySheet.addRow([]);
        const staffStartRow = summarySheet.rowCount + 1;
        summarySheet.addRow(['STAFF PERFORMANCE']);
        summarySheet.getRow(staffStartRow).font = { bold: true, size: 12, color: { argb: '1A365D' } };
        summarySheet.getRow(staffStartRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };
        
        agg.staffPerformance.forEach((s, idx) => {
          const rowNum = staffStartRow + 1 + idx;
          summarySheet.addRow([s.staffName, `${s.orderCount} orders`, `Sales: ETB ${Number(s.totalSales || 0).toFixed(2)}`, `Tips: ETB ${Number(s.totalTips || 0).toFixed(2)}`]);
          summarySheet.getRow(rowNum).font = { size: 11 };
        });
      }
      
      // Hourly Summary
      if (agg.hourlySales && agg.hourlySales.length > 0) {
        summarySheet.addRow([]);
        const hourlyStartRow = summarySheet.rowCount + 1;
        summarySheet.addRow(['HOURLY BREAKDOWN']);
        summarySheet.getRow(hourlyStartRow).font = { bold: true, size: 12, color: { argb: '1A365D' } };
        summarySheet.getRow(hourlyStartRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };
        
        agg.hourlySales.forEach((h, idx) => {
          const rowNum = hourlyStartRow + 1 + idx;
          summarySheet.addRow([`Hour ${h.hour}:`, `${h.orderCount} orders`, `ETB ${Number(h.total || 0).toFixed(2)}`, '']);
          summarySheet.getRow(rowNum).font = { size: 11 };
        });
      }
      
      // Set column widths
      summarySheet.columns = [
        { width: 25 },
        { width: 18 },
        { width: 25 },
        { width: 20 },
      ];

      // Products Detail Sheet
      const products = wb.addWorksheet('Products');
      const prodMaxCol = 6;

      // Header rows
      products.addRow([businessName]);
      products.getRow(1).font = { bold: true, size: 16, color: { argb: '1A365D' } };
      products.getRow(1).alignment = { horizontal: 'center' };
      products.mergeCells(1, 1, 1, prodMaxCol);

      products.addRow(['Product Sales Detail']);
      products.getRow(2).font = { bold: true, size: 14, color: { argb: '2C5282' } };
      products.getRow(2).alignment = { horizontal: 'center' };
      products.mergeCells(2, 1, 2, prodMaxCol);

      products.addRow([`Date: ${agg.date}`]);
      products.getRow(3).font = { size: 11, color: { argb: '718096' } };
      products.getRow(3).alignment = { horizontal: 'center' };
      products.mergeCells(3, 1, 3, prodMaxCol);
      products.addRow([]);

      // Table Header row with styling
      const headerCols = ['Product', 'Category', 'Qty Sold', 'Unit Price', 'Revenue (ETB)', 'Void Qty'];
      products.addRow(headerCols);
      const headerRow = products.getRow(5);
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A365D' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

      products.columns = [
        { key: 'name', width: 32 },
        { key: 'category', width: 18 },
        { key: 'qtySold', width: 12 },
        { key: 'unitPrice', width: 14, style: { numFmt: '#,##0.00' } },
        { key: 'revenue', width: 16, style: { numFmt: '#,##0.00' } },
        { key: 'voidQty', width: 12 },
      ];

      for (const p of agg.products) {
        const qtySold = Number(p.qtySold || 0);
        const revenue = Number(p.revenue || 0);
        const unitPrice = qtySold > 0 ? revenue / qtySold : 0;
        products.addRow([
          String(p.name || ''),
          String(p.category || ''),
          qtySold,
          unitPrice,
          revenue,
          Number(p.voidQty || 0),
        ]);
      }

      // Add total row
      const prodTotalRow = products.rowCount + 1;
      products.addRow(['TOTAL', '', agg.products.reduce((sum, p) => sum + Number(p.qtySold || 0), 0), '', agg.products.reduce((sum, p) => sum + Number(p.revenue || 0), 0).toFixed(2), '']);
      products.getRow(prodTotalRow).font = { bold: true, color: { argb: '1A365D' } };
      products.getRow(prodTotalRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };

      products.views = [{ state: 'frozen', ySplit: 5 }];

      // Payment Methods sheet with Tips and Sales breakdown
      if (agg.paymentMethods && agg.paymentMethods.length > 0) {
        const pmSheet = wb.addWorksheet('Payment Methods');
        const pmMaxCol = 3;
        
        pmSheet.addRow([businessName]);
        pmSheet.getRow(1).font = { bold: true, size: 16 };
        pmSheet.getRow(1).alignment = { horizontal: 'center' };
        pmSheet.mergeCells(1, 1, 1, pmMaxCol);
        
        pmSheet.addRow(['Payment Methods Breakdown']);
        pmSheet.getRow(2).font = { bold: true, size: 14 };
        pmSheet.getRow(2).alignment = { horizontal: 'center' };
        pmSheet.mergeCells(2, 1, 2, pmMaxCol);
        
        pmSheet.addRow([`Date: ${agg.date}`]);
        pmSheet.getRow(3).font = { size: 11 };
        pmSheet.getRow(3).alignment = { horizontal: 'center' };
        pmSheet.mergeCells(3, 1, 3, pmMaxCol);
        pmSheet.addRow([]);
        
        const pmHeaders = ['Payment Method', 'Orders', 'Amount (ETB)'];
        pmSheet.addRow(pmHeaders);
        pmSheet.getRow(5).font = { bold: true };
        pmSheet.getRow(5).alignment = { horizontal: 'center' };
        
        agg.paymentMethods.forEach((pm) => {
          pmSheet.addRow([pm.method, pm.count, Number(pm.total || 0).toFixed(2)]);
        });
        
        // Add total row
        const totalRow = pmSheet.rowCount + 1;
        pmSheet.addRow(['Total', agg.orderCount, agg.paymentMethods.reduce((sum, pm) => sum + Number(pm.total || 0), 0).toFixed(2)]);
        pmSheet.getRow(totalRow).font = { bold: true };
        
        pmSheet.columns = [
          { width: 20 },
          { width: 12, style: { numFmt: '0' } },
          { width: 18, style: { numFmt: '#,##0.00' } },
        ];
      }

      // Staff Performance sheet with Sales and Tips
      if (agg.staffPerformance && agg.staffPerformance.length > 0) {
        const staffSheet = wb.addWorksheet('Staff Performance');
        const staffMaxCol = 4;
        
        staffSheet.addRow([businessName]);
        staffSheet.getRow(1).font = { bold: true, size: 16 };
        staffSheet.getRow(1).alignment = { horizontal: 'center' };
        staffSheet.mergeCells(1, 1, 1, staffMaxCol);
        
        staffSheet.addRow(['Staff Performance Report']);
        staffSheet.getRow(2).font = { bold: true, size: 14 };
        staffSheet.getRow(2).alignment = { horizontal: 'center' };
        staffSheet.mergeCells(2, 1, 2, staffMaxCol);
        
        staffSheet.addRow([`Date: ${agg.date}`]);
        staffSheet.getRow(3).font = { size: 11 };
        staffSheet.getRow(3).alignment = { horizontal: 'center' };
        staffSheet.mergeCells(3, 1, 3, staffMaxCol);
        staffSheet.addRow([]);
        
        const staffHeaders = ['Staff Name', 'Orders', 'Sales (ETB)', 'Tips (ETB)'];
        staffSheet.addRow(staffHeaders);
        staffSheet.getRow(5).font = { bold: true };
        staffSheet.getRow(5).alignment = { horizontal: 'center' };
        
        agg.staffPerformance.forEach((s) => {
          staffSheet.addRow([s.staffName, s.orderCount, Number(s.totalSales || 0).toFixed(2), Number(s.totalTips || 0).toFixed(2)]);
        });
        
        // Add total row
        const totalRow = staffSheet.rowCount + 1;
        staffSheet.addRow(['Total', agg.orderCount, agg.staffPerformance.reduce((sum, s) => sum + Number(s.totalSales || 0), 0).toFixed(2), agg.staffPerformance.reduce((sum, s) => sum + Number(s.totalTips || 0), 0).toFixed(2)]);
        staffSheet.getRow(totalRow).font = { bold: true };
        
        staffSheet.columns = [
          { width: 25 },
          { width: 12, style: { numFmt: '0' } },
          { width: 16, style: { numFmt: '#,##0.00' } },
          { width: 16, style: { numFmt: '#,##0.00' } },
        ];
      }

      // Hourly Sales sheet
      if (agg.hourlySales && agg.hourlySales.length > 0) {
        const hourlySheet = wb.addWorksheet('Hourly Sales');
        const hourlyMaxCol = 3;
        
        hourlySheet.addRow([businessName]);
        hourlySheet.getRow(1).font = { bold: true, size: 16 };
        hourlySheet.getRow(1).alignment = { horizontal: 'center' };
        hourlySheet.mergeCells(1, 1, 1, hourlyMaxCol);
        
        hourlySheet.addRow(['Hourly Sales Breakdown']);
        hourlySheet.getRow(2).font = { bold: true, size: 14 };
        hourlySheet.getRow(2).alignment = { horizontal: 'center' };
        hourlySheet.mergeCells(2, 1, 2, hourlyMaxCol);
        
        hourlySheet.addRow([`Date: ${agg.date}`]);
        hourlySheet.getRow(3).font = { size: 11 };
        hourlySheet.getRow(3).alignment = { horizontal: 'center' };
        hourlySheet.mergeCells(3, 1, 3, hourlyMaxCol);
        hourlySheet.addRow([]);
        
        const hourlyHeaders = ['Hour', 'Orders', 'Sales (ETB)'];
        hourlySheet.addRow(hourlyHeaders);
        hourlySheet.getRow(5).font = { bold: true };
        hourlySheet.getRow(5).alignment = { horizontal: 'center' };
        
        agg.hourlySales.forEach((h) => {
          hourlySheet.addRow([h.hour, h.orderCount, Number(h.total || 0).toFixed(2)]);
        });
        
        // Add total row
        const totalRow = hourlySheet.rowCount + 1;
        hourlySheet.addRow(['Total', agg.orderCount, agg.hourlySales.reduce((sum, h) => sum + Number(h.total || 0), 0).toFixed(2)]);
        hourlySheet.getRow(totalRow).font = { bold: true };
        
        hourlySheet.columns = [
          { width: 15 },
          { width: 12, style: { numFmt: '0' } },
          { width: 18, style: { numFmt: '#,##0.00' } },
        ];
      }

      const buf = await wb.xlsx.writeBuffer();
      const filename = `waiter_daily_sales_${branchId}_${agg.date}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buf));
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/history/export/pdf',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter Manager'),
    requireFeature('waiter_history'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const branchId = resolveBranchId(req);
      const today = new Date().toISOString().slice(0, 10);

      const agg = await buildWaiterTodaySalesReport({ tenantId: req.tenant.id, branchId, date: today });
      if (!agg?.ok) return res.status(400).json({ error: agg?.error || 'aggregation_failed' });

      const businessName = await getTenantBusinessName(req.tenant.id);
      const { generateReportPDF } = require('../services/pdfService');

      const settingsRow = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
      const settingsRaw = settingsRow?.settings_json ? String(settingsRow.settings_json) : '';
      let logoDataUrl = '';
      try {
        const parsed = settingsRaw ? JSON.parse(settingsRaw) : {};
        logoDataUrl = typeof parsed?.receipt?.logoDataUrl === 'string' ? String(parsed.receipt.logoDataUrl) : '';
      } catch {
        logoDataUrl = '';
      }

      const totals = [
        { label: 'Orders Paid', value: String(agg.orderCount || 0) },
        { label: 'Gross Sales', value: `ETB ${(Number(agg.grossSales || 0) || 0).toFixed(2)}` },
        { label: 'Discounts', value: `ETB ${(Number(agg.discounts || 0) || 0).toFixed(2)}` },
        { label: 'Net Sales', value: `ETB ${(Number(agg.netSales || 0) || 0).toFixed(2)}` },
        { label: 'Tax', value: `ETB ${(Number(agg.tax || 0) || 0).toFixed(2)}` },
        { label: 'Tips', value: `ETB ${(Number(agg.tips || 0) || 0).toFixed(2)}` },
        { label: 'Total Collected', value: `ETB ${(Number(agg.totalCollected || 0) || 0).toFixed(2)}` },
        { label: 'Avg Order Value', value: `ETB ${(Number(agg.avgOrderValue || 0) || 0).toFixed(2)}` },
        { label: 'Voids/Refunds', value: `${Number(agg.voidCount || 0)} (ETB ${(Number(agg.voidAmount || 0) || 0).toFixed(2)})` },
      ];

      // Prepare additional sections for the comprehensive report
      const additionalSections = [];

      // Payment Methods section (always included, even if empty)
      additionalSections.push({
        title: 'Payment Methods',
        columns: [
          { header: 'Method', key: 'method', width: 150 },
          { header: 'Orders', key: 'count', width: 80, align: 'right' },
          { header: 'Amount (ETB)', key: 'total', width: 120, align: 'right', format: (n) => Number(n).toFixed(2) },
        ],
        rows: (agg.paymentMethods || []).map((p) => ({
          method: p.method,
          count: p.count,
          total: p.total,
        })),
      });

      // Staff Performance section (always included, even if empty)
      additionalSections.push({
        title: 'Staff Performance',
        columns: [
          { header: 'Staff', key: 'staffName', width: 180 },
          { header: 'Orders', key: 'orderCount', width: 70, align: 'right' },
          { header: 'Sales (ETB)', key: 'totalSales', width: 100, align: 'right', format: (n) => Number(n).toFixed(2) },
          { header: 'Tips (ETB)', key: 'totalTips', width: 100, align: 'right', format: (n) => Number(n).toFixed(2) },
        ],
        rows: (agg.staffPerformance || []).map((s) => ({
          staffName: s.staffName,
          orderCount: s.orderCount,
          totalSales: s.totalSales,
          totalTips: s.totalTips,
        })),
      });

      // Hourly Sales section (always included, even if empty)
      additionalSections.push({
        title: 'Hourly Sales',
        columns: [
          { header: 'Hour', key: 'hour', width: 100 },
          { header: 'Orders', key: 'orderCount', width: 80, align: 'right' },
          { header: 'Sales (ETB)', key: 'total', width: 120, align: 'right', format: (n) => Number(n).toFixed(2) },
        ],
        rows: (agg.hourlySales || []).map((h) => ({
          hour: h.hour,
          orderCount: h.orderCount,
          total: h.total,
        })),
      });

      const columns = [
        { header: 'Product', key: 'name', width: 180 },
        { header: 'Category', key: 'category', width: 100 },
        { header: 'Qty Sold', key: 'qtySold', width: 70, align: 'right' },
        { header: 'Unit Price', key: 'unitPrice', width: 90, align: 'right', format: (n) => Number(n).toFixed(2) },
        { header: 'Revenue (ETB)', key: 'revenue', width: 90, align: 'right', format: (n) => Number(n).toFixed(2) },
      ];

      const rows = agg.products.map((p) => ({
        name: String(p.name || ''),
        category: String(p.category || ''),
        qtySold: Number(p.qtySold || 0),
        unitPrice: Number(p.qtySold || 0) > 0 ? Number(p.revenue || 0) / Number(p.qtySold || 0) : 0,
        revenue: Number(p.revenue || 0),
      }));

      const pdf = await generateReportPDF('Waiter Daily Sales', { from: agg.date, to: agg.date }, columns, rows, { businessName, totals, logoDataUrl, additionalSections });
      const filename = `waiter_daily_sales_${branchId}_${agg.date}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdf);
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/order/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_orders_active'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      const orderId = String(req.params?.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'order_id_required' });

      const row = await db()
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'created_at', 'payload'])
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .first();

      if (!row) return res.status(404).json({ error: 'not_found' });

      const payload = row.payload
        ? (() => {
            try {
              return JSON.parse(String(row.payload));
            } catch {
              return {};
            }
          })()
        : {};

      const order = {
        id: String(row.id),
        number: String(payload?.number || ''),
        tableName: String(payload?.tableName || ''),
        timeLabel: String(payload?.timeLabel || ''),
        createdByName: String(payload?.createdByName || ''),
        createdByStaffId: String(payload?.createdByStaffId || ''),
        items: Array.isArray(payload?.items) ? payload.items : [],
        status: String(row.status || ''),
        total: Number(row.total || 0),
        tax: Number(row.tax || 0),
        tip: Number(row.tip || 0),
        discount: Number(row.discount || 0),
        discountPct: payload?.discountPct == null ? 0 : Number(payload.discountPct || 0) || 0,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        payload,
      };

      if (role !== 'Waiter Manager' && String(order.createdByStaffId || '').trim() !== staffId) return res.status(403).json({ error: 'forbidden' });

      return res.json({ ok: true, branchId, order });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/waiter/shift-report',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireRole('Waiter', 'Waiter Manager'),
    requireFeature('waiter_shift_report'),
    async (req, res, next) => {
    try {
      if (!requireWaiter(req, res)) return;

      const role = String(req.auth?.role || '').trim();
      const branchId = resolveBranchId(req);
      const staffId = String(req.auth?.staffId || '');
      if (!staffId) return res.status(401).json({ error: 'unauthorized' });

      if (role === 'Waiter Manager') {
        const staff = await db().select(['id']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
        if (!staff) return res.status(404).json({ error: 'staff_not_found' });
      }

      const logs = await db()
        .select(['id', 'staff_id', 'clock_in_at', 'clock_out_at'])
        .from('shift_logs')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, staff_id: staffId })
        .orderBy('clock_in_at', 'desc')
        .limit(500);

      const staff = await db().select(['name']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
      const staffName = staff ? String(staff.name || '') : '';

      const shiftLogs = logs.map((l) => ({
        id: String(l.id),
        staffId: String(l.staff_id),
        staffName,
        clockInAt: new Date(l.clock_in_at).toISOString(),
        clockOutAt: l.clock_out_at ? new Date(l.clock_out_at).toISOString() : undefined,
      }));

      return res.json({ ok: true, branchId, staffId, shiftLogs });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeWaiterRouter };
