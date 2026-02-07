const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireSuperadmin } = require('../middleware/superadminAuth');
const { db } = require('../db');
const { config } = require('../config');
const { makeId } = require('../utils/ids');
const { safeJsonParse, safeJsonStringify } = require('../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../utils/sanitize');
const { logAudit } = require('../utils/logger');
const { resolveCdnUrl } = require('../utils/cdn');
const {
  validateSuperadminTenantId,
  validateTierParam,
  validateSuperadminPlanCreate,
  validateSuperadminPlanUpdate,
  validateSuperadminDemoRequestUpdate,
  validateSuperadminDemoRequestProvision,
  validateSuperadminBillingVerify,
  validateSuperadminBillingManualInvoice,
  validateSuperadminBillingSetNextBill,
  validateSuperadminBillingSetGrace,
  validateSuperadminBillingSetStatus,
  validateSuperadminBillingSetCycle,
  validateSuperadminBillingSetMethod,
  validateSuperadminBillingPolicy,
  validateSuperadminTenantCreate,
  validateSuperadminTenantUpdate,
  validateSuperadminResetCreds,
  validateSuperadminImpersonate,
  validateSuperadminGatewayParam,
  validateSuperadminPosGatewayUpdate,
  validateSuperadminTenantNote,
  validateSuperadminDunningCreate,
  validateSuperadminDunningUpdate,
  validateSuperadminPlatformSettings,
  validateSuperadminFeatureFlagCreate,
  validateSuperadminFeatureFlagUpdate,
  validateSuperadminPaymentConfig,
  validateSuperadminOfflineAccountCreate,
  validateSuperadminOfflineAccountUpdate,
  validateSuperadminTaxCodeParam,
  validateSuperadminTaxRuleCreate,
  validateSuperadminTaxRuleUpdate,
  validateSuperadminSupportReply,
  validateSuperadminSupportStatus,
  validateSuperadminOverviewQuery,
  validateSuperadminDemoRequestsQuery,
  validateSuperadminTenantsQuery,
  validateSuperadminPaymentsPendingQuery,
  validateSuperadminAuditQuery,
  validateSuperadminFeatureFlagsQuery,
  validateSuperadminTaxCategoryIdParam,
  validateSuperadminTaxCategoryCreate,
  validateSuperadminTaxCategoryUpdate,
  validateSuperadminTaxStatusUpdate,
  validateSuperadminInvoiceManual,
  validateSuperadminInvoicesQuery,
  validateSuperadminInvoiceIdParam,
  validateSuperadminInvoiceVerify,
  validateSuperadminPaymentReject,
  validateSuperadminIntegrationsQuery,
  validateSuperadminIntegrationCreate,
  validateSuperadminIntegrationUpdate,
  validateSuperadminAddonQuery,
  validateSuperadminAddonCreate,
  validateSuperadminAddonUpdate,
  validateIdParam,
  validateSuperadminSupportTicketsQuery,
} = require('../middleware/validators');
const { encryptConfigFields, decryptConfigFields } = require('../utils/secretEncryption');
const { provisionTenant } = require('../services/provisionService');
const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot, normalizeTier } = require('../services/entitlements');
const {
  generateSubscriptionInvoice,
  getTenantInvoices,
  getInvoiceDetails,
  createManualInvoice,
  verifyPayment,
  rejectPayment,
  recordPaymentSubmission,
  getPlatformPaymentConfig,
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

const safeDateIso = (raw) => {
  try {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) return '';
    return new Date(t).toISOString();
  } catch {
    return '';
  }
};

