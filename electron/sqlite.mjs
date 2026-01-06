import path from 'path';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);

const pbkdf2Hash = (password, saltBase64, iterations) => {
  const salt = Buffer.from(String(saltBase64 || ''), 'base64');
  const iters = Number.isFinite(Number(iterations)) ? Number(iterations) : 120000;
  const derived = crypto.pbkdf2Sync(String(password || ''), salt, iters, 32, 'sha256');
  return derived.toString('base64');
};

const randomSalt = () => crypto.randomBytes(16).toString('base64');

export const openKvDb = (dbDir) => {
  const dbPath = path.join(dbDir, 'mirachpos.sqlite3');

  let Database = null;
  try {
    Database = require('better-sqlite3');
  } catch {
    Database = null;
  }

  if (!Database) {
    const mem = new Map();
    const memStaff = new Map();
    const memStaffCode = new Map();
    const memSession = new Map();
    return {
      path: dbPath,
      get: (key) => (mem.has(String(key || '')) ? mem.get(String(key || '')) : null),
      set: (key, value) => {
        mem.set(String(key || ''), value);
        return true;
      },

      cacheStaffCredentials: (args) => {
        const ws = String(args?.workspace || '').trim() || 'default';
        const email = String(args?.email || '').trim().toLowerCase();
        const role = String(args?.role || '').trim();
        const tenantId = String(args?.tenantId || '').trim();
        const branchId = String(args?.branchId || '').trim();
        const staffId = String(args?.staffId || '').trim();
        const staffName = String(args?.staffName || '').trim();
        const password = String(args?.password || '');
        if (!email || !role || !tenantId || !branchId || !staffId || !password) return { ok: false };
        const salt = randomSalt();
        const iters = 120000;
        const hash = pbkdf2Hash(password, salt, iters);
        memStaff.set(`${ws}|${email}|${role}`, {
          workspace: ws,
          email,
          role,
          tenant_id: tenantId,
          branch_id: branchId,
          staff_id: staffId,
          staff_name: staffName,
          password_salt: salt,
          password_hash: hash,
          password_iters: iters,
        });
        return { ok: true };
      },

      offlineLogin: (args) => {
        const ws = String(args?.workspace || '').trim() || 'default';
        const email = String(args?.email || '').trim().toLowerCase();
        const role = String(args?.role || '').trim();
        const password = String(args?.password || '');
        if (!email || !role || !password) return { ok: false, error: 'invalid_credentials' };
        const row = memStaff.get(`${ws}|${email}|${role}`);
        if (!row) return { ok: false, error: 'offline_login_not_seeded' };
        const actual = pbkdf2Hash(password, row.password_salt, row.password_iters);
        if (actual !== row.password_hash) return { ok: false, error: 'invalid_credentials' };
        const session = {
          token: 'offline',
          role: row.role,
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          staffId: row.staff_id,
          offline: true,
        };
        memSession.set('last_session', session);
        return { ok: true, session };
      },

      cacheStaffCodeCredentials: (args) => {
        const ws = String(args?.workspace || '').trim() || 'default';
        const staffCode = String(args?.staffCode || '').trim().toLowerCase();
        const role = String(args?.role || '').trim();
        const tenantId = String(args?.tenantId || '').trim();
        const branchId = String(args?.branchId || '').trim();
        const staffId = String(args?.staffId || '').trim();
        const staffName = String(args?.staffName || '').trim();
        const pin = String(args?.pin || '');
        if (!staffCode || !role || !tenantId || !branchId || !staffId || !pin) return { ok: false };
        const salt = randomSalt();
        const iters = 120000;
        const hash = pbkdf2Hash(pin, salt, iters);
        memStaffCode.set(`${ws}|${staffCode}|${role}`, {
          workspace: ws,
          staff_code: staffCode,
          role,
          tenant_id: tenantId,
          branch_id: branchId,
          staff_id: staffId,
          staff_name: staffName,
          pin_salt: salt,
          pin_hash: hash,
          pin_iters: iters,
        });
        return { ok: true };
      },

      offlineLoginByCode: (args) => {
        const ws = String(args?.workspace || '').trim() || 'default';
        const staffCode = String(args?.staffCode || '').trim().toLowerCase();
        const role = String(args?.role || '').trim();
        const pin = String(args?.pin || '');
        if (!staffCode || !role || !pin) return { ok: false, error: 'invalid_credentials' };
        const row = memStaffCode.get(`${ws}|${staffCode}|${role}`);
        if (!row) return { ok: false, error: 'offline_login_not_seeded' };
        const actual = pbkdf2Hash(pin, row.pin_salt, row.pin_iters);
        if (actual !== row.pin_hash) return { ok: false, error: 'invalid_credentials' };
        const session = {
          token: 'offline',
          role: row.role,
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          staffId: row.staff_id,
          offline: true,
        };
        memSession.set('last_session', session);
        return { ok: true, session };
      },

      getLastSession: () => (memSession.has('last_session') ? memSession.get('last_session') : null),
    };
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_staff (
      workspace TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_iters INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace, email, role)
    );

    CREATE TABLE IF NOT EXISTS auth_session (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_staff_code (
      workspace TEXT NOT NULL,
      staff_code TEXT NOT NULL,
      role TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_iters INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace, staff_code, role)
    );

    CREATE TABLE IF NOT EXISTS pos_state (
      scope_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_scope_next ON sync_outbox (scope_key, next_attempt_at);
  `);

  const stmtGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const stmtSet = db.prepare(
    'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );

  const stmtSessionGet = db.prepare('SELECT value FROM auth_session WHERE key = ?');
  const stmtSessionSet = db.prepare(
    'INSERT INTO auth_session (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );

  const stmtStaffUpsert = db.prepare(
    `INSERT INTO auth_staff (
        workspace, email, role, tenant_id, branch_id, staff_id, staff_name,
        password_salt, password_hash, password_iters, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace, email, role) DO UPDATE SET
        tenant_id=excluded.tenant_id,
        branch_id=excluded.branch_id,
        staff_id=excluded.staff_id,
        staff_name=excluded.staff_name,
        password_salt=excluded.password_salt,
        password_hash=excluded.password_hash,
        password_iters=excluded.password_iters,
        updated_at=excluded.updated_at`,
  );

  const stmtStaffGet = db.prepare(
    'SELECT workspace,email,role,tenant_id,branch_id,staff_id,staff_name,password_salt,password_hash,password_iters FROM auth_staff WHERE workspace=? AND email=? AND role=?',
  );

  const stmtStaffCodeUpsert = db.prepare(
    `INSERT INTO auth_staff_code (
        workspace, staff_code, role, tenant_id, branch_id, staff_id, staff_name,
        pin_salt, pin_hash, pin_iters, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace, staff_code, role) DO UPDATE SET
        tenant_id=excluded.tenant_id,
        branch_id=excluded.branch_id,
        staff_id=excluded.staff_id,
        staff_name=excluded.staff_name,
        pin_salt=excluded.pin_salt,
        pin_hash=excluded.pin_hash,
        pin_iters=excluded.pin_iters,
        updated_at=excluded.updated_at`,
  );

  const stmtStaffCodeGet = db.prepare(
    'SELECT workspace,staff_code,role,tenant_id,branch_id,staff_id,staff_name,pin_salt,pin_hash,pin_iters FROM auth_staff_code WHERE workspace=? AND staff_code=? AND role=?',
  );

  const stmtPosGet = db.prepare('SELECT value FROM pos_state WHERE scope_key = ?');
  const stmtPosSet = db.prepare(
    'INSERT INTO pos_state (scope_key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );

  const stmtOutboxInsert = db.prepare(
    `INSERT INTO sync_outbox (id, scope_key, kind, payload, created_at, attempts, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const stmtOutboxList = db.prepare(
    'SELECT id, scope_key, kind, payload, created_at, attempts, next_attempt_at FROM sync_outbox WHERE scope_key = ? AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?',
  );
  const stmtOutboxDeleteMany = db.prepare('DELETE FROM sync_outbox WHERE id = ?');
  const stmtOutboxBump = db.prepare('UPDATE sync_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?');

  return {
    path: dbPath,
    get: (key) => {
      const k = String(key || '');
      if (!k) return null;
      const row = stmtGet.get(k);
      if (!row || typeof row.value !== 'string') return null;
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      const k = String(key || '');
      if (!k) return false;
      const now = new Date().toISOString();
      const payload = JSON.stringify(value ?? null);
      stmtSet.run(k, payload, now);
      return true;
    },

    cacheStaffCredentials: (args) => {
      const ws = String(args?.workspace || '').trim() || 'default';
      const email = String(args?.email || '').trim().toLowerCase();
      const role = String(args?.role || '').trim();
      const tenantId = String(args?.tenantId || '').trim();
      const branchId = String(args?.branchId || '').trim();
      const staffId = String(args?.staffId || '').trim();
      const staffName = String(args?.staffName || '').trim();
      const password = String(args?.password || '');
      if (!email || !role || !tenantId || !branchId || !staffId || !password) return { ok: false };

      const now = new Date().toISOString();
      const salt = randomSalt();
      const iters = 120000;
      const hash = pbkdf2Hash(password, salt, iters);
      stmtStaffUpsert.run(ws, email, role, tenantId, branchId, staffId, staffName || '', salt, hash, iters, now);
      return { ok: true };
    },

    offlineLogin: (args) => {
      const ws = String(args?.workspace || '').trim() || 'default';
      const email = String(args?.email || '').trim().toLowerCase();
      const role = String(args?.role || '').trim();
      const password = String(args?.password || '');
      if (!email || !role || !password) return { ok: false, error: 'invalid_credentials' };

      const row = stmtStaffGet.get(ws, email, role);
      if (!row) return { ok: false, error: 'offline_login_not_seeded' };

      const expected = String(row.password_hash || '');
      const salt = String(row.password_salt || '');
      const iters = Number(row.password_iters || 120000);
      const actual = pbkdf2Hash(password, salt, iters);
      if (!expected || actual !== expected) return { ok: false, error: 'invalid_credentials' };

      const session = {
        token: 'offline',
        role: row.role,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        staffId: row.staff_id,
        offline: true,
      };
      const now = new Date().toISOString();
      stmtSessionSet.run('last_session', JSON.stringify(session), now);
      return { ok: true, session };
    },

    getLastSession: () => {
      try {
        const row = stmtSessionGet.get('last_session');
        if (!row || typeof row.value !== 'string') return null;
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },

    getPosState: (scopeKey) => {
      const k = String(scopeKey || '').trim();
      if (!k) return null;
      const row = stmtPosGet.get(k);
      if (!row || typeof row.value !== 'string') return null;
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },
    setPosState: (scopeKey, value) => {
      const k = String(scopeKey || '').trim();
      if (!k) return false;
      const now = new Date().toISOString();
      const payload = JSON.stringify(value ?? null);
      stmtPosSet.run(k, payload, now);
      return true;
    },

    outboxEnqueue: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      const kind = String(args?.kind || '').trim() || 'pos.sync';
      if (!scopeKey) return { ok: false };

      const createdAt = new Date().toISOString();
      const id = String(args?.id || `out_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`);
      const attempts = 0;
      const nextAttemptAt = createdAt;
      let payload = '';
      try {
        payload = JSON.stringify(args?.payload ?? null);
      } catch {
        payload = 'null';
      }

      stmtOutboxInsert.run(id, scopeKey, kind, payload, createdAt, attempts, nextAttemptAt);
      return { ok: true, id };
    },
    outboxListReady: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return [];
      const now = new Date().toISOString();
      const limit = Number.isFinite(Number(args?.limit)) ? Math.max(1, Math.min(1000, Number(args.limit))) : 50;
      const rows = stmtOutboxList.all(scopeKey, now, limit);
      return Array.isArray(rows)
        ? rows.map((r) => {
            let p = null;
            try {
              p = JSON.parse(String(r.payload || 'null'));
            } catch {
              p = null;
            }
            return { ...r, payload: p };
          })
        : [];
    },
    outboxAck: (args) => {
      const ids = Array.isArray(args?.ids) ? args.ids.map((x) => String(x || '')).filter(Boolean) : [];
      if (ids.length === 0) return { ok: false };
      const tx = db.transaction((arr) => {
        for (const id of arr) stmtOutboxDeleteMany.run(id);
      });
      tx(ids);
      return { ok: true };
    },
    outboxBumpAttempt: (args) => {
      const id = String(args?.id || '').trim();
      if (!id) return { ok: false };
      const delayMs = Number.isFinite(Number(args?.delayMs)) ? Math.max(1000, Number(args.delayMs)) : 15000;
      const next = new Date(Date.now() + delayMs).toISOString();
      stmtOutboxBump.run(next, id);
      return { ok: true, nextAttemptAt: next };
    },
  };
};
