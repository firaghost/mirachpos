const express = require('express');

const { requireSuperadmin } = require('../../middleware/superadminAuth');
const { db } = require('../../db');
const { config } = require('../../config');
const { validateSuperadminOverviewQuery } = require('../../middleware/validators');

const toIso = (v) => {
  try {
    if (!v) return '';
    return new Date(v).toISOString();
  } catch {
    return '';
  }
};

const truncate = (s, max) => {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
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

const makeSuperadminOverviewRouter = () => {
  const r = express.Router();

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

      const subs = await db().select(['cycle', 'status', 'amount_etb']).from('tenant_subscription');
      const activeSubs = subs.filter((x) => String(x.status || '').toLowerCase() === 'active');
      const mrrEtb = Math.round(
        activeSubs.reduce((sum, x) => {
          const amt = Number(x.amount_etb || 0) || 0;
          const cyc = String(x.cycle || 'Monthly').toLowerCase();
          return sum + (cyc === 'yearly' ? amt / 12 : amt);
        }, 0),
      );

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

      const hasRestaurantTables = await db().schema.hasTable('restaurant_tables');
      const lastSyncRow = hasRestaurantTables
        ? await db().from('restaurant_tables').max({ mx: 'updated_at' }).first()
        : null;
      const lastSyncAt = toIso(lastSyncRow?.mx);

      let databaseStatus = 'unknown';
      try {
        await db().raw('SELECT 1');
        databaseStatus = 'connected';
      } catch {
        databaseStatus = 'disconnected';
      }

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

  return r;
};

module.exports = { makeSuperadminOverviewRouter };
