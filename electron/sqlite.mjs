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
        const password = String(args?.password || '');
        if (!email || !password) return { ok: false, error: 'invalid_credentials' };
        
        let row = null;
        for (const v of memStaff.values()) {
          if (v.workspace === ws && v.email === email) {
            row = v;
            break;
          }
        }
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
        const pin = String(args?.pin || '');
        if (!staffCode || !pin) return { ok: false, error: 'invalid_credentials' };
        
        let row = null;
        for (const v of memStaffCode.values()) {
          if (v.workspace === ws && v.staff_code === staffCode) {
            row = v;
            break;
          }
        }
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

  // Migration: Add shift_type column to restaurant_tables if missing (old dbs)
  try {
    const colCheck = db.prepare(
      "SELECT 1 FROM pragma_table_info('restaurant_tables') WHERE name = 'shift_type'"
    );
    const hasCol = colCheck.get();
    if (!hasCol) {
      db.exec("ALTER TABLE restaurant_tables ADD COLUMN shift_type TEXT NULL DEFAULT 'ALL'");
    }
  } catch {
    // ignore - column might already exist or table doesn't exist yet
  }

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

    CREATE TABLE IF NOT EXISTS restaurant_tables (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      area TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Free',
      seats INTEGER NOT NULL DEFAULT 4,
      open_order_id TEXT NULL,
      last_order_id TEXT NULL,
      assigned_staff_id TEXT NULL,
      assigned_staff_name TEXT NULL,
      shift_type TEXT NULL DEFAULT 'ALL',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_scope_name ON restaurant_tables (scope_key, name);
    CREATE INDEX IF NOT EXISTS idx_restaurant_tables_scope_status ON restaurant_tables (scope_key, status);

    CREATE TABLE IF NOT EXISTS pos_products (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      code TEXT NULL,
      name TEXT NOT NULL,
      category TEXT NULL,
      price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active',
      image TEXT NULL,
      stock REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_products_scope_name ON pos_products (scope_key, name);

    CREATE TABLE IF NOT EXISTS pos_orders (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      status TEXT NOT NULL,
      display_number TEXT NULL,
      table_id TEXT NULL,
      table_name TEXT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      tip REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT NULL,
      created_by_staff_id TEXT NULL,
      created_by_name TEXT NULL,
      paid_by_staff_id TEXT NULL,
      paid_by_name TEXT NULL,
      payment_method TEXT NULL,
      payment_reference TEXT NULL,
      tendered_amount REAL NULL,
      notes TEXT NULL,
      synced_to_server INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_orders_scope_created ON pos_orders (scope_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_pos_orders_scope_table ON pos_orders (scope_key, table_id);

    CREATE TABLE IF NOT EXISTS pos_order_items (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      product_id TEXT NULL,
      product_code TEXT NULL,
      name TEXT NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      qty REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      note TEXT NULL,
      voided_qty REAL NOT NULL DEFAULT 0,
      void_reason TEXT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_items_scope_order ON pos_order_items (scope_key, order_id);

    CREATE TABLE IF NOT EXISTS pos_order_splits (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'amount',
      target_amount REAL NULL,
      label TEXT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      tip REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_splits_scope_order ON pos_order_splits (scope_key, order_id);

    CREATE TABLE IF NOT EXISTS pos_order_split_items (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      split_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_split_items_scope_split ON pos_order_split_items (scope_key, split_id);

    CREATE TABLE IF NOT EXISTS pos_order_payments (
      scope_key TEXT NOT NULL,
      id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      split_id TEXT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'ETB',
      reference TEXT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      paid_at TEXT NULL,
      paid_by_staff_id TEXT NULL,
      paid_by_name TEXT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_payments_scope_order ON pos_order_payments (scope_key, order_id);

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
    'SELECT workspace,email,role,tenant_id,branch_id,staff_id,staff_name,password_salt,password_hash,password_iters FROM auth_staff WHERE workspace=? AND email=? LIMIT 1',
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
    'SELECT workspace,staff_code,role,tenant_id,branch_id,staff_id,staff_name,pin_salt,pin_hash,pin_iters FROM auth_staff_code WHERE workspace=? AND staff_code=? LIMIT 1',
  );

  const stmtPosGet = db.prepare('SELECT value FROM pos_state WHERE scope_key = ?');
  const stmtPosSet = db.prepare(
    'INSERT INTO pos_state (scope_key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );

  const stmtRestaurantTablesUpsert = db.prepare(
    `INSERT INTO restaurant_tables (
        scope_key, id, name, area, status, seats,
        open_order_id, last_order_id,
        assigned_staff_id, assigned_staff_name,
        shift_type, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key, id) DO UPDATE SET
        name=excluded.name,
        area=excluded.area,
        status=excluded.status,
        seats=excluded.seats,
        open_order_id=excluded.open_order_id,
        last_order_id=excluded.last_order_id,
        assigned_staff_id=excluded.assigned_staff_id,
        assigned_staff_name=excluded.assigned_staff_name,
        shift_type=excluded.shift_type,
        updated_at=excluded.updated_at`,
  );
  const stmtRestaurantTablesList = db.prepare(
    'SELECT id,name,area,status,seats,open_order_id,last_order_id,assigned_staff_id,assigned_staff_name,shift_type,updated_at FROM restaurant_tables WHERE scope_key = ? ORDER BY name ASC LIMIT ?',
  );

  const stmtPosProductsUpsert = db.prepare(
    `INSERT INTO pos_products (scope_key, id, code, name, category, price, status, image, stock, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_key, id) DO UPDATE SET
      code=excluded.code,
      name=excluded.name,
      category=excluded.category,
      price=excluded.price,
      status=excluded.status,
      image=excluded.image,
      stock=excluded.stock,
      updated_at=excluded.updated_at`,
  );
  const stmtPosProductsList = db.prepare(
    'SELECT id,code,name,category,price,status,image,stock,updated_at FROM pos_products WHERE scope_key = ? ORDER BY name ASC LIMIT ?',
  );

  const stmtPosOrderUpsert = db.prepare(
    `INSERT INTO pos_orders (
        scope_key, id, status, display_number, table_id, table_name,
        subtotal, tax, tip, discount, total,
        created_at, paid_at,
        created_by_staff_id, created_by_name,
        paid_by_staff_id, paid_by_name,
        payment_method, payment_reference, tendered_amount,
        notes, synced_to_server, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key, id) DO UPDATE SET
        status=excluded.status,
        display_number=excluded.display_number,
        table_id=excluded.table_id,
        table_name=excluded.table_name,
        subtotal=excluded.subtotal,
        tax=excluded.tax,
        tip=excluded.tip,
        discount=excluded.discount,
        total=excluded.total,
        paid_at=excluded.paid_at,
        created_by_staff_id=excluded.created_by_staff_id,
        created_by_name=excluded.created_by_name,
        paid_by_staff_id=excluded.paid_by_staff_id,
        paid_by_name=excluded.paid_by_name,
        payment_method=excluded.payment_method,
        payment_reference=excluded.payment_reference,
        tendered_amount=excluded.tendered_amount,
        notes=excluded.notes,
        synced_to_server=excluded.synced_to_server,
        updated_at=excluded.updated_at`,
  );
  const stmtPosOrdersList = db.prepare(
    'SELECT * FROM pos_orders WHERE scope_key = ? ORDER BY created_at DESC LIMIT ?',
  );
  const stmtPosOrderGet = db.prepare('SELECT * FROM pos_orders WHERE scope_key = ? AND id = ?');

  const stmtPosOrderItemsDeleteByOrder = db.prepare('DELETE FROM pos_order_items WHERE scope_key = ? AND order_id = ?');
  const stmtPosOrderItemsInsert = db.prepare(
    `INSERT INTO pos_order_items (
        scope_key, id, order_id, product_id, product_code, name,
        unit_price, qty, tax_amount, discount_amount,
        note, voided_qty, void_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtPosOrderItemsListByOrder = db.prepare(
    'SELECT * FROM pos_order_items WHERE scope_key = ? AND order_id = ? ORDER BY name ASC',
  );

  const stmtPosOrderSplitsDeleteByOrder = db.prepare('DELETE FROM pos_order_splits WHERE scope_key = ? AND order_id = ?');
  const stmtPosOrderSplitsInsert = db.prepare(
    `INSERT INTO pos_order_splits (
        scope_key, id, order_id, mode, target_amount, label, status,
        subtotal, tax, tip, discount, total, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtPosOrderSplitsListByOrder = db.prepare(
    'SELECT * FROM pos_order_splits WHERE scope_key = ? AND order_id = ? ORDER BY id ASC',
  );

  const stmtPosSplitItemsDeleteByOrder = db.prepare('DELETE FROM pos_order_split_items WHERE scope_key = ? AND order_id = ?');
  const stmtPosSplitItemsInsert = db.prepare(
    `INSERT INTO pos_order_split_items (
        scope_key, id, order_id, split_id, order_item_id, qty, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtPosSplitItemsListByOrder = db.prepare(
    'SELECT * FROM pos_order_split_items WHERE scope_key = ? AND order_id = ? ORDER BY id ASC',
  );

  const stmtPosPaymentsDeleteByOrder = db.prepare('DELETE FROM pos_order_payments WHERE scope_key = ? AND order_id = ?');
  const stmtPosPaymentsInsert = db.prepare(
    `INSERT INTO pos_order_payments (
        scope_key, id, order_id, split_id, method, amount, currency,
        reference, status, paid_at, paid_by_staff_id, paid_by_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtPosPaymentsListByOrder = db.prepare(
    'SELECT * FROM pos_order_payments WHERE scope_key = ? AND order_id = ? ORDER BY paid_at DESC, id DESC',
  );

  const stmtOutboxInsert = db.prepare(
    `INSERT INTO sync_outbox (id, scope_key, kind, payload, created_at, attempts, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const stmtOutboxList = db.prepare(
    'SELECT id, scope_key, kind, payload, created_at, attempts, next_attempt_at FROM sync_outbox WHERE scope_key = ? AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?',
  );
  const stmtOutboxCountAll = db.prepare('SELECT COUNT(1) AS n FROM sync_outbox WHERE scope_key = ?');
  const stmtOutboxCountReady = db.prepare('SELECT COUNT(1) AS n FROM sync_outbox WHERE scope_key = ? AND next_attempt_at <= ?');
  const stmtOutboxMaxAttempts = db.prepare('SELECT MAX(attempts) AS n FROM sync_outbox WHERE scope_key = ?');
  const stmtOutboxNextAttemptAtMin = db.prepare('SELECT MIN(next_attempt_at) AS v FROM sync_outbox WHERE scope_key = ?');
  const stmtOutboxStuckCount = db.prepare('SELECT COUNT(1) AS n FROM sync_outbox WHERE scope_key = ? AND attempts >= ?');
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
      const password = String(args?.password || '');
      if (!email || !password) return { ok: false, error: 'invalid_credentials' };

      const row = stmtStaffGet.get(ws, email);
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

    offlineLoginByCode: (args) => {
      const ws = String(args?.workspace || '').trim() || 'default';
      const staffCode = String(args?.staffCode || '').trim().toLowerCase();
      const pin = String(args?.pin || '');
      if (!staffCode || !pin) return { ok: false, error: 'invalid_credentials' };

      const row = stmtStaffCodeGet.get(ws, staffCode);
      if (!row) return { ok: false, error: 'offline_login_not_seeded' };

      const expected = String(row.pin_hash || '');
      const salt = String(row.pin_salt || '');
      const iters = Number(row.pin_iters || 120000);
      const actual = pbkdf2Hash(pin, salt, iters);
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

    posUpsertRestaurantTables: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return { ok: false };
      const rows = Array.isArray(args?.tables) ? args.tables : [];
      const now = new Date().toISOString();
      const tx = db.transaction((items) => {
        for (const t of items) {
          const id = String(t?.id || '').trim();
          const name = String(t?.name || '').trim();
          if (!id || !name) continue;
          stmtRestaurantTablesUpsert.run(
            scopeKey,
            id,
            name,
            t?.area != null && String(t.area).trim() ? String(t.area) : null,
            t?.status ? String(t.status) : 'Free',
            Number(t?.seats ?? 4) || 4,
            t?.openOrderId ? String(t.openOrderId) : t?.open_order_id ? String(t.open_order_id) : null,
            t?.lastOrderId ? String(t.lastOrderId) : t?.last_order_id ? String(t.last_order_id) : null,
            t?.assignedStaffId ? String(t.assignedStaffId) : t?.assigned_staff_id ? String(t.assigned_staff_id) : null,
            t?.assignedStaffName ? String(t.assignedStaffName) : t?.assigned_staff_name ? String(t.assigned_staff_name) : null,
            t?.shiftType ? String(t.shiftType) : t?.shift_type ? String(t.shift_type) : 'ALL',
            now,
          );
        }
      });
      tx(rows);
      return { ok: true };
    },
    posListRestaurantTables: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return [];
      const limit = Number.isFinite(Number(args?.limit)) ? Math.max(1, Math.min(2000, Number(args.limit))) : 500;
      return stmtRestaurantTablesList.all(scopeKey, limit);
    },

    posUpsertProducts: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return { ok: false };
      const rows = Array.isArray(args?.products) ? args.products : [];
      const now = new Date().toISOString();
      const tx = db.transaction((items) => {
        for (const p of items) {
          const id = String(p?.id || '').trim();
          const name = String(p?.name || '').trim();
          if (!id || !name) continue;
          stmtPosProductsUpsert.run(
            scopeKey,
            id,
            p?.code ? String(p.code) : null,
            name,
            p?.category ? String(p.category) : null,
            Number(p?.price || 0) || 0,
            p?.status ? String(p.status) : 'Active',
            p?.image ? String(p.image) : null,
            Number(p?.stock || 0) || 0,
            now,
          );
        }
      });
      tx(rows);
      return { ok: true };
    },
    posListProducts: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return [];
      const limit = Number.isFinite(Number(args?.limit)) ? Math.max(1, Math.min(2000, Number(args.limit))) : 500;
      return stmtPosProductsList.all(scopeKey, limit);
    },

    posUpsertOrderBundle: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      const order = args?.order && typeof args.order === 'object' ? args.order : null;
      if (!scopeKey || !order) return { ok: false };

      const id = String(order?.id || '').trim();
      if (!id) return { ok: false };

      const now = new Date().toISOString();
      const synced = order?.syncedToServer === true || order?.synced_to_server === 1 ? 1 : 0;

      const tx = db.transaction(() => {
        stmtPosOrderUpsert.run(
          scopeKey,
          id,
          String(order?.status || 'Pending'),
          order?.number ? String(order.number) : null,
          order?.tableId ? String(order.tableId) : null,
          order?.tableName ? String(order.tableName) : null,
          Number(order?.subtotal || 0) || 0,
          Number(order?.tax || 0) || 0,
          Number(order?.tip || 0) || 0,
          Number(order?.discount || 0) || 0,
          Number(order?.total || 0) || 0,
          order?.createdAt ? String(order.createdAt) : now,
          order?.paidAt ? String(order.paidAt) : null,
          order?.createdByStaffId ? String(order.createdByStaffId) : null,
          order?.createdByName ? String(order.createdByName) : null,
          order?.paidByStaffId ? String(order.paidByStaffId) : null,
          order?.paidByName ? String(order.paidByName) : null,
          order?.paymentMethod ? String(order.paymentMethod) : null,
          order?.paymentReference ? String(order.paymentReference) : null,
          order?.tenderedAmount != null ? Number(order.tenderedAmount) : null,
          order?.notes ? String(order.notes) : null,
          synced,
          now,
        );

        const items = Array.isArray(args?.items) ? args.items : [];
        const splits = Array.isArray(args?.splits) ? args.splits : [];
        const splitItems = Array.isArray(args?.splitItems) ? args.splitItems : [];
        const payments = Array.isArray(args?.payments) ? args.payments : [];

        stmtPosOrderItemsDeleteByOrder.run(scopeKey, id);
        for (const it of items) {
          const itId = String(it?.id || '').trim();
          const name = String(it?.name || '').trim();
          if (!itId || !name) continue;
          stmtPosOrderItemsInsert.run(
            scopeKey,
            itId,
            id,
            it?.productId ? String(it.productId) : null,
            it?.code ? String(it.code) : null,
            name,
            Number(it?.unitPrice || 0) || 0,
            Number(it?.qty || 0) || 0,
            Number(it?.taxAmount || 0) || 0,
            Number(it?.discountAmount || 0) || 0,
            it?.note ? String(it.note) : null,
            Number(it?.voidedQty || 0) || 0,
            it?.voidReason ? String(it.voidReason) : null,
            now,
          );
        }

        stmtPosOrderSplitsDeleteByOrder.run(scopeKey, id);
        for (const s of splits) {
          const sid = String(s?.id || '').trim();
          if (!sid) continue;
          stmtPosOrderSplitsInsert.run(
            scopeKey,
            sid,
            id,
            s?.mode ? String(s.mode) : 'amount',
            s?.amount != null ? Number(s.amount) : null,
            s?.label ? String(s.label) : null,
            s?.status ? String(s.status) : 'open',
            Number(s?.subtotal || 0) || 0,
            Number(s?.tax || 0) || 0,
            Number(s?.tip || 0) || 0,
            Number(s?.discount || 0) || 0,
            Number(s?.total || 0) || 0,
            now,
          );
        }

        stmtPosSplitItemsDeleteByOrder.run(scopeKey, id);
        for (const si of splitItems) {
          const siId = String(si?.id || '').trim();
          if (!siId) continue;
          stmtPosSplitItemsInsert.run(
            scopeKey,
            siId,
            id,
            String(si?.splitId || ''),
            String(si?.orderItemId || ''),
            Number(si?.qty || 0) || 0,
            now,
          );
        }

        stmtPosPaymentsDeleteByOrder.run(scopeKey, id);
        for (const p of payments) {
          const pid = String(p?.id || '').trim();
          const method = String(p?.method || '').trim();
          if (!pid || !method) continue;
          stmtPosPaymentsInsert.run(
            scopeKey,
            pid,
            id,
            p?.splitId ? String(p.splitId) : null,
            method,
            Number(p?.amount || 0) || 0,
            p?.currency ? String(p.currency) : 'ETB',
            p?.reference ? String(p.reference) : null,
            p?.status ? String(p.status) : 'confirmed',
            p?.paidAt ? String(p.paidAt) : null,
            p?.paidByStaffId ? String(p.paidByStaffId) : null,
            p?.paidByName ? String(p.paidByName) : null,
            now,
          );
        }
      });

      tx();
      return { ok: true };
    },
    posGetOrderBundle: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      const orderId = String(args?.orderId || '').trim();
      if (!scopeKey || !orderId) return null;
      const order = stmtPosOrderGet.get(scopeKey, orderId);
      if (!order) return null;
      const items = stmtPosOrderItemsListByOrder.all(scopeKey, orderId);
      const splits = stmtPosOrderSplitsListByOrder.all(scopeKey, orderId);
      const splitItems = stmtPosSplitItemsListByOrder.all(scopeKey, orderId);
      const payments = stmtPosPaymentsListByOrder.all(scopeKey, orderId);
      return { order, items, splits, splitItems, payments };
    },
    posListOrders: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return [];
      const limit = Number.isFinite(Number(args?.limit)) ? Math.max(1, Math.min(1000, Number(args.limit))) : 200;
      return stmtPosOrdersList.all(scopeKey, limit);
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
    outboxStats: (args) => {
      const scopeKey = String(args?.scopeKey || '').trim();
      if (!scopeKey) return { ok: false };
      const now = new Date().toISOString();
      const stuckAfter = Number.isFinite(Number(args?.stuckAfter)) ? Math.max(1, Math.trunc(Number(args.stuckAfter))) : 8;
      const total = Number(stmtOutboxCountAll.get(scopeKey)?.n || 0) || 0;
      const ready = Number(stmtOutboxCountReady.get(scopeKey, now)?.n || 0) || 0;
      const maxAttempts = Number(stmtOutboxMaxAttempts.get(scopeKey)?.n || 0) || 0;
      const nextAttemptAtMin = String(stmtOutboxNextAttemptAtMin.get(scopeKey)?.v || '') || '';
      const stuck = Number(stmtOutboxStuckCount.get(scopeKey, stuckAfter)?.n || 0) || 0;
      return { ok: true, total, ready, maxAttempts, nextAttemptAtMin, stuck, stuckAfter };
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
