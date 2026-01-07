const express = require('express');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { resolveBranchId, requireBranchId, requireBranchIdFromBody } = require('../middleware/branchScope');
const { loadEntitlements, requireModule } = require('../middleware/entitlements');

const normalizeBranchId = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === 'global') return '';
  if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
  return s;
};

const isoDay = (v) => {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const makeScheduleRouter = () => {
  const r = express.Router();

  const branchIdAlternates = (id) => {
    const s = String(id || '').trim();
    if (!s) return [];
    if (s.startsWith('br_')) return [s, `b_${s.slice(3)}`];
    if (s.startsWith('b_')) return [s, `br_${s.slice(2)}`];
    return [s];
  };


  const canWrite = (role) => role === 'Cafe Owner' || role === 'Branch Manager';

  r.get('/schedule', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), requireBranchId(), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const weekStart = isoDay(req.query?.weekStart);
      if (!weekStart) return res.status(400).json({ error: 'week_start_required' });

      const branchId = req.branchId || resolveBranchId(req);

      const candidateIds = branchIdAlternates(branchId);
      const branch = await db()
        .select(['id'])
        .from('branches')
        .where({ tenant_id: req.tenant.id })
        .whereIn('id', candidateIds)
        .first();
      if (!branch) {
        const role = String(req.auth?.role || '');
        // For owners, the schedule screen is branch-scoped but we can safely return an empty view
        // instead of a hard 404 (helps with legacy/mismatched branch ids during migration).
        if (role === 'Cafe Owner') {
          return res.json({
            ok: true,
            branchId,
            weekStart,
            staff: [],
            rows: [],
            readOnly: false,
            branchMissing: true,
          });
        }
        return res.status(404).json({ error: 'branch_not_found', tenantId: req.tenant.id, branchId });
      }
      const effectiveBranchId = String(branch.id);

      const staffRows = await db()
        .select(['id', 'name', 'role_name'])
        .from('staff')
        .where({ tenant_id: req.tenant.id, branch_id: effectiveBranchId })
        .andWhere('status', '!=', 'Suspended')
        .orderBy('name', 'asc');

      const staff = staffRows.map((s) => ({
        id: String(s.id),
        name: String(s.name || ''),
        roleName: String(s.role_name || ''),
      }));

      const row = await db()
        .select(['rows'])
        .from('schedules_by_week')
        .where({ tenant_id: req.tenant.id, branch_id: effectiveBranchId, week_start: weekStart })
        .first();

      const rows = (() => {
        const parsed = safeJsonParse(row?.rows, []);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            staffId: String(x.staffId || ''),
            mon: String(x.mon || 'Off'),
            tue: String(x.tue || 'Off'),
            wed: String(x.wed || 'Off'),
            thu: String(x.thu || 'Off'),
            fri: String(x.fri || 'Off'),
            sat: String(x.sat || 'Off'),
            sun: String(x.sun || 'Off'),
          }))
          .filter((x) => x.staffId);
      })();

      const role = String(req.auth?.role || '');
      const readOnly = !canWrite(role);

      return res.json({
        ok: true,
        branchId: effectiveBranchId,
        weekStart,
        staff,
        rows,
        readOnly,
      });
    } catch (e) {
      return next(e);
    }
  });

  r.put('/schedule', tenantMiddleware, requireAuth, loadEntitlements, requireModule('staff'), requireBranchIdFromBody(), async (req, res, next) => {
    try {
      if (req.auth?.tenantId !== req.tenant.id) return res.status(403).json({ error: 'forbidden' });

      const role = String(req.auth?.role || '');
      if (!canWrite(role)) return res.status(403).json({ error: 'forbidden' });

      const body = req.body && typeof req.body === 'object' ? req.body : null;
      const weekStart = isoDay(body?.weekStart);
      if (!weekStart) return res.status(400).json({ error: 'week_start_required' });

      const branchId = req.branchId || resolveBranchId(req);

      const candidateIds = branchIdAlternates(branchId);
      const branch = await db()
        .select(['id'])
        .from('branches')
        .where({ tenant_id: req.tenant.id })
        .whereIn('id', candidateIds)
        .first();
      if (!branch) return res.status(404).json({ error: 'branch_not_found' });
      const effectiveBranchId = String(branch.id);

      const incomingRows = Array.isArray(body?.rows) ? body.rows : null;
      if (!incomingRows) return res.status(400).json({ error: 'rows_required' });

      const normalized = incomingRows
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({
          staffId: String(x.staffId || ''),
          mon: String(x.mon || 'Off'),
          tue: String(x.tue || 'Off'),
          wed: String(x.wed || 'Off'),
          thu: String(x.thu || 'Off'),
          fri: String(x.fri || 'Off'),
          sat: String(x.sat || 'Off'),
          sun: String(x.sun || 'Off'),
        }))
        .filter((x) => x.staffId)
        .slice(0, 500);

      const nowIso = new Date().toISOString();
      await db()
        .from('schedules_by_week')
        .insert({
          id: makeId('sw'),
          tenant_id: req.tenant.id,
          branch_id: effectiveBranchId,
          week_start: weekStart,
          rows: JSON.stringify(normalized),
          updated_at: nowIso,
        })
        .onConflict(['tenant_id', 'branch_id', 'week_start'])
        .merge({
          rows: JSON.stringify(normalized),
          updated_at: nowIso,
        });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeScheduleRouter };
