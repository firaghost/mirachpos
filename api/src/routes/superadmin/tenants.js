const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { config } = require('../../config');
const { makeId } = require('../../utils/ids');
const { safeJsonParse } = require('../../utils/errors');
const { sanitizeLikeInput, sanitizeText } = require('../../utils/sanitize');
const { logAudit } = require('../../utils/logger');
const { encryptConfigFields, decryptConfigFields } = require('../../utils/secretEncryption');
const {
  validateSuperadminTenantId,
  validateSuperadminTenantsQuery,
  validateIdParam,
  validateSuperadminTenantUpdate,
  validateSuperadminTenantCreate,
  validateSuperadminResetCreds,
  validateSuperadminImpersonate,
  validateSuperadminGatewayParam,
  validateSuperadminPosGatewayUpdate,
  validateSuperadminTenantNote,
} = require('../../middleware/validators');
const { computeTenantEntitlements, upsertTenantEntitlementsSnapshot, normalizeTier } = require('../../services/entitlements');

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const maskSecret = (s) => {
  try {
    const v = String(s || '');
    if (!v) return '';
    if (v.length <= 8) return '********';
    return `${v.slice(0, 4)}********${v.slice(-4)}`;
  } catch {
    return '';
  }
};

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  const x = Number.isFinite(n) ? n : def;
  return Math.max(min, Math.min(max, x));
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

const randomPassword = (len = 10) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const resolveCdnUrl = (s) => String(s || '');

const makeSuperadminTenantsRouter = () => {
  const r = express.Router();

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
          requestId: req.requestId,
        });
      } catch {
        // ignore
      }

      return res.json({ ok: true, tenantId, ownerStaffId: String(owner.id), ownerEmail: String(owner.email || ''), tempPassword });
    } catch (e) {
      return next(e);
    }
  });

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
        const pct = Math.max(branchLimit ? branchCount / branchLimit : 0, staffLimit ? staffCount / staffLimit : 0);
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
          enabledModules: safeJsonParse(tenant.enabled_modules_json, []),
          features: safeJsonParse(tenant.features_json, []),
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
        await db().from('tenant_profile')
          .insert({ tenant_id: tenantId, profile_json: JSON.stringify(nextProfile), updated_at: patch.updated_at })
          .onConflict('tenant_id')
          .merge({ profile_json: JSON.stringify(nextProfile), updated_at: patch.updated_at });
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

  r.put(
    '/superadmin/tenants/:id/pos-payment-gateways/:gateway',
    requireSuperadmin,
    validateIdParam,
    validateSuperadminGatewayParam,
    validateSuperadminPosGatewayUpdate,
    async (req, res, next) => {
      try {
        const tenantId = String(req.params?.id || '').trim();
        if (!tenantId) return res.status(400).json({ error: 'invalid_tenant' });

        const { gateway: gatewayRaw } = req.validatedParams || req.params;
        const gateway = String(gatewayRaw || '').trim().toLowerCase();
        if (!gateway) return res.status(400).json({ error: 'gateway_required' });
        if (
          gateway !== 'chapa' &&
          gateway !== 'telebirr' &&
          gateway !== 'cbe_birr' &&
          gateway !== 'santimpay' &&
          gateway !== 'cash' &&
          gateway !== 'bank_transfer' &&
          gateway !== 'check' &&
          gateway !== 'credit_card' &&
          gateway !== 'mobile_money' &&
          gateway !== 'other'
        ) {
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

        const secretKey = typeof nextCfg?.secretKey === 'string' ? nextCfg.secretKey.trim() : '';
        const webhookSecret = typeof nextCfg?.webhookSecret === 'string' ? nextCfg.webhookSecret.trim() : '';
        if (gateway === 'chapa' && enabled && (!secretKey || !webhookSecret)) {
          return res.status(400).json({ error: 'chapa_keys_required' });
        }

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

        await logAudit({
          tenantId,
          branchId: null,
          actorStaffId: null,
          actorRole: 'superadmin',
          type: 'tenant.pos_payment_gateways.update',
          summary: `Updated tenant POS payment gateway: ${gateway}`,
          payload: { tenantId, gateway, enabled, keys: Object.keys(configPatch || {}) },
          requestId: req.requestId,
        });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

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
      await logAudit({
        tenantId,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tenant.note',
        summary: 'Added tenant note',
        payload: { noteId },
        requestId: req.requestId,
      });
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

        await trx.from('roles').insert([
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

      const token = jwt.sign({ tenantId, role: roleRaw, superadmin: true }, config.jwtSecret, { expiresIn: '15m' });

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

  return r;
};

module.exports = { makeSuperadminTenantsRouter };
