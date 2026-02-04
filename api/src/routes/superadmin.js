const express = require('express');
const bcrypt = require('bcryptjs');

const { requireSuperadmin } = require('../middleware/superadminAuth');
const { db } = require('../db');
const { config } = require('../config');
const { makeId } = require('../utils/ids');
const { safeJsonParse, safeJsonStringify } = require('../utils/errors');
const { logAudit } = require('../utils/logger');
const { encryptConfigFields, decryptConfigFields } = require('../utils/secretEncryption');
const { provisionTenant } = require('../services/provisionService');
const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');
const {
  generateSubscriptionInvoice,
  getTenantInvoices,
  getInvoiceDetails,
  createManualInvoice,
  verifyPayment,
  rejectPayment,
  recordPaymentSubmission,
} = require('../services/invoiceService');
const { generateInvoicePDF } = require('../services/pdfService');

const maskSecret = (s) => {
  const v = String(s || '');
  if (!v) return '';
  if (v.length <= 8) return '********';
  return `${v.slice(0, 4)}****${v.slice(-4)}`;
};

const randomPassword = (len = 10) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  const x = Number.isFinite(n) ? n : def;
  return Math.max(min, Math.min(max, x));
};

const truncate = (s, max) => {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

const slaSecsForSeverity = (sev) => {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return 2 * 60 * 60;
  if (s === 'high') return 6 * 60 * 60;
  if (s === 'medium') return 24 * 60 * 60;
  return 48 * 60 * 60;
};

const calcSlaRemaining = (createdAt, severity) => {
  const createdMs = new Date(createdAt).getTime();
  const nowMs = Date.now();
  const budget = slaSecsForSeverity(severity) * 1000;
  if (!Number.isFinite(createdMs)) return { remainingSec: 0, breached: false };
  const remainingMs = budget - (nowMs - createdMs);
  const remainingSec = Math.floor(remainingMs / 1000);
  return { remainingSec, breached: remainingSec <= 0 };
};

const addMonths = (iso, months) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

const addDays = (iso, days) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const mapTenantStatusToUi = (status) => {
  if (status === 'suspended') return 'Suspended';
  if (status === 'trial') return 'Trial';
  return 'Active';
};

const mapUiStatusToTenant = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'suspended') return 'suspended';
  if (s === 'trial') return 'trial';
  if (s === 'active') return 'active';
  return '';
};

const getTenantTier = async (tenantId) => {
  const row = await db().select(['tier']).from('tenant_subscription').where({ tenant_id: tenantId }).first();
  return row?.tier ? String(row.tier) : 'Trial';
};

const defaultModulesForTier = (tier) => {
  const t = String(tier || '').trim();
  if (t === 'Trial') return ['settings'];
  if (t === 'Starter') return ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings'];
  if (t === 'Growth') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
  if (t === 'Pro') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
  return ['settings'];
};

const getPlanModules = async (tier) => {
  const row = await db().select(['modules_json']).from('plans').where({ tier }).first();
  const parsed = safeJsonParse(row?.modules_json, null);
  const mods = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  return mods.length ? mods : defaultModulesForTier(tier);
};

const normalizeTier = (tier) => {
  const t = String(tier || '').trim().toLowerCase();
  if (t === 'trial') return 'Trial';
  if (t === 'starter' || t === 'basic') return 'Starter';
  if (t === 'growth') return 'Growth';
  if (t === 'pro' || t === 'enterprise') return 'Pro';
  return String(tier || '').trim();
};

const readTenantProfileJson = async (tenantId) => {
  const row = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: tenantId }).first();
  return safeJsonParse(row?.profile_json, {});
};

const writeTenantProfileJson = async (tenantId, profile) => {
  const nowIso = new Date().toISOString();
  await db()
    .from('tenant_profile')
    .insert({ tenant_id: tenantId, profile_json: JSON.stringify(profile || {}), updated_at: nowIso })
    .onConflict('tenant_id')
    .merge({ profile_json: JSON.stringify(profile || {}), updated_at: nowIso });
  return nowIso;
};

const makeSuperadminRouter = () => {
  const r = express.Router();

  r.get('/superadmin', requireSuperadmin, async (_req, res) => {
    return res.json({ ok: true });
  });

  r.post('/superadmin/tenants/reset-owner-password', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });

      const tenantRow = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!tenantRow) return res.status(404).json({ error: 'not_found' });

      const owner = await db()
        .select(['id', 'email', 'name', 'role_name'])
        .from('staff')
        .where({ tenant_id: tenantId, role_name: 'Cafe Owner' })
        .orderBy('created_at', 'asc')
        .first();

      if (!owner) return res.status(404).json({ error: 'owner_not_found' });

      const tempPassword = randomPassword(10);
      const hash = await bcrypt.hash(tempPassword, 10);
      const nowIso = new Date().toISOString();

      await db().from('staff').where({ tenant_id: tenantId, id: String(owner.id) }).update({ password_hash: hash, updated_at: nowIso });

      try {
        await logAudit({
          tenantId,
          branchId: null,
          actorStaffId: null,
          actorRole: 'Super Admin',
          type: 'superadmin.owner_password_reset',
          summary: 'Superadmin reset owner password',
          payload: { staffId: String(owner.id) },
        });
      } catch {
        // ignore
      }

      return res.json({ ok: true, tenantId, ownerStaffId: String(owner.id), ownerEmail: String(owner.email || ''), tempPassword });
    } catch (e) {
      return next(e);
    }
  });

  // Plan management (prices/modules/limits)
  r.get('/superadmin/plans', requireSuperadmin, async (_req, res, next) => {
    try {
      const rows = await db()
        .select(['tier', 'modules_json', 'limits_json', 'price_monthly_etb', 'price_yearly_etb', 'updated_at'])
        .from('plans')
        .orderBy('tier', 'asc');

      const plans = rows.map((p) => ({
        tier: String(p.tier || ''),
        modules: Array.isArray(safeJsonParse(p.modules_json, [])) ? safeJsonParse(p.modules_json, []).map(String) : [],
        limits: safeJsonParse(p.limits_json, {}),
        pricing: {
          monthlyEtb: Number(p.price_monthly_etb || 0) || 0,
          yearlyEtb: Number(p.price_yearly_etb || 0) || 0,
        },
        updatedAt: toIso(p.updated_at),
      }));

      return res.json({ ok: true, plans });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/plans', requireSuperadmin, async (req, res, next) => {
    try {
      const tierRaw = String(req.body?.tier || '').trim();
      if (!tierRaw) return res.status(400).json({ error: 'tier_required' });
      const tier = tierRaw;

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const modules = Array.isArray(req.body?.modules) ? req.body.modules.map(String).filter(Boolean) : [];
      const limits = req.body?.limits && typeof req.body.limits === 'object' ? req.body.limits : {};

      const monthlyEtb = Number(req.body?.pricing?.monthlyEtb ?? 0);
      const yearlyEtb = Number(req.body?.pricing?.yearlyEtb ?? 0);
      if (!Number.isFinite(monthlyEtb) || monthlyEtb < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
      if (!Number.isFinite(yearlyEtb) || yearlyEtb < 0) return res.status(400).json({ error: 'invalid_yearly_price' });

      const nowIso = new Date().toISOString();
      await db().from('plans').insert({
        tier,
        modules_json: JSON.stringify(modules),
        limits_json: JSON.stringify(limits),
        price_monthly_etb: monthlyEtb,
        price_yearly_etb: yearlyEtb,
        updated_at: nowIso,
      });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'plans.create',
        summary: `Created plan ${tier}`,
        payload_json: JSON.stringify({ tier, monthlyEtb, yearlyEtb, modulesCount: modules.length }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, tier });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/plans/:tier', requireSuperadmin, async (req, res, next) => {
    try {
      const tierRaw = String(req.params?.tier || '').trim();
      const tier = normalizeTier(tierRaw);
      if (!tier) return res.status(400).json({ error: 'tier_required' });

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const patch = {};

      if (Array.isArray(body?.modules)) patch.modules_json = JSON.stringify(body.modules.map(String));

      if (body && Object.prototype.hasOwnProperty.call(body, 'limits')) {
        if (body.limits && typeof body.limits === 'object') patch.limits_json = JSON.stringify(body.limits);
        else if (body.limits == null) patch.limits_json = JSON.stringify({});
      }

      if (body?.pricing && typeof body.pricing === 'object') {
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'monthlyEtb')) {
          const m = Number(body.pricing.monthlyEtb);
          if (!Number.isFinite(m) || m < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
          patch.price_monthly_etb = m;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'yearlyEtb')) {
          const y = Number(body.pricing.yearlyEtb);
          if (!Number.isFinite(y) || y < 0) return res.status(400).json({ error: 'invalid_yearly_price' });
          patch.price_yearly_etb = y;
        }
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('plans').where({ tier }).update(patch);

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'plans.update',
        summary: `Updated plan ${tier}`,
        payload_json: JSON.stringify({ tier, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/overview', requireSuperadmin, async (_req, res, next) => {
    try {
      const rangeRaw = typeof _req.query?.range === 'string' ? _req.query.range.trim() : '';
      const range = rangeRaw || '30d';
      const now = Date.now();
      const sinceMs = (() => {
        if (range === '24h') return 24 * 60 * 60 * 1000;
        if (range === '7d') return 7 * 24 * 60 * 60 * 1000;
        return 30 * 24 * 60 * 60 * 1000;
      })();

      const prevSinceIso = new Date(now - sinceMs * 2).toISOString();
      const sinceIso = new Date(now - sinceMs).toISOString();

      const totalTenantsRow = await db().count({ c: '*' }).from('tenants').first();
      const totalTenants = Number(totalTenantsRow?.c ?? totalTenantsRow?.count ?? totalTenantsRow?.['count(*)'] ?? 0) || 0;

      const activeTenantsRow = await db().count({ c: '*' }).from('tenants').where({ status: 'active' }).first();
      const activeTenants = Number(activeTenantsRow?.c ?? activeTenantsRow?.count ?? activeTenantsRow?.['count(*)'] ?? 0) || 0;

      const suspendedTenantsRow = await db().count({ c: '*' }).from('tenants').where({ status: 'suspended' }).first();
      const suspendedTenants = Number(suspendedTenantsRow?.c ?? suspendedTenantsRow?.count ?? suspendedTenantsRow?.['count(*)'] ?? 0) || 0;

      const trialTenantsRow = await db().count({ c: '*' }).from('tenants').where({ status: 'trial' }).first();
      const trialTenants = Number(trialTenantsRow?.c ?? trialTenantsRow?.count ?? trialTenantsRow?.['count(*)'] ?? 0) || 0;

      const totalBranchesRow = await db().count({ c: '*' }).from('branches').first();
      const totalBranches = Number(totalBranchesRow?.c ?? totalBranchesRow?.count ?? totalBranchesRow?.['count(*)'] ?? 0) || 0;

      const totalUsersRow = await db().count({ c: '*' }).from('staff').first();
      const totalUsers = Number(totalUsersRow?.c ?? totalUsersRow?.count ?? totalUsersRow?.['count(*)'] ?? 0) || 0;

      // Order volume: last 30 days (paid orders preferred, else created)
      const since24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const orderCountRow = await db()
        .count({ c: '*' })
        .from('orders')
        .where((qb) => qb.where('paid_at', '>=', sinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '>=', sinceIso)))
        .first();
      const ordersLast30d = Number(orderCountRow?.c ?? orderCountRow?.count ?? orderCountRow?.['count(*)'] ?? 0) || 0;

      const orderCountTodayRow = await db()
        .count({ c: '*' })
        .from('orders')
        .where((qb) => qb.where('paid_at', '>=', since24hIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '>=', since24hIso)))
        .first();
      const ordersToday = Number(orderCountTodayRow?.c ?? orderCountTodayRow?.count ?? orderCountTodayRow?.['count(*)'] ?? 0) || 0;

      const prevOrderCountRow = await db()
        .count({ c: '*' })
        .from('orders')
        .where((qb) => qb.where('paid_at', '>=', prevSinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '>=', prevSinceIso)))
        .andWhere((qb) => qb.where('paid_at', '<', sinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '<', sinceIso)))
        .first();
      const ordersPrev = Number(prevOrderCountRow?.c ?? prevOrderCountRow?.count ?? prevOrderCountRow?.['count(*)'] ?? 0) || 0;

      const orderTotalRow = await db()
        .sum({ s: 'total' })
        .from('orders')
        .where((qb) => qb.where('paid_at', '>=', sinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '>=', sinceIso)))
        .first();
      const orderTotalLast30dEtb = Number(orderTotalRow?.s ?? orderTotalRow?.sum ?? orderTotalRow?.['sum(`total`)'] ?? orderTotalRow?.['sum(total)'] ?? 0) || 0;

      const avgTicketEtb = ordersLast30d > 0 ? orderTotalLast30dEtb / ordersLast30d : 0;

      const prevOrderTotalRow = await db()
        .sum({ s: 'total' })
        .from('orders')
        .where((qb) => qb.where('paid_at', '>=', prevSinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '>=', prevSinceIso)))
        .andWhere((qb) => qb.where('paid_at', '<', sinceIso).orWhere((qb2) => qb2.whereNull('paid_at').andWhere('created_at', '<', sinceIso)))
        .first();
      const orderTotalPrevEtb = Number(prevOrderTotalRow?.s ?? prevOrderTotalRow?.sum ?? prevOrderTotalRow?.['sum(`total`)'] ?? prevOrderTotalRow?.['sum(total)'] ?? 0) || 0;

      // Revenue/MRR (ETB): derive from tenant_subscription amount_etb
      const subs = await db().select(['cycle', 'status', 'amount_etb']).from('tenant_subscription');
      const activeSubs = subs.filter((x) => String(x.status || '').toLowerCase() === 'active');
      const mrrEtb = Math.round(
        activeSubs.reduce((sum, x) => {
          const amt = Number(x.amount_etb || 0) || 0;
          const cyc = String(x.cycle || 'Monthly').toLowerCase();
          return sum + (cyc === 'yearly' ? amt / 12 : amt);
        }, 0),
      );

      // Monthly Revenue (ETB): aggregate paid orders totals by month (last 8 months)
      const revenueRows = await db()
        .from('orders')
        .select(db().raw("DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m') as ym"))
        .select(db().raw('COALESCE(SUM(total), 0) as total_etb'))
        .whereRaw('COALESCE(paid_at, created_at) >= ?', [addMonths(new Date().toISOString(), -7)])
        .groupByRaw("DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m')")
        .orderBy('ym', 'asc');

      const revenueByMonth = revenueRows.map((r) => ({
        month: String(r.ym || ''),
        totalEtb: Number(r.total_etb || 0) || 0,
      }));

      // Tenant Growth: tenants created per month (last 12 months)
      const growthRows = await db()
        .from('tenants')
        .select(db().raw("DATE_FORMAT(created_at, '%Y-%m') as ym"))
        .count({ c: '*' })
        .where('created_at', '>=', addMonths(new Date().toISOString(), -11))
        .groupByRaw("DATE_FORMAT(created_at, '%Y-%m')")
        .orderBy('ym', 'asc');

      const tenantGrowth = growthRows.map((r) => ({
        month: String(r.ym || ''),
        newTenants: Number(r.c ?? r.count ?? r['count(*)'] ?? 0) || 0,
      }));

      // Tenant Churn: tenants moved to suspended (approx via updated_at) per month (last 12 months)
      const churnRows = await db()
        .from('tenants')
        .select(db().raw("DATE_FORMAT(COALESCE(updated_at, created_at), '%Y-%m') as ym"))
        .count({ c: '*' })
        .where({ status: 'suspended' })
        .andWhereRaw('COALESCE(updated_at, created_at) >= ?', [addMonths(new Date().toISOString(), -11)])
        .groupByRaw("DATE_FORMAT(COALESCE(updated_at, created_at), '%Y-%m')")
        .orderBy('ym', 'asc');

      const tenantChurn = churnRows.map((r) => ({
        month: String(r.ym || ''),
        churnedTenants: Number(r.c ?? r.count ?? r['count(*)'] ?? 0) || 0,
      }));

      const tenantsNewRow = await db().count({ c: '*' }).from('tenants').where('created_at', '>=', sinceIso).first();
      const tenantsNew = Number(tenantsNewRow?.c ?? tenantsNewRow?.count ?? tenantsNewRow?.['count(*)'] ?? 0) || 0;
      const tenantsPrevRow = await db()
        .count({ c: '*' })
        .from('tenants')
        .where('created_at', '>=', prevSinceIso)
        .andWhere('created_at', '<', sinceIso)
        .first();
      const tenantsPrev = Number(tenantsPrevRow?.c ?? tenantsPrevRow?.count ?? tenantsPrevRow?.['count(*)'] ?? 0) || 0;

      const pctChange = (cur, prev) => {
        const a = Number(cur || 0) || 0;
        const b = Number(prev || 0) || 0;
        if (b <= 0) return a > 0 ? 100 : 0;
        return Math.round(((a - b) / b) * 100);
      };

      // Critical alerts: open support tickets (most recent)
      const alertsRows = await db()
        .from({ t: 'support_tickets' })
        .leftJoin({ ten: 'tenants' }, 'ten.id', 't.tenant_id')
        .select(['t.id', 't.severity', 't.subject', 't.status', 't.created_at', 'ten.name as tenant_name'])
        .whereNotIn('t.status', ['resolved', 'closed'])
        .orderBy('t.created_at', 'desc')
        .limit(10);

      const alerts = alertsRows.map((x) => ({
        id: String(x.id),
        severity: String(x.severity || 'info'),
        message: truncate(`${x.tenant_name ? String(x.tenant_name) : 'Tenant'}: ${x.subject ? String(x.subject) : 'Support ticket'}`, 120),
        status: String(x.status || ''),
        createdAt: toIso(x.created_at),
      }));

      const alertsNewRow = await db()
        .from('support_tickets')
        .count({ c: '*' })
        .whereNotIn('status', ['resolved', 'closed'])
        .andWhere('created_at', '>=', addDays(new Date().toISOString(), -1))
        .first();
      const alertsNewCount = Number(alertsNewRow?.c ?? alertsNewRow?.count ?? alertsNewRow?.['count(*)'] ?? 0) || 0;

      const syncConflictsRow = await db()
        .from('support_tickets')
        .count({ c: '*' })
        .whereNotIn('status', ['resolved', 'closed'])
        .andWhere((qb) => qb.whereRaw('LOWER(subject) LIKE ?', ['%sync%']).orWhereRaw('LOWER(subject) LIKE ?', ['%offline%']))
        .first();
      const syncConflictsPending = Number(syncConflictsRow?.c ?? syncConflictsRow?.count ?? syncConflictsRow?.['count(*)'] ?? 0) || 0;

      // Error rate (5xx proxy): failed jobs / all jobs in last 24h, plus sparkline (last 10 hours)
      const errSinceIso = addDays(new Date().toISOString(), -1);
      const errPrevSinceIso = addDays(new Date().toISOString(), -2);

      const jobsLastRow = await db().from('jobs').count({ c: '*' }).where('created_at', '>=', errSinceIso).first();
      const jobsLast = Number(jobsLastRow?.c ?? jobsLastRow?.count ?? jobsLastRow?.['count(*)'] ?? 0) || 0;
      const jobsFailLastRow = await db().from('jobs').count({ c: '*' }).where('created_at', '>=', errSinceIso).andWhere({ status: 'failed' }).first();
      const jobsFailLast = Number(jobsFailLastRow?.c ?? jobsFailLastRow?.count ?? jobsFailLastRow?.['count(*)'] ?? 0) || 0;

      const jobsPrevRow = await db().from('jobs').count({ c: '*' }).where('created_at', '>=', errPrevSinceIso).andWhere('created_at', '<', errSinceIso).first();
      const jobsPrev = Number(jobsPrevRow?.c ?? jobsPrevRow?.count ?? jobsPrevRow?.['count(*)'] ?? 0) || 0;
      const jobsFailPrevRow = await db().from('jobs').count({ c: '*' }).where('created_at', '>=', errPrevSinceIso).andWhere('created_at', '<', errSinceIso).andWhere({ status: 'failed' }).first();
      const jobsFailPrev = Number(jobsFailPrevRow?.c ?? jobsFailPrevRow?.count ?? jobsFailPrevRow?.['count(*)'] ?? 0) || 0;

      const errorRate5xx = jobsLast > 0 ? jobsFailLast / jobsLast : 0;
      const errorRatePrev = jobsPrev > 0 ? jobsFailPrev / jobsPrev : 0;
      const errorRateDelta = errorRate5xx - errorRatePrev;

      const sparkRows = await db()
        .from('jobs')
        .select(db().raw("DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as hh"))
        .select(db().raw('COUNT(*) as total'))
        .select(db().raw("SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed"))
        .where('created_at', '>=', addDays(new Date().toISOString(), -0.5))
        .groupByRaw("DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')")
        .orderBy('hh', 'asc');

      const errorSparkline = sparkRows
        .map((r) => {
          const total = Number(r.total || 0) || 0;
          const failed = Number(r.failed || 0) || 0;
          const rate = total > 0 ? failed / total : 0;
          return rate;
        })
        .slice(-10);

      // Last sync: latest pos_state update across all branches
      const lastSyncRow = await db().from('restaurant_tables').max({ mx: 'updated_at' }).first();
      const lastSyncAt = toIso(lastSyncRow?.mx);

      // DB status
      let databaseStatus = 'unknown';
      try {
        await db().raw('SELECT 1');
        databaseStatus = 'connected';
      } catch {
        databaseStatus = 'disconnected';
      }

      // Sync health: branches with a recent pos_state update (last 10 minutes)
      const syncSinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const syncRows = await db().select(['branch_id']).from('restaurant_tables').where('updated_at', '>=', syncSinceIso);
      const syncingBranches = new Set(syncRows.map((x) => String(x.branch_id || '')).filter(Boolean)).size;
      const syncHealth = {
        syncingBranches,
        windowMinutes: 10,
      };

      return res.json({
        ok: true,
        overview: {
          totalTenants,
          activeTenants,
          suspendedTenants,
          trialTenants,
          totalBranches,
          totalUsers,
          ordersLast30d,
          ordersToday,
          ordersMonth: ordersLast30d,
          orderTotalLast30dEtb,
          avgTicketEtb,
          mrrEtb,
          syncHealth,
          lastSyncAt,
          databaseStatus,
          trends: {
            tenantsPct: pctChange(tenantsNew, tenantsPrev),
            ordersPct: pctChange(ordersLast30d, ordersPrev),
            revenuePct: pctChange(orderTotalLast30dEtb, orderTotalPrevEtb),
          },
          syncConflictsPending,
          errorRate5xx,
          errorRateDelta,
          errorSparkline,
          alertsNewCount,
        },
        revenueByMonth,
        tenantGrowth,
        tenantChurn,
        alerts,
        stats: {
          totalTenants,
          activeTenants,
          suspendedTenants,
          trialTenants,
          totalBranches,
          totalUsers,
          ordersLast30d,
          ordersToday,
          ordersMonth: ordersLast30d,
          orderTotalLast30dEtb,
          avgTicketEtb,
          mrrEtb,
          syncHealth,
          lastSyncAt,
          databaseStatus,
          trends: {
            tenantsPct: pctChange(tenantsNew, tenantsPrev),
            ordersPct: pctChange(ordersLast30d, ordersPrev),
            revenuePct: pctChange(orderTotalLast30dEtb, orderTotalPrevEtb),
          },
          syncConflictsPending,
          errorRate5xx,
          errorRateDelta,
          errorSparkline,
          alertsNewCount,
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/demo-requests', requireSuperadmin, async (req, res, next) => {
    try {
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const base = db().from('demo_requests');
      if (status) base.where({ status });
      const rows0 = await base.select(['id', 'status', 'name', 'email', 'phone', 'company', 'country', 'source', 'message', 'meta_json', 'provisioned_tenant_id', 'processed_at', 'created_at', 'updated_at']).orderBy('created_at', 'desc').limit(500);

      const items = rows0
        .map((d) => ({
          id: String(d.id),
          status: String(d.status || ''),
          name: String(d.name || ''),
          email: String(d.email || ''),
          phone: String(d.phone || ''),
          company: String(d.company || ''),
          country: String(d.country || ''),
          source: String(d.source || ''),
          message: String(d.message || ''),
          meta: safeJsonParse(d.meta_json, {}),
          provisionedTenantId: d.provisioned_tenant_id ? String(d.provisioned_tenant_id) : '',
          processedAt: toIso(d.processed_at),
          createdAt: toIso(d.created_at),
          updatedAt: toIso(d.updated_at),
        }))
        .filter((x) => {
          if (!q) return true;
          return x.name.toLowerCase().includes(q) || x.email.toLowerCase().includes(q) || x.company.toLowerCase().includes(q);
        });

      return res.json({ ok: true, demoRequests: items });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/demo-requests/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'invalid_id' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const status = typeof body?.status === 'string' ? body.status.trim() : '';
      const provisionedTenantId = typeof body?.provisionedTenantId === 'string' ? body.provisionedTenantId.trim() : '';

      const existing = await db().select(['id']).from('demo_requests').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = { updated_at: new Date().toISOString() };
      if (status) patch.status = status;
      if (provisionedTenantId) patch.provisioned_tenant_id = provisionedTenantId;
      if (status && status !== 'New') patch.processed_at = new Date().toISOString();

      await db().from('demo_requests').where({ id }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/demo-requests/:id/provision', requireSuperadmin, async (req, res, next) => {
    try {
      const requestId = String(req.params?.id || '').trim();
      if (!requestId) return res.status(400).json({ error: 'invalid_id' });

      const dr = await db()
        .select(['id', 'status', 'name', 'email', 'company', 'provisioned_tenant_id'])
        .from('demo_requests')
        .where({ id: requestId })
        .first();
      if (!dr) return res.status(404).json({ error: 'not_found' });
      if (dr.provisioned_tenant_id) return res.status(409).json({ error: 'already_provisioned' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      const tenantName = typeof body?.tenantName === 'string' ? body.tenantName.trim() : '';
      const branchName = typeof body?.branchName === 'string' ? body.branchName.trim() : '';
      const ownerName = typeof body?.ownerName === 'string' ? body.ownerName.trim() : '';
      const ownerPassword = typeof body?.ownerPassword === 'string' ? body.ownerPassword : '';
      const trialDays = body?.trialDays;

      if (!slug) return res.status(400).json({ error: 'slug_required' });
      if (!tenantName) return res.status(400).json({ error: 'tenant_name_required' });
      if (!ownerPassword) return res.status(400).json({ error: 'owner_password_required' });

      const out = await provisionTenant({
        slug,
        name: tenantName,
        trialDays,
        ownerName: ownerName || String(dr.name || 'Owner'),
        ownerEmail: String(dr.email || ''),
        ownerPassword,
        branchName: branchName || String(dr.company || 'Main Branch'),
      });

      if (!out.ok) return res.status(out.error === 'slug_in_use' ? 409 : 400).json({ error: out.error });

      const nowIso = new Date().toISOString();
      await db()
        .from('demo_requests')
        .where({ id: requestId })
        .update({
          status: 'Provisioned',
          provisioned_tenant_id: String(out.tenant.id),
          processed_at: nowIso,
          updated_at: nowIso,
        });

      return res.status(201).json({ ok: true, requestId, tenant: out.tenant, defaultBranch: out.defaultBranch, owner: out.owner });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants', requireSuperadmin, async (_req, res, next) => {
    try {
      const q = typeof _req.query?.q === 'string' ? _req.query.q.trim().toLowerCase() : '';
      const statusRaw = typeof _req.query?.status === 'string' ? _req.query.status.trim() : '';
      const tierRaw = typeof _req.query?.tier === 'string' ? _req.query.tier.trim() : '';
      const sort = typeof _req.query?.sort === 'string' ? _req.query.sort.trim() : 'last_activity';
      const page = Math.max(1, Number(_req.query?.page || 1) || 1);
      const limit = Math.min(60, Math.max(6, Number(_req.query?.limit || 24) || 24));
      const offset = (page - 1) * limit;

      const plansRows = await db().select(['tier', 'limits_json']).from('plans');
      const planLimitsByTier = new Map(plansRows.map((p) => [String(p.tier || ''), safeJsonParse(p.limits_json, {})]));

      const base = db()
        .select([
          't.id',
          't.name',
          't.slug',
          't.status',
          't.created_at',
          't.updated_at',
          'p.profile_json',
          db().raw('COUNT(DISTINCT b.id) as branches'),
          db().raw('COUNT(DISTINCT s.id) as users'),
          db().raw('MAX(e.at) as last_activity_at'),
        ])
        .from({ t: 'tenants' })
        .leftJoin({ b: 'branches' }, 'b.tenant_id', 't.id')
        .leftJoin({ s: 'staff' }, 's.tenant_id', 't.id')
        .leftJoin({ e: 'events' }, 'e.tenant_id', 't.id')
        .leftJoin({ p: 'tenant_profile' }, 'p.tenant_id', 't.id')
        .groupBy(['t.id', 't.name', 't.slug', 't.status', 't.created_at', 't.updated_at']);

      if (statusRaw) {
        const st = mapUiStatusToTenant(statusRaw);
        if (st) base.where('t.status', st);
      }

      if (q) {
        base.andWhere((qb) => qb.whereRaw('LOWER(t.name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(t.id) LIKE ?', [`%${q}%`]));
      }

      const countRow = await base.clone().clearSelect().clearOrder().count({ c: db().raw('DISTINCT t.id') }).first();
      const total = Number(countRow?.c ?? countRow?.count ?? countRow?.['count(*)'] ?? 0) || 0;

      if (sort === 'created') {
        base.orderBy('t.created_at', 'desc');
      } else if (sort === 'name') {
        base.orderBy('t.name', 'asc');
      } else {
        base.orderByRaw('MAX(e.at) IS NULL, MAX(e.at) DESC');
      }

      const rows = tierRaw ? await base : await base.limit(limit).offset(offset);

      const tenants = await Promise.all(
        rows.map(async (x) => ({
          onboarding: (() => {
            const profile = safeJsonParse(x.profile_json, {});
            const stage = String(profile?.onboarding?.stage || profile?.onboardingStage || '').trim() || 'incoming';
            return { stage };
          })(),
          internalTags: (() => {
            const profile = safeJsonParse(x.profile_json, {});
            const tags = profile?.internalTags;
            return Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
          })(),
          id: String(x.id),
          name: String(x.name),
          plan: await getTenantTier(String(x.id)),
          status: mapTenantStatusToUi(String(x.status)),
          branches: Number(x.branches || 0) || 0,
          users: Number(x.users || 0) || 0,
          lastActivityAt: toIso(x.last_activity_at),
          createdAt: toIso(x.created_at),
          updatedAt: toIso(x.updated_at),
          owner: (() => {
            const profile = safeJsonParse(x.profile_json, {});
            const ownerName = String(profile?.ownerName || profile?.contactName || '').trim();
            const ownerEmail = String(profile?.contactEmail || '').trim();
            const ownerPhone = String(profile?.contactPhone || '').trim();
            return { name: ownerName || '', email: ownerEmail || '', phone: ownerPhone || '' };
          })(),
        })),
      );

      // apply tier filter post tier resolution (tier is computed)
      const filteredTenants = tierRaw
        ? tenants.filter((t) => String(t.plan || '').toLowerCase() === tierRaw.toLowerCase())
        : tenants;

      const pageTenants = tierRaw ? filteredTenants.slice(offset, offset + limit) : filteredTenants;

      const tenantsOut = pageTenants.map((t) => {
        const limits = planLimitsByTier.get(String(t.plan || '')) || {};
        const branchLimit = Number(limits?.branchLimit || limits?.branches || 0) || 0;
        const staffLimit = Number(limits?.staffLimit || limits?.staffAccounts || 0) || 0;
        const pct = (() => {
          const a = branchLimit > 0 ? Math.round((t.branches / branchLimit) * 100) : 0;
          const b = staffLimit > 0 ? Math.round((t.users / staffLimit) * 100) : 0;
          const m = Math.max(a, b);
          return Math.max(0, Math.min(100, m));
        })();
        const label = branchLimit > 0 ? `Branches (${t.branches}/${branchLimit})` : staffLimit > 0 ? `Users (${t.users}/${staffLimit})` : '';
        return { ...t, usage: { pct, label } };
      });

      const totalOut = tierRaw ? filteredTenants.length : total;
      return res.json({ ok: true, tenants: tenantsOut, page, limit, total: totalOut });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const t = await db().select(['id', 'name', 'slug', 'status', 'created_at', 'updated_at', 'enabled_modules_json', 'features_json']).from('tenants').where({ id: tenantId }).first();
      if (!t) return res.status(404).json({ error: 'not_found' });

      const sub = await db()
        .select(['tier', 'cycle', 'status', 'method', 'next_bill_at', 'amount_etb', 'grace_ends_at'])
        .from('tenant_subscription')
        .where({ tenant_id: tenantId })
        .first();
      const tier = sub?.tier ? String(sub.tier) : await getTenantTier(tenantId);

      const planRow = await db().select(['price_monthly_etb', 'price_yearly_etb', 'limits_json']).from('plans').where({ tier }).first();

      const branchesCountRow = await db().count({ c: '*' }).from('branches').where({ tenant_id: tenantId }).first();
      const branches = Number(branchesCountRow?.c ?? branchesCountRow?.count ?? branchesCountRow?.['count(*)'] ?? 0) || 0;

      const usersCountRow = await db().count({ c: '*' }).from('staff').where({ tenant_id: tenantId }).first();
      const users = Number(usersCountRow?.c ?? usersCountRow?.count ?? usersCountRow?.['count(*)'] ?? 0) || 0;

      const profileRow = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: tenantId }).first();
      const profile = safeJsonParse(profileRow?.profile_json, {});

      const enabledModules = safeJsonParse(t.enabled_modules_json, null);
      const features = safeJsonParse(t.features_json, []);

      const branchesPreviewRows = await db()
        .select(['id', 'name', 'city', 'status'])
        .from('branches')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc')
        .limit(5);

      const nowMs = Date.now();
      const monthSinceIso = addDays(new Date().toISOString(), -30);
      const ordersMonthRow = await db().from('orders').count({ c: '*' }).where({ tenant_id: tenantId }).andWhere('created_at', '>=', monthSinceIso).first();
      const ordersMonth = Number(ordersMonthRow?.c ?? ordersMonthRow?.count ?? ordersMonthRow?.['count(*)'] ?? 0) || 0;
      const prevMonthSinceIso = addDays(new Date().toISOString(), -60);
      const ordersPrevRow = await db()
        .from('orders')
        .count({ c: '*' })
        .where({ tenant_id: tenantId })
        .andWhere('created_at', '>=', prevMonthSinceIso)
        .andWhere('created_at', '<', monthSinceIso)
        .first();
      const ordersPrev = Number(ordersPrevRow?.c ?? ordersPrevRow?.count ?? ordersPrevRow?.['count(*)'] ?? 0) || 0;
      const ordersPct = ordersPrev > 0 ? Math.round(((ordersMonth - ordersPrev) / ordersPrev) * 1000) / 10 : ordersMonth > 0 ? 100 : 0;

      const subAmountEtb = Number(sub?.amount_etb || 0) || 0;
      const cycle = String(sub?.cycle || 'Monthly').toLowerCase();
      const mrrEtb = cycle === 'yearly' ? Math.round(subAmountEtb / 12) : subAmountEtb;

      const branchesNewMonthRow = await db().from('branches').count({ c: '*' }).where({ tenant_id: tenantId }).andWhere('created_at', '>=', monthSinceIso).first();
      const branchesNewMonth = Number(branchesNewMonthRow?.c ?? branchesNewMonthRow?.count ?? branchesNewMonthRow?.['count(*)'] ?? 0) || 0;

      const since24hIso = addDays(new Date().toISOString(), -1);
      const eventsTodayRow = await db().from('events').count({ c: '*' }).where({ tenant_id: tenantId }).andWhere('at', '>=', since24hIso).first();
      const eventsToday = Number(eventsTodayRow?.c ?? eventsTodayRow?.count ?? eventsTodayRow?.['count(*)'] ?? 0) || 0;

      const branchesTableRows = await db()
        .from({ b: 'branches' })
        .leftJoin({ rt: 'restaurant_tables' }, function () {
          this.on('rt.branch_id', '=', 'b.id').andOn('rt.tenant_id', '=', 'b.tenant_id');
        })
        .select(['b.id', 'b.name', 'b.city'])
        .max({ updated_at: 'rt.updated_at' })
        .where('b.tenant_id', tenantId)
        .groupBy(['b.id', 'b.name', 'b.city'])
        .orderBy('b.created_at', 'desc')
        .limit(50);

      const branchesTable = branchesTableRows.map((r) => {
        const lastSyncAt = toIso(r.updated_at);
        const lastSyncMs = lastSyncAt ? new Date(lastSyncAt).getTime() : NaN;
        const ageMin = Number.isFinite(lastSyncMs) ? (nowMs - lastSyncMs) / (60 * 1000) : Infinity;
        const status = ageMin <= 3 ? 'Online' : ageMin <= 15 ? 'Syncing' : 'Offline';
        return {
          id: String(r.id),
          name: String(r.name || ''),
          locationId: String(r.id),
          status,
          lastSyncAt,
        };
      });

      const activityRows = await db().select(['id', 'type', 'summary', 'created_at']).from('audit_log').where({ tenant_id: tenantId }).orderBy('created_at', 'desc').limit(20);
      const activity = activityRows.map((x) => ({
        id: String(x.id),
        at: toIso(x.created_at),
        type: String(x.type || ''),
        message: String(x.summary || ''),
      }));

      const tenantOut = {
        id: String(t.id),
        name: String(t.name),
        slug: String(t.slug || ''),
        status: mapTenantStatusToUi(String(t.status)),
        plan: tier,
        subscription: {
          tier,
          cycle: String(sub?.cycle || 'Monthly'),
          status: String(sub?.status || 'active'),
          method: String(sub?.method || 'manual'),
          nextBillAt: toIso(sub?.next_bill_at),
          amountEtb: Number(sub?.amount_etb || 0) || 0,
          graceEndsAt: toIso(sub?.grace_ends_at),
        },
        planPricing: {
          monthlyEtb: Number(planRow?.price_monthly_etb || 0) || 0,
          yearlyEtb: Number(planRow?.price_yearly_etb || 0) || 0,
        },
        planLimits: safeJsonParse(planRow?.limits_json, {}),
        enabledModules: Array.isArray(enabledModules) ? enabledModules.map(String) : null,
        features: Array.isArray(features) ? features.map(String) : [],
        profile,
        metrics: {
          branches,
          users,
          ordersMonth,
          ordersPct,
          mrrEtb,
          branchesNewMonth,
          eventsToday,
        },
        branchesTable,
        activity,
        branchesPreview: branchesPreviewRows.map((b) => ({
          id: String(b.id),
          name: String(b.name),
          city: b.city ? String(b.city) : undefined,
          status: b.status ? String(b.status) : undefined,
        })),
        branches,
        users,
        lastActivityAt: '',
        createdAt: toIso(t.created_at),
        updatedAt: toIso(t.updated_at),
      };

      return res.json({ ok: true, tenant: tenantOut });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tenants/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const existing = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();

      if (typeof req.body?.status === 'string') {
        const st = mapUiStatusToTenant(req.body.status);
        if (st) patch.status = st;
      }

      // tier maps to subscription tier
      const tier = typeof req.body?.tier === 'string' ? req.body.tier.trim() : '';

      const onboardingStage = typeof req.body?.onboardingStage === 'string' ? req.body.onboardingStage.trim() : '';
      const internalTags = Array.isArray(req.body?.internalTags) ? req.body.internalTags.map(String).filter(Boolean) : null;

      if (Array.isArray(req.body?.enabledModules)) patch.enabled_modules_json = JSON.stringify(req.body.enabledModules.map(String));
      if (Array.isArray(req.body?.features)) patch.features_json = JSON.stringify(req.body.features.map(String));

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('tenants').where({ id: tenantId }).update(patch);

      if (tier) {
        // If the tenant was in trial and gets a paid tier, move them to active unless explicitly suspended.
        const t0 = await db().select(['status']).from('tenants').where({ id: tenantId }).first();
        if (t0 && String(t0.status) === 'trial' && tier !== 'Trial') {
          await db().from('tenants').where({ id: tenantId }).update({ status: 'active', plan: 'active', trial_ends_at: null, updated_at: nowIso });
        }

        const modules = await getPlanModules(tier);
        await db()
          .from('tenant_subscription')
          .insert({ tenant_id: tenantId, tier, modules_json: JSON.stringify(modules), cycle: 'Monthly', status: 'active', method: 'manual', next_bill_at: nowIso, amount_etb: 0, grace_ends_at: nowIso, updated_at: nowIso })
          .onConflict('tenant_id')
          .merge({ tier, modules_json: JSON.stringify(modules), updated_at: nowIso });
      }

      if (onboardingStage || internalTags) {
        const existingProfile = await readTenantProfileJson(tenantId);
        const nextProfile = (existingProfile && typeof existingProfile === 'object') ? { ...existingProfile } : {};
        if (onboardingStage) {
          nextProfile.onboarding = { ...(nextProfile.onboarding && typeof nextProfile.onboarding === 'object' ? nextProfile.onboarding : {}), stage: onboardingStage };
          nextProfile.onboardingStage = onboardingStage;
        }
        if (internalTags) nextProfile.internalTags = internalTags.slice(0, 30);
        await writeTenantProfileJson(tenantId, nextProfile);
      }

      if (req.body?.profile && typeof req.body.profile === 'object') {
        const existingProfile = await readTenantProfileJson(tenantId);
        const base = (existingProfile && typeof existingProfile === 'object') ? { ...existingProfile } : {};
        const patchProfile = req.body.profile;
        const nextProfile = { ...base, ...patchProfile };
        await writeTenantProfileJson(tenantId, nextProfile);
      }

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants/:id/users', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const rows = await db()
        .select(['id', 'name', 'email', 'phone', 'role_name', 'status', 'last_login_at', 'created_at'])
        .from('staff')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc')
        .limit(200);

      const users = rows.map((u) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
        phone: String(u.phone || ''),
        role: String(u.role_name || ''),
        status: String(u.status || ''),
        lastLoginAt: toIso(u.last_login_at),
        createdAt: toIso(u.created_at),
      }));

      return res.json({ ok: true, users });
    } catch (e) {
      return next(e);
    }
  });

  // Tenant POS Payment Gateways (Super Admin-managed secrets)
  r.get('/superadmin/tenants/:id/pos-payment-gateways', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const rows = await db()
        .from('tenant_pos_payment_gateways')
        .select(['gateway', 'enabled', 'config_json', 'updated_at'])
        .where({ tenant_id: tenantId })
        .orderBy('gateway', 'asc');

      const secretFieldsByGateway = {
        chapa: ['secretKey', 'webhookSecret', 'publicKey'],
        telebirr: ['fabricAppId', 'merchantAppId', 'merchantCode', 'privateKey'],
        cbe_birr: ['merchantId', 'privateKey', 'publicKey'],
        santimpay: ['merchantId', 'privateKey', 'publicKey'],
      };

      const gateways = (rows || []).map((r0) => {
        const g = String(r0.gateway || '').trim().toLowerCase();
        const cfg0 = safeJsonParse(r0.config_json, {});
        const fields = Array.isArray(secretFieldsByGateway[g]) ? secretFieldsByGateway[g] : [];
        let cfg = cfg0;
        try {
          cfg = decryptConfigFields(cfg0, fields);
        } catch {
          cfg = cfg0;
        }
        return {
          gateway: String(r0.gateway || ''),
          enabled: Boolean(r0.enabled),
          updatedAt: toIso(r0.updated_at),
          config: {
            secretKeyMasked: maskSecret(cfg?.secretKey),
            publicKeyMasked: maskSecret(cfg?.publicKey),
            webhookSecretMasked: maskSecret(cfg?.webhookSecret),
            merchantCodeMasked: maskSecret(cfg?.merchantCode),
            merchantIdMasked: maskSecret(cfg?.merchantId),
            privateKeyMasked: maskSecret(cfg?.privateKey),
          },
        };
      });

      return res.json({ ok: true, gateways });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tenants/:id/pos-payment-gateways/:gateway', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });
      const gateway = String(req.params?.gateway || '').trim().toLowerCase();
      if (!gateway) return res.status(400).json({ error: 'gateway_required' });
      if (gateway !== 'chapa' && gateway !== 'telebirr' && gateway !== 'cbe_birr' && gateway !== 'santimpay') {
        return res.status(400).json({ error: 'invalid_gateway' });
      }

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const enabled = req.body?.enabled === true;
      const configPatch = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};

      const existing = await db()
        .from('tenant_pos_payment_gateways')
        .select(['config_json'])
        .where({ tenant_id: tenantId, gateway })
        .first();

      const secretFieldsByGateway = {
        chapa: ['secretKey', 'webhookSecret', 'publicKey'],
        telebirr: ['fabricAppId', 'merchantAppId', 'merchantCode', 'privateKey'],
        cbe_birr: ['merchantId', 'privateKey', 'publicKey'],
        santimpay: ['merchantId', 'privateKey', 'publicKey'],
      };
      const fields = Array.isArray(secretFieldsByGateway[gateway]) ? secretFieldsByGateway[gateway] : [];

      const prevCfg0 = safeJsonParse(existing?.config_json, {});
      const prevCfg = decryptConfigFields(prevCfg0, fields);

      const nextCfg = {
        ...(prevCfg && typeof prevCfg === 'object' ? prevCfg : {}),
        ...(configPatch && typeof configPatch === 'object' ? configPatch : {}),
      };

      // Strict mode requirements for POS Chapa: if enabling, keys must exist.
      const secretKey = typeof nextCfg?.secretKey === 'string' ? nextCfg.secretKey.trim() : '';
      const webhookSecret = typeof nextCfg?.webhookSecret === 'string' ? nextCfg.webhookSecret.trim() : '';
      if (gateway === 'chapa' && enabled && (!secretKey || !webhookSecret)) {
        return res.status(400).json({ error: 'chapa_keys_required' });
      }

      // Strict mode requirements for POS SantimPay: if enabling, merchantId + keypair must exist.
      const santimMerchantId = typeof nextCfg?.merchantId === 'string' ? nextCfg.merchantId.trim() : '';
      const santimPriv = typeof nextCfg?.privateKey === 'string' ? nextCfg.privateKey.trim() : '';
      const santimPub = typeof nextCfg?.publicKey === 'string' ? nextCfg.publicKey.trim() : '';
      if (gateway === 'santimpay' && enabled && (!santimMerchantId || !santimPriv || !santimPub)) {
        return res.status(400).json({ error: 'santimpay_keys_required' });
      }

      let encCfg = null;
      try {
        encCfg = encryptConfigFields(nextCfg, fields);
      } catch (e) {
        const msg = String(e?.message || e || '').trim();
        if (msg === 'tenant_gateway_secrets_key_missing' || msg === 'invalid_tenant_gateway_secrets_key') {
          return res.status(500).json({
            error: msg,
            message: 'Server is missing TENANT_GATEWAY_SECRETS_KEY (32 bytes, base64 or hex). Configure it and restart the API server.',
          });
        }
        throw e;
      }

      const nowIso = new Date().toISOString();

      await db()
        .from('tenant_pos_payment_gateways')
        .insert({
          tenant_id: tenantId,
          gateway,
          enabled: enabled ? 1 : 0,
          config_json: JSON.stringify(encCfg),
          updated_at: nowIso,
        })
        .onConflict(['tenant_id', 'gateway'])
        .merge({
          enabled: enabled ? 1 : 0,
          config_json: JSON.stringify(encCfg),
          updated_at: nowIso,
        });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'tenant.pos_payment_gateways.update',
        summary: `Updated tenant POS payment gateway: ${gateway}`,
        payload_json: JSON.stringify({ tenantId, gateway, enabled, keys: Object.keys(configPatch || {}) }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tenants/:id/notes', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      const id = makeId('note');
      await db().from('tenant_notes').insert({ id, tenant_id: tenantId, staff_id: null, message, created_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tenant.note', summary: 'Added tenant note', payload_json: JSON.stringify({ noteId: id }), created_at: nowIso });
      return res.status(201).json({ ok: true, noteId: id });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tenants', requireSuperadmin, async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      const slug = String(req.body?.slug || '').trim().toLowerCase();
      const tier = String(req.body?.tier || 'Trial').trim();

      const ownerName = typeof req.body?.ownerName === 'string' ? req.body.ownerName.trim() : '';
      const ownerEmail = typeof req.body?.ownerEmail === 'string' ? req.body.ownerEmail.trim().toLowerCase() : '';
      const ownerPhone = typeof req.body?.ownerPhone === 'string' ? req.body.ownerPhone.trim() : '';
      const ownerPasswordRaw = typeof req.body?.ownerPassword === 'string' ? req.body.ownerPassword : '';

      if (!name) return res.status(400).json({ error: 'name_required' });

      const useSlug = slug || String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').slice(0, 48);
      if (!useSlug) return res.status(400).json({ error: 'slug_required' });

      const exists = await db().select(['id']).from('tenants').where({ slug: useSlug }).first();
      if (exists) return res.status(409).json({ error: 'slug_in_use' });

      const id = makeId('tnt');
      const nowIso = new Date().toISOString();

      const status = tier === 'Trial' ? 'trial' : 'active';
      const plan = tier === 'Trial' ? 'trial' : 'active';
      const trialEndsAt = status === 'trial' ? new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString() : null;

      const genPassword = () => {
        const s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        return `Mp-${s.slice(0, 10)}`;
      };
      const ownerPassword = ownerPasswordRaw || genPassword();
      if (!ownerEmail) return res.status(400).json({ error: 'owner_email_required' });
      if (!ownerPassword || String(ownerPassword).length < 6) return res.status(400).json({ error: 'owner_password_too_short' });

      const profile = {
        ownerName,
        contactName: ownerName,
        contactEmail: ownerEmail,
        contactPhone: ownerPhone,
        address1: typeof req.body?.address1 === 'string' ? req.body.address1.trim() : '',
        city: typeof req.body?.city === 'string' ? req.body.city.trim() : '',
        country: typeof req.body?.country === 'string' ? req.body.country.trim() : '',
        timezone: typeof req.body?.timezone === 'string' ? req.body.timezone.trim() : '',
        currency: typeof req.body?.currency === 'string' ? req.body.currency.trim() : '',
      };

      const branchName = typeof req.body?.branchName === 'string' ? req.body.branchName.trim() : '';

      const ownerHash = await bcrypt.hash(String(ownerPassword), 10);
      const branchId = makeId('br');
      const ownerRoleId = makeId('r_owner');
      const managerRoleId = makeId('r_manager');
      const waiterRoleId = makeId('r_waiter');
      const ownerStaffId = makeId('s_owner');

      await db().transaction(async (trx) => {
        await trx.from('tenants').insert({
          id,
          slug: useSlug,
          name,
          status,
          trial_ends_at: trialEndsAt,
          plan,
          plan_ends_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx.from('tenant_profile').insert({ tenant_id: id, profile_json: JSON.stringify(profile), updated_at: nowIso });

        await trx.from('tenant_subscription').insert({
          tenant_id: id,
          tier,
          modules_json: JSON.stringify([]),
          cycle: 'Monthly',
          status: 'active',
          method: 'manual',
          next_bill_at: nowIso,
          amount_etb: 0,
          grace_ends_at: nowIso,
          updated_at: nowIso,
        });

        await trx.from('branches').insert({
          id: branchId,
          tenant_id: id,
          name: branchName || 'Main Branch',
          status: 'Open',
          city: profile.city || null,
          address: profile.address1 || null,
          phone: profile.contactPhone || null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx
          .from('roles')
          .insert([
            { id: ownerRoleId, tenant_id: id, name: 'Cafe Owner', scope: 'global', permissions: JSON.stringify(['*']), created_at: nowIso },
            { id: managerRoleId, tenant_id: id, name: 'Branch Manager', scope: 'branch', permissions: JSON.stringify(['*']), created_at: nowIso },
            { id: waiterRoleId, tenant_id: id, name: 'Waiter', scope: 'branch', permissions: JSON.stringify(['*']), created_at: nowIso },
          ]);

        await trx.from('staff').insert({
          id: ownerStaffId,
          tenant_id: id,
          branch_id: null,
          role_id: ownerRoleId,
          role_name: 'Cafe Owner',
          name: ownerName || 'Owner',
          email: ownerEmail,
          phone: ownerPhone || '',
          code: null,
          password_hash: ownerHash,
          pin_hash: null,
          status: 'Active',
          created_at: nowIso,
          updated_at: nowIso,
        });

        await trx.from('events').insert({
          id: makeId('evt'),
          tenant_id: id,
          branch_id: null,
          type: 'tenant_created',
          payload: JSON.stringify({ tenantId: id, slug: useSlug, ownerStaffId }),
          at: nowIso,
        });
      });

      return res.status(201).json({ ok: true, tenantId: id, slug: useSlug, ownerPassword: ownerPasswordRaw ? undefined : ownerPassword });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tenants/reset-creds', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });
      // demo token (store it later if you want one-time verification)
      const resetToken = makeId('reset');
      return res.json({ ok: true, resetToken });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/impersonate', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const role = String(req.body?.role || 'Cafe Owner');
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!config.jwtSecret) return res.status(500).json({ error: 'server_misconfigured' });

      const tenantRow = await db().select(['id', 'status']).from('tenants').where({ id: tenantId }).first();
      if (!tenantRow) return res.status(404).json({ error: 'not_found' });

      const staff = await db().select(['id', 'role_name', 'branch_id']).from('staff').where({ tenant_id: tenantId, role_name: role }).first();
      if (!staff) return res.status(404).json({ error: 'no_staff_for_role' });

      // use same JWT secret; payload matches cafe auth shape
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        {
          tenantId,
          staffId: staff.id,
          role: staff.role_name,
          branchId: staff.branch_id || 'global',
        },
        config.jwtSecret,
        { expiresIn: '12h' },
      );

      const tenantFull = await db().select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at', 'enabled_modules_json']).from('tenants').where({ id: tenantId }).first();
      const ent = tenantFull ? await computeTenantEntitlements({ tenant: tenantFull }) : null;
      if (ent && tenantFull) await upsertTenantEntitlementsSnapshot({ tenantId: tenantFull.id, entitlements: ent });

      return res.json({
        ok: true,
        tenantId,
        role: staff.role_name,
        branchId: staff.branch_id || 'global',
        token,
        subscription: ent?.subscription || { tier: 'Trial', modules: [] },
        billing: ent?.billing || { cycle: 'Monthly', status: 'active', method: 'manual', nextBillAt: '', amountEtb: 0, graceEndsAt: '' },
        limits: ent?.limits || {},
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants/:id/activity', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const rows = await db()
        .select(['id', 'type', 'summary', 'created_at'])
        .from('audit_log')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc')
        .limit(50);

      const activity = rows.map((x) => ({
        id: String(x.id),
        at: toIso(x.created_at),
        type: String(x.type || ''),
        message: String(x.summary || ''),
      }));

      return res.json({ ok: true, activity });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/billing', requireSuperadmin, async (req, res, next) => {
    try {
      const plansRows = await db().select(['tier', 'price_monthly_etb', 'price_yearly_etb']).from('plans');
      const planPriceByTier = new Map(
        plansRows.map((p) => [
          String(p.tier || ''),
          {
            monthlyEtb: Number(p.price_monthly_etb || 0) || 0,
            yearlyEtb: Number(p.price_yearly_etb || 0) || 0,
          },
        ]),
      );

      const subs = await db()
        .select([
          's.tenant_id',
          's.tier',
          's.cycle',
          's.requested_tier',
          's.requested_cycle',
          's.status',
          's.method',
          's.next_bill_at',
          's.amount_etb',
          's.grace_ends_at',
          't.name as tenant_name',
        ])
        .from({ s: 'tenant_subscription' })
        .leftJoin({ t: 'tenants' }, 't.id', 's.tenant_id')
        .orderBy('s.updated_at', 'desc');

      const nowMs = Date.now();
      const mapSubStatusToUi = (raw) => {
        const s = String(raw || '').toLowerCase().replace(/\s+/g, '_');
        if (s === 'pending_verify' || s === 'verification_needed') return 'Verification Needed';
        if (s === 'past_due') return 'Past Due';
        if (s === 'canceled' || s === 'cancelled') return 'Canceled';
        return 'Active';
      };

      const mapMethodToUi = (raw) => {
        const m = String(raw || '').toLowerCase().replace(/\s+/g, '_');
        if (m === 'bank_transfer') return 'bank_transfer';
        if (m === 'cash') return 'cash';
        if (m === 'manual') return 'manual';
        return m || 'manual';
      };

      const subscriptions = subs.map((x) => {
        const graceIso = toIso(x.grace_ends_at);
        const graceMs = graceIso ? new Date(graceIso).getTime() : NaN;
        const atRisk = Number.isFinite(graceMs) && graceMs > nowMs && graceMs - nowMs <= 24 * 60 * 60 * 1000;

        const rawStatus = String(x.status || '').toLowerCase().replace(/\s+/g, '_');
        const requestedTier = x.requested_tier ? String(x.requested_tier) : '';
        const requestedCycle = x.requested_cycle ? String(x.requested_cycle) : '';
        const requestedPrice = (() => {
          if (rawStatus !== 'pending_verify' && rawStatus !== 'verification_needed') return null;
          if (!requestedTier || !requestedCycle) return null;
          const p = planPriceByTier.get(requestedTier);
          if (!p) return null;
          return requestedCycle.toLowerCase() === 'yearly' ? p.yearlyEtb : p.monthlyEtb;
        })();

        return {
          tenantId: String(x.tenant_id),
          tenantName: String(x.tenant_name || x.tenant_id),
          plan: String(x.tier || 'Trial'),
          cycle: String(x.cycle || 'Monthly'),
          requestedPlan: requestedTier,
          requestedCycle,
          nextBillAt: toIso(x.next_bill_at),
          amountEtb: requestedPrice != null ? requestedPrice : Number(x.amount_etb || 0) || 0,
          method: mapMethodToUi(x.method),
          status: mapSubStatusToUi(x.status),
          graceEndsAt: graceIso || undefined,
          _atRisk: atRisk,
        };
      });

      const overview = {
        totalActive: subscriptions.filter((x) => String(x.status) === 'Active').length,
        pendingVerify: subscriptions.filter((x) => String(x.status) === 'Verification Needed').length,
        monthlyRevenueEtb: Math.round(subscriptions.reduce((sum, x) => sum + (Number(x.amountEtb) || 0), 0)),
        atRisk: subscriptions.filter((x) => x._atRisk).length,
      };

      return res.json({ ok: true, overview, subscriptions: subscriptions.map(({ _atRisk, ...rest }) => rest) });
    } catch (e) {
      return next(e);
    }
  });

  // Pending payment verification queue
  r.get('/superadmin/payments/pending', requireSuperadmin, async (req, res, next) => {
    try {
      const limit = clampInt(req.query?.limit, 50, 1, 200);

      const rows = await db()
        .from({ p: 'payments' })
        .leftJoin({ i: 'invoices' }, 'i.id', 'p.invoice_id')
        .leftJoin({ t: 'tenants' }, 't.id', 'p.tenant_id')
        .where('p.status', 'pending')
        .orderBy('p.created_at', 'desc')
        .limit(limit)
        .select([
          'p.id as payment_id',
          'p.invoice_id',
          'p.tenant_id',
          'p.method',
          'p.amount_etb',
          'p.reference',
          'p.proof_url',
          'p.proof_filename',
          'p.created_at as payment_created_at',
          'i.invoice_number',
          'i.status as invoice_status',
          'i.total_etb as invoice_total_etb',
          'i.due_date as invoice_due_date',
          't.name as tenant_name',
        ]);

      const pendingPayments = rows
        .map((r) => {
          const proofUrlRaw = String(r.proof_url || '').trim();
          const proofUrl = proofUrlRaw;
          return {
            paymentId: String(r.payment_id),
            invoiceId: String(r.invoice_id || ''),
            invoiceNumber: String(r.invoice_number || ''),
            tenantId: String(r.tenant_id || ''),
            tenantName: String(r.tenant_name || r.tenant_id || ''),
            method: String(r.method || ''),
            amountEtb: Number(r.amount_etb || 0) || 0,
            reference: String(r.reference || ''),
            submittedAt: toIso(r.payment_created_at),
            proofUrl: proofUrl || '',
            proofFilename: String(r.proof_filename || ''),
            invoiceStatus: String(r.invoice_status || ''),
            invoiceTotalEtb: Number(r.invoice_total_etb || 0) || 0,
            invoiceDueDate: toIso(r.invoice_due_date),
          };
        })
        .filter((x) => x.paymentId && x.invoiceId && x.tenantId);

      return res.json({ ok: true, pendingPayments });
    } catch (e) {
      return next(e);
    }
  });

  // Download Invoice PDF (Super Admin)
  r.get('/superadmin/invoices/:id/pdf', requireSuperadmin, async (req, res, next) => {
    try {
      const invoiceId = String(req.params?.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });

      const invoice = await db().select(['invoice_number']).from('invoices').where({ id: invoiceId }).first();
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      // Dynamically require
      const { generateInvoicePDF } = require('../services/pdfService');
      let pdfBuffer;
      try {
        pdfBuffer = await generateInvoicePDF(invoiceId);
      } catch (err) {
        console.error('[InvoicePDF] Failed to generate superadmin invoice PDF', { invoiceId, err });
        return res.status(500).json({ error: 'invoice_pdf_failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoice_number}.pdf"`);
      return res.send(pdfBuffer);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/verify', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const nowIso = new Date().toISOString();

      const sub = await db().select(['tier', 'cycle', 'requested_tier', 'requested_cycle']).from('tenant_subscription').where({ tenant_id: tenantId }).first();
      const nextTier = String(sub?.requested_tier || sub?.tier || 'Trial');
      const nextCycle = String(sub?.requested_cycle || sub?.cycle || 'Monthly');
      const planRow = await db().select(['modules_json', 'price_monthly_etb', 'price_yearly_etb']).from('plans').where({ tier: nextTier }).first();
      const planModules = Array.isArray(safeJsonParse(planRow?.modules_json, [])) ? safeJsonParse(planRow?.modules_json, []).map(String) : [];
      const amountEtb = nextCycle.toLowerCase() === 'yearly' ? Number(planRow?.price_yearly_etb || 0) || 0 : Number(planRow?.price_monthly_etb || 0) || 0;

      const nextBillAt = nextCycle.toLowerCase() === 'yearly' ? addMonths(nowIso, 12) : addMonths(nowIso, 1);
      const graceEndsAt = addDays(nextBillAt, 3);

      await db()
        .from('tenant_subscription')
        .where({ tenant_id: tenantId })
        .update({
          tier: nextTier,
          cycle: nextCycle,
          modules_json: JSON.stringify(planModules),
          amount_etb: amountEtb,
          status: 'active',
          next_bill_at: nextBillAt,
          grace_ends_at: graceEndsAt,
          requested_tier: null,
          requested_cycle: null,
          requested_at: null,
          updated_at: nowIso,
        });

      const tenantFull = await db().select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at', 'enabled_modules_json']).from('tenants').where({ id: tenantId }).first();
      const ent = tenantFull ? await computeTenantEntitlements({ tenant: tenantFull }) : null;
      if (ent && tenantFull) await upsertTenantEntitlementsSnapshot({ tenantId: tenantFull.id, entitlements: ent });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: tenantId,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'billing.verify',
        summary: `Verified billing (${nextTier} / ${nextCycle})`,
        payload_json: JSON.stringify({ tier: nextTier, cycle: nextCycle, amountEtb, nextBillAt, graceEndsAt }),
        created_at: nowIso,
      });
      return res.json({ ok: true, tier: nextTier, cycle: nextCycle, amountEtb, nextBillAt, graceEndsAt });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/manual-invoice', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const amountEtb = Number(req.body?.amountEtb || 0);
      const dueAt = String(req.body?.dueAt || '').trim();
      const method = String(req.body?.method || 'Cash').trim() || 'Cash';
      const notes = String(req.body?.notes || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!Number.isFinite(amountEtb) || amountEtb <= 0) return res.status(400).json({ error: 'amount_invalid' });
      const nowIso = new Date().toISOString();
      const nextBillAt = dueAt ? new Date(dueAt).toISOString() : nowIso;
      const storedMethod = String(method).toLowerCase().replace(/\s+/g, '_');
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ amount_etb: amountEtb, method: storedMethod, next_bill_at: nextBillAt, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.manual_invoice', summary: `Manual invoice ETB ${amountEtb}`, payload_json: JSON.stringify({ dueAt: nextBillAt, method, notes }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-nextbill', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const nextBillAtRaw = String(req.body?.nextBillAt || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!nextBillAtRaw) return res.status(400).json({ error: 'nextBillAt_required' });
      const nextBillAtDate = new Date(nextBillAtRaw);
      if (Number.isNaN(nextBillAtDate.getTime())) return res.status(400).json({ error: 'invalid_nextBillAt' });
      const nextBillAt = nextBillAtDate.toISOString();
      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ next_bill_at: nextBillAt, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.set_nextbill', summary: 'Set next bill date', payload_json: JSON.stringify({ nextBillAt }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-grace', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const graceEndsAtRaw = String(req.body?.graceEndsAt || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!graceEndsAtRaw) return res.status(400).json({ error: 'graceEndsAt_required' });
      const graceEndsAtDate = new Date(graceEndsAtRaw);
      if (Number.isNaN(graceEndsAtDate.getTime())) return res.status(400).json({ error: 'invalid_graceEndsAt' });
      const graceEndsAt = graceEndsAtDate.toISOString();
      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ grace_ends_at: graceEndsAt, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.set_grace', summary: 'Set grace period', payload_json: JSON.stringify({ graceEndsAt }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-status', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const statusRaw = String(req.body?.status || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!statusRaw) return res.status(400).json({ error: 'status_required' });

      const norm = (() => {
        const s = statusRaw.toLowerCase().replace(/\s+/g, '_');
        if (s === 'active') return 'active';
        if (s === 'verification_needed' || s === 'pending_verify') return 'pending_verify';
        if (s === 'past_due') return 'past_due';
        if (s === 'canceled' || s === 'cancelled') return 'canceled';
        return '';
      })();
      if (!norm) return res.status(400).json({ error: 'invalid_status' });

      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ status: norm, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.set_status', summary: 'Set subscription status', payload_json: JSON.stringify({ status: norm }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-cycle', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const cycleRaw = String(req.body?.cycle || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!cycleRaw) return res.status(400).json({ error: 'cycle_required' });

      const cycle = cycleRaw.toLowerCase() === 'yearly' ? 'Yearly' : cycleRaw.toLowerCase() === 'monthly' ? 'Monthly' : '';
      if (!cycle) return res.status(400).json({ error: 'invalid_cycle' });

      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ cycle, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.set_cycle', summary: 'Set billing cycle', payload_json: JSON.stringify({ cycle }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-method', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const methodRaw = String(req.body?.method || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!methodRaw) return res.status(400).json({ error: 'method_required' });

      const method = methodRaw.toLowerCase();
      const ok = new Set(['cash', 'bank_transfer', 'bank transfer', 'manual']);
      if (!ok.has(method)) return res.status(400).json({ error: 'invalid_method' });
      const stored = method.replace(/\s+/g, '_');

      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ method: stored, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing.set_method', summary: 'Set billing method', payload_json: JSON.stringify({ method: stored }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/platform-settings', requireSuperadmin, async (_req, res, next) => {
    try {
      const row = await db().select(['settings_json']).from('platform_settings_admin').where({ id: 1 }).first();
      const settings = safeJsonParse(row?.settings_json, {});
      return res.json({ ok: true, settings });
    } catch (e) {
      return next(e);
    }
  });

  // Dunning schedule (platform-level reminders)
  r.get('/superadmin/dunning-steps', requireSuperadmin, async (_req, res, next) => {
    try {
      const rows = await db()
        .from('superadmin_dunning_steps')
        .select(['id', 'offset_days', 'title', 'body_template', 'channel', 'enabled', 'sort_order', 'created_at', 'updated_at'])
        .orderBy('sort_order', 'asc');
      const steps = rows.map((r) => ({
        id: String(r.id),
        offsetDays: Number(r.offset_days || 0),
        title: String(r.title || ''),
        bodyTemplate: r.body_template == null ? '' : String(r.body_template),
        channel: String(r.channel || 'email'),
        enabled: Boolean(r.enabled),
        sortOrder: Number(r.sort_order || 0),
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
      }));
      return res.json({ ok: true, steps });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/dunning-steps', requireSuperadmin, async (req, res, next) => {
    try {
      const offsetDays = Number(req.body?.offsetDays ?? 0);
      const title = String(req.body?.title || '').trim();
      const bodyTemplate = typeof req.body?.bodyTemplate === 'string' ? String(req.body.bodyTemplate) : '';
      const channel = String(req.body?.channel || 'email').trim() || 'email';
      const enabled = typeof req.body?.enabled === 'boolean' ? Boolean(req.body.enabled) : true;
      const sortOrder = Number(req.body?.sortOrder ?? 0);

      if (!Number.isFinite(offsetDays) || offsetDays < -365 || offsetDays > 365) return res.status(400).json({ error: 'offset_days_invalid' });
      if (!title) return res.status(400).json({ error: 'title_required' });
      if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 1000000) return res.status(400).json({ error: 'sort_order_invalid' });

      const id = makeId('dsn');
      const nowIso = new Date().toISOString();
      await db().from('superadmin_dunning_steps').insert({
        id,
        offset_days: offsetDays,
        title,
        body_template: bodyTemplate,
        channel,
        enabled,
        sort_order: sortOrder,
        created_at: nowIso,
        updated_at: nowIso,
      });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'dunning_step.create',
        summary: 'Created dunning step',
        payload_json: JSON.stringify({ id, offsetDays, title, channel, enabled, sortOrder }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/dunning-steps/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      const existing = await db().select(['id']).from('superadmin_dunning_steps').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.offsetDays !== 'undefined') {
        const offsetDays = Number(req.body.offsetDays);
        if (!Number.isFinite(offsetDays) || offsetDays < -365 || offsetDays > 365) return res.status(400).json({ error: 'offset_days_invalid' });
        patch.offset_days = offsetDays;
      }
      if (typeof req.body?.title === 'string') {
        const title = req.body.title.trim();
        if (!title) return res.status(400).json({ error: 'title_required' });
        patch.title = title;
      }
      if (typeof req.body?.bodyTemplate === 'string') patch.body_template = String(req.body.bodyTemplate);
      if (typeof req.body?.channel === 'string') patch.channel = String(req.body.channel).trim() || 'email';
      if (typeof req.body?.enabled === 'boolean') patch.enabled = Boolean(req.body.enabled);
      if (typeof req.body?.sortOrder !== 'undefined') {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 1000000) return res.status(400).json({ error: 'sort_order_invalid' });
        patch.sort_order = sortOrder;
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('superadmin_dunning_steps').where({ id }).update(patch);
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'dunning_step.update',
        summary: 'Updated dunning step',
        payload_json: JSON.stringify({ id, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/dunning-steps/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      await db().from('superadmin_dunning_steps').where({ id }).del();
      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'dunning_step.delete', summary: 'Deleted dunning step', payload_json: JSON.stringify({ id }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/platform-settings', requireSuperadmin, async (req, res, next) => {
    try {
      const settings = req.body && typeof req.body === 'object' ? req.body : {};
      const nowIso = new Date().toISOString();

      try {
        await db()
          .from('platform_settings_admin')
          .insert({ id: 1, settings_json: JSON.stringify(settings), updated_at: nowIso })
          .onConflict('id')
          .merge({ settings_json: JSON.stringify(settings), updated_at: nowIso });
      } catch (e) {
        try {
          if (req.log && typeof req.log.error === 'function') {
            req.log.error({ err: e }, 'Failed to save superadmin platform settings');
          }
        } catch {
          // ignore
        }

        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        if (code === 'ER_NO_SUCH_TABLE' || msg.toLowerCase().includes('platform_settings_admin')) {
          return res.status(500).json({
            error: 'db_schema_outdated',
            message: 'Missing required table platform_settings_admin. Run database migrations.',
          });
        }
        return next(e);
      }

      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'platform_settings.update', summary: 'Updated platform settings', payload_json: null, created_at: nowIso });
      return res.json({ ok: true, settings });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/system-health', requireSuperadmin, async (_req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const dayAgoIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

      // DB ping latency (real)
      let dbOk = true;
      let dbPingMs = 0;
      try {
        const t0 = Date.now();
        await db().raw('select 1 as ok');
        dbPingMs = Math.max(0, Date.now() - t0);
      } catch {
        dbOk = false;
        dbPingMs = 0;
      }

      // Sync latency: time since last sync event (real)
      const lastSyncRow = await db().select(['created_at']).from('sync_events').orderBy('created_at', 'desc').first();
      const lastSyncAt = toIso(lastSyncRow?.created_at);
      const syncLatencyMs = lastSyncAt ? Math.max(0, nowMs - new Date(lastSyncAt).getTime()) : 0;

      // Sync failures (real)
      const failedSyncsRow = await db()
        .count({ c: '*' })
        .from('sync_drafts')
        .whereIn('status', ['FAILED', 'ERROR'])
        .andWhere('updated_at', '>=', dayAgoIso)
        .first();
      const failedSyncs24h = Number(failedSyncsRow?.c ?? failedSyncsRow?.count ?? failedSyncsRow?.['count(*)'] ?? 0) || 0;

      const failureRows = await db()
        .select(['id', 'updated_at', 'status', 'draft_json'])
        .from('sync_drafts')
        .whereIn('status', ['FAILED', 'ERROR'])
        .andWhere('updated_at', '>=', dayAgoIso)
        .orderBy('updated_at', 'desc')
        .limit(15);

      const errorFeed = failureRows
        .map((x) => {
          const payload = safeJsonParse(x.draft_json, {});
          const msg = String(payload?.error || payload?.message || payload?.reason || '').trim();
          const type = String(payload?.type || payload?.event_type || '').trim();
          const id = String(x.id || '').trim();
          const status = String(x.status || '').trim();
          const message = msg || `${status || 'FAILED'}${type ? `: ${type}` : ''}${id ? ` (${id})` : ''}`;
          return { at: toIso(x.updated_at) || nowIso, level: 'error', message };
        })
        .filter((x) => x.at && x.message);

      // API uptime (real, process uptime)
      const apiUptimeSec = Number(process.uptime?.() || 0) || 0;
      const apiUptime30dPct = Math.max(0, Math.min(100, (apiUptimeSec / (30 * 24 * 60 * 60)) * 100));
      const apiOk = true;

      const syncOk = failedSyncs24h === 0;
      const allOperational = Boolean(apiOk && dbOk && syncOk);

      const apiRespMs = 1;
      const syncRespMs = Math.max(1, Math.round(syncLatencyMs));

      const resp = {
        ok: true,
        environment: process.env.NODE_ENV || 'development',
        allOperational,
        lastRefreshedAt: nowIso,
        kpis: {
          avgSyncLatencyMs: Math.round(syncLatencyMs),
          latencyTrendPct: 0,
          failedSyncs24h,
          failedSyncsDelta: 0,
          apiUptimePct: apiUptime30dPct,
          apiStatusLabel: allOperational ? 'Operational' : 'Degraded',
        },
        errorFeed,
        components: [
          { id: 'api', name: 'API Server', region: 'local', status: apiOk ? 'HEALTHY' : 'DOWN', responseTimeMs: apiRespMs, uptime30dPct: apiUptime30dPct, icon: 'cloud' },
          { id: 'db', name: 'MySQL', region: 'local', status: dbOk ? 'HEALTHY' : 'DOWN', responseTimeMs: dbPingMs, uptime30dPct: 100, icon: 'database' },
          { id: 'sync', name: 'Sync Pipeline', region: 'local', status: syncOk ? 'HEALTHY' : 'DEGRADED', responseTimeMs: syncRespMs, uptime30dPct: 100, icon: 'sync' },
        ],
      };

      return res.json(resp);
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/system-health/force-sync', requireSuperadmin, async (_req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'system_health.force_sync', summary: 'Force sync requested', payload_json: null, created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/support', requireSuperadmin, async (req, res, next) => {
    try {
      const rows = await db()
        .select([
          't.id',
          't.tenant_id',
          't.subject',
          't.severity',
          't.status',
          't.created_at',
          'ten.name as tenant_name',
        ])
        .from({ t: 'support_tickets' })
        .leftJoin({ ten: 'tenants' }, 'ten.id', 't.tenant_id')
        .orderBy('t.created_at', 'desc')
        .limit(250);

      const tickets = rows.map((x) => {
        const { remainingSec, breached } = calcSlaRemaining(x.created_at, x.severity);
        return {
          id: String(x.id),
          severity: String(x.severity || 'medium'),
          subject: String(x.subject || ''),
          status: String(x.status || 'open'),
          tenantId: String(x.tenant_id || ''),
          createdAt: toIso(x.created_at),
          slaRemainingSec: remainingSec,
          slaBreached: breached,
          clientName: String(x.tenant_name || x.tenant_id || ''),
        };
      });

      const totalOpen = tickets.filter((t) => String(t.status).toLowerCase() !== 'closed').length;
      const slaBreaches = tickets.filter((t) => t.slaBreached).length;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayVolume = tickets.filter((t) => {
        const ms = new Date(t.createdAt).getTime();
        return Number.isFinite(ms) && ms >= todayStart.getTime();
      }).length;

      // avgResponseMin: compute avg minutes until first reply (best-effort)
      let avgResponseMin = 0;
      try {
        const ticketIds = rows.map((x) => String(x.id)).filter(Boolean);
        if (ticketIds.length > 0) {
          const firstReplies = await db()
            .select(['ticket_id'])
            .min({ first_reply_at: 'created_at' })
            .from('support_ticket_replies')
            .whereIn('ticket_id', ticketIds)
            .groupBy('ticket_id');

          const firstReplyByTicket = new Map(firstReplies.map((r0) => [String(r0.ticket_id), toIso(r0.first_reply_at)]));
          const mins = rows
            .map((t0) => {
              const createdAt = toIso(t0.created_at);
              const firstAt = firstReplyByTicket.get(String(t0.id));
              if (!createdAt || !firstAt) return null;
              const a = new Date(createdAt).getTime();
              const b = new Date(firstAt).getTime();
              if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
              return (b - a) / 60000;
            })
            .filter((x) => typeof x === 'number' && Number.isFinite(x));

          avgResponseMin = mins.length ? Math.round(mins.reduce((sum, x) => sum + x, 0) / mins.length) : 0;
        }
      } catch {
        avgResponseMin = 0;
      }

      return res.json({
        ok: true,
        stats: { totalOpen, slaBreaches, avgResponseMin, todayVolume },
        tickets,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/support/tickets/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const ticketId = String(req.params?.id || '').trim();
      if (!ticketId) return res.status(400).json({ error: 'ticket_required' });

      const t = await db().select(['id', 'tenant_id', 'subject', 'severity', 'status', 'reported_by_role', 'description', 'created_at', 'updated_at']).from('support_tickets').where({ id: ticketId }).first();
      if (!t) return res.status(404).json({ error: 'not_found' });

      const ten = await db().select(['name']).from('tenants').where({ id: t.tenant_id }).first();
      const tier = await getTenantTier(String(t.tenant_id));

      const replies = await db().select(['id', 'staff_id', 'message', 'created_at']).from('support_ticket_replies').where({ ticket_id: ticketId }).orderBy('created_at', 'asc');

      const activity = [
        {
          id: makeId('act'),
          by: String(t.reported_by_role || 'client'),
          at: toIso(t.created_at),
          message: String(t.description || ''),
        },
        ...replies.map((r0) => ({
          id: String(r0.id),
          by: r0.staff_id ? `staff:${String(r0.staff_id)}` : 'superadmin',
          at: toIso(r0.created_at),
          message: String(r0.message || ''),
        })),
      ];

      const name = String(ten?.name || t.tenant_id || 'Client');
      const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => x[0].toUpperCase())
        .join('')
        .slice(0, 2);

      const ticket = {
        id: String(t.id),
        tenantId: String(t.tenant_id),
        severity: String(t.severity || 'medium'),
        subject: String(t.subject || ''),
        status: String(t.status || 'open'),
        reportedByRole: String(t.reported_by_role || 'client'),
        description: String(t.description || ''),
        createdAt: toIso(t.created_at),
        updatedAt: toIso(t.updated_at),
        client: {
          name,
          tier,
          initials: initials || 'CL',
          ltvEtb: 0,
          healthPct: 92,
        },
        activity,
      };

      return res.json({ ok: true, ticket });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/reply', requireSuperadmin, async (req, res, next) => {
    try {
      const ticketId = String(req.params?.id || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!ticketId) return res.status(400).json({ error: 'ticket_required' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const t = await db().select(['id', 'tenant_id']).from('support_tickets').where({ id: ticketId }).first();
      if (!t) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      await db().from('support_ticket_replies').insert({ id: makeId('spr'), ticket_id: ticketId, tenant_id: String(t.tenant_id), staff_id: null, message, created_at: nowIso });
      await db().from('support_tickets').where({ id: ticketId }).update({ updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: String(t.tenant_id), branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'support.reply', summary: 'Replied to support ticket', payload_json: JSON.stringify({ ticketId }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/status', requireSuperadmin, async (req, res, next) => {
    try {
      const ticketId = String(req.params?.id || '').trim();
      const statusRaw = String(req.body?.status || '').trim();
      if (!ticketId) return res.status(400).json({ error: 'ticket_required' });
      if (!statusRaw) return res.status(400).json({ error: 'status_required' });

      const norm = (() => {
        const s = statusRaw.toLowerCase().replace(/\s+/g, '_');
        if (s === 'open') return 'open';
        if (s === 'in_progress' || s === 'inprogress') return 'in_progress';
        if (s === 'waiting_client' || s === 'waiting_on_client' || s === 'waiting') return 'waiting_client';
        if (s === 'closed' || s === 'resolved') return 'closed';
        return '';
      })();
      if (!norm) return res.status(400).json({ error: 'invalid_status' });

      const t = await db().select(['id', 'tenant_id']).from('support_tickets').where({ id: ticketId }).first();
      if (!t) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      await db().from('support_tickets').where({ id: ticketId }).update({ status: norm, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: String(t.tenant_id), branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'support.set_status', summary: 'Updated support ticket status', payload_json: JSON.stringify({ ticketId, status: norm }), created_at: nowIso });
      return res.json({ ok: true, status: norm });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/audit', requireSuperadmin, async (req, res, next) => {
    try {
      const page = clampInt(req.query?.page, 1, 1, 1000000);
      const pageSize = clampInt(req.query?.pageSize, 25, 1, 200);
      const q = String(req.query?.q || '').trim().toLowerCase();

      let base = db().from('audit_log');
      if (q) {
        base = base.where((qb) => {
          qb.whereRaw('LOWER(type) LIKE ?', [`%${q}%`])
            .orWhereRaw('LOWER(COALESCE(summary, "")) LIKE ?', [`%${q}%`])
            .orWhereRaw('LOWER(COALESCE(tenant_id, "")) LIKE ?', [`%${q}%`])
            .orWhereRaw('LOWER(COALESCE(actor_role, "")) LIKE ?', [`%${q}%`]);
        });
      }

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base
        .clone()
        .select(['id', 'created_at', 'type', 'actor_role', 'tenant_id', 'summary', 'payload_json'])
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const total24hRow = await db().from('audit_log').where('created_at', '>=', sinceIso).count({ c: '*' }).first();
      const total24h = Number(total24hRow?.c ?? total24hRow?.count ?? total24hRow?.['count(*)'] ?? 0) || 0;
      const critical24hRow = await db()
        .from('audit_log')
        .where('created_at', '>=', sinceIso)
        .andWhere((qb) => qb.where('type', 'like', '%billing%').orWhere('type', 'like', '%suspend%').orWhere('type', 'like', '%verify%'))
        .count({ c: '*' })
        .first();
      const critical24h = Number(critical24hRow?.c ?? critical24hRow?.count ?? critical24hRow?.['count(*)'] ?? 0) || 0;

      const events = rows.map((x) => {
        const payload = safeJsonParse(x.payload_json, null);
        const details = x.summary ? String(x.summary) : payload ? truncate(JSON.stringify(payload), 200) : '';
        return {
          id: String(x.id),
          at: toIso(x.created_at),
          type: String(x.type || ''),
          actor: String(x.actor_role || 'system'),
          target: String(x.tenant_id || ''),
          details,
          sourceIp: '',
        };
      });

      return res.json({
        ok: true,
        page,
        pageSize,
        total,
        stats: { total24h, critical24h, activeAdminSessions: 0 },
        events,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/feature-flags', requireSuperadmin, async (req, res, next) => {
    try {
      const page = clampInt(req.query?.page, 1, 1, 1000000);
      const pageSize = clampInt(req.query?.pageSize, 10, 1, 200);
      const q = String(req.query?.q || '').trim().toLowerCase();
      const plan = String(req.query?.plan || '').trim();
      const risk = String(req.query?.risk || '').trim();

      let base = db().from('feature_flags');
      if (q) {
        base = base.where((qb) => {
          qb.whereRaw('LOWER(id) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]);
        });
      }
      if (plan) base = base.andWhere('plan', plan);
      if (risk) base = base.andWhere('risk', risk);

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base
        .clone()
        .select(['id', 'name', 'plan', 'risk', 'enabled', 'updated_at', 'meta_json'])
        .orderBy('updated_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const allRows = await db().select(['risk', 'enabled', 'plan']).from('feature_flags');
      const stats = {
        totalFlags: allRows.length,
        activeGlobally: allRows.filter((x) => x.enabled === 1 || x.enabled === true).length,
        highRisk: allRows.filter((x) => String(x.risk || '').toLowerCase() === 'high' || String(x.risk || '').toLowerCase() === 'critical').length,
        betaFeatures: allRows.filter((x) => String(x.plan || '').toLowerCase().includes('beta')).length,
      };

      const flags = rows.map((x) => {
        const meta = safeJsonParse(x.meta_json, {});
        return {
          id: String(x.id),
          name: String(x.name || ''),
          plan: String(x.plan || 'All Plans'),
          risk: String(x.risk || 'Low'),
          enabled: Boolean(x.enabled),
          updatedAt: toIso(x.updated_at),
          updatedBy: String(meta?.updatedBy || 'superadmin'),
        };
      });

      return res.json({ ok: true, page, pageSize, total, stats, flags });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/feature-flags', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.body?.id || '').trim();
      const name = String(req.body?.name || '').trim();
      const plan = String(req.body?.plan || 'All Plans').trim();
      const risk = String(req.body?.risk || 'Low').trim();
      const enabled = Boolean(req.body?.enabled);
      if (!id) return res.status(400).json({ error: 'id_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });
      const nowIso = new Date().toISOString();
      await db().from('feature_flags').insert({ id, name, plan, risk, enabled, meta_json: JSON.stringify({ updatedBy: 'superadmin' }), updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'feature_flag.create', summary: `Created flag ${id}`, payload_json: null, created_at: nowIso });
      return res.status(201).json({ ok: true });
    } catch (e) {
      if (String(e?.code || '') === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'duplicate' });
      return next(e);
    }
  });

  r.put('/superadmin/feature-flags/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      const existing = await db().select(['id', 'meta_json']).from('feature_flags').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.plan === 'string') patch.plan = req.body.plan.trim();
      if (typeof req.body?.risk === 'string') patch.risk = req.body.risk.trim();
      if (typeof req.body?.enabled === 'boolean') patch.enabled = Boolean(req.body.enabled);

      const nowIso = new Date().toISOString();
      const oldMeta = safeJsonParse(existing?.meta_json, {});
      patch.meta_json = JSON.stringify({ ...(oldMeta && typeof oldMeta === 'object' ? oldMeta : {}), updatedBy: 'superadmin' });
      patch.updated_at = nowIso;
      await db().from('feature_flags').where({ id }).update(patch);
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'feature_flag.update', summary: `Updated flag ${id}`, payload_json: null, created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Get platform payment configuration
  r.get('/superadmin/payment-config', requireSuperadmin, async (req, res, next) => {
    try {
      const mask = (s) => (s && s.length > 4 ? `${s.slice(0, 4)}******` : '');

      const config = await db()
        .select(['*'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

      if (!config) {
        return res.json({
          ok: true,
          config: {
            bankDetails: {
              bankName: '',
              accountNumber: '',
              accountName: '',
              instructions: '',
              manualEnabled: true,
              requireImageUpload: true,
              autoGrantGracePeriod: true,
            },
            chapa: { enabled: false, publicKey: '', secretKey: '', webhookSecret: '', encryptionKey: '' },
            telebirr: { enabled: false, appId: '', appKey: '', shortCode: '', baseUrl: '', fabricAppId: '', appSecret: '', merchantAppId: '', merchantCode: '', privateKey: '' },
            cbeBirr: { enabled: false, merchantId: '', apiKey: '' },
            sms: { enabled: false, provider: 'africas_talking', apiKey: '', senderId: '' },
            settings: { environment: 'production', gracePeriodDays: 3, reportRetentionDays: 365, vatEnabled: true, starterPriceEtb: 500, growthPriceEtb: 1500 },
          },
        });
      }

      // Parse JSONs and mask secrets
      const bankDetails = safeJsonParse(config.bank_details_json, {});
      const chapa = safeJsonParse(config.chapa_config_json, {});

      // Override Chapa with Env
      if (process.env.CHAPA_SECRET_KEY) chapa.secretKey = process.env.CHAPA_SECRET_KEY;
      if (process.env.CHAPA_WEBHOOK_SECRET) chapa.webhookSecret = process.env.CHAPA_WEBHOOK_SECRET;
      if (process.env.CHAPA_PUBLIC_KEY) chapa.publicKey = process.env.CHAPA_PUBLIC_KEY;
      if (process.env.CHAPA_ENCRYPTION_KEY) chapa.encryptionKey = process.env.CHAPA_ENCRYPTION_KEY;
      if (process.env.CHAPA_ENABLED) chapa.enabled = process.env.CHAPA_ENABLED === 'true';

      const telebirr = safeJsonParse(config.telebirr_config_json, {});
      const cbeBirr = safeJsonParse(config.cbe_birr_config_json, {});
      const sms = safeJsonParse(config.sms_config_json, {});

      const environment = String(bankDetails?.environment || 'production').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
      const vatEnabled = bankDetails?.vatEnabled !== false;
      const starterPriceEtb = Number.isFinite(Number(bankDetails?.starterPriceEtb)) ? Number(bankDetails.starterPriceEtb) : 500;
      const growthPriceEtb = Number.isFinite(Number(bankDetails?.growthPriceEtb)) ? Number(bankDetails.growthPriceEtb) : 1500;

      return res.json({
        ok: true,
        config: {
          bankDetails: {
            ...(bankDetails && typeof bankDetails === 'object' ? bankDetails : {}),
            bankName: bankDetails.bankName || '',
            accountNumber: bankDetails.accountNumber || '',
            accountName: bankDetails.accountName || '',
            instructions: bankDetails.instructions || '',
            manualEnabled: bankDetails.manualEnabled !== false,
            requireImageUpload: bankDetails.requireImageUpload !== false,
            autoGrantGracePeriod: bankDetails.autoGrantGracePeriod !== false,
          },
          chapa: {
            enabled: !!chapa.enabled,
            publicKey: chapa.publicKey || '',
            encryptionKey: mask(chapa.encryptionKey),
            secretKey: mask(chapa.secretKey),
            webhookSecret: mask(chapa.webhookSecret),
          },
          telebirr: {
            enabled: !!telebirr.enabled,
            appId: telebirr.appId || '',
            appKey: mask(telebirr.appKey),
            shortCode: telebirr.shortCode || '',
            baseUrl: process.env.TELEBIRR_BASE_URL || telebirr.baseUrl || '',
            fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID || telebirr.fabricAppId || '',
            appSecret: mask(process.env.TELEBIRR_APP_SECRET || telebirr.appSecret),
            merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID || telebirr.merchantAppId || '',
            merchantCode: process.env.TELEBIRR_MERCHANT_CODE || telebirr.merchantCode || '',
            privateKey: mask(process.env.TELEBIRR_PRIVATE_KEY || telebirr.privateKey),
          },
          cbeBirr: {
            enabled: !!cbeBirr.enabled,
            merchantId: cbeBirr.merchantId || '',
            apiKey: mask(cbeBirr.apiKey),
          },
          sms: {
            enabled: !!sms.enabled,
            provider: sms.provider || 'africas_talking',
            apiKey: mask(sms.apiKey),
            senderId: sms.senderId || '',
          },
          settings: {
            environment,
            gracePeriodDays: Number(config.default_grace_days || 3),
            reportRetentionDays: Number(config.report_retention_days || 365),
            vatEnabled,
            starterPriceEtb,
            growthPriceEtb,
          },
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  // Update platform payment configuration
  r.put('/superadmin/payment-config', requireSuperadmin, async (req, res, next) => {
    try {
      const { bankDetails, chapa, telebirr, cbeBirr, sms, settings } = req.body || {};

      const nowIso = new Date().toISOString();
      const existing = await db().select(['*']).from('platform_payment_config').where({ id: 1 }).first();

      const oldChapa = safeJsonParse(existing?.chapa_config_json, {});
      const oldTelebirr = safeJsonParse(existing?.telebirr_config_json, {});
      const oldCbe = safeJsonParse(existing?.cbe_birr_config_json, {});
      const oldSms = safeJsonParse(existing?.sms_config_json, {});
      const oldBank = safeJsonParse(existing?.bank_details_json, {});

      const updateSecret = (newVal, oldVal) => {
        if (newVal === undefined) return oldVal;
        if (newVal === '' || String(newVal).includes('******')) return oldVal;
        return newVal;
      };

      // Chapa secrets stored in env
      if (chapa?.secretKey && !String(chapa.secretKey).includes('******')) updateEnv('CHAPA_SECRET_KEY', chapa.secretKey);
      if (chapa?.webhookSecret && !String(chapa.webhookSecret).includes('******')) updateEnv('CHAPA_WEBHOOK_SECRET', chapa.webhookSecret);
      if (chapa?.publicKey && !String(chapa.publicKey).includes('******')) updateEnv('CHAPA_PUBLIC_KEY', chapa.publicKey);
      if (chapa?.encryptionKey && !String(chapa.encryptionKey).includes('******')) updateEnv('CHAPA_ENCRYPTION_KEY', chapa.encryptionKey);
      if (chapa?.enabled !== undefined) updateEnv('CHAPA_ENABLED', String(Boolean(chapa.enabled)));

      const newChapa = {
        enabled: Boolean(chapa?.enabled),
        publicKey: chapa?.publicKey !== undefined ? chapa.publicKey : oldChapa.publicKey,
        encryptionKey: updateSecret(chapa?.encryptionKey, oldChapa.encryptionKey),
        secretKey: updateSecret(chapa?.secretKey, oldChapa.secretKey),
        webhookSecret: updateSecret(chapa?.webhookSecret, oldChapa.webhookSecret),
      };

      const newTelebirr = {
        enabled: Boolean(telebirr?.enabled),
        appId: telebirr?.appId !== undefined ? telebirr.appId : oldTelebirr.appId,
        appKey: updateSecret(telebirr?.appKey, oldTelebirr.appKey),
        shortCode: telebirr?.shortCode !== undefined ? telebirr.shortCode : oldTelebirr.shortCode,
        baseUrl: telebirr?.baseUrl !== undefined ? telebirr.baseUrl : oldTelebirr.baseUrl,
        fabricAppId: telebirr?.fabricAppId !== undefined ? telebirr.fabricAppId : oldTelebirr.fabricAppId,
        appSecret: updateSecret(telebirr?.appSecret, oldTelebirr.appSecret),
        merchantAppId: telebirr?.merchantAppId !== undefined ? telebirr.merchantAppId : oldTelebirr.merchantAppId,
        merchantCode: telebirr?.merchantCode !== undefined ? telebirr.merchantCode : oldTelebirr.merchantCode,
        privateKey: updateSecret(telebirr?.privateKey, oldTelebirr.privateKey),
      };

      // Telebirr secrets to env
      if (telebirr?.fabricAppId && !String(telebirr.fabricAppId).includes('******')) updateEnv('TELEBIRR_FABRIC_APP_ID', telebirr.fabricAppId);
      if (telebirr?.appSecret && !String(telebirr.appSecret).includes('******')) updateEnv('TELEBIRR_APP_SECRET', telebirr.appSecret);
      if (telebirr?.merchantAppId && !String(telebirr.merchantAppId).includes('******')) updateEnv('TELEBIRR_MERCHANT_APP_ID', telebirr.merchantAppId);
      if (telebirr?.merchantCode && !String(telebirr.merchantCode).includes('******')) updateEnv('TELEBIRR_MERCHANT_CODE', telebirr.merchantCode);
      if (telebirr?.baseUrl && !String(telebirr.baseUrl).includes('******')) updateEnv('TELEBIRR_BASE_URL', telebirr.baseUrl);
      if (telebirr?.privateKey && !String(telebirr.privateKey).includes('******')) updateEnv('TELEBIRR_PRIVATE_KEY', telebirr.privateKey);
      if (telebirr?.enabled !== undefined) updateEnv('TELEBIRR_ENABLED', String(Boolean(telebirr.enabled)));

      const newCbe = {
        enabled: Boolean(cbeBirr?.enabled),
        merchantId: cbeBirr?.merchantId !== undefined ? cbeBirr.merchantId : oldCbe.merchantId,
        apiKey: updateSecret(cbeBirr?.apiKey, oldCbe.apiKey),
      };

      const newSms = {
        enabled: Boolean(sms?.enabled),
        provider: sms?.provider !== undefined ? sms.provider : oldSms.provider,
        apiKey: updateSecret(sms?.apiKey, oldSms.apiKey),
        senderId: sms?.senderId !== undefined ? sms.senderId : oldSms.senderId,
      };

      const nextBankDetails = {
        ...(oldBank && typeof oldBank === 'object' ? oldBank : {}),
        ...(bankDetails && typeof bankDetails === 'object' ? bankDetails : {}),
        environment: String(settings?.environment || oldBank?.environment || 'production').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
        vatEnabled: settings?.vatEnabled !== undefined ? Boolean(settings.vatEnabled) : oldBank?.vatEnabled !== false,
        starterPriceEtb: Number.isFinite(Number(settings?.starterPriceEtb)) ? Number(settings.starterPriceEtb) : Number.isFinite(Number(oldBank?.starterPriceEtb)) ? Number(oldBank.starterPriceEtb) : 500,
        growthPriceEtb: Number.isFinite(Number(settings?.growthPriceEtb)) ? Number(settings.growthPriceEtb) : Number.isFinite(Number(oldBank?.growthPriceEtb)) ? Number(oldBank.growthPriceEtb) : 1500,
      };

      const data = {
        id: 1,
        bank_details_json: JSON.stringify(nextBankDetails || {}),
        chapa_config_json: JSON.stringify({ ...(oldChapa && typeof oldChapa === 'object' ? oldChapa : {}), ...newChapa }),
        telebirr_config_json: JSON.stringify(newTelebirr),
        cbe_birr_config_json: JSON.stringify(newCbe),
        sms_config_json: JSON.stringify(newSms),
        default_grace_days: Number(settings?.gracePeriodDays || 3),
        report_retention_days: Number(settings?.reportRetentionDays || 365),
        updated_at: nowIso,
      };

      try {
        await db().from('platform_payment_config').insert(data).onConflict('id').merge(data);
      } catch (e) {
        try {
          if (req.log && typeof req.log.error === 'function') {
            req.log.error({ err: e }, 'Failed to save superadmin payment config');
          }
        } catch {
          // ignore
        }

        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        if (code === 'ER_NO_SUCH_TABLE' || msg.toLowerCase().includes('platform_payment_config')) {
          return res.status(500).json({
            error: 'db_schema_outdated',
            message: 'Missing required table platform_payment_config. Run database migrations.',
          });
        }
        return next(e);
      }

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'payment_config.update',
        summary: 'Updated platform payment configuration',
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // ===========================================================================
  // BILLING POLICY (Option B clean DB)
  // ===========================================================================

  r.get('/superadmin/billing-policy', requireSuperadmin, async (req, res, next) => {
    try {
      const row = await db().select(['*']).from('superadmin_billing_policy').where({ id: 1 }).first();
      if (!row) {
        return res.json({
          ok: true,
          policy: {
            autoRenewDefault: true,
            prorationOnUpgrade: true,
            billingCycleAnchor: 'signup_date',
            currencyDefault: 'ETB',
            autoSuspensionTrigger: true,
            updatedAt: '',
          },
        });
      }
      return res.json({
        ok: true,
        policy: {
          autoRenewDefault: Boolean(row.auto_renew_default),
          prorationOnUpgrade: Boolean(row.proration_on_upgrade),
          billingCycleAnchor: String(row.billing_cycle_anchor || 'signup_date'),
          currencyDefault: String(row.currency_default || 'ETB'),
          autoSuspensionTrigger: Boolean(row.auto_suspension_trigger),
          updatedAt: toIso(row.updated_at),
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/billing-policy', requireSuperadmin, async (req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      const patch = {
        auto_renew_default: typeof req.body?.autoRenewDefault === 'boolean' ? Boolean(req.body.autoRenewDefault) : true,
        proration_on_upgrade: typeof req.body?.prorationOnUpgrade === 'boolean' ? Boolean(req.body.prorationOnUpgrade) : true,
        billing_cycle_anchor: String(req.body?.billingCycleAnchor || 'signup_date') === 'first_of_month' ? 'first_of_month' : 'signup_date',
        currency_default: String(req.body?.currencyDefault || 'ETB') === 'USD' ? 'USD' : 'ETB',
        auto_suspension_trigger: typeof req.body?.autoSuspensionTrigger === 'boolean' ? Boolean(req.body.autoSuspensionTrigger) : true,
        updated_at: nowIso,
      };
      await db()
        .from('superadmin_billing_policy')
        .insert({ id: 1, ...patch })
        .onConflict('id')
        .merge(patch);
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'billing_policy.update', summary: 'Updated billing policy', payload_json: JSON.stringify({ patch }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Offline payment destinations
  r.get('/superadmin/offline-accounts', requireSuperadmin, async (req, res, next) => {
    try {
      const rows = await db()
        .from('superadmin_offline_accounts')
        .select(['id', 'bank_name', 'account_number', 'account_holder', 'active', 'created_at', 'updated_at'])
        .orderBy('created_at', 'asc');
      const accounts = rows.map((r) => ({
        id: String(r.id),
        bankName: String(r.bank_name || ''),
        accountNumber: String(r.account_number || ''),
        accountHolder: String(r.account_holder || ''),
        active: Boolean(r.active),
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
      }));
      return res.json({ ok: true, accounts });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/offline-accounts', requireSuperadmin, async (req, res, next) => {
    try {
      const bankName = String(req.body?.bankName || '').trim();
      const accountNumber = String(req.body?.accountNumber || '').trim();
      const accountHolder = String(req.body?.accountHolder || '').trim();
      const active = typeof req.body?.active === 'boolean' ? Boolean(req.body.active) : true;
      if (!bankName) return res.status(400).json({ error: 'bank_name_required' });
      if (!accountNumber) return res.status(400).json({ error: 'account_number_required' });
      if (!accountHolder) return res.status(400).json({ error: 'account_holder_required' });
      const nowIso = new Date().toISOString();
      const id = makeId('offacc');
      await db().from('superadmin_offline_accounts').insert({ id, bank_name: bankName, account_number: accountNumber, account_holder: accountHolder, active, created_at: nowIso, updated_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'offline_account.create', summary: 'Created offline payment destination', payload_json: JSON.stringify({ id }), created_at: nowIso });
      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/offline-accounts/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      const existing = await db().select(['id']).from('superadmin_offline_accounts').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.bankName === 'string') patch.bank_name = req.body.bankName.trim();
      if (typeof req.body?.accountNumber === 'string') patch.account_number = req.body.accountNumber.trim();
      if (typeof req.body?.accountHolder === 'string') patch.account_holder = req.body.accountHolder.trim();
      if (typeof req.body?.active === 'boolean') patch.active = Boolean(req.body.active);
      patch.updated_at = new Date().toISOString();
      await db().from('superadmin_offline_accounts').where({ id }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/offline-accounts/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });
      await db().from('superadmin_offline_accounts').where({ id }).del();
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // ===========================================================================
  // TAX RULES (Option B clean DB)
  // ===========================================================================

  const readCategoriesForRule = async (taxCode) => {
    const rows = await db()
      .from('tax_rule_category_map')
      .leftJoin('tax_rule_categories', 'tax_rule_category_map.category_id', 'tax_rule_categories.id')
      .where({ tax_code: taxCode })
      .select(['tax_rule_categories.name']);
    return rows.map((r) => String(r.name || '')).filter(Boolean);
  };

  const upsertCategoriesAndMap = async (trx, taxCode, categories) => {
    const cats = Array.isArray(categories) ? categories.map((x) => String(x).trim()).filter(Boolean) : [];
    const unique = Array.from(new Set(cats));

    await trx.from('tax_rule_category_map').where({ tax_code: taxCode }).del();
    if (!unique.length) return;

    const nowIso = new Date().toISOString();
    const ids = [];
    for (const name of unique) {
      const existing = await trx.select(['id']).from('tax_rule_categories').where({ name }).first();
      let id = existing?.id;
      if (!id) {
        id = makeId('tcat');
        await trx.from('tax_rule_categories').insert({ id, name, created_at: nowIso });
      }
      ids.push(String(id));
    }
    const rows = ids.map((category_id) => ({ tax_code: taxCode, category_id }));
    await trx.from('tax_rule_category_map').insert(rows);
  };

  r.get('/superadmin/tax-rules', requireSuperadmin, async (req, res, next) => {
    try {
      const rows = await db().from('tax_rules').select(['code', 'name', 'rate_pct', 'logic', 'status', 'effective_date', 'updated_at']).orderBy('updated_at', 'desc');
      const rules = [];
      for (const r of rows) {
        const code = String(r.code);
        const categories = await readCategoriesForRule(code);
        rules.push({
          code,
          name: String(r.name || ''),
          ratePct: Number(r.rate_pct || 0),
          logic: String(r.logic || 'exclusive'),
          status: String(r.status || 'active'),
          effectiveDate: toIso(r.effective_date),
          applicabilityCategories: categories,
          updatedAt: toIso(r.updated_at),
        });
      }
      return res.json({ ok: true, rules });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tax-rules', requireSuperadmin, async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim();
      const name = String(req.body?.name || '').trim();
      const ratePct = Number(req.body?.ratePct || 0);
      const logic = String(req.body?.logic || 'exclusive') === 'inclusive' ? 'inclusive' : 'exclusive';
      const status = ['active', 'suspended', 'archived'].includes(String(req.body?.status || 'active')) ? String(req.body.status) : 'active';
      const effectiveDate = String(req.body?.effectiveDate || '').slice(0, 10);
      const applicabilityCategories = req.body?.applicabilityCategories;
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!Number.isFinite(ratePct)) return res.status(400).json({ error: 'rate_invalid' });
      if (!effectiveDate) return res.status(400).json({ error: 'effective_date_required' });
      const nowIso = new Date().toISOString();

      await db().transaction(async (trx) => {
        await trx.from('tax_rules').insert({ code, name, rate_pct: ratePct, logic, status, effective_date: effectiveDate, updated_at: nowIso });
        await upsertCategoriesAndMap(trx, code, applicabilityCategories);
      });
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'tax_rule.create',
        summary: 'Created tax rule',
        payload_json: JSON.stringify({ code }),
        created_at: nowIso,
      });
      return res.status(201).json({ ok: true });
    } catch (e) {
      if (String(e?.code || '') === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'duplicate' });
      return next(e);
    }
  });

  r.put('/superadmin/tax-rules/:code', requireSuperadmin, async (req, res, next) => {
    try {
      const code = String(req.params?.code || '').trim();
      if (!code) return res.status(400).json({ error: 'code_required' });
      const existing = await db().select(['code']).from('tax_rules').where({ code }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.ratePct !== 'undefined') patch.rate_pct = Number(req.body.ratePct || 0);
      if (typeof req.body?.logic === 'string') patch.logic = req.body.logic === 'inclusive' ? 'inclusive' : 'exclusive';
      if (typeof req.body?.status === 'string' && ['active', 'suspended', 'archived'].includes(req.body.status)) patch.status = req.body.status;
      if (typeof req.body?.effectiveDate === 'string' && req.body.effectiveDate) patch.effective_date = req.body.effectiveDate.slice(0, 10);
      const categories = req.body?.applicabilityCategories;

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;

      await db().transaction(async (trx) => {
        await trx.from('tax_rules').where({ code }).update(patch);
        if (typeof categories !== 'undefined') await upsertCategoriesAndMap(trx, code, categories);
      });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'tax_rule.update',
        summary: 'Updated tax rule',
        payload_json: JSON.stringify({ code, patch: { ...patch, applicabilityCategories: typeof categories === 'undefined' ? undefined : categories } }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tax-categories', requireSuperadmin, async (req, res, next) => {
    try {
      const rows = await db().from('tax_rule_categories').select(['id', 'name', 'created_at']).orderBy('name', 'asc');
      const categories = rows.map((r) => ({ id: String(r.id), name: String(r.name || ''), createdAt: toIso(r.created_at) }));
      return res.json({ ok: true, categories });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tax-categories', requireSuperadmin, async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      const existing = await db().select(['id']).from('tax_rule_categories').where({ name }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });
      const nowIso = new Date().toISOString();
      const id = makeId('tcat');
      await db().from('tax_rule_categories').insert({ id, name, created_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tax_category.create', summary: 'Created tax category', payload_json: JSON.stringify({ id, name }), created_at: nowIso });
      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/tax-categories/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const inUseRow = await db().from('tax_rule_category_map').where({ category_id: id }).count({ c: '*' }).first();
      const inUse = Number(inUseRow?.c ?? inUseRow?.count ?? inUseRow?.['count(*)'] ?? 0) || 0;
      if (inUse > 0) return res.status(409).json({ error: 'category_in_use' });

      const nowIso = new Date().toISOString();
      await db().from('tax_rule_categories').where({ id }).del();
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tax_category.delete', summary: 'Deleted tax category', payload_json: JSON.stringify({ id }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tax-categories/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'name']).from('tax_rule_categories').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });

      const dup = await db().select(['id']).from('tax_rule_categories').where({ name }).andWhereNot({ id }).first();
      if (dup) return res.status(409).json({ error: 'duplicate' });

      await db().from('tax_rule_categories').where({ id }).update({ name });
      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'tax_category.update',
        summary: 'Updated tax category',
        payload_json: JSON.stringify({ id, from: String(existing.name || ''), to: name }),
        created_at: nowIso,
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Export tax reporting CSV (rules + categories mapping)
  r.get('/superadmin/tax-reporting/export.csv', requireSuperadmin, async (_req, res, next) => {
    try {
      const rules = await db().from('tax_rules').select(['code', 'name', 'rate_pct', 'logic', 'status', 'effective_date', 'updated_at']).orderBy('updated_at', 'desc');
      const mappings = await db()
        .from('tax_rule_category_map')
        .leftJoin('tax_rule_categories', 'tax_rule_category_map.category_id', 'tax_rule_categories.id')
        .select(['tax_rule_category_map.tax_code as tax_code', 'tax_rule_categories.name as category_name']);

      const mapByCode = new Map();
      for (const m of mappings) {
        const code = String(m.tax_code || '');
        const name = String(m.category_name || '');
        if (!code) continue;
        const arr = mapByCode.get(code) || [];
        if (name) arr.push(name);
        mapByCode.set(code, arr);
      }

      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[\n\r,\"]/g.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
      };

      const lines = [];
      lines.push(['rule_code', 'rule_name', 'rate_pct', 'logic', 'status', 'effective_date', 'category'].map(esc).join(','));
      for (const r of rules) {
        const code = String(r.code || '');
        const categories = mapByCode.get(code) || [''];
        const base = [
          code,
          String(r.name || ''),
          Number(r.rate_pct || 0),
          String(r.logic || ''),
          String(r.status || ''),
          toIso(r.effective_date),
        ];
        for (const cat of categories.length ? categories : ['']) {
          lines.push([...base, String(cat || '')].map(esc).join(','));
        }
      }

      const out = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tax-reporting.csv"');
      return res.status(200).send(out);
    } catch (e) {
      return next(e);
    }
  });

  // ===========================================================================
  // TAX SYSTEM STATUS (Option B clean DB)
  // ===========================================================================

  r.get('/superadmin/tax-status', requireSuperadmin, async (req, res, next) => {
    try {
      const row = await db().from('tax_system_status').select(['*']).where({ id: 1 }).first();
      if (!row) {
        return res.json({ ok: true, status: { fiscalPrinterStatus: null, fiscalSignatureOk: null, lastErcaSyncAt: null, nextErcaSyncAt: null, updatedAt: '' } });
      }
      return res.json({
        ok: true,
        status: {
          fiscalPrinterStatus: row.fiscal_printer_status ? String(row.fiscal_printer_status) : null,
          fiscalSignatureOk: typeof row.fiscal_signature_ok === 'boolean' ? Boolean(row.fiscal_signature_ok) : row.fiscal_signature_ok === null ? null : Boolean(row.fiscal_signature_ok),
          lastErcaSyncAt: toIso(row.last_erca_sync_at),
          nextErcaSyncAt: toIso(row.next_erca_sync_at),
          updatedAt: toIso(row.updated_at),
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tax-status', requireSuperadmin, async (req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      const patch = {};
      if (typeof req.body?.fiscalPrinterStatus === 'string') patch.fiscal_printer_status = req.body.fiscalPrinterStatus.trim() || null;
      if (typeof req.body?.fiscalSignatureOk === 'boolean') patch.fiscal_signature_ok = Boolean(req.body.fiscalSignatureOk);
      if (typeof req.body?.lastErcaSyncAt === 'string') patch.last_erca_sync_at = req.body.lastErcaSyncAt ? new Date(req.body.lastErcaSyncAt) : null;
      if (typeof req.body?.nextErcaSyncAt === 'string') patch.next_erca_sync_at = req.body.nextErcaSyncAt ? new Date(req.body.nextErcaSyncAt) : null;
      patch.updated_at = nowIso;
      await db().from('tax_system_status').insert({ id: 1, ...patch }).onConflict('id').merge(patch);
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tax_status.update', summary: 'Updated tax system status', payload_json: JSON.stringify({ patch }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // ===========================================================================
  // INVOICE & PAYMENT MANAGEMENT
  // ===========================================================================

  r.post('/superadmin/invoices/manual', requireSuperadmin, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenantId || '').trim();
      const description = String(req.body?.description || '').trim();
      const amountEtb = Number(req.body?.amountEtb || 0);
      const dueInDays = Number(req.body?.dueInDays || 7);
      const notes = typeof req.body?.notes === 'string' ? String(req.body.notes) : null;

      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!description) return res.status(400).json({ error: 'description_required' });
      if (!Number.isFinite(amountEtb) || amountEtb <= 0) return res.status(400).json({ error: 'amount_invalid' });
      if (!Number.isFinite(dueInDays) || dueInDays < 0 || dueInDays > 365) return res.status(400).json({ error: 'due_days_invalid' });

      const tenant = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const result = await createManualInvoice({
        tenantId,
        dueInDays,
        notes,
        type: 'manual',
        lineItems: [{ description, amount: amountEtb }],
      });

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: tenantId,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'invoice.manual_create',
        summary: `Created manual invoice ETB ${amountEtb}`,
        payload_json: JSON.stringify({ tenantId, invoiceId: result.invoiceId, dueInDays, description, amountEtb }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, invoice: result });
    } catch (e) {
      return next(e);
    }
  });

  // List all invoices (with filtering)
  r.get('/superadmin/invoices', requireSuperadmin, async (req, res, next) => {
    try {
      const page = clampInt(req.query?.page, 1, 1, 1000000);
      const limit = clampInt(req.query?.limit, 50, 1, 200);
      const status = String(req.query?.status || '').trim();
      const tenantId = String(req.query?.tenantId || '').trim();
      const q = String(req.query?.q || '').trim();
      const tier = String(req.query?.tier || '').trim();
      const from = String(req.query?.from || '').trim();
      const to = String(req.query?.to || '').trim();

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');

      if (status) base = base.where('invoices.status', status);
      if (tenantId) base = base.where('invoices.tenant_id', tenantId);
      if (q) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${q}%`).orWhere('tenants.name', 'like', `%${q}%`);
        });
      }

      if (tier) {
        // invoices.metadata_json contains planTier for subscription invoices
        // NOTE: stored as TEXT in this schema, so use LIKE match
        const safeTier = tier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }

      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) base = base.andWhere('invoices.issue_date', '<=', toDate.toISOString());
      }

      const countRow = await base.clone().count({ c: '*' }).first();
      const total = Number(countRow?.c || 0);

      const rows = await base
        .select([
          'invoices.id',
          'invoices.invoice_number',
          'invoices.type',
          'invoices.status',
          'invoices.total_etb',
          'invoices.issue_date',
          'invoices.due_date',
          'invoices.paid_at',
          'invoices.created_at',
          'invoices.tenant_id',
          'tenants.name as tenant_name',
        ])
        .orderBy('invoices.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

      const invoices = rows.map(r => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        type: r.type,
        status: r.status,
        amountEtb: Number(r.total_etb || 0),
        issueDate: toIso(r.issue_date),
        dueDate: toIso(r.due_date),
        paidAt: toIso(r.paid_at),
        createdAt: toIso(r.created_at),
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
      }));

      // Stats (real DB-derived)
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const revenueRow = await db()
        .from('invoices')
        .whereNotNull('paid_at')
        .andWhere('paid_at', '>=', monthStart)
        .sum({ s: 'total_etb' })
        .first();
      const revenueEtb = Number(revenueRow?.s || 0);

      const outstandingRow = await db()
        .from('invoices')
        .whereIn('status', ['pending', 'overdue'])
        .count({ c: '*' })
        .first();
      const outstandingCount = Number(outstandingRow?.c || 0);

      const avgRow = await db()
        .from('invoices')
        .whereNotNull('issue_date')
        .andWhere('issue_date', '>=', monthStart)
        .avg({ a: 'total_etb' })
        .first();
      const avgInvoiceEtb = Number(avgRow?.a || 0);

      return res.json({
        ok: true,
        invoices,
        page,
        limit,
        total,
        stats: {
          revenueEtb,
          outstandingCount,
          avgInvoiceEtb,
          monthStart: toIso(monthStart),
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/invoices/export.csv', requireSuperadmin, async (req, res, next) => {
    try {
      const status = String(req.query?.status || '').trim();
      const tenantId = String(req.query?.tenantId || '').trim();
      const q = String(req.query?.q || '').trim();
      const tier = String(req.query?.tier || '').trim();
      const from = String(req.query?.from || '').trim();
      const to = String(req.query?.to || '').trim();
      const limit = clampInt(req.query?.limit, 5000, 1, 20000);

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');
      if (status) base = base.where('invoices.status', status);
      if (tenantId) base = base.where('invoices.tenant_id', tenantId);
      if (q) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${q}%`).orWhere('tenants.name', 'like', `%${q}%`);
        });
      }

      if (tier) {
        const safeTier = tier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) base = base.andWhere('invoices.issue_date', '<=', toDate.toISOString());
      }

      const rows = await base
        .select([
          'invoices.id',
          'invoices.invoice_number',
          'invoices.type',
          'invoices.status',
          'invoices.total_etb',
          'invoices.issue_date',
          'invoices.due_date',
          'invoices.paid_at',
          'invoices.created_at',
          'invoices.tenant_id',
          'tenants.name as tenant_name',
        ])
        .orderBy('invoices.created_at', 'desc')
        .limit(limit);

      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[\n\r,\"]/g.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
      };

      const header = ['invoice_id', 'invoice_number', 'tenant_id', 'tenant_name', 'type', 'status', 'total_etb', 'issue_date', 'due_date', 'paid_at', 'created_at'];
      const lines = [header.map(esc).join(',')];
      for (const r of rows) {
        lines.push(
          [
            r.id,
            r.invoice_number,
            r.tenant_id,
            r.tenant_name,
            r.type,
            r.status,
            Number(r.total_etb || 0),
            toIso(r.issue_date),
            toIso(r.due_date),
            toIso(r.paid_at),
            toIso(r.created_at),
          ]
            .map(esc)
            .join(',')
        );
      }

      const out = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
      return res.status(200).send(out);
    } catch (e) {
      return next(e);
    }
  });

  // Get invoice details
  r.get('/superadmin/invoices/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      console.log('[DEBUG] GET /superadmin/invoices/:id', { id });
      if (!id) return res.status(400).json({ error: 'id_required' });

      console.log('[DEBUG] Calling getInvoiceDetails', { id });
      const invoice = await getInvoiceDetails(id);
      console.log('[DEBUG] Result', { found: !!invoice });
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      // Attach tenant name
      const tenant = await db().select('name').from('tenants').where({ id: invoice.tenantId }).first();
      invoice.tenantName = tenant?.name || 'Unknown';

      return res.json({ ok: true, invoice });
    } catch (e) {
      console.error('[DEBUG] Error in GET invoice details:', e);
      return next(e);
    }
  });

  // Download Invoice PDF
  r.get('/superadmin/invoices/:id/pdf', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const invoice = await getInvoiceDetails(id);
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      let pdfBuffer;
      try {
        pdfBuffer = await generateInvoicePDF(id);
      } catch (err) {
        console.error('[InvoicePDF] Failed to generate superadmin invoice PDF', { invoiceId: id, err });
        return res.status(500).json({ error: 'invoice_pdf_failed' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoiceNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (e) {
      return next(e);
    }
  });

  // Verify Invoice / Payment
  r.post('/superadmin/invoices/:id/verify', requireSuperadmin, async (req, res, next) => {
    try {
      const invoiceId = String(req.params?.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'id_required' });

      const paymentId = String(req.body?.paymentId || '').trim();
      const method = String(req.body?.method || 'Cash').trim();

      const userId = 'superadmin'; // TODO: get from auth if possible (req.auth)

      if (paymentId) {
        // Verify specific payment
        await verifyPayment({ paymentId, verifiedBy: userId });
      } else {
        // Create new cash payment and verify it (Manual override)
        // Check if invoice exists
        const inv = await getInvoiceDetails(invoiceId);
        if (!inv) return res.status(404).json({ error: 'not_found' });

        if (inv.status === 'paid') return res.status(409).json({ error: 'already_paid' });

        const { paymentId: newPayId } = await recordPaymentSubmission({
          invoiceId,
          tenantId: inv.tenantId,
          method,
          amount: inv.totalEtb,
          notes: 'Manually verified by Super Admin',
        });

        await verifyPayment({ paymentId: newPayId, verifiedBy: userId });
      }

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'invoice.verify',
        summary: `Verified invoice ${invoiceId}`,
        payload_json: JSON.stringify({ invoiceId, paymentId, method }),
        created_at: new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Reject Payment
  r.post('/superadmin/payments/:id/reject', requireSuperadmin, async (req, res, next) => {
    try {
      const paymentId = String(req.params?.id || '').trim();
      if (!paymentId) return res.status(400).json({ error: 'id_required' });

      const reason = String(req.body?.reason || 'Rejected by admin').trim();
      const userId = 'superadmin';

      await rejectPayment({ paymentId, rejectedBy: userId, reason });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Integration Marketplace: Catalog
  r.get('/superadmin/integrations', requireSuperadmin, async (req, res, next) => {
    try {
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const availableRaw = typeof req.query?.available === 'string' ? req.query.available.trim().toLowerCase() : '';

      const base = db().from('integrations_catalog');
      if (category) base.where({ category });
      if (availableRaw === 'true') base.where({ is_available: 1 });
      if (availableRaw === 'false') base.where({ is_available: 0 });

      if (q) {
        base.andWhere((qb) => qb.whereRaw('LOWER(code) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]));
      }

      const rows = await base
        .select(['id', 'code', 'name', 'description', 'category', 'integration_type', 'is_available', 'required_tier', 'config_schema_json', 'meta_json', 'created_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const integrations = (rows || []).map((r0) => ({
        id: String(r0.id),
        code: String(r0.code || ''),
        name: String(r0.name || ''),
        description: r0.description != null ? String(r0.description) : '',
        category: r0.category != null ? String(r0.category) : '',
        integrationType: String(r0.integration_type || 'api_key'),
        isAvailable: Boolean(r0.is_available),
        requiredTier: r0.required_tier != null ? String(r0.required_tier) : null,
        configSchema: safeJsonParse(r0.config_schema_json, null),
        meta: safeJsonParse(r0.meta_json, {}),
        createdAt: toIso(r0.created_at),
        updatedAt: toIso(r0.updated_at),
      }));

      return res.json({ ok: true, integrations });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/integrations', requireSuperadmin, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('integrations_catalog').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof req.body?.category === 'string' ? req.body.category.trim() : null;
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
      const integrationType = typeof req.body?.integrationType === 'string' ? req.body.integrationType.trim() : 'api_key';
      const requiredTier = typeof req.body?.requiredTier === 'string' ? req.body.requiredTier.trim() : null;
      const isAvailable = req.body?.isAvailable !== false;

      const configSchema = req.body?.configSchema && typeof req.body.configSchema === 'object' ? req.body.configSchema : null;
      const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

      const nowIso = new Date().toISOString();
      const id = makeId('int');
      await db().from('integrations_catalog').insert({
        id,
        code,
        name,
        description,
        category,
        integration_type: integrationType,
        is_available: isAvailable ? 1 : 0,
        required_tier: requiredTier,
        config_schema_json: configSchema != null ? JSON.stringify(configSchema) : null,
        meta_json: JSON.stringify(meta || {}),
        created_at: nowIso,
        updated_at: nowIso,
      });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'integrations.create',
        summary: `Created integration ${code}`,
        payload_json: JSON.stringify({ integrationId: id, code }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/integrations/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.description === 'string') patch.description = req.body.description.trim();
      if (typeof req.body?.category === 'string') patch.category = req.body.category.trim();
      if (typeof req.body?.integrationType === 'string') patch.integration_type = req.body.integrationType.trim();
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isAvailable')) patch.is_available = req.body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'requiredTier')) patch.required_tier = typeof req.body.requiredTier === 'string' ? req.body.requiredTier.trim() : null;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'configSchema')) {
        const v = req.body.configSchema;
        patch.config_schema_json = v && typeof v === 'object' ? JSON.stringify(v) : null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'meta')) {
        const v = req.body.meta;
        patch.meta_json = v && typeof v === 'object' ? JSON.stringify(v) : JSON.stringify({});
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('integrations_catalog').where({ id }).update(patch);

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'integrations.update',
        summary: `Updated integration ${String(existing.code || id)}`,
        payload_json: JSON.stringify({ integrationId: id, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/integrations/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_integrations').where({ integration_id: id }).del();
      await db().from('integrations_catalog').where({ id }).del();

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'integrations.delete',
        summary: `Deleted integration ${String(existing.code || id)}`,
        payload_json: JSON.stringify({ integrationId: id }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/integrations/:id/tenants', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const integ = await db().select(['id', 'code', 'name']).from('integrations_catalog').where({ id }).first();
      if (!integ) return res.status(404).json({ error: 'not_found' });

      const rows = await db()
        .from({ ti: 'tenant_integrations' })
        .leftJoin({ t: 'tenants' }, 't.id', 'ti.tenant_id')
        .select(['ti.id', 'ti.tenant_id', 't.name as tenant_name', 't.slug as tenant_slug', 'ti.status', 'ti.installed_at', 'ti.updated_at'])
        .where({ 'ti.integration_id': id })
        .orderBy('ti.updated_at', 'desc')
        .limit(1000);

      const installs = (rows || []).map((r0) => ({
        id: String(r0.id),
        tenantId: String(r0.tenant_id || ''),
        tenantName: r0.tenant_name != null ? String(r0.tenant_name) : '',
        tenantSlug: r0.tenant_slug != null ? String(r0.tenant_slug) : '',
        status: String(r0.status || ''),
        installedAt: toIso(r0.installed_at),
        updatedAt: toIso(r0.updated_at),
      }));

      return res.json({ ok: true, integration: { id: String(integ.id), code: String(integ.code || ''), name: String(integ.name || '') }, installs });
    } catch (e) {
      return next(e);
    }
  });

  // Add-on Packages: Catalog
  r.get('/superadmin/addons', requireSuperadmin, async (req, res, next) => {
    try {
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const availableRaw = typeof req.query?.available === 'string' ? req.query.available.trim().toLowerCase() : '';

      const base = db().from('addon_packages');
      if (category) base.where({ category });
      if (availableRaw === 'true') base.where({ is_available: 1 });
      if (availableRaw === 'false') base.where({ is_available: 0 });
      if (q) {
        base.andWhere((qb) => qb.whereRaw('LOWER(code) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]));
      }

      const rows = await base
        .select([
          'id',
          'code',
          'name',
          'description',
          'category',
          'price_monthly_etb',
          'price_yearly_etb',
          'setup_fee_etb',
          'modules_json',
          'limits_json',
          'meta_json',
          'is_available',
          'availability_tier',
          'created_at',
          'updated_at',
        ])
        .orderBy('updated_at', 'desc')
        .limit(500);

      const addons = (rows || []).map((a) => ({
        id: String(a.id),
        code: String(a.code || ''),
        name: String(a.name || ''),
        description: a.description != null ? String(a.description) : '',
        category: a.category != null ? String(a.category) : '',
        pricing: {
          monthlyEtb: Number(a.price_monthly_etb || 0) || 0,
          yearlyEtb: Number(a.price_yearly_etb || 0) || 0,
          setupFeeEtb: Number(a.setup_fee_etb || 0) || 0,
        },
        modules: safeJsonParse(a.modules_json, []),
        limits: safeJsonParse(a.limits_json, {}),
        meta: safeJsonParse(a.meta_json, {}),
        isAvailable: Boolean(a.is_available),
        availabilityTier: a.availability_tier != null ? String(a.availability_tier) : null,
        createdAt: toIso(a.created_at),
        updatedAt: toIso(a.updated_at),
      }));

      return res.json({ ok: true, addons });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/addons', requireSuperadmin, async (req, res, next) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('addon_packages').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof req.body?.category === 'string' ? req.body.category.trim() : null;
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
      const availabilityTier = typeof req.body?.availabilityTier === 'string' ? req.body.availabilityTier.trim() : null;
      const isAvailable = req.body?.isAvailable !== false;

      const pricing = req.body?.pricing && typeof req.body.pricing === 'object' ? req.body.pricing : {};
      const monthlyEtb = Number(pricing.monthlyEtb || 0) || 0;
      const yearlyEtb = Number(pricing.yearlyEtb || 0) || 0;
      const setupFeeEtb = Number(pricing.setupFeeEtb || 0) || 0;
      if (monthlyEtb < 0 || yearlyEtb < 0 || setupFeeEtb < 0) return res.status(400).json({ error: 'invalid_pricing' });

      const modules = Array.isArray(req.body?.modules) ? req.body.modules.map(String).filter(Boolean) : [];
      const limits = req.body?.limits && typeof req.body.limits === 'object' ? req.body.limits : {};
      const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

      const nowIso = new Date().toISOString();
      const id = makeId('add');
      await db().from('addon_packages').insert({
        id,
        code,
        name,
        description,
        category,
        price_monthly_etb: monthlyEtb,
        price_yearly_etb: yearlyEtb,
        setup_fee_etb: setupFeeEtb,
        modules_json: JSON.stringify(modules),
        limits_json: JSON.stringify(limits),
        meta_json: JSON.stringify(meta),
        is_available: isAvailable ? 1 : 0,
        availability_tier: availabilityTier,
        created_at: nowIso,
        updated_at: nowIso,
      });

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'addons.create',
        summary: `Created add-on ${code}`,
        payload_json: JSON.stringify({ addonId: id, code }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/addons/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.description === 'string') patch.description = req.body.description.trim();
      if (typeof req.body?.category === 'string') patch.category = req.body.category.trim();
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isAvailable')) patch.is_available = req.body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'availabilityTier')) {
        patch.availability_tier = typeof req.body.availabilityTier === 'string' ? req.body.availabilityTier.trim() : null;
      }

      if (req.body?.pricing && typeof req.body.pricing === 'object') {
        if (Object.prototype.hasOwnProperty.call(req.body.pricing, 'monthlyEtb')) {
          const v = Number(req.body.pricing.monthlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
          patch.price_monthly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(req.body.pricing, 'yearlyEtb')) {
          const v = Number(req.body.pricing.yearlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_yearly_price' });
          patch.price_yearly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(req.body.pricing, 'setupFeeEtb')) {
          const v = Number(req.body.pricing.setupFeeEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_setup_fee' });
          patch.setup_fee_etb = v;
        }
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'modules')) {
        const modules = Array.isArray(req.body.modules) ? req.body.modules.map(String).filter(Boolean) : [];
        patch.modules_json = JSON.stringify(modules);
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'limits')) {
        const limits = req.body.limits && typeof req.body.limits === 'object' ? req.body.limits : {};
        patch.limits_json = JSON.stringify(limits);
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'meta')) {
        const meta = req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
        patch.meta_json = JSON.stringify(meta);
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('addon_packages').where({ id }).update(patch);

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'addons.update',
        summary: `Updated add-on ${String(existing.code || id)}`,
        payload_json: JSON.stringify({ addonId: id, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/addons/:id', requireSuperadmin, async (req, res, next) => {
    try {
      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_addon_subscriptions').where({ addon_id: id }).del();
      await db().from('addon_packages').where({ id }).del();

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'addons.delete',
        summary: `Deleted add-on ${String(existing.code || id)}`,
        payload_json: JSON.stringify({ addonId: id }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminRouter };
