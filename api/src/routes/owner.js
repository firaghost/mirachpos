const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db } = require('../db');
const { logAudit } = require('../utils/logger');
const { sanitizeLikeInput, sanitizeText } = require('../utils/sanitize');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { uid } = require('../utils/ids');
const { safeJsonParse, safeJsonStringify } = require('../utils/errors');
const { decryptConfigFields } = require('../utils/secretEncryption');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { resolveCdnUrl } = require('../utils/cdn');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { computeTenantEntitlements, normalizeModules, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');
const { publish } = require('../services/realtimeHub');
const { makeOwnerMenuRouter } = require('./owner/menu');
const { makeOwnerIntegrationsRouter } = require('./owner/integrations');
const { makeOwnerSettingsRouter } = require('./owner/settings');
const { makeOwnerModulesRouter } = require('./owner/modules');
const { makeOwnerProfileRouter } = require('./owner/profile');
const { makeOwnerDashboardRouter } = require('./owner/dashboard');
const { makeOwnerInventoryRouter } = require('./owner/inventory');
const { makeOwnerFinanceRouter } = require('./owner/finance');

const clampInt = (n, min, max, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
};

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

const addMonths = (d, months) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
};

const startOfMonthIso = (d) => {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
};

const endOfMonthIso = (d) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
};

const startOfYearIso = (d) => {
  const x = new Date(d);
  x.setMonth(0, 1);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
};

const endOfYearIso = (d) => {
  const x = new Date(d);
  x.setMonth(11, 31);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
};

const yyyyMmDd = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
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

const normalizeOwnerSettings = (body, prev) => {
  const incoming = body && typeof body === 'object' ? body : {};
  const base = prev && typeof prev === 'object' ? prev : {};

  const clampNum = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const toBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const toStr = (v, fallback) => (typeof v === 'string' ? v : fallback);

  const businessIn = incoming.business && typeof incoming.business === 'object' ? incoming.business : {};
  const businessPrev = base.business && typeof base.business === 'object' ? base.business : {};
  const business = {
    businessName: String(toStr(businessIn.businessName, businessPrev.businessName || '')).trim(),
    legalName: String(toStr(businessIn.legalName, businessPrev.legalName || '')).trim(),
    tin: String(toStr(businessIn.tin, businessPrev.tin || '')).trim(),
    phone: String(toStr(businessIn.phone, businessPrev.phone || '')).trim(),
    email: String(toStr(businessIn.email, businessPrev.email || '')).trim(),
    address: String(toStr(businessIn.address, businessPrev.address || '')).trim(),
    currency: String(toStr(businessIn.currency, businessPrev.currency || 'ETB')).trim() || 'ETB',
    timezone: String(toStr(businessIn.timezone, businessPrev.timezone || 'Africa/Addis_Ababa')).trim() || 'Africa/Addis_Ababa',
  };

  const receiptIn = incoming.receipt && typeof incoming.receipt === 'object' ? incoming.receipt : {};
  const receiptPrev = base.receipt && typeof base.receipt === 'object' ? base.receipt : {};
  const receipt = {
    header: String(toStr(receiptIn.header, receiptPrev.header || '')).trim(),
    footer1: String(toStr(receiptIn.footer1, receiptPrev.footer1 || '')).trim(),
    footer2: String(toStr(receiptIn.footer2, receiptPrev.footer2 || '')).trim(),
    showTin: toBool(receiptIn.showTin, typeof receiptPrev.showTin === 'boolean' ? receiptPrev.showTin : true),
    showBranchName: toBool(receiptIn.showBranchName, typeof receiptPrev.showBranchName === 'boolean' ? receiptPrev.showBranchName : true),
    logoDataUrl: String(toStr(receiptIn.logoDataUrl, receiptPrev.logoDataUrl || '')).trim(),
  };

  const taxesIn = incoming.taxes && typeof incoming.taxes === 'object' ? incoming.taxes : {};
  const taxesPrev = base.taxes && typeof base.taxes === 'object' ? base.taxes : {};
  const taxes = {
    vatEnabled: toBool(taxesIn.vatEnabled, typeof taxesPrev.vatEnabled === 'boolean' ? taxesPrev.vatEnabled : true),
    vatRate: clampNum(taxesIn.vatRate, 0, 40, clampNum(taxesPrev.vatRate, 0, 40, 15)),
    serviceChargeEnabled: toBool(taxesIn.serviceChargeEnabled, typeof taxesPrev.serviceChargeEnabled === 'boolean' ? taxesPrev.serviceChargeEnabled : false),
    serviceChargeRate: clampNum(taxesIn.serviceChargeRate, 0, 40, clampNum(taxesPrev.serviceChargeRate, 0, 40, 0)),
  };

  const prefsIn = incoming.preferences && typeof incoming.preferences === 'object' ? incoming.preferences : {};
  const prefsPrev = base.preferences && typeof base.preferences === 'object' ? base.preferences : {};
  const preferences = {
    language: String(toStr(prefsIn.language, prefsPrev.language || 'en')).trim() || 'en',
    enableSounds: toBool(prefsIn.enableSounds, typeof prefsPrev.enableSounds === 'boolean' ? prefsPrev.enableSounds : true),
    enableOfflineMode: toBool(prefsIn.enableOfflineMode, typeof prefsPrev.enableOfflineMode === 'boolean' ? prefsPrev.enableOfflineMode : false),
    roundingMode: String(toStr(prefsIn.roundingMode, prefsPrev.roundingMode || 'none')).trim() || 'none',
  };

  const secIn = incoming.security && typeof incoming.security === 'object' ? incoming.security : {};
  const secPrev = base.security && typeof base.security === 'object' ? base.security : {};
  const security = {
    requirePinForRefunds: toBool(secIn.requirePinForRefunds, typeof secPrev.requirePinForRefunds === 'boolean' ? secPrev.requirePinForRefunds : false),
    requirePinForDiscounts: toBool(secIn.requirePinForDiscounts, typeof secPrev.requirePinForDiscounts === 'boolean' ? secPrev.requirePinForDiscounts : false),
    sessionTimeoutMins: Math.trunc(clampNum(secIn.sessionTimeoutMins, 5, 1440, clampNum(secPrev.sessionTimeoutMins, 5, 1440, 120))),
  };

  const payIn = incoming.payments && typeof incoming.payments === 'object' ? incoming.payments : null;
  const payPrev = base.payments && typeof base.payments === 'object' ? base.payments : null;
  const normalizeMethods = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const m of arr) {
      if (!m || typeof m !== 'object') continue;
      const id = String(m.id || '').trim();
      if (!id) continue;
      out.push({ id, label: String(m.label || id).trim() || id, enabled: !!m.enabled });
    }
    return out;
  };
  const payments = payIn || payPrev
    ? {
        allowSplitPayments: toBool(payIn?.allowSplitPayments, toBool(payPrev?.allowSplitPayments, false)),
        methods: normalizeMethods(payIn?.methods ?? payPrev?.methods ?? []),
      }
    : undefined;

  const bdIn = incoming.branchDefaults && typeof incoming.branchDefaults === 'object' ? incoming.branchDefaults : null;
  const bdPrev = base.branchDefaults && typeof base.branchDefaults === 'object' ? base.branchDefaults : null;
  const branchDefaults = bdIn || bdPrev
    ? {
        defaultStatus: String(toStr(bdIn?.defaultStatus, toStr(bdPrev?.defaultStatus, 'Open'))).trim() || 'Open',
        defaultCity: String(toStr(bdIn?.defaultCity, toStr(bdPrev?.defaultCity, ''))).trim(),
        defaultRegion: String(toStr(bdIn?.defaultRegion, toStr(bdPrev?.defaultRegion, ''))).trim(),
        defaultCountry: String(toStr(bdIn?.defaultCountry, toStr(bdPrev?.defaultCountry, 'Ethiopia'))).trim() || 'Ethiopia',
        defaultCurrency: String(toStr(bdIn?.defaultCurrency, toStr(bdPrev?.defaultCurrency, 'ETB'))).trim() || 'ETB',
        defaultVatEnabled: toBool(bdIn?.defaultVatEnabled, toBool(bdPrev?.defaultVatEnabled, taxes.vatEnabled)),
        defaultVatRate: clampNum(bdIn?.defaultVatRate, 0, 40, clampNum(bdPrev?.defaultVatRate, 0, 40, taxes.vatRate)),
        defaultServiceChargeEnabled: toBool(bdIn?.defaultServiceChargeEnabled, toBool(bdPrev?.defaultServiceChargeEnabled, taxes.serviceChargeEnabled)),
        defaultServiceChargeRate: clampNum(bdIn?.defaultServiceChargeRate, 0, 40, clampNum(bdPrev?.defaultServiceChargeRate, 0, 40, taxes.serviceChargeRate)),
      }
    : undefined;

  const polIn = incoming.policies && typeof incoming.policies === 'object' ? incoming.policies : null;
  const polPrev = base.policies && typeof base.policies === 'object' ? base.policies : null;
  const policies = polIn || polPrev
    ? {
        pinMinLength: Math.trunc(clampNum(polIn?.pinMinLength, 2, 12, clampNum(polPrev?.pinMinLength, 2, 12, 4))),
        pinMaxLength: Math.trunc(clampNum(polIn?.pinMaxLength, 2, 12, clampNum(polPrev?.pinMaxLength, 2, 12, 6))),
        maxDiscountPctWithoutApproval: clampNum(polIn?.maxDiscountPctWithoutApproval, 0, 100, clampNum(polPrev?.maxDiscountPctWithoutApproval, 0, 100, 20)),
        refundsRequireManager: toBool(polIn?.refundsRequireManager, toBool(polPrev?.refundsRequireManager, true)),
        voidsRequireManager: toBool(polIn?.voidsRequireManager, toBool(polPrev?.voidsRequireManager, true)),
      }
    : undefined;

  if (policies && policies.pinMaxLength < policies.pinMinLength) {
    policies.pinMaxLength = policies.pinMinLength;
  }

  const notifIn = incoming.notifications && typeof incoming.notifications === 'object' ? incoming.notifications : null;
  const notifPrev = base.notifications && typeof base.notifications === 'object' ? base.notifications : null;
  const notifications = notifIn || notifPrev
    ? {
        channels: {
          inApp: toBool(notifIn?.channels?.inApp, toBool(notifPrev?.channels?.inApp, true)),
          email: toBool(notifIn?.channels?.email, toBool(notifPrev?.channels?.email, false)),
          sms: toBool(notifIn?.channels?.sms, toBool(notifPrev?.channels?.sms, false)),
        },
        rules: {
          lowStockAlerts: toBool(notifIn?.rules?.lowStockAlerts, toBool(notifPrev?.rules?.lowStockAlerts, true)),
          dailySummary: toBool(notifIn?.rules?.dailySummary, toBool(notifPrev?.rules?.dailySummary, false)),
          paymentFailures: toBool(notifIn?.rules?.paymentFailures, toBool(notifPrev?.rules?.paymentFailures, true)),
          staffLoginAlerts: toBool(notifIn?.rules?.staffLoginAlerts, toBool(notifPrev?.rules?.staffLoginAlerts, false)),
        },
        emails: {
          recipients: Array.isArray(notifIn?.emails?.recipients)
            ? notifIn.emails.recipients.map(String).map((s) => s.trim()).filter(Boolean)
            : Array.isArray(notifPrev?.emails?.recipients)
              ? notifPrev.emails.recipients.map(String).map((s) => s.trim()).filter(Boolean)
              : [],
        },
      }
    : undefined;

  const out = {
    ...base,
    business,
    receipt,
    taxes,
    preferences,
    security,
  };
  if (payments) out.payments = payments;
  if (branchDefaults) out.branchDefaults = branchDefaults;
  if (policies) out.policies = policies;
  if (notifications) out.notifications = notifications;
  out.updatedAt = new Date().toISOString();
  return out;
};

const makeOwnerRouter = () => {
  const r = express.Router();

  const requireOwnerAuth = (req, res) => {
    if (!req.auth?.staffId) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  r.use(makeOwnerMenuRouter({ requireOwnerAuth, clampInt, publish }));
  r.use(makeOwnerIntegrationsRouter({ requireOwnerAuth }));
  r.use(makeOwnerSettingsRouter({ requireOwnerAuth, normalizeOwnerSettings }));
  r.use(makeOwnerModulesRouter({ requireOwnerAuth }));
  r.use(makeOwnerProfileRouter({ requireOwnerAuth }));
  r.use(makeOwnerDashboardRouter({ requireOwnerAuth, clampInt }));
  r.use(makeOwnerInventoryRouter({ requireOwnerAuth }));
  r.use(makeOwnerFinanceRouter({ requireOwnerAuth, clampInt }));

  r.get(
    '/owner/pos-payment-gateways',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const rows = await db()
        .from('tenant_pos_payment_gateways')
        .select(['gateway', 'enabled', 'config_json', 'updated_at'])
        .where({ tenant_id: req.tenant.id })
        .orderBy('gateway', 'asc');

      const secretFieldsByGateway = {
        chapa: ['secretKey', 'webhookSecret', 'publicKey'],
        telebirr: ['fabricAppId', 'merchantAppId', 'merchantCode', 'privateKey'],
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
        const secretKey = typeof cfg?.secretKey === 'string' ? cfg.secretKey : '';
        const webhookSecret = typeof cfg?.webhookSecret === 'string' ? cfg.webhookSecret : '';
        const mask = (s) => {
          const v = String(s || '');
          if (!v) return '';
          if (v.length <= 8) return '********';
          return `${v.slice(0, 4)}****${v.slice(-4)}`;
        };
        return {
          gateway: String(r0.gateway || ''),
          enabled: Boolean(r0.enabled),
          updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
          config: {
            secretKeyMasked: mask(secretKey),
            webhookSecretMasked: mask(webhookSecret),
          },
        };
      });

      return res.json({ ok: true, gateways });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/pos-payment-gateways/:gateway',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const gateway = String(req.params?.gateway || '').trim().toLowerCase();
      if (!gateway) return res.status(400).json({ error: 'gateway_required' });
      if (gateway !== 'chapa' && gateway !== 'telebirr' && gateway !== 'santimpay') {
        return res.status(400).json({ error: 'invalid_gateway' });
      }

      const enabled = req.body?.enabled === true;

      // Tenants are not allowed to set gateway secrets. Super Admin only.
      if (req.body && typeof req.body === 'object' && req.body.config && typeof req.body.config === 'object') {
        const cfg = req.body.config;
        if (cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0) {
          return res.status(403).json({ error: 'forbidden', message: 'Only Super Admin can configure payment gateway credentials.' });
        }
      }

      const nowIso = new Date().toISOString();

      // Preserve existing secrets (set by Super Admin).
      const existing = await db()
        .from('tenant_pos_payment_gateways')
        .select(['config_json'])
        .where({ tenant_id: req.tenant.id, gateway })
        .first();
      const prevCfg = safeJsonParse(existing?.config_json, {});

      const nextCfg = prevCfg && typeof prevCfg === 'object' ? prevCfg : {};

      await db()
        .from('tenant_pos_payment_gateways')
        .insert({
          tenant_id: req.tenant.id,
          gateway,
          enabled: enabled ? 1 : 0,
          config_json: JSON.stringify(nextCfg),
          updated_at: nowIso,
        })
        .onConflict(['tenant_id', 'gateway'])
        .merge({
          enabled: enabled ? 1 : 0,
          config_json: JSON.stringify(nextCfg),
          updated_at: nowIso,
        });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.pos_payment_gateways.update',
        summary: `Updated POS payment gateway: ${gateway}`,
        payload: { gateway, enabled },
        requestId: req.requestId,
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/plans',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
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
        updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, plans });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/system/hard-reset',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const confirm = typeof body?.confirm === 'string' ? body.confirm.trim() : '';
      if (confirm !== 'WIPE_TENANT_DATA') return res.status(400).json({ error: 'confirm_required' });

      const tenantId = String(req.tenant.id);
      const keepStaffId = String(req.auth.staffId);
      const nowIso = new Date().toISOString();

      // NOTE: This is intentionally destructive. We keep the tenant record and the current owner staff
      // so you don't lock yourself out. Everything else tenant-scoped is wiped.
      const result = await db().transaction(async (trx) => {
        const counts = {};
        const del = async (table, where) => {
          try {
            const n = await trx.from(table).where(where).del();
            counts[table] = (counts[table] || 0) + (Number(n || 0) || 0);
          } catch {
            // ignore missing tables or schema differences
          }
        };

        // Child/aux tables first
        await del('notification_reads', { tenant_id: tenantId });
        await del('audit_log', { tenant_id: tenantId });
        await del('branch_events', { tenant_id: tenantId });
        await del('sync_drafts', { tenant_id: tenantId });
        await del('sync_events', { tenant_id: tenantId });
        await del('idempotency_keys', { tenant_id: tenantId });
        await del('events', { tenant_id: tenantId });
        await del('shift_logs', { tenant_id: tenantId });
        await del('schedules_by_week', { tenant_id: tenantId });

        // POS / orders
        await del('orders', { tenant_id: tenantId });
        await del('restaurant_tables', { tenant_id: tenantId });
        await del('restaurant_table_reservations', { tenant_id: tenantId });
        await del('order_items', { tenant_id: tenantId });
        await del('order_splits', { tenant_id: tenantId });
        await del('order_split_items', { tenant_id: tenantId });
        await del('order_payments', { tenant_id: tenantId });
        await del('order_payments_splits', { tenant_id: tenantId });

        // Menu / inventory / suppliers / customers
        await del('menu_recipes', { tenant_id: tenantId });
        await del('menu_products', { tenant_id: tenantId });
        await del('inventory_items', { tenant_id: tenantId });
        await del('suppliers', { tenant_id: tenantId });
        await del('customers', { tenant_id: tenantId });

        // Guests
        await del('guests_transactions', { tenant_id: tenantId });
        await del('guests_profiles', { tenant_id: tenantId });

        // Finance / reports (best-effort)
        await del('finance_accounts', { tenant_id: tenantId });
        await del('finance_transactions', { tenant_id: tenantId });
        await del('finance_expenses', { tenant_id: tenantId });
        await del('finance_ledger', { tenant_id: tenantId });
        await del('void_refund_log', { tenant_id: tenantId });
        await del('daily_sales_summary', { tenant_id: tenantId });
        await del('hourly_sales_summary', { tenant_id: tenantId });
        await del('product_sales_summary', { tenant_id: tenantId });
        await del('category_sales_summary', { tenant_id: tenantId });
        await del('shift_reports', { tenant_id: tenantId });

        // Billing/subscription tenant-scoped
        await del('billing_notifications', { tenant_id: tenantId });
        await del('tenant_payment_prefs', { tenant_id: tenantId });
        await del('subscription_history', { tenant_id: tenantId });
        await del('payments', { tenant_id: tenantId });
        await del('invoices', { tenant_id: tenantId });
        await del('subscription_requests', { tenant_id: tenantId });
        await del('tenant_subscription', { tenant_id: tenantId });

        // Tenant profile / settings
        await del('owner_onboarding', { tenant_id: tenantId });
        await del('tenant_entitlements', { tenant_id: tenantId });
        await del('tenant_entitlements_snapshot', { tenant_id: tenantId });
        await del('tenant_profile', { tenant_id: tenantId });
        await del('manager_settings', { tenant_id: tenantId });
        await del('platform_settings', { tenant_id: tenantId });
        await del('branch_metadata', { tenant_id: tenantId });

        // Staff/roles/branches: keep only current owner staff
        await del('refresh_tokens', { tenant_id: tenantId });
        await trx
          .from('staff')
          .where({ tenant_id: tenantId })
          .andWhere('id', '!=', keepStaffId)
          .del();
        await del('roles', { tenant_id: tenantId });
        await del('branches', { tenant_id: tenantId });
        await del('owner_invites', { tenant_id: tenantId });

        // Record the reset as an audit row (best-effort)
        try {
          await logAudit({
            tenantId,
            branchId: null,
            actorStaffId: keepStaffId,
            actorRole: String(req.auth?.role || ''),
            type: 'owner.system.hard_reset',
            summary: 'Tenant hard reset executed',
            payload: { tenantId, keepStaffId },
            requestId: req.requestId,
          });
        } catch {
          // ignore
        }

        return counts;
      });

      return res.json({ ok: true, tenantId: req.tenant.id, resetAt: nowIso, deleted: result });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/uploads/image',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const dataUrl = String(req.body?.dataUrl || '').trim();
      const filename = String(req.body?.filename || '').trim();
      if (!dataUrl.startsWith('data:')) return res.status(400).json({ error: 'invalid_dataUrl' });

      const m = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'invalid_dataUrl' });
      const mime = String(m[1] || '').toLowerCase();
      const b64 = String(m[2] || '');

      const allowed = new Map([
        ['image/png', 'png'],
        ['image/jpeg', 'jpg'],
        ['image/jpg', 'jpg'],
        ['image/webp', 'webp'],
        ['image/gif', 'gif'],
      ]);
      const ext = allowed.get(mime);
      if (!ext) return res.status(400).json({ error: 'unsupported_image_type' });

      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'empty_file' });
      if (buf.length > 1024 * 1024 * 2) return res.status(400).json({ error: 'file_too_large' });

      const safeTenant = String(req.tenant.id || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '_');
      const baseDir = path.join(__dirname, '..', '..', 'uploads', safeTenant);
      fs.mkdirSync(baseDir, { recursive: true });

      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const outName = `${hash}.${ext}`;
      const outPath = path.join(baseDir, outName);

      if (!fs.existsSync(outPath)) {
        try {
          fs.writeFileSync(outPath, buf, { flag: 'wx' });
        } catch (e) {
          if (!fs.existsSync(outPath)) throw e;
        }
      }

      const url = resolveCdnUrl(`/api/uploads/${safeTenant}/${outName}`);
      return res.status(201).json({ ok: true, url });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeOwnerRouter };
