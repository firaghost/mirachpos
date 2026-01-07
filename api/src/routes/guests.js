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

const makeGuestsRouter = () => {
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

  const monthWindow = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
  };

  r.get('/manager/guests', tenantMiddleware, requireAuth, loadEntitlements, requireModule('guests'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const role = typeof req.query?.role === 'string' ? req.query.role.trim() : '';

      const base = db().from('guests_profiles').where({ tenant_id: req.tenant.id, branch_id: branchId });
      if (status) base.andWhere({ status });
      if (role) base.andWhere({ role });
      if (q) base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));

      const profiles = await base
        .clone()
        .select(['id', 'name', 'role', 'monthly_limit', 'status', 'avatar_url', 'created_at', 'updated_at'])
        .orderBy('created_at', 'desc');

      const { start, end } = monthWindow();
      const usageRows = await db()
        .from('guests_transactions')
        .where({ tenant_id: req.tenant.id, branch_id: branchId })
        .andWhere('at', '>=', start)
        .andWhere('at', '<', end)
        .groupBy('guest_id')
        .select(['guest_id'])
        .sum({ usage: 'amount' });

      const usageByGuestId = new Map();
      for (const row of usageRows) {
        const gid = String(row.guest_id);
        const usage = Number(row.usage ?? 0) || 0;
        usageByGuestId.set(gid, usage);
      }

      const guests = profiles.map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        role: String(p.role || 'VIP'),
        monthlyLimit: Number(p.monthly_limit ?? 0) || 0,
        currentUsage: usageByGuestId.get(String(p.id)) ?? 0,
        status: String(p.status || 'Active'),
        avatar: String(p.avatar_url || ''),
        createdAt: p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString(),
        updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : new Date().toISOString(),
      }));

      return res.json({ guests });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/guests', tenantMiddleware, requireAuth, loadEntitlements, requireModule('guests'), requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
      const monthlyLimit = Number(req.body?.monthlyLimit ?? req.body?.monthly_limit ?? 0) || 0;
      const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '';

      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!role) return res.status(400).json({ error: 'role_required' });
      if (monthlyLimit <= 0) return res.status(400).json({ error: 'monthly_limit_invalid' });

      const now = new Date();
      const id = makeId('gst');

      await db().table('guests_profiles').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        name,
        role,
        monthly_limit: monthlyLimit,
        status: 'Active',
        avatar_url: avatar || null,
        created_at: now,
        updated_at: now,
      });

      return res.status(201).json({ id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/manager/guests/:id', tenantMiddleware, requireAuth, requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('guests_profiles')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
      if (typeof req.body?.role === 'string' && req.body.role.trim()) patch.role = req.body.role.trim();
      if (typeof req.body?.status === 'string' && req.body.status.trim()) patch.status = req.body.status.trim();

      if (req.body?.monthlyLimit != null || req.body?.monthly_limit != null) {
        const nextLimit = Number(req.body?.monthlyLimit ?? req.body?.monthly_limit ?? 0) || 0;
        if (nextLimit <= 0) return res.status(400).json({ error: 'monthly_limit_invalid' });
        patch.monthly_limit = nextLimit;
      }

      if (typeof req.body?.avatar === 'string') {
        patch.avatar_url = req.body.avatar.trim() || null;
      }
      if (typeof req.body?.avatarUrl === 'string') {
        patch.avatar_url = req.body.avatarUrl.trim() || null;
      }

      patch.updated_at = new Date();

      await db().table('guests_profiles').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/manager/guests/:id', tenantMiddleware, requireAuth, requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db()
        .from('guests_profiles')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
        .first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().table('guests_profiles').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).delete();
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/manager/guests/transactions', tenantMiddleware, requireAuth, requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const guestId = typeof req.query?.guestId === 'string' ? req.query.guestId.trim() : '';
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 200) || 200));

      const base = db()
        .from('guests_transactions as t')
        .leftJoin('guests_profiles as g', function join() {
          this.on('g.id', '=', 't.guest_id').andOn('g.tenant_id', '=', 't.tenant_id').andOn('g.branch_id', '=', 't.branch_id');
        })
        .where({ 't.tenant_id': req.tenant.id, 't.branch_id': branchId });

      if (guestId) base.andWhere({ 't.guest_id': guestId });
      if (q) {
        base.andWhere((b) =>
          b
            .where('t.id', 'like', `%${q}%`)
            .orWhere('t.items', 'like', `%${q}%`)
            .orWhere('g.name', 'like', `%${q}%`),
        );
      }

      const rows = await base
        .clone()
        .select(['t.id', 't.guest_id', 'g.name as guest_name', 't.amount', 't.items', 't.at', 't.payload_json'])
        .orderBy('t.at', 'desc')
        .limit(limit);

      const transactions = rows.map((row) => {
        const at = row.at ? new Date(row.at) : new Date();
        const payload = safeJsonParse(row.payload_json, null);
        return {
          id: String(row.id),
          guestId: String(row.guest_id),
          guestName: String(row.guest_name || ''),
          date: at.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
          amount: Number(row.amount ?? 0) || 0,
          items: String(row.items || ''),
          at: at.toISOString(),
          payload,
        };
      });

      return res.json({ transactions });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/guests/:id/transactions', tenantMiddleware, requireAuth, requireBranchId(), async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      const branchId = req.branchId || resolveBranchId(req);

      const guestId = String(req.params.id || '');
      if (!guestId) return res.status(400).json({ error: 'guest_required' });

      const guest = await db().from('guests_profiles').where({ tenant_id: req.tenant.id, branch_id: branchId, id: guestId }).first();
      if (!guest) return res.status(404).json({ error: 'guest_not_found' });

      const amount = Number(req.body?.amount ?? 0) || 0;
      const items = typeof req.body?.items === 'string' ? req.body.items.trim() : '';
      const at = req.body?.at ? new Date(req.body.at) : new Date();

      if (!(amount > 0)) return res.status(400).json({ error: 'amount_invalid' });

      const id = makeId('gtrx');
      const now = new Date();

      await db().table('guests_transactions').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: branchId,
        guest_id: guestId,
        amount,
        items: items || null,
        payload_json: req.body?.payload ? JSON.stringify(req.body.payload) : null,
        at,
        created_at: now,
      });

      return res.status(201).json({ id });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeGuestsRouter };
