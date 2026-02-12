const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { config } = require('../../config');
const { safeJsonParse } = require('../../utils/errors');
const { deleteCachedKeys } = require('../../utils/cache');
const { validateSuperadminPaymentConfig, validateSuperadminPlatformSettings } = require('../../middleware/validators');
const { getPlatformPaymentConfig } = require('../../services/invoiceService');
const { toIso } = require('./utils');

const makeSuperadminPaymentConfigRouter = () => {
  const r = express.Router();

  r.get('/superadmin/payment-config', requireSuperadmin, async (_req, res, next) => {
    try {
      const cfg = await getPlatformPaymentConfig();
      const starterRow = await db().from('plans').select(['price_monthly_etb']).whereRaw('LOWER(tier) = ?', ['starter']).first();
      const growthRow = await db().from('plans').select(['price_monthly_etb']).whereRaw('LOWER(tier) = ?', ['growth']).first();
      const configOut = {
        bankDetails: cfg?.bankDetails || {},
        chapa: cfg?.chapa || { enabled: false },
        telebirr: cfg?.telebirr || { enabled: false },
        sms: cfg?.sms || { enabled: false },
        fcm: cfg?.fcm || { enabled: false },
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
      const sms = body?.sms && typeof body.sms === 'object' ? body.sms : {};
      const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};
      const fcm = body?.fcm && typeof body.fcm === 'object' ? body.fcm : {};

      const nowIso = new Date().toISOString();
      await db().from('platform_payment_config').insert({
        id: 1,
        bank_details_json: JSON.stringify(bankDetails),
        chapa_config_json: JSON.stringify(chapa),
        telebirr_config_json: JSON.stringify(telebirr),
        sms_config_json: JSON.stringify(sms),
        fcm_config_json: JSON.stringify(fcm),
        default_grace_days: Number(settings.gracePeriodDays || 3) || 3,
        report_retention_days: Number(settings.reportRetentionDays || 365) || 365,
        updated_at: nowIso,
      }).onConflict('id').merge({
        bank_details_json: JSON.stringify(bankDetails),
        chapa_config_json: JSON.stringify(chapa),
        telebirr_config_json: JSON.stringify(telebirr),
        sms_config_json: JSON.stringify(sms),
        fcm_config_json: JSON.stringify(fcm),
        default_grace_days: Number(settings.gracePeriodDays || 3) || 3,
        report_retention_days: Number(settings.reportRetentionDays || 365) || 365,
        updated_at: nowIso,
      });

      await deleteCachedKeys(['platform:payment_config:v1', 'platform:gateway_config:v1']);

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

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
      await db().from('platform_settings_admin')
        .insert({ id: 1, settings_json: JSON.stringify(body || {}), updated_at: nowIso })
        .onConflict('id')
        .merge({ settings_json: JSON.stringify(body || {}), updated_at: nowIso });
      return res.json({ ok: true, settings: body || {} });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminPaymentConfigRouter };
