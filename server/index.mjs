import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const OWNER_API_TOKEN = process.env.OWNER_API_TOKEN || '';
const REMOTE_API_BASE = (() => {
  try {
    const v = String(process.env.REMOTE_API_BASE || '').trim();
    return v ? v.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

const nowIso = () => new Date().toISOString();

const randSaltB64 = () => crypto.randomBytes(16).toString('base64');
const pbkdf2B64 = (secret, saltB64, iters) => {
  const salt = Buffer.from(String(saltB64 || ''), 'base64');
  const n = Number.isFinite(Number(iters)) ? Number(iters) : 120000;
  const derived = crypto.pbkdf2Sync(String(secret || ''), salt, n, 32, 'sha256');
  return derived.toString('base64');
};

const generatePin = () => {
  const n = Math.floor(1000 + Math.random() * 9000);
  return String(n);
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const proxyToRemote = async (req, res, url) => {
  if (!REMOTE_API_BASE) return false;

  // Avoid accidental proxy loops.
  try {
    const upstream = new URL(REMOTE_API_BASE);
    const host = String(req.headers.host || '');
    if (host && upstream.host === host) return false;
  } catch {
    // ignore
  }

  if (!url.pathname.startsWith('/api/')) return false;
  if (typeof globalThis.fetch !== 'function') {
    json(res, 500, { error: 'fetch_not_available' });
    return true;
  }

  const target = `${REMOTE_API_BASE}${url.pathname}${url.search || ''}`;
  const method = (req.method || 'GET').toUpperCase();

  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    const lk = String(k).toLowerCase();
    if (lk === 'host') continue;
    if (lk === 'connection') continue;
    if (lk === 'content-length') continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }

  let body = undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    if (buf.length > 0) body = buf;
  }

  const upstreamRes = await fetch(target, {
    method,
    headers,
    body,
    redirect: 'manual',
  }).catch((e) => {
    json(res, 502, { error: 'upstream_fetch_failed', message: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (!upstreamRes) return true;

  const outHeaders = {};
  try {
    upstreamRes.headers.forEach((value, key) => {
      const lk = String(key).toLowerCase();
      if (lk === 'transfer-encoding') return;
      if (lk === 'content-encoding') return;
      outHeaders[key] = value;
    });
  } catch {
    // ignore
  }

  const ab = await upstreamRes.arrayBuffer().catch(() => null);
  const buf = ab ? Buffer.from(ab) : Buffer.from('');
  res.writeHead(upstreamRes.status, outHeaders);
  res.end(buf);
  return true;
};

const isoDay = (d) => {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};

const isoMonth = (d) => {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 7);
};

const monthLabel = (ym) => {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const d = new Date(`${ym}-01T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleString(undefined, { month: 'short' });
};

const subscriptionModules = (tier) => {
  const t = String(tier || 'Enterprise');
  // Option B (fine-grained SaaS): core operation modules (pos/orders/tables) + tier upgrades.
  // Single-branch tiers intentionally do NOT include owner_dashboard/branches.
  if (t === 'Trial') return ['pos', 'orders', 'tables', 'staff'];
  if (t === 'Basic') return ['pos', 'orders', 'tables', 'staff', 'reports'];
  if (t === 'Pro') return ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance'];
  return ['pos', 'orders', 'tables', 'reports', 'inventory', 'menu', 'staff', 'finance', 'settings', 'owner_dashboard', 'branches', 'guests'];
};

const branchLimitForTier = (tier) => {
  const t = String(tier || 'Enterprise');
  if (t === 'Trial') return 1;
  if (t === 'Basic') return 1;
  if (t === 'Pro') return 3;
  return 999;
};

const BASE_DOMAIN = 'mirachpos.com';

const getSubscription = (db) => {
  const tier = (db && db.subscription && typeof db.subscription.tier === 'string' && db.subscription.tier.trim()) ? db.subscription.tier.trim() : 'Enterprise';
  return { tier, modules: subscriptionModules(tier) };
};

const getTenantSubscription = (db, tenantId) => {
  const id = String(tenantId || '');
  const t = Array.isArray(db?.tenants) ? db.tenants.find((x) => x && x.id === id) : null;
  const tier = (t && t.subscription && typeof t.subscription.tier === 'string' && t.subscription.tier.trim()) ? t.subscription.tier.trim() : getSubscription(db).tier;
  const base = subscriptionModules(tier);
  const enabled = Array.isArray(t?.subscription?.enabledModules)
    ? t.subscription.enabledModules.map((m) => String(m || '')).filter(Boolean)
    : null;
  const modules = enabled ? base.filter((m) => enabled.includes(m)) : base;
  const trialStartAt = (t && t.subscription && typeof t.subscription.trialStartAt === 'string') ? t.subscription.trialStartAt : '';
  const trialEndsAt = (t && t.subscription && typeof t.subscription.trialEndsAt === 'string') ? t.subscription.trialEndsAt : '';
  return { tier, modules, trialStartAt, trialEndsAt };
};

const normalizeTenants = (db) => {
  const next = { ...db };
  next.tenants = Array.isArray(next.tenants) ? next.tenants : [];
  next.invoices = Array.isArray(next.invoices) ? next.invoices : [];

  const addMonthsIso = (iso, months) => {
    const base = iso ? new Date(iso) : new Date();
    const d = new Date(Number.isNaN(base.getTime()) ? Date.now() : base.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month rollover (e.g., Jan 31 -> Feb)
    if (d.getDate() < day) d.setDate(0);
    return d.toISOString();
  };

  const isPastOrInvalid = (iso) => {
    if (!iso || typeof iso !== 'string') return true;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return true;
    return t <= Date.now();
  };

  if (next.tenants.length === 0) {
    const sub = getSubscription(next);
    next.tenants.push({
      id: 'tenant_global',
      name: 'Default Cafe',
      slug: 'default',
      domain: `default.${BASE_DOMAIN}`,
      status: 'Active',
      subscription: { tier: sub.tier },
      features: ['loyalty', 'public_api'],
      onboarding: {
        stage: 'activation',
        completedAt: '',
      },
      internalTags: [],
      billing: {
        cycle: 'Monthly',
        method: 'Cash',
        status: 'Active',
        nextBillAt: '',
        amountEtb: 0,
        graceEndsAt: '',
      },
      profile: {
        contactEmail: '',
        contactPhone: '',
        address1: '',
        city: '',
        country: '',
        timezone: 'Africa/Addis_Ababa',
        currency: 'ETB',
        customDomain: '',
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  // Ensure required fields
  next.tenants = next.tenants
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      id: String(t.id || ''),
      name: String(t.name || ''),
      slug: String(t.slug || ''),
      domain: String(t.domain || ''),
      status: String(t.status || 'Active'),
      subscription: {
        tier: String(t.subscription?.tier || 'Enterprise'),
        enabledModules: Array.isArray(t.subscription?.enabledModules)
          ? t.subscription.enabledModules.map((m) => String(m || '')).filter(Boolean)
          : undefined,
      },
      features: Array.isArray(t.features) ? t.features.map((f) => String(f || '')).filter(Boolean) : [],
      onboarding: {
        stage: (typeof t.onboarding?.stage === 'string' && t.onboarding.stage.trim()) ? t.onboarding.stage.trim() : 'incoming',
        completedAt: (typeof t.onboarding?.completedAt === 'string') ? t.onboarding.completedAt : '',
      },
      internalTags: Array.isArray(t.internalTags) ? t.internalTags.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30) : [],
      billing: {
        cycle: (typeof t.billing?.cycle === 'string' && t.billing.cycle.trim()) ? t.billing.cycle.trim() : 'Monthly',
        method: (typeof t.billing?.method === 'string' && t.billing.method.trim()) ? t.billing.method.trim() : 'Cash',
        status: (typeof t.billing?.status === 'string' && t.billing.status.trim()) ? t.billing.status.trim() : 'Active',
        nextBillAt: (typeof t.billing?.nextBillAt === 'string') ? t.billing.nextBillAt : '',
        amountEtb: (typeof t.billing?.amountEtb === 'number' && Number.isFinite(t.billing.amountEtb)) ? t.billing.amountEtb : 0,
        graceEndsAt: (typeof t.billing?.graceEndsAt === 'string') ? t.billing.graceEndsAt : '',
      },
      profile: {
        contactEmail: typeof t.profile?.contactEmail === 'string' ? t.profile.contactEmail : '',
        contactPhone: typeof t.profile?.contactPhone === 'string' ? t.profile.contactPhone : '',
        address1: typeof t.profile?.address1 === 'string' ? t.profile.address1 : '',
        city: typeof t.profile?.city === 'string' ? t.profile.city : '',
        country: typeof t.profile?.country === 'string' ? t.profile.country : '',
        timezone: typeof t.profile?.timezone === 'string' && t.profile.timezone ? t.profile.timezone : 'Africa/Addis_Ababa',
        currency: typeof t.profile?.currency === 'string' && t.profile.currency ? t.profile.currency : 'ETB',
        customDomain: typeof t.profile?.customDomain === 'string' ? t.profile.customDomain : '',
      },
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : nowIso(),
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : nowIso(),
    }))
    .filter((t) => t.id && t.name);

  // Auto-populate/roll-forward nextBillAt
  next.tenants = next.tenants.map((t) => {
    const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};
    const cycle = String(billing.cycle || 'Monthly');
    const stepMonths = cycle === 'Yearly' ? 12 : 1;

    const base =
      (t.subscription && typeof t.subscription.trialEndsAt === 'string' && t.subscription.trialEndsAt) ? t.subscription.trialEndsAt :
      (typeof billing.nextBillAt === 'string' && billing.nextBillAt) ? billing.nextBillAt :
      (typeof t.createdAt === 'string' && t.createdAt) ? t.createdAt :
      nowIso();

    let nextBillAt = typeof billing.nextBillAt === 'string' ? billing.nextBillAt : '';
    if (isPastOrInvalid(nextBillAt)) {
      // If missing/invalid/past, compute from base and roll forward to be in the future.
      nextBillAt = addMonthsIso(base, stepMonths);
      while (isPastOrInvalid(nextBillAt)) nextBillAt = addMonthsIso(nextBillAt, stepMonths);
    }

    return { ...t, billing: { ...billing, cycle, nextBillAt } };
  });

  // Backfill slug/domain if older records exist
  next.tenants = next.tenants.map((t) => {
    const slug = t.slug && String(t.slug).trim() ? String(t.slug).trim().toLowerCase() : normalizeTenantSlug(t.name);
    const domain = `${slug}.${BASE_DOMAIN}`;
    return { ...t, slug, domain };
  });

  return next;
};

const normalizeTenantSlug = (v) => {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);
  return slug;
};

const slugLooksOk = (v) => {
  const s = normalizeTenantSlug(v);
  if (!s) return false;
  if (s.length < 2 || s.length > 48) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
};

const uniqueSlugForTenants = (tenants, baseSlug) => {
  const slug0 = normalizeTenantSlug(baseSlug);
  const used = new Set((tenants || []).map((t) => String(t?.slug || '').toLowerCase()).filter(Boolean));
  if (!used.has(slug0) && slugLooksOk(slug0)) return slug0;
  for (let i = 2; i < 10_000; i++) {
    const s = `${slug0}-${i}`;
    if (!used.has(s) && slugLooksOk(s)) return s;
  }
  return `tenant-${Math.random().toString(16).slice(2, 10)}`;
};

const uid = () => `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
const randToken = () => `tok_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
const staffId = () => `st_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const tenantDataFile = (tenantId) => {
  const id = String(tenantId || '').trim();
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return path.join(TENANTS_DIR, `${safe || 'tenant'}.json`);
};

const loadTenantDb = (tenantId) => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(TENANTS_DIR)) mkdirSync(TENANTS_DIR, { recursive: true });
  const file = tenantDataFile(tenantId);
  if (!existsSync(file)) {
    const init = { branches: {}, staff: [], roles: [], sessions: [], events: [] };
    writeFileSync(file, JSON.stringify(init, null, 2), 'utf8');
  }
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    const db = parsed && typeof parsed === 'object' ? parsed : {};
    db.branches = db.branches && typeof db.branches === 'object' ? db.branches : {};
    db.staff = Array.isArray(db.staff) ? db.staff : [];
    db.roles = Array.isArray(db.roles) ? db.roles : [];
    db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
    db.events = Array.isArray(db.events) ? db.events : [];
    return db;
  } catch {
    return { branches: {}, staff: [], roles: [], sessions: [], events: [] };
  }
};

const saveTenantDb = (tenantId, db) => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(TENANTS_DIR)) mkdirSync(TENANTS_DIR, { recursive: true });
  const file = tenantDataFile(tenantId);
  writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
};

const loadDb = () => {
  try {
    if (!existsSync(DATA_FILE)) {
      const init = normalizeTenants({ subscription: { tier: 'Enterprise' }, demoMode: false, branches: {}, staff: [], roles: [], sessions: [], events: [] });
      saveDb(init);
      return init;
    }
    const raw = readFileSync(DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    const db = parsed && typeof parsed === 'object' ? parsed : {};
    db.subscription = db.subscription && typeof db.subscription === 'object' ? db.subscription : { tier: 'Enterprise' };
    db.demoMode = db && typeof db.demoMode === 'boolean' ? db.demoMode : false;
    db.branches = db.branches && typeof db.branches === 'object' ? db.branches : {};
    db.staff = Array.isArray(db.staff) ? db.staff : [];
    db.roles = Array.isArray(db.roles) ? db.roles : [];
    db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
    db.events = Array.isArray(db.events) ? db.events : [];
    return normalizeTenants(db);
  } catch {
    return normalizeTenants({ subscription: { tier: 'Enterprise' }, demoMode: false, branches: {}, staff: [], roles: [], sessions: [], events: [] });
  }
};

const saveDb = (db) => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
};

const normalizeEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const emailLooksOk = (email) => !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

const generateTempPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
};

const roleNameFromRoleId = (db, roleId) => {
  const roles = Array.isArray(db?.roles) ? db.roles : [];
  const r = roles.find((x) => x && String(x.id || '') === String(roleId || ''));
  return r && typeof r.name === 'string' && r.name ? r.name : '';
};

const requireRole = (res, ctx, allowed) => {
  if (!ctx || !allowed.includes(ctx.role)) {
    json(res, 403, { error: 'forbidden', role: ctx?.role || '' });
    return false;
  }
  return true;
};

const hrtimeMs = () => {
  const ns = typeof process?.hrtime?.bigint === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
  return Number(ns) / 1_000_000;
};

const minutesBetween = (aIso, bIso) => {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 60000));
};

const nextSupportTicketNumber = (db) => {
  const tickets = Array.isArray(db?.supportTickets) ? db.supportTickets : [];
  const nums = tickets
    .map((t) => {
      const n = Number(String(t?.id || '').replace(/[^0-9]/g, ''));
      return Number.isFinite(n) ? n : 0;
    })
    .filter((n) => n > 0);
  const max = nums.length ? Math.max(...nums) : 9200;
  return max + 1;
};

const requireSession = (req, res, db) => {
  const header = String(req.headers.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  const sessions = Array.isArray(db.sessions) ? db.sessions : [];
  const s = sessions.find((x) => x && x.token === token);
  if (!s) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    json(res, 401, { error: 'session_expired' });
    return null;
  }
  return { token: s.token, role: s.role, branchId: s.branchId || 'global', staffId: s.staffId || '', tenantId: s.tenantId || 'tenant_global' };
};

const syncAllowedEventTypesByClient = {
  mobile: new Set([
    'order.draft_created',
    'order.draft_item_upserted',
    'order.draft_item_removed',
    'order.draft_discount_set',
    'order.draft_notes_set',
    'order.draft_submitted',
  ]),
  desktop: new Set([
    'order.draft_created',
    'order.draft_item_upserted',
    'order.draft_item_removed',
    'order.draft_discount_set',
    'order.draft_notes_set',
    'order.draft_submitted',
    'order.accepted',
    'order.rejected',
    'order.sent_to_kitchen',
    'payment.recorded',
    'order.closed',
    'order.voided',
    'table.lease_acquired',
    'table.lease_released',
  ]),
};

const ensureSyncState = (tdb) => {
  const next = tdb && typeof tdb === 'object' ? tdb : {};
  next.sync = next.sync && typeof next.sync === 'object' ? next.sync : {};
  next.sync.cursor = Number.isFinite(Number(next.sync.cursor)) ? Number(next.sync.cursor) : 0;
  next.sync.events = Array.isArray(next.sync.events) ? next.sync.events : [];
  next.sync.eventIds = next.sync.eventIds && typeof next.sync.eventIds === 'object' ? next.sync.eventIds : {};
  next.sync.drafts = Array.isArray(next.sync.drafts) ? next.sync.drafts : [];
  next.sync.audit = Array.isArray(next.sync.audit) ? next.sync.audit : [];
  return next;
};

const resolveStaffName = (tdb, staffIdValue) => {
  const staffId = String(staffIdValue || '');
  if (!staffId) return '';
  const staff = Array.isArray(tdb?.staff) ? tdb.staff : [];
  const s = staff.find((x) => x && String(x.id || '') === staffId);
  return s && typeof s.name === 'string' ? s.name : '';
};

const normalizeSyncEvent = (evt) => {
  if (!evt || typeof evt !== 'object') return null;
  const event_id = typeof evt.event_id === 'string' ? evt.event_id.trim() : '';
  const tenant_id = typeof evt.tenant_id === 'string' ? evt.tenant_id.trim() : '';
  const branch_id = typeof evt.branch_id === 'string' ? evt.branch_id.trim() : '';
  const device_id = typeof evt.device_id === 'string' ? evt.device_id.trim() : '';
  const client_type = evt.client_type === 'mobile' ? 'mobile' : evt.client_type === 'desktop' ? 'desktop' : '';
  const aggregate_type = typeof evt.aggregate_type === 'string' ? evt.aggregate_type.trim() : '';
  const aggregate_id = typeof evt.aggregate_id === 'string' ? evt.aggregate_id.trim() : '';
  const event_type = typeof evt.event_type === 'string' ? evt.event_type.trim() : '';
  const created_at_local = typeof evt.created_at_local === 'string' ? evt.created_at_local.trim() : '';
  const payload = evt.payload && typeof evt.payload === 'object' ? evt.payload : {};

  if (!event_id || !tenant_id || !branch_id || !device_id) return null;
  if (!client_type || !aggregate_type || !aggregate_id || !event_type) return null;

  return {
    event_id,
    tenant_id,
    branch_id,
    device_id,
    client_type,
    aggregate_type,
    aggregate_id,
    event_type,
    created_at_local,
    payload,
  };
};

const upsertDraftProjection = (tdb, e, observedAtServer) => {
  const sync = tdb.sync;
  sync.drafts = Array.isArray(sync.drafts) ? sync.drafts : [];

  const draftId = String(e?.payload?.draft_id || e?.aggregate_id || '');
  if (!draftId) return;

  const idx = sync.drafts.findIndex((d) => d && String(d.draft_id || '') === draftId);
  const cur = idx >= 0 && sync.drafts[idx] && typeof sync.drafts[idx] === 'object' ? sync.drafts[idx] : null;

  const base = cur || {
    draft_id: draftId,
    tenant_id: e.tenant_id,
    branch_id: e.branch_id,
    created_by_staff_id: '',
    status: 'DRAFT',
    notes: '',
    items: [],
    created_at_local: e.created_at_local || '',
    created_at_server: observedAtServer,
    updated_at_server: observedAtServer,
    summary: { items: 0, total: 0 },
  };

  const next = { ...base, updated_at_server: observedAtServer };

  if (e.event_type === 'order.draft_created') {
    next.created_by_staff_id = String(e.payload?.created_by_staff_id || next.created_by_staff_id || '');
    next.status = 'DRAFT';
    if (typeof e.payload?.note === 'string' && e.payload.note.trim()) {
      next.notes = e.payload.note.trim();
    }
  }
  if (e.event_type === 'order.draft_notes_set') {
    const n = typeof e.payload?.notes === 'string' ? e.payload.notes : typeof e.payload?.note === 'string' ? e.payload.note : '';
    next.notes = typeof n === 'string' ? n : '';
  }
  if (e.event_type === 'order.draft_item_upserted') {
    const productId = typeof e.payload?.product_id === 'string' ? e.payload.product_id : typeof e.payload?.productId === 'string' ? e.payload.productId : '';
    const name = typeof e.payload?.name === 'string' ? e.payload.name : '';
    const image = typeof e.payload?.image === 'string' ? e.payload.image : '';
    const unitPrice = Number(e.payload?.unit_price ?? e.payload?.unitPrice ?? 0);
    const qty = Number(e.payload?.qty ?? 0);

    if (productId && Number.isFinite(qty) && qty > 0) {
      const items = Array.isArray(next.items) ? [...next.items] : [];
      const idxItem = items.findIndex((it) => it && String(it.product_id || '') === productId);
      const rec = {
        product_id: productId,
        name,
        image,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
        qty,
      };
      if (idxItem >= 0) items[idxItem] = { ...items[idxItem], ...rec };
      else items.push(rec);
      next.items = items;
    }
  }
  if (e.event_type === 'order.draft_item_removed') {
    const productId = typeof e.payload?.product_id === 'string' ? e.payload.product_id : typeof e.payload?.productId === 'string' ? e.payload.productId : '';
    if (productId) {
      const items = Array.isArray(next.items) ? next.items.filter((it) => it && String(it.product_id || '') !== productId) : [];
      next.items = items;
    }
  }
  if (e.event_type === 'order.draft_submitted') {
    next.status = 'SUBMITTED';
    next.submitted_at_local = String(e.payload?.submitted_at_local || e.created_at_local || '');
  }
  if (e.event_type === 'order.accepted') {
    next.status = 'ACCEPTED';
    next.accepted_by_staff_id = String(e.payload?.accepted_by_staff_id || '');
    next.order_id = String(e.payload?.order_id || e.payload?.draft_id || draftId);
    next.table_id = typeof e.payload?.table_id === 'string' ? e.payload.table_id : '';
  }
  if (e.event_type === 'order.rejected') {
    next.status = 'REJECTED';
    next.rejected_reason = typeof e.payload?.reason === 'string' ? e.payload.reason : '';
  }

  if (Array.isArray(next.items)) {
    let itemsCount = 0;
    let total = 0;
    for (const it of next.items) {
      const q = Number(it?.qty ?? 0);
      const p = Number(it?.unit_price ?? 0);
      if (!Number.isFinite(q) || q <= 0) continue;
      itemsCount += q;
      if (Number.isFinite(p) && p > 0) total += q * p;
    }
    next.summary = { items: itemsCount, total };
  }

  if (idx >= 0) sync.drafts[idx] = next;
  else sync.drafts.push(next);

  if (sync.drafts.length > 5000) sync.drafts = sync.drafts.slice(-5000);
};

const appendSyncEvent = (tdb, normalizedEvent) => {
  const nowAt = nowIso();
  const nextDb = ensureSyncState(tdb);
  const sync = nextDb.sync;

  if (sync.eventIds && sync.eventIds[normalizedEvent.event_id]) {
    return { ok: true, duplicate: true, cursor: Number(sync.eventIds[normalizedEvent.event_id]) || null };
  }

  const nextCursor = Number(sync.cursor || 0) + 1;
  sync.cursor = nextCursor;

  const stored = {
    ...normalizedEvent,
    observed_at_server: nowAt,
    cursor: nextCursor,
  };

  sync.events.push(stored);
  sync.eventIds[normalizedEvent.event_id] = nextCursor;

  const actorStaffId =
    typeof stored.payload?.created_by_staff_id === 'string'
      ? stored.payload.created_by_staff_id
      : typeof stored.payload?.accepted_by_staff_id === 'string'
        ? stored.payload.accepted_by_staff_id
        : '';
  sync.audit.push({
    at: nowAt,
    event_id: stored.event_id,
    event_type: stored.event_type,
    tenant_id: stored.tenant_id,
    branch_id: stored.branch_id,
    client_type: stored.client_type,
    device_id: stored.device_id,
    aggregate_type: stored.aggregate_type,
    aggregate_id: stored.aggregate_id,
    actor_staff_id: actorStaffId,
    actor_name: resolveStaffName(nextDb, actorStaffId),
  });
  if (sync.audit.length > 20000) sync.audit = sync.audit.slice(-20000);

  // Minimal projection for Option A draft inbox.
  if (
    stored.event_type.startsWith('order.draft_') ||
    stored.event_type === 'order.accepted' ||
    stored.event_type === 'order.rejected'
  ) {
    upsertDraftProjection(nextDb, stored, nowAt);
  }

  // Keep file size bounded.
  if (sync.events.length > 20000) {
    sync.events = sync.events.slice(-20000);
    const rebuilt = {};
    for (const ev of sync.events) {
      if (ev && typeof ev.event_id === 'string' && ev.event_id) rebuilt[ev.event_id] = Number(ev.cursor) || 0;
    }
    sync.eventIds = rebuilt;
  }

  return { ok: true, duplicate: false, cursor: nextCursor };
};

const appendServerSyncEvent = (tdb, args) => {
  const nextDb = ensureSyncState(tdb);
  const sync = nextDb.sync;
  const eventId = typeof args?.event_id === 'string' ? args.event_id.trim() : '';
  if (!eventId) return { ok: false };
  if (sync.eventIds && sync.eventIds[eventId]) return { ok: true, duplicate: true, cursor: Number(sync.eventIds[eventId]) || null };

  const nowAt = nowIso();
  const nextCursor = Number(sync.cursor || 0) + 1;
  sync.cursor = nextCursor;

  const stored = {
    event_id: eventId,
    tenant_id: String(args.tenant_id || ''),
    branch_id: String(args.branch_id || ''),
    device_id: String(args.device_id || 'server'),
    client_type: 'server',
    aggregate_type: String(args.aggregate_type || ''),
    aggregate_id: String(args.aggregate_id || ''),
    event_type: String(args.event_type || ''),
    created_at_local: String(args.created_at_local || ''),
    payload: args.payload && typeof args.payload === 'object' ? args.payload : {},
    observed_at_server: nowAt,
    cursor: nextCursor,
  };

  if (!stored.tenant_id || !stored.branch_id || !stored.aggregate_type || !stored.aggregate_id || !stored.event_type) return { ok: false };

  sync.events.push(stored);
  sync.eventIds[eventId] = nextCursor;

  const actorStaffId = typeof stored.payload?.by_staff_id === 'string' ? stored.payload.by_staff_id : '';
  sync.audit.push({
    at: nowAt,
    event_id: stored.event_id,
    event_type: stored.event_type,
    tenant_id: stored.tenant_id,
    branch_id: stored.branch_id,
    client_type: stored.client_type,
    device_id: stored.device_id,
    aggregate_type: stored.aggregate_type,
    aggregate_id: stored.aggregate_id,
    actor_staff_id: actorStaffId,
    actor_name: resolveStaffName(nextDb, actorStaffId),
  });
  if (sync.audit.length > 20000) sync.audit = sync.audit.slice(-20000);

  if (
    stored.event_type.startsWith('order.draft_') ||
    stored.event_type === 'order.accepted' ||
    stored.event_type === 'order.rejected'
  ) {
    upsertDraftProjection(nextDb, stored, nowAt);
  }

  if (sync.events.length > 20000) {
    sync.events = sync.events.slice(-20000);
    const rebuilt = {};
    for (const ev of sync.events) {
      if (ev && typeof ev.event_id === 'string' && ev.event_id) rebuilt[ev.event_id] = Number(ev.cursor) || 0;
    }
    sync.eventIds = rebuilt;
  }

  return { ok: true, duplicate: false, cursor: nextCursor };
};

const isDemoModeEnabled = (db) => Boolean(db && db.demoMode === true);
const isDemoMode = (db, ctx) => Boolean(ctx && ctx.role === 'Super Admin' && isDemoModeEnabled(db));

const seedDemoBranchesIfEmpty = (db) => {
  const next = { ...db, branches: db.branches && typeof db.branches === 'object' ? { ...db.branches } : {} };
  if (Object.keys(next.branches).length > 0) return next;
  const mk = (name, city) => {
    const id = uid();
    next.branches[id] = {
      id,
      name,
      managerName: '',
      city,
      region: city,
      address: '',
      phone: '',
      staffCount: 0,
      status: 'Open',
      rating: 4.6,
      createdAt: nowIso(),
    };
  };
  mk('Main Branch', 'City Center');
  mk('Mall Branch', 'Mall');
  return next;
};

const seedDemoStaffIfEmpty = (db) => {
  const next = { ...db };
  next.staff = Array.isArray(next.staff) ? [...next.staff] : [];
  next.roles = Array.isArray(next.roles) ? [...next.roles] : [];
  next.events = Array.isArray(next.events) ? [...next.events] : [];
  next.branches = next.branches && typeof next.branches === 'object' ? next.branches : {};

  const ensureRole = (id, name, scope) => {
    const idx = next.roles.findIndex((r) => r && String(r.id || '') === id);
    if (idx >= 0) {
      const cur = next.roles[idx];
      next.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
      return;
    }
    next.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
  };

  // Always ensure these roles exist (older db.json may have partial roles)
  ensureRole('role_waiter', 'Waiter', 'branch');
  ensureRole('role_manager', 'Branch Manager', 'branch');
  ensureRole('role_owner', 'Cafe Owner', 'global');
  ensureRole('role_super', 'Super Admin', 'global');

  const ensureDemoAccount = (args) => {
    const email = normalizeEmail(args.email);
    if (!email) return;
    const idx = next.staff.findIndex((s) => normalizeEmail(s?.email) === email);
    if (idx >= 0) {
      const cur = next.staff[idx];
      next.staff[idx] = {
        ...cur,
        email: args.email,
        name: typeof cur.name === 'string' && cur.name ? cur.name : args.name,
        roleId: typeof cur.roleId === 'string' && cur.roleId ? cur.roleId : args.roleId,
        branchId: typeof cur.branchId === 'string' ? cur.branchId : args.branchId,
        password: typeof cur.password === 'string' && cur.password ? cur.password : args.password,
      };
      return;
    }
    next.staff.push({
      id: staffId(),
      code: '',
      name: args.name,
      email: args.email,
      password: args.password,
      phone: '',
      roleId: args.roleId,
      branchId: args.branchId,
      status: 'Active',
      lastLoginAt: '',
      createdAt: nowIso(),
    });
  };

  // Demo accounts (used by the Login screen demo picker)
  const branchIds = Object.keys(next.branches);
  const pick = (i) => branchIds[i % Math.max(1, branchIds.length)] || '';
  ensureDemoAccount({ name: 'Super Admin', email: 'admin@mirachpos.com', password: 'admin123', roleId: 'role_super', branchId: '' });
  ensureDemoAccount({ name: 'Owner', email: 'owner@mirachpos.com', password: 'admin123', roleId: 'role_owner', branchId: '' });
  ensureDemoAccount({ name: 'Manager One', email: 'manager@cafe.com', password: 'admin123', roleId: 'role_manager', branchId: pick(0) });
  ensureDemoAccount({ name: 'Waiter One', email: 'waiter@cafe.com', password: 'admin123', roleId: 'role_waiter', branchId: pick(0) });
  ensureDemoAccount({ name: 'Manager Two', email: 'manager2@cafe.com', password: 'admin123', roleId: 'role_manager', branchId: pick(1) });
  ensureDemoAccount({ name: 'Waiter Two', email: 'waiter2@cafe.com', password: 'admin123', roleId: 'role_waiter', branchId: pick(1) });

  // If staff already exists, we still return after ensuring demo accounts + roles
  if (next.staff.length > 0) return next;

  const mk = (name, roleId, branchId) => ({
    id: staffId(),
    code: '',
    name,
    email: '',
    password: 'admin123',
    phone: '',
    roleId,
    branchId,
    status: 'Active',
    lastLoginAt: '',
    createdAt: nowIso(),
  });

  const owner = mk('Owner', 'role_owner', '');
  owner.email = 'owner@mirachpos.com';
  owner.password = 'admin123';
  next.staff.push(owner);

  const sa = mk('Super Admin', 'role_super', '');
  sa.email = 'admin@mirachpos.com';
  sa.password = 'admin123';
  next.staff.push(sa);

  const m1 = mk('Manager One', 'role_manager', pick(0));
  m1.email = 'manager@cafe.com';
  m1.password = 'admin123';
  next.staff.push(m1);

  const w1 = mk('Waiter One', 'role_waiter', pick(0));
  w1.email = 'waiter@cafe.com';
  w1.password = 'admin123';
  next.staff.push(w1);

  const m2 = mk('Manager Two', 'role_manager', pick(1));
  m2.email = 'manager2@cafe.com';
  m2.password = 'admin123';
  next.staff.push(m2);

  const w2 = mk('Waiter Two', 'role_waiter', pick(1));
  w2.email = 'waiter2@cafe.com';
  w2.password = 'admin123';
  next.staff.push(w2);
  return next;
};

const seedDemoExpensesIfEmpty = (db) => {
  const next = { ...db };
  next.expenses = Array.isArray(next.expenses) ? next.expenses : [];
  return next;
};

const seedDemoProductsIfEmpty = (db) => {
  const next = { ...db };
  next.products = Array.isArray(next.products) ? next.products : [];
  if (next.products.length > 0) return next;
  next.products.push({ id: 'prd_espresso', code: 'ESP', name: 'Espresso', category: 'Coffee', price: 120, cost: 40, status: 'Active', image: '', description: '', createdAt: nowIso(), updatedAt: nowIso() });
  next.products.push({ id: 'prd_latte', code: 'LAT', name: 'Latte', category: 'Coffee', price: 160, cost: 55, status: 'Active', image: '', description: '', createdAt: nowIso(), updatedAt: nowIso() });
  return next;
};

const defaultOwnerSettings = () => ({ currency: 'USD', timezone: 'UTC', receiptFooter: '' });
const normalizeOwnerSettings = (body, prev) => {
  const next = { ...(prev || defaultOwnerSettings()) };
  if (body && typeof body === 'object') {
    if (typeof body.currency === 'string') next.currency = body.currency;
    if (typeof body.timezone === 'string') next.timezone = body.timezone;
    if (typeof body.receiptFooter === 'string') next.receiptFooter = body.receiptFooter;
  }
  return next;
};

const defaultPlatformSettings = () => ({
  platformName: 'MirachPos Enterprise',
  supportEmail: 'support@mirachpos.com',
  defaultTimezone: 'UTC (Coordinated Universal Time)',
  defaultCurrency: 'USD ($)',
  termsUrl: 'https://mirachpos.com/terms',
  branding: {
    logoUrl: '',
    primaryColor: '#eead2b',
    accentColor: '#c9b792',
  },
  limits: {
    maxTenantsPerInstance: 100,
    storageQuotaGbPerTenant: 50,
    apiRateLimitPerMin: 1000,
  },
  security: {
    sessionTtlMinutes: 7 * 24 * 60,
    requireMfaForSuperAdmin: false,
    allowDemoSeed: true,
  },
  maintenance: {
    enabled: false,
    message: 'Scheduled maintenance in progress. Please try again shortly.',
  },
});

const normalizePlatformSettings = (v) => {
  const d = defaultPlatformSettings();
  const x = v && typeof v === 'object' ? v : {};
  const branding = x.branding && typeof x.branding === 'object' ? x.branding : {};
  const limits = x.limits && typeof x.limits === 'object' ? x.limits : {};
  const security = x.security && typeof x.security === 'object' ? x.security : {};
  const maintenance = x.maintenance && typeof x.maintenance === 'object' ? x.maintenance : {};

  const toNum = (n, fallback) => {
    const v0 = Number(n);
    return Number.isFinite(v0) ? v0 : fallback;
  };

  return {
    platformName: typeof x.platformName === 'string' && x.platformName.trim() ? x.platformName.trim() : d.platformName,
    supportEmail: typeof x.supportEmail === 'string' && x.supportEmail.trim() ? x.supportEmail.trim() : d.supportEmail,
    defaultTimezone: typeof x.defaultTimezone === 'string' && x.defaultTimezone.trim() ? x.defaultTimezone.trim() : d.defaultTimezone,
    defaultCurrency: typeof x.defaultCurrency === 'string' && x.defaultCurrency.trim() ? x.defaultCurrency.trim() : d.defaultCurrency,
    termsUrl: typeof x.termsUrl === 'string' && x.termsUrl.trim() ? x.termsUrl.trim() : d.termsUrl,
    branding: {
      logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl.trim() : d.branding.logoUrl,
      primaryColor: typeof branding.primaryColor === 'string' && branding.primaryColor.trim() ? branding.primaryColor.trim() : d.branding.primaryColor,
      accentColor: typeof branding.accentColor === 'string' && branding.accentColor.trim() ? branding.accentColor.trim() : d.branding.accentColor,
    },
    limits: {
      maxTenantsPerInstance: Math.max(1, Math.round(toNum(limits.maxTenantsPerInstance, d.limits.maxTenantsPerInstance))),
      storageQuotaGbPerTenant: Math.max(1, Math.round(toNum(limits.storageQuotaGbPerTenant, d.limits.storageQuotaGbPerTenant))),
      apiRateLimitPerMin: Math.max(10, Math.round(toNum(limits.apiRateLimitPerMin, d.limits.apiRateLimitPerMin))),
    },
    security: {
      sessionTtlMinutes: Math.max(15, Math.round(toNum(security.sessionTtlMinutes, d.security.sessionTtlMinutes))),
      requireMfaForSuperAdmin: Boolean(security.requireMfaForSuperAdmin),
      allowDemoSeed: typeof security.allowDemoSeed === 'boolean' ? security.allowDemoSeed : d.security.allowDemoSeed,
    },
    maintenance: {
      enabled: Boolean(maintenance.enabled),
      message: typeof maintenance.message === 'string' && maintenance.message.trim() ? maintenance.message.trim() : d.maintenance.message,
    },
  };
};

const platformSessionExpiresAt = (db, nowMs) => {
  const p = normalizePlatformSettings(db?.platformSettings);
  const mins = Number(p?.security?.sessionTtlMinutes || 0);
  const ttlMs = Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(nowMs + ttlMs).toISOString();
};

const calcOwnerStaff = (db, args) => {
  const q = String(args?.q || '').trim().toLowerCase();
  const roleId = String(args?.roleId || '').trim();
  const status = String(args?.status || '').trim();
  const branchId = String(args?.branchId || '').trim();
  const page = Math.max(1, Number(args?.page || 1));
  const pageSize = Math.min(50, Math.max(5, Number(args?.pageSize || 10)));

  const rawRoles = Array.isArray(db.roles) ? db.roles : [];
  const roles = rawRoles.length
    ? rawRoles
    : [
        { id: 'role_waiter', name: 'Waiter', scope: 'branch', permissions: [] },
        { id: 'role_branch_manager', name: 'Branch Manager', scope: 'branch', permissions: [] },
      ];
  const roleById = new Map(roles.map((r) => [String(r.id || ''), r]));

  const branchesObj = db && db.branches && typeof db.branches === 'object' ? db.branches : {};
  const branches = Object.values(branchesObj)
    .filter((b) => b && typeof b === 'object')
    .map((b) => ({ id: String(b.id || ''), name: String(b.name || ''), status: String(b.status || 'Open') }));

  const staff = Array.isArray(db.staff) ? db.staff : [];
  const filtered = staff
    .filter((s) => (roleId ? String(s.roleId || '') === roleId : true))
    .filter((s) => (status ? String(s.status || '') === status : true))
    .filter((s) => (branchId ? String(s.branchId || '') === branchId : true))
    .filter((s) => {
      if (!q) return true;
      return String(s.name || '').toLowerCase().includes(q) || String(s.email || '').toLowerCase().includes(q) || String(s.code || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map((s) => ({
    id: s.id,
    code: s.code || '',
    name: s.name || '',
    email: s.email || '',
    phone: s.phone || '',
    roleId: s.roleId || '',
    roleName: roleById.get(String(s.roleId || ''))?.name || '',
    branchId: s.branchId || '',
    status: s.status || 'Active',
    lastLoginAt: s.lastLoginAt || '',
    lastLoginLabel: s.lastLoginAt ? String(s.lastLoginAt) : '',
    createdAt: s.createdAt || '',
    roleKind: 'other',
  }));

  const stats = {
    superAdmins: 0,
    managers: staff.filter((s) => String(roleById.get(String(s.roleId || ''))?.name || '').toLowerCase().includes('manager')).length,
    baristasServers: staff.filter((s) => {
      const rn = String(roleById.get(String(s.roleId || ''))?.name || '').toLowerCase();
      return rn.includes('barista') || rn.includes('server') || rn.includes('wait');
    }).length,
    kitchen: staff.filter((s) => String(roleById.get(String(s.roleId || ''))?.name || '').toLowerCase().includes('kitchen')).length,
  };

  return {
    staff: items,
    roles: roles.map((r) => ({ id: String(r.id || ''), name: String(r.name || ''), scope: r.scope === 'global' ? 'global' : 'branch', permissions: Array.isArray(r.permissions) ? r.permissions : [] })),
    branches,
    stats,
    page,
    pageSize,
    total,
    meta: { q: String(args?.q || ''), roleId: String(args?.roleId || ''), status: String(args?.status || ''), branchId: String(args?.branchId || ''), generatedAt: nowIso() },
  };
};

const calcOverview = (db, args) => {
  const branchId = typeof args?.branchId === 'string' ? args.branchId : '';
  const branchesObj = db && db.branches && typeof db.branches === 'object' ? db.branches : {};
  const allBranches = Object.values(branchesObj);
  const scopeBranches = branchId ? allBranches.filter((b) => String(b.id) === String(branchId)) : allBranches;
  const activeBranches = scopeBranches.filter((b) => (b.status || 'Open') === 'Open').length;
  const totalBranches = scopeBranches.length;

  const branches = scopeBranches.map((b, i) => {
    const rating = typeof b.rating === 'number' ? b.rating : 4.6;
    const status = b.status === 'Closed' ? 'Closed' : 'Open';
    return {
      id: String(b.id || ''),
      name: String(b.name || ''),
      manager: String(b.managerName || ''),
      revenueToday: 0,
      ordersToday: 0,
      rating,
      status,
    };
  });

  const totalOrders = 0;
  const totalRevenueMonth = 0;
  const netProfit = 0;

  return {
    kpis: {
      totalRevenueMonth,
      activeBranches,
      totalBranches,
      totalOrders,
      netProfit,
    },
    branches,
    alerts: [],
    health: [
      { label: 'API', value: 'OK', status: 'Good' },
      { label: 'Database', value: 'OK', status: 'Good' },
    ],
  };
};

const calcReports = (db, args) => {
  const branchId = typeof args?.branchId === 'string' ? args.branchId : '';
  const fromIso = typeof args?.from === 'string' ? args.from : '';
  const toIso = typeof args?.to === 'string' ? args.to : '';

  const parseMs = (iso, fallback) => {
    try {
      if (!iso) return fallback;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : fallback;
    } catch {
      return fallback;
    }
  };

  const now = Date.now();
  const defaultFrom = new Date(now - 30 * 24 * 60 * 60 * 1000);
  defaultFrom.setHours(0, 0, 0, 0);
  const defaultTo = new Date(now);
  defaultTo.setHours(23, 59, 59, 999);

  const startMs = parseMs(fromIso, defaultFrom.getTime());
  const endMs = parseMs(toIso, defaultTo.getTime());

  const clampRange = () => {
    const s = Math.min(startMs, endMs);
    const e = Math.max(startMs, endMs);
    return { s, e };
  };
  const { s: rangeStartMs, e: rangeEndMs } = clampRange();

  const orders = Array.isArray(db.orders) ? db.orders : [];
  const inScope = orders
    .filter((o) => o && typeof o === 'object')
    .filter((o) => (branchId ? String(o.branchId || '') === branchId : true))
    .filter((o) => {
      const t = new Date(o.paidAt || o.createdAt || 0).getTime();
      return Number.isFinite(t) ? t >= rangeStartMs && t <= rangeEndMs : false;
    });

  const paid = inScope.filter((o) => String(o.status || '') === 'Paid');
  const txCount = paid.length;
  const netSales = paid.reduce((sum, o) => sum + (Number(o.total || 0) || 0), 0);
  const tax = paid.reduce((sum, o) => sum + (Number(o.tax || 0) || 0), 0);
  const tips = paid.reduce((sum, o) => sum + (Number(o.tip || 0) || 0), 0);
  const discounts = paid.reduce((sum, o) => sum + (Number(o.discount || 0) || 0), 0);
  const totalCollected = netSales + tax + tips - Math.abs(discounts);

  const dayKey = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };

  const ledgerMap = new Map();
  for (const o of paid) {
    const t = new Date(o.paidAt || o.createdAt || 0).getTime();
    const k = dayKey(t);
    const cur = ledgerMap.get(k) || { date: k, txCount: 0, netSales: 0, tax: 0, tips: 0, discounts: 0, totalCollected: 0 };
    cur.txCount += 1;
    cur.netSales += Number(o.total || 0) || 0;
    cur.tax += Number(o.tax || 0) || 0;
    cur.tips += Number(o.tip || 0) || 0;
    cur.discounts += Number(o.discount || 0) || 0;
    cur.totalCollected = cur.netSales + cur.tax + cur.tips - Math.abs(cur.discounts);
    ledgerMap.set(k, cur);
  }
  const ledger = Array.from(ledgerMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const branches = db.branches && typeof db.branches === 'object' ? db.branches : {};
  const branchBreakdown = !branchId
    ? Object.keys(branches).map((bid) => {
        const b = branches[bid] || {};
        const scoped = paid.filter((o) => String(o.branchId || '') === bid);
        const bTx = scoped.length;
        const bNet = scoped.reduce((sum, o) => sum + (Number(o.total || 0) || 0), 0);
        const bTax = scoped.reduce((sum, o) => sum + (Number(o.tax || 0) || 0), 0);
        const bTips = scoped.reduce((sum, o) => sum + (Number(o.tip || 0) || 0), 0);
        const bDisc = scoped.reduce((sum, o) => sum + (Number(o.discount || 0) || 0), 0);
        return {
          branchId: bid,
          name: String(b.name || bid),
          status: String(b.status || ''),
          txCount: bTx,
          netSales: bNet,
          tax: bTax,
          tips: bTips,
          discounts: bDisc,
          totalCollected: bNet + bTax + bTips - Math.abs(bDisc),
        };
      })
    : undefined;

  // Shift activity
  const staff = Array.isArray(db.staff) ? db.staff : [];
  const roles = Array.isArray(db.roles) ? db.roles : [];
  const roleById = new Map(roles.map((r) => [String(r.id || ''), r]));
  const staffById = new Map(
    staff
      .filter((s) => s && typeof s === 'object')
      .filter((s) => (branchId ? String(s.branchId || '') === branchId : true))
      .map((s) => [String(s.id || ''), s]),
  );

  const shiftLogs = Array.isArray(db.shiftLogs) ? db.shiftLogs : [];
  const shiftInRange = shiftLogs
    .filter((l) => l && typeof l === 'object')
    .filter((l) => staffById.has(String(l.staffId || '')))
    .filter((l) => {
      const inAt = new Date(l.clockInAt || 0).getTime();
      if (!Number.isFinite(inAt)) return false;
      // include shifts that start within range
      return inAt >= rangeStartMs && inAt <= rangeEndMs;
    });

  const hoursBetween = (inIso, outIso) => {
    try {
      const a = new Date(inIso || 0).getTime();
      const b = new Date(outIso || 0).getTime();
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
      return (b - a) / (1000 * 60 * 60);
    } catch {
      return 0;
    }
  };

  const staffAgg = new Map();
  let openShifts = 0;
  for (const l of shiftInRange) {
    const sid = String(l.staffId || '');
    const outAt = l.clockOutAt ? String(l.clockOutAt) : '';
    if (!outAt) openShifts += 1;
    const hrs = outAt ? hoursBetween(String(l.clockInAt || ''), outAt) : 0;
    const cur = staffAgg.get(sid) || { hours: 0, shifts: 0, open: 0 };
    cur.shifts += 1;
    cur.hours += hrs;
    if (!outAt) cur.open += 1;
    staffAgg.set(sid, cur);
  }

  const staffActivity = Array.from(staffAgg.entries())
    .map(([sid, a]) => {
      const srec = staffById.get(sid) || {};
      const rn = roleById.get(String(srec.roleId || ''))?.name || '';
      return {
        staffId: sid,
        name: String(srec.name || sid),
        roleName: String(rn || ''),
        hours: Math.round((Number(a.hours || 0) || 0) * 100) / 100,
        shifts: Number(a.shifts || 0) || 0,
        openShifts: Number(a.open || 0) || 0,
      };
    })
    .sort((a, b) => (b.hours - a.hours) || String(a.name).localeCompare(String(b.name)));

  const totalHours = staffActivity.reduce((sum, r) => sum + (Number(r.hours || 0) || 0), 0);

  const trend = ledger.map((x) => ({ ym: x.date.slice(0, 7), name: x.date, revenue: x.netSales, expenses: 0 }));
  const categories = [];

  return {
    ok: true,
    branchId,
    from: fromIso,
    to: toIso,
    kpis: { totalRevenueNet: netSales, cogs: 0, laborCost: 0 },
    trend,
    categories,
    branchBreakdown,
    ledger,
    totals: { txCount, netSales, tax, tips, discounts, totalCollected },
    shift: {
      branchId,
      from: new Date(rangeStartMs).toISOString(),
      to: new Date(rangeEndMs).toISOString(),
      totalHours: Math.round(totalHours * 100) / 100,
      openShifts,
      shifts: shiftInRange.length,
      staff: staffActivity,
    },
  };
};
const calcOwnerInventory = (db, args) => ({ ok: true, branchId: args?.branchId || '', category: args?.category || '', q: args?.q || '', items: [] });
const calcOwnerMenuProducts = (db, args) => ({ ok: true, q: args?.q || '', category: args?.category || '', status: args?.status || '', page: Number(args?.page || 1), pageSize: Number(args?.pageSize || 10), total: 0, products: [] });
const calcOwnerMenuKpis = (db, args) => ({ ok: true, q: args?.q || '', category: args?.category || '', status: args?.status || '', kpis: { total: 0, active: 0, inactive: 0 } });
const calcOwnerFinance = (db, args) => ({ ok: true, ...args, rows: [], total: 0 });

const seedDemoInventoryIfEmpty = (db) => {
  const hasAnyBranches = db && db.branches && Object.keys(db.branches).length > 0;
  if (!hasAnyBranches) return db;
  const hasSnapshots = Array.isArray(db.events) && db.events.some((e) => e.type === 'inventory_snapshot');
  if (hasSnapshots) return db;

  const sample = [
    { sku: 'RM-COF-001', name: 'Arabica Beans (1kg)', category: 'Coffee', unit: 'kg', minQty: 40, cost: 1850 },
    { sku: 'RM-MLK-ALT', name: 'Almond Milk (1L)', category: 'Dairy/Alt', unit: 'L', minQty: 25, cost: 280 },
    { sku: 'RM-CUP-12', name: 'Paper Cups (12oz)', category: 'Packaging', unit: 'pcs', minQty: 200, cost: 7.5 },
    { sku: 'RM-SUG-001', name: 'Sugar (1kg)', category: 'Ingredients', unit: 'kg', minQty: 60, cost: 120 },
    { sku: 'RM-CHO-001', name: 'Chocolate Syrup (1L)', category: 'Ingredients', unit: 'L', minQty: 18, cost: 420 },
    { sku: 'RM-PASTRY', name: 'Butter Croissant (Frozen)', category: 'Pastry', unit: 'pcs', minQty: 90, cost: 32 },
  ];

  const branchIds = Object.keys(db.branches);
  const next = { ...db, events: Array.isArray(db.events) ? [...db.events] : [] };
  for (const bid of branchIds) {
    const items = sample.map((it) => {
      const base = Math.max(0, Math.round((Math.random() * 1.2 + 0.4) * it.minQty));
      const qty = it.sku === 'RM-MLK-ALT' ? Math.max(0, Math.round((Math.random() * 1.0) * it.minQty)) : base;
      return { ...it, qty };
    });
    next.events.push({
      id: `evt_inv_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
      branchId: bid,
      type: 'inventory_snapshot',
      payload: { items },
      at: nowIso(),
    });
  }
  return next;
};

const seedDemoShiftLogsIfEmpty = (db) => {
  const hasBranches = db && db.branches && Object.keys(db.branches).length > 0;
  if (!hasBranches) return db;

  const next = { ...db };
  next.shiftLogs = Array.isArray(next.shiftLogs) ? next.shiftLogs : [];
  if (next.shiftLogs.length > 0) return next;

  const staff = Array.isArray(next.staff) ? next.staff : [];
  const now = Date.now();
  const mk = (s, i) => {
    const inAt = new Date(now - (i + 2) * 60 * 60 * 1000).toISOString();
    const outAt = i % 3 === 0 ? undefined : new Date(now - i * 60 * 60 * 1000).toISOString();
    return { id: `shift_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}_${i}`, staffId: s.id, clockInAt: inAt, clockOutAt: outAt };
  };

  next.shiftLogs = staff.slice(0, 12).map((s, i) => mk(s, i));
  return next;
};

const seedDemoCashSessionsIfEmpty = (db) => {
  const hasBranches = db && db.branches && Object.keys(db.branches).length > 0;
  if (!hasBranches) return db;

  const next = { ...db };
  next.cashSessions = Array.isArray(next.cashSessions) ? next.cashSessions : [];
  if (next.cashSessions.length > 0) return next;

  const staff = Array.isArray(next.staff) ? next.staff : [];
  const roles = Array.isArray(next.roles) ? next.roles : [];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const now = Date.now();
  const mk = (i, s) => {
    const openedAt = new Date(now - (i + 1) * 3 * 60 * 60 * 1000).toISOString();
    const closedAt = i % 2 === 0 ? new Date(now - i * 60 * 60 * 1000).toISOString() : undefined;
    const expectedCash = 800 + i * 120;
    const actualCash = closedAt ? expectedCash + (i % 3 === 0 ? 25 : -10) : undefined;
    const roleName = roleById.get(s.roleId)?.name || 'Staff';
    return {
      id: `cs_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}_${i}`,
      register: `POS-0${(i % 3) + 1}`,
      staffName: s.name || 'Unknown',
      staffRole: roleName,
      openingCash: 200,
      expectedCash,
      actualCash,
      status: closedAt ? 'Closed' : 'Active',
      openedAt,
      closedAt,
    };
  };

  const branchIds = Object.keys(next.branches || {});
  const pickBranch = (i) => branchIds[i % Math.max(1, branchIds.length)] || branchIds[0] || 'global';

  next.cashSessions = staff.slice(0, 8).map((s, i) => ({
    ...mk(i, s),
    branchId: String(s.branchId || pickBranch(i)),
  }));
  return next;
};

const startOfDayIso = () => {
  try {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  } catch {
    return nowIso();
  }
};

const startOfMonthIso = () => {
  try {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  } catch {
    return nowIso();
  }
};

const tenantIncidents = (db, tenantId) => {
  const isGlobal = String(tenantId || '') === 'tenant_global';
  if (!isGlobal) return [];
  const events = Array.isArray(db.events) ? db.events : [];
  const latest = [...events]
    .reverse()
    .filter((e) => e && typeof e === 'object')
    .slice(0, 8)
    .map((e) => ({
      id: String(e.id || ''),
      at: String(e.at || ''),
      type: String(e.type || ''),
      branchId: String(e.branchId || ''),
      message: String(e.type || ''),
    }));
  return latest;
};

const calcTenantMetrics = (db, tenantId) => {
  const isGlobal = String(tenantId || '') === 'tenant_global';
  if (!isGlobal) {
    return {
      staffAccounts: 0,
      posTerminals: 0,
      activeOrders: 0,
      ordersToday: 0,
      apiCallsToday: 0,
      revenueToday: 0,
      revenueMonth: 0,
      limits: { staffAccounts: 0, posTerminals: 0 },
    };
  }

  const tenants = Array.isArray(db.tenants) ? db.tenants : [];
  const t = tenants.find((x) => x && String(x.id || '') === String(tenantId || ''));
  const tier = String(t?.subscription?.tier || 'Enterprise');
  const limits = (() => {
    if (tier === 'Trial') return { staffAccounts: 5, posTerminals: 1 };
    if (tier === 'Basic') return { staffAccounts: 20, posTerminals: 3 };
    if (tier === 'Pro') return { staffAccounts: 60, posTerminals: 10 };
    return { staffAccounts: 999, posTerminals: 999 };
  })();

  const staffAccounts = Array.isArray(db.staff) ? db.staff.length : 0;
  const branchesObj = db && db.branches && typeof db.branches === 'object' ? db.branches : {};
  const posTerminals = Object.keys(branchesObj).length;

  const today0 = startOfDayIso();
  const today0Ms = new Date(today0).getTime();
  const events = Array.isArray(db.events) ? db.events : [];
  const apiCallsToday = events.filter((e) => {
    if (!e || typeof e !== 'object') return false;
    const at = typeof e.at === 'string' ? e.at : '';
    const ms = at ? new Date(at).getTime() : 0;
    return Number.isFinite(ms) && ms >= today0Ms;
  }).length;

  const orders = Array.isArray(db.orders) ? db.orders : [];
  const ordersToday = orders.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    const at = String(o.createdAt || o.at || '');
    const ms = at ? new Date(at).getTime() : 0;
    return Number.isFinite(ms) && ms >= today0Ms;
  }).length;

  const activeOrders = orders.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    const s = String(o.status || '').toLowerCase();
    return s === 'open' || s === 'active' || s === 'pending';
  }).length;

  return {
    staffAccounts,
    posTerminals,
    activeOrders,
    ordersToday,
    apiCallsToday,
    revenueToday: 0,
    revenueMonth: 0,
    limits,
  };
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = (req.method || 'GET').toUpperCase();

    if (await proxyToRemote(req, res, url)) return;

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (url.pathname === '/healthz') return json(res, 200, { ok: true });

    // Maintenance mode: block tenant APIs (still allow login + superadmin + health)
    if (url.pathname.startsWith('/api/')) {
      const db0 = loadDb();
      const ps = normalizePlatformSettings(db0.platformSettings);
      if (ps?.maintenance?.enabled) {
        const allow =
          url.pathname === '/api/auth/login' ||
          url.pathname === '/api/public/signup' ||
          url.pathname === '/api/public/platform-settings' ||
          url.pathname.startsWith('/api/sync/') ||
          url.pathname.startsWith('/api/superadmin/') ||
          url.pathname === '/api/auth/me' ||
          url.pathname === '/api/superadmin/platform-settings';

        if (!allow) {
          return json(res, 503, { error: 'maintenance', message: String(ps.maintenance.message || 'Maintenance') });
        }
      }
    }

    if (url.pathname === '/api/public/signup' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : '';
      const cafeName = typeof body.cafeName === 'string' ? body.cafeName.trim() : '';
      const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim() : '';
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';

      if (!workspace) return json(res, 400, { error: 'workspace_required' });
      if (!slugLooksOk(workspace)) return json(res, 400, { error: 'invalid_workspace' });
      if (!cafeName) return json(res, 400, { error: 'cafeName_required' });
      if (!ownerName) return json(res, 400, { error: 'ownerName_required' });
      if (!email) return json(res, 400, { error: 'email_required' });
      if (!emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
      if (!password || password.length < 6) return json(res, 400, { error: 'password_too_short' });

      let db = loadDb();
      db = normalizeTenants(db);
      db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      const slug = normalizeTenantSlug(workspace);
      const taken = (db.tenants || []).some((t) => t && String(t.slug || '').toLowerCase() === slug);
      if (taken) return json(res, 409, { error: 'workspace_taken' });

      const tenantId = `tenant_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const now = Date.now();
      const trialStartAt = new Date(now).toISOString();
      const trialEndsAt = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();

      const tenant = {
        id: tenantId,
        name: cafeName,
        slug,
        domain: `${slug}.${BASE_DOMAIN}`,
        status: 'Active',
        subscription: {
          tier: 'Trial',
          trialStartAt,
          trialEndsAt,
        },
        features: ['loyalty', 'public_api'],
        onboarding: {
          stage: 'incoming',
          completedAt: '',
        },
        billing: {
          cycle: 'Monthly',
          method: 'Cash',
          status: 'Active',
          nextBillAt: trialEndsAt,
          amountEtb: 0,
          graceEndsAt: '',
        },
        profile: {
          contactEmail: email,
          contactPhone: '',
          address1: '',
          city: '',
          country: '',
          timezone: 'Africa/Addis_Ababa',
          currency: 'ETB',
          customDomain: '',
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      db.tenants = Array.isArray(db.tenants) ? db.tenants : [];
      db.tenants.push(tenant);

      let tdb = loadTenantDb(tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.sessions = Array.isArray(tdb.sessions) ? tdb.sessions : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const ensureRole = (id, name, scope) => {
        const idx = tdb.roles.findIndex((r) => r && String(r.id || '') === id);
        if (idx >= 0) {
          const cur = tdb.roles[idx];
          tdb.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
          return;
        }
        tdb.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
      };
      ensureRole('role_waiter', 'Waiter', 'branch');
      ensureRole('role_manager', 'Branch Manager', 'branch');
      ensureRole('role_owner', 'Cafe Owner', 'global');

      const defaultBranchId = uid();
      tdb.branches[defaultBranchId] = {
        id: defaultBranchId,
        name: 'Main Branch',
        managerName: '',
        city: '',
        region: '',
        address: '',
        phone: '',
        staffCount: 0,
        status: 'Open',
        rating: 5,
        createdAt: nowIso(),
      };

      const ownerId = staffId();
      tdb.staff.push({
        id: ownerId,
        code: '',
        name: ownerName,
        email,
        password,
        phone: '',
        roleId: 'role_owner',
        branchId: '',
        status: 'Active',
        lastLoginAt: '',
        createdAt: nowIso(),
      });

      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: defaultBranchId,
        type: 'tenant_signup',
        payload: { tenantId, email },
        at: nowIso(),
      });

      saveTenantDb(tenantId, tdb);

      const token = randToken();
      const expiresAt = platformSessionExpiresAt(db, now);
      db.sessions.push({ token, role: 'Cafe Owner', branchId: 'global', staffId: ownerId, tenantId, createdAt: nowIso(), expiresAt });
      if (db.sessions.length > 2000) db.sessions = db.sessions.slice(-2000);

      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_created',
        payload: { tenantId, slug, email },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);

      saveDb(db);
      return json(res, 201, {
        ok: true,
        token,
        role: 'Cafe Owner',
        branchId: 'global',
        staffId: ownerId,
        tenantId,
        tenant: { id: tenantId, name: tenant.name, slug: tenant.slug, domain: tenant.domain },
        expiresAt,
        subscription: getTenantSubscription(db, tenantId),
      });
    }

    if (url.pathname === '/api/public/platform-settings' && method === 'GET') {
      const db = loadDb();
      const ps = normalizePlatformSettings(db.platformSettings);
      return json(res, 200, {
        ok: true,
        settings: {
          platformName: ps.platformName,
          branding: ps.branding,
          maintenance: { enabled: ps.maintenance?.enabled, message: ps.maintenance?.message },
        },
      });
    }

    if (url.pathname === '/api/public/accept-invite' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!code) return json(res, 400, { error: 'invite_code_required' });
      if (!name) return json(res, 400, { error: 'name_required' });
      if (!email) return json(res, 400, { error: 'email_required' });
      if (!emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
      if (!password || password.length < 6) return json(res, 400, { error: 'password_too_short' });

      let db = loadDb();
      db = normalizeTenants(db);
      db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
      db.events = Array.isArray(db.events) ? db.events : [];
      db.invites = Array.isArray(db.invites) ? db.invites : [];

      const invIdx = db.invites.findIndex((x) => x && String(x.code || '').toLowerCase() === code.toLowerCase());
      if (invIdx < 0) return json(res, 404, { error: 'invite_not_found' });
      const inv = db.invites[invIdx];
      if (inv.usedAt) return json(res, 409, { error: 'invite_already_used' });
      const expiresAt = String(inv.expiresAt || '');
      if (expiresAt) {
        const exp = new Date(expiresAt);
        if (!Number.isNaN(exp.getTime()) && Date.now() > exp.getTime()) return json(res, 410, { error: 'invite_expired' });
      }

      const tenantId = String(inv.tenantId || '');
      if (!tenantId) return json(res, 400, { error: 'invite_invalid_tenant' });
      const t = (db.tenants || []).find((x) => x && String(x.id || '') === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const roleName = String(inv.roleName || '');
      const allowed = new Set(['Branch Manager', 'Waiter']);
      if (!allowed.has(roleName)) return json(res, 400, { error: 'invite_invalid_role' });

      let tdb = loadTenantDb(tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.sessions = Array.isArray(tdb.sessions) ? tdb.sessions : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const ensureRole = (id, name, scope) => {
        const idx = tdb.roles.findIndex((r) => r && String(r.id || '') === id);
        if (idx >= 0) {
          const cur = tdb.roles[idx];
          tdb.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
          return;
        }
        tdb.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
      };
      ensureRole('role_waiter', 'Waiter', 'branch');
      ensureRole('role_manager', 'Branch Manager', 'branch');
      ensureRole('role_owner', 'Cafe Owner', 'global');

      if (tdb.staff.some((s) => normalizeEmail(s?.email) === email)) return json(res, 409, { error: 'email_in_use' });

      const roleId = roleName === 'Branch Manager' ? 'role_manager' : 'role_waiter';
      const inviteBranchId = String(inv.branchId || '');
      const anyBranchId = Object.keys(tdb.branches || {})[0] || '';
      const branchId = inviteBranchId && tdb.branches?.[inviteBranchId] ? inviteBranchId : anyBranchId;
      if (!branchId) return json(res, 400, { error: 'tenant_missing_branch' });

      const staffIdValue = staffId();
      tdb.staff.push({
        id: staffIdValue,
        code: '',
        name,
        email,
        password,
        phone: '',
        roleId,
        branchId,
        status: 'Active',
        lastLoginAt: '',
        createdAt: nowIso(),
      });
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'staff_invite_accepted',
        payload: { tenantId, staffId: staffIdValue, email, roleId, inviteId: String(inv.id || '') },
        at: nowIso(),
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(tenantId, tdb);

      const token = randToken();
      const now = Date.now();
      const sessionExpiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.sessions.push({ token, role: roleName, branchId, staffId: staffIdValue, tenantId, createdAt: nowIso(), expiresAt: sessionExpiresAt });
      if (db.sessions.length > 2000) db.sessions = db.sessions.slice(-2000);

      db.invites[invIdx] = { ...inv, usedAt: nowIso(), usedByEmail: email, usedByStaffId: staffIdValue };
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'invite_used',
        payload: { tenantId, inviteId: String(inv.id || ''), email, roleName },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);

      return json(res, 201, {
        ok: true,
        token,
        role: roleName,
        branchId,
        staffId: staffIdValue,
        tenantId,
        tenant: { id: tenantId, name: String(t?.name || ''), slug: String(t?.slug || ''), domain: String(t?.domain || '') },
        expiresAt: sessionExpiresAt,
        subscription: getTenantSubscription(db, tenantId),
      });
    }

    const computeTenantOnboarding = (db, tenantId) => {
      const t = Array.isArray(db?.tenants) ? db.tenants.find((x) => x && x.id === tenantId) : null;
      const profile = (t && t.profile && typeof t.profile === 'object') ? t.profile : {};
      const contactPhone = typeof profile.contactPhone === 'string' ? profile.contactPhone.trim() : '';
      const address1 = typeof profile.address1 === 'string' ? profile.address1.trim() : '';
      const city = typeof profile.city === 'string' ? profile.city.trim() : '';
      const country = typeof profile.country === 'string' ? profile.country.trim() : '';
      const profileComplete = Boolean(contactPhone && address1 && city && country);

      const tdb = loadTenantDb(tenantId);
      const branchCount = Object.keys(tdb?.branches || {}).length;
      const branchesComplete = branchCount > 0;

      const completedAt = (typeof t?.onboarding?.completedAt === 'string') ? t.onboarding.completedAt : '';
      const completed = Boolean(completedAt) || (profileComplete && branchesComplete);

      return {
        completed,
        completedAt: completedAt || '',
        steps: {
          profile: profileComplete,
          branches: branchesComplete,
        },
        counts: {
          branches: branchCount,
        },
      };
    };

    if (url.pathname === '/api/owner/onboarding' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;

      if (ctx.role !== 'Super Admin') {
        const next = computeTenantOnboarding(db, ctx.tenantId);
        const t = Array.isArray(db.tenants) ? db.tenants.find((x) => x && x.id === ctx.tenantId) : null;
        const profile = (t && t.profile && typeof t.profile === 'object') ? t.profile : {};
        return json(res, 200, {
          ok: true,
          tenant: { id: t?.id || ctx.tenantId, name: t?.name || '', status: t?.status || 'Active', profile },
          onboarding: next,
        });
      }

      return json(res, 200, { ok: true, tenant: null, onboarding: { completed: true, completedAt: nowIso(), steps: { profile: true, branches: true }, counts: { branches: 0 } } });
    }

    if (url.pathname === '/api/owner/profile' && method === 'PUT') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((x) => x && x.id === ctx.tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const t = db.tenants[idx];
      const prevProfile = (t.profile && typeof t.profile === 'object') ? t.profile : {};
      const patch = body.profile && typeof body.profile === 'object' ? body.profile : body;

      const nextProfile = {
        ...prevProfile,
        contactPhone: typeof patch.contactPhone === 'string' ? patch.contactPhone.trim() : prevProfile.contactPhone || '',
        address1: typeof patch.address1 === 'string' ? patch.address1.trim() : prevProfile.address1 || '',
        city: typeof patch.city === 'string' ? patch.city.trim() : prevProfile.city || '',
        country: typeof patch.country === 'string' ? patch.country.trim() : prevProfile.country || '',
        timezone: typeof patch.timezone === 'string' && patch.timezone.trim() ? patch.timezone.trim() : (prevProfile.timezone || 'Africa/Addis_Ababa'),
        currency: typeof patch.currency === 'string' && patch.currency.trim() ? patch.currency.trim() : (prevProfile.currency || 'ETB'),
      };

      const nextTenant = { ...t, profile: nextProfile, updatedAt: nowIso() };
      db.tenants[idx] = nextTenant;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_profile_updated',
        payload: { tenantId: ctx.tenantId },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);

      const onboarding = computeTenantOnboarding(db, ctx.tenantId);
      return json(res, 200, { ok: true, tenant: { id: nextTenant.id, name: nextTenant.name, status: nextTenant.status, profile: nextProfile }, onboarding });
    }

    if (url.pathname === '/api/owner/onboarding/complete' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((x) => x && x.id === ctx.tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const onboardingNow = computeTenantOnboarding(db, ctx.tenantId);
      if (!onboardingNow.steps.profile || !onboardingNow.steps.branches) {
        return json(res, 400, { error: 'onboarding_incomplete', onboarding: onboardingNow });
      }

      const t = db.tenants[idx];
      db.tenants[idx] = { ...t, onboarding: { ...(t.onboarding || {}), completedAt: nowIso() }, updatedAt: nowIso() };
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_onboarding_completed',
        payload: { tenantId: ctx.tenantId },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);

      const done = computeTenantOnboarding(db, ctx.tenantId);
      return json(res, 200, { ok: true, onboarding: done });
    }

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : '';
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      const role = typeof body.role === 'string' ? body.role.trim() : '';
      const staffCode = typeof body.staffCode === 'string' ? body.staffCode.trim() : '';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      const allowed = new Set(['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin']);

      let db = loadDb();
      const ps0 = normalizePlatformSettings(db.platformSettings);
      if (isDemoModeEnabled(db) && ps0?.security?.allowDemoSeed) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      db.sessions = Array.isArray(db.sessions) ? db.sessions : [];

      db = normalizeTenants(db);

      const tenantForSlug = (slug) => {
        const s = normalizeTenantSlug(slug);
        if (!s) return null;
        const t = (db.tenants || []).find((x) => x && String(x.slug || '').toLowerCase() === s);
        return t || null;
      };

      let resolvedRole = role;
      let resolvedBranchId = '';
      let resolvedStaffId = '';
      let resolvedTenantId = '';

      if (!email && role === 'Waiter' && staffCode) {
        // Waiter offline-friendly login: staff code + PIN (no email required)
        const t = tenantForSlug(workspace);
        if (!t) return json(res, 404, { error: 'workspace_not_found' });
        resolvedTenantId = String(t.id || '');

        let tdb = loadTenantDb(resolvedTenantId);
        tdb.sessions = Array.isArray(tdb.sessions) ? tdb.sessions : [];
        tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
        tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
        const ensureRole = (id, name, scope) => {
          const idx = tdb.roles.findIndex((r) => r && String(r.id || '') === id);
          if (idx >= 0) {
            const cur = tdb.roles[idx];
            tdb.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
            return;
          }
          tdb.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
        };
        ensureRole('role_waiter', 'Waiter', 'branch');
        ensureRole('role_manager', 'Branch Manager', 'branch');
        ensureRole('role_owner', 'Cafe Owner', 'global');

        const codeNorm = staffCode.toLowerCase();
        const s = tdb.staff.find((x) => x && String(x.code || '').toLowerCase() === codeNorm);
        if (!s) return json(res, 401, { error: 'invalid_credentials' });
        const rn = roleNameFromRoleId(tdb, s.roleId);
        if (rn !== 'Waiter') return json(res, 403, { error: 'forbidden_role' });

        const pinHash = typeof s.pin_hash === 'string' ? String(s.pin_hash) : '';
        const pinSalt = typeof s.pin_salt === 'string' ? String(s.pin_salt) : '';
        const pinIters = typeof s.pin_iters === 'number' ? Number(s.pin_iters) : 120000;
        if (pinHash && pinSalt) {
          const actual = pbkdf2B64(String(pin || ''), pinSalt, pinIters);
          if (actual !== pinHash) return json(res, 401, { error: 'invalid_credentials' });
        } else {
          const expectedPin = typeof s.pin === 'string' && s.pin ? String(s.pin) : String(s.password || '');
          if (String(pin || '') !== expectedPin) return json(res, 401, { error: 'invalid_credentials' });
        }

        resolvedRole = 'Waiter';
        resolvedBranchId = String(s.branchId || '');
        resolvedStaffId = String(s.id || '');
        saveTenantDb(resolvedTenantId, tdb);
      } else if (email) {
        const globalStaff = Array.isArray(db.staff) ? db.staff : [];
        const global = globalStaff.find((x) => x && normalizeEmail(x.email) === email);
        const globalRoleName = global ? roleNameFromRoleId(db, global.roleId) : '';

        // Super Admin: always authenticate against global DB and ignore workspace.
        if (global && globalRoleName === 'Super Admin') {
          if (String(global.password || '') !== String(password || '')) return json(res, 401, { error: 'invalid_credentials' });
          resolvedRole = 'Super Admin';
          resolvedBranchId = 'global';
          resolvedStaffId = String(global.id || '');
          resolvedTenantId = 'tenant_global';
        } else {
          // Tenant users: require valid workspace and authenticate against tenant DB file.
          const t = tenantForSlug(workspace);
          if (!t) return json(res, 404, { error: 'workspace_not_found' });
          resolvedTenantId = String(t.id || '');

          let tdb = loadTenantDb(resolvedTenantId);
          tdb.sessions = Array.isArray(tdb.sessions) ? tdb.sessions : [];

          // Demo logins in default workspace authenticate against tenant DB.
          // Ensure demo accounts exist in the tenant_global tenant DB so the Login screen demo picker works.
          if (normalizeTenantSlug(workspace) === 'default' && resolvedTenantId === 'tenant_global' && ps0?.security?.allowDemoSeed) {
            const branchIds = Object.keys(db.branches || {});
            const pick = (i) => branchIds[i % Math.max(1, branchIds.length)] || 'global';

            tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
            const ensureRoleLocal = (id, name, scope) => {
              const idx = tdb.roles.findIndex((r) => r && String(r.id || '') === id);
              if (idx >= 0) {
                const cur = tdb.roles[idx];
                tdb.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
                return;
              }
              tdb.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
            };
            ensureRoleLocal('role_waiter', 'Waiter', 'branch');
            ensureRoleLocal('role_manager', 'Branch Manager', 'branch');
            ensureRoleLocal('role_owner', 'Cafe Owner', 'global');

            tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
            const ensureDemoLocal = (args) => {
              const e = normalizeEmail(args.email);
              if (!e) return;
              const idx = tdb.staff.findIndex((s) => normalizeEmail(s?.email) === e);
              if (idx >= 0) {
                const cur = tdb.staff[idx];
                tdb.staff[idx] = {
                  ...cur,
                  email: args.email,
                  name: typeof cur.name === 'string' && cur.name ? cur.name : args.name,
                  roleId: typeof cur.roleId === 'string' && cur.roleId ? cur.roleId : args.roleId,
                  branchId: typeof cur.branchId === 'string' && cur.branchId ? cur.branchId : args.branchId,
                  password: typeof cur.password === 'string' && cur.password ? cur.password : args.password,
                };
                return;
              }
              tdb.staff.push({
                id: staffId(),
                code: '',
                name: args.name,
                email: args.email,
                password: args.password,
                phone: '',
                roleId: args.roleId,
                branchId: args.branchId,
                status: 'Active',
                lastLoginAt: '',
                createdAt: nowIso(),
              });
            };
            ensureDemoLocal({ name: 'Owner', email: 'owner@mirachpos.com', password: 'admin123', roleId: 'role_owner', branchId: 'global' });
            ensureDemoLocal({ name: 'Manager One', email: 'manager@cafe.com', password: 'admin123', roleId: 'role_manager', branchId: pick(0) });
            ensureDemoLocal({ name: 'Waiter One', email: 'waiter@cafe.com', password: 'admin123', roleId: 'role_waiter', branchId: pick(0) });
          }

          tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
          const ensureRole = (id, name, scope) => {
            const idx = tdb.roles.findIndex((r) => r && String(r.id || '') === id);
            if (idx >= 0) {
              const cur = tdb.roles[idx];
              tdb.roles[idx] = { ...cur, id, name, scope: cur.scope || scope };
              return;
            }
            tdb.roles.push({ id, name, scope, permissions: [], createdAt: nowIso() });
          };
          ensureRole('role_waiter', 'Waiter', 'branch');
          ensureRole('role_manager', 'Branch Manager', 'branch');
          ensureRole('role_owner', 'Cafe Owner', 'global');

          const staff = Array.isArray(tdb.staff) ? tdb.staff : [];
          const s = staff.find((x) => x && normalizeEmail(x.email) === email);
          if (!s) return json(res, 401, { error: 'invalid_credentials' });
          if (String(s.password || '') !== String(password || '')) return json(res, 401, { error: 'invalid_credentials' });
          const rn = roleNameFromRoleId(tdb, s.roleId);
          if (!allowed.has(rn) || rn === 'Super Admin') return json(res, 403, { error: 'forbidden_role' });
          resolvedRole = rn;
          resolvedBranchId = String(s.branchId || '');
          resolvedStaffId = String(s.id || '');

          if (resolvedRole === 'Cafe Owner') {
            const sub = getTenantSubscription(db, resolvedTenantId);
            if (!sub.modules.includes('owner_dashboard') || !sub.modules.includes('branches')) {
              const branchIds = Object.keys(tdb.branches || {});
              const first = branchIds[0] || '';
              if (first) resolvedBranchId = first;
            }
          }

          // Persist any seeding/upserts back to the tenant DB
          saveTenantDb(resolvedTenantId, tdb);
        }
      } else {
        if (!allowed.has(role)) return json(res, 400, { error: 'invalid_role' });
        const requestedBranchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
        const branchIds = Object.keys(db.branches || {});
        const fallbackBranchId = branchIds[0] || 'global';
        resolvedBranchId = role === 'Cafe Owner' || role === 'Super Admin' ? 'global' : requestedBranchId || fallbackBranchId;

        const requestedTenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
        resolvedTenantId = role === 'Super Admin' ? 'tenant_global' : (requestedTenantId || 'tenant_global');
        resolvedStaffId = typeof body.staffId === 'string' ? body.staffId.trim() : '';
      }
      const token = randToken();
      const now = Date.now();
      const expiresAt = platformSessionExpiresAt(db, now);
      db.sessions.push({ token, role: resolvedRole, branchId: resolvedBranchId, staffId: resolvedStaffId, tenantId: resolvedTenantId, createdAt: nowIso(), expiresAt });
      if (db.sessions.length > 2000) db.sessions = db.sessions.slice(-2000);

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: resolvedBranchId || 'global',
        type: 'auth_login',
        payload: { role: resolvedRole, staffId: resolvedStaffId, branchId: resolvedBranchId },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      const t = (db.tenants || []).find((x) => x && x.id === resolvedTenantId) || null;
      return json(res, 200, {
        ok: true,
        token,
        role: resolvedRole,
        branchId: resolvedBranchId,
        staffId: resolvedStaffId,
        tenantId: resolvedTenantId,
        tenant: t ? { id: t.id, name: t.name, slug: t.slug, domain: t.domain } : null,
        expiresAt,
        subscription: getTenantSubscription(db, resolvedTenantId),
      });
    }

    if (url.pathname === '/api/contact-admin' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!name || !email) return json(res, 400, { error: 'name_email_required' });
      if (!emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });

      const db = loadDb();
      db.contactRequests = Array.isArray(db.contactRequests) ? db.contactRequests : [];
      const reqId = `cr_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      db.contactRequests.push({ id: reqId, name, email, phone, message, at: nowIso(), status: 'open' });
      if (db.contactRequests.length > 5000) db.contactRequests = db.contactRequests.slice(-5000);

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'contact_admin',
        payload: { reqId, email },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);

      saveDb(db);
      return json(res, 201, { ok: true, requestId: reqId });
    }

    if (url.pathname === '/api/auth/me' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      return json(res, 200, { ok: true, me: ctx, subscription: getTenantSubscription(db, ctx.tenantId) });
    }

    if (url.pathname === '/api/sync/push' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const events = Array.isArray(body.events) ? body.events : [];
      if (events.length === 0) return json(res, 200, { ok: true, acked_event_ids: [], rejected: [], new_cursor: null });

      const tenantId = String(ctx.tenantId || '');
      const tdb = ensureSyncState(loadTenantDb(tenantId));
      const acked = [];
      const rejected = [];
      let lastCursor = null;

      for (const raw of events) {
        const e = normalizeSyncEvent(raw);
        if (!e) {
          rejected.push({ event_id: '', reason: 'invalid_event' });
          continue;
        }

        if (String(e.tenant_id) !== tenantId) {
          rejected.push({ event_id: e.event_id, reason: 'tenant_mismatch' });
          continue;
        }

        const allowed = syncAllowedEventTypesByClient[e.client_type];
        if (!allowed || !allowed.has(e.event_type)) {
          rejected.push({ event_id: e.event_id, reason: 'event_not_allowed' });
          continue;
        }

        // Branch safety: tenant roles are branch-scoped, except owner/super.
        if (ctx.role === 'Waiter' || ctx.role === 'Branch Manager') {
          if (String(e.branch_id || '') !== String(ctx.branchId || '')) {
            rejected.push({ event_id: e.event_id, reason: 'branch_forbidden' });
            continue;
          }
        }

        const r = appendSyncEvent(tdb, e);
        if (!r.ok) {
          rejected.push({ event_id: e.event_id, reason: 'apply_failed' });
          continue;
        }
        acked.push(e.event_id);

        // Option A + A1: accepting a draft auto-emits sent_to_kitchen (server-generated) so all devices converge.
        if (!r.duplicate && e.client_type === 'desktop' && e.event_type === 'order.accepted') {
          const orderId = String(e.payload?.order_id || e.payload?.draft_id || e.aggregate_id || '');
          const sentEventId = `srv_${e.event_id}_sent_to_kitchen`;
          const srv = appendServerSyncEvent(tdb, {
            event_id: sentEventId,
            tenant_id: e.tenant_id,
            branch_id: e.branch_id,
            device_id: 'server',
            aggregate_type: 'order',
            aggregate_id: orderId,
            event_type: 'order.sent_to_kitchen',
            created_at_local: e.created_at_local || '',
            payload: {
              order_id: orderId,
              sent_by_staff_id: String(e.payload?.accepted_by_staff_id || ctx.staffId || ''),
              stations: Array.isArray(e.payload?.stations) ? e.payload.stations : ['kitchen', 'bar'],
              source_accept_event_id: e.event_id,
            },
          });

          if (srv && srv.ok && !srv.duplicate) lastCursor = srv.cursor;
          else lastCursor = r.cursor;
        } else {
          lastCursor = r.cursor;
        }
      }

      saveTenantDb(tenantId, tdb);
      return json(res, 200, { ok: true, acked_event_ids: acked, rejected, new_cursor: lastCursor });
    }

    if (url.pathname === '/api/sync/pull' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const tenantId = String(ctx.tenantId || '');
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit') || 200)));

      const tdb = ensureSyncState(loadTenantDb(tenantId));
      const all = Array.isArray(tdb.sync?.events) ? tdb.sync.events : [];
      const batch = all
        .filter((e) => e && typeof e === 'object' && Number(e.cursor) > cursor)
        .sort((a, b) => Number(a.cursor) - Number(b.cursor))
        .slice(0, limit);

      const newCursor = batch.length ? Number(batch[batch.length - 1].cursor) : cursor;
      return json(res, 200, { ok: true, events: batch, new_cursor: newCursor });
    }

    if (url.pathname === '/api/sync/drafts/inbox' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const tenantId = String(ctx.tenantId || '');
      const branchId = (url.searchParams.get('branchId') || '').trim() || String(ctx.branchId || '');
      const status = (url.searchParams.get('status') || 'SUBMITTED').trim();

      const tdb = ensureSyncState(loadTenantDb(tenantId));
      const drafts = Array.isArray(tdb.sync?.drafts) ? tdb.sync.drafts : [];
      const items = drafts
        .filter((d) => d && typeof d === 'object')
        .filter((d) => (branchId ? String(d.branch_id || '') === branchId : true))
        .filter((d) => (status ? String(d.status || '') === status : true))
        .sort((a, b) => (String(a.updated_at_server || '') < String(b.updated_at_server || '') ? 1 : -1));

      return json(res, 200, { ok: true, branchId, status, drafts: items.slice(0, 500) });
    }

    if (url.pathname === '/api/audit/log' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.audit = Array.isArray(tdb.audit) ? tdb.audit : [];

      const staffName = resolveStaffName(tdb, ctx.staffId);
      const rec = {
        id: `aud_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        at: nowIso(),
        tenant_id: String(ctx.tenantId || ''),
        branch_id: String(ctx.branchId || ''),
        actor_staff_id: String(ctx.staffId || ''),
        actor_name: staffName,
        action: typeof body.action === 'string' ? body.action : '',
        entity_type: typeof body.entity_type === 'string' ? body.entity_type : '',
        entity_id: typeof body.entity_id === 'string' ? body.entity_id : '',
        message: typeof body.message === 'string' ? body.message : '',
        meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
      };

      if (!rec.action) return json(res, 400, { error: 'action_required' });

      tdb.audit.push(rec);
      if (tdb.audit.length > 20000) tdb.audit = tdb.audit.slice(-20000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 201, { ok: true });
    }

    if (url.pathname === '/api/audit/list' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const branchId = (url.searchParams.get('branchId') || '').trim() || String(ctx.branchId || '');
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50') || 50));
      const tdb = loadTenantDb(ctx.tenantId);
      const audit = Array.isArray(tdb.audit) ? tdb.audit : [];
      const rows = audit
        .filter((a) => a && typeof a === 'object')
        .filter((a) => (branchId ? String(a.branch_id || '') === branchId : true))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        .slice(0, limit);

      return json(res, 200, { ok: true, branchId, audit: rows });
    }

    if (url.pathname === '/api/superadmin/impersonate' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      db = normalizeTenants(db);
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
      if (!tenantId) return json(res, 400, { error: 'tenantId_required' });
      const t = (db.tenants || []).find((x) => x && x.id === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const role = typeof body.role === 'string' ? body.role.trim() : 'Cafe Owner';
      const allowed = new Set(['Cafe Owner', 'Branch Manager', 'Waiter']);
      if (!allowed.has(role)) return json(res, 400, { error: 'invalid_role' });

      const token = randToken();
      const now = Date.now();
      const expiresAt = platformSessionExpiresAt(db, now);
      db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
      db.sessions.push({ token, role, branchId: 'global', staffId: '', tenantId, createdAt: nowIso(), expiresAt, impersonatedBy: ctx.token });
      if (db.sessions.length > 2000) db.sessions = db.sessions.slice(-2000);

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'superadmin_impersonate',
        payload: { tenantId, role },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);

      saveDb(db);
      return json(res, 200, { ok: true, token, role, tenantId, branchId: 'global', expiresAt, subscription: getTenantSubscription(db, tenantId) });
    }

    if (url.pathname === '/api/superadmin/tenants/reset-creds' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
      if (!tenantId) return json(res, 400, { error: 'tenantId_required' });

      db = normalizeTenants(db);
      const t = (db.tenants || []).find((x) => x && x.id === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const resetToken = `reset_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_reset_creds',
        payload: { tenantId, resetToken },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, tenantId, resetToken });
    }

    if (url.pathname === '/api/subscription' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      return json(res, 200, { ok: true, subscription: getSubscription(db) });
    }

    if (url.pathname === '/api/subscription' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const tier = typeof body.tier === 'string' ? body.tier.trim() : '';
      if (!tier) return json(res, 400, { error: 'tier_required' });

      db.subscription = { tier };
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'subscription_updated',
        payload: { tier },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, subscription: getSubscription(db) });
    }

    if (url.pathname === '/api/superadmin/demo-mode' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      return json(res, 200, { ok: true, demoMode: isDemoModeEnabled(db) });
    }

    if (url.pathname === '/api/superadmin/demo-mode' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const demoMode = Boolean(body.demoMode);
      db.demoMode = demoMode;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'demo_mode_updated',
        payload: { demoMode },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, demoMode });
    }

    if (url.pathname === '/api/superadmin/tenants' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      db.events = Array.isArray(db.events) ? db.events : [];
      saveDb(db);

      const lastAt = (() => {
        const ev = [...db.events].reverse().find((e) => e && typeof e === 'object');
        return (ev && typeof ev.at === 'string' && ev.at) ? ev.at : nowIso();
      })();

      const tenants = (db.tenants || []).map((t) => {
        const isGlobal = t.id === 'tenant_global';
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          domain: t.domain,
          plan: String(t.subscription?.tier || 'Enterprise'),
          status: t.status,
          profile: (t.profile && typeof t.profile === 'object') ? t.profile : {},
          onboarding: (t.onboarding && typeof t.onboarding === 'object') ? t.onboarding : { stage: 'incoming', completedAt: '' },
          internalTags: Array.isArray(t.internalTags) ? t.internalTags : [],
          createdAt: t.createdAt || '',
          updatedAt: t.updatedAt || '',
          branches: isGlobal ? Object.keys(db.branches || {}).length : 0,
          users: isGlobal ? (Array.isArray(db.staff) ? db.staff.length : 0) : 0,
          lastActivityAt: isGlobal ? lastAt : (t.updatedAt || t.createdAt || lastAt),
        };
      });

      return json(res, 200, { ok: true, tenants });
    }

    const planAmountEtb = (tier, cycle) => {
      const t = String(tier || 'Trial');
      const c = String(cycle || 'Monthly');
      const monthly = (() => {
        if (t === 'Basic') return 2900;
        if (t === 'Pro') return 7900;
        if (t === 'Enterprise') return 0;
        return 0;
      })();
      if (c === 'Yearly') return monthly * 12;
      return monthly;
    };

    const canOwnerAutoActivateTier = (tier) => {
      const t = String(tier || 'Trial');
      return t === 'Trial';
    };

    if (url.pathname === '/api/superadmin/billing' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      db = normalizeTenants(db);
      saveDb(db);

      const tenants = (db.tenants || []).map((t) => {
        const tier = String(t.subscription?.tier || 'Trial');
        const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};
        const cycle = String(billing.cycle || 'Monthly');
        const amountEtb = typeof billing.amountEtb === 'number' && billing.amountEtb ? billing.amountEtb : planAmountEtb(tier, cycle);
        const nextBillAt = typeof billing.nextBillAt === 'string' ? billing.nextBillAt : '';
        const method = String(billing.method || 'Cash');
        const status = String(billing.status || 'Active');
        const graceEndsAt = typeof billing.graceEndsAt === 'string' ? billing.graceEndsAt : '';
        return {
          tenantId: t.id,
          tenantName: t.name,
          plan: tier,
          cycle,
          nextBillAt,
          amountEtb,
          method,
          status,
          graceEndsAt,
        };
      });

      const active = tenants.filter((x) => x.status === 'Active').length;
      const pendingVerify = tenants.filter((x) => x.status === 'Verification Needed').length;
      const revenueMonth = tenants
        .filter((x) => x.status === 'Active')
        .filter((x) => x.cycle === 'Monthly')
        .reduce((sum, x) => sum + Number(x.amountEtb || 0), 0);

      const atRisk = tenants.filter((x) => {
        if (!x.graceEndsAt) return false;
        const ms = new Date(x.graceEndsAt).getTime() - Date.now();
        return ms > 0 && ms <= 24 * 60 * 60 * 1000;
      }).length;

      return json(res, 200, {
        ok: true,
        overview: { totalActive: active, pendingVerify, monthlyRevenueEtb: revenueMonth, atRisk },
        subscriptions: tenants,
      });
    }

    if (url.pathname === '/api/superadmin/billing/verify' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
      if (!tenantId) return json(res, 400, { error: 'tenantId_required' });

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((t) => t && t.id === tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const t = db.tenants[idx];
      const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};

      const addMonths = (iso, months) => {
        const base = iso ? new Date(iso) : new Date();
        const d = new Date(Number.isNaN(base.getTime()) ? Date.now() : base.getTime());
        const day = d.getDate();
        d.setMonth(d.getMonth() + months);
        // Handle month rollover (e.g., Jan 31 -> Feb)
        if (d.getDate() < day) d.setDate(0);
        return d.toISOString();
      };

      const cycle = String(billing.cycle || 'Monthly');
      const paidAt = nowIso();
      const nextBillAt = cycle === 'Yearly' ? addMonths(paidAt, 12) : addMonths(paidAt, 1);

      const subPrev = (t.subscription && typeof t.subscription === 'object') ? t.subscription : {};
      const pendingTier = typeof subPrev.pendingTier === 'string' ? subPrev.pendingTier.trim() : '';
      const pendingCycle = typeof subPrev.pendingCycle === 'string' ? subPrev.pendingCycle.trim() : '';

      const allowedTiers = new Set(['Trial', 'Basic', 'Pro', 'Enterprise']);
      const allowedCycles = new Set(['Monthly', 'Yearly']);
      const applyTier = pendingTier && allowedTiers.has(pendingTier) ? pendingTier : String(subPrev.tier || 'Trial');
      const applyCycle = pendingCycle && allowedCycles.has(pendingCycle) ? pendingCycle : cycle;
      const amountEtb = planAmountEtb(applyTier, applyCycle);

      const next = {
        ...t,
        subscription: {
          ...subPrev,
          tier: applyTier,
          pendingTier: '',
          pendingCycle: '',
          enabledModules: undefined,
        },
        billing: { ...billing, status: 'Active', cycle: applyCycle, amountEtb, nextBillAt, graceEndsAt: '' },
        updatedAt: paidAt,
      };
      db.tenants[idx] = next;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'billing_verified',
        payload: { tenantId },
        at: paidAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/superadmin/audit' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const type = String(url.searchParams.get('type') || '').trim();
      const tenantId = String(url.searchParams.get('tenantId') || '').trim();
      const from = String(url.searchParams.get('from') || '').trim();
      const to = String(url.searchParams.get('to') || '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') || 25)));

      const fromMs = from ? new Date(from).getTime() : NaN;
      const toMs = to ? new Date(to).getTime() : NaN;

      const events = Array.isArray(db.events) ? db.events : [];
      const filtered = events
        .filter((e) => (type ? String(e?.type || '') === type : true))
        .filter((e) => {
          if (!tenantId) return true;
          const p = e && typeof e === 'object' ? e.payload : null;
          const t0 = p && typeof p === 'object' ? String(p.tenantId || '') : '';
          return t0 === tenantId;
        })
        .filter((e) => {
          if (!from && !to) return true;
          const at = e?.at ? new Date(e.at).getTime() : NaN;
          if (!Number.isFinite(at)) return false;
          if (Number.isFinite(fromMs) && at < fromMs) return false;
          if (Number.isFinite(toMs) && at > toMs) return false;
          return true;
        })
        .filter((e) => {
          if (!q) return true;
          const hay = JSON.stringify({ id: e?.id, type: e?.type, branchId: e?.branchId, payload: e?.payload || {} }).toLowerCase();
          return hay.includes(q);
        })
        .slice()
        .sort((a, b) => (String(a?.at || '') < String(b?.at || '') ? 1 : -1));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((e) => {
        const p = e && typeof e === 'object' ? e.payload : null;
        const payload = p && typeof p === 'object' ? p : {};
        const actor = String(payload.by || payload.actor || payload.email || payload.role || 'system');
        const target = String(payload.tenantId || payload.branchId || payload.staffId || payload.inviteId || payload.invoiceId || payload.productId || payload.ticketId || '');
        const details = typeof payload === 'object' ? JSON.stringify(payload) : String(payload || '');
        return {
          id: String(e?.id || ''),
          at: String(e?.at || ''),
          type: String(e?.type || ''),
          target,
          details,
          actor,
          sourceIp: '',
        };
      });

      const since24h = Date.now() - 24 * 60 * 60 * 1000;
      const total24h = events.filter((e) => {
        const at = e?.at ? new Date(e.at).getTime() : NaN;
        return Number.isFinite(at) && at >= since24h;
      }).length;

      const critical24h = events.filter((e) => {
        const at = e?.at ? new Date(e.at).getTime() : NaN;
        if (!Number.isFinite(at) || at < since24h) return false;
        const t = String(e?.type || '').toLowerCase();
        const lvl = String(e?.payload?.level || '').toLowerCase();
        return t.includes('suspend') || t.includes('delete') || t.includes('verify') || lvl === 'critical';
      }).length;

      const sessions = Array.isArray(db.sessions) ? db.sessions : [];
      const activeAdminSessions = sessions.filter((s) => {
        if (!s || typeof s !== 'object') return false;
        if (String(s.role || '') !== 'Super Admin') return false;
        const exp = s.expiresAt ? new Date(s.expiresAt).getTime() : NaN;
        return !Number.isFinite(exp) || exp > Date.now();
      }).length;

      return json(res, 200, {
        ok: true,
        page,
        pageSize,
        total,
        stats: { total24h, critical24h, activeAdminSessions },
        events: items,
      });
    }

    if (url.pathname === '/api/superadmin/feature-flags' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      db.featureFlags = Array.isArray(db.featureFlags) ? db.featureFlags : [];
      if (db.featureFlags.length === 0) {
        const now = nowIso();
        db.featureFlags.push(
          { id: 'feat_inv_core_v2_rollout', name: 'Inventory Module V2', plan: 'Enterprise', risk: 'Critical', enabled: true, updatedAt: now, updatedBy: 'System' },
          { id: 'feat_offline_sync_retry', name: 'Offline Mode Sync', plan: 'All Plans', risk: 'Medium', enabled: false, updatedAt: now, updatedBy: 'System' },
          { id: 'ui_dash_analytics_v3', name: 'New Dashboard Analytics', plan: 'Pro', risk: 'Low', enabled: true, updatedAt: now, updatedBy: 'System' },
        );
        saveDb(db);
      }

      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const plan = String(url.searchParams.get('plan') || '').trim();
      const risk = String(url.searchParams.get('risk') || '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') || 10)));

      const filtered = db.featureFlags
        .filter((f) => (plan ? String(f?.plan || '') === plan : true))
        .filter((f) => (risk ? String(f?.risk || '') === risk : true))
        .filter((f) => {
          if (!q) return true;
          const hay = `${String(f?.id || '')} ${String(f?.name || '')}`.toLowerCase();
          return hay.includes(q);
        })
        .slice()
        .sort((a, b) => (String(a?.updatedAt || '') < String(b?.updatedAt || '') ? 1 : -1));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((f) => ({
        id: String(f?.id || ''),
        name: String(f?.name || ''),
        plan: String(f?.plan || 'All Plans'),
        risk: String(f?.risk || 'Low'),
        enabled: Boolean(f?.enabled),
        updatedAt: String(f?.updatedAt || ''),
        updatedBy: String(f?.updatedBy || ''),
      }));

      const totalFlags = db.featureFlags.length;
      const activeGlobally = db.featureFlags.filter((f) => Boolean(f?.enabled)).length;
      const highRisk = db.featureFlags.filter((f) => {
        const r = String(f?.risk || '').toLowerCase();
        return r === 'high' || r === 'critical';
      }).length;
      const betaFeatures = db.featureFlags.filter((f) => String(f?.plan || '') === 'Beta').length;

      return json(res, 200, {
        ok: true,
        page,
        pageSize,
        total,
        stats: { totalFlags, activeGlobally, highRisk, betaFeatures },
        flags: items,
      });
    }

    if (url.pathname === '/api/superadmin/platform-settings' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const cur = normalizePlatformSettings(db.platformSettings);
      if (!db.platformSettings) {
        db.platformSettings = cur;
        saveDb(db);
      }

      return json(res, 200, { ok: true, settings: cur });
    }

    if (url.pathname === '/api/superadmin/platform-settings' && method === 'PUT') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const next = normalizePlatformSettings(body);
      db.platformSettings = next;
      const now = nowIso();
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'platform_settings_updated',
        payload: { by: 'Super Admin' },
        at: now,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, settings: next });
    }

    if (url.pathname === '/api/superadmin/feature-flags' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!id) return json(res, 400, { error: 'id_required' });
      if (!name) return json(res, 400, { error: 'name_required' });

      db.featureFlags = Array.isArray(db.featureFlags) ? db.featureFlags : [];
      if (db.featureFlags.some((f) => String(f?.id || '') === id)) return json(res, 409, { error: 'id_in_use' });

      const plan = typeof body.plan === 'string' && body.plan.trim() ? body.plan.trim() : 'All Plans';
      const risk = typeof body.risk === 'string' && body.risk.trim() ? body.risk.trim() : 'Low';
      const enabled = Boolean(body.enabled);
      const now = nowIso();

      const rec = { id, name, plan, risk, enabled, updatedAt: now, updatedBy: 'Super Admin' };
      db.featureFlags.push(rec);
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'feature_flag_created',
        payload: { flagId: id, name, plan, risk, enabled, by: 'Super Admin' },
        at: now,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, flag: rec });
    }

    const saFlagMatch = /^\/api\/superadmin\/feature-flags\/([^/]+)$/.exec(url.pathname);
    if (saFlagMatch && method === 'PUT') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      const flagId = String(saFlagMatch[1] || '');
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      db.featureFlags = Array.isArray(db.featureFlags) ? db.featureFlags : [];
      const idx = db.featureFlags.findIndex((f) => f && String(f.id || '') === flagId);
      if (idx < 0) return json(res, 404, { error: 'flag_not_found' });

      const cur = db.featureFlags[idx];
      const next = { ...cur };
      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
      if (typeof body.plan === 'string' && body.plan.trim()) next.plan = body.plan.trim();
      if (typeof body.risk === 'string' && body.risk.trim()) next.risk = body.risk.trim();
      if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
      next.updatedAt = nowIso();
      next.updatedBy = 'Super Admin';

      db.featureFlags[idx] = next;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'feature_flag_updated',
        payload: { flagId, enabled: Boolean(next.enabled), by: 'Super Admin' },
        at: next.updatedAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, flag: next });
    }

    if (url.pathname === '/api/superadmin/billing/manual-invoice' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
      const amountEtb = Number(body.amountEtb || 0);
      const dueAt = typeof body.dueAt === 'string' ? body.dueAt : '';
      const methodLabel = typeof body.method === 'string' ? body.method.trim() : 'Cash';
      const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
      if (!tenantId) return json(res, 400, { error: 'tenantId_required' });
      if (!Number.isFinite(amountEtb) || amountEtb <= 0) return json(res, 400, { error: 'amount_required' });

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((t) => t && t.id === tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const invoiceId = `inv_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const createdAt = nowIso();
      db.invoices.push({
        id: invoiceId,
        tenantId,
        amountEtb,
        currency: 'ETB',
        dueAt,
        method: methodLabel,
        status: 'Open',
        notes,
        createdAt,
      });

      const t = db.tenants[idx];
      const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};
      db.tenants[idx] = {
        ...t,
        billing: {
          ...billing,
          amountEtb,
          method: methodLabel,
          nextBillAt: dueAt || billing.nextBillAt || '',
          status: 'Verification Needed',
        },
        updatedAt: createdAt,
      };

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'billing_invoice_created',
        payload: { tenantId, invoiceId, amountEtb },
        at: createdAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, invoiceId });
    }

    if (url.pathname === '/api/superadmin/system-health' && method === 'GET') {
      const t0 = hrtimeMs();
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const t1 = hrtimeMs();
      const syncLatencyMs = Math.max(1, Math.round(t1 - t0));

      const now = Date.now();
      const events = Array.isArray(db?.events) ? db.events : [];
      const isErrorEvent = (e) => {
        const type = String(e?.type || '').toLowerCase();
        const lvl = String(e?.payload?.level || '').toLowerCase();
        return type.includes('error') || type.includes('fail') || type.includes('timeout') || lvl === 'critical' || lvl === 'warn';
      };

      const inWindow = (e, ms) => {
        const at = e?.at ? new Date(e.at).getTime() : NaN;
        if (Number.isNaN(at)) return false;
        return at >= now - ms;
      };

      const errors24h = events.filter((e) => isErrorEvent(e) && inWindow(e, 24 * 60 * 60 * 1000));
      const errors1h = events.filter((e) => isErrorEvent(e) && inWindow(e, 60 * 60 * 1000));
      const errorsPrev1h = events.filter((e) => {
        if (!isErrorEvent(e)) return false;
        const at = e?.at ? new Date(e.at).getTime() : NaN;
        if (Number.isNaN(at)) return false;
        return at >= now - (2 * 60 * 60 * 1000) && at < now - (60 * 60 * 1000);
      });

      const failedSyncsDelta = errors1h.length - errorsPrev1h.length;
      const apiUptimePct = errors24h.length === 0 ? 99.98 : Math.max(95, 99.98 - Math.min(4, errors24h.length * 0.05));

      const rawFeed = events
        .filter((e) => isErrorEvent(e))
        .slice()
        .sort((a, b) => new Date(b?.at || 0).getTime() - new Date(a?.at || 0).getTime())
        .slice(0, 25);

      const errorFeed = rawFeed.map((e) => {
        const level = String(e?.payload?.level || '').toUpperCase() || (String(e?.type || '').toLowerCase().includes('critical') ? 'CRITICAL' : 'WARN');
        const message = String(e?.payload?.message || e?.payload?.note || e?.payload?.reason || e?.type || '');
        return { at: typeof e?.at === 'string' ? e.at : nowIso(), level, message };
      });

      const components = [
        {
          id: 'primary_db',
          name: 'Primary Database (JSON)',
          region: 'Local',
          status: existsSync(DATA_FILE) ? 'HEALTHY' : 'DEGRADED',
          responseTimeMs: syncLatencyMs,
          uptime30dPct: 99.99,
          icon: 'database',
        },
        {
          id: 'tenant_store',
          name: 'Tenant Storage (FS)',
          region: 'Local',
          status: existsSync(TENANTS_DIR) ? 'HEALTHY' : 'DEGRADED',
          responseTimeMs: Math.max(1, Math.round(syncLatencyMs * 0.6)),
          uptime30dPct: 99.95,
          icon: 'memory',
        },
      ];

      const allOperational = components.every((c) => c.status === 'HEALTHY') && errors1h.length === 0;
      const environment = process.env.NODE_ENV === 'development' ? 'Development' : 'Production';

      return json(res, 200, {
        ok: true,
        environment,
        allOperational,
        lastRefreshedAt: nowIso(),
        kpis: {
          avgSyncLatencyMs: syncLatencyMs,
          latencyTrendPct: -12,
          failedSyncs24h: errors24h.length,
          failedSyncsDelta,
          apiUptimePct,
          apiStatusLabel: allOperational ? 'Operational' : 'Degraded',
        },
        errorFeed,
        components,
      });
    }

    if (url.pathname === '/api/superadmin/system-health/force-sync' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'superadmin_force_sync',
        payload: { level: 'INFO', message: 'Force sync triggered from System Health.' },
        at: nowIso(),
      });
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    const saSupportTicketMatch = /^\/api\/superadmin\/support\/tickets\/([^/]+)$/.exec(url.pathname);
    const saSupportReplyMatch = /^\/api\/superadmin\/support\/tickets\/([^/]+)\/reply$/.exec(url.pathname);

    const seedSupportTicketsIfEmpty = (db0) => {
      const next = { ...db0 };
      next.supportTickets = Array.isArray(next.supportTickets) ? next.supportTickets : [];
      if (next.supportTickets.length > 0) return next;
      const tenants = Array.isArray(next.tenants) ? next.tenants : [];
      const t0 = tenants[0] || { id: 'tenant_global', name: 'Default Cafe', subscription: { tier: getSubscription(next).tier } };
      const t1 = tenants[1] || t0;

      const mk = (idNum, tenant, severity, subject, status, minutesAgo, description) => {
        const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
        const tier = String(tenant?.subscription?.tier || getSubscription(next).tier || 'Enterprise');
        const initials = String(tenant?.name || 'Cafe')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((x) => x[0].toUpperCase())
          .join('')
          .slice(0, 2) || 'DG';

        return {
          id: String(idNum),
          tenantId: String(tenant?.id || 'tenant_global'),
          severity,
          subject,
          status,
          reportedByRole: 'Manager',
          description,
          createdAt,
          updatedAt: createdAt,
          client: {
            name: String(tenant?.name || 'Cafe'),
            tier,
            initials,
            ltvEtb: 12450,
            healthPct: 98,
          },
          activity: [
            {
              id: `act_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
              by: 'System',
              at: createdAt,
              message: 'Ticket created and queued for support triage.',
            },
          ],
        };
      };

      next.supportTickets.push(
        mk(
          9281,
          t0,
          'Critical',
          'Payment Gateway Timeout - Downtown Branch',
          'Investigating',
          120,
          'Since the network update at 09:00 AM, our main POS terminal is timing out when processing credit card payments. Cash transactions work fine. We have restarted the terminal twice. Customers are waiting.',
        ),
      );
      next.supportTickets.push(
        mk(
          9278,
          t1,
          'High',
          'Inventory Sync failure since update v2.4',
          'Open',
          35,
          'Inventory sync jobs are failing intermittently after the latest update. We are seeing missing items and delayed updates across devices.',
        ),
      );
      return next;
    };

    const slaMinutesForSeverity = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s === 'critical') return 4 * 60;
      if (s === 'high') return 8 * 60;
      if (s === 'medium') return 24 * 60;
      return 48 * 60;
    };

    if (url.pathname === '/api/superadmin/support' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      db = seedSupportTicketsIfEmpty(db);
      const tickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];
      const today0 = startOfDayIso();
      const today0Ms = new Date(today0).getTime();

      const isOpen = (t) => {
        const st = String(t?.status || '').toLowerCase();
        return st !== 'resolved' && st !== 'closed';
      };

      const openTickets = tickets.filter((t) => isOpen(t));

      const ticketsWithSla = tickets.map((t) => {
        const createdAt = typeof t?.createdAt === 'string' ? t.createdAt : nowIso();
        const slaMin = slaMinutesForSeverity(t?.severity);
        const dueAtMs = new Date(createdAt).getTime() + slaMin * 60000;
        const remMs = dueAtMs - Date.now();
        const breach = remMs <= 0 && isOpen(t);
        return {
          id: String(t?.id || ''),
          severity: String(t?.severity || 'Low'),
          subject: String(t?.subject || ''),
          status: String(t?.status || 'Open'),
          tenantId: String(t?.tenantId || ''),
          createdAt,
          slaRemainingSec: Math.max(0, Math.floor(remMs / 1000)),
          slaBreached: breach,
          clientName: String(t?.client?.name || ''),
        };
      });

      const slaBreaches = ticketsWithSla.filter((t) => t.slaBreached).length;
      const todayVolume = tickets.filter((t) => {
        const at = t?.createdAt ? new Date(t.createdAt).getTime() : NaN;
        if (Number.isNaN(at)) return false;
        return at >= today0Ms;
      }).length;

      const responseMins = tickets
        .map((t) => {
          const acts = Array.isArray(t?.activity) ? t.activity : [];
          const firstAgent = acts
            .slice()
            .sort((a, b) => new Date(a?.at || 0).getTime() - new Date(b?.at || 0).getTime())
            .find((a) => String(a?.by || '').toLowerCase().includes('support') || String(a?.by || '').toLowerCase().includes('super admin'));
          if (!firstAgent) return null;
          const mins = minutesBetween(t?.createdAt, firstAgent?.at);
          return typeof mins === 'number' ? mins : null;
        })
        .filter((x) => typeof x === 'number');

      const avgResponseMin = responseMins.length ? Math.round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length) : 12;

      if (db.supportTickets.length > 5000) db.supportTickets = db.supportTickets.slice(-5000);
      saveDb(db);

      return json(res, 200, {
        ok: true,
        stats: {
          totalOpen: openTickets.length,
          slaBreaches,
          avgResponseMin,
          todayVolume,
        },
        tickets: ticketsWithSla
          .slice()
          .sort((a, b) => {
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            return tb - ta;
          }),
      });
    }

    if (url.pathname === '/api/support/tickets' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Branch Manager'])) return;

      db.supportTickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];
      const tenantId = String(ctx.tenantId || 'tenant_global');
      const branchId = String(ctx.branchId || 'global');
      const role = String(ctx.role || '');

      const mine = db.supportTickets
        .filter((t) => {
          if (String(t?.tenantId || '') !== tenantId) return false;
          if (role === 'Branch Manager') return String(t?.createdBy?.branchId || 'global') === branchId;
          return true;
        })
        .slice()
        .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());

      const rows = mine.map((t) => ({
        id: String(t?.id || ''),
        severity: String(t?.severity || 'Low'),
        subject: String(t?.subject || ''),
        status: String(t?.status || 'Open'),
        createdAt: typeof t?.createdAt === 'string' ? t.createdAt : nowIso(),
        updatedAt: typeof t?.updatedAt === 'string' ? t.updatedAt : '',
      }));

      return json(res, 200, { ok: true, tickets: rows });
    }

    if (url.pathname === '/api/support/tickets' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Branch Manager'])) return;

      const body = await readBody(req);
      const severity = typeof body?.severity === 'string' ? body.severity.trim() : 'Low';
      const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
      const description = typeof body?.description === 'string' ? body.description.trim() : '';
      if (!subject) return json(res, 400, { error: 'subject_required' });
      if (!description) return json(res, 400, { error: 'description_required' });

      const tenantId = String(ctx.tenantId || 'tenant_global');
      const tenants = Array.isArray(db.tenants) ? db.tenants : [];
      const tenant = tenants.find((t) => String(t?.id || '') === tenantId) || null;
      const tier = String(tenant?.subscription?.tier || getTenantSubscription(db, tenantId).tier || getSubscription(db).tier || 'Enterprise');
      const tenantName = String(tenant?.name || 'Cafe');
      const initials = tenantName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => x[0].toUpperCase())
        .join('')
        .slice(0, 2) || 'CF';

      db.supportTickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];

      const id = String(nextSupportTicketNumber(db));
      const at = nowIso();
      const ticket = {
        id,
        tenantId,
        severity,
        subject,
        status: 'Open',
        reportedByRole: String(ctx.role || ''),
        description,
        createdAt: at,
        updatedAt: at,
        createdBy: {
          role: String(ctx.role || ''),
          staffId: String(ctx.staffId || ''),
          branchId: String(ctx.branchId || 'global'),
        },
        client: {
          name: tenantName,
          tier,
          initials,
          ltvEtb: 0,
          healthPct: 100,
        },
        activity: [
          {
            id: `act_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
            by: 'System',
            at,
            message: `Ticket created by ${String(ctx.role || 'Client')}.`,
          },
        ],
      };

      db.supportTickets.push(ticket);
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: String(ctx.branchId || 'global'),
        type: 'support_ticket_created',
        payload: { tenantId, ticketId: id, level: 'INFO', message: 'Support ticket created.' },
        at,
      });
      if (db.supportTickets.length > 5000) db.supportTickets = db.supportTickets.slice(-5000);
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, ticketId: id });
    }

    if (saSupportTicketMatch && method === 'GET') {
      const ticketId = String(saSupportTicketMatch[1] || '');
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;
      db.supportTickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];

      const t = db.supportTickets.find((x) => String(x?.id || '') === ticketId);
      if (!t) return json(res, 404, { error: 'not_found' });

      return json(res, 200, { ok: true, ticket: t });
    }

    if (saSupportReplyMatch && method === 'POST') {
      const ticketId = String(saSupportReplyMatch[1] || '');
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!message) return json(res, 400, { error: 'message_required' });

      db.supportTickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];
      const idx = db.supportTickets.findIndex((x) => String(x?.id || '') === ticketId);
      if (idx < 0) return json(res, 404, { error: 'not_found' });

      const cur = db.supportTickets[idx];
      const activity = Array.isArray(cur?.activity) ? cur.activity : [];
      const at = nowIso();
      activity.push({
        id: `act_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        by: 'Super Admin Support',
        at,
        message,
      });

      db.supportTickets[idx] = { ...cur, activity, updatedAt: at };
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'support_ticket_reply',
        payload: { ticketId, level: 'INFO', message: 'Support reply added.' },
        at,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    const billingSetMatch = /^\/api\/superadmin\/billing\/set-(status|cycle|method|nextbill|grace)$/.exec(url.pathname);
    if (billingSetMatch && method === 'POST') {
      const which = billingSetMatch[1];
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
      if (!tenantId) return json(res, 400, { error: 'tenantId_required' });

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((t) => t && t.id === tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const t = db.tenants[idx];
      const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};
      const nextBilling = { ...billing };

      if (which === 'status') {
        const status = typeof body.status === 'string' ? body.status.trim() : '';
        if (!status) return json(res, 400, { error: 'status_required' });
        nextBilling.status = status;
      }
      if (which === 'cycle') {
        const cycle = typeof body.cycle === 'string' ? body.cycle.trim() : '';
        if (!cycle) return json(res, 400, { error: 'cycle_required' });
        nextBilling.cycle = cycle;
      }
      if (which === 'method') {
        const methodLabel = typeof body.method === 'string' ? body.method.trim() : '';
        if (!methodLabel) return json(res, 400, { error: 'method_required' });
        nextBilling.method = methodLabel;
      }
      if (which === 'nextbill') {
        const nextBillAt = typeof body.nextBillAt === 'string' ? body.nextBillAt : '';
        nextBilling.nextBillAt = nextBillAt;
      }
      if (which === 'grace') {
        const graceEndsAt = typeof body.graceEndsAt === 'string' ? body.graceEndsAt : '';
        nextBilling.graceEndsAt = graceEndsAt;
      }

      const updatedAt = nowIso();
      db.tenants[idx] = { ...t, billing: nextBilling, updatedAt };
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: `billing_${which}_updated`,
        payload: { tenantId },
        at: updatedAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/superadmin/tenants' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return json(res, 400, { error: 'name_required' });

      const tier = typeof body.tier === 'string' ? body.tier.trim() : 'Trial';

      db = normalizeTenants(db);

      const requestedSlug = typeof body.slug === 'string' ? body.slug.trim() : '';
      if (requestedSlug && !slugLooksOk(requestedSlug)) return json(res, 400, { error: 'invalid_slug' });
      const slug = uniqueSlugForTenants(db.tenants || [], requestedSlug || name);
      const domain = `${slug}.${BASE_DOMAIN}`;

      const id = `tenant_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const now = nowIso();

      const profile = {
        contactEmail: typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '',
        contactPhone: typeof body.contactPhone === 'string' ? body.contactPhone.trim() : '',
        address1: typeof body.address1 === 'string' ? body.address1.trim() : '',
        city: typeof body.city === 'string' ? body.city.trim() : '',
        country: typeof body.country === 'string' ? body.country.trim() : '',
        timezone: typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Africa/Addis_Ababa',
        currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'ETB',
        customDomain: '',
      };

      if (!emailLooksOk(profile.contactEmail)) return json(res, 400, { error: 'invalid_email' });

      db.tenants.push({ id, name, slug, domain, status: 'Active', subscription: { tier }, profile, createdAt: now, updatedAt: now });

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_created',
        payload: { tenantId: id, name, tier },
        at: now,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);

      saveDb(db);
      return json(res, 201, {
        ok: true,
        tenant: { id, name, domain, plan: tier, status: 'Active', branches: 0, users: 0, lastActivityAt: now },
      });
    }

    const saTenantMatch = /^\/api\/superadmin\/tenants\/([^/]+)$/.exec(url.pathname);

    const saTenantActivityMatch = /^\/api\/superadmin\/tenants\/([^/]+)\/activity$/.exec(url.pathname);
    if (saTenantActivityMatch && method === 'GET') {
      const tenantId = saTenantActivityMatch[1];
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      db = normalizeTenants(db);
      const t = (db.tenants || []).find((x) => x && x.id === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const events = Array.isArray(db.events) ? db.events : [];
      const activity = events
        .filter((e) => e && typeof e === 'object')
        .filter((e) => !tenantId || (e.payload && typeof e.payload === 'object' && String(e.payload.tenantId || '') === String(tenantId)))
        .slice(-200)
        .reverse()
        .map((e) => ({
          id: String(e.id || ''),
          at: String(e.at || ''),
          type: String(e.type || ''),
          message: typeof e.payload?.message === 'string' ? e.payload.message : '',
          actor: typeof e.payload?.actor === 'string' ? e.payload.actor : '',
        }))
        .filter((a) => a.id);

      return json(res, 200, { ok: true, tenantId, activity });
    }

    const saTenantNoteMatch = /^\/api\/superadmin\/tenants\/([^/]+)\/notes$/.exec(url.pathname);
    if (saTenantNoteMatch && method === 'POST') {
      const tenantId = saTenantNoteMatch[1];
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) return json(res, 400, { error: 'message_required' });

      db = normalizeTenants(db);
      const t = (db.tenants || []).find((x) => x && x.id === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const at = nowIso();
      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'sa_note',
        payload: { tenantId, message, actor: 'Super Admin' },
        at,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true });
    }

    if (saTenantMatch && method === 'GET') {
      const tenantId = saTenantMatch[1];
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      db = normalizeTenants(db);
      saveDb(db);

      const t = (db.tenants || []).find((x) => x && x.id === tenantId);
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const lastAt = (() => {
        const ev = [...(db.events || [])].reverse().find((e) => e && typeof e === 'object');
        return (ev && typeof ev.at === 'string' && ev.at) ? ev.at : nowIso();
      })();

      const isGlobal = tenantId === 'tenant_global';
      const enabledModules = Array.isArray(t.subscription?.enabledModules)
        ? t.subscription.enabledModules.map((m) => String(m || '')).filter(Boolean)
        : null;

      const metrics = calcTenantMetrics(db, tenantId);
      const incidents = tenantIncidents(db, tenantId);

      const branchesPreview = (() => {
        if (!isGlobal) return [];
        const branches = db.branches && typeof db.branches === 'object' ? db.branches : {};
        return Object.values(branches)
          .filter((b) => b && typeof b === 'object')
          .map((b) => ({
            id: String(b.id || ''),
            name: String(b.name || ''),
            city: String(b.city || b.region || ''),
            status: String(b.status || 'Open'),
          }))
          .filter((b) => b.id && b.name)
          .slice(0, 10);
      })();

      return json(res, 200, {
        ok: true,
        tenant: {
          id: t.id,
          name: t.name,
          slug: t.slug,
          domain: t.domain,
          status: t.status,
          plan: String(t.subscription?.tier || 'Enterprise'),
          enabledModules,
          features: Array.isArray(t.features) ? t.features : [],
          profile: t.profile || {},
          internalTags: Array.isArray(t.internalTags) ? t.internalTags : [],
          metrics,
          incidents,
          branchesPreview,
          branches: isGlobal ? Object.keys(db.branches || {}).length : 0,
          users: isGlobal ? (Array.isArray(db.staff) ? db.staff.length : 0) : 0,
          lastActivityAt: isGlobal ? lastAt : (t.updatedAt || t.createdAt || lastAt),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        },
      });
    }

    if (saTenantMatch && method === 'PUT') {
      const tenantId = saTenantMatch[1];
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      db = normalizeTenants(db);
      const idx = (db.tenants || []).findIndex((x) => x && x.id === tenantId);
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const prev = db.tenants[idx];
      const next = { ...prev };

      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
      if (typeof body.slug === 'string' && body.slug.trim()) {
        const requested = body.slug.trim();
        if (!slugLooksOk(requested)) return json(res, 400, { error: 'invalid_slug' });
        const taken = (db.tenants || []).some((t) => t && t.id !== tenantId && String(t.slug || '').toLowerCase() === normalizeTenantSlug(requested));
        if (taken) return json(res, 409, { error: 'slug_taken' });
        next.slug = normalizeTenantSlug(requested);
        next.domain = `${next.slug}.${BASE_DOMAIN}`;
      }
      if (typeof body.status === 'string' && body.status.trim()) next.status = body.status.trim();
      if (typeof body.tier === 'string' && body.tier.trim()) {
        const nextTier = body.tier.trim();
        const prevEnabled = Array.isArray(next.subscription?.enabledModules) ? next.subscription.enabledModules : null;
        const base = subscriptionModules(nextTier);
        next.subscription = {
          tier: nextTier,
          enabledModules: prevEnabled ? base.filter((m) => prevEnabled.includes(m)) : undefined,
        };
      }

      if (typeof body.onboardingStage === 'string' && body.onboardingStage.trim()) {
        next.onboarding = { ...(next.onboarding || {}), stage: body.onboardingStage.trim() };
      }

      if (Array.isArray(body.internalTags)) {
        const raw = body.internalTags.map((x) => String(x || '').trim()).filter(Boolean);
        const cleaned = [...new Set(raw)].slice(0, 30);
        next.internalTags = cleaned;
      }

      if (Array.isArray(body.enabledModules)) {
        const base = subscriptionModules(String(next.subscription?.tier || 'Enterprise'));
        const requested = body.enabledModules.map((m) => String(m || '')).filter(Boolean);
        // Only allow disabling within tier (enabledModules must be subset of tier modules)
        const filtered = base.filter((m) => requested.includes(m));
        next.subscription = { ...(next.subscription || { tier: 'Enterprise' }), enabledModules: filtered };
      }

      if (Array.isArray(body.features)) {
        const requested = body.features.map((f) => String(f || '')).filter(Boolean);
        const allowed = new Set(['loyalty', 'kds', 'public_api']);
        next.features = requested.filter((f) => allowed.has(f));
      }

      if (body && typeof body === 'object') {
        const merged = { ...(next.profile || {}) };
        if (typeof body.contactEmail === 'string') merged.contactEmail = body.contactEmail.trim();
        if (typeof body.contactPhone === 'string') merged.contactPhone = body.contactPhone.trim();
        if (typeof body.address1 === 'string') merged.address1 = body.address1.trim();
        if (typeof body.city === 'string') merged.city = body.city.trim();
        if (typeof body.country === 'string') merged.country = body.country.trim();
        if (typeof body.timezone === 'string' && body.timezone.trim()) merged.timezone = body.timezone.trim();
        if (typeof body.currency === 'string' && body.currency.trim()) merged.currency = body.currency.trim();
        if (!emailLooksOk(merged.contactEmail)) return json(res, 400, { error: 'invalid_email' });
        next.profile = merged;
      }

      next.updatedAt = nowIso();
      db.tenants[idx] = next;

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'tenant_updated',
        payload: { tenantId, changes: { name: next.name, status: next.status, tier: next.subscription?.tier, onboardingStage: next.onboarding?.stage, internalTags: next.internalTags } },
        at: next.updatedAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);

      saveDb(db);
      return json(res, 200, {
        ok: true,
        tenant: {
          id: next.id,
          name: next.name,
          status: next.status,
          plan: String(next.subscription?.tier || 'Enterprise'),
          lastActivityAt: next.updatedAt,
        },
      });
    }

    if (url.pathname === '/api/superadmin/overview' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Super Admin'])) return;

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      db = normalizeTenants(db);
      db.events = Array.isArray(db.events) ? db.events : [];
      saveDb(db);

      const totalTenants = (db.tenants || []).length;
      const activeTenants = (db.tenants || []).filter((t) => String(t.status) === 'Active').length;
      const suspendedTenants = (db.tenants || []).filter((t) => String(t.status) === 'Suspended').length;
      const trialTenants = (db.tenants || []).filter((t) => String(t.subscription?.tier) === 'Trial').length;
      const totalBranches = Object.keys(db.branches || {}).length;
      const totalUsers = Array.isArray(db.staff) ? db.staff.length : 0;

      return json(res, 200, {
        ok: true,
        overview: {
          totalTenants,
          activeTenants,
          suspendedTenants,
          trialTenants,
          totalBranches,
          totalUsers,
        },
      });
    }

    if (url.pathname === '/api/branches' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      if (ctx.role !== 'Super Admin') {
        const sub = getTenantSubscription(db, ctx.tenantId);
        const tdb = loadTenantDb(ctx.tenantId);
        const all = Object.values(tdb.branches || {});
        const visible = sub.modules.includes('branches') ? all : all.slice(0, 1);
        const branches = visible.map((b) => ({
          id: b.id,
          name: b.name,
          managerName: b.managerName || '',
          city: b.city || '',
          region: b.region || b.city || '',
          address: b.address || '',
          phone: b.phone || '',
          staffCount: typeof b.staffCount === 'number' ? b.staffCount : 0,
          status: b.status,
          rating: b.rating ?? 4.6,
          createdAt: b.createdAt,
        }));
        return json(res, 200, { branches });
      }

      if (isDemoMode(db, ctx)) db = seedDemoBranchesIfEmpty(db);
      saveDb(db);
      const branches = Object.values(db.branches).map((b) => ({
        id: b.id,
        name: b.name,
        managerName: b.managerName || '',
        city: b.city || '',
        region: b.region || b.city || '',
        address: b.address || '',
        phone: b.phone || '',
        staffCount: typeof b.staffCount === 'number' ? b.staffCount : 0,
        status: b.status,
        rating: b.rating ?? 4.6,
        createdAt: b.createdAt,
      }));
      return json(res, 200, { branches });
    }

    // POS state sync (branch-scoped for Waiter/Branch Manager)
    if (url.pathname === '/api/pos/initialize' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const body = await readBody(req);
      const tablesCount = Number(body?.tablesCount ?? 12);
      const defaultSeats = Number(body?.defaultSeats ?? 4);
      const defaultArea = typeof body?.defaultArea === 'string' ? body.defaultArea : 'Main Hall';

      const count = Number.isFinite(tablesCount) ? Math.max(1, Math.min(60, Math.trunc(tablesCount))) : 12;
      const seats = Number.isFinite(defaultSeats) ? Math.max(1, Math.min(20, Math.trunc(defaultSeats))) : 4;

      const mkTable = (i) => ({
        id: `tbl_${i}`,
        name: `Table ${i}`,
        seats,
        area: defaultArea,
        status: 'Free',
        openOrderId: null,
        assignedStaffId: null,
        assignedStaffName: null,
      });

      const state = {
        version: 1,
        products: [],
        recipes: [],
        tables: Array.from({ length: count }, (_x, idx) => mkTable(idx + 1)),
        orders: [],
        notifications: [],
        updatedAt: nowIso(),
      };

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.posStateByBranchId = tdb.posStateByBranchId && typeof tdb.posStateByBranchId === 'object' ? tdb.posStateByBranchId : {};
      const key = `pos_${branchId}`;
      tdb.posStateByBranchId[key] = state;
      saveTenantDb(ctx.tenantId, tdb);

      return json(res, 200, { ok: true, initialized: true, branchId });
    }

    if (url.pathname === '/api/pos/state' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;
      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      const key = `pos_${branchId}`;
      const tdb = loadTenantDb(ctx.tenantId);
      const state = tdb?.posStateByBranchId?.[key] ?? null;
      return json(res, 200, { ok: true, state });
    }

    // Hosted-compatible: frontend sends PUT /api/pos/state with body { state }
    if (url.pathname === '/api/pos/state' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;
      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const state = body.state;
      if (!state || typeof state !== 'object') return json(res, 400, { error: 'state_required' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.posStateByBranchId = tdb.posStateByBranchId && typeof tdb.posStateByBranchId === 'object' ? tdb.posStateByBranchId : {};
      const key = `pos_${branchId}`;
      tdb.posStateByBranchId[key] = state;

      // Persist orders for history/query endpoints (tenant-scoped)
      tdb.orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const incomingOrders = Array.isArray(state.orders) ? state.orders : [];
      const now = nowIso();
      const nextOrders = tdb.orders.filter((o) => o && typeof o === 'object' && o.branchId !== branchId);
      for (const o of incomingOrders) {
        if (!o || typeof o !== 'object') continue;
        const id = typeof o.id === 'string' ? o.id : '';
        if (!id) continue;
        nextOrders.push({ ...o, branchId, updatedAt: now });
      }
      tdb.orders = nextOrders;

      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, state });
    }

    // Hosted-compatible: POS order persistence
    if (url.pathname === '/api/pos/orders' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const status = String(url.searchParams.get('status') || '').trim();
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || '100') || 100));

      const tdb = loadTenantDb(ctx.tenantId);
      const orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const scoped = orders.filter((o) => o && typeof o === 'object' && o.branchId === branchId);
      const filtered = scoped.filter((o) => (status ? String(o.status || '') === status : true));
      const items = filtered.slice(0, limit);
      return json(res, 200, { ok: true, branchId, orders: items });
    }

    if (url.pathname === '/api/pos/orders' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) return json(res, 400, { error: 'id_required' });

      const now = nowIso();
      const order = {
        ...body,
        id,
        branchId,
        updatedAt: now,
      };

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const idx = tdb.orders.findIndex((o) => o && typeof o === 'object' && String(o.id) === id && o.branchId === branchId);
      if (idx >= 0) tdb.orders[idx] = order;
      else tdb.orders.unshift(order);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, id });
    }

    const posOrderMatch = /^\/api\/pos\/orders\/([^/]+)$/.exec(url.pathname);
    if (posOrderMatch && method === 'PUT') {
      const orderId = posOrderMatch[1];
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const idx = tdb.orders.findIndex((o) => o && typeof o === 'object' && String(o.id) === String(orderId) && o.branchId === branchId);
      if (idx < 0) return json(res, 404, { error: 'not_found' });

      const now = nowIso();
      tdb.orders[idx] = { ...tdb.orders[idx], ...body, id: String(orderId), branchId, updatedAt: now };
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/pos/sync' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager'])) return;
      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const state = body.state;
      if (!state || typeof state !== 'object') return json(res, 400, { error: 'state_required' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.posStateByBranchId = tdb.posStateByBranchId && typeof tdb.posStateByBranchId === 'object' ? tdb.posStateByBranchId : {};
      const key = `pos_${branchId}`;
      tdb.posStateByBranchId[key] = state;

      // Persist orders for history/query endpoints (tenant-scoped)
      tdb.orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const incomingOrders = Array.isArray(state.orders) ? state.orders : [];
      const now = nowIso();
      const nextOrders = tdb.orders.filter((o) => o && typeof o === 'object' && o.branchId !== branchId);
      for (const o of incomingOrders) {
        if (!o || typeof o !== 'object') continue;
        const id = typeof o.id === 'string' ? o.id : '';
        if (!id) continue;
        nextOrders.push({ ...o, branchId, updatedAt: now });
      }
      tdb.orders = nextOrders;

      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, state });
    }

    // Shift schedule (tenant + branch scoped)
    if (url.pathname === '/api/schedule' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter', 'Branch Manager', 'Cafe Owner'])) return;

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.schedulesByWeek = tdb.schedulesByWeek && typeof tdb.schedulesByWeek === 'object' ? tdb.schedulesByWeek : {};

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner') {
          const qp = String(url.searchParams.get('branchId') || '').trim();
          if (qp) return qp;
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      const weekStart = String(url.searchParams.get('weekStart') || '').trim();
      const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : '';
      if (!weekKey) return json(res, 400, { error: 'weekStart_required' });

      const roleById = new Map(tdb.roles.map((r) => [String(r.id || ''), r]));
      const staff = tdb.staff
        .filter((s) => s && typeof s === 'object')
        .filter((s) => String(s.branchId || '') === branchId)
        .map((s) => ({
          id: String(s.id || ''),
          name: String(s.name || ''),
          roleName: String(roleById.get(String(s.roleId || ''))?.name || ''),
        }))
        .filter((s) => s.id && s.name);

      const rawRows = tdb.schedulesByWeek[weekKey];
      const rows = Array.isArray(rawRows) ? rawRows : [];
      return json(res, 200, { ok: true, branchId, weekStart: weekKey, staff, rows, readOnly: ctx.role === 'Waiter' });
    }

    if (url.pathname === '/api/schedule' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];
      tdb.schedulesByWeek = tdb.schedulesByWeek && typeof tdb.schedulesByWeek === 'object' ? tdb.schedulesByWeek : {};

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner') {
          const bp = typeof body.branchId === 'string' ? body.branchId.trim() : '';
          if (bp) return bp;
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      const weekStart = typeof body.weekStart === 'string' ? body.weekStart.trim() : '';
      const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : '';
      if (!weekKey) return json(res, 400, { error: 'weekStart_required' });

      const rowsIn = Array.isArray(body.rows) ? body.rows : null;
      if (!rowsIn) return json(res, 400, { error: 'rows_required' });

      const sanitizeRow = (r) => {
        if (!r || typeof r !== 'object') return null;
        const staffId = typeof r.staffId === 'string' ? r.staffId : '';
        if (!staffId) return null;
        const norm = {
          staffId,
          mon: typeof r.mon === 'string' ? r.mon : 'Off',
          tue: typeof r.tue === 'string' ? r.tue : 'Off',
          wed: typeof r.wed === 'string' ? r.wed : 'Off',
          thu: typeof r.thu === 'string' ? r.thu : 'Off',
          fri: typeof r.fri === 'string' ? r.fri : 'Off',
          sat: typeof r.sat === 'string' ? r.sat : 'Off',
          sun: typeof r.sun === 'string' ? r.sun : 'Off',
        };
        return norm;
      };

      const allowedStaff = new Set(
        tdb.staff
          .filter((s) => s && typeof s === 'object')
          .filter((s) => String(s.branchId || '') === branchId)
          .map((s) => String(s.id || '')),
      );

      const rows = rowsIn
        .map(sanitizeRow)
        .filter((r) => r && allowedStaff.has(String(r.staffId || '')));

      tdb.schedulesByWeek[weekKey] = rows;
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'schedule_updated',
        payload: { weekStart: weekKey, rows: rows.length, by: String(ctx.role || '') },
        at: nowIso(),
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, branchId, weekStart: weekKey, rows });
    }

    // Waiter: self-service account (password + PIN)
    if (url.pathname === '/api/waiter/account' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const currentPin = typeof body.currentPin === 'string' ? body.currentPin : '';
      const newPin = typeof body.newPin === 'string' ? body.newPin : '';

      if (!newPassword && !newPin) return json(res, 400, { error: 'no_changes' });
      if (newPassword && newPassword.length < 4) return json(res, 400, { error: 'password_too_short' });
      if (newPin && newPin.length < 3) return json(res, 400, { error: 'pin_too_short' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const idx = tdb.staff.findIndex((s) => s && String(s.id || '') === String(ctx.staffId || ''));
      if (idx < 0) return json(res, 404, { error: 'staff_not_found' });
      const cur = tdb.staff[idx];
      if (String(cur.branchId || '') !== branchId) return json(res, 403, { error: 'forbidden' });
      if (roleNameFromRoleId(tdb, cur.roleId) !== 'Waiter') return json(res, 403, { error: 'forbidden_role' });

      if (newPassword) {
        const expected = typeof cur.password === 'string' ? cur.password : '';
        if (!currentPassword || currentPassword !== expected) return json(res, 401, { error: 'invalid_credentials' });
      }
      if (newPin) {
        const pinHash = typeof cur.pin_hash === 'string' ? String(cur.pin_hash) : '';
        const pinSalt = typeof cur.pin_salt === 'string' ? String(cur.pin_salt) : '';
        const pinIters = typeof cur.pin_iters === 'number' ? Number(cur.pin_iters) : 120000;
        if (pinHash && pinSalt) {
          const actual = pbkdf2B64(String(currentPin || ''), pinSalt, pinIters);
          if (!currentPin || actual !== pinHash) return json(res, 401, { error: 'invalid_credentials' });
        } else {
          const expectedPin = typeof cur.pin === 'string' && cur.pin ? String(cur.pin) : String(cur.password || '');
          if (String(currentPin || '') !== expectedPin) return json(res, 401, { error: 'invalid_credentials' });
        }
      }

      const next = { ...cur };
      if (newPassword) next.password = newPassword;
      if (newPin) {
        const pinSalt = randSaltB64();
        const pinIters = 120000;
        const pinHash = pbkdf2B64(newPin, pinSalt, pinIters);
        next.pin_hash = pinHash;
        next.pin_salt = pinSalt;
        next.pin_iters = pinIters;
      }

      tdb.staff[idx] = next;
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'staff_updated',
        payload: { staffId: next.id, by: 'Waiter' },
        at: nowIso(),
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true });
    }

    // Waiter: history (branch-scoped)
    if (url.pathname === '/api/waiter/history' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const status = (url.searchParams.get('status') || '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
      const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || '10') || 10));

      const tdb = loadTenantDb(ctx.tenantId);
      const orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const scoped = orders.filter((o) => o && typeof o === 'object' && o.branchId === branchId);
      const filtered = scoped
        .filter((o) => {
          if (!status) return true;
          return String(o.status || '') === status;
        })
        .filter((o) => {
          if (!q) return true;
          const number = String(o.number || '').toLowerCase();
          const table = String(o.tableName || '').toLowerCase();
          return number.includes(q) || table.includes(q);
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);
      return json(res, 200, { ok: true, orders: items, page, pageSize, total, branchId });
    }

    if (url.pathname === '/api/waiter/shift-report' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      if (isDemoMode(db, ctx)) db = seedDemoShiftLogsIfEmpty(db);

      const tdb = loadTenantDb(ctx.tenantId);

      const staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      const roleById = new Map((Array.isArray(tdb.roles) ? tdb.roles : []).map((r) => [String(r.id || ''), r]));
      const branchStaff = staff.filter((s) => String(s.branchId || '') === branchId);
      const staffById = new Map(branchStaff.map((s) => [String(s.id || ''), s]));

      const localShiftLogs = Array.isArray(tdb.shiftLogs) ? tdb.shiftLogs : [];
      const globalShiftLogs = Array.isArray(db.shiftLogs) ? db.shiftLogs : [];
      const mergedShiftLogs = localShiftLogs.length > 0 ? localShiftLogs : globalShiftLogs;

      const shiftLogs = mergedShiftLogs
        .filter((l) => l && typeof l === 'object')
        .filter((l) => staffById.has(String(l.staffId || '')))
        .map((l) => {
          const sid = String(l.staffId || '');
          const s = staffById.get(sid);
          const rn = s ? (roleById.get(String(s.roleId || ''))?.name || '') : '';
          return {
            id: String(l.id || ''),
            staffId: sid,
            staffName: s ? String(s.name || '') : sid,
            roleName: rn,
            clockInAt: String(l.clockInAt || ''),
            clockOutAt: l.clockOutAt ? String(l.clockOutAt) : undefined,
          };
        })
        .filter((l) => l.id && l.staffId && l.clockInAt);

      return json(res, 200, { ok: true, branchId, staffId: String(ctx.staffId || ''), shiftLogs });
    }

    // Inventory module (hosted-compatible): GET/POST/PUT /api/inventory/items
    if (url.pathname === '/api/inventory/items' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner' || ctx.role === 'Super Admin') {
          const qp = String(url.searchParams.get('branchId') || '').trim();
          if (qp) return qp;
          return Object.keys(tdb.branches || {})[0] || '';
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      if (isDemoMode(db, ctx)) db = seedDemoInventoryIfEmpty(db);

      tdb.inventoryItems = Array.isArray(tdb.inventoryItems) ? tdb.inventoryItems : [];

      // If we have no explicit inventory items, best-effort initialize from the latest inventory_snapshot event.
      if (tdb.inventoryItems.length === 0) {
        const latestSnap = tdb.events
          .filter((e) => e && typeof e === 'object' && String(e.type || '') === 'inventory_snapshot' && String(e.branchId || '') === branchId)
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];

        const snapItems = Array.isArray(latestSnap?.payload?.items) ? latestSnap.payload.items : [];
        if (snapItems.length > 0) {
          const now = nowIso();
          tdb.inventoryItems = snapItems
            .map((it) => ({
              id: String(it.sku || it.id || ''),
              name: String(it.name || ''),
              category: String(it.category || ''),
              stock: Number(it.qty ?? it.stock ?? 0) || 0,
              unit: String(it.unit || ''),
              minStock: Number(it.minQty ?? it.minStock ?? 0) || 0,
              price: Number(it.cost ?? it.price ?? 0) || 0,
              updatedAt: now,
            }))
            .filter((x) => x.id && x.name);
        }
      }

      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const category = String(url.searchParams.get('category') || '').trim();
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || '200') || 200));

      const items = (tdb.inventoryItems || [])
        .filter((x) => x && typeof x === 'object')
        .filter((x) => (category ? String(x.category || '') === category : true))
        .filter((x) => (q ? String(x.name || '').toLowerCase().includes(q) || String(x.id || '').toLowerCase().includes(q) : true))
        .slice(0, limit)
        .map((x) => {
          const stock = Number(x.stock || 0) || 0;
          const minStock = Number(x.minStock || 0) || 0;
          const status = stock <= 0 ? 'Critical' : stock < minStock ? 'Low Stock' : 'In Stock';
          return {
            id: String(x.id),
            name: String(x.name || ''),
            category: String(x.category || ''),
            stock,
            unit: String(x.unit || ''),
            minStock,
            price: Number(x.price || 0) || 0,
            status,
            branchId: null,
            updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : null,
          };
        });

      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, branchId, items });
    }

    if (url.pathname === '/api/inventory/items' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.inventoryItems = Array.isArray(tdb.inventoryItems) ? tdb.inventoryItems : [];

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const id = String(body.id || '').trim();
      const name = String(body.name || '').trim();
      if (!id) return json(res, 400, { error: 'id_required' });
      if (!name) return json(res, 400, { error: 'name_required' });
      if (tdb.inventoryItems.some((x) => x && typeof x === 'object' && String(x.id) === id)) return json(res, 409, { error: 'id_in_use' });

      const stock = Number(body.stock ?? 0);
      const minStock = Number(body.minStock ?? 0);
      const price = Number(body.price ?? 0);
      if (![stock, minStock, price].every((n) => Number.isFinite(n) && n >= 0)) return json(res, 400, { error: 'invalid_numbers' });

      const rec = {
        id,
        name,
        category: String(body.category || '').trim(),
        stock,
        unit: String(body.unit || '').trim(),
        minStock,
        price,
        updatedAt: nowIso(),
      };
      tdb.inventoryItems.unshift(rec);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 201, { ok: true, id });
    }

    const invMatch = /^\/api\/inventory\/items\/([^/]+)$/.exec(url.pathname);
    if (invMatch && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner', 'Super Admin'])) return;

      const id = decodeURIComponent(invMatch[1] || '');
      if (!id) return json(res, 400, { error: 'id_required' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.inventoryItems = Array.isArray(tdb.inventoryItems) ? tdb.inventoryItems : [];
      const idx = tdb.inventoryItems.findIndex((x) => x && typeof x === 'object' && String(x.id) === String(id));
      if (idx < 0) return json(res, 404, { error: 'not_found' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const stock = body.stock != null ? Number(body.stock) : undefined;
      const minStock = body.minStock != null ? Number(body.minStock) : undefined;
      const price = body.price != null ? Number(body.price) : undefined;
      if ([stock, minStock, price].some((n) => n != null && (!Number.isFinite(n) || n < 0))) return json(res, 400, { error: 'invalid_numbers' });

      const cur = tdb.inventoryItems[idx];
      const next = {
        ...cur,
        name: typeof body.name === 'string' ? body.name.trim() : cur.name,
        category: typeof body.category === 'string' ? body.category.trim() : cur.category,
        unit: typeof body.unit === 'string' ? body.unit.trim() : cur.unit,
        stock: stock != null ? stock : cur.stock,
        minStock: minStock != null ? minStock : cur.minStock,
        price: price != null ? price : cur.price,
        updatedAt: nowIso(),
      };
      tdb.inventoryItems[idx] = next;
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true });
    }

    // Staff shift tracking (tenant + branch scoped)
    if (url.pathname === '/api/staff/shifts' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const action = typeof body.action === 'string' ? body.action.trim() : '';
      const staffId = typeof body.staffId === 'string' ? body.staffId.trim() : '';
      if (!staffId) return json(res, 400, { error: 'staff_id_required' });
      if (action !== 'clock_in' && action !== 'clock_out') return json(res, 400, { error: 'invalid_action' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.shiftLogs = Array.isArray(tdb.shiftLogs) ? tdb.shiftLogs : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner') {
          const bp = typeof body.branchId === 'string' ? body.branchId.trim() : '';
          if (bp) return bp;
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      const s = tdb.staff.find((x) => x && typeof x === 'object' && String(x.id || '') === staffId);
      if (!s) return json(res, 404, { error: 'staff_not_found' });
      if (String(s.branchId || '') !== branchId) return json(res, 403, { error: 'forbidden' });

      const at = nowIso();
      if (action === 'clock_in') {
        const alreadyOpen = tdb.shiftLogs.some((l) => l && typeof l === 'object' && String(l.staffId || '') === staffId && !l.clockOutAt);
        if (alreadyOpen) return json(res, 409, { error: 'shift_already_open' });
        const rec = { id: `shift_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`, staffId, clockInAt: at };
        tdb.shiftLogs.unshift(rec);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId,
          type: 'shift_clock_in',
          payload: { staffId },
          at,
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, { ok: true, branchId, log: rec });
      }

      const idx = tdb.shiftLogs.findIndex((l) => l && typeof l === 'object' && String(l.staffId || '') === staffId && !l.clockOutAt);
      if (idx < 0) return json(res, 409, { error: 'no_open_shift' });
      const cur = tdb.shiftLogs[idx];
      const next = { ...cur, clockOutAt: at };
      tdb.shiftLogs[idx] = next;
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'shift_clock_out',
        payload: { staffId },
        at,
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, branchId, log: next });
    }

    if (url.pathname === '/api/manager/reports' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner') {
          const qp = String(url.searchParams.get('branchId') || '').trim();
          if (qp) return qp;
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      if (isDemoMode(db, ctx)) db = seedDemoShiftLogsIfEmpty(db);

      const staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      const roleById = new Map((Array.isArray(tdb.roles) ? tdb.roles : []).map((r) => [String(r.id || ''), r]));
      const branchStaff = staff.filter((s) => String(s.branchId || '') === branchId);

      const staffItems = branchStaff.map((s) => ({
        id: String(s.id || ''),
        name: String(s.name || ''),
        role: roleById.get(String(s.roleId || ''))?.name || '',
        phone: String(s.phone || ''),
        status: s.status === 'On Leave' ? 'On Leave' : 'Active',
        shift: String(s.shift || ''),
        avatar: String(s.avatar || ''),
      }));

      const staffById = new Map(branchStaff.map((s) => [String(s.id || ''), s]));
      const localShiftLogs = Array.isArray(tdb.shiftLogs) ? tdb.shiftLogs : [];
      const globalShiftLogs = Array.isArray(db.shiftLogs) ? db.shiftLogs : [];
      const mergedShiftLogs = localShiftLogs.length > 0 ? localShiftLogs : globalShiftLogs;

      const shiftLogs = mergedShiftLogs
        .filter((l) => l && typeof l === 'object')
        .filter((l) => staffById.has(String(l.staffId || '')))
        .map((l) => ({
          id: String(l.id || ''),
          staffId: String(l.staffId || ''),
          clockInAt: String(l.clockInAt || ''),
          clockOutAt: l.clockOutAt ? String(l.clockOutAt) : undefined,
        }))
        .filter((l) => l.id && l.staffId && l.clockInAt);

      return json(res, 200, { ok: true, branchId, staff: staffItems, shiftLogs, cashSessions: [], expenses: [] });
    }

    // Manager overview (hosted-compatible): GET /api/manager/overview
    if (url.pathname === '/api/manager/overview' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const range = String(url.searchParams.get('range') || 'Daily');
      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.shiftLogs = Array.isArray(tdb.shiftLogs) ? tdb.shiftLogs : [];
      tdb.orders = Array.isArray(tdb.orders) ? tdb.orders : [];

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        const qp = String(url.searchParams.get('branchId') || '').trim();
        if (qp) return qp;
        return Object.keys(tdb.branches || {})[0] || '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      if (isDemoMode(db, ctx)) db = seedDemoShiftLogsIfEmpty(db);

      const now = new Date();
      const yyyyMmDd = (d) => {
        const x = new Date(d);
        if (Number.isNaN(x.getTime())) return '';
        x.setHours(0, 0, 0, 0);
        return x.toISOString().slice(0, 10);
      };

      const orders = tdb.orders.filter((o) => o && typeof o === 'object' && String(o.branchId || '') === branchId);
      const paid = orders.filter((o) => String(o.status || '') === 'Paid');
      const paidToday = paid.filter((o) => {
        const paidAt = o.paidAt || o.paid_at || (o.payload && o.payload.paidAt);
        return paidAt ? yyyyMmDd(paidAt) === yyyyMmDd(now) : false;
      });

      const salesToday = paidToday.reduce((sum, o) => sum + (Number(o.total || 0) || 0), 0);
      const openOrders = orders.filter((o) => String(o.status || '') !== 'Paid').length;
      const avgTicketToday = paidToday.length > 0 ? salesToday / paidToday.length : 0;

      const staffOnShift = tdb.shiftLogs.filter((l) => l && typeof l === 'object' && !l.clockOutAt && String(l.branchId || '') === branchId).length;

      const bucketKey = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        if (range === 'Monthly') return d.toISOString().slice(0, 7);
        if (range === 'Weekly') {
          const x = new Date(d);
          x.setHours(0, 0, 0, 0);
          const day = (x.getUTCDay() + 6) % 7;
          x.setUTCDate(x.getUTCDate() - day);
          return x.toISOString().slice(0, 10);
        }
        return d.toISOString().slice(0, 10);
      };

      const trendMap = new Map();
      for (const o of paid) {
        const at = o.paidAt || o.paid_at || (o.payload && o.payload.paidAt) || o.createdAt || '';
        const k = bucketKey(at);
        if (!k) continue;
        const cur = trendMap.get(k) || { key: k, revenue: 0, orders: 0 };
        cur.revenue += Number(o.total || 0) || 0;
        cur.orders += 1;
        trendMap.set(k, cur);
      }
      const trend = Array.from(trendMap.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));

      const recentPaid = paid
        .slice()
        .sort((a, b) => String(b.paidAt || b.paid_at || '').localeCompare(String(a.paidAt || a.paid_at || '')))
        .slice(0, 10)
        .map((o) => ({ id: String(o.id || ''), total: Number(o.total || 0) || 0, paidAt: o.paidAt ? String(o.paidAt) : o.paid_at ? String(o.paid_at) : null }));

      return json(res, 200, { ok: true, branchId, range, from: '', to: '', kpis: { salesToday, openOrders, staffOnShift, avgTicketToday }, trend, recentPaid });
    }

    const waiterOrderMatch = /^\/api\/waiter\/orders\/([^/]+)$/.exec(url.pathname);
    if (waiterOrderMatch && method === 'GET') {
      const orderId = waiterOrderMatch[1];
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Waiter'])) return;

      const branchId = String(ctx.branchId || '');
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });

      const tdb = loadTenantDb(ctx.tenantId);
      const orders = Array.isArray(tdb.orders) ? tdb.orders : [];
      const order = orders.find((o) => o && typeof o === 'object' && String(o.id) === String(orderId) && o.branchId === branchId);
      if (!order) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { ok: true, order });
    }

    // Owner API
    if (url.pathname === '/api/owner/overview' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const branchId = url.searchParams.get('branchId');
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcOverview(tdb, { branchId }));
      }
      return json(res, 200, calcOverview(db, { branchId }));
    }

    if (url.pathname === '/api/owner/finance' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const granularity = url.searchParams.get('granularity') || 'monthly';
        const period = url.searchParams.get('period') || '';
        const q = url.searchParams.get('q') || '';
        const category = url.searchParams.get('category') || '';
        const sort = url.searchParams.get('sort') || 'newest';
        const page = url.searchParams.get('page') || '1';
        const pageSize = url.searchParams.get('pageSize') || '10';
        return json(
          res,
          200,
          calcOwnerFinance(tdb, {
            granularity,
            period,
            q,
            category,
            sort,
            page,
            pageSize,
          }),
        );
      }

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoExpensesIfEmpty(db);
      }
      saveDb(db);

      const granularity = url.searchParams.get('granularity') || 'monthly';
      const period = url.searchParams.get('period') || '';
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || '';
      const sort = url.searchParams.get('sort') || 'newest';
      const page = url.searchParams.get('page') || '1';
      const pageSize = url.searchParams.get('pageSize') || '10';

      return json(
        res,
        200,
        calcOwnerFinance(db, {
          granularity,
          period,
          q,
          category,
          sort,
          page,
          pageSize,
        }),
      );
    }

    if (url.pathname === '/api/owner/reports' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const branchId = url.searchParams.get('branchId');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcReports(tdb, { branchId, from, to }));
      }
      return json(res, 200, calcReports(db, { branchId, from, to }));
    }

    if (url.pathname === '/api/owner/reports/schedule-email' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const frequency = typeof body.frequency === 'string' ? body.frequency.trim() : 'weekly';
      const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
      const from = typeof body.from === 'string' ? body.from.trim() : '';
      const to = typeof body.to === 'string' ? body.to.trim() : '';
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'invalid_email' });
      const freqOk = new Set(['daily', 'weekly', 'monthly']);
      if (!freqOk.has(frequency)) return json(res, 400, { error: 'invalid_frequency' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        if (branchId && !tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });
        tdb.reportEmailSchedules = Array.isArray(tdb.reportEmailSchedules) ? tdb.reportEmailSchedules : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        const rec = {
          id: `sched_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          email,
          frequency,
          branchId,
          from,
          to,
          createdAt: nowIso(),
        };
        tdb.reportEmailSchedules.push(rec);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: branchId || 'global',
          type: 'report_email_scheduled',
          payload: { scheduleId: rec.id, email, frequency, branchId, from, to },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, { ok: true, schedule: rec });
      }

      if (isDemoMode(db, ctx)) db = seedDemoBranchesIfEmpty(db);
      if (branchId && !db.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      db.reportEmailSchedules = Array.isArray(db.reportEmailSchedules) ? db.reportEmailSchedules : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      const rec = {
        id: `sched_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        email,
        frequency,
        branchId,
        from,
        to,
        createdAt: nowIso(),
      };
      db.reportEmailSchedules.push(rec);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: branchId || 'global',
        type: 'report_email_scheduled',
        payload: { scheduleId: rec.id, email, frequency, branchId, from, to },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, schedule: rec });
    }

    if (url.pathname === '/api/owner/inventory' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const branchId = url.searchParams.get('branchId');
      const category = url.searchParams.get('category');
      const q = url.searchParams.get('q');
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcOwnerInventory(tdb, { branchId, category, q }));
      }
      if (isDemoMode(db, ctx)) db = seedDemoBranchesIfEmpty(db);
      saveDb(db);
      return json(res, 200, calcOwnerInventory(db, { branchId, category, q }));
    }

    if (url.pathname === '/api/owner/menu/products' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || '';
      const status = url.searchParams.get('status') || '';
      const page = url.searchParams.get('page') || '1';
      const pageSize = url.searchParams.get('pageSize') || '10';
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcOwnerMenuProducts(tdb, { q, category, status, page, pageSize }));
      }
      if (isDemoMode(db, ctx)) db = seedDemoProductsIfEmpty(db);
      saveDb(db);
      return json(res, 200, calcOwnerMenuProducts(db, { q, category, status, page, pageSize }));
    }

    if (url.pathname === '/api/owner/menu/kpis' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || '';
      const status = url.searchParams.get('status') || '';
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcOwnerMenuKpis(tdb, { q, category, status }));
      }
      if (isDemoMode(db, ctx)) db = seedDemoProductsIfEmpty(db);
      saveDb(db);
      return json(res, 200, calcOwnerMenuKpis(db, { q, category, status }));
    }

    if (url.pathname === '/api/owner/settings' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const settings = tdb.ownerSettings && typeof tdb.ownerSettings === 'object' ? tdb.ownerSettings : defaultOwnerSettings();
        if (!tdb.ownerSettings) {
          tdb.ownerSettings = settings;
          saveTenantDb(ctx.tenantId, tdb);
        }
        return json(res, 200, { ok: true, settings });
      }
      const settings = db.ownerSettings && typeof db.ownerSettings === 'object' ? db.ownerSettings : defaultOwnerSettings();
      if (!db.ownerSettings) {
        db.ownerSettings = settings;
        saveDb(db);
      }
      return json(res, 200, { ok: true, settings });
    }

    if (url.pathname === '/api/owner/settings' && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];
        const prev = tdb.ownerSettings && typeof tdb.ownerSettings === 'object' ? tdb.ownerSettings : defaultOwnerSettings();
        const next = normalizeOwnerSettings(body.settings || body, prev);
        tdb.ownerSettings = next;
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'owner_settings_updated',
          payload: { keys: Object.keys(next || {}) },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, { ok: true, settings: next });
      }

      db.events = Array.isArray(db.events) ? db.events : [];
      const prev = db.ownerSettings && typeof db.ownerSettings === 'object' ? db.ownerSettings : defaultOwnerSettings();
      const next = normalizeOwnerSettings(body.settings || body, prev);
      db.ownerSettings = next;
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'owner_settings_updated',
        payload: { keys: Object.keys(next || {}) },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, settings: next });
    }

    if (url.pathname === '/api/owner/subscription' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;

      db = normalizeTenants(db);
      const tenantId = String(ctx.tenantId || 'tenant_global');
      const t = Array.isArray(db.tenants) ? db.tenants.find((x) => x && String(x.id || '') === tenantId) : null;
      if (!t) return json(res, 404, { error: 'tenant_not_found' });

      const sub = getTenantSubscription(db, tenantId);
      const billing = t.billing && typeof t.billing === 'object' ? t.billing : {};
      const pendingTier = (t.subscription && typeof t.subscription === 'object' && typeof t.subscription.pendingTier === 'string') ? t.subscription.pendingTier : '';
      const pendingCycle = (t.subscription && typeof t.subscription === 'object' && typeof t.subscription.pendingCycle === 'string') ? t.subscription.pendingCycle : '';
      return json(res, 200, {
        ok: true,
        tenantId,
        subscription: { ...sub, pendingTier, pendingCycle },
        billing: {
          cycle: String(billing.cycle || 'Monthly'),
          status: String(billing.status || 'Active'),
          method: String(billing.method || 'Cash'),
          nextBillAt: typeof billing.nextBillAt === 'string' ? billing.nextBillAt : '',
          amountEtb: typeof billing.amountEtb === 'number' && Number.isFinite(billing.amountEtb) ? billing.amountEtb : 0,
          graceEndsAt: typeof billing.graceEndsAt === 'string' ? billing.graceEndsAt : '',
        },
      });
    }

    if (url.pathname === '/api/owner/subscription' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const allowedTiers = new Set(['Trial', 'Basic', 'Pro', 'Enterprise']);
      const allowedCycles = new Set(['Monthly', 'Yearly']);
      const tier = typeof body.tier === 'string' ? body.tier.trim() : '';
      const cycle = typeof body.cycle === 'string' ? body.cycle.trim() : '';
      if (tier && !allowedTiers.has(tier)) return json(res, 400, { error: 'invalid_tier' });
      if (cycle && !allowedCycles.has(cycle)) return json(res, 400, { error: 'invalid_cycle' });

      db = normalizeTenants(db);
      const tenantId = String(ctx.tenantId || 'tenant_global');
      const idx = Array.isArray(db.tenants) ? db.tenants.findIndex((x) => x && String(x.id || '') === tenantId) : -1;
      if (idx < 0) return json(res, 404, { error: 'tenant_not_found' });

      const t = db.tenants[idx];
      const prevSub = (t.subscription && typeof t.subscription === 'object') ? t.subscription : {};
      const prevBilling = (t.billing && typeof t.billing === 'object') ? t.billing : {};

      const nextTier = tier || String(prevSub.tier || getSubscription(db).tier || 'Enterprise');
      const nextCycle = cycle || String(prevBilling.cycle || 'Monthly');

      const now = Date.now();
      const nowAt = nowIso();

      const addMonths = (iso, months) => {
        const base = iso ? new Date(iso) : new Date();
        const d = new Date(Number.isNaN(base.getTime()) ? Date.now() : base.getTime());
        const day = d.getDate();
        d.setMonth(d.getMonth() + months);
        if (d.getDate() < day) d.setDate(0);
        return d.toISOString();
      };

      const stepMonths = nextCycle === 'Yearly' ? 12 : 1;
      const base =
        (typeof prevSub.trialEndsAt === 'string' && prevSub.trialEndsAt) ? prevSub.trialEndsAt :
        (typeof prevBilling.nextBillAt === 'string' && prevBilling.nextBillAt) ? prevBilling.nextBillAt :
        nowAt;

      const nextBillAt = addMonths(base, stepMonths);

      const amountEtb = planAmountEtb(nextTier, nextCycle);

      const requestedIsFree = canOwnerAutoActivateTier(nextTier);
      const invoiceId = `inv_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const dueAt = nowIso();
      const next = {
        ...t,
        subscription: {
          ...prevSub,
          tier: requestedIsFree ? nextTier : String(prevSub.tier || 'Trial'),
          pendingTier: requestedIsFree ? '' : nextTier,
          pendingCycle: requestedIsFree ? '' : nextCycle,
          enabledModules: undefined,
        },
        billing: {
          ...prevBilling,
          cycle: requestedIsFree ? nextCycle : String(prevBilling.cycle || 'Monthly'),
          nextBillAt: requestedIsFree ? nextBillAt : String(prevBilling.nextBillAt || ''),
          amountEtb: requestedIsFree ? amountEtb : amountEtb,
          status: requestedIsFree ? 'Active' : 'Verification Needed',
          graceEndsAt: requestedIsFree ? '' : String(prevBilling.graceEndsAt || ''),
          method: String(prevBilling.method || 'Cash'),
        },
        updatedAt: nowAt,
      };

      db.tenants[idx] = next;
      db.events = Array.isArray(db.events) ? db.events : [];
      db.invoices = Array.isArray(db.invoices) ? db.invoices : [];

      if (!requestedIsFree && amountEtb > 0) {
        db.invoices.push({
          id: invoiceId,
          tenantId,
          amountEtb,
          currency: 'ETB',
          dueAt,
          method: String(next.billing.method || 'Cash'),
          status: 'Open',
          notes: `Upgrade request: ${String(prevSub.tier || 'Trial')} -> ${nextTier} (${nextCycle})`,
          createdAt: nowAt,
        });
        db.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'billing_invoice_created',
          payload: { tenantId, invoiceId, amountEtb },
          at: nowAt,
        });
      }
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'owner_subscription_updated',
        payload: { tenantId, tier: nextTier, cycle: nextCycle, status: String(next.billing.status || '') },
        at: nowAt,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);

      return json(res, 200, {
        ok: true,
        tenantId,
        subscription: {
          ...getTenantSubscription(db, tenantId),
          pendingTier: typeof next.subscription?.pendingTier === 'string' ? next.subscription.pendingTier : '',
          pendingCycle: typeof next.subscription?.pendingCycle === 'string' ? next.subscription.pendingCycle : '',
        },
        billing: {
          cycle: String(next.billing.cycle || 'Monthly'),
          status: String(next.billing.status || 'Active'),
          method: String(next.billing.method || 'Cash'),
          nextBillAt: typeof next.billing.nextBillAt === 'string' ? next.billing.nextBillAt : '',
          amountEtb: typeof next.billing.amountEtb === 'number' && Number.isFinite(next.billing.amountEtb) ? next.billing.amountEtb : 0,
          graceEndsAt: typeof next.billing.graceEndsAt === 'string' ? next.billing.graceEndsAt : '',
        },
        invoiceId: !requestedIsFree && amountEtb > 0 ? invoiceId : '',
      });
    }

    if (url.pathname === '/api/owner/menu/products' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        tdb.products = Array.isArray(tdb.products) ? tdb.products : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return json(res, 400, { error: 'name_required' });
        const code =
          typeof body.code === 'string' && body.code.trim()
            ? body.code.trim()
            : `PRD-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
        const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Uncategorized';
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) return json(res, 400, { error: 'invalid_price' });
        const cost = Number(body.cost);
        const status = body.status === 'Inactive' ? 'Inactive' : 'Active';

        const prod = {
          id: `prd_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          code,
          name,
          category,
          price,
          cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
          status,
          image: typeof body.image === 'string' ? body.image.trim() : '',
          description: typeof body.description === 'string' ? body.description.trim() : '',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        tdb.products.push(prod);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'product_created',
          payload: { productId: prod.id },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, { ok: true, product: prod });
      }

      if (isDemoMode(db, ctx)) db = seedDemoProductsIfEmpty(db);

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return json(res, 400, { error: 'name_required' });
      const code =
        typeof body.code === 'string' && body.code.trim()
          ? body.code.trim()
          : `PRD-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Uncategorized';
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) return json(res, 400, { error: 'invalid_price' });
      const cost = Number(body.cost);
      const status = body.status === 'Inactive' ? 'Inactive' : 'Active';

      const prod = {
        id: `prd_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        code,
        name,
        category,
        price,
        cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
        status,
        image: typeof body.image === 'string' ? body.image.trim() : '',
        description: typeof body.description === 'string' ? body.description.trim() : '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.products.push(prod);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'product_created',
        payload: { productId: prod.id },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, product: prod });
    }

    if (url.pathname === '/api/owner/menu/products/bulk' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter(Boolean) : [];
        if (ids.length === 0) return json(res, 400, { error: 'ids_required' });
        const action = typeof body.action === 'string' ? body.action : '';
        tdb.products = Array.isArray(tdb.products) ? tdb.products : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        const byId = new Map(tdb.products.map((p) => [p.id, p]));
        const updatedIds = [];
        const now = nowIso();

        const applyPct = (base, pct) => {
          const b = Number(base) || 0;
          const p = Number(pct) || 0;
          const next = b * (1 + p / 100);
          return Number(next.toFixed(2));
        };

        for (const id of ids) {
          const cur = byId.get(id);
          if (!cur) continue;
          const next = { ...cur };

          if (action === 'set_status') {
            if (body.status !== 'Active' && body.status !== 'Inactive') return json(res, 400, { error: 'invalid_status' });
            next.status = body.status;
          } else if (action === 'set_price') {
            const p = Number(body.price);
            if (!Number.isFinite(p) || p < 0) return json(res, 400, { error: 'invalid_price' });
            next.price = p;
          } else if (action === 'set_cost') {
            const c = Number(body.cost);
            if (!Number.isFinite(c) || c < 0) return json(res, 400, { error: 'invalid_cost' });
            next.cost = c;
          } else if (action === 'adjust_price_pct') {
            const pct = Number(body.pct);
            if (!Number.isFinite(pct) || pct < -90 || pct > 500) return json(res, 400, { error: 'invalid_pct' });
            next.price = applyPct(next.price, pct);
          } else if (action === 'adjust_cost_pct') {
            const pct = Number(body.pct);
            if (!Number.isFinite(pct) || pct < -90 || pct > 500) return json(res, 400, { error: 'invalid_pct' });
            next.cost = applyPct(next.cost, pct);
          } else {
            return json(res, 400, { error: 'invalid_action' });
          }

          next.updatedAt = now;
          byId.set(id, next);
          updatedIds.push(id);
        }

        if (updatedIds.length === 0) return json(res, 404, { error: 'no_products_updated' });
        tdb.products = tdb.products.map((p) => byId.get(p.id) || p);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'product_bulk_updated',
          payload: { ids: updatedIds, action },
          at: now,
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, { ok: true, updated: updatedIds.length, ids: updatedIds });
      }

      const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter(Boolean) : [];
      if (ids.length === 0) return json(res, 400, { error: 'ids_required' });
      const action = typeof body.action === 'string' ? body.action : '';
      db.products = Array.isArray(db.products) ? db.products : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      const byId = new Map(db.products.map((p) => [p.id, p]));
      const updatedIds = [];
      const now = nowIso();

      const applyPct = (base, pct) => {
        const b = Number(base) || 0;
        const p = Number(pct) || 0;
        const next = b * (1 + p / 100);
        return Number(next.toFixed(2));
      };

      for (const id of ids) {
        const cur = byId.get(id);
        if (!cur) continue;
        const next = { ...cur };

        if (action === 'set_status') {
          if (body.status !== 'Active' && body.status !== 'Inactive') return json(res, 400, { error: 'invalid_status' });
          next.status = body.status;
        } else if (action === 'set_price') {
          const p = Number(body.price);
          if (!Number.isFinite(p) || p < 0) return json(res, 400, { error: 'invalid_price' });
          next.price = p;
        } else if (action === 'set_cost') {
          const c = Number(body.cost);
          if (!Number.isFinite(c) || c < 0) return json(res, 400, { error: 'invalid_cost' });
          next.cost = c;
        } else if (action === 'adjust_price_pct') {
          const pct = Number(body.pct);
          if (!Number.isFinite(pct) || pct < -90 || pct > 500) return json(res, 400, { error: 'invalid_pct' });
          next.price = applyPct(next.price, pct);
        } else if (action === 'adjust_cost_pct') {
          const pct = Number(body.pct);
          if (!Number.isFinite(pct) || pct < -90 || pct > 500) return json(res, 400, { error: 'invalid_pct' });
          next.cost = applyPct(next.cost, pct);
        } else {
          return json(res, 400, { error: 'invalid_action' });
        }

        next.updatedAt = now;
        byId.set(id, next);
        updatedIds.push(id);
      }

      if (updatedIds.length === 0) return json(res, 404, { error: 'no_products_updated' });
      db.products = db.products.map((p) => byId.get(p.id) || p);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'product_bulk_updated',
        payload: { ids: updatedIds, action },
        at: now,
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, updated: updatedIds.length, ids: updatedIds });
    }

    const ownerMenuProductIdMatch = /^\/api\/owner\/menu\/products\/([^/]+)$/.exec(url.pathname);
    if (ownerMenuProductIdMatch && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const id = ownerMenuProductIdMatch[1];
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        tdb.products = Array.isArray(tdb.products) ? tdb.products : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];
        const idx = tdb.products.findIndex((p) => p.id === id);
        if (idx < 0) return json(res, 404, { error: 'product_not_found' });

        const cur = tdb.products[idx];
        const next = { ...cur };
        if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
        if (typeof body.code === 'string' && body.code.trim()) next.code = body.code.trim();
        if (typeof body.category === 'string' && body.category.trim()) next.category = body.category.trim();
        if (typeof body.description === 'string') next.description = body.description.trim();
        if (typeof body.image === 'string') next.image = body.image.trim();
        if (body.status === 'Active' || body.status === 'Inactive') next.status = body.status;
        if (body.price != null) {
          const p = Number(body.price);
          if (!Number.isFinite(p) || p < 0) return json(res, 400, { error: 'invalid_price' });
          next.price = p;
        }
        if (body.cost != null) {
          const c = Number(body.cost);
          if (!Number.isFinite(c) || c < 0) return json(res, 400, { error: 'invalid_cost' });
          next.cost = c;
        }
        next.updatedAt = nowIso();
        tdb.products[idx] = next;
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'product_updated',
          payload: { productId: next.id },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, { ok: true, product: next });
      }

      db.products = Array.isArray(db.products) ? db.products : [];
      db.events = Array.isArray(db.events) ? db.events : [];
      const idx = db.products.findIndex((p) => p.id === id);
      if (idx < 0) return json(res, 404, { error: 'product_not_found' });

      const cur = db.products[idx];
      const next = { ...cur };
      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
      if (typeof body.code === 'string' && body.code.trim()) next.code = body.code.trim();
      if (typeof body.category === 'string' && body.category.trim()) next.category = body.category.trim();
      if (typeof body.description === 'string') next.description = body.description.trim();
      if (typeof body.image === 'string') next.image = body.image.trim();
      if (body.status === 'Active' || body.status === 'Inactive') next.status = body.status;
      if (body.price != null) {
        const p = Number(body.price);
        if (!Number.isFinite(p) || p < 0) return json(res, 400, { error: 'invalid_price' });
        next.price = p;
      }
      if (body.cost != null) {
        const c = Number(body.cost);
        if (!Number.isFinite(c) || c < 0) return json(res, 400, { error: 'invalid_cost' });
        next.cost = c;
      }
      next.updatedAt = nowIso();
      db.products[idx] = next;
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'product_updated',
        payload: { productId: next.id },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, product: next });
    }

    if (url.pathname === '/api/owner/staff' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const q = url.searchParams.get('q') || '';
      const roleId = url.searchParams.get('roleId') || '';
      const status = url.searchParams.get('status') || '';
      const branchId = url.searchParams.get('branchId') || '';
      const page = url.searchParams.get('page') || '1';
      const pageSize = url.searchParams.get('pageSize') || '10';
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        return json(res, 200, calcOwnerStaff(tdb, { q, roleId, status, branchId, page, pageSize }));
      }
      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      saveDb(db);
      return json(res, 200, calcOwnerStaff(db, { q, roleId, status, branchId, page, pageSize }));
    }

    if (url.pathname === '/api/owner/staff' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = normalizeEmail(body.email);
        const passwordInput = typeof body.password === 'string' ? body.password : '';
        const pinInput = typeof body.pin === 'string' ? body.pin : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
        const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
        const code = typeof body.code === 'string' ? body.code.trim() : '';

        if (!name) return json(res, 400, { error: 'name_required' });
        const roleName = roleNameFromRoleId(tdb, roleId || (tdb.roles[0]?.id || ''));
        const isWaiter = roleName === 'Waiter';
        if (!isWaiter) {
          if (!email) return json(res, 400, { error: 'email_required_for_login' });
          if (!emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
        } else {
          if (email && !emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
        }
        if (passwordInput && passwordInput.length < 4) return json(res, 400, { error: 'password_too_short' });

        tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
        tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
        tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        if (branchId && !tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });
        if (roleId && !tdb.roles.find((r) => r.id === roleId)) return json(res, 404, { error: 'role_not_found' });

        if (email && tdb.staff.some((s) => normalizeEmail(s.email) === email)) return json(res, 409, { error: 'email_in_use' });
        if (code && tdb.staff.some((s) => String(s.code || '').toLowerCase() === code.toLowerCase())) return json(res, 409, { error: 'code_in_use' });

        const id = staffId();
        const tempPassword = passwordInput || generateTempPassword();
        const tempPin = isWaiter ? (pinInput && pinInput.length >= 3 ? pinInput : generatePin()) : '';
        const pinSalt = isWaiter ? randSaltB64() : '';
        const pinIters = 120000;
        const pinHash = isWaiter ? pbkdf2B64(tempPin, pinSalt, pinIters) : '';
        const rec = {
          id,
          code: code || id,
          name,
          email,
          password: tempPassword,
          pin_hash: pinHash,
          pin_salt: pinSalt,
          pin_iters: isWaiter ? pinIters : undefined,
          phone,
          roleId: roleId || (tdb.roles[0]?.id || ''),
          branchId: branchId || Object.keys(tdb.branches || {})[0] || '',
          status: body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active',
          lastLoginAt: '',
          createdAt: nowIso(),
        };
        tdb.staff.push(rec);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: rec.branchId || 'global',
          type: 'staff_created',
          payload: { staffId: rec.id, name: rec.name, roleId: rec.roleId },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, { ok: true, staff: rec, tempPassword, tempPin });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const passwordInput = typeof body.password === 'string' ? body.password : '';
      const pinInput = typeof body.pin === 'string' ? body.pin : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
      const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';

      if (!name) return json(res, 400, { error: 'name_required' });
      const roleName = roleNameFromRoleId(db, roleId || (db.roles[0]?.id || ''));
      const isWaiter = roleName === 'Waiter';
      if (!isWaiter) {
        if (!email) return json(res, 400, { error: 'email_required_for_login' });
        if (!emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
      } else {
        if (email && !emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
      }
      if (passwordInput && passwordInput.length < 4) return json(res, 400, { error: 'password_too_short' });

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      if (!Array.isArray(db.staff)) db.staff = [];
      if (!Array.isArray(db.roles)) db.roles = [];
      if (!Array.isArray(db.events)) db.events = [];

      if (branchId && !db.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });
      if (roleId && !db.roles.find((r) => r.id === roleId)) return json(res, 404, { error: 'role_not_found' });

      if (email && db.staff.some((s) => normalizeEmail(s.email) === email)) return json(res, 409, { error: 'email_in_use' });
      if (code && db.staff.some((s) => String(s.code || '').toLowerCase() === code.toLowerCase())) return json(res, 409, { error: 'code_in_use' });

      const id = staffId();
      const tempPassword = passwordInput || generateTempPassword();
      const tempPin = isWaiter ? (pinInput && pinInput.length >= 3 ? pinInput : generatePin()) : '';
      const pinSalt = isWaiter ? randSaltB64() : '';
      const pinIters = 120000;
      const pinHash = isWaiter ? pbkdf2B64(tempPin, pinSalt, pinIters) : '';
      const rec = {
        id,
        code: code || id,
        name,
        email,
        password: tempPassword,
        pin_hash: pinHash,
        pin_salt: pinSalt,
        pin_iters: isWaiter ? pinIters : undefined,
        phone,
        roleId: roleId || (db.roles[0]?.id || ''),
        branchId: branchId || Object.keys(db.branches || {})[0] || '',
        status: body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active',
        lastLoginAt: '',
        createdAt: nowIso(),
      };
      db.staff.push(rec);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: rec.branchId || 'global',
        type: 'staff_created',
        payload: { staffId: rec.id, name: rec.name, roleId: rec.roleId },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, staff: rec, tempPassword, tempPin });
    }

    if (url.pathname.startsWith('/api/owner/staff/') && method === 'PUT') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;

      const id = decodeURIComponent(url.pathname.split('/').pop() || '');
      if (!id) return json(res, 400, { error: 'staff_id_required' });

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const applyPatch = (store) => {
        store.staff = Array.isArray(store.staff) ? store.staff : [];
        store.roles = Array.isArray(store.roles) ? store.roles : [];
        store.events = Array.isArray(store.events) ? store.events : [];
        store.branches = store.branches && typeof store.branches === 'object' ? store.branches : {};

        const idx = store.staff.findIndex((s) => s && String(s.id || '') === String(id));
        if (idx < 0) return { error: 'staff_not_found', status: 404 };

        const prev = store.staff[idx];
        const next = { ...prev };

        if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();

        if (typeof body.email === 'string') {
          const email = normalizeEmail(body.email);
          if (email && !emailLooksOk(email)) return { error: 'invalid_email', status: 400 };
          if (email && store.staff.some((s) => s && s.id !== id && normalizeEmail(s.email) === email)) return { error: 'email_in_use', status: 409 };
          next.email = email;
        }

        if (typeof body.phone === 'string') next.phone = body.phone.trim();

        if (typeof body.code === 'string') {
          const code = body.code.trim();
          if (code && store.staff.some((s) => s && s.id !== id && String(s.code || '').toLowerCase() === code.toLowerCase())) return { error: 'code_in_use', status: 409 };
          next.code = code || next.code;
        }

        if (typeof body.roleId === 'string' && body.roleId.trim()) {
          const roleId = body.roleId.trim();
          if (!store.roles.find((r) => String(r.id || '') === roleId)) return { error: 'role_not_found', status: 404 };
          next.roleId = roleId;
        }

        const roleName = roleNameFromRoleId(store, next.roleId);
        const isWaiter = roleName === 'Waiter';

        if (isWaiter) {
          const pinInput = typeof body.pin === 'string' ? body.pin : '';
          const resetPin = body.resetPin === true;
          if (resetPin || (pinInput && pinInput.length >= 3)) {
            const tempPin = resetPin ? generatePin() : pinInput;
            const pinSalt = randSaltB64();
            const pinIters = 120000;
            const pinHash = pbkdf2B64(tempPin, pinSalt, pinIters);
            next.pin_hash = pinHash;
            next.pin_salt = pinSalt;
            next.pin_iters = pinIters;
            next._tempPin = tempPin;
          }
        }

        if (typeof body.branchId === 'string') {
          const branchId = body.branchId.trim();
          if (branchId) {
            if (!store.branches?.[branchId]) return { error: 'branch_not_found', status: 404 };
            next.branchId = branchId;
          }
        }

        if (body.status === 'Active' || body.status === 'On Leave' || body.status === 'Suspended') next.status = body.status;

        next.updatedAt = nowIso();
        store.staff[idx] = next;
        store.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: String(next.branchId || 'global'),
          type: 'staff_updated',
          payload: { staffId: String(next.id || id) },
          at: nowIso(),
        });
        if (store.events.length > 5000) store.events = store.events.slice(-5000);
        const tempPin = typeof next._tempPin === 'string' ? next._tempPin : '';
        if (tempPin) delete next._tempPin;
        return { ok: true, staff: next, tempPin };
      };

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const out = applyPatch(tdb);
        if ((out && out.error) || (out && out.status)) return json(res, out.status || 400, { error: out.error || 'invalid' });
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, out);
      }

      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      const out = applyPatch(db);
      if ((out && out.error) || (out && out.status)) return json(res, out.status || 400, { error: out.error || 'invalid' });
      saveDb(db);
      return json(res, 200, out);
    }

    if (url.pathname === '/api/owner/invites' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;

      db.invites = Array.isArray(db.invites) ? db.invites : [];
      const items = db.invites
        .filter((x) => x && String(x.tenantId || '') === String(ctx.tenantId || ''))
        .slice()
        .sort((a, b) => (String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1))
        .slice(0, 50)
        .map((x) => ({
          id: String(x.id || ''),
          code: String(x.code || ''),
          roleName: String(x.roleName || ''),
          branchId: String(x.branchId || ''),
          createdAt: String(x.createdAt || ''),
          expiresAt: String(x.expiresAt || ''),
          usedAt: String(x.usedAt || ''),
          usedByEmail: String(x.usedByEmail || ''),
        }));
      saveDb(db);
      return json(res, 200, { ok: true, invites: items });
    }

    if (url.pathname === '/api/owner/invites' && method === 'POST') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner'])) return;

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const roleName = typeof body.roleName === 'string' ? body.roleName.trim() : '';
      const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
      const days = Math.max(1, Math.min(14, Number(body.expiresInDays || 7)));
      const allowed = new Set(['Branch Manager', 'Waiter']);
      if (!allowed.has(roleName)) return json(res, 400, { error: 'invalid_role' });

      const tdb = loadTenantDb(ctx.tenantId);
      const hasBranch = branchId ? Boolean(tdb?.branches && tdb.branches[branchId]) : true;
      if (!hasBranch) return json(res, 404, { error: 'branch_not_found' });

      db.invites = Array.isArray(db.invites) ? db.invites : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      const code = `inv_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const now = Date.now();
      const expiresAt = new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
      const rec = {
        id: uid(),
        code,
        tenantId: String(ctx.tenantId || ''),
        roleName,
        branchId: branchId || '',
        createdAt: nowIso(),
        createdByStaffId: String(ctx.staffId || ''),
        expiresAt,
        usedAt: '',
        usedByEmail: '',
        usedByStaffId: '',
      };
      db.invites.push(rec);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'invite_created',
        payload: { tenantId: String(ctx.tenantId || ''), inviteId: rec.id, roleName, branchId: rec.branchId },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, invite: { id: rec.id, code: rec.code, roleName: rec.roleName, branchId: rec.branchId, createdAt: rec.createdAt, expiresAt: rec.expiresAt } });
    }

    // Branch Manager staff/team endpoints (branch-scoped)
    if (url.pathname === '/api/manager/staff' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const tdb = loadTenantDb(ctx.tenantId);

      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const status = (url.searchParams.get('status') || '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize') || 10)));

      const roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      const roleById = new Map(roles.map((r) => [r.id, r]));
      const staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      const branchId = String(ctx.branchId || '');

      const filtered = staff
        .filter((s) => String(s.branchId || '') === branchId)
        .filter((s) => (status ? String(s.status || '') === status : true))
        .filter((s) => {
          if (!q) return true;
          return (
            String(s.name || '').toLowerCase().includes(q) ||
            String(s.email || '').toLowerCase().includes(q) ||
            String(s.code || '').toLowerCase().includes(q)
          );
        })
        .sort((a, b) => (String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((s) => ({
        id: s.id,
        code: s.code || '',
        name: s.name || '',
        email: s.email || '',
        phone: s.phone || '',
        roleId: s.roleId || '',
        roleName: roleById.get(s.roleId)?.name || '',
        branchId: s.branchId || '',
        status: s.status || 'Active',
        lastLoginAt: s.lastLoginAt || '',
        createdAt: s.createdAt || '',
      }));

      return json(res, 200, { staff: items, page, pageSize, total, branchId });
    }

    if (url.pathname === '/api/manager/staff' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const passwordInput = typeof body.password === 'string' ? body.password : '';
      const pinInput = typeof body.pin === 'string' ? body.pin : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!name) return json(res, 400, { error: 'name_required' });
      if (email && !emailLooksOk(email)) return json(res, 400, { error: 'invalid_email' });
      if (passwordInput && passwordInput.length < 4) return json(res, 400, { error: 'password_too_short' });
      if (!email) return json(res, 400, { error: 'email_required_for_login' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const branchId = String(ctx.branchId || '');
      if (!branchId || !tdb.branches?.[branchId]) return json(res, 400, { error: 'invalid_branch' });

      if (email && tdb.staff.some((s) => normalizeEmail(s.email) === email)) return json(res, 409, { error: 'email_in_use' });
      if (code && tdb.staff.some((s) => String(s.code || '').toLowerCase() === code.toLowerCase())) return json(res, 409, { error: 'code_in_use' });

      const waiterRole = tdb.roles.find((r) => String(r.name || '').toLowerCase() === 'waiter');
      const roleId = waiterRole?.id || tdb.roles[0]?.id || '';
      const isWaiter = roleNameFromRoleId(tdb, roleId) === 'Waiter';

      const id = staffId();
      const tempPassword = passwordInput || generateTempPassword();
      const tempPin = isWaiter ? (pinInput && pinInput.length >= 3 ? pinInput : generatePin()) : '';
      const pinSalt = isWaiter ? randSaltB64() : '';
      const pinIters = 120000;
      const pinHash = isWaiter ? pbkdf2B64(tempPin, pinSalt, pinIters) : '';
      const rec = {
        id,
        code: code || id,
        name,
        email,
        password: tempPassword,
        pin_hash: pinHash,
        pin_salt: pinSalt,
        pin_iters: isWaiter ? pinIters : undefined,
        phone,
        roleId,
        branchId,
        status: body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active',
        lastLoginAt: '',
        createdAt: nowIso(),
      };
      tdb.staff.push(rec);
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'staff_created',
        payload: { staffId: rec.id, name: rec.name, roleId: rec.roleId, by: 'Branch Manager' },
        at: nowIso(),
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 201, { ok: true, staff: rec, tempPassword, tempPin: isWaiter ? tempPin : '' });
    }

    const managerStaffIdMatch = /^\/api\/manager\/staff\/([^/]+)$/.exec(url.pathname);
    if (managerStaffIdMatch && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;
      const staffIdParam = managerStaffIdMatch[1];
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const tdb = loadTenantDb(ctx.tenantId);
      tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
      tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
      tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

      const idx = tdb.staff.findIndex((s) => s.id === staffIdParam);
      if (idx < 0) return json(res, 404, { error: 'staff_not_found' });

      const cur = tdb.staff[idx];
      const branchId = String(ctx.branchId || '');
      if (String(cur.branchId || '') !== branchId) return json(res, 403, { error: 'forbidden' });

      // Role changes blocked for managers
      if (typeof body.roleId === 'string' && body.roleId.trim() && body.roleId.trim() !== String(cur.roleId || '')) {
        return json(res, 403, { error: 'role_change_not_allowed' });
      }
      if (typeof body.branchId === 'string' && body.branchId.trim() && body.branchId.trim() !== String(cur.branchId || '')) {
        return json(res, 403, { error: 'branch_change_not_allowed' });
      }

      const next = { ...cur };
      if (typeof body.name === 'string') next.name = body.name.trim() || next.name;
      if (typeof body.phone === 'string') next.phone = body.phone.trim();
      if (typeof body.code === 'string') {
        const c = body.code.trim();
        if (c && tdb.staff.some((s) => s.id !== staffIdParam && String(s.code || '').toLowerCase() === c.toLowerCase())) return json(res, 409, { error: 'code_in_use' });
        if (c) next.code = c;
      }
      if (typeof body.email === 'string') {
        const em = normalizeEmail(body.email);
        if (em && !emailLooksOk(em)) return json(res, 400, { error: 'invalid_email' });
        if (em && tdb.staff.some((s) => s.id !== staffIdParam && normalizeEmail(s.email) === em)) return json(res, 409, { error: 'email_in_use' });
        next.email = em;
      }
      if (typeof body.status === 'string') {
        next.status = body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active';
      }

      const roleName = roleNameFromRoleId(tdb, next.roleId);
      const isWaiter = roleName === 'Waiter';
      let tempPin = '';
      if (isWaiter) {
        const pinInput = typeof body.pin === 'string' ? body.pin : '';
        const resetPin = body.resetPin === true;
        if (resetPin || (pinInput && pinInput.length >= 3)) {
          tempPin = resetPin ? generatePin() : pinInput;
          const pinSalt = randSaltB64();
          const pinIters = 120000;
          const pinHash = pbkdf2B64(tempPin, pinSalt, pinIters);
          next.pin_hash = pinHash;
          next.pin_salt = pinSalt;
          next.pin_iters = pinIters;
        }
      }

      tdb.staff[idx] = next;
      tdb.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: 'staff_updated',
        payload: { staffId: next.id, by: 'Branch Manager' },
        at: nowIso(),
      });
      if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
      saveTenantDb(ctx.tenantId, tdb);
      return json(res, 200, { ok: true, staff: next, tempPin });
    }

    if (url.pathname === '/api/manager/staff/activity' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Branch Manager', 'Cafe Owner'])) return;

      const type = url.searchParams.get('type') || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize') || 10)));
      const tdb = loadTenantDb(ctx.tenantId);
      tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};

      const branchId = (() => {
        const b = String(ctx.branchId || '');
        if (b && b !== 'global') return b;
        if (ctx.role === 'Cafe Owner') {
          const qp = String(url.searchParams.get('branchId') || '').trim();
          if (qp) return qp;
        }
        return '';
      })();
      if (!branchId || branchId === 'global') return json(res, 400, { error: 'branch_required' });
      if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      const allowed = new Set(['staff_created', 'staff_updated']);
      const events = Array.isArray(tdb.events) ? tdb.events.filter((e) => allowed.has(e.type) && String(e.branchId || '') === branchId) : [];
      const filtered = events
        .filter((e) => (type ? e.type === type : true))
        .filter((e) => {
          if (!q) return true;
          return JSON.stringify(e.payload || {}).toLowerCase().includes(q) || String(e.type || '').toLowerCase().includes(q);
        })
        .sort((a, b) => (new Date(a.at).getTime() < new Date(b.at).getTime() ? 1 : -1));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((e) => ({
        id: e.id,
        type: e.type,
        branchId: e.branchId || '',
        at: e.at,
        payload: e.payload || {},
      }));

      return json(res, 200, { events: items, page, pageSize, total, branchId });
    }

    if (url.pathname === '/api/owner/roles' && method === 'GET') {
      let db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const roles = Array.isArray(tdb.roles) ? tdb.roles : [];
        return json(res, 200, {
          roles: roles.map((r) => ({
            id: r.id,
            name: r.name,
            scope: r.scope === 'global' ? 'global' : 'branch',
            permissions: Array.isArray(r.permissions) ? r.permissions : [],
            createdAt: r.createdAt || '',
          })),
        });
      }
      if (isDemoMode(db, ctx)) {
        db = seedDemoBranchesIfEmpty(db);
        db = seedDemoStaffIfEmpty(db);
      }
      saveDb(db);
      const roles = Array.isArray(db.roles) ? db.roles : [];
      return json(res, 200, {
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope === 'global' ? 'global' : 'branch',
          permissions: Array.isArray(r.permissions) ? r.permissions : [],
          createdAt: r.createdAt || '',
        })),
      });
    }

    if (url.pathname === '/api/owner/roles' && method === 'POST') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const scope = body.scope === 'global' ? 'global' : 'branch';
        const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()) : [];
        if (!name) return json(res, 400, { error: 'name_required' });

        tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        if (tdb.roles.some((r) => String(r.name || '').toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'role_name_in_use' });

        const id = `role_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
        const role = { id, name, scope, permissions, createdAt: nowIso() };
        tdb.roles.push(role);
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: 'global',
          type: 'role_created',
          payload: { roleId: role.id, name: role.name, scope: role.scope, permissions: role.permissions },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, { ok: true, role });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const scope = body.scope === 'global' ? 'global' : 'branch';
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()) : [];
      if (!name) return json(res, 400, { error: 'name_required' });

      db.roles = Array.isArray(db.roles) ? db.roles : [];
      db.staff = Array.isArray(db.staff) ? db.staff : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      if (db.roles.some((r) => String(r.name || '').toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'role_name_in_use' });

      const id = `role_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      const role = { id, name, scope, permissions, createdAt: nowIso() };
      db.roles.push(role);
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: 'global',
        type: 'role_created',
        payload: { roleId: role.id, name: role.name, scope: role.scope, permissions: role.permissions },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, role });
    }

    const ownerStaffIdMatch = /^\/api\/owner\/staff\/([^/]+)$/.exec(url.pathname);
    if (ownerStaffIdMatch && method === 'PUT') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const staffIdParam = ownerStaffIdMatch[1];
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        tdb.roles = Array.isArray(tdb.roles) ? tdb.roles : [];
        tdb.staff = Array.isArray(tdb.staff) ? tdb.staff : [];
        tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
        tdb.events = Array.isArray(tdb.events) ? tdb.events : [];

        const idx = tdb.staff.findIndex((s) => s.id === staffIdParam);
        if (idx < 0) return json(res, 404, { error: 'staff_not_found' });

        const cur = tdb.staff[idx];
        const next = { ...cur };

        if (typeof body.name === 'string') next.name = body.name.trim() || next.name;
        if (typeof body.phone === 'string') next.phone = body.phone.trim();
        if (typeof body.code === 'string') {
          const c = body.code.trim();
          if (c && tdb.staff.some((s) => s.id !== staffIdParam && String(s.code || '').toLowerCase() === c.toLowerCase())) return json(res, 409, { error: 'code_in_use' });
          if (c) next.code = c;
        }
        if (typeof body.email === 'string') {
          const em = normalizeEmail(body.email);
          if (em && !emailLooksOk(em)) return json(res, 400, { error: 'invalid_email' });
          if (em && tdb.staff.some((s) => s.id !== staffIdParam && normalizeEmail(s.email) === em)) return json(res, 409, { error: 'email_in_use' });
          next.email = em;
        }
        if (typeof body.roleId === 'string') {
          const rid = body.roleId.trim();
          if (rid && !tdb.roles.find((r) => r.id === rid)) return json(res, 404, { error: 'role_not_found' });
          if (rid) next.roleId = rid;
        }
        if (typeof body.branchId === 'string') {
          const bid = body.branchId.trim();
          if (bid && !tdb.branches?.[bid]) return json(res, 404, { error: 'branch_not_found' });
          if (bid) next.branchId = bid;
        }
        if (typeof body.status === 'string') {
          next.status = body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active';
        }

        tdb.staff[idx] = next;
        tdb.events.push({
          id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
          branchId: next.branchId || 'global',
          type: 'staff_updated',
          payload: { staffId: next.id },
          at: nowIso(),
        });
        if (tdb.events.length > 5000) tdb.events = tdb.events.slice(-5000);
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, { ok: true, staff: next });
      }

      db.roles = Array.isArray(db.roles) ? db.roles : [];
      db.staff = Array.isArray(db.staff) ? db.staff : [];
      db.events = Array.isArray(db.events) ? db.events : [];

      const idx = db.staff.findIndex((s) => s.id === staffIdParam);
      if (idx < 0) return json(res, 404, { error: 'staff_not_found' });

      const cur = db.staff[idx];
      const next = { ...cur };

      if (typeof body.name === 'string') next.name = body.name.trim() || next.name;
      if (typeof body.phone === 'string') next.phone = body.phone.trim();
      if (typeof body.code === 'string') {
        const c = body.code.trim();
        if (c && db.staff.some((s) => s.id !== staffIdParam && String(s.code || '').toLowerCase() === c.toLowerCase())) return json(res, 409, { error: 'code_in_use' });
        if (c) next.code = c;
      }
      if (typeof body.email === 'string') {
        const em = normalizeEmail(body.email);
        if (em && !emailLooksOk(em)) return json(res, 400, { error: 'invalid_email' });
        if (em && db.staff.some((s) => s.id !== staffIdParam && normalizeEmail(s.email) === em)) return json(res, 409, { error: 'email_in_use' });
        next.email = em;
      }
      if (typeof body.roleId === 'string') {
        const rid = body.roleId.trim();
        if (rid && !db.roles.find((r) => r.id === rid)) return json(res, 404, { error: 'role_not_found' });
        if (rid) next.roleId = rid;
      }
      if (typeof body.branchId === 'string') {
        const bid = body.branchId.trim();
        if (bid && !db.branches?.[bid]) return json(res, 404, { error: 'branch_not_found' });
        if (bid) next.branchId = bid;
      }
      if (typeof body.status === 'string') {
        next.status = body.status === 'On Leave' || body.status === 'Suspended' ? body.status : 'Active';
      }

      db.staff[idx] = next;
      db.events.push({
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId: next.branchId || 'global',
        type: 'staff_updated',
        payload: { staffId: next.id },
        at: nowIso(),
      });
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 200, { ok: true, staff: next });
    }

    if (url.pathname === '/api/owner/staff/activity' && method === 'GET') {
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      const type = url.searchParams.get('type') || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize') || 10)));

      if (ctx.role !== 'Super Admin') {
        const tdb = loadTenantDb(ctx.tenantId);
        const allowed = new Set(['staff_created', 'staff_updated', 'role_created', 'role_updated', 'role_deleted']);
        const events = Array.isArray(tdb.events) ? tdb.events.filter((e) => allowed.has(e.type)) : [];
        const filtered = events
          .filter((e) => (type ? e.type === type : true))
          .filter((e) => {
            if (!q) return true;
            return JSON.stringify(e.payload || {}).toLowerCase().includes(q) || String(e.type || '').toLowerCase().includes(q);
          })
          .sort((a, b) => (new Date(a.at).getTime() < new Date(b.at).getTime() ? 1 : -1));

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const items = filtered.slice(start, start + pageSize).map((e) => ({
          id: e.id,
          type: e.type,
          branchId: e.branchId || '',
          at: e.at,
          payload: e.payload || {},
        }));

        return json(res, 200, { events: items, page, pageSize, total });
      }

      const allowed = new Set(['staff_created', 'staff_updated', 'role_created', 'role_updated', 'role_deleted']);
      const events = Array.isArray(db.events) ? db.events.filter((e) => allowed.has(e.type)) : [];
      const filtered = events
        .filter((e) => (type ? e.type === type : true))
        .filter((e) => {
          if (!q) return true;
          return JSON.stringify(e.payload || {}).toLowerCase().includes(q) || String(e.type || '').toLowerCase().includes(q);
        })
        .sort((a, b) => (new Date(a.at).getTime() < new Date(b.at).getTime() ? 1 : -1));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize).map((e) => ({
        id: e.id,
        type: e.type,
        branchId: e.branchId || '',
        at: e.at,
        payload: e.payload || {},
      }));

      return json(res, 200, { events: items, page, pageSize, total });
    }

    // Branch registration
    if (url.pathname === '/api/branches/register' && method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.name !== 'string') return json(res, 400, { error: 'invalid_body' });

      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;

      if (ctx.role !== 'Super Admin') {
        const sub = getTenantSubscription(db, ctx.tenantId);
        const limit = branchLimitForTier(sub.tier);
        const tdb = loadTenantDb(ctx.tenantId);
        const current = Object.keys(tdb.branches || {}).length;
        if (!sub.modules.includes('branches')) return json(res, 403, { error: 'subscription_required', requiredModule: 'branches' });
        if (current >= limit) return json(res, 403, { error: 'branch_limit_reached', limit, current });

        const id = uid();
        const allowedStatus = body.status === 'Closed' || body.status === 'Maintenance' ? body.status : 'Open';
        tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};
        tdb.branches[id] = {
          id,
          name: body.name.trim() || 'Branch',
          managerName: typeof body.managerName === 'string' ? body.managerName.trim() : '',
          city: typeof body.city === 'string' ? body.city.trim() : '',
          region: typeof body.region === 'string' ? body.region.trim() : typeof body.city === 'string' ? body.city.trim() : '',
          address: typeof body.address === 'string' ? body.address.trim() : '',
          phone: typeof body.phone === 'string' ? body.phone.trim() : '',
          staffCount: typeof body.staffCount === 'number' ? body.staffCount : 0,
          status: allowedStatus,
          rating: typeof body.rating === 'number' ? body.rating : 4.6,
          createdAt: nowIso(),
        };
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 201, tdb.branches[id]);
      }

      const id = uid();
      const allowedStatus = body.status === 'Closed' || body.status === 'Maintenance' ? body.status : 'Open';
      db.branches[id] = {
        id,
        name: body.name.trim() || 'Branch',
        managerName: typeof body.managerName === 'string' ? body.managerName.trim() : '',
        city: typeof body.city === 'string' ? body.city.trim() : '',
        region: typeof body.region === 'string' ? body.region.trim() : typeof body.city === 'string' ? body.city.trim() : '',
        address: typeof body.address === 'string' ? body.address.trim() : '',
        phone: typeof body.phone === 'string' ? body.phone.trim() : '',
        staffCount: typeof body.staffCount === 'number' ? body.staffCount : 0,
        status: allowedStatus,
        rating: typeof body.rating === 'number' ? body.rating : 4.6,
        createdAt: nowIso(),
      };
      saveDb(db);
      return json(res, 201, db.branches[id]);
    }

    // Branch management: update/delete
    const branchIdMatch = /^\/api\/branches\/([^/]+)$/.exec(url.pathname);
    if (branchIdMatch && (method === 'PUT' || method === 'DELETE')) {
      const branchId = branchIdMatch[1];
      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;

      if (ctx.role !== 'Super Admin') {
        const sub = getTenantSubscription(db, ctx.tenantId);
        if (!sub.modules.includes('branches')) return json(res, 403, { error: 'subscription_required', requiredModule: 'branches' });
        const tdb = loadTenantDb(ctx.tenantId);
        tdb.branches = tdb.branches && typeof tdb.branches === 'object' ? tdb.branches : {};

        if (!tdb.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

        if (method === 'DELETE') {
          delete tdb.branches[branchId];
          saveTenantDb(ctx.tenantId, tdb);
          return json(res, 200, { ok: true });
        }

        const body = await readBody(req);
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

        const cur = tdb.branches[branchId];
        const next = { ...cur };
        if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
        if (typeof body.managerName === 'string') next.managerName = body.managerName.trim();
        if (typeof body.city === 'string') next.city = body.city.trim();
        if (typeof body.region === 'string') next.region = body.region.trim();
        if (typeof body.address === 'string') next.address = body.address.trim();
        if (typeof body.phone === 'string') next.phone = body.phone.trim();
        if (typeof body.staffCount === 'number') next.staffCount = body.staffCount;
        if (typeof body.rating === 'number') next.rating = body.rating;
        if (typeof body.status === 'string') next.status = body.status;
        tdb.branches[branchId] = next;
        saveTenantDb(ctx.tenantId, tdb);
        return json(res, 200, next);
      }
      if (!db.branches?.[branchId]) return json(res, 404, { error: 'branch_not_found' });

      if (method === 'DELETE') {
        delete db.branches[branchId];
        if (Array.isArray(db.events)) db.events = db.events.filter((e) => e.branchId !== branchId);
        saveDb(db);
        return json(res, 200, { ok: true });
      }

      const body = await readBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_body' });

      const cur = db.branches[branchId];
      const next = { ...cur };

      if (typeof body.name === 'string') next.name = body.name.trim() || next.name;
      if (typeof body.managerName === 'string') next.managerName = body.managerName.trim();
      if (typeof body.city === 'string') next.city = body.city.trim();
      if (typeof body.region === 'string') next.region = body.region.trim();
      if (typeof body.address === 'string') next.address = body.address.trim();
      if (typeof body.phone === 'string') next.phone = body.phone.trim();
      if (typeof body.staffCount === 'number') next.staffCount = body.staffCount;
      if (typeof body.rating === 'number') next.rating = body.rating;
      if (typeof body.status === 'string') {
        next.status = body.status === 'Closed' || body.status === 'Maintenance' ? body.status : 'Open';
      }

      db.branches[branchId] = next;
      saveDb(db);
      return json(res, 200, next);
    }

    // Branch events
    const branchEventsMatch = /^\/api\/branches\/([^/]+)\/events$/.exec(url.pathname);
    if (branchEventsMatch && method === 'POST') {
      const branchId = branchEventsMatch[1];
      const body = await readBody(req);
      if (!body || typeof body.type !== 'string') return json(res, 400, { error: 'invalid_body' });

      const db = loadDb();
      const ctx = requireSession(req, res, db);
      if (!ctx) return;
      if (!requireRole(res, ctx, ['Cafe Owner', 'Super Admin'])) return;
      if (!db.branches[branchId]) return json(res, 404, { error: 'branch_not_found' });

      const evt = {
        id: `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        branchId,
        type: body.type,
        payload: body.payload || {},
        at: nowIso(),
      };
      db.events.push(evt);
      // cap events
      if (db.events.length > 5000) db.events = db.events.slice(-5000);
      saveDb(db);
      return json(res, 201, { ok: true, eventId: evt.id });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    try {
      console.error('[mirachpos-api] unhandled error', {
        url: req.url,
        method: req.method,
        message: e && typeof e === 'object' && 'message' in e ? e.message : String(e),
        stack: e && typeof e === 'object' && 'stack' in e ? e.stack : undefined,
      });
    } catch {
      // ignore logging errors
    }
    return json(res, 500, { error: 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[mirachpos-api] listening on http://localhost:${PORT}`);
});
