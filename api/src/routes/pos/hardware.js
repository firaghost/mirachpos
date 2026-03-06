const express = require('express');
const crypto = require('crypto');

const { tenantMiddleware } = require('../../middleware/tenant');
const { requireAuth } = require('../../middleware/auth');
const { loadEntitlements, requireModule } = require('../../middleware/entitlements');
const { requireRole, requirePermission } = require('../../middleware/permissions');
const { db } = require('../../db');
const { uid } = require('../../utils/ids');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

const normalizeDeviceType = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  const allowed = new Set(['printer', 'kds', 'display', 'cash_drawer', 'scanner', 'other']);
  return allowed.has(s) ? s : '';
};

const normalizeHealthState = (v) => {
  const s = String(v || '').trim().toLowerCase();
  const allowed = new Set(['online', 'degraded', 'offline']);
  return allowed.has(s) ? s : '';
};

const normalizeTransport = (v) => {
  const s = String(v || '').trim().toLowerCase();
  const allowed = new Set(['tcp', 'usb', 'http', 'none']);
  return allowed.has(s) ? s : '';
};

const normalizeJobType = (v) => {
  const s = String(v || '').trim().toLowerCase();
  const allowed = new Set(['receipt', 'kitchen', 'kds', 'label', 'report', 'other']);
  return allowed.has(s) ? s : '';
};

const mapPrintFailure = (e) => {
  const msg = String(e?.message || '').trim().toLowerCase();
  const code = String(e?.code || '').trim().toUpperCase();

  if (msg.includes('invalid_printer_address')) {
    return { code: 'print.payload.invalid', retryable: false, category: 'payload' };
  }
  if (msg.includes('printer_timeout') || code === 'ETIMEDOUT') {
    return { code: 'print.transport.timeout', retryable: true, category: 'transport' };
  }
  if (code === 'ECONNREFUSED') {
    return { code: 'print.transport.connection_refused', retryable: true, category: 'transport' };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { code: 'print.transport.unreachable', retryable: true, category: 'transport' };
  }
  if (code === 'ENOTFOUND') {
    return { code: 'print.transport.host_not_found', retryable: false, category: 'transport' };
  }

  return { code: 'print.unknown', retryable: true, category: 'unknown' };
};

const loadLegacyBranchSettings = async ({ tenantId, branchId }) => {
  try {
    const row = await db().select(['settings_json']).from('manager_settings').where({ tenant_id: tenantId, branch_id: branchId }).first();
    const parsed = safeJsonParse(row?.settings_json, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const legacyDeviceToPosDevice = (d) => {
  const kind = String(d?.kind || '').trim();
  const connection = String(d?.connection || '').trim();
  const ip = String(d?.ip || '').trim();
  const portRaw = String(d?.port || '').trim();

  const type = (() => {
    if (kind === 'Printer') return 'printer';
    if (kind === 'KDS') return 'kds';
    if (kind === 'CashDrawer') return 'cash_drawer';
    return 'other';
  })();

  const transport = connection === 'LAN' ? 'tcp' : connection === 'USB' ? 'usb' : 'none';
  const port = transport === 'tcp' ? (Number(portRaw) || 9100) : null;

  return {
    type,
    name: String(d?.name || '').trim() || 'Device',
    transport,
    host: transport === 'tcp' ? ip : null,
    port,
    capabilities: {
      legacy: {
        id: String(d?.id || '').trim(),
        model: String(d?.model || '').trim(),
        usage: String(d?.usage || '').trim(),
        profile: String(d?.profile || '').trim(),
        connection,
      },
    },
  };
};

const makePosHardwareRouter = ({ resolveBranchId, sendTcp }) => {
  const r = express.Router();

  r.post(
    '/pos/devices/import-legacy',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const legacy = await loadLegacyBranchSettings({ tenantId: req.tenant.id, branchId });
        const devices = Array.isArray(legacy?.devices) ? legacy.devices : [];

        const now = nowIso();
        const created = [];
        const skipped = [];

        for (const d of devices) {
          const legacyId = String(d?.id || '').trim();
          if (!legacyId) continue;

          const cap = legacyDeviceToPosDevice(d);
          if (cap.transport === 'tcp' && (!cap.host || !Number.isFinite(Number(cap.port)))) {
            skipped.push({ legacyId, reason: 'invalid_address' });
            continue;
          }

          const existing = await db()
            .from('pos_devices')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, deleted: 0 })
            .andWhereRaw("JSON_EXTRACT(capabilities_json, '$.legacy.id') = ?", [legacyId])
            .select(['id'])
            .first();

          if (existing?.id) {
            skipped.push({ legacyId, reason: 'already_imported', deviceId: existing.id });
            continue;
          }

          const row = {
            id: uid('dev'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            type: cap.type,
            name: cap.name,
            transport: cap.transport,
            host: cap.host,
            port: cap.port,
            capabilities_json: JSON.stringify(cap.capabilities),
            status_override: null,
            health_state: 'offline',
            last_seen_at: null,
            last_heartbeat_at: null,
            health_meta_json: null,
            deleted: 0,
            created_at: now,
            updated_at: now,
          };

          await db().from('pos_devices').insert(row);
          created.push({ legacyId, deviceId: row.id });
        }

        // Import routing (best-effort)
        const normId = (x) => String(x || '').trim();
        const legacyReceipt = normId(legacy?.defaultReceiptPrinterId);
        const legacyKitchen = normId(legacy?.defaultKitchenPrinterId);
        const legacyKitchenFallback = normId(legacy?.fallbackKitchenPrinterId);
        const legacyBar = normId(legacy?.defaultBarPrinterId);

        const resolveImportedId = async (legacyId) => {
          if (!legacyId) return '';
          const existing = await db()
            .from('pos_devices')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, deleted: 0 })
            .andWhereRaw("JSON_EXTRACT(capabilities_json, '$.legacy.id') = ?", [legacyId])
            .select(['id'])
            .first();
          return existing?.id ? String(existing.id) : '';
        };

        const upsertPolicy = async ({ jobType, primaryLegacyId, fallbackLegacyId }) => {
          const primaryId = await resolveImportedId(primaryLegacyId);
          const fallbackId = fallbackLegacyId ? await resolveImportedId(fallbackLegacyId) : '';
          if (!primaryId) return;

          const row = {
            id: uid('dpol'),
            tenant_id: req.tenant.id,
            branch_id: branchId,
            job_type: jobType,
            primary_device_id: primaryId,
            fallback_device_id: fallbackId || null,
            policy_json: JSON.stringify({ source: 'legacy_manager_settings' }),
            created_at: now,
            updated_at: now,
          };

          await db()
            .from('pos_device_assignments')
            .insert(row)
            .onConflict(['tenant_id', 'branch_id', 'job_type'])
            .merge({
              primary_device_id: row.primary_device_id,
              fallback_device_id: row.fallback_device_id,
              policy_json: row.policy_json,
              updated_at: now,
            });
        };

        await upsertPolicy({ jobType: 'receipt', primaryLegacyId: legacyReceipt, fallbackLegacyId: '' });
        await upsertPolicy({ jobType: 'kitchen', primaryLegacyId: legacyKitchen, fallbackLegacyId: legacyKitchenFallback });
        await upsertPolicy({ jobType: 'other', primaryLegacyId: legacyBar, fallbackLegacyId: '' });

        return res.json({ ok: true, created, skipped });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/devices',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const type = normalizeDeviceType(req.query?.type);
        const health = normalizeHealthState(req.query?.health);

        let q = db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, deleted: 0 })
          .select([
            'id',
            'type',
            'name',
            'transport',
            'host',
            'port',
            'capabilities_json',
            'status_override',
            'health_state',
            'last_seen_at',
            'last_heartbeat_at',
            'health_meta_json',
            'created_at',
            'updated_at',
          ])
          .orderBy('updated_at', 'desc');

        if (type) q = q.andWhere({ type });
        if (health) q = q.andWhere({ health_state: health });

        const rows = await q;
        const devices = rows.map((d) => ({
          id: d.id,
          type: d.type,
          name: d.name,
          transport: d.transport,
          host: d.host,
          port: d.port,
          capabilities: safeJsonParse(d.capabilities_json, null),
          statusOverride: d.status_override,
          healthState: d.health_state,
          lastSeenAt: d.last_seen_at,
          lastHeartbeatAt: d.last_heartbeat_at,
          healthMeta: safeJsonParse(d.health_meta_json, null),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }));

        return res.json({ ok: true, branchId, devices });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/devices',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const type = normalizeDeviceType(req.body?.type);
        const name = String(req.body?.name || '').trim();
        const transport = normalizeTransport(req.body?.transport) || 'tcp';
        const host = String(req.body?.host || '').trim();
        const port = req.body?.port != null ? Number(req.body.port) : null;

        if (!type) return res.status(400).json({ error: 'invalid_type' });
        if (!name) return res.status(400).json({ error: 'name_required' });
        if (transport === 'tcp') {
          if (!host) return res.status(400).json({ error: 'host_required' });
          if (!Number.isFinite(port) || port <= 0 || port > 65535) return res.status(400).json({ error: 'invalid_port' });
        }

        const row = {
          id: uid('dev'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          type,
          name,
          transport,
          host: transport === 'tcp' ? host : null,
          port: transport === 'tcp' ? port : null,
          capabilities_json: req.body?.capabilities ? JSON.stringify(req.body.capabilities) : null,
          status_override: null,
          health_state: 'offline',
          last_seen_at: null,
          last_heartbeat_at: null,
          health_meta_json: null,
          deleted: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        };

        await db().from('pos_devices').insert(row);
        return res.status(201).json({ ok: true, deviceId: row.id });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.patch(
    '/pos/devices/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const existing = await db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id, deleted: 0 })
          .select(['id', 'transport'])
          .first();
        if (!existing) return res.status(404).json({ error: 'device_not_found' });

        const patch = {};

        if (req.body?.name != null) {
          const name = String(req.body.name || '').trim();
          if (!name) return res.status(400).json({ error: 'name_required' });
          patch.name = name;
        }

        if (req.body?.transport != null) {
          const transport = normalizeTransport(req.body.transport);
          if (!transport) return res.status(400).json({ error: 'invalid_transport' });
          patch.transport = transport;
          patch.host = transport === 'tcp' ? String(req.body?.host || '').trim() : null;
          patch.port = transport === 'tcp' ? Number(req.body?.port || 0) : null;

          if (transport === 'tcp') {
            if (!patch.host) return res.status(400).json({ error: 'host_required' });
            if (!Number.isFinite(patch.port) || patch.port <= 0 || patch.port > 65535) return res.status(400).json({ error: 'invalid_port' });
          }
        } else if (existing.transport === 'tcp') {
          if (req.body?.host != null) patch.host = String(req.body.host || '').trim() || null;
          if (req.body?.port != null) patch.port = Number(req.body.port) || null;
        }

        if (req.body?.capabilities != null) {
          patch.capabilities_json = req.body.capabilities ? JSON.stringify(req.body.capabilities) : null;
        }

        if (req.body?.statusOverride !== undefined) {
          const next = req.body.statusOverride == null ? null : normalizeHealthState(req.body.statusOverride);
          if (req.body.statusOverride != null && !next) return res.status(400).json({ error: 'invalid_status_override' });
          patch.status_override = next;
        }

        patch.updated_at = nowIso();

        await db().from('pos_devices').where({ tenant_id: req.tenant.id, branch_id: branchId, id }).update(patch);
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.delete(
    '/pos/devices/:id',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id_required' });

        const now = nowIso();
        const n = await db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id, deleted: 0 })
          .update({ deleted: 1, updated_at: now });

        if (!n) return res.status(404).json({ error: 'device_not_found' });
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/device-policies',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const rows = await db()
          .from('pos_device_assignments')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .select(['job_type', 'primary_device_id', 'fallback_device_id', 'policy_json', 'updated_at'])
          .orderBy('job_type', 'asc');

        const policies = rows.map((p) => ({
          jobType: p.job_type,
          primaryDeviceId: p.primary_device_id,
          fallbackDeviceId: p.fallback_device_id,
          policy: safeJsonParse(p.policy_json, null),
          updatedAt: p.updated_at,
        }));

        return res.json({ ok: true, branchId, policies });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.put(
    '/pos/device-policies/:jobType',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('manager.settings.write'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const jobType = normalizeJobType(req.params?.jobType);
        if (!jobType) return res.status(400).json({ error: 'invalid_job_type' });

        const primaryDeviceId = String(req.body?.primaryDeviceId || '').trim();
        const fallbackDeviceId = req.body?.fallbackDeviceId ? String(req.body.fallbackDeviceId).trim() : null;
        if (!primaryDeviceId) return res.status(400).json({ error: 'primary_device_required' });

        const primaryExists = await db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: primaryDeviceId, deleted: 0 })
          .select(['id'])
          .first();
        if (!primaryExists) return res.status(404).json({ error: 'primary_device_not_found' });

        if (fallbackDeviceId) {
          const fallbackExists = await db()
            .from('pos_devices')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id: fallbackDeviceId, deleted: 0 })
            .select(['id'])
            .first();
          if (!fallbackExists) return res.status(404).json({ error: 'fallback_device_not_found' });
        }

        const now = nowIso();
        const row = {
          id: uid('dpol'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          job_type: jobType,
          primary_device_id: primaryDeviceId,
          fallback_device_id: fallbackDeviceId,
          policy_json: req.body?.policy ? JSON.stringify(req.body.policy) : null,
          created_at: now,
          updated_at: now,
        };

        await db()
          .from('pos_device_assignments')
          .insert(row)
          .onConflict(['tenant_id', 'branch_id', 'job_type'])
          .merge({
            primary_device_id: primaryDeviceId,
            fallback_device_id: fallbackDeviceId,
            policy_json: row.policy_json,
            updated_at: now,
          });

        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/devices/:id/heartbeat',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager', 'Waiter', 'Waiter Manager'),
    loadEntitlements,
    requireModule('settings'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const deviceId = String(req.params?.id || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_required' });

        const device = await db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: deviceId, deleted: 0 })
          .select(['id', 'status_override'])
          .first();
        if (!device) return res.status(404).json({ error: 'device_not_found' });

        const reported = req.body?.state != null ? normalizeHealthState(req.body.state) : '';
        const payload = req.body && typeof req.body === 'object' ? req.body : {};

        const ts = nowIso();
        await db().from('pos_device_heartbeats').insert({
          id: uid('hb'),
          tenant_id: req.tenant.id,
          branch_id: branchId,
          device_id: deviceId,
          received_at: ts,
          reported_state: reported || null,
          payload_json: JSON.stringify(payload || {}),
        });

        const override = normalizeHealthState(device.status_override);
        const nextHealth = override || 'online';
        await db()
          .from('pos_devices')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id: deviceId })
          .update({
            last_seen_at: ts,
            last_heartbeat_at: ts,
            health_state: nextHealth,
            updated_at: ts,
          });

        return res.json({ ok: true, healthState: nextHealth });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.get(
    '/pos/print/queue',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const status = String(req.query?.status || '').trim().toLowerCase();
        const statuses = status ? status.split(',').map((x) => x.trim()).filter(Boolean) : [];

        let q = db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId })
          .orderBy('created_at', 'desc')
          .limit(300)
          .select([
            'id',
            'order_id',
            'profile',
            'job_type',
            'device_id',
            'fallback_device_id',
            'status',
            'error',
            'last_error',
            'attempts',
            'last_attempt_at',
            'next_attempt_at',
            'dead_lettered_at',
            'dead_letter_reason',
            'created_at',
            'updated_at',
          ]);

        if (statuses.length) q = q.whereIn('status', statuses);

        const rows = await q;
        return res.json({
          ok: true,
          branchId,
          items: rows.map((x) => ({
            id: x.id,
            orderId: x.order_id,
            profile: x.profile,
            jobType: x.job_type,
            deviceId: x.device_id,
            fallbackDeviceId: x.fallback_device_id,
            status: x.status,
            error: x.error,
            lastError: x.last_error,
            attempts: x.attempts,
            lastAttemptAt: x.last_attempt_at,
            nextAttemptAt: x.next_attempt_at,
            deadLetteredAt: x.dead_lettered_at,
            deadLetterReason: x.dead_letter_reason,
            createdAt: x.created_at,
            updatedAt: x.updated_at,
          })),
        });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/print/dispatch/next',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const now = nowIso();
        const row = await db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, status: 'pending' })
          .andWhere(function () {
            this.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now);
          })
          .orderBy('created_at', 'asc')
          .select(['id', 'payload_json', 'job_type', 'device_id', 'fallback_device_id', 'attempts'])
          .first();

        if (!row) return res.json({ ok: true, dispatched: false });

        const jobType = normalizeJobType(row.job_type) || 'other';
        const payload = safeJsonParse(row.payload_json, null);

        const resolveTarget = async () => {
          if (row.device_id) return { primaryId: String(row.device_id), fallbackId: row.fallback_device_id ? String(row.fallback_device_id) : null };

          const policy = await db()
            .from('pos_device_assignments')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, job_type: jobType })
            .select(['primary_device_id', 'fallback_device_id'])
            .first();

          if (policy?.primary_device_id) {
            return {
              primaryId: String(policy.primary_device_id),
              fallbackId: policy?.fallback_device_id ? String(policy.fallback_device_id) : null,
            };
          }

          return { primaryId: '', fallbackId: null };
        };

        const target = await resolveTarget();
        if (!target.primaryId) {
          await db().from('print_queue').where({ id: row.id }).update({
            status: 'failed',
            error: 'print.payload.invalid',
            last_error: 'print.payload.invalid',
            updated_at: now,
          });
          return res.status(409).json({ ok: false, error: 'no_device_assigned' });
        }

        const loadDevice = async (id) => {
          const d = await db()
            .from('pos_devices')
            .where({ tenant_id: req.tenant.id, branch_id: branchId, id, deleted: 0 })
            .select(['id', 'transport', 'host', 'port', 'health_state', 'status_override'])
            .first();
          if (!d) return null;

          const override = normalizeHealthState(d.status_override);
          const effective = override || String(d.health_state || 'offline');
          return { ...d, effectiveHealth: effective };
        };

        const primary = await loadDevice(target.primaryId);
        const fallback = target.fallbackId ? await loadDevice(target.fallbackId) : null;

        const pick = (primary && primary.effectiveHealth === 'online')
          ? primary
          : (fallback && fallback.effectiveHealth === 'online')
            ? fallback
            : primary || fallback;

        if (!pick) {
          await db().from('print_queue').where({ id: row.id }).update({
            status: 'failed',
            error: 'print.device.offline',
            last_error: 'print.device.offline',
            updated_at: now,
          });
          return res.status(409).json({ ok: false, error: 'device_not_found' });
        }

        if (pick.effectiveHealth !== 'online') {
          await db().from('print_queue').where({ id: row.id }).update({
            status: 'failed',
            error: 'print.device.offline',
            last_error: 'print.device.offline',
            updated_at: now,
          });
          return res.status(409).json({ ok: false, error: 'device_offline' });
        }

        if (String(pick.transport) !== 'tcp') {
          await db().from('print_queue').where({ id: row.id }).update({
            status: 'failed',
            error: 'print.payload.invalid',
            last_error: 'print.payload.invalid',
            updated_at: now,
          });
          return res.status(400).json({ ok: false, error: 'unsupported_transport' });
        }

        const host = String(pick.host || '').trim();
        const port = Number(pick.port || 0);
        if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
          await db().from('print_queue').where({ id: row.id }).update({
            status: 'failed',
            error: 'print.payload.invalid',
            last_error: 'print.payload.invalid',
            updated_at: now,
          });
          return res.status(400).json({ ok: false, error: 'invalid_device_address' });
        }

        const raw = (() => {
          if (!payload) return Buffer.from('', 'utf8');
          if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
          if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) return Buffer.from(payload.data);
          if (payload && payload.base64) {
            try {
              return Buffer.from(String(payload.base64), 'base64');
            } catch {
              return Buffer.from('', 'utf8');
            }
          }
          try {
            return Buffer.from(JSON.stringify(payload), 'utf8');
          } catch {
            return Buffer.from('', 'utf8');
          }
        })();

        const attempt = Number(row.attempts || 0) || 0;
        try {
          await sendTcp({ host, port: String(port), data: raw, timeoutMs: 8000 });
          await db().from('print_queue').where({ id: row.id }).update({ status: 'printed', last_error: null, last_attempt_at: now, updated_at: now });
          return res.json({ ok: true, dispatched: true, queueId: row.id, deviceId: pick.id });
        } catch (e) {
          const mapped = mapPrintFailure(e);
          const nextAttempts = attempt + 1;
          const nextAt = new Date(Date.now() + 10000).toISOString();
          const terminal = nextAttempts >= 3 || mapped.retryable === false;

          await db().from('print_queue').where({ id: row.id }).update({
            status: terminal ? 'failed' : 'pending',
            error: mapped.code,
            last_error: mapped.code,
            attempts: nextAttempts,
            last_attempt_at: now,
            next_attempt_at: terminal ? null : nextAt,
            updated_at: now,
          });

          return res.status(502).json({ ok: false, dispatched: true, queueId: row.id, error: mapped.code, attempts: nextAttempts, nextAttemptAt: terminal ? null : nextAt });
        }
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/print/queue/:id/dead-letter',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'queue_id_required' });

        const reason = String(req.body?.reason || '').trim().slice(0, 128);
        const now = nowIso();

        const n = await db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update({
            status: 'failed',
            dead_lettered_at: now,
            dead_letter_reason: reason || 'manual_dead_letter',
            updated_at: now,
          });

        if (!n) return res.status(404).json({ error: 'queue_item_not_found' });
        return res.json({ ok: true });
      } catch (e) {
        return next(e);
      }
    },
  );

  r.post(
    '/pos/print/queue/:id/cancel',
    tenantMiddleware,
    requireAuth,
    requireRole('Cafe Owner', 'Branch Manager'),
    loadEntitlements,
    requireModule('orders'),
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const branchId = await resolveBranchId(req);
        if (!branchId) return res.status(400).json({ error: 'branch_required' });

        const id = String(req.params?.id || '').trim();
        if (!id) return res.status(400).json({ error: 'queue_id_required' });

        const now = nowIso();

        const row = await db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .select(['id', 'status'])
          .first();
        if (!row) return res.status(404).json({ error: 'queue_item_not_found' });

        const status = String(row.status || '').trim().toLowerCase();
        if (status === 'printed') return res.status(409).json({ error: 'already_printed' });

        await db()
          .from('print_queue')
          .where({ tenant_id: req.tenant.id, branch_id: branchId, id })
          .update({
            status: 'canceled',
            dead_lettered_at: now,
            dead_letter_reason: 'canceled_by_operator',
            updated_at: now,
          });

        return res.json({ ok: true, status: 'canceled' });
      } catch (e) {
        return next(e);
      }
    },
  );

  return r;
};

module.exports = { makePosHardwareRouter };
