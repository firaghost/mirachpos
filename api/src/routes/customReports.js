/**
 * Custom Reports API
 * 
 * Provides flexible querying for custom report builder
 */

const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const makeCustomReportsRouter = () => {
  const r = express.Router();

  // Get custom report data
  r.get('/owner/reports/custom', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
    try {
      const tenantId = req.tenant?.id;
      if (!tenantId) return res.status(403).json({ error: 'forbidden' });

      const branchId = req.query?.branchId || null;
      const from = req.query?.from;
      const to = req.query?.to;
      const fields = String(req.query?.fields || '').split(',').filter(Boolean);
      const sortBy = req.query?.sortBy || 'orderDate';
      const sortDirection = req.query?.sortDirection === 'asc' ? 'asc' : 'desc';

      if (!from || !to || fields.length === 0) {
        return res.status(400).json({ error: 'missing_parameters' });
      }

      // Build query
      let query = db()
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
        .leftJoin({ b: 'branches' }, function () {
          this.on('b.id', '=', 'o.branch_id')
            .andOn('b.tenant_id', '=', 'o.tenant_id');
        })
        .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
        .andWhere((qb) => {
          qb.whereBetween('o.paid_at', [`${from} 00:00:00`, `${to} 23:59:59`])
            .orWhereBetween('o.paid_at', [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`]);
        });

      if (branchId) query = query.andWhere({ 'o.branch_id': branchId });

      // Apply filters
      const filters = [];
      let idx = 0;
      while (req.query?.[`filter[${idx}][field]`]) {
        filters.push({
          field: req.query[`filter[${idx}][field]`],
          operator: req.query[`filter[${idx}][operator]`],
          value: req.query[`filter[${idx}][value]`],
        });
        idx++;
      }

      filters.forEach((filter) => {
        if (!filter.field || !filter.value) return;

        const columnMap = {
          orderId: 'o.id',
          orderDate: 'o.paid_at',
          productName: 'oi.name',
          category: 'p.category',
          quantity: 'oi.qty',
          unitPrice: 'oi.unit_price',
          discount: 'o.discount',
          tax: 'o.tax',
          tip: 'o.tip',
          total: 'o.total',
          paymentMethod: db().raw("JSON_EXTRACT(o.payload, '$.paymentMethod')"),
          status: 'o.status',
          branchName: 'b.name',
        };

        const column = columnMap[filter.field] || filter.field;

        switch (filter.operator) {
          case 'eq':
            query = query.andWhere(column, filter.value);
            break;
          case 'neq':
            query = query.andWhere(column, '!=', filter.value);
            break;
          case 'gt':
            query = query.andWhere(column, '>', filter.value);
            break;
          case 'gte':
            query = query.andWhere(column, '>=', filter.value);
            break;
          case 'lt':
            query = query.andWhere(column, '<', filter.value);
            break;
          case 'lte':
            query = query.andWhere(column, '<=', filter.value);
            break;
          case 'contains':
            query = query.andWhere(column, 'like', `%${filter.value}%`);
            break;
          case 'in':
            const values = filter.value.split(',').map((v) => v.trim());
            query = query.andWhere(column, 'in', values);
            break;
        }
      });

      // Select fields
      const selectFields = [];
      const fieldMappings = {
        orderId: 'o.id as orderId',
        orderDate: 'o.paid_at as orderDate',
        customerName: db().raw("COALESCE(JSON_EXTRACT(o.payload, '$.customerName'), 'Guest') as customerName"),
        staffName: db().raw("COALESCE(JSON_EXTRACT(o.payload, '$.createdByName'), 'Unknown') as staffName"),
        branchName: 'b.name as branchName',
        productName: 'oi.name as productName',
        category: db().raw("COALESCE(p.category, 'Uncategorized') as category"),
        quantity: db().raw('GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0)) as quantity'),
        unitPrice: 'oi.unit_price as unitPrice',
        discount: 'o.discount as discount',
        tax: 'o.tax as tax',
        tip: 'o.tip as tip',
        total: 'o.total as total',
        paymentMethod: db().raw("COALESCE(JSON_EXTRACT(o.payload, '$.paymentMethod'), 'Other') as paymentMethod"),
        status: 'o.status as status',
      };

      fields.forEach((field) => {
        if (fieldMappings[field]) selectFields.push(fieldMappings[field]);
      });

      if (selectFields.length === 0) {
        return res.status(400).json({ error: 'invalid_fields' });
      }

      query = query.select(selectFields);

      // Group by
      if (req.query?.groupBy) {
        const groupField = req.query.groupBy;
        const aggregation = req.query?.aggregation || 'sum';
        const aggField = req.query?.aggField || 'total';

        const groupColumn = fieldMappings[groupField] || groupField;
        query = query.groupBy(groupField);

        // Add aggregation
        switch (aggregation) {
          case 'sum':
            query = query.sum({ aggregated: aggField });
            break;
          case 'count':
            query = query.count({ aggregated: 'o.id' });
            break;
          case 'avg':
            query = query.avg({ aggregated: aggField });
            break;
          case 'min':
            query = query.min({ aggregated: aggField });
            break;
          case 'max':
            query = query.max({ aggregated: aggField });
            break;
        }
      }

      // Sort
      const sortColumn = fieldMappings[sortBy] || sortBy;
      query = query.orderBy(sortColumn, sortDirection);

      // Limit
      query = query.limit(10000);

      const data = await query;

      return res.json({
        ok: true,
        count: data.length,
        data: data.map((row) => {
          // Parse JSON fields
          const parsed = { ...row };
          if (parsed.customerName && typeof parsed.customerName === 'string') {
            try { parsed.customerName = JSON.parse(parsed.customerName); } catch {}
          }
          if (parsed.paymentMethod && typeof parsed.paymentMethod === 'string') {
            try { parsed.paymentMethod = JSON.parse(parsed.paymentMethod); } catch {}
          }
          return parsed;
        }),
      });
    } catch (e) {
      console.error('[CustomReports] Error:', e);
      return next(e);
    }
  });

  // Get period comparison data
  r.get('/owner/reports/compare', tenantMiddleware, requireAuth, loadEntitlements, requireModule('reports'), async (req, res, next) => {
    try {
      const tenantId = req.tenant?.id;
      if (!tenantId) return res.status(403).json({ error: 'forbidden' });

      const branchId = req.query?.branchId || null;
      const currentFrom = req.query?.currentFrom;
      const currentTo = req.query?.currentTo;
      const previousFrom = req.query?.previousFrom;
      const previousTo = req.query?.previousTo;

      if (!currentFrom || !currentTo || !previousFrom || !previousTo) {
        return res.status(400).json({ error: 'missing_date_ranges' });
      }

      const getPeriodData = async (from, to) => {
        let query = db()
          .from('orders')
          .where({ tenant_id: tenantId, status: 'Paid' })
          .andWhere((qb) => {
            qb.whereBetween('paid_at', [`${from} 00:00:00`, `${to} 23:59:59`])
              .orWhereBetween('paid_at', [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`]);
          });

        if (branchId) query = query.andWhere({ branch_id: branchId });

        const [orderAgg, itemAgg] = await Promise.all([
          query
            .clone()
            .select([
              db().raw('COUNT(*) as order_count'),
              db().raw('COALESCE(SUM(COALESCE(total, 0) - COALESCE(tax, 0) - COALESCE(tip, 0)), 0) as net_sales'),
              db().raw('COALESCE(SUM(COALESCE(discount, 0)), 0) as discounts'),
              db().raw('COALESCE(AVG(COALESCE(total, 0) - COALESCE(tax, 0) - COALESCE(tip, 0)), 0) as avg_ticket'),
            ])
            .first(),
          db()
            .from({ oi: 'order_items' })
            .innerJoin({ o: 'orders' }, function () {
              this.on('o.id', '=', 'oi.order_id')
                .andOn('o.tenant_id', '=', 'oi.tenant_id')
                .andOn('o.branch_id', '=', 'oi.branch_id');
            })
            .where({ 'o.tenant_id': tenantId, 'o.status': 'Paid' })
            .andWhere((qb) => {
              qb.whereBetween('o.paid_at', [`${from} 00:00:00`, `${to} 23:59:59`])
                .orWhereBetween('o.paid_at', [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`]);
            })
            .modify((qb) => {
              if (branchId) qb.andWhere({ 'o.branch_id': branchId });
            })
            .select([
              db().raw('COALESCE(SUM(GREATEST(0, COALESCE(oi.qty, 0) - COALESCE(oi.voided_qty, 0))), 0) as item_count'),
            ])
            .first(),
        ]);

        return {
          sales: Number(orderAgg?.net_sales || 0),
          orders: Number(orderAgg?.order_count || 0),
          avgTicket: Number(orderAgg?.avg_ticket || 0),
          items: Number(itemAgg?.item_count || 0),
          discounts: Number(orderAgg?.discounts || 0),
        };
      };

      const [current, previous] = await Promise.all([
        getPeriodData(currentFrom, currentTo),
        getPeriodData(previousFrom, previousTo),
      ]);

      return res.json({
        ok: true,
        currentPeriod: { from: currentFrom, to: currentTo, ...current },
        previousPeriod: { from: previousFrom, to: previousTo, ...previous },
        changes: {
          sales: previous.sales > 0 ? ((current.sales - previous.sales) / previous.sales) * 100 : (current.sales > 0 ? 100 : 0),
          orders: previous.orders > 0 ? ((current.orders - previous.orders) / previous.orders) * 100 : (current.orders > 0 ? 100 : 0),
          avgTicket: previous.avgTicket > 0 ? ((current.avgTicket - previous.avgTicket) / previous.avgTicket) * 100 : (current.avgTicket > 0 ? 100 : 0),
          items: previous.items > 0 ? ((current.items - previous.items) / previous.items) * 100 : (current.items > 0 ? 100 : 0),
        },
      });
    } catch (e) {
      console.error('[CustomReports] Comparison error:', e);
      return next(e);
    }
  });

  return r;
};

module.exports = { makeCustomReportsRouter };
