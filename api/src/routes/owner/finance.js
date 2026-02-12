const express = require('express');

const { db } = require('../../db');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { safeJsonParse } = require('../../utils/errors');
const { logAudit } = require('../../utils/logger');
const { uid } = require('../../utils/ids');
const { sanitizeText, sanitizeLikeInput } = require('../../utils/sanitize');

const makeOwnerFinanceRouter = ({ requireOwnerAuth, clampInt }) => {
  const r = express.Router();

  // Helper: date functions
  const startOfDayIso = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString();
  };

  const endOfDayIso = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.toISOString();
  };

  const startOfMonthIso = (d) => startOfDayIso(new Date(d.getFullYear(), d.getMonth(), 1));
  const endOfMonthIso = (d) => endOfDayIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const startOfYearIso = (d) => startOfDayIso(new Date(d.getFullYear(), 0, 1));
  const endOfYearIso = (d) => endOfDayIso(new Date(d.getFullYear(), 11, 31));

  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

  const yyyyMmDd = (iso) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // GET /owner/finance
  r.get(
    '/owner/finance',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.read'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const granularity = req.query?.granularity === 'quarterly' ? 'quarterly' : req.query?.granularity === 'yearly' ? 'yearly' : 'monthly';
        const period = typeof req.query?.period === 'string' ? req.query.period.trim() : '';
        const page = clampInt(req.query?.page, 1, 10000, 1);
        const pageSize = clampInt(req.query?.pageSize, 1, 50, 5);
        const offset = (page - 1) * pageSize;

        const category = sanitizeText(req.query?.category, { maxLen: 60 });
        const q = sanitizeLikeInput(req.query?.q, { lower: true, maxLen: 80 });
        const sort = req.query?.sort === 'oldest' ? 'oldest' : req.query?.sort === 'amount_desc' ? 'amount_desc' : 'newest';

        const now = new Date();
        const ym = period && /^\d{4}-\d{2}$/.test(period) ? period : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [yy, mm] = ym.split('-');

        const baseMonth = new Date(Number(yy), Math.max(0, Number(mm) - 1), 1);
        const toQuarterBounds = (d) => {
          const qIdx = Math.floor(d.getMonth() / 3);
          const start = new Date(d.getFullYear(), qIdx * 3, 1);
          const end = new Date(d.getFullYear(), qIdx * 3 + 3, 0);
          return { start, end };
        };

        const { fromIso, toIso } = (() => {
          if (granularity === 'yearly') {
            return { fromIso: startOfYearIso(baseMonth), toIso: endOfYearIso(baseMonth) };
          }
          if (granularity === 'quarterly') {
            const qb = toQuarterBounds(baseMonth);
            return { fromIso: startOfDayIso(qb.start), toIso: endOfDayIso(qb.end) };
          }
          return { fromIso: startOfMonthIso(baseMonth), toIso: endOfMonthIso(baseMonth) };
        })();

        const prevBounds = (() => {
          if (granularity === 'yearly') {
            const prev = new Date(baseMonth.getFullYear() - 1, 0, 1);
            return { from: startOfYearIso(prev), to: endOfYearIso(prev) };
          }
          if (granularity === 'quarterly') {
            const prevAnchor = addMonths(baseMonth, -3);
            const qb = toQuarterBounds(prevAnchor);
            return { from: startOfDayIso(qb.start), to: endOfDayIso(qb.end) };
          }
          const prev = addMonths(baseMonth, -1);
          return { from: startOfMonthIso(prev), to: endOfMonthIso(prev) };
        })();

        const sumRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id })
          .andWhere('paid_at', '>=', fromIso)
          .andWhere('paid_at', '<=', toIso)
          .sum({ revenue: 'total' })
          .first();

        const revenue = Number(sumRow?.revenue || 0) || 0;

        const prevRevenueRow = await db()
          .from('orders')
          .where({ tenant_id: req.tenant.id })
          .andWhere('paid_at', '>=', prevBounds.from)
          .andWhere('paid_at', '<=', prevBounds.to)
          .sum({ revenue: 'total' })
          .first();
        const prevRevenue = Number(prevRevenueRow?.revenue || 0) || 0;

        let expenseBase = db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', fromIso).andWhere('at', '<=', toIso);
        expenseBase = expenseBase.andWhere((b) => b.whereNull('payload_json').orWhere('payload_json', 'not like', '%"scope":"daily"%'));
        if (category) expenseBase = expenseBase.andWhere('category', category);
        if (q) {
          expenseBase = expenseBase.andWhere((b) => b.where('id', 'like', `%${q}%`).orWhere('memo', 'like', `%${q}%`).orWhere('payload_json', 'like', `%${q}%`));
        }

        const opexRow = await expenseBase.clone().sum({ s: 'amount' }).first();
        const opex = Number(opexRow?.s || 0) || 0;

        const prevOpexRow = await db()
          .from('finance_ledger')
          .where({ tenant_id: req.tenant.id, type: 'expense' })
          .andWhere('at', '>=', prevBounds.from)
          .andWhere('at', '<=', prevBounds.to)
          .sum({ s: 'amount' })
          .first();
        const prevOpex = Number(prevOpexRow?.s || 0) || 0;

        const cogs = 0;
        const prevCogs = 0;

        const netProfit = revenue - cogs - opex;
        const prevNetProfit = prevRevenue - prevCogs - prevOpex;

        const pctDelta = (cur, prev) => {
          const a = Number(cur || 0) || 0;
          const b = Number(prev || 0) || 0;
          if (!b) return a ? 100 : 0;
          return ((a - b) / Math.abs(b)) * 100;
        };

        const branchesAll = await db()
          .select(['id', 'name', 'city'])
          .from('branches')
          .where({ tenant_id: req.tenant.id })
          .orderBy('name', 'asc');

        const revenueByBranchRows = await db()
          .select(['branch_id'])
          .sum({ s: 'total' })
          .from('orders')
          .where({ tenant_id: req.tenant.id })
          .andWhere('paid_at', '>=', fromIso)
          .andWhere('paid_at', '<=', toIso)
          .groupBy('branch_id');

        const prevRevenueByBranchRows = await db()
          .select(['branch_id'])
          .sum({ s: 'total' })
          .from('orders')
          .where({ tenant_id: req.tenant.id })
          .andWhere('paid_at', '>=', prevBounds.from)
          .andWhere('paid_at', '<=', prevBounds.to)
          .groupBy('branch_id');

        const expenseByBranchRows = await db()
          .select(['branch_id'])
          .sum({ s: 'amount' })
          .from('finance_ledger')
          .where({ tenant_id: req.tenant.id, type: 'expense' })
          .whereNotNull('branch_id')
          .andWhere('at', '>=', fromIso)
          .andWhere('at', '<=', toIso)
          .groupBy('branch_id');

        const prevExpenseByBranchRows = await db()
          .select(['branch_id'])
          .sum({ s: 'amount' })
          .from('finance_ledger')
          .where({ tenant_id: req.tenant.id, type: 'expense' })
          .whereNotNull('branch_id')
          .andWhere('at', '>=', prevBounds.from)
          .andWhere('at', '<=', prevBounds.to)
          .groupBy('branch_id');

        const revByBranch = new Map();
        for (const r0 of revenueByBranchRows) {
          const bid = r0.branch_id ? String(r0.branch_id) : '';
          if (!bid) continue;
          revByBranch.set(bid, Number(r0.s || 0) || 0);
        }

        const prevRevByBranch = new Map();
        for (const r0 of prevRevenueByBranchRows) {
          const bid = r0.branch_id ? String(r0.branch_id) : '';
          if (!bid) continue;
          prevRevByBranch.set(bid, Number(r0.s || 0) || 0);
        }

        const expByBranch = new Map();
        for (const r0 of expenseByBranchRows) {
          const bid = r0.branch_id ? String(r0.branch_id) : '';
          if (!bid) continue;
          expByBranch.set(bid, Number(r0.s || 0) || 0);
        }

        const prevExpByBranch = new Map();
        for (const r0 of prevExpenseByBranchRows) {
          const bid = r0.branch_id ? String(r0.branch_id) : '';
          if (!bid) continue;
          prevExpByBranch.set(bid, Number(r0.s || 0) || 0);
        }

        const branchPerformance = branchesAll
          .map((b) => {
            const id = String(b.id);
            const rev = Number(revByBranch.get(id) || 0) || 0;
            const exp = Number(expByBranch.get(id) || 0) || 0;
            const profit = rev - exp;
            const prevProfit = (Number(prevRevByBranch.get(id) || 0) || 0) - (Number(prevExpByBranch.get(id) || 0) || 0);
            return {
              id,
              name: String(b.name || ''),
              city: String(b.city || ''),
              profit,
              deltaPct: pctDelta(profit, prevProfit),
            };
          })
          .sort((a, b) => b.profit - a.profit)
          .slice(0, 12);

        const catsRows = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).distinct('category as c');
        const categories = Array.from(new Set(catsRows.map((x) => String(x.c || 'Uncategorized')))).filter(Boolean).sort((a, b) => a.localeCompare(b));

        let ledgerQ = db()
          .from({ f: 'finance_ledger' })
          .leftJoin({ b: 'branches' }, function joinBranches() {
            this.on('b.id', '=', 'f.branch_id').andOn('b.tenant_id', '=', 'f.tenant_id');
          })
          .where({ 'f.tenant_id': req.tenant.id, 'f.type': 'expense' })
          .andWhere('f.at', '>=', fromIso)
          .andWhere('f.at', '<=', toIso);

        ledgerQ = ledgerQ.andWhere((q0) => q0.whereNull('f.payload_json').orWhere('f.payload_json', 'not like', '%"scope":"daily"%'));

        if (category) ledgerQ = ledgerQ.andWhere('f.category', category);
        if (q) {
          ledgerQ = ledgerQ.andWhere((b) => b.where('f.id', 'like', `%${q}%`).orWhere('f.memo', 'like', `%${q}%`).orWhere('f.payload_json', 'like', `%${q}%`).orWhere('b.name', 'like', `%${q}%`));
        }

        const totalRow = await ledgerQ.clone().count({ c: 'f.id' }).first();
        const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

        if (sort === 'oldest') ledgerQ = ledgerQ.orderBy('f.at', 'asc');
        else if (sort === 'amount_desc') ledgerQ = ledgerQ.orderBy('f.amount', 'desc');
        else ledgerQ = ledgerQ.orderBy('f.at', 'desc');

        const ledgerRows = await ledgerQ
          .clone()
          .select(['f.id', 'f.category', 'f.amount', 'f.memo', 'f.payload_json', 'f.at', 'f.branch_id', 'b.name as branch_name'])
          .limit(pageSize)
          .offset(offset);

        const toStatus = (payload, atIso) => {
          const raw = String(payload?.status || payload?.state || '').trim();
          if (raw.toLowerCase() === 'paid') return 'Paid';
          if (raw.toLowerCase() === 'pending') return 'Pending';
          if (raw.toLowerCase() === 'overdue') return 'Overdue';
          const dueAt = payload?.dueAt || payload?.due_at || payload?.dueDate || payload?.due_date;
          const paidAt = payload?.paidAt || payload?.paid_at;
          if (paidAt) return 'Paid';
          const due = dueAt ? new Date(dueAt).getTime() : NaN;
          const at = atIso ? new Date(atIso).getTime() : NaN;
          const nowMs = Date.now();
          if (!Number.isNaN(due) && nowMs > due) return 'Overdue';
          if (!Number.isNaN(at) && nowMs - at > 14 * 24 * 60 * 60 * 1000) return 'Overdue';
          return 'Pending';
        };

        const items = ledgerRows.map((r0) => {
          const payload = safeJsonParse(r0.payload_json, {});
          const vendor = String(payload?.vendor || payload?.payee || payload?.supplier || r0.memo || '—');
          const transactionId = String(payload?.transactionId || payload?.reference || payload?.ref || r0.id);
          const atIso = r0.at ? new Date(r0.at).toISOString() : '';
          const date = atIso ? yyyyMmDd(atIso) : '';
          const vendorInitial = vendor && vendor !== '—' ? String(vendor).trim().slice(0, 1).toUpperCase() : '—';
          const status = toStatus(payload, atIso);
          return {
            id: String(r0.id),
            date,
            transactionId,
            vendor,
            vendorInitial,
            category: String(r0.category || 'Uncategorized'),
            branchId: r0.branch_id ? String(r0.branch_id) : '',
            branchName: String(r0.branch_name || payload?.branchName || payload?.branch || '—'),
            amount: Number(r0.amount || 0) || 0,
            status,
          };
        });

        const buildTrend = async () => {
          const buckets = [];
          const anchor = baseMonth;
          for (let i = 5; i >= 0; i--) {
            if (granularity === 'yearly') {
              const y = anchor.getFullYear() - i;
              const d0 = new Date(y, 0, 1);
              buckets.push({ label: String(y), from: startOfYearIso(d0), to: endOfYearIso(d0) });
            } else if (granularity === 'quarterly') {
              const d0 = addMonths(anchor, -i * 3);
              const qb = toQuarterBounds(d0);
              const qIdx = Math.floor(qb.start.getMonth() / 3) + 1;
              buckets.push({ label: `Q${qIdx} ${qb.start.getFullYear()}`, from: startOfDayIso(qb.start), to: endOfDayIso(qb.end) });
            } else {
              const d0 = addMonths(anchor, -i);
              const y = d0.getFullYear();
              const m = String(d0.getMonth() + 1).padStart(2, '0');
              buckets.push({ label: `${y}-${m}`, from: startOfMonthIso(d0), to: endOfMonthIso(d0) });
            }
          }

          const out = [];
          for (const b of buckets) {
            // eslint-disable-next-line no-await-in-loop
            const revRow = await db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', b.from).andWhere('paid_at', '<=', b.to).sum({ s: 'total' }).first();
            // eslint-disable-next-line no-await-in-loop
            const expRow = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', b.from).andWhere('at', '<=', b.to).sum({ s: 'amount' }).first();
            out.push({ name: b.label, revenue: Number(revRow?.s || 0) || 0, expenses: Number(expRow?.s || 0) || 0 });
          }
          return out;
        };

        const trend = await buildTrend();

        const ledger = {
          items,
          page,
          pageSize,
          total,
          categories,
        };

        return res.json({
          kpis: {
            revenue,
            revenueDeltaPct: pctDelta(revenue, prevRevenue),
            netProfit,
            netProfitDeltaPct: pctDelta(netProfit, prevNetProfit),
            cogs,
            cogsDeltaPct: pctDelta(cogs, prevCogs),
            opex,
            opexDeltaPct: pctDelta(opex, prevOpex),
          },
          branchPerformance,
          ledger,
          trend,
          meta: { granularity, period: ym },
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  // POST /owner/finance/expenses
  r.post(
    '/owner/finance/expenses',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const category = String(req.body?.category || '').trim() || 'Uncategorized';
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });

        const atRaw = String(req.body?.at || '').trim();
        const at = atRaw && !Number.isNaN(new Date(atRaw).getTime()) ? new Date(atRaw).toISOString() : new Date().toISOString();

        const vendor = String(req.body?.vendor || '').trim();
        const transactionId = String(req.body?.transactionId || '').trim() || uid(`txn_${String(req.tenant.id || '').slice(0, 6)}`);
        const statusRaw = String(req.body?.status || '').trim();
        const status = statusRaw === 'Paid' || statusRaw === 'Overdue' ? statusRaw : 'Pending';
        const dueAtRaw = String(req.body?.dueAt || '').trim();
        const dueAt = dueAtRaw && !Number.isNaN(new Date(dueAtRaw).getTime()) ? new Date(dueAtRaw).toISOString() : '';
        const branchName = String(req.body?.branchName || '').trim();
        const branchId = String(req.body?.branchId || '').trim();

        const id = uid('fin');
        const nowIso = new Date().toISOString();
        const payload = {
          scope: 'monthly',
          vendor,
          transactionId,
          status,
          ...(dueAt ? { dueAt } : {}),
          ...(branchName ? { branchName } : {}),
        };

        await db().from('finance_ledger').insert({
          id,
          tenant_id: req.tenant.id,
          branch_id: branchId || null,
          category,
          type: 'expense',
          amount,
          currency: String(req.body?.currency || 'ETB').trim() || 'ETB',
          memo: vendor || String(req.body?.memo || '').trim() || null,
          payload_json: JSON.stringify(payload),
          at,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: branchId || null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.finance.expense.created',
          summary: `Created expense ${id}`,
          payload: { expenseId: id, transactionId },
        });

        return res.status(201).json({ ok: true, id });
      } catch (e) {
        return next(e);
      }
    },
  );

  // PUT /owner/finance/expenses/:id
  r.put(
    '/owner/finance/expenses/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const existing = await db().select(['id', 'payload_json']).from('finance_ledger').where({ tenant_id: req.tenant.id, id, type: 'expense' }).first();
        if (!existing) return res.status(404).json({ error: 'not_found' });

        const prevPayload = safeJsonParse(existing.payload_json, {});
        const nextPayload = { ...prevPayload };

        const patch = {};

        if (typeof req.body?.category === 'string') patch.category = req.body.category.trim() || 'Uncategorized';
        if (req.body?.amount != null) {
          const amount = Number(req.body.amount);
          if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'invalid_amount' });
          patch.amount = amount;
        }
        if (typeof req.body?.currency === 'string') patch.currency = req.body.currency.trim() || 'ETB';

        const atRaw = typeof req.body?.at === 'string' ? req.body.at.trim() : '';
        if (atRaw) {
          const at = !Number.isNaN(new Date(atRaw).getTime()) ? new Date(atRaw).toISOString() : '';
          if (!at) return res.status(400).json({ error: 'invalid_at' });
          patch.at = at;
        }

        if (typeof req.body?.vendor === 'string') nextPayload.vendor = req.body.vendor.trim();
        if (typeof req.body?.transactionId === 'string') nextPayload.transactionId = req.body.transactionId.trim();
        if (typeof req.body?.status === 'string') {
          const s = req.body.status.trim();
          nextPayload.status = s === 'Paid' || s === 'Overdue' ? s : 'Pending';
        }
        if (typeof req.body?.dueAt === 'string') {
          const dueAtRaw = req.body.dueAt.trim();
          if (dueAtRaw) {
            const dueAt = !Number.isNaN(new Date(dueAtRaw).getTime()) ? new Date(dueAtRaw).toISOString() : '';
            if (!dueAt) return res.status(400).json({ error: 'invalid_dueAt' });
            nextPayload.dueAt = dueAt;
          } else {
            delete nextPayload.dueAt;
          }
        }
        if (typeof req.body?.branchName === 'string') {
          const bn = req.body.branchName.trim();
          if (bn) nextPayload.branchName = bn;
          else delete nextPayload.branchName;
        }
        if (typeof req.body?.branchId === 'string') {
          const bid = req.body.branchId.trim();
          patch.branch_id = bid || null;
        }

        patch.payload_json = JSON.stringify(nextPayload);
        if (typeof patch.memo === 'undefined') {
          const v = String(nextPayload.vendor || '').trim();
          if (v) patch.memo = v;
        }

        const updated = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, id, type: 'expense' }).update(patch);
        if (!updated) return res.status(404).json({ error: 'not_found' });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: patch.branch_id || null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.finance.expense.updated',
          summary: `Updated expense ${id}`,
          payload: { expenseId: id },
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  // DELETE /owner/finance/expenses/:id
  r.delete(
    '/owner/finance/expenses/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('finance'),
    requirePermission('finance.write'),
    async (req, res, next) => {
      try {
        if (!requireOwnerAuth(req, res)) return;

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const deleted = await db().from('finance_ledger').where({ tenant_id: req.tenant.id, id, type: 'expense' }).del();
        if (!deleted) return res.status(404).json({ error: 'not_found' });

        await logAudit({
          tenantId: req.tenant.id,
          branchId: null,
          actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
          actorRole: req.auth?.role ? String(req.auth.role) : null,
          type: 'owner.finance.expense.deleted',
          summary: `Deleted expense ${id}`,
          payload: { expenseId: id },
        });
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makeOwnerFinanceRouter };