const decodeCursor = (raw) => {
  try {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    const createdAt = safeDateIso(obj?.createdAt);
    const id = typeof obj?.id === 'string' ? obj.id.trim() : '';
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

const encodeCursor = ({ createdAt, id }) => {
  const createdAtIso = safeDateIso(createdAt);
  const idStr = typeof id === 'string' ? id.trim() : '';
  if (!createdAtIso || !idStr) return '';
  return Buffer.from(JSON.stringify({ createdAt: createdAtIso, id: idStr }), 'utf8').toString('base64');
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

  r.post('/superadmin/tenants/reset-owner-password', requireSuperadmin, validateSuperadminTenantId, async (req, res, next) => {
    try {
      const { tenantId } = req.validatedBody || req.body;
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

  r.post('/superadmin/plans', requireSuperadmin, validateSuperadminPlanCreate, async (req, res, next) => {
    try {
      const { tier: tierRaw, modules: modulesRaw, limits: limitsRaw, pricing } = req.validatedBody || req.body;
      if (!tierRaw) return res.status(400).json({ error: 'tier_required' });
      const tier = tierRaw;

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const modules = Array.isArray(modulesRaw) ? modulesRaw.map(String).filter(Boolean) : [];
      const limits = limitsRaw && typeof limitsRaw === 'object' ? limitsRaw : {};

      const monthlyEtb = Number(pricing?.monthlyEtb ?? 0);
      const yearlyEtb = Number(pricing?.yearlyEtb ?? 0);
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

  r.put('/superadmin/plans/:tier', requireSuperadmin, validateTierParam, validateSuperadminPlanUpdate, async (req, res, next) => {
    try {
      const { tier: tierRaw } = req.validatedParams || req.params;
      const tier = normalizeTier(tierRaw);
      if (!tier) return res.status(400).json({ error: 'tier_required' });

      const existing = await db().select(['tier']).from('plans').where({ tier }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
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

  r.get('/superadmin/overview', requireSuperadmin, validateSuperadminOverviewQuery, async (_req, res, next) => {
    try {
      const { range: rangeRaw } = _req.validatedQuery || _req.query;
      const range = typeof rangeRaw === 'string' ? rangeRaw.trim() : '';
      const rangeFinal = range || '30d';
      const now = Date.now();
      const sinceMs = (() => {
        if (rangeFinal === '24h') return 24 * 60 * 60 * 1000;
        if (rangeFinal === '7d') return 7 * 24 * 60 * 60 * 1000;
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
      const hasRestaurantTables = await db().schema.hasTable('restaurant_tables');
      const lastSyncRow = hasRestaurantTables
        ? await db().from('restaurant_tables').max({ mx: 'updated_at' }).first()
        : null;
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

  // System health
  r.get('/superadmin/system-health', requireSuperadmin, async (_req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      const jobsSinceIso = addDays(nowIso, -1);
      const jobsPrevSinceIso = addDays(nowIso, -2);

      const hasJobs = await db().schema.hasTable('jobs');
      const jobsLastRow = hasJobs
        ? await db().from('jobs').count({ c: '*' }).where('created_at', '>=', jobsSinceIso).first()
        : null;
      const jobsLast = Number(jobsLastRow?.c ?? jobsLastRow?.count ?? jobsLastRow?.['count(*)'] ?? 0) || 0;
      const jobsFailLastRow = hasJobs
        ? await db().from('jobs').count({ c: '*' }).where('created_at', '>=', jobsSinceIso).andWhere({ status: 'failed' }).first()
        : null;
      const jobsFailLast = Number(jobsFailLastRow?.c ?? jobsFailLastRow?.count ?? jobsFailLastRow?.['count(*)'] ?? 0) || 0;

      const jobsPrevRow = hasJobs
        ? await db().from('jobs').count({ c: '*' }).where('created_at', '>=', jobsPrevSinceIso).andWhere('created_at', '<', jobsSinceIso).first()
        : null;
      const jobsPrev = Number(jobsPrevRow?.c ?? jobsPrevRow?.count ?? jobsPrevRow?.['count(*)'] ?? 0) || 0;
      const jobsFailPrevRow = hasJobs
        ? await db().from('jobs').count({ c: '*' }).where('created_at', '>=', jobsPrevSinceIso).andWhere('created_at', '<', jobsSinceIso).andWhere({ status: 'failed' }).first()
        : null;
      const jobsFailPrev = Number(jobsFailPrevRow?.c ?? jobsFailPrevRow?.count ?? jobsFailPrevRow?.['count(*)'] ?? 0) || 0;

      let databaseStatus = 'connected';
      try {
        await db().raw('SELECT 1');
      } catch {
        databaseStatus = 'disconnected';
      }

      const hasRestaurantTables = await db().schema.hasTable('restaurant_tables');
      const lastSyncRow = hasRestaurantTables
        ? await db().from('restaurant_tables').max({ mx: 'updated_at' }).first()
        : null;
      const lastSyncAt = toIso(lastSyncRow?.mx);

      const kpis = {
        avgSyncLatencyMs: 0,
        latencyTrendPct: 0,
        failedSyncs24h: jobsFailLast,
        failedSyncsDelta: jobsFailLast - jobsFailPrev,
        apiUptimePct: 99.9,
        apiStatusLabel: databaseStatus === 'connected' ? 'Operational' : 'Degraded',
      };

      let errorFeedRows = [];
      if (hasJobs) {
        try {
          errorFeedRows = await db().from('jobs').select(['id', 'type', 'last_error', 'created_at']).where({ status: 'failed' }).orderBy('created_at', 'desc').limit(20);
        } catch {
          errorFeedRows = await db().from('jobs').select(['id', 'type', 'created_at']).where({ status: 'failed' }).orderBy('created_at', 'desc').limit(20);
        }
      }
      const errorFeed = errorFeedRows.map((r) => {
        const base = String(r.last_error || '');
        const type = String(r.type || '').trim();
        const message = base === 'No handler registered' && type ? `No handler registered: ${type}` : base || type || String(r.id || 'Job failed');
        return {
          at: toIso(r.created_at),
          level: 'error',
          message,
        };
      });

      const components = [
        { id: 'db', name: 'Primary Database', region: 'default', status: databaseStatus === 'connected' ? 'HEALTHY' : 'DOWN', responseTimeMs: 0, uptime30dPct: 99.9, icon: 'database' },
        { id: 'sync', name: 'Sync Pipeline', region: 'default', status: jobsFailLast > 0 ? 'DEGRADED' : 'HEALTHY', responseTimeMs: 0, uptime30dPct: 99.5, icon: 'sync' },
      ];

      return res.json({
        ok: true,
        environment: String(config.env || 'production'),
        allOperational: databaseStatus === 'connected' && jobsFailLast === 0,
        lastRefreshedAt: nowIso,
        kpis,
        errorFeed,
        components,
        lastSyncAt,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/system-health/force-sync', requireSuperadmin, async (_req, res, next) => {
    try {
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Tenants index
  r.get('/superadmin/tenants', requireSuperadmin, validateSuperadminTenantsQuery, async (req, res, next) => {
    try {
      const { q: qRaw, status: statusRaw, tier: tierRaw, sort: sortRaw, page: pageRaw, limit: limitRaw } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const tierInput = sanitizeText(tierRaw, { maxLen: 40 });
      const tier = tierInput ? normalizeTier(tierInput) : '';
      const sort = sanitizeText(sortRaw, { maxLen: 40 }) || 'last_activity';
      const page = clampInt(pageRaw, 1, 1, 1000000);
      const limit = clampInt(limitRaw, 24, 1, 200);
      const offset = (page - 1) * limit;

      let base = db()
        .from({ t: 'tenants' })
        .leftJoin({ p: 'tenant_profile' }, 'p.tenant_id', 't.id')
        .leftJoin({ s: 'tenant_subscription' }, 's.tenant_id', 't.id')
        .select([
          't.id',
          't.slug',
          't.name',
          't.status',
          't.plan',
          't.created_at',
          't.updated_at',
          't.enabled_modules_json',
          't.features_json',
          'p.profile_json',
          's.tier as sub_tier',
          's.cycle as sub_cycle',
          's.status as sub_status',
          's.next_bill_at as sub_next_bill_at',
          's.amount_etb as sub_amount_etb',
          's.grace_ends_at as sub_grace_ends_at',
        ]);

      if (status) {
        const mapped = mapUiStatusToTenant(status);
        if (mapped) base = base.andWhere('t.status', mapped);
      }
      if (tier) base = base.andWhereRaw('LOWER(s.tier) = ?', [tier.toLowerCase()]);
      if (q) {
        base = base.andWhere((qb) =>
          qb
            .whereRaw('LOWER(t.name) LIKE ?', [`%${q}%`])
            .orWhereRaw('LOWER(t.slug) LIKE ?', [`%${q}%`])
            .orWhere('t.id', 'like', `%${q}%`)
        );
      }

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      if (sort === 'name') base = base.orderBy('t.name', 'asc');
      else if (sort === 'created') base = base.orderBy('t.created_at', 'desc');
      else base = base.orderBy('t.updated_at', 'desc');

      const rows = await base.limit(limit).offset(offset);
      const tenantIds = rows.map((r) => String(r.id));

      const branchCountsRows = tenantIds.length
        ? await db().from('branches').select('tenant_id').count({ c: '*' }).whereIn('tenant_id', tenantIds).groupBy('tenant_id')
        : [];
      const staffCountsRows = tenantIds.length
        ? await db().from('staff').select('tenant_id').count({ c: '*' }).whereIn('tenant_id', tenantIds).groupBy('tenant_id')
        : [];
      const ownerRows = tenantIds.length
        ? await db().from('staff').select(['tenant_id', 'name', 'email', 'phone']).whereIn('tenant_id', tenantIds).andWhere({ role_name: 'Cafe Owner' }).orderBy('created_at', 'asc')
        : [];
      const entRows = tenantIds.length
        ? await db().from('tenant_entitlements').select(['tenant_id', 'limits_json']).whereIn('tenant_id', tenantIds)
        : [];

      const branchCounts = new Map(branchCountsRows.map((r) => [String(r.tenant_id), Number(r.c ?? r.count ?? r['count(*)'] ?? 0) || 0]));
      const staffCounts = new Map(staffCountsRows.map((r) => [String(r.tenant_id), Number(r.c ?? r.count ?? r['count(*)'] ?? 0) || 0]));
      const owners = new Map();
      for (const o of ownerRows) {
        const tid = String(o.tenant_id);
        if (!owners.has(tid)) owners.set(tid, o);
      }
      const limitsByTenant = new Map(entRows.map((r) => [String(r.tenant_id), safeJsonParse(r.limits_json, {})]));

      const tenants = rows.map((r) => {
        const id = String(r.id);
        const owner = owners.get(id);
        const branchCount = branchCounts.get(id) || 0;
        const staffCount = staffCounts.get(id) || 0;
        const limits = limitsByTenant.get(id) || {};
        const branchLimit = Number(limits.branchLimit || 0) || 0;
        const staffLimit = Number(limits.staffLimit || 0) || 0;
        const pct = Math.max(
          branchLimit ? branchCount / branchLimit : 0,
          staffLimit ? staffCount / staffLimit : 0
        );
        const usage = {
          pct: Math.max(0, Math.min(100, Math.round(pct * 100))),
          label: branchLimit || staffLimit ? `${branchCount}/${branchLimit || staffLimit}` : '',
        };
        return {
          id,
          name: String(r.name || ''),
          status: mapTenantStatusToUi(String(r.status || '')),
          plan: String(r.sub_tier || r.plan || ''),
          branches: branchCount,
          users: staffCount,
          lastActivityAt: toIso(r.updated_at),
          owner: owner
            ? {
              name: String(owner.name || ''),
              email: String(owner.email || ''),
              phone: String(owner.phone || ''),
            }
            : {},
          usage,
        };
      });

      return res.json({ ok: true, tenants, page, limit, total });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const tenantId = String(id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const tenant = await db().select(['id', 'slug', 'name', 'status', 'plan', 'trial_ends_at', 'created_at', 'updated_at', 'enabled_modules_json', 'features_json']).from('tenants').where({ id: tenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'not_found' });

      const profileRow = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: tenantId }).first();
      const profile = safeJsonParse(profileRow?.profile_json, {});

      const ent = await computeTenantEntitlements({ tenant });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId, entitlements: ent });

      const branchRows = await db().select(['id', 'name', 'status', 'city', 'region', 'address', 'phone', 'updated_at']).from('branches').where({ tenant_id: tenantId }).orderBy('created_at', 'asc');
      const branchesTable = branchRows.map((b) => ({
        id: String(b.id),
        name: String(b.name || ''),
        status: String(b.status || ''),
        locationId: String(b.id),
        city: String(b.city || ''),
        region: String(b.region || ''),
        address: String(b.address || ''),
        phone: String(b.phone || ''),
        posVersion: '',
        syncStatus: String(b.status || '').toLowerCase() === 'open' ? 'online' : 'offline',
        lastSyncAt: toIso(b.updated_at),
      }));

      const activityRows = await db().from('events').select(['id', 'type', 'payload', 'at']).where({ tenant_id: tenantId }).orderBy('at', 'desc').limit(50);
      const activity = activityRows.map((a) => ({
        id: String(a.id),
        type: String(a.type || ''),
        summary: String(a.type || ''),
        at: toIso(a.at),
        payload: safeJsonParse(a.payload, {}),
      }));

      const branchCountRow = await db().from('branches').count({ c: '*' }).where({ tenant_id: tenantId }).first();
      const staffCountRow = await db().from('staff').count({ c: '*' }).where({ tenant_id: tenantId }).first();
      const ordersCountRow = await db().from('orders').count({ c: '*' }).where({ tenant_id: tenantId }).first();
      const metrics = {
        branches: Number(branchCountRow?.c ?? branchCountRow?.count ?? branchCountRow?.['count(*)'] ?? 0) || 0,
        users: Number(staffCountRow?.c ?? staffCountRow?.count ?? staffCountRow?.['count(*)'] ?? 0) || 0,
        orders: Number(ordersCountRow?.c ?? ordersCountRow?.count ?? ordersCountRow?.['count(*)'] ?? 0) || 0,
      };

      return res.json({
        ok: true,
        tenant: {
          id: String(tenant.id),
          name: String(tenant.name || ''),
          status: mapTenantStatusToUi(String(tenant.status || '')),
          plan: String(ent?.subscription?.tier || tenant.plan || ''),
          createdAt: toIso(tenant.created_at),
          profile,
          metrics,
          subscription: ent?.subscription || null,
          planPricing: ent?.pricing || null,
          planLimits: ent?.limits || null,
          branchesTable,
          activity,
          incidents: [],
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tenants/:id', requireSuperadmin, validateIdParam, validateSuperadminTenantUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const tenantId = String(id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

      const body = req.validatedBody || req.body;
      const existing = await db().select(['id', 'plan', 'enabled_modules_json', 'features_json']).from('tenants').where({ id: tenantId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.status === 'string') {
        const mapped = mapUiStatusToTenant(body.status);
        if (mapped) patch.status = mapped;
      }
      if (typeof body?.tier === 'string') {
        patch.plan = normalizeTier(body.tier).toLowerCase();
      }
      if (Array.isArray(body?.enabledModules)) patch.enabled_modules_json = JSON.stringify(body.enabledModules.map(String));
      if (Array.isArray(body?.features)) patch.features_json = JSON.stringify(body.features.map(String));
      patch.updated_at = new Date().toISOString();

      await db().from('tenants').where({ id: tenantId }).update(patch);

      if (body?.profile && typeof body.profile === 'object') {
        const existingProfileRow = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: tenantId }).first();
        const prevProfile = safeJsonParse(existingProfileRow?.profile_json, {});
        const nextProfile = { ...prevProfile, ...body.profile };
        await db().from('tenant_profile').insert({ tenant_id: tenantId, profile_json: JSON.stringify(nextProfile), updated_at: patch.updated_at }).onConflict('tenant_id').merge({ profile_json: JSON.stringify(nextProfile), updated_at: patch.updated_at });
      }

      if (typeof body?.tier === 'string') {
        const tier = normalizeTier(body.tier);
        await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ tier, updated_at: patch.updated_at });
      }

      const tenantFull = await db().select(['id', 'slug', 'name', 'status', 'trial_ends_at', 'plan', 'created_at', 'enabled_modules_json']).from('tenants').where({ id: tenantId }).first();
      const ent = tenantFull ? await computeTenantEntitlements({ tenant: tenantFull }) : null;
      if (ent && tenantFull) await upsertTenantEntitlementsSnapshot({ tenantId: tenantFull.id, entitlements: ent });

      return res.json({ ok: true, entitlements: ent });
    } catch (e) {
      return next(e);
    }
  });

  // Billing overview + subscriptions
  r.get('/superadmin/billing', requireSuperadmin, async (_req, res, next) => {
    try {
      const subs = await db()
        .from({ s: 'tenant_subscription' })
        .leftJoin({ t: 'tenants' }, 't.id', 's.tenant_id')
        .select([
          's.tenant_id',
          's.tier',
          's.cycle',
          's.status',
          's.method',
          's.next_bill_at',
          's.amount_etb',
          's.grace_ends_at',
          't.name as tenant_name',
        ])
        .orderBy('t.name', 'asc');

      const nowMs = Date.now();
      let totalActive = 0;
      let atRisk = 0;
      for (const s of subs) {
        if (String(s.status || '').toLowerCase() === 'active') totalActive += 1;
        const grace = s.grace_ends_at ? new Date(s.grace_ends_at).getTime() : NaN;
        if (Number.isFinite(grace) && grace < nowMs) atRisk += 1;
      }

      const pendingPaymentsRow = await db().from('payments').count({ c: '*' }).where({ status: 'pending' }).first();
      const pendingVerify = Number(pendingPaymentsRow?.c ?? pendingPaymentsRow?.count ?? pendingPaymentsRow?.['count(*)'] ?? 0) || 0;

      const subscriptions = subs.map((s) => ({
        tenantId: String(s.tenant_id),
        tenantName: String(s.tenant_name || ''),
        plan: String(s.tier || ''),
        cycle: String(s.cycle || ''),
        requestedPlan: '',
        requestedCycle: '',
        nextBillAt: toIso(s.next_bill_at),
        amountEtb: Number(s.amount_etb || 0) || 0,
        method: String(s.method || ''),
        status: String(s.status || ''),
        graceEndsAt: toIso(s.grace_ends_at),
      }));

      return res.json({
        ok: true,
        overview: { totalActive, pendingVerify, monthlyRevenueEtb: 0, atRisk },
        subscriptions,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/verify', requireSuperadmin, validateSuperadminBillingVerify, async (req, res, next) => {
    try {
      const { tenantId } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const nowIso = new Date().toISOString();
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ status: 'active', updated_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/manual-invoice', requireSuperadmin, validateSuperadminBillingManualInvoice, async (req, res, next) => {
    try {
      const { tenantId, amountEtb, dueAt, notes } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      const amount = Number(amountEtb || 0);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });

      let dueInDays = 7;
      if (dueAt) {
        const dueMs = new Date(dueAt).getTime();
        const nowMs = Date.now();
        if (Number.isFinite(dueMs) && dueMs > nowMs) {
          dueInDays = Math.max(1, Math.ceil((dueMs - nowMs) / (24 * 60 * 60 * 1000)));
        }
      }

      const invoice = await createManualInvoice({
        tenantId,
        lineItems: [{ description: 'Manual invoice', qty: 1, unitPrice: amount, amount }],
        dueInDays,
        notes: notes || null,
      });

      return res.status(201).json({ ok: true, invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-nextbill', requireSuperadmin, validateSuperadminBillingSetNextBill, async (req, res, next) => {
    try {
      const { tenantId, nextBillAt } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ next_bill_at: nextBillAt, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-grace', requireSuperadmin, validateSuperadminBillingSetGrace, async (req, res, next) => {
    try {
      const { tenantId, graceEndsAt } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ grace_ends_at: graceEndsAt, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-status', requireSuperadmin, validateSuperadminBillingSetStatus, async (req, res, next) => {
    try {
      const { tenantId, status } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ status, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-cycle', requireSuperadmin, validateSuperadminBillingSetCycle, async (req, res, next) => {
    try {
      const { tenantId, cycle } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ cycle, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/billing/set-method', requireSuperadmin, validateSuperadminBillingSetMethod, async (req, res, next) => {
    try {
      const { tenantId, method } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      await db().from('tenant_subscription').where({ tenant_id: tenantId }).update({ method, updated_at: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/payments/pending', requireSuperadmin, validateSuperadminPaymentsPendingQuery, async (req, res, next) => {
    try {
      const { limit: limitRaw } = req.validatedQuery || req.query;
      const limit = clampInt(limitRaw, 50, 1, 200);
      const rows = await db()
        .from({ p: 'payments' })
        .leftJoin({ i: 'invoices' }, 'i.id', 'p.invoice_id')
        .leftJoin({ t: 'tenants' }, 't.id', 'p.tenant_id')
        .select([
          'p.id as payment_id',
          'p.invoice_id',
          'i.invoice_number',
          'p.tenant_id',
          't.name as tenant_name',
          'p.method',
          'p.amount_etb',
          'p.reference',
          'p.proof_url',
          'p.proof_filename',
          'p.created_at',
        ])
        .where({ 'p.status': 'pending' })
        .orderBy('p.created_at', 'desc')
        .limit(limit);

      const pendingPayments = rows.map((r) => ({
        paymentId: String(r.payment_id),
        invoiceId: String(r.invoice_id || ''),
        invoiceNumber: String(r.invoice_number || ''),
        tenantId: String(r.tenant_id || ''),
        tenantName: String(r.tenant_name || ''),
        method: String(r.method || ''),
        amountEtb: Number(r.amount_etb || 0) || 0,
        reference: String(r.reference || ''),
        submittedAt: toIso(r.created_at),
        proofUrl: resolveCdnUrl(String(r.proof_url || '')),
        proofFilename: String(r.proof_filename || ''),
      }));

      return res.json({ ok: true, pendingPayments });
    } catch (e) {
      return next(e);
    }
  });

  // Payment config
  r.get('/superadmin/payment-config', requireSuperadmin, async (_req, res, next) => {
    try {
      const cfg = await getPlatformPaymentConfig();
      const starterRow = await db().from('plans').select(['price_monthly_etb']).whereRaw('LOWER(tier) = ?', ['starter']).first();
      const growthRow = await db().from('plans').select(['price_monthly_etb']).whereRaw('LOWER(tier) = ?', ['growth']).first();
      const configOut = {
        bankDetails: cfg?.bankDetails || {},
        chapa: cfg?.chapa || { enabled: false },
        telebirr: cfg?.telebirr || { enabled: false },
        cbeBirr: cfg?.cbeBirr || { enabled: false },
        sms: cfg?.sms || { enabled: false },
        settings: {
          environment: String(config.env || 'production'),
          gracePeriodDays: Number(cfg?.defaultGraceDays || 3) || 3,
          reportRetentionDays: Number(cfg?.reportRetentionDays || 365) || 365,
          vatEnabled: true,
          starterPriceEtb: Number(starterRow?.price_monthly_etb || 0) || 0,
          growthPriceEtb: Number(growthRow?.price_monthly_etb || 0) || 0,
        },
      };
      return res.json({ ok: true, config: configOut });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/payment-config', requireSuperadmin, validateSuperadminPaymentConfig, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const bankDetails = body?.bankDetails && typeof body.bankDetails === 'object' ? body.bankDetails : {};
      const chapa = body?.chapa && typeof body.chapa === 'object' ? body.chapa : {};
      const telebirr = body?.telebirr && typeof body.telebirr === 'object' ? body.telebirr : {};
      const cbeBirr = body?.cbeBirr && typeof body.cbeBirr === 'object' ? body.cbeBirr : {};
      const sms = body?.sms && typeof body.sms === 'object' ? body.sms : {};
      const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};

      const nowIso = new Date().toISOString();
      await db().from('platform_payment_config').insert({
        id: 1,
        bank_details_json: JSON.stringify(bankDetails),
        chapa_config_json: JSON.stringify(chapa),
        telebirr_config_json: JSON.stringify(telebirr),
        cbe_birr_config_json: JSON.stringify(cbeBirr),
        sms_config_json: JSON.stringify(sms),
        default_grace_days: Number(settings.gracePeriodDays || 3) || 3,
        report_retention_days: Number(settings.reportRetentionDays || 365) || 365,
        updated_at: nowIso,
      }).onConflict('id').merge({
        bank_details_json: JSON.stringify(bankDetails),
        chapa_config_json: JSON.stringify(chapa),
        telebirr_config_json: JSON.stringify(telebirr),
        cbe_birr_config_json: JSON.stringify(cbeBirr),
        sms_config_json: JSON.stringify(sms),
        default_grace_days: Number(settings.gracePeriodDays || 3) || 3,
        report_retention_days: Number(settings.reportRetentionDays || 365) || 365,
        updated_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Platform settings
  r.get('/superadmin/platform-settings', requireSuperadmin, async (_req, res, next) => {
    try {
      const row = await db().select(['settings_json', 'updated_at']).from('platform_settings_admin').where({ id: 1 }).first();
      const settings = safeJsonParse(row?.settings_json, {});
      return res.json({ ok: true, settings, updatedAt: toIso(row?.updated_at) });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/platform-settings', requireSuperadmin, validateSuperadminPlatformSettings, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const nowIso = new Date().toISOString();
      await db().from('platform_settings_admin').insert({ id: 1, settings_json: JSON.stringify(body || {}), updated_at: nowIso }).onConflict('id').merge({ settings_json: JSON.stringify(body || {}), updated_at: nowIso });
      return res.json({ ok: true, settings: body || {} });
    } catch (e) {
      return next(e);
    }
  });

  // Feature flags
  r.get('/superadmin/feature-flags', requireSuperadmin, validateSuperadminFeatureFlagsQuery, async (req, res, next) => {
    try {
      const { page: pageRaw, pageSize: pageSizeRaw, q: qRaw, plan: planRaw, risk: riskRaw } = req.validatedQuery || req.query;
      const page = clampInt(pageRaw, 1, 1, 1000000);
      const pageSize = clampInt(pageSizeRaw, 10, 1, 100);
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const plan = sanitizeText(planRaw, { maxLen: 40 });
      const risk = sanitizeText(riskRaw, { maxLen: 40 });

      let base = db().from('feature_flags');
      if (plan) base = base.where({ plan });
      if (risk) base = base.where({ risk });
      if (q) base = base.andWhere((qb) => qb.whereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(id) LIKE ?', [`%${q}%`]));

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base.clone().orderBy('updated_at', 'desc').offset((page - 1) * pageSize).limit(pageSize);

      const statsRow = await db().from('feature_flags').select(['enabled', 'risk']).count({ c: '*' }).groupBy(['enabled', 'risk']);
      const stats = { totalFlags: total, activeGlobally: 0, highRisk: 0, betaFeatures: 0 };
      for (const r of statsRow) {
        if (r.enabled) stats.activeGlobally += Number(r.c || 0) || 0;
        if (String(r.risk || '').toLowerCase() === 'high' || String(r.risk || '').toLowerCase() === 'critical') {
          stats.highRisk += Number(r.c || 0) || 0;
        }
      }

      const flags = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name || ''),
        plan: String(r.plan || ''),
        risk: String(r.risk || ''),
        enabled: Boolean(r.enabled),
        updatedAt: toIso(r.updated_at),
        updatedBy: 'Super Admin',
      }));

      return res.json({ ok: true, page, pageSize, total, stats, flags });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/feature-flags', requireSuperadmin, validateSuperadminFeatureFlagCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const id = String(body?.id || '').trim();
      const name = String(body?.name || '').trim();
      if (!id || !name) return res.status(400).json({ error: 'invalid_flag' });
      const nowIso = new Date().toISOString();
      await db().from('feature_flags').insert({
        id,
        name,
        plan: typeof body?.plan === 'string' ? body.plan.trim() : null,
        risk: typeof body?.risk === 'string' ? body.risk.trim() : null,
        enabled: body?.enabled ? 1 : 0,
        meta_json: JSON.stringify({}),
        updated_at: nowIso,
      });
      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/feature-flags/:id', requireSuperadmin, validateIdParam, validateSuperadminFeatureFlagUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const flagId = String(id || '').trim();
      if (!flagId) return res.status(400).json({ error: 'invalid_flag' });
      const existing = await db().from('feature_flags').select(['id']).where({ id: flagId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.plan === 'string') patch.plan = body.plan.trim();
      if (typeof body?.risk === 'string') patch.risk = body.risk.trim();
      if (typeof body?.enabled !== 'undefined') patch.enabled = body.enabled ? 1 : 0;
      patch.updated_at = new Date().toISOString();

      await db().from('feature_flags').where({ id: flagId }).update(patch);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Support desk (superadmin)
  r.get('/superadmin/support', requireSuperadmin, validateSuperadminSupportTicketsQuery, async (req, res, next) => {
    try {
      const { q: qRaw, status: statusRaw, severity: severityRaw, tenantId: tenantIdRaw, from: fromRaw, to: toRaw, cursor: cursorRaw, limit: limitRaw } =
        req.validatedQuery || req.query;

      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 120 });
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const severity = sanitizeText(severityRaw, { maxLen: 40 });
      const tenantId = sanitizeText(tenantIdRaw, { maxLen: 64 });
      const fromIso = safeDateIso(fromRaw);
      const toIsoFilter = safeDateIso(toRaw);
      const cursor = decodeCursor(cursorRaw);

      const limit = clampInt(limitRaw, 200, 1, 500);

      let base = db().from({ st: 'support_tickets' });
      if (tenantId) base = base.where({ 'st.tenant_id': tenantId });
      if (status) base = base.where({ 'st.status': status });
      if (severity) base = base.where({ 'st.severity': severity });
      if (fromIso) base = base.where('st.created_at', '>=', fromIso);
      if (toIsoFilter) base = base.where('st.created_at', '<=', toIsoFilter);
      if (q) {
        base = base.andWhere((b) =>
          b
            .whereRaw('LOWER(st.subject) LIKE ?', [`%${q}%`])
            .orWhere('st.id', 'like', `%${q}%`)
        );
      }

      if (cursor) {
        base = base.andWhere((b) =>
          b
            .where('st.created_at', '<', cursor.createdAt)
            .orWhere((bb) => bb.where('st.created_at', '=', cursor.createdAt).andWhere('st.id', '<', cursor.id))
        );
      }

      let totalOut = null;
      if (!cursor) {
        const totalRow = await base.clone().count({ c: '*' }).first();
        totalOut = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;
      }

      const rows = await base
        .leftJoin({ t: 'tenants' }, 't.id', 'st.tenant_id')
        .select([
          'st.id',
          'st.tenant_id',
          'st.severity',
          'st.subject',
          'st.status',
          'st.created_at',
          't.name as tenant_name',
          't.plan as tenant_plan',
        ])
        .orderBy([{ column: 'st.created_at', order: 'desc' }, { column: 'st.id', order: 'desc' }])
        .limit(limit);

      const tickets = rows.map((t) => {
        const sev = String(t.severity || 'medium');
        const sla = calcSlaRemaining(t.created_at, sev);
        return {
          id: String(t.id),
          tenantId: String(t.tenant_id),
          tenantName: t.tenant_name ? String(t.tenant_name) : '',
          tenantPlan: t.tenant_plan ? String(t.tenant_plan) : '',
          severity: sev,
          subject: String(t.subject || ''),
          status: String(t.status || ''),
          createdAt: toIso(t.created_at),
          slaRemainingSec: sla.remainingSec,
          slaBreached: sla.breached,
        };
      });

      const nextCursor = rows.length ? encodeCursor({ createdAt: rows[rows.length - 1].created_at, id: String(rows[rows.length - 1].id) }) : '';

      const totalOpenRow = await db().from('support_tickets').count({ c: '*' }).whereNotIn('status', ['resolved', 'closed']).first();
      const totalOpen = Number(totalOpenRow?.c ?? totalOpenRow?.count ?? totalOpenRow?.['count(*)'] ?? 0) || 0;
      const slaBreaches = tickets.filter((t) => t.slaBreached).length;
      const todayVolumeRow = await db().from('support_tickets').count({ c: '*' }).where('created_at', '>=', addDays(new Date().toISOString(), -1)).first();
      const todayVolume = Number(todayVolumeRow?.c ?? todayVolumeRow?.count ?? todayVolumeRow?.['count(*)'] ?? 0) || 0;

      return res.json({
        ok: true,
        stats: { totalOpen, slaBreaches, avgResponseMin: 12, todayVolume },
        tickets,
        total: totalOut,
        nextCursor,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/support/tickets/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      const ticket = await db().from('support_tickets').select(['*']).where({ id: ticketId }).first();
      if (!ticket) return res.status(404).json({ error: 'not_found' });

      const tenant = await db().from('tenants').select(['id', 'name', 'plan']).where({ id: ticket.tenant_id }).first();
      const replies = await db().from('support_ticket_replies').select(['id', 'staff_id', 'message', 'created_at']).where({ ticket_id: ticketId }).orderBy('created_at', 'asc');

      const activity = replies.map((r) => ({
        id: String(r.id),
        by: r.staff_id ? 'Support' : 'Client',
        at: toIso(r.created_at),
        message: String(r.message || ''),
      }));

      const detail = {
        id: String(ticket.id),
        tenantId: String(ticket.tenant_id),
        severity: String(ticket.severity || ''),
        subject: String(ticket.subject || ''),
        status: String(ticket.status || ''),
        reportedByRole: String(ticket.reported_by_role || ''),
        description: String(ticket.description || ''),
        createdAt: toIso(ticket.created_at),
        updatedAt: toIso(ticket.updated_at),
        client: {
          name: String(tenant?.name || 'Tenant'),
          tier: String(tenant?.plan || ''),
          initials: String(tenant?.name || 'TN').slice(0, 2).toUpperCase(),
          ltvEtb: 0,
          healthPct: 90,
        },
        activity,
      };

      return res.json({ ok: true, ticket: detail });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/reply', requireSuperadmin, validateIdParam, validateSuperadminSupportReply, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      const { message } = req.validatedBody || req.body;
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const exists = await db().from('support_tickets').select(['id', 'tenant_id']).where({ id: ticketId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      await db().from('support_ticket_replies').insert({ id: makeId('tkr'), ticket_id: ticketId, tenant_id: exists.tenant_id, staff_id: null, message, created_at: nowIso });
      await db().from('support_tickets').where({ id: ticketId }).update({ status: 'in_progress', updated_at: nowIso });
      return res.status(201).json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/support/tickets/:id/status', requireSuperadmin, validateIdParam, validateSuperadminSupportStatus, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const ticketId = String(id || '').trim();
      const { status } = req.validatedBody || req.body;
      if (!ticketId) return res.status(400).json({ error: 'invalid_ticket' });
      const normalized = String(status || '').trim();
      if (!normalized) return res.status(400).json({ error: 'invalid_status' });
      const nowIso = new Date().toISOString();
      const updated = await db().from('support_tickets').where({ id: ticketId }).update({ status: normalized, updated_at: nowIso });
      if (!updated) return res.status(404).json({ error: 'not_found' });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Audit log (superadmin)
  r.get('/superadmin/audit', requireSuperadmin, validateSuperadminAuditQuery, async (req, res, next) => {
    try {
      const {
        page: pageRaw,
        pageSize: pageSizeRaw,
        q: qRaw,
        cursor: cursorRaw,
        tenantId: tenantIdRaw,
        branchId: branchIdRaw,
        actorRole: actorRoleRaw,
        actorStaffId: actorStaffIdRaw,
        type: typeRaw,
        requestId: requestIdRaw,
        from: fromRaw,
        to: toRaw,
      } = req.validatedQuery || req.query;

      const page = clampInt(pageRaw, 1, 1, 1000000);
      const pageSize = clampInt(pageSizeRaw, 100, 1, 200);
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 120 });

      const tenantId = sanitizeText(tenantIdRaw, { maxLen: 64 });
      const branchId = sanitizeText(branchIdRaw, { maxLen: 64 });
      const actorRole = sanitizeText(actorRoleRaw, { maxLen: 64 });
      const actorStaffId = sanitizeText(actorStaffIdRaw, { maxLen: 64 });
      const type = sanitizeText(typeRaw, { maxLen: 120 });
      const requestId = sanitizeText(requestIdRaw, { maxLen: 128 });
      const fromIso = safeDateIso(fromRaw);
      const toIsoFilter = safeDateIso(toRaw);

      const cursor = decodeCursor(cursorRaw);

      let base = db().from({ a: 'audit_log' });
      if (tenantId) base = base.where({ 'a.tenant_id': tenantId });
      if (branchId) base = base.where({ 'a.branch_id': branchId });
      if (actorRole) base = base.where({ 'a.actor_role': actorRole });
      if (actorStaffId) base = base.where({ 'a.actor_staff_id': actorStaffId });
      if (type) base = base.where({ 'a.type': type });
      if (requestId) base = base.where({ 'a.request_id': requestId });
      if (fromIso) base = base.where('a.created_at', '>=', fromIso);
      if (toIsoFilter) base = base.where('a.created_at', '<=', toIsoFilter);
      if (q) {
        base = base.andWhere((b) =>
          b
            .whereRaw('LOWER(a.type) LIKE ?', [`%${q}%`])
            .orWhereRaw('LOWER(a.summary) LIKE ?', [`%${q}%`])
            .orWhere('a.id', 'like', `%${q}%`)
        );
      }

      if (cursor) {
        base = base.andWhere((b) =>
          b
            .where('a.created_at', '<', cursor.createdAt)
            .orWhere((bb) => bb.where('a.created_at', '=', cursor.createdAt).andWhere('a.id', '<', cursor.id))
        );
      }

      let totalOut = null;
      if (!cursor) {
        const totalRow = await base.clone().count({ c: '*' }).first();
        totalOut = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;
      }

      const rows = await base
        .leftJoin({ s: 'staff' }, function joinStaff() {
          this.on('s.id', '=', 'a.actor_staff_id').andOn('s.tenant_id', '=', 'a.tenant_id');
        })
        .leftJoin({ t: 'tenants' }, 't.id', 'a.tenant_id')
        .select([
          'a.id',
          'a.request_id',
          'a.tenant_id',
          'a.branch_id',
          'a.actor_staff_id',
          'a.actor_role',
          'a.type',
          'a.summary',
          'a.payload_json',
          'a.created_at',
          's.name as actor_name',
          's.email as actor_email',
          't.name as tenant_name',
          't.plan as tenant_plan',
        ])
        .orderBy([{ column: 'a.created_at', order: 'desc' }, { column: 'a.id', order: 'desc' }])
        .limit(pageSize)
        .offset(cursor ? 0 : (page - 1) * pageSize);

      const audit = rows.map((x) => ({
        id: String(x.id),
        requestId: x.request_id ? String(x.request_id) : '',
        tenantId: x.tenant_id ? String(x.tenant_id) : '',
        tenantName: x.tenant_name ? String(x.tenant_name) : '',
        tenantPlan: x.tenant_plan ? String(x.tenant_plan) : '',
        branchId: x.branch_id ? String(x.branch_id) : 'global',
        actorStaffId: x.actor_staff_id ? String(x.actor_staff_id) : '',
        actorName: x.actor_name ? String(x.actor_name) : '',
        actorEmail: x.actor_email ? String(x.actor_email) : '',
        actorRole: x.actor_role ? String(x.actor_role) : '',
        type: String(x.type || ''),
        summary: String(x.summary || ''),
        payload: safeJsonParse(x.payload_json, null),
        at: x.created_at ? new Date(x.created_at).toISOString() : '',
      }));

      const nextCursor = rows.length
        ? encodeCursor({ createdAt: rows[rows.length - 1].created_at, id: String(rows[rows.length - 1].id) })
        : '';

      return res.json({ ok: true, audit, page, pageSize, total: totalOut, nextCursor });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/demo-requests', requireSuperadmin, validateSuperadminDemoRequestsQuery, async (req, res, next) => {
    try {
      const { status: statusRaw, q: qRaw } = req.validatedQuery || req.query;
      const status = sanitizeText(statusRaw, { maxLen: 40 });
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 120 });

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

  r.put('/superadmin/demo-requests/:id', requireSuperadmin, validateIdParam, validateSuperadminDemoRequestUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const requestId = String(id || '').trim();
      if (!requestId) return res.status(400).json({ error: 'invalid_id' });

      const { status, provisionedTenantId } = req.validatedBody || req.body;
      const normalizedStatus = typeof status === 'string' ? status.trim() : '';
      const normalizedProvisionedId = typeof provisionedTenantId === 'string' ? provisionedTenantId.trim() : '';

      const dr = await db().select(['id', 'status', 'provisioned_tenant_id', 'processed_at']).from('demo_requests').where({ id: requestId }).first();
      if (!dr) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      const nextStatus = normalizedStatus || dr.status;
      const nextProvisioned = normalizedProvisionedId || dr.provisioned_tenant_id;
      const processedAt = normalizedStatus ? nowIso : dr.processed_at;

      await db().from('demo_requests').where({ id: requestId }).update({ status: nextStatus, provisioned_tenant_id: nextProvisioned, processed_at: processedAt, updated_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/demo-requests/:id/provision', requireSuperadmin, validateIdParam, validateSuperadminDemoRequestProvision, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const requestId = String(id || '').trim();
      if (!requestId) return res.status(400).json({ error: 'invalid_id' });

      const body = req.validatedBody || req.body;
      const slug = String(body?.slug || '').trim().toLowerCase();
      const tenantName = String(body?.tenantName || '').trim();
      const ownerName = String(body?.ownerName || '').trim();
      const branchName = String(body?.branchName || '').trim();
      const ownerPassword = String(body?.ownerPassword || '').trim();
      const trialDays = Number(body?.trialDays ?? 7);

      if (!slug) return res.status(400).json({ error: 'slug_required' });
      if (!tenantName) return res.status(400).json({ error: 'tenant_name_required' });
      if (!ownerPassword) return res.status(400).json({ error: 'owner_password_required' });

      const dr = await db().select(['id', 'name', 'email', 'phone', 'company', 'country', 'source', 'message', 'meta_json', 'status']).from('demo_requests').where({ id: requestId }).first();
      if (!dr) return res.status(404).json({ error: 'not_found' });

      const provision = await provisionTenant({
        slug,
        name: tenantName,
        trialDays,
        ownerName: ownerName || String(dr.name || ''),
        ownerEmail: String(dr.email || ''),
        ownerPassword,
        branchName,
        ownerPhone: String(dr.phone || ''),
        city: String(dr.country || ''),
        address1: String(dr.company || ''),
      });

      if (!provision?.ok) return res.status(400).json({ error: provision?.error || 'provision_failed' });

      const nowIso = new Date().toISOString();
      await db().from('demo_requests').where({ id: requestId }).update({
        status: 'Provisioned',
        provisioned_tenant_id: provision.tenant?.id || null,
        processed_at: nowIso,
        updated_at: nowIso,
      });

      return res.status(201).json({ ok: true, tenant: provision.tenant, owner: provision.owner, defaultBranch: provision.defaultBranch });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/tenants/:id/users', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const tenantId = String(id || '').trim();
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
  r.get('/superadmin/tenants/:id/pos-payment-gateways', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const tenantId = String(id || '').trim();
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
            fabricAppIdMasked: maskSecret(cfg?.fabricAppId),
            merchantAppIdMasked: maskSecret(cfg?.merchantAppId),
          },
        };
      });

      return res.json({ ok: true, gateways });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tenants/:id/pos-payment-gateways/:gateway', requireSuperadmin, validateIdParam, validateSuperadminGatewayParam, validateSuperadminPosGatewayUpdate, async (req, res, next) => {
    try {
      const tenantId = String(req.params?.id || '').trim();
      if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });
      const { gateway: gatewayRaw } = req.validatedParams || req.params;
      const gateway = String(gatewayRaw || '').trim().toLowerCase();
      if (!gateway) return res.status(400).json({ error: 'gateway_required' });
      if (gateway !== 'chapa' && gateway !== 'telebirr' && gateway !== 'cbe_birr' && gateway !== 'santimpay' &&
        gateway !== 'cash' && gateway !== 'bank_transfer' && gateway !== 'check' && gateway !== 'credit_card' && gateway !== 'mobile_money' && gateway !== 'other') {
        return res.status(400).json({ error: 'invalid_gateway' });
      }

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const enabled = body?.enabled === true;
      const configPatch = body?.config && typeof body.config === 'object' ? body.config : {};

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

  r.post('/superadmin/tenants/:id/notes', requireSuperadmin, validateIdParam, validateSuperadminTenantNote, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const tenantId = String(id || '').trim();
      const { message } = req.validatedBody || req.body;
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!message) return res.status(400).json({ error: 'message_required' });

      const exists = await db().select(['id']).from('tenants').where({ id: tenantId }).first();
      if (!exists) return res.status(404).json({ error: 'not_found' });

      const nowIso = new Date().toISOString();
      const noteId = makeId('note');
      await db().from('tenant_notes').insert({ id: noteId, tenant_id: tenantId, staff_id: null, message, created_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: tenantId, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tenant.note', summary: 'Added tenant note', payload_json: JSON.stringify({ noteId }), created_at: nowIso });
      return res.status(201).json({ ok: true, noteId });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/superadmin/tenants', requireSuperadmin, validateSuperadminTenantCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const name = String(body?.name || '').trim();
      const slug = String(body?.slug || '').trim().toLowerCase();
      const tier = String(body?.tier || 'Trial').trim();

      const ownerName = typeof body?.ownerName === 'string' ? body.ownerName.trim() : '';
      const ownerEmail = typeof body?.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : '';
      const ownerPhone = typeof body?.ownerPhone === 'string' ? body.ownerPhone.trim() : '';
      const ownerPasswordRaw = typeof body?.ownerPassword === 'string' ? body.ownerPassword : '';

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
        address1: typeof body?.address1 === 'string' ? body.address1.trim() : '',
        city: typeof body?.city === 'string' ? body.city.trim() : '',
        country: typeof body?.country === 'string' ? body.country.trim() : '',
        timezone: typeof body?.timezone === 'string' ? body.timezone.trim() : '',
        currency: typeof body?.currency === 'string' ? body.currency.trim() : '',
      };

      const branchName = typeof body?.branchName === 'string' ? body.branchName.trim() : '';

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

  r.post('/superadmin/tenants/reset-creds', requireSuperadmin, validateSuperadminResetCreds, async (req, res, next) => {
    try {
      const { tenantId } = req.validatedBody || req.body;
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

  r.post('/superadmin/impersonate', requireSuperadmin, validateSuperadminImpersonate, async (req, res, next) => {
    try {
      const { tenantId, role } = req.validatedBody || req.body;
      const roleRaw = String(role || 'Cafe Owner');
      if (!tenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!config.jwtSecret) return res.status(500).json({ error: 'server_misconfigured' });

      const tenantRow = await db().select(['id', 'status']).from('tenants').where({ id: tenantId }).first();
      if (!tenantRow) return res.status(404).json({ error: 'not_found' });

      const staff = await db().select(['id', 'role_name', 'branch_id']).from('staff').where({ tenant_id: tenantId, role_name: role }).first();
      if (!staff) return res.status(404).json({ error: 'no_staff_for_role' });

      const token = jwt.sign(
        {
          tenantId,
          role: roleRaw,
          superadmin: true,
        },
        config.jwtSecret,
        { expiresIn: '15m' }
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

  r.put('/superadmin/tax-rules/:code', requireSuperadmin, validateSuperadminTaxCodeParam, validateSuperadminTaxRuleUpdate, async (req, res, next) => {
    try {
      const { code } = req.validatedParams || req.params;
      if (!code) return res.status(400).json({ error: 'code_required' });
      const existing = await db().select(['code']).from('tax_rules').where({ code }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') {
        const name = String(body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name_required' });
        patch.name = name;
      }
      if (typeof body?.ratePct !== 'undefined') {
        const ratePct = Number(body.ratePct);
        if (!Number.isFinite(ratePct)) return res.status(400).json({ error: 'rate_invalid' });
        patch.rate_pct = ratePct;
      }
      if (typeof body?.logic === 'string') patch.logic = String(body.logic) === 'inclusive' ? 'inclusive' : 'exclusive';
      if (typeof body?.status === 'string') {
        const status = String(body.status || 'active');
        if (!['active', 'suspended', 'archived'].includes(status)) return res.status(400).json({ error: 'status_invalid' });
        patch.status = status;
      }
      if (typeof body?.effectiveDate === 'string') {
        const effectiveDate = String(body.effectiveDate || '').slice(0, 10);
        if (!effectiveDate) return res.status(400).json({ error: 'effective_date_required' });
        patch.effective_date = effectiveDate;
      }
      if (typeof body?.applicabilityCategories !== 'undefined') patch.applicabilityCategories = body.applicabilityCategories;

      const { applicabilityCategories } = patch;
      const nowIso = new Date().toISOString();
      const updatePatch = { ...patch };
      delete updatePatch.applicabilityCategories;
      await db().from('tax_rules').where({ code }).update({ ...updatePatch, updated_at: nowIso });
      if (typeof applicabilityCategories !== 'undefined') {
        await db().transaction(async (trx) => {
          await trx.from('tax_rule_category_map').where({ tax_code: code }).del();
          await upsertCategoriesAndMap(trx, code, applicabilityCategories);
        });
      }

      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'tax_rule.update',
        summary: 'Updated tax rule',
        payload_json: JSON.stringify({ code, patch: { ...updatePatch, applicabilityCategories: typeof applicabilityCategories === 'undefined' ? undefined : applicabilityCategories } }),
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

  r.post('/superadmin/tax-categories', requireSuperadmin, validateSuperadminTaxCategoryCreate, async (req, res, next) => {
    try {
      const { name } = req.validatedBody || req.body;
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return res.status(400).json({ error: 'name_required' });
      const existing = await db().select(['id']).from('tax_rule_categories').where({ name: trimmedName }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });
      const nowIso = new Date().toISOString();
      const id = makeId('tcat');
      await db().from('tax_rule_categories').insert({ id, name: trimmedName, created_at: nowIso });
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tax_category.create', summary: 'Created tax category', payload_json: JSON.stringify({ id, name: trimmedName }), created_at: nowIso });
      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/tax-categories/:id', requireSuperadmin, validateSuperadminTaxCategoryIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const inUseRow = await db().from('tax_rule_category_map').where({ category_id: trimmedId }).count({ c: '*' }).first();
      const inUse = Number(inUseRow?.c ?? inUseRow?.count ?? inUseRow?.['count(*)'] ?? 0) || 0;
      if (inUse > 0) return res.status(409).json({ error: 'category_in_use' });

      const nowIso = new Date().toISOString();
      await db().from('tax_rule_categories').where({ id: trimmedId }).del();
      await db().from('audit_log').insert({ id: makeId('aud'), tenant_id: null, branch_id: null, actor_staff_id: null, actor_role: 'superadmin', type: 'tax_category.delete', summary: 'Deleted tax category', payload_json: JSON.stringify({ id: trimmedId }), created_at: nowIso });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/superadmin/tax-categories/:id', requireSuperadmin, validateSuperadminTaxCategoryIdParam, validateSuperadminTaxCategoryUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'name']).from('tax_rule_categories').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const { name } = req.validatedBody || req.body;
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return res.status(400).json({ error: 'name_required' });

      const dup = await db().select(['id']).from('tax_rule_categories').where({ name: trimmedName }).andWhereNot({ id: trimmedId }).first();
      if (dup) return res.status(409).json({ error: 'duplicate' });

      await db().from('tax_rule_categories').where({ id: trimmedId }).update({ name: trimmedName });
      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: null,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'tax_category.update',
        summary: 'Updated tax category',
        payload_json: JSON.stringify({ id: trimmedId, from: String(existing.name || ''), to: trimmedName }),
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

  r.put('/superadmin/tax-status', requireSuperadmin, validateSuperadminTaxStatusUpdate, async (req, res, next) => {
    try {
      const nowIso = new Date().toISOString();
      const patch = {};
      const body = req.validatedBody || req.body;
      if (typeof body?.fiscalPrinterStatus === 'string') patch.fiscal_printer_status = body.fiscalPrinterStatus.trim() || null;
      if (typeof body?.fiscalSignatureOk === 'boolean') patch.fiscal_signature_ok = Boolean(body.fiscalSignatureOk);
      if (typeof body?.lastErcaSyncAt === 'string') patch.last_erca_sync_at = body.lastErcaSyncAt ? new Date(body.lastErcaSyncAt) : null;
      if (typeof body?.nextErcaSyncAt === 'string') patch.next_erca_sync_at = body.nextErcaSyncAt ? new Date(body.nextErcaSyncAt) : null;
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

  r.post('/superadmin/invoices/manual', requireSuperadmin, validateSuperadminInvoiceManual, async (req, res, next) => {
    try {
      const { tenantId, description, amountEtb, dueInDays, notes } = req.validatedBody || req.body;
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedDescription = String(description || '').trim();
      const normalizedAmount = Number(amountEtb || 0);
      const normalizedDue = Number(dueInDays ?? 7);
      const normalizedNotes = typeof notes === 'string' ? String(notes) : null;

      if (!normalizedTenantId) return res.status(400).json({ error: 'tenant_required' });
      if (!normalizedDescription) return res.status(400).json({ error: 'description_required' });
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return res.status(400).json({ error: 'amount_invalid' });
      if (!Number.isFinite(normalizedDue) || normalizedDue < 0 || normalizedDue > 365) return res.status(400).json({ error: 'due_days_invalid' });

      const tenant = await db().select(['id']).from('tenants').where({ id: normalizedTenantId }).first();
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const result = await createManualInvoice({
        tenantId: normalizedTenantId,
        dueInDays: normalizedDue,
        notes: normalizedNotes,
        type: 'manual',
        lineItems: [{ description: normalizedDescription, amount: normalizedAmount }],
      });

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        tenant_id: normalizedTenantId,
        branch_id: null,
        actor_staff_id: null,
        actor_role: 'superadmin',
        type: 'invoice.manual_create',
        summary: `Created manual invoice ETB ${normalizedAmount}`,
        payload_json: JSON.stringify({ tenantId: normalizedTenantId, invoiceId: result.invoiceId, dueInDays: normalizedDue, description: normalizedDescription, amountEtb: normalizedAmount }),
        created_at: nowIso,
      });

      return res.status(201).json({ ok: true, invoice: result });
    } catch (e) {
      return next(e);
    }
  });

  // List all invoices (with filtering)
  r.get('/superadmin/invoices', requireSuperadmin, validateSuperadminInvoicesQuery, async (req, res, next) => {
    try {
      const { page: pageRaw, limit: limitRaw, status, tenantId, q, tier, from, to } = req.validatedQuery || req.query;
      const page = clampInt(pageRaw, 1, 1, 1000000);
      const limit = clampInt(limitRaw, 50, 1, 200);
      const normalizedStatus = String(status || '').trim();
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedQuery = String(q || '').trim();
      const normalizedTier = String(tier || '').trim();
      const normalizedFrom = String(from || '').trim();
      const normalizedTo = String(to || '').trim();

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');

      if (normalizedStatus) base = base.where('invoices.status', normalizedStatus);
      if (normalizedTenantId) base = base.where('invoices.tenant_id', normalizedTenantId);
      if (normalizedQuery) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${normalizedQuery}%`).orWhere('tenants.name', 'like', `%${normalizedQuery}%`);
        });
      }

      if (normalizedTier) {
        // invoices.metadata_json contains planTier for subscription invoices
        // NOTE: stored as TEXT in this schema, so use LIKE match
        const safeTier = normalizedTier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }
      if (normalizedFrom) {
        const fromDate = new Date(normalizedFrom);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (normalizedTo) {
        const toDate = new Date(normalizedTo);
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

  r.get('/superadmin/invoices/export.csv', requireSuperadmin, validateSuperadminInvoicesQuery, async (req, res, next) => {
    try {
      const { status, tenantId, q, tier, from, to, limit: limitRaw } = req.validatedQuery || req.query;
      const normalizedStatus = String(status || '').trim();
      const normalizedTenantId = String(tenantId || '').trim();
      const normalizedQuery = String(q || '').trim();
      const normalizedTier = String(tier || '').trim();
      const normalizedFrom = String(from || '').trim();
      const normalizedTo = String(to || '').trim();
      const limit = clampInt(limitRaw, 5000, 1, 20000);

      let base = db().from('invoices').leftJoin('tenants', 'invoices.tenant_id', 'tenants.id');
      if (normalizedStatus) base = base.where('invoices.status', normalizedStatus);
      if (normalizedTenantId) base = base.where('invoices.tenant_id', normalizedTenantId);
      if (normalizedQuery) {
        base = base.where((qb) => {
          qb.where('invoices.invoice_number', 'like', `%${normalizedQuery}%`).orWhere('tenants.name', 'like', `%${normalizedQuery}%`);
        });
      }

      if (normalizedTier) {
        const safeTier = normalizedTier.replace(/[%_]/g, '\\$&');
        base = base.andWhere('invoices.metadata_json', 'like', `%"planTier":"${safeTier}"%`);
      }
      if (normalizedFrom) {
        const fromDate = new Date(normalizedFrom);
        if (!Number.isNaN(fromDate.getTime())) base = base.andWhere('invoices.issue_date', '>=', fromDate.toISOString());
      }
      if (normalizedTo) {
        const toDate = new Date(normalizedTo);
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
  r.get('/superadmin/invoices/:id', requireSuperadmin, validateSuperadminInvoiceIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      console.log('[DEBUG] GET /superadmin/invoices/:id', { id: trimmedId });
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      console.log('[DEBUG] Calling getInvoiceDetails', { id: trimmedId });
      const invoice = await getInvoiceDetails(trimmedId);
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
  r.get('/superadmin/invoices/:id/pdf', requireSuperadmin, validateSuperadminInvoiceIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const invoice = await getInvoiceDetails(trimmedId);
      if (!invoice) return res.status(404).json({ error: 'not_found' });

      let pdfBuffer;
      try {
        pdfBuffer = await generateInvoicePDF(trimmedId);
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
  r.post('/superadmin/invoices/:id/verify', requireSuperadmin, validateSuperadminInvoiceIdParam, validateSuperadminInvoiceVerify, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const invoiceId = String(id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'id_required' });

      const body = req.validatedBody || req.body;
      const paymentId = String(body?.paymentId || '').trim();
      const method = String(body?.method || 'Cash').trim();

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
  r.post('/superadmin/payments/:id/reject', requireSuperadmin, validateIdParam, validateSuperadminPaymentReject, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const paymentId = String(id || '').trim();
      if (!paymentId) return res.status(400).json({ error: 'id_required' });

      const body = req.validatedBody || req.body;
      const reason = String(body?.reason || 'Rejected by admin').trim();
      const userId = 'superadmin';

      await rejectPayment({ paymentId, rejectedBy: userId, reason });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // Integration Marketplace: Catalog
  r.get('/superadmin/integrations', requireSuperadmin, validateSuperadminIntegrationsQuery, async (req, res, next) => {
    try {
      const { q: qRaw, category: categoryRaw, available: availableParam } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const category = sanitizeText(categoryRaw, { maxLen: 60 });
      const availableRaw = typeof availableParam === 'string' ? availableParam.trim().toLowerCase() : '';

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

  r.post('/superadmin/integrations', requireSuperadmin, validateSuperadminIntegrationCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('integrations_catalog').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof body?.category === 'string' ? body.category.trim() : null;
      const description = typeof body?.description === 'string' ? body.description.trim() : null;
      const integrationType = typeof body?.integrationType === 'string' ? body.integrationType.trim() : 'api_key';
      const requiredTier = typeof body?.requiredTier === 'string' ? body.requiredTier.trim() : null;
      const isAvailable = body?.isAvailable !== false;

      const configSchema = body?.configSchema && typeof body.configSchema === 'object' ? body.configSchema : null;
      const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};

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

  r.put('/superadmin/integrations/:id', requireSuperadmin, validateIdParam, validateSuperadminIntegrationUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.description === 'string') patch.description = body.description.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim();
      if (typeof body?.integrationType === 'string') patch.integration_type = body.integrationType.trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'isAvailable')) patch.is_available = body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'requiredTier')) patch.required_tier = typeof body.requiredTier === 'string' ? body.requiredTier.trim() : null;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'configSchema')) {
        const v = body.configSchema;
        patch.config_schema_json = v && typeof v === 'object' ? JSON.stringify(v) : null;
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'meta')) {
        const v = body.meta;
        patch.meta_json = v && typeof v === 'object' ? JSON.stringify(v) : JSON.stringify({});
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('integrations_catalog').where({ id: trimmedId }).update(patch);

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'integrations.update',
        summary: `Updated integration ${String(existing.code || trimmedId)}`,
        payload_json: JSON.stringify({ integrationId: trimmedId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/integrations/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_integrations').where({ integration_id: trimmedId }).del();
      await db().from('integrations_catalog').where({ id: trimmedId }).del();

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'integrations.delete',
        summary: `Deleted integration ${String(existing.code || trimmedId)}`,
        payload_json: JSON.stringify({ integrationId: trimmedId }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get('/superadmin/integrations/:id/tenants', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const integ = await db().select(['id', 'code', 'name']).from('integrations_catalog').where({ id: trimmedId }).first();
      if (!integ) return res.status(404).json({ error: 'not_found' });

      const rows = await db()
        .from({ ti: 'tenant_integrations' })
        .leftJoin({ t: 'tenants' }, 't.id', 'ti.tenant_id')
        .select(['ti.id', 'ti.tenant_id', 't.name as tenant_name', 't.slug as tenant_slug', 'ti.status', 'ti.installed_at', 'ti.updated_at'])
        .where({ 'ti.integration_id': trimmedId })
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
  r.get('/superadmin/addons', requireSuperadmin, validateSuperadminAddonQuery, async (req, res, next) => {
    try {
      const { q: qRaw, category: categoryRaw, available: availableParam } = req.validatedQuery || req.query;
      const q = sanitizeLikeInput(qRaw, { lower: true, maxLen: 80 });
      const category = sanitizeText(categoryRaw, { maxLen: 60 });
      const availableRaw = typeof availableParam === 'string' ? availableParam.trim().toLowerCase() : '';

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

  r.post('/superadmin/addons', requireSuperadmin, validateSuperadminAddonCreate, async (req, res, next) => {
    try {
      const body = req.validatedBody || req.body;
      const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!code) return res.status(400).json({ error: 'code_required' });
      if (!name) return res.status(400).json({ error: 'name_required' });

      const existing = await db().select(['id']).from('addon_packages').where({ code }).first();
      if (existing) return res.status(409).json({ error: 'duplicate' });

      const category = typeof body?.category === 'string' ? body.category.trim() : null;
      const description = typeof body?.description === 'string' ? body.description.trim() : null;
      const availabilityTier = typeof body?.availabilityTier === 'string' ? body.availabilityTier.trim() : null;
      const isAvailable = body?.isAvailable !== false;

      const pricing = body?.pricing && typeof body.pricing === 'object' ? body.pricing : {};
      const monthlyEtb = Number(pricing.monthlyEtb || 0) || 0;
      const yearlyEtb = Number(pricing.yearlyEtb || 0) || 0;
      const setupFeeEtb = Number(pricing.setupFeeEtb || 0) || 0;
      if (monthlyEtb < 0 || yearlyEtb < 0 || setupFeeEtb < 0) return res.status(400).json({ error: 'invalid_pricing' });

      const modules = Array.isArray(body?.modules) ? body.modules.map(String).filter(Boolean) : [];
      const limits = body?.limits && typeof body.limits === 'object' ? body.limits : {};
      const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};

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

  r.put('/superadmin/addons/:id', requireSuperadmin, validateIdParam, validateSuperadminAddonUpdate, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const body = req.validatedBody || req.body;
      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim();
      if (typeof body?.description === 'string') patch.description = body.description.trim();
      if (typeof body?.category === 'string') patch.category = body.category.trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'isAvailable')) patch.is_available = body.isAvailable ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'availabilityTier')) {
        patch.availability_tier = typeof body.availabilityTier === 'string' ? body.availabilityTier.trim() : null;
      }

      if (body?.pricing && typeof body.pricing === 'object') {
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'monthlyEtb')) {
          const v = Number(body.pricing.monthlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_monthly_price' });
          patch.price_monthly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'yearlyEtb')) {
          const v = Number(body.pricing.yearlyEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_yearly_price' });
          patch.price_yearly_etb = v;
        }
        if (Object.prototype.hasOwnProperty.call(body.pricing, 'setupFeeEtb')) {
          const v = Number(body.pricing.setupFeeEtb || 0);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'invalid_setup_fee' });
          patch.setup_fee_etb = v;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body || {}, 'modules')) {
        const modules = Array.isArray(body.modules) ? body.modules.map(String).filter(Boolean) : [];
        patch.modules_json = JSON.stringify(modules);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'limits')) {
        const limits = body.limits && typeof body.limits === 'object' ? body.limits : {};
        patch.limits_json = JSON.stringify(limits);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'meta')) {
        const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
        patch.meta_json = JSON.stringify(meta);
      }

      const nowIso = new Date().toISOString();
      patch.updated_at = nowIso;
      await db().from('addon_packages').where({ id: trimmedId }).update(patch);

      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'addons.update',
        summary: `Updated add-on ${String(existing.code || trimmedId)}`,
        payload_json: JSON.stringify({ addonId: trimmedId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') }),
        created_at: nowIso,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete('/superadmin/addons/:id', requireSuperadmin, validateIdParam, async (req, res, next) => {
    try {
      const { id } = req.validatedParams || req.params;
      const trimmedId = String(id || '').trim();
      if (!trimmedId) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'code']).from('addon_packages').where({ id: trimmedId }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      await db().from('tenant_addon_subscriptions').where({ addon_id: trimmedId }).del();
      await db().from('addon_packages').where({ id: trimmedId }).del();

      const nowIso = new Date().toISOString();
      await db().from('audit_log').insert({
        id: makeId('aud'),
        actor_role: 'superadmin',
        type: 'addons.delete',
        summary: `Deleted add-on ${String(existing.code || trimmedId)}`,
        payload_json: JSON.stringify({ addonId: trimmedId }),
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
