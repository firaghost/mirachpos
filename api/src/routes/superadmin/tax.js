const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { makeId } = require('../../utils/ids');
const { safeJsonParse } = require('../../utils/errors');
const { logAudit } = require('../../utils/logger');
const {
  validateSuperadminTaxCodeParam,
  validateSuperadminTaxRuleUpdate,
  validateSuperadminTaxCategoryCreate,
  validateSuperadminTaxCategoryIdParam,
  validateSuperadminTaxCategoryUpdate,
  validateSuperadminTaxStatusUpdate,
} = require('../../middleware/validators');

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const upsertCategoriesAndMap = async (trx, taxCode, applicabilityCategories) => {
  const code = String(taxCode || '').trim();
  if (!code) return;

  const raw = Array.isArray(applicabilityCategories) ? applicabilityCategories : [];
  const ids = raw
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return;

  const rows = await trx.from('tax_rule_categories').select(['id']).whereIn('id', uniqueIds);
  const found = new Set((rows || []).map((r) => String(r.id)));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length) {
    const err = new Error('invalid_tax_categories');
    err.status = 400;
    err.details = { missingCategoryIds: missing };
    throw err;
  }

  const nowIso = new Date().toISOString();
  const inserts = uniqueIds.map((categoryId) => ({ tax_code: code, category_id: categoryId, created_at: nowIso }));
  await trx.from('tax_rule_category_map').insert(inserts);
};

const makeSuperadminTaxRouter = () => {
  const r = express.Router();

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

      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tax_rule.update',
        summary: 'Updated tax rule',
        payload: { code, patch: { ...updatePatch, applicabilityCategories: typeof applicabilityCategories === 'undefined' ? undefined : applicabilityCategories } },
        requestId: req.requestId,
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
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tax_category.create',
        summary: 'Created tax category',
        payload: { id, name: trimmedName },
        requestId: req.requestId,
      });
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
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tax_category.delete',
        summary: 'Deleted tax category',
        payload: { id: trimmedId },
        requestId: req.requestId,
      });
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
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tax_category.update',
        summary: 'Updated tax category',
        payload: { id: trimmedId, from: String(existing.name || ''), to: trimmedName },
        requestId: req.requestId,
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

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
      for (const r0 of rules) {
        const code = String(r0.code || '');
        const categories = mapByCode.get(code) || [''];
        const base = [
          code,
          String(r0.name || ''),
          Number(r0.rate_pct || 0),
          String(r0.logic || ''),
          String(r0.status || ''),
          toIso(r0.effective_date),
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
      await logAudit({
        tenantId: null,
        branchId: null,
        actorStaffId: null,
        actorRole: 'superadmin',
        type: 'tax_status.update',
        summary: 'Updated tax system status',
        payload: { patch },
        requestId: req.requestId,
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeSuperadminTaxRouter };
