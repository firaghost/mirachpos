const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { resolveBranchId, requireBranchId } = require('../middleware/branchScope');
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

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pad6 = (n) => {
  const v = Math.max(0, Number(n) || 0);
  return String(Math.floor(v)).padStart(6, '0');
};

const makeManagerPurchaseOrdersRouter = () => {
  const r = express.Router();

  const requireManagerOrOwner = (req, res) => {
    if (req.auth?.tenantId !== req.tenant.id) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    const role = String(req.auth?.role || '');
    if (role !== 'Branch Manager' && role !== 'Cafe Owner') {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  const mapPoRow = (row) => {
    const pj = safeJsonParse(row.po_json, {});
    return {
      id: String(row.id),
      supplierId: String(row.supplier_id || ''),
      referenceNo: String(row.reference_no || ''),
      status: String(row.status || 'Draft'),
      total: toNum(row.total),
      notes: typeof row.notes === 'string' ? row.notes : '',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      meta: pj || null,
    };
  };

  const mapPoItemRow = (row) => {
    const ij = safeJsonParse(row.item_json, {});
    return {
      id: String(row.id),
      purchaseOrderId: String(row.purchase_order_id || ''),
      inventoryItemId: String(row.inventory_item_id || ''),
      name: String(row.name || ''),
      unit: String(row.unit || ''),
      qtyOrdered: toNum(row.qty_ordered),
      qtyReceived: toNum(row.qty_received),
      unitCost: toNum(row.unit_cost),
      lineTotal: toNum(row.line_total),
      meta: ij || null,
    };
  };

  const computeTotals = (items) => {
    const rows = Array.isArray(items) ? items : [];
    const normalized = rows
      .map((it) => {
        const inventoryItemId = String(it?.inventoryItemId || it?.inventory_item_id || '').trim();
        const name = String(it?.name || '').trim();
        const unit = String(it?.unit || '').trim();
        const qtyOrdered = Math.max(0, toNum(it?.qtyOrdered ?? it?.qty_ordered));
        const unitCost = Math.max(0, toNum(it?.unitCost ?? it?.unit_cost));
        const lineTotal = qtyOrdered * unitCost;
        return { inventoryItemId, name, unit, qtyOrdered, unitCost, lineTotal };
      })
      .filter((x) => x.inventoryItemId && x.name);

    const total = normalized.reduce((sum, x) => sum + x.lineTotal, 0);
    return { items: normalized, total };
  };

  // LIST purchase orders
  r.get('/manager/purchase-orders', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const supplierId = typeof req.query?.supplierId === 'string' ? req.query.supplierId.trim() : '';
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));

      let q = db().from('purchase_orders').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (supplierId) q = q.andWhere({ supplier_id: supplierId });

      const rows = await q.select(['id', 'supplier_id', 'reference_no', 'status', 'total', 'notes', 'po_json', 'created_at', 'updated_at', 'sent_at', 'received_at']).orderBy('updated_at', 'desc').limit(limit);

      return res.json({ ok: true, branchId, purchaseOrders: rows.map(mapPoRow) });
    } catch (e) {
      return next(e);
    }
  });

  // GET purchase order detail
  r.get('/manager/purchase-orders/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const po = await db()
        .from('purchase_orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
        .select(['id', 'supplier_id', 'reference_no', 'status', 'total', 'notes', 'po_json', 'created_at', 'updated_at', 'sent_at', 'received_at'])
        .first();
      if (!po) return res.status(404).json({ error: 'not_found' });

      const items = await db()
        .from('purchase_order_items')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, purchase_order_id: id })
        .select(['id', 'purchase_order_id', 'inventory_item_id', 'name', 'unit', 'qty_ordered', 'qty_received', 'unit_cost', 'line_total', 'item_json'])
        .orderBy('created_at', 'asc');

      return res.json({ ok: true, branchId, purchaseOrder: mapPoRow(po), items: items.map(mapPoItemRow) });
    } catch (e) {
      return next(e);
    }
  });

  // CREATE purchase order
  r.post('/manager/purchase-orders', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const supplierId = String(body?.supplierId || '').trim();
      if (!supplierId) return res.status(400).json({ error: 'supplier_required' });

      const referenceNo = typeof body?.referenceNo === 'string' ? body.referenceNo.trim() : '';
      const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
      const status = body?.status === 'Sent' ? 'Sent' : 'Draft';

      const { items, total } = computeTotals(body?.items);
      if (items.length === 0) return res.status(400).json({ error: 'items_required' });

      const nowIso = new Date().toISOString();
      const id = makeId('po');

      let finalRef = referenceNo;

      await db().transaction(async (trx) => {
        // verify supplier exists
        const sup = await trx.from('suppliers').where({ tenant_id: req.tenant.id, branch_id: branchId, id: supplierId }).select(['id']).first();
        if (!sup) throw new Error('supplier_not_found');

        // Auto-generate reference number per branch when not provided.
        // Format: PO-000001 (sequence per tenant+branch)
        if (!finalRef) {
          const key = 'po';
          const counterRow = await trx
            .from('po_counters')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, key })
            .forUpdate()
            .first();

          const nextValue = counterRow ? Number(counterRow.next_value || 1) || 1 : 1;
          finalRef = `PO-${pad6(nextValue)}`;

          if (!counterRow) {
            await trx.from('po_counters').insert({
              tenant_id: req.tenant.id,
              branch_id: branchId,
              key,
              next_value: nextValue + 1,
              updated_at: nowIso,
            });
          } else {
            await trx
              .from('po_counters')
              .where({ tenant_id: req.tenant.id, branch_id: branchId, key })
              .update({ next_value: nextValue + 1, updated_at: nowIso });
          }
        }

        await trx.from('purchase_orders').insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: branchId,
          supplier_id: supplierId,
          reference_no: finalRef || null,
          status,
          total,
          notes: notes || null,
          po_json: JSON.stringify({ createdByStaffId: req.auth?.staffId ? String(req.auth.staffId) : null }),
          created_at: nowIso,
          updated_at: nowIso,
          sent_at: status === 'Sent' ? nowIso : null,
          received_at: null,
        });

        for (const it of items) {
          const itemId = makeId('poi');
          await trx.from('purchase_order_items').insert({
            id: itemId,
            tenant_id: req.tenant.id,
            branch_id: branchId,
            purchase_order_id: id,
            inventory_item_id: it.inventoryItemId,
            name: it.name,
            unit: it.unit || null,
            qty_ordered: it.qtyOrdered,
            qty_received: 0,
            unit_cost: it.unitCost,
            line_total: it.lineTotal,
            item_json: JSON.stringify({}),
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
      });

      return res.status(201).json({ ok: true, id, referenceNo: finalRef || '' });
    } catch (e) {
      if (e && typeof e === 'object' && String(e.message || '') === 'supplier_not_found') {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      return next(e);
    }
  });

  // UPDATE PO meta/status (Draft/Sent) + notes/reference
  r.put('/manager/purchase-orders/:id', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().from('purchase_orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).select(['id', 'status']).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const patch = { updated_at: new Date().toISOString() };

      if (typeof body?.referenceNo === 'string') patch.reference_no = body.referenceNo.trim() || null;
      if (typeof body?.notes === 'string') patch.notes = body.notes.trim() || null;

      if (typeof body?.status === 'string') {
        const st = body.status.trim();
        if (st === 'Draft' || st === 'Sent') {
          patch.status = st;
          if (st === 'Sent') patch.sent_at = patch.updated_at;
        }
      }

      await db().from('purchase_orders').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // RECEIVE items (partial/complete)
  // body: { items: [{ inventoryItemId, qtyReceivedDelta }], note?: string }
  r.post('/manager/purchase-orders/:id/receive', tenantMiddleware, requireAuth, loadEntitlements, requireModule('inventory'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const rows = Array.isArray(body?.items) ? body.items : [];
      const deltas = rows
        .map((x) => ({
          inventoryItemId: String(x?.inventoryItemId || x?.inventory_item_id || '').trim(),
          qty: toNum(x?.qtyReceivedDelta ?? x?.qty ?? 0),
        }))
        .filter((x) => x.inventoryItemId && x.qty > 0);

      if (deltas.length === 0) return res.status(400).json({ error: 'no_items' });

      const nowIso = new Date().toISOString();

      await db().transaction(async (trx) => {
        const po = await trx
          .from('purchase_orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status', 'po_json'])
          .first();
        if (!po) throw new Error('po_not_found');

        if (String(po.status) === 'Cancelled') throw new Error('po_cancelled');

        const curStatus = String(po.status || 'Draft');
        if (curStatus === 'Draft') throw new Error('po_not_sent');
        if (curStatus === 'Received') throw new Error('po_already_received');

        // Load items for validation
        const items = await trx
          .from('purchase_order_items')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, purchase_order_id: id })
          .select(['id', 'inventory_item_id', 'qty_ordered', 'qty_received']);

        const byInv = new Map(items.map((it) => [String(it.inventory_item_id), it]));

        for (const d of deltas) {
          const it = byInv.get(d.inventoryItemId);
          if (!it) continue;
          const ordered = toNum(it.qty_ordered);
          const received = toNum(it.qty_received);
          const remaining = Math.max(0, ordered - received);
          const apply = Math.min(remaining, d.qty);
          if (apply <= 0) continue;

          // Update PO item received qty
          await trx
            .from('purchase_order_items')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: String(it.id) })
            .update({ qty_received: received + apply, updated_at: nowIso });

          // Update inventory on_hand
          await trx
            .from('inventory_items')
            .where({ tenant_id: req.tenant.id, id: d.inventoryItemId })
            .increment('on_hand', apply);

          await trx
            .from('inventory_items')
            .where({ tenant_id: req.tenant.id, id: d.inventoryItemId })
            .update({ updated_at: nowIso });
        }

        const refreshed = await trx
          .from('purchase_order_items')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, purchase_order_id: id })
          .select(['qty_ordered', 'qty_received']);

        const anyReceived = refreshed.some((x) => toNum(x.qty_received) > 0);
        const allReceived = refreshed.every((x) => toNum(x.qty_received) >= toNum(x.qty_ordered));

        let nextStatus = 'Draft';
        if (allReceived) nextStatus = 'Received';
        else if (anyReceived) nextStatus = 'Partially Received';
        else nextStatus = String(po.status || 'Draft');

        const prevJson = safeJsonParse(po.po_json, {});
        const nextJson = { ...prevJson };
        if (typeof body?.note === 'string' && body.note.trim()) {
          const arr = Array.isArray(nextJson.receiveNotes) ? nextJson.receiveNotes : [];
          arr.push({ at: nowIso, by: req.auth?.staffId ? String(req.auth.staffId) : null, note: body.note.trim() });
          nextJson.receiveNotes = arr;
        }

        await trx
          .from('purchase_orders')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update({
            status: nextStatus,
            po_json: JSON.stringify(nextJson),
            updated_at: nowIso,
            received_at: allReceived ? nowIso : null,
          });
      });

      return res.json({ ok: true });
    } catch (e) {
      if (e && typeof e === 'object') {
        const m = String(e.message || '');
        if (m === 'po_not_found') return res.status(404).json({ error: 'not_found' });
        if (m === 'po_cancelled') return res.status(400).json({ error: 'po_cancelled' });
        if (m === 'po_not_sent') return res.status(400).json({ error: 'po_not_sent' });
        if (m === 'po_already_received') return res.status(400).json({ error: 'po_already_received' });
      }
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerPurchaseOrdersRouter };
