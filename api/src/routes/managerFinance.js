const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { uid } = require('../utils/ids');
const { requirePermission } = require('../middleware/permissions');
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

const normalizePaymentMethod = (v) => {
  const s = String(v || '').trim();
  return s;
};

const makeManagerFinanceRouter = () => {
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

  const normalizeIso = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  };

  const resolveActorStaff = async (req) => {
    const staffId = req.auth?.staffId ? String(req.auth.staffId) : '';
    if (!staffId) return null;
    const row = await db().select(['id', 'name', 'role_name']).from('staff').where({ tenant_id: req.tenant.id, id: staffId }).first();
    if (!row) return null;
    return { id: String(row.id), name: String(row.name || ''), role: String(row.role_name || '') };
  };

  const sumCashPaymentsBetween = async ({ tenantId, branchId, fromIso, toIso }) => {
    if (!fromIso || !toIso) return 0;

    const rows = await db()
      .select(['id', 'total', 'paid_at', 'payload'])
      .from('orders')
      .where({ tenant_id: tenantId, branch_id: branchId, status: 'Paid' })
      .andWhere('paid_at', '>=', fromIso)
      .andWhere('paid_at', '<=', toIso)
      .orderBy('paid_at', 'asc')
      .limit(2000);

    let sum = 0;
    for (const r of rows) {
      const payload = safeJsonParse(r.payload, {});
      const pm = normalizePaymentMethod(payload?.paymentMethod);
      if (pm !== 'Cash') continue;
      sum += Number(r.total || 0) || 0;
    }
    return sum;
  };

  const mapExpense = (row) => {
    const payload = safeJsonParse(row.payload_json, {});
    const vendor = String(payload?.vendor || row.memo || '');
    const icon =
      payload?.icon === 'local_shipping' ||
      payload?.icon === 'build' ||
      payload?.icon === 'sanitizer' ||
      payload?.icon === 'receipt_long'
        ? payload.icon
        : 'receipt_long';
    return {
      id: String(row.id),
      title: String(payload?.title || payload?.name || row.category || 'Expense'),
      vendor,
      amount: Number(row.amount || 0) || 0,
      createdAt: row.at ? new Date(row.at).toISOString() : row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      icon,
      category: String(row.category || ''),
      memo: String(row.memo || ''),
      payload,
    };
  };

  const mapCashSession = (row) => {
    const payload = safeJsonParse(row.payload_json, {});
    return {
      id: String(row.id),
      register: String(payload?.register || 'POS'),
      staffName: String(payload?.staffName || ''),
      staffRole: String(payload?.staffRole || ''),
      openingCash: Number(payload?.openingCash ?? 0) || 0,
      expectedCash: Number(payload?.expectedCash ?? 0) || 0,
      actualCash: payload?.actualCash == null ? undefined : Number(payload.actualCash ?? 0) || 0,
      status: String(payload?.status || 'Active'),
      openedAt: String(payload?.openedAt || row.at || row.created_at || new Date().toISOString()),
      closedAt: payload?.closedAt ? String(payload.closedAt) : undefined,
      payload,
    };
  };

  // Expenses (branch scoped)
  r.get(
    '/manager/finance/expenses',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));
      const fromIso = normalizeIso(req.query?.from);
      const toIso = normalizeIso(req.query?.to);

      let q = db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, type: 'expense' });
      if (fromIso) q = q.andWhere('at', '>=', fromIso);
      if (toIso) q = q.andWhere('at', '<=', toIso);

      const rows = await q.select(['id', 'category', 'amount', 'memo', 'payload_json', 'at', 'created_at']).orderBy('at', 'desc').limit(limit);
      return res.json({ ok: true, branchId, expenses: rows.map(mapExpense) });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/manager/finance/expenses',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const title = String(req.body?.title || '').trim();
      const vendor = String(req.body?.vendor || '').trim();
      const amount = Number(req.body?.amount);
      if (!title) return res.status(400).json({ error: 'title_required' });
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });

      const at = normalizeIso(req.body?.createdAt || req.body?.at) || new Date().toISOString();

      const id = uid('fin');
      const nowIso = new Date().toISOString();

      await db().from('finance_ledger').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        category: 'expense',
        type: 'expense',
        amount,
        currency: 'ETB',
        memo: vendor || title,
        payload_json: JSON.stringify({ title, vendor, icon: req.body?.icon || 'receipt_long' }),
        at,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/manager/finance/expenses/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'expense' }).select(['id', 'payload_json']).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const prevPayload = safeJsonParse(existing.payload_json, {});
      const nextPayload = { ...prevPayload };

      const actor = await resolveActorStaff(req);
      if (!nextPayload.staffId && req.auth?.staffId) nextPayload.staffId = String(req.auth.staffId);
      if (!nextPayload.staffName && actor?.name) nextPayload.staffName = actor.name;
      if (!nextPayload.staffRole && actor?.role) nextPayload.staffRole = actor.role;

      if (typeof req.body?.title === 'string') nextPayload.title = req.body.title.trim();
      if (typeof req.body?.vendor === 'string') nextPayload.vendor = req.body.vendor.trim();
      if (typeof req.body?.icon === 'string') nextPayload.icon = req.body.icon.trim();

      const patch = { updated_at: new Date().toISOString() };

      if (req.body?.amount != null) {
        const amount = Number(req.body.amount);
        if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });
        patch.amount = amount;
      }

      const atIso = normalizeIso(req.body?.createdAt || req.body?.at);
      if (atIso) patch.at = atIso;

      patch.payload_json = JSON.stringify(nextPayload);
      if (typeof patch.memo === 'undefined') {
        const memo = String(nextPayload.vendor || nextPayload.title || '').trim();
        if (memo) patch.memo = memo;
      }

      const updated = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'expense' }).update(patch);
      if (!updated) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete(
    '/manager/finance/expenses/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'expense' }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Cash sessions (branch scoped)
  r.get(
    '/manager/finance/cash-sessions',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.read'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));
      const fromIso = normalizeIso(req.query?.from);
      const toIso = normalizeIso(req.query?.to);

      let q = db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, type: 'cash_session' });
      if (fromIso) q = q.andWhere('at', '>=', fromIso);
      if (toIso) q = q.andWhere('at', '<=', toIso);

      const rows = await q.select(['id', 'payload_json', 'at', 'created_at']).orderBy('at', 'desc').limit(limit);

      const mapped = rows.map(mapCashSession);
      const next = [];
      for (const s of mapped) {
        const openedAt = normalizeIso(s.openedAt) || '';
        const closedAt = normalizeIso(s.closedAt) || '';
        const status = String(s.status || 'Active');
        const endAt = status === 'Active' ? new Date().toISOString() : closedAt || new Date().toISOString();
        const cashSales = await sumCashPaymentsBetween({ tenantId: req.tenant.id, branchId, fromIso: openedAt, toIso: endAt });
        const expectedCash = (Number(s.openingCash || 0) || 0) + cashSales;
        next.push({
          ...s,
          staffName: s.staffName || (s.payload && typeof s.payload.staffName === 'string' ? s.payload.staffName : '') || 'Unknown',
          expectedCash,
        });
      }

      return res.json({ ok: true, branchId, cashSessions: next });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/manager/finance/cash-sessions',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const register = String(req.body?.register || '').trim() || 'POS';
      const openingCash = Number(req.body?.openingCash ?? 0);
      const status = 'Active';
      if (![openingCash].every((n) => Number.isFinite(n) && n >= 0)) return res.status(400).json({ error: 'invalid_numbers' });

      const openedAt = normalizeIso(req.body?.openedAt) || new Date().toISOString();
      const actor = await resolveActorStaff(req);
      const payload = {
        register,
        staffId: actor?.id || (req.auth?.staffId ? String(req.auth.staffId) : ''),
        staffName: actor?.name || '',
        staffRole: actor?.role || (req.auth?.role ? String(req.auth.role) : ''),
        openingCash,
        expectedCash: openingCash,
        status,
        openedAt,
      };

      const id = uid('cs');
      const nowIso = new Date().toISOString();

      await db().from('finance_ledger').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        category: 'cash_session',
        type: 'cash_session',
        amount: 0,
        currency: 'ETB',
        memo: register,
        payload_json: JSON.stringify(payload),
        at: openedAt,
        created_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/manager/finance/cash-sessions/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'cash_session' }).select(['id', 'payload_json']).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const prevPayload = safeJsonParse(existing.payload_json, {});
      const nextPayload = { ...prevPayload };

      for (const k of ['register', 'staffName', 'staffRole', 'status', 'openedAt', 'closedAt']) {
        if (typeof req.body?.[k] === 'string') nextPayload[k] = String(req.body[k]).trim();
      }
      for (const k of ['openingCash', 'expectedCash', 'actualCash']) {
        if (req.body?.[k] != null) {
          const v = Number(req.body[k]);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_numbers' });
          nextPayload[k] = v;
        }
      }

      const nextStatus = String(nextPayload.status || '').trim();
      if (nextStatus === 'Closed' || nextStatus === 'Audit') {
        const openedAt = normalizeIso(nextPayload.openedAt) || '';
        const closedAt = normalizeIso(nextPayload.closedAt) || new Date().toISOString();
        nextPayload.closedAt = closedAt;
        const cashSales = await sumCashPaymentsBetween({ tenantId: req.tenant.id, branchId, fromIso: openedAt, toIso: closedAt });
        const openingCash = Number(nextPayload.openingCash ?? 0) || 0;
        nextPayload.expectedCash = openingCash + cashSales;
      }

      const patch = {
        payload_json: JSON.stringify(nextPayload),
        updated_at: new Date().toISOString(),
      };

      const updated = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'cash_session' }).update(patch);
      if (!updated) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete(
    '/manager/finance/cash-sessions/:id',
    tenantMiddleware,
    requireAuth,
    loadEntitlements,
    requireModule('finance'),
    requireBranchId(),
    async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, branch_id: branchId, id, type: 'cash_session' }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerFinanceRouter };
