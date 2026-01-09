const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db } = require('../db');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { safeJsonParse, safeJsonStringify } = require('../utils/errors');
const { logAudit } = require('../utils/logger');
const { decryptConfigFields } = require('../utils/secretEncryption');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { computeTenantEntitlements, normalizeModules, upsertTenantEntitlementsSnapshot } = require('../services/entitlements');

const clampInt = (n, min, max, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
};

const slugCode = (name) => {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  return s.slice(0, 8);
};

const ensureUniqueMenuCode = async (tenantId, desired, fallbackName) => {
  const base = slugCode(desired) || slugCode(fallbackName) || 'ITEM';
  const rows = await db().select(['id', 'product_json']).from('menu_products').where({ tenant_id: tenantId });
  const used = new Set();
  for (const r of rows) {
    const pj = safeJsonParse(r.product_json, {});
    const c = String(pj?.code || '').trim().toUpperCase();
    if (c) used.add(c);
  }
  if (!used.has(base)) return base;
  for (let i = 2; i <= 999; i++) {
    const cand = `${base}${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${base}${String(uid('c')).slice(-6).toUpperCase()}`;
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
  if (t === 'Basic') return ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings'];
  if (t === 'Pro') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
  if (t === 'Enterprise') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
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

  // Integration Marketplace: Available + Installed
  r.get(
    '/owner/integrations/available',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';

      const base = db().from('integrations_catalog').where({ is_available: 1 });
      if (category) base.andWhere({ category });
      if (q) base.andWhere((qb) => qb.whereRaw('LOWER(code) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(name) LIKE ?', [`%${q}%`]).orWhereRaw('LOWER(category) LIKE ?', [`%${q}%`]));

      const rows = await base
        .select(['id', 'code', 'name', 'description', 'category', 'integration_type', 'required_tier', 'config_schema_json', 'meta_json', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(300);

      const integrations = (rows || []).map((r0) => ({
        id: String(r0.id),
        code: String(r0.code || ''),
        name: String(r0.name || ''),
        description: r0.description != null ? String(r0.description) : '',
        category: r0.category != null ? String(r0.category) : '',
        integrationType: String(r0.integration_type || 'api_key'),
        requiredTier: r0.required_tier != null ? String(r0.required_tier) : null,
        configSchema: safeJsonParse(r0.config_schema_json, null),
        meta: safeJsonParse(r0.meta_json, {}),
        updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, integrations });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/integrations',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      const rows = await db()
        .from({ ti: 'tenant_integrations' })
        .leftJoin({ ic: 'integrations_catalog' }, 'ic.id', 'ti.integration_id')
        .select([
          'ti.id',
          'ti.integration_id',
          'ti.status',
          'ti.config_json',
          'ti.installed_at',
          'ti.updated_at',
          'ic.code',
          'ic.name',
          'ic.category',
          'ic.integration_type',
          'ic.is_available',
        ])
        .where({ 'ti.tenant_id': req.tenant.id })
        .orderBy('ti.updated_at', 'desc')
        .limit(500);

      const installed = (rows || []).map((r0) => ({
        id: String(r0.id),
        integrationId: String(r0.integration_id || ''),
        code: r0.code != null ? String(r0.code) : '',
        name: r0.name != null ? String(r0.name) : '',
        category: r0.category != null ? String(r0.category) : '',
        integrationType: r0.integration_type != null ? String(r0.integration_type) : '',
        isAvailable: Boolean(r0.is_available),
        status: String(r0.status || 'installed'),
        config: safeJsonParse(r0.config_json, {}),
        installedAt: r0.installed_at ? new Date(r0.installed_at).toISOString() : '',
        updatedAt: r0.updated_at ? new Date(r0.updated_at).toISOString() : '',
      }));

      return res.json({ ok: true, installed });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/integrations/:id/install',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const integrationId = String(req.params?.id || '').trim();
      if (!integrationId) return res.status(400).json({ error: 'id_required' });

      const ic = await db().select(['id', 'is_available']).from('integrations_catalog').where({ id: integrationId }).first();
      if (!ic) return res.status(404).json({ error: 'not_found' });
      if (!ic.is_available) return res.status(409).json({ error: 'not_available' });

      const nowIso = new Date().toISOString();
      const id = uid('tint');
      const configJson = safeJsonStringify(req.body?.config && typeof req.body.config === 'object' ? req.body.config : {});

      try {
        await db().from('tenant_integrations').insert({
          id,
          tenant_id: req.tenant.id,
          integration_id: integrationId,
          status: 'installed',
          config_json: configJson,
          secrets_json: null,
          installed_at: nowIso,
          updated_at: nowIso,
        });
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) return res.status(409).json({ error: 'already_installed' });
        throw e;
      }

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.integrations.install',
        summary: 'Installed integration',
        payload: { integrationId },
      });

      return res.status(201).json({ ok: true, id });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/integrations/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const integrationId = String(req.params?.id || '').trim();
      if (!integrationId) return res.status(400).json({ error: 'id_required' });

      const row = await db()
        .select(['id', 'config_json', 'status'])
        .from('tenant_integrations')
        .where({ tenant_id: req.tenant.id, integration_id: integrationId })
        .first();
      if (!row) return res.status(404).json({ error: 'not_installed' });

      const patch = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
        const s = String(req.body.status || '').trim();
        if (s) patch.status = s;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'config')) {
        const cfg = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
        patch.config_json = safeJsonStringify(cfg);
      }

      await db().from('tenant_integrations').where({ id: String(row.id) }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.integrations.update',
        summary: 'Updated integration config',
        payload: { integrationId, keys: Object.keys(patch).filter((k) => k !== 'updated_at') },
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  // POS Payment Gateways (Tenant-owned credentials)
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
      if (gateway !== 'chapa' && gateway !== 'telebirr' && gateway !== 'cbe_birr' && gateway !== 'santimpay') {
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
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete(
    '/owner/integrations/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const integrationId = String(req.params?.id || '').trim();
      if (!integrationId) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('tenant_integrations').where({ tenant_id: req.tenant.id, integration_id: integrationId }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.integrations.uninstall',
        summary: 'Uninstalled integration',
        payload: { integrationId },
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
        await del('pos_state', { tenant_id: tenantId });

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
          await trx.from('audit_log').insert({
            id: uid('aud'),
            tenant_id: tenantId,
            branch_id: null,
            actor_staff_id: keepStaffId,
            actor_role: String(req.auth?.role || ''),
            type: 'owner.system.hard_reset',
            summary: 'Tenant hard reset executed',
            payload_json: JSON.stringify({ tenantId, keepStaffId }),
            created_at: nowIso,
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

  r.get(
    '/owner/profile',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const staff = await db()
        .select(['id', 'name', 'email', 'phone', 'status', 'role_name', 'branch_id', 'created_at', 'last_login_at'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, id: String(req.auth.staffId) })
        .first();

      if (!staff) return res.status(404).json({ error: 'staff_not_found' });

      return res.json({
        ok: true,
        tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name, status: req.tenant.status },
        profile: {
          id: staff.id,
          name: staff.name,
          email: staff.email,
          phone: staff.phone || '',
          status: staff.status,
          role: staff.role_name,
          branchId: staff.branch_id || 'global',
          createdAt: staff.created_at || null,
          lastLoginAt: staff.last_login_at || null,
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/profile',
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
      const profile = body && body.profile && typeof body.profile === 'object' ? body.profile : null;
      if (!profile) return res.status(400).json({ error: 'invalid_profile' });

      const normalized = {
        contactEmail: typeof profile.contactEmail === 'string' ? profile.contactEmail.trim() : '',
        contactPhone: typeof profile.contactPhone === 'string' ? profile.contactPhone.trim() : '',
        address1: typeof profile.address1 === 'string' ? profile.address1.trim() : '',
        city: typeof profile.city === 'string' ? profile.city.trim() : '',
        country: typeof profile.country === 'string' ? profile.country.trim() : '',
        timezone: typeof profile.timezone === 'string' ? profile.timezone.trim() : '',
        currency: typeof profile.currency === 'string' ? profile.currency.trim() : '',
      };

      const nowIso = new Date().toISOString();
      await db()
        .from('tenant_profile')
        .insert({ tenant_id: req.tenant.id, profile_json: JSON.stringify(normalized), updated_at: nowIso })
        .onConflict('tenant_id')
        .merge({ profile_json: JSON.stringify(normalized), updated_at: nowIso });

      return res.json({ ok: true, profile: normalized });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/onboarding',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const onboardingRow = await db()
        .select(['completed', 'completed_at'])
        .from('owner_onboarding')
        .where({ tenant_id: req.tenant.id })
        .first();
      const completed = onboardingRow ? Boolean(onboardingRow.completed) : false;

      const profileRow = await db().select(['profile_json']).from('tenant_profile').where({ tenant_id: req.tenant.id }).first();
      const profile = (() => {
        try {
          return profileRow?.profile_json ? JSON.parse(String(profileRow.profile_json)) : {};
        } catch {
          return {};
        }
      })();

      const branchesCountRow = await db().count({ c: '*' }).from('branches').where({ tenant_id: req.tenant.id }).first();
      const rawCount = branchesCountRow ? (branchesCountRow.c ?? branchesCountRow.count ?? branchesCountRow['count(*)']) : 0;
      const branchesCount = Number(rawCount || 0) || 0;

      const steps = {
        profile: Boolean(profile && profile.contactPhone && profile.address1 && profile.city && profile.country),
        branches: branchesCount > 0,
      };

      const completedAt = onboardingRow?.completed_at || '';

      return res.json({
        ok: true,
        tenant: { id: req.tenant.id, name: req.tenant.name, status: req.tenant.status, profile },
        onboarding: {
          completed,
          completedAt,
          steps,
          counts: { branches: branchesCount },
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/onboarding/complete',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const nowIso = new Date().toISOString();
      await db()
        .from('owner_onboarding')
        .insert({ tenant_id: req.tenant.id, completed: true, completed_at: nowIso, updated_at: nowIso })
        .onConflict('tenant_id')
        .merge({ completed: true, completed_at: nowIso, updated_at: nowIso });

      return res.json({ ok: true, onboarding: { completed: true, completedAt: nowIso } });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
      const parsed = safeJsonParse(row?.settings_json, {});
      const settings = parsed && typeof parsed === 'object' ? parsed : {};

      // Ensure UI always sees the tenant's actual business name at least as a default.
      try {
        const bname = String(settings?.business?.businessName || '').trim();
        if (!bname) {
          const trow = await db().select(['name']).from('tenants').where({ id: req.tenant.id }).first();
          const tname = String(trow?.name || '').trim();
          if (tname) {
            settings.business = settings.business && typeof settings.business === 'object' ? settings.business : {};
            settings.business.businessName = tname;
          }
        }
      } catch {
        // ignore
      }
      return res.json({ ok: true, settings });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/settings',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('settings.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const row = await db().select(['settings_json']).from('owner_settings').where({ tenant_id: req.tenant.id }).first();
      const prev = safeJsonParse(row?.settings_json, {});
      const body = req.body?.settings || req.body;
      const nextSettings = normalizeOwnerSettings(body, prev);
      const nowIso = new Date().toISOString();

      await db()
        .from('owner_settings')
        .insert({ tenant_id: req.tenant.id, settings_json: JSON.stringify(nextSettings), updated_at: nowIso })
        .onConflict('tenant_id')
        .merge({ settings_json: JSON.stringify(nextSettings), updated_at: nowIso });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.settings.updated',
        summary: 'Updated owner settings',
        payload: null,
      });

      return res.json({ ok: true, settings: nextSettings });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/modules',
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
      const modsRaw = Array.isArray(body?.modules) ? body.modules : null;
      const normalized0 = modsRaw ? normalizeModules(modsRaw) : [];
      const normalized = normalized0.includes('settings') ? normalized0 : [...normalized0, 'settings'];

      const nextOverride = normalized.length ? JSON.stringify(normalized) : null;
      const nowIso = new Date().toISOString();

      await db().from('tenants').where({ id: req.tenant.id }).update({ enabled_modules_json: nextOverride, updated_at: nowIso });

      const refreshedTenant = await db().select(['id', 'name', 'status', 'trial_ends_at', 'created_at', 'enabled_modules_json']).from('tenants').where({ id: req.tenant.id }).first();
      const tenantForEntitlements = refreshedTenant ? { ...req.tenant, ...refreshedTenant } : req.tenant;

      const ent = await computeTenantEntitlements({ tenant: tenantForEntitlements });
      if (ent) await upsertTenantEntitlementsSnapshot({ tenantId: req.tenant.id, entitlements: ent });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.modules.updated',
        summary: 'Updated enabled modules',
        payload: { modules: normalized },
      });

      return res.json({ ok: true, modules: normalized, entitlements: ent });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/overview',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('owner_dashboard'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
      const rangeRaw = typeof req.query?.range === 'string' ? req.query.range.trim() : '';
      const range = rangeRaw === 'Weekly' ? 'Weekly' : rangeRaw === 'Monthly' ? 'Monthly' : 'Daily';
      const now = new Date();
      const monthStart = startOfDayIso(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEnd = endOfDayIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      const prevMonthStart = startOfDayIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const prevMonthEnd = endOfDayIso(new Date(now.getFullYear(), now.getMonth(), 0));
      const start = startOfDayIso(now);
      const end = endOfDayIso(now);

      let monthOrders = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', monthStart).andWhere('paid_at', '<=', monthEnd);
      if (branchId) monthOrders = monthOrders.andWhere({ branch_id: branchId });

      const monthAgg = await monthOrders.clone().sum({ revenue: 'total' }).count({ cnt: '*' }).first();
      const totalRevenueMonth = Number(monthAgg?.revenue || 0) || 0;
      const totalOrders = Number(monthAgg?.cnt ?? monthAgg?.count ?? monthAgg?.['count(*)'] ?? 0) || 0;

      let prevMonthOrders = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', prevMonthStart).andWhere('paid_at', '<=', prevMonthEnd);
      if (branchId) prevMonthOrders = prevMonthOrders.andWhere({ branch_id: branchId });
      const prevMonthAgg = await prevMonthOrders.clone().sum({ revenue: 'total' }).count({ cnt: '*' }).first();
      const prevRevenueMonth = Number(prevMonthAgg?.revenue || 0) || 0;
      const prevOrdersMonth = Number(prevMonthAgg?.cnt ?? prevMonthAgg?.count ?? prevMonthAgg?.['count(*)'] ?? 0) || 0;

      const pctDelta = (cur, prev) => {
        const a = Number(cur || 0) || 0;
        const b = Number(prev || 0) || 0;
        if (!b) return a ? 100 : 0;
        return ((a - b) / Math.abs(b)) * 100;
      };

      let opexQ = db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', monthStart).andWhere('at', '<=', monthEnd);
      if (branchId) opexQ = opexQ.andWhere({ branch_id: branchId });
      const opexRow = await opexQ.clone().sum({ s: 'amount' }).first();
      const opex = Number(opexRow?.s || 0) || 0;

      let prevOpexQ = db().from('finance_ledger').where({ tenant_id: req.tenant.id, type: 'expense' }).andWhere('at', '>=', prevMonthStart).andWhere('at', '<=', prevMonthEnd);
      if (branchId) prevOpexQ = prevOpexQ.andWhere({ branch_id: branchId });
      const prevOpexRow = await prevOpexQ.clone().sum({ s: 'amount' }).first();
      const prevOpex = Number(prevOpexRow?.s || 0) || 0;

      const cogs = 0;
      const prevCogs = 0;
      const netProfit = totalRevenueMonth - cogs - opex;
      const prevNetProfit = prevRevenueMonth - prevCogs - prevOpex;

      let trend = [];
      try {
        if (range === 'Daily') {
          let base = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', start).andWhere('paid_at', '<=', end);
          if (branchId) base = base.andWhere({ branch_id: branchId });
          const rows = await base
            .clone()
            .select([
              db().raw('HOUR(paid_at) as h'),
              db().raw('COUNT(*) as orderCount'),
              db().raw('COALESCE(SUM(total), 0) as total'),
            ])
            .groupBy([db().raw('HOUR(paid_at)')])
            .orderBy(db().raw('HOUR(paid_at)'), 'asc');

          trend = rows
            .map((r) => {
              const h = Number(r.h ?? 0) || 0;
              const label = `${String(h).padStart(2, '0')}:00`;
              return {
                key: label,
                revenue: Number(r.total || 0) || 0,
                orders: Number(r.orderCount || 0) || 0,
              };
            })
            .filter((x) => x.key);
        } else {
          const days = range === 'Weekly' ? 7 : 30;
          const endDay = endOfDayIso(now);
          const startDay = startOfDayIso(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
          let base = db().from('orders').where({ tenant_id: req.tenant.id }).andWhere('paid_at', '>=', startDay).andWhere('paid_at', '<=', endDay);
          if (branchId) base = base.andWhere({ branch_id: branchId });
          const rows = await base
            .clone()
            .select([
              db().raw('DATE(paid_at) as d'),
              db().raw('COUNT(*) as orderCount'),
              db().raw('COALESCE(SUM(total), 0) as total'),
            ])
            .groupBy([db().raw('DATE(paid_at)')])
            .orderBy(db().raw('DATE(paid_at)'), 'asc');
          trend = rows
            .map((r) => {
              const key = r.d ? String(r.d) : '';
              return {
                key,
                revenue: Number(r.total || 0) || 0,
                orders: Number(r.orderCount || 0) || 0,
              };
            })
            .filter((x) => x.key);
        }
      } catch {
        trend = [];
      }

      let branchesQ = db()
        .select([
          'b.id',
          'b.name',
          'b.status',
          db().raw('COALESCE(SUM(o.total), 0) as revenueToday'),
          db().raw('COUNT(DISTINCT o.id) as ordersToday'),
        ])
        .from({ b: 'branches' })
        .leftJoin({ o: 'orders' }, function joinOrders() {
          this.on('o.branch_id', '=', 'b.id')
            .andOn('o.tenant_id', '=', 'b.tenant_id')
            .andOn('o.paid_at', '>=', db().raw('?', [start]))
            .andOn('o.paid_at', '<=', db().raw('?', [end]));
        })
        .where({ 'b.tenant_id': req.tenant.id });

      if (branchId) branchesQ = branchesQ.andWhere('b.id', branchId);

      const branchRows = await branchesQ.groupBy(['b.id', 'b.name', 'b.status']).orderBy('b.name', 'asc');

      const branchIds = branchRows.map((b) => String(b.id));
      const managerRows = branchIds.length
        ? await db()
            .select(['branch_id', 'name'])
            .from('staff')
            .where({ tenant_id: req.tenant.id })
            .whereIn('branch_id', branchIds)
            .andWhere((q) => q.where('role_name', 'like', '%Manager%').orWhere('role_name', 'like', '%manager%'))
        : [];
      const managerByBranch = new Map();
      for (const m of managerRows) {
        const bid = m.branch_id ? String(m.branch_id) : '';
        if (!bid || managerByBranch.has(bid)) continue;
        managerByBranch.set(bid, String(m.name || ''));
      }

      const branches = branchRows.map((x) => ({
        id: String(x.id),
        name: String(x.name || ''),
        manager: managerByBranch.get(String(x.id)) || '',
        revenueToday: Number(x.revenueToday || 0) || 0,
        ordersToday: Number(x.ordersToday || 0) || 0,
        rating: 0,
        status: String(x.status || 'Open') === 'Closed' ? 'Closed' : 'Open',
      }));

      const totalBranches = branchId ? (branches.length ? 1 : 0) : Number(await db().from('branches').where({ tenant_id: req.tenant.id }).count({ c: '*' }).first().then((r) => r?.c ?? r?.count ?? r?.['count(*)'] ?? 0));
      const activeBranches = branches.filter((b) => b.status === 'Open').length;

      let lowStockCount = 0;
      let criticalStockCount = 0;
      try {
        let invQ = db().from('inventory_items').where({ tenant_id: req.tenant.id });
        if (branchId) invQ = invQ.andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId));

        const lowRow = await invQ
          .clone()
          .whereRaw('COALESCE(on_hand, 0) > 0')
          .andWhereRaw('COALESCE(reorder_level, 0) > 0')
          .andWhereRaw('COALESCE(on_hand, 0) < COALESCE(reorder_level, 0)')
          .count({ c: '*' })
          .first();
        lowStockCount = Number(lowRow?.c ?? lowRow?.count ?? lowRow?.['count(*)'] ?? 0) || 0;

        const critRow = await invQ
          .clone()
          .whereRaw('COALESCE(on_hand, 0) <= 0')
          .count({ c: '*' })
          .first();
        criticalStockCount = Number(critRow?.c ?? critRow?.count ?? critRow?.['count(*)'] ?? 0) || 0;
      } catch {
        lowStockCount = 0;
        criticalStockCount = 0;
      }

      let overdueInvoiceCount = 0;
      try {
        // Note: invoices table is tenant-scoped and does not include branch_id.
        let inv = db().from('invoices').where({ tenant_id: req.tenant.id }).whereNull('paid_at');
        inv = inv.andWhere((q) => q.where('status', 'pending').orWhere('status', 'overdue'));
        inv = inv.andWhere('due_date', '<', now.toISOString());
        const row = await inv.clone().count({ c: '*' }).first();
        overdueInvoiceCount = Number(row?.c ?? row?.count ?? row?.['count(*)'] ?? 0) || 0;
      } catch {
        overdueInvoiceCount = 0;
      }

      const alerts = [];
      if (criticalStockCount > 0) {
        alerts.push({
          title: 'Critical stock items',
          detail: `${criticalStockCount} SKU(s) are out of stock.`,
          severity: 'Critical',
          icon: 'inventory_2',
        });
      } else if (lowStockCount > 0) {
        alerts.push({
          title: 'Low stock',
          detail: `${lowStockCount} SKU(s) are below reorder level.`,
          severity: 'Warning',
          icon: 'inventory_2',
        });
      }

      if (overdueInvoiceCount > 0) {
        alerts.push({
          title: 'Overdue invoices',
          detail: `${overdueInvoiceCount} invoice(s) are overdue.`,
          severity: 'Critical',
          icon: 'receipt_long',
        });
      }

      const health = [
        {
          label: 'Inventory',
          value: criticalStockCount > 0 ? `${criticalStockCount} critical` : lowStockCount > 0 ? `${lowStockCount} low` : 'OK',
          status: criticalStockCount > 0 ? 'Bad' : lowStockCount > 0 ? 'Warn' : 'Good',
        },
        {
          label: 'Invoices',
          value: overdueInvoiceCount > 0 ? `${overdueInvoiceCount} overdue` : 'OK',
          status: overdueInvoiceCount > 0 ? 'Warn' : 'Good',
        },
      ];

      return res.json({
        ok: true,
        meta: { range },
        kpis: {
          totalRevenueMonth,
          revenueDeltaPct: pctDelta(totalRevenueMonth, prevRevenueMonth),
          activeBranches,
          totalBranches: Number(totalBranches || 0) || 0,
          totalOrders,
          ordersDeltaPct: pctDelta(totalOrders, prevOrdersMonth),
          netProfit,
          netProfitDeltaPct: pctDelta(netProfit, prevNetProfit),
        },
        trend,
        branches,
        alerts,
        health,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/reports',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('reports'),
    requirePermission('reports.read'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';
      const fromIso = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
      const toIso = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

      const from = fromIso && !Number.isNaN(new Date(fromIso).getTime()) ? fromIso : startOfDayIso(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
      const to = toIso && !Number.isNaN(new Date(toIso).getTime()) ? toIso : endOfDayIso(new Date());

      let base = db().from('orders').where({ tenant_id: req.tenant.id });
      if (branchId) base = base.andWhere({ branch_id: branchId });
      base = base.andWhere('paid_at', '>=', from).andWhere('paid_at', '<=', to);

      const sumRow = await base.clone().sum({ netSales: 'total' }).sum({ tax: 'tax' }).sum({ tips: 'tip' }).sum({ discounts: 'discount' }).count({ txCount: '*' }).first();
      const totals = {
        txCount: Number(sumRow?.txCount ?? sumRow?.count ?? sumRow?.['count(*)'] ?? 0) || 0,
        netSales: Number(sumRow?.netSales || 0) || 0,
        tax: Number(sumRow?.tax || 0) || 0,
        tips: Number(sumRow?.tips || 0) || 0,
        discounts: Number(sumRow?.discounts || 0) || 0,
        totalCollected: (Number(sumRow?.netSales || 0) || 0) + (Number(sumRow?.tax || 0) || 0) + (Number(sumRow?.tips || 0) || 0) - (Number(sumRow?.discounts || 0) || 0),
      };

      const dailyRows = await base
        .clone()
        .select([
          db().raw("DATE(paid_at) as d"),
          db().raw('COUNT(*) as txCount'),
          db().raw('COALESCE(SUM(total), 0) as netSales'),
          db().raw('COALESCE(SUM(tax), 0) as tax'),
          db().raw('COALESCE(SUM(tip), 0) as tips'),
          db().raw('COALESCE(SUM(discount), 0) as discounts'),
        ])
        .groupBy([db().raw('DATE(paid_at)')])
        .orderBy(db().raw('DATE(paid_at)'), 'asc');

      const ledger = dailyRows.map((r) => {
        const netSales = Number(r.netSales || 0) || 0;
        const tax = Number(r.tax || 0) || 0;
        const tips = Number(r.tips || 0) || 0;
        const discounts = Number(r.discounts || 0) || 0;
        return {
          date: r.d ? String(r.d) : '',
          txCount: Number(r.txCount || 0) || 0,
          netSales,
          tax,
          tips,
          discounts,
          totalCollected: netSales + tax + tips - discounts,
        };
      });

      const ymMap = new Map();
      for (const r of ledger) {
        const ym = r.date ? String(r.date).slice(0, 7) : '';
        if (!ym) continue;
        const prev = ymMap.get(ym) || { ym, name: ym, revenue: 0, expenses: 0 };
        prev.revenue += Number(r.totalCollected || 0) || 0;
        ymMap.set(ym, prev);
      }
      const trend = Array.from(ymMap.values()).sort((a, b) => String(a.ym).localeCompare(String(b.ym)));

      const categories = [
        { name: 'Net Sales', value: totals.netSales },
        { name: 'Tax', value: totals.tax },
        { name: 'Tips', value: totals.tips },
        { name: 'Discounts', value: Math.max(0, totals.discounts) },
      ].filter((x) => Number(x.value) > 0);

      let branchBreakdown = [];
      if (!branchId) {
        const bRows = await db()
          .from({ o: 'orders' })
          .leftJoin({ b: 'branches' }, function joinBranches() {
            this.on('b.id', '=', 'o.branch_id').andOn('b.tenant_id', '=', 'o.tenant_id');
          })
          .where({ 'o.tenant_id': req.tenant.id })
          .andWhere('o.paid_at', '>=', from)
          .andWhere('o.paid_at', '<=', to)
          .select([
            'o.branch_id',
            'b.name as branch_name',
            'b.status as branch_status',
            db().raw('COUNT(*) as txCount'),
            db().raw('COALESCE(SUM(o.total), 0) as netSales'),
            db().raw('COALESCE(SUM(o.tax), 0) as tax'),
            db().raw('COALESCE(SUM(o.tip), 0) as tips'),
            db().raw('COALESCE(SUM(o.discount), 0) as discounts'),
          ])
          .groupBy(['o.branch_id', 'b.name', 'b.status'])
          .orderBy(db().raw('COALESCE(SUM(o.total), 0)'), 'desc');

        branchBreakdown = bRows.map((x) => {
          const netSales = Number(x.netSales || 0) || 0;
          const tax = Number(x.tax || 0) || 0;
          const tips = Number(x.tips || 0) || 0;
          const discounts = Number(x.discounts || 0) || 0;
          return {
            branchId: String(x.branch_id),
            name: String(x.branch_name || ''),
            status: String(x.branch_status || ''),
            txCount: Number(x.txCount || 0) || 0,
            netSales,
            tax,
            tips,
            discounts,
            totalCollected: netSales + tax + tips - discounts,
          };
        });
      }

      // What is sold: derive from orders.payload.items (best-effort, since payload is JSON)
      let soldItems = [];
      let soldCategories = [];
      let paymentMethods = [];
      try {
        const rows0 = await base.clone().select(['payload', 'total']).orderBy('paid_at', 'desc').limit(2000);
        const byProduct = new Map();
        const productIds = new Set();

        const normalizePm = (raw) => {
          const s = String(raw || '').trim().toLowerCase();
          if (!s) return 'Other';
          if (s === 'cash') return 'Cash';
          if (s === 'card') return 'Card';
          if (s === 'telebirr') return 'Telebirr';
          if (s === 'loyalty') return 'Loyalty';
          return 'Other';
        };

        const byPm = new Map();

        const addPm = (pm, amount) => {
          const key = normalizePm(pm);
          const prev = byPm.get(key) || { name: key, txCount: 0, amount: 0 };
          prev.txCount += 1;
          prev.amount += Number(amount || 0) || 0;
          byPm.set(key, prev);
        };

        for (const r0 of rows0) {
          const p0 = safeJsonParse(r0.payload, null);

          const splits = Array.isArray(p0?.splits)
            ? p0.splits
            : Array.isArray(p0?.order?.splits)
              ? p0.order.splits
              : [];

          if (Array.isArray(splits) && splits.length) {
            for (const sp of splits) {
              const status = String(sp?.status || '').trim().toLowerCase();
              if (status && status !== 'paid') continue;
              const amt = Number(sp?.total ?? sp?.amount ?? 0) || 0;
              addPm(sp?.paymentMethod || sp?.method || p0?.paymentMethod || p0?.method, amt);
            }
          } else {
            const amt = Number(r0.total || 0) || 0;
            addPm(p0?.paymentMethod || p0?.method || p0?.tender || p0?.paidBy, amt);
          }

          const items = Array.isArray(p0?.items) ? p0.items : Array.isArray(p0?.order?.items) ? p0.order.items : [];
          for (const it of items) {
            const productId = String(it?.productId || it?.id || '').trim();
            if (!productId) continue;
            const name = String(it?.name || '').trim() || productId;
            const unitPrice = Number(it?.unitPrice || it?.price || 0) || 0;
            const qty0 = Number(it?.qty || 0) || 0;
            const voided = Number(it?.voidedQty || 0) || 0;
            const qty = Math.max(0, qty0 - voided);
            if (!qty) continue;

            productIds.add(productId);
            const prev = byProduct.get(productId) || { productId, name, qty: 0, revenue: 0, category: '' };
            prev.name = prev.name || name;
            prev.qty += qty;
            prev.revenue += qty * unitPrice;
            byProduct.set(productId, prev);
          }
        }

        let categoryByProduct = new Map();
        try {
          const ids = Array.from(productIds);
          if (ids.length) {
            const prodRows = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).select(['id', 'category', 'product_json']);
            categoryByProduct = new Map(
              prodRows.map((x) => {
                const pj = safeJsonParse(x.product_json, {});
                const cat = String(x.category || pj?.category || '').trim();
                return [String(x.id), cat];
              }),
            );
          }
        } catch {
          categoryByProduct = new Map();
        }

        soldItems = Array.from(byProduct.values())
          .map((x) => ({
            productId: String(x.productId),
            name: String(x.name || x.productId),
            category: String(categoryByProduct.get(String(x.productId)) || x.category || 'Uncategorized'),
            qty: Number(x.qty || 0) || 0,
            revenue: Number(x.revenue || 0) || 0,
          }))
          .sort((a, b) => (b.revenue - a.revenue) || (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)))
          .slice(0, 30);

        const byCat = new Map();
        for (const it of Array.from(byProduct.values())) {
          const cat = String(categoryByProduct.get(String(it.productId)) || it.category || 'Uncategorized');
          const prev = byCat.get(cat) || { name: cat, qty: 0, revenue: 0 };
          prev.qty += Number(it.qty || 0) || 0;
          prev.revenue += Number(it.revenue || 0) || 0;
          byCat.set(cat, prev);
        }
        soldCategories = Array.from(byCat.values())
          .sort((a, b) => (b.revenue - a.revenue) || (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)))
          .slice(0, 12);

        paymentMethods = Array.from(byPm.values())
          .map((x) => ({ name: String(x.name), txCount: Number(x.txCount || 0) || 0, amount: Number(x.amount || 0) || 0 }))
          .sort((a, b) => (b.amount - a.amount) || (b.txCount - a.txCount) || String(a.name).localeCompare(String(b.name)));
      } catch {
        soldItems = [];
        soldCategories = [];
        paymentMethods = [];
      }

      return res.json({
        kpis: { totalRevenueNet: totals.netSales, cogs: 0, laborCost: 0 },
        trend,
        categories,
        soldItems,
        soldCategories,
        paymentMethods,
        branchBreakdown,
        ledger,
        totals,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/inventory',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('inventory'),
    requirePermission('inventory.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const normalizeBranchId = (v) => {
        const s = String(v || '').trim();
        if (!s) return '';
        if (s === 'global') return '';
        if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
        return s;
      };

      const branchIdAlternates = (id) => {
        const s = String(id || '').trim();
        if (!s) return [];
        if (s.startsWith('br_')) return [s, `b_${s.slice(3)}`];
        if (s.startsWith('b_')) return [s, `br_${s.slice(2)}`];
        return [s];
      };

      const branchId = typeof req.query?.branchId === 'string' ? normalizeBranchId(req.query.branchId) : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const branches = await db().select(['id', 'name', 'status']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('name', 'asc');

      let base = db().from('inventory_items').where({ tenant_id: req.tenant.id });
      if (branchId) {
        const branchIds = branchIdAlternates(branchId);
        base = base.andWhere((b) => b.whereNull('branch_id').orWhereIn('branch_id', branchIds));
      }
      if (category) base = base.andWhere('category', category);
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));

      const rows = await base.select(['id', 'branch_id', 'name', 'category', 'status', 'on_hand', 'reorder_level', 'unit', 'item_json']).orderBy('name', 'asc');

      const categories = Array.from(new Set(rows.map((r) => String(r.category || 'Uncategorized')))).sort((a, b) => a.localeCompare(b));

      const bySku = new Map();
      for (const r of rows) {
        const sku = String(r.id);
        const itemJson = safeJsonParse(r.item_json, {});
        const cost = Number(itemJson?.cost ?? itemJson?.unitCost ?? 0) || 0;
        const qty = Number(r.on_hand || 0) || 0;
        const minQty = Number(r.reorder_level || 0) || 0;
        const unit = String(r.unit || itemJson?.unit || '') || '';
        const cat = String(r.category || 'Uncategorized');
        const name = String(r.name || '');
        const bId = r.branch_id ? String(r.branch_id) : 'global';

        const prev = bySku.get(sku) || {
          sku,
          name,
          category: cat,
          unit,
          minQty,
          cost,
          globalQty: 0,
          globalValue: 0,
          status: 'In Stock',
          byBranch: {},
        };

        prev.globalQty += qty;
        prev.globalValue += qty * cost;
        prev.byBranch[bId] = (prev.byBranch[bId] ?? 0) + qty;
        prev.cost = cost;
        prev.minQty = minQty;
        prev.unit = unit;
        prev.name = name;
        prev.category = cat;
        bySku.set(sku, prev);
      }

      const items = Array.from(bySku.values()).map((it) => {
        const min = Number(it.minQty || 0) || 0;
        const qty = Number(it.globalQty || 0) || 0;
        const status = qty <= 0 ? 'Critical' : qty < min ? 'Low' : 'In Stock';
        return {
          ...it,
          globalQty: Number(it.globalQty || 0) || 0,
          globalValue: Number(it.globalValue || 0) || 0,
          status,
        };
      });

      const totalValue = items.reduce((acc, it) => acc + (Number(it.globalValue) || 0), 0);
      const lowStockCount = items.filter((it) => it.status === 'Low').length;
      const criticalCount = items.filter((it) => it.status === 'Critical').length;

      return res.json({
        kpis: { totalSkus: items.length, totalValue, lowStockCount, criticalCount },
        categories,
        branches: branches.map((b) => ({ id: String(b.id), name: String(b.name || ''), status: String(b.status || '') })),
        items,
        meta: { generatedAt: new Date().toISOString() },
      });
    } catch (e) {
      return next(e);
    }
  });

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

      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
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
  });

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

      return res.status(201).json({ ok: true, url: `/api/uploads/${safeTenant}/${outName}` });
    } catch (e) {
      return next(e);
    }
  });

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
  });

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
  });

  r.get(
    '/owner/menu/products',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
      const page = clampInt(req.query?.page, 1, 100000, 1);
      const pageSize = clampInt(req.query?.pageSize, 1, 50, 10);
      const offset = (page - 1) * pageSize;

      let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
      if (category) base = base.andWhere('category', category);
      if (status && status !== 'All') base = base.andWhere('status', status);

      const totalRow = await base.clone().count({ c: '*' }).first();
      const total = Number(totalRow?.c ?? totalRow?.count ?? totalRow?.['count(*)'] ?? 0) || 0;

      const rows = await base
        .clone()
        .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      // Compute simple sales aggregates from paid orders payload for the currently visible products.
      // This keeps UI charts meaningful without introducing new DB tables.
      const windowDays = Math.max(1, Math.min(365, Number(req.query?.salesWindowDays || 30) || 30));
      const toSalesIso = new Date().toISOString();
      const fromSalesIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const visibleIds = rows.map((r) => String(r.id || '')).filter(Boolean);
      const salesByProduct = new Map();

      if (visibleIds.length) {
        const orderRows = await db()
          .select(['payload'])
          .from('orders')
          .where({ tenant_id: req.tenant.id, status: 'Paid' })
          .andWhere('paid_at', '>=', fromSalesIso)
          .andWhere('paid_at', '<=', toSalesIso)
          .orderBy('paid_at', 'desc')
          .limit(1500);

        const allow = new Set(visibleIds);
        for (const or0 of orderRows) {
          const payload = safeJsonParse(or0.payload, {});
          const items = Array.isArray(payload?.items) ? payload.items : [];
          for (const it of items) {
            const pid = String(it?.productId || it?.product_id || '').trim();
            if (!pid || !allow.has(pid)) continue;
            const qty = Number(it?.qty ?? 0) || 0;
            const voided = Number(it?.voidedQty ?? it?.voided_qty ?? 0) || 0;
            const netQty = Math.max(0, qty - voided);
            if (netQty <= 0) continue;
            const unit = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0;
            const prev = salesByProduct.get(pid) || { units: 0, revenue: 0 };
            prev.units += netQty;
            prev.revenue += netQty * unit;
            salesByProduct.set(pid, prev);
          }
        }
      }

      const allCats = await db().from('menu_products').where({ tenant_id: req.tenant.id }).distinct('category as c');
      const categories = Array.from(new Set(allCats.map((x) => String(x.c || 'Uncategorized')))).filter(Boolean).sort((a, b) => a.localeCompare(b));

      const products = rows.map((r) => {
        const pj = safeJsonParse(r.product_json, {});
        const cost = Number(pj?.cost ?? 0) || 0;
        const price = Number(r.price || 0) || 0;
        const marginPct = price > 0 ? Number((((price - cost) / price) * 100).toFixed(1)) : 0;
        const s = salesByProduct.get(String(r.id)) || { units: 0, revenue: 0 };
        return {
          id: String(r.id),
          branchId: r.branch_id ? String(r.branch_id) : null,
          code: String(pj?.code || ''),
          name: String(r.name || ''),
          category: String(r.category || 'Uncategorized'),
          price,
          cost,
          marginPct,
          status: r.status === 'Inactive' ? 'Inactive' : 'Active',
          image: String(pj?.image || ''),
          description: String(pj?.description || ''),
          product_json: pj,
          soldUnits: Number(s.units || 0) || 0,
          soldRevenue: Number(s.revenue || 0) || 0,
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
        };
      });

      return res.json({ products, categories, page, pageSize, total });
    } catch (e) {
      return next(e);
    }
  });

  r.get(
    '/owner/menu/kpis',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const category = typeof req.query?.category === 'string' ? req.query.category.trim() : '';
      const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';

      let base = db().from('menu_products').where({ tenant_id: req.tenant.id });
      if (q) base = base.andWhere((b) => b.where('name', 'like', `%${q}%`).orWhere('id', 'like', `%${q}%`));
      if (category) base = base.andWhere('category', category);
      if (status && status !== 'All') base = base.andWhere('status', status);

      const rows = await base.select(['id', 'category', 'status', 'price', 'product_json']);
      const categories = Array.from(new Set(rows.map((r) => String(r.category || 'Uncategorized')))).filter(Boolean).sort((a, b) => a.localeCompare(b));

      const totalItems = rows.length;
      const activeItems = rows.filter((r) => String(r.status || '') === 'Active').length;
      const margins = rows.map((r) => {
        const pj = safeJsonParse(r.product_json, {});
        const cost = Number(pj?.cost ?? 0) || 0;
        const price = Number(r.price || 0) || 0;
        return price > 0 ? ((price - cost) / price) * 100 : 0;
      });
      const avgMarginPct = margins.length ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1)) : 0;

      const windowDays = Math.max(1, Math.min(365, Number(req.query?.salesWindowDays || 30) || 30));
      const toSalesIso = new Date().toISOString();
      const fromSalesIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const salesByProduct = new Map();
      const allow = new Set(rows.map((r) => String(r.id || '')).filter(Boolean));

      if (allow.size) {
        const orderRows = await db()
          .select(['payload'])
          .from('orders')
          .where({ tenant_id: req.tenant.id, status: 'Paid' })
          .andWhere('paid_at', '>=', fromSalesIso)
          .andWhere('paid_at', '<=', toSalesIso)
          .orderBy('paid_at', 'desc')
          .limit(2000);

        for (const or0 of orderRows) {
          const payload = safeJsonParse(or0.payload, {});
          const items = Array.isArray(payload?.items) ? payload.items : [];
          for (const it of items) {
            const pid = String(it?.productId || it?.product_id || '').trim();
            if (!pid || !allow.has(pid)) continue;
            const qty = Number(it?.qty ?? 0) || 0;
            const voided = Number(it?.voidedQty ?? it?.voided_qty ?? 0) || 0;
            const netQty = Math.max(0, qty - voided);
            if (netQty <= 0) continue;
            const unit = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0;
            const prev = salesByProduct.get(pid) || { units: 0, revenue: 0 };
            prev.units += netQty;
            prev.revenue += netQty * unit;
            salesByProduct.set(pid, prev);
          }
        }
      }

      let topId = '';
      let topRevenue = 0;
      let topUnits = 0;
      for (const [pid, v] of salesByProduct.entries()) {
        const rev = Number(v?.revenue || 0) || 0;
        if (rev > topRevenue) {
          topRevenue = rev;
          topId = String(pid);
          topUnits = Number(v?.units || 0) || 0;
        }
      }
      const topName = topId ? String(rows.find((r) => String(r.id || '') === topId)?.name || '') : '';

      return res.json({
        kpis: {
          totalItems,
          activeItems,
          avgMarginPct,
          topSeller: { id: topId || '', name: topName || '—', revenue: topRevenue || 0, units: topUnits || 0 },
        },
        categories,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/menu/products',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const id = String(req.body?.id || '').trim() || uid('prd');
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });

      const category = String(req.body?.category || 'Uncategorized').trim() || 'Uncategorized';
      const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
      const price = Number(req.body?.price || 0) || 0;
      const cost = Number(req.body?.cost || 0) || 0;
      const code = await ensureUniqueMenuCode(req.tenant.id, String(req.body?.code || '').trim(), name);
      const image = String(req.body?.image || '').trim();
      const description = String(req.body?.description || '').trim();

      const nowIso = new Date().toISOString();
      await db().from('menu_products').insert({
        id,
        tenant_id: req.tenant.id,
        branch_id: null,
        name,
        category,
        status,
        price,
        product_json: JSON.stringify({ code, cost, image, description }),
        created_at: nowIso,
        updated_at: nowIso,
      });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.menu.product.created',
        summary: `Created menu product ${name}`,
        payload: { productId: id, code },
      });

      return res.status(201).json({ ok: true, product: { id } });
    } catch (e) {
      return next(e);
    }
  });

  r.put(
    '/owner/menu/products/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const existing = await db().select(['id', 'product_json']).from('menu_products').where({ tenant_id: req.tenant.id, id }).first();
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const prevJson = safeJsonParse(existing.product_json, {});
      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
      if (typeof req.body?.category === 'string') patch.category = req.body.category.trim() || 'Uncategorized';
      if (typeof req.body?.status === 'string') patch.status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';
      if (req.body?.price != null) patch.price = Number(req.body.price || 0) || 0;

      const nextJson = { ...prevJson };
      if (typeof req.body?.code === 'string') {
        const desired = req.body.code.trim();
        if (desired) nextJson.code = desired;
        else nextJson.code = await ensureUniqueMenuCode(req.tenant.id, '', String(patch.name || prevJson?.name || ''));
      }
      if (req.body?.cost != null) nextJson.cost = Number(req.body.cost || 0) || 0;
      if (typeof req.body?.image === 'string') nextJson.image = req.body.image.trim();
      if (typeof req.body?.description === 'string') nextJson.description = req.body.description.trim();
      if (req.body?.recipe && typeof req.body.recipe === 'object') nextJson.recipe = req.body.recipe;
      patch.product_json = JSON.stringify(nextJson);
      patch.updated_at = new Date().toISOString();

      await db().from('menu_products').where({ tenant_id: req.tenant.id, id }).update(patch);

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.menu.product.updated',
        summary: 'Updated menu product',
        payload: { productId: id },
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.delete(
    '/owner/menu/products/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;

      const id = String(req.params?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id_required' });

      const deleted = await db().from('menu_products').where({ tenant_id: req.tenant.id, id }).del();
      if (!deleted) return res.status(404).json({ error: 'not_found' });

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.menu.product.deleted',
        summary: 'Deleted menu product',
        payload: { productId: id },
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post(
    '/owner/menu/products/bulk',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner'),
    loadEntitlements,
    requireModule('menu'),
    requirePermission('menu.manage'),
    async (req, res, next) => {
    try {
      if (!requireOwnerAuth(req, res)) return;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
      const action = String(req.body?.action || '').trim();
      if (!ids.length) return res.status(400).json({ error: 'ids_required' });
      if (!action) return res.status(400).json({ error: 'action_required' });

      const nowIso = new Date().toISOString();
      let updated = 0;

      if (action === 'set_status') {
        const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
        updated = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).update({ status, updated_at: nowIso });
      } else if (action === 'set_price') {
        const price = Number(req.body?.price);
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'invalid_price' });
        updated = await db().from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids).update({ price, updated_at: nowIso });
      } else if (action === 'set_cost' || action === 'adjust_cost_pct' || action === 'adjust_price_pct') {
        const rows = await db().select(['id', 'price', 'product_json']).from('menu_products').where({ tenant_id: req.tenant.id }).whereIn('id', ids);
        const pct = Number(req.body?.pct);
        const cost = Number(req.body?.cost);
        const price = Number(req.body?.price);
        for (const r0 of rows) {
          const pj = safeJsonParse(r0.product_json, {});
          const next = { ...pj };
          const patch = { updated_at: nowIso };
          if (action === 'set_cost') {
            if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'invalid_cost' });
            next.cost = cost;
          }
          if (action === 'adjust_cost_pct') {
            if (!Number.isFinite(pct)) return res.status(400).json({ error: 'invalid_pct' });
            const cur = Number(next.cost || 0) || 0;
            next.cost = Math.max(0, cur + (cur * pct) / 100);
          }
          if (action === 'adjust_price_pct') {
            if (!Number.isFinite(pct)) return res.status(400).json({ error: 'invalid_pct' });
            const cur = Number(r0.price || 0) || 0;
            patch.price = Math.max(0, cur + (cur * pct) / 100);
          }
          patch.product_json = JSON.stringify(next);
          // eslint-disable-next-line no-await-in-loop
          await db().from('menu_products').where({ tenant_id: req.tenant.id, id: String(r0.id) }).update(patch);
          updated += 1;
        }
      } else {
        return res.status(400).json({ error: 'invalid_action' });
      }

      await logAudit({
        tenantId: req.tenant.id,
        branchId: null,
        actorStaffId: req.auth?.staffId ? String(req.auth.staffId) : null,
        actorRole: req.auth?.role ? String(req.auth.role) : null,
        type: 'owner.menu.product.bulk',
        summary: `Bulk menu update: ${action}`,
        payload: { action, ids, updated },
      });

      return res.json({ ok: true, updated });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeOwnerRouter };
