import * as SQLite from 'expo-sqlite'

type DB = SQLite.SQLiteDatabase

let db: DB | null = null

async function getDb(): Promise<DB> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('cafev.db')
  }
  return db
}

export async function initLocalDb() {
  const d = await getDb()
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      body TEXT,
      type TEXT,
      created_at TEXT,
      read INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS low_seen (
      id TEXT PRIMARY KEY NOT NULL,
      seen_at TEXT
    );
    -- POS offline tables
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      price REAL,
      category_id TEXT,
      image_url TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT PRIMARY KEY NOT NULL,
      branch_id TEXT,
      name TEXT,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY NOT NULL,
      local INTEGER DEFAULT 0,
      branch_id TEXT,
      table_id TEXT,
      status TEXT,
      payment_status TEXT,
      total REAL,
      note TEXT,
      created_at TEXT,
      updated_at TEXT,
      user_id TEXT
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT,
      product_id TEXT,
      qty REAL,
      price REAL,
      total REAL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT,
      amount REAL,
      method TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      try_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS id_map (
      entity TEXT NOT NULL,
      local_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      PRIMARY KEY(entity, local_id)
    );
  `)
}

async function run(sql: string, params: any[] = []): Promise<void> {
  const d = await getDb()
  await d.runAsync(sql, params)
}

async function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const d = await getDb()
  const rows = await d.getAllAsync<T>(sql, params)
  return rows
}

export type LocalNotification = { id: string; title: string; body: string; type: string | null; created_at: string; read: number }

export async function upsertNotification(n: { id: string; title: string; body: string; type?: string | null; created_at: string }) {
  await run(
    `INSERT INTO notifications (id, title, body, type, created_at, read)
     VALUES (?, ?, ?, ?, ?, COALESCE((SELECT read FROM notifications WHERE id = ?), 0))
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, type=excluded.type, created_at=excluded.created_at`,
    [n.id, n.title, n.body, n.type ?? null, n.created_at, n.id]
  )
}

export async function getNotifications(limit = 50): Promise<LocalNotification[]> {
  return all<LocalNotification>(
    `SELECT id, title, body, type, created_at, read FROM notifications ORDER BY datetime(created_at) DESC LIMIT ?`,
    [limit]
  )
}

export async function getUnreadCount(): Promise<number> {
  const rows = await all<{ c: number }>(`SELECT COUNT(1) as c FROM notifications WHERE read = 0`)
  return Number(rows[0]?.c ?? 0)
}

export async function markNotificationRead(id: string) {
  await run(`UPDATE notifications SET read = 1 WHERE id = ?`, [id])
}

export async function markAllNotificationsRead() {
  await run(`UPDATE notifications SET read = 1 WHERE read = 0`)
}

export async function deleteReadNotifications() {
  await run(`DELETE FROM notifications WHERE read = 1`)
}

export async function getKv(key: string): Promise<string | null> {
  const rows = await all<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [key])
  return (rows[0]?.value ?? null)
}

export async function setKv(key: string, value: string) {
  await run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value])
}

export async function getLastProfile(): Promise<{ id?: string; branch_id?: string | null; organization_id?: string | null; role?: string | null } | null> {
  try {
    const raw = await getKv('last_profile')
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

export async function setLastProfile(p: { id?: string; branch_id?: string | null; organization_id?: string | null; role?: string | null }) {
  try { await setKv('last_profile', JSON.stringify(p)) } catch {}
}

export async function getLowSeenSet(): Promise<Set<string>> {
  const rows = await all<{ id: string }>(`SELECT id FROM low_seen`)
  return new Set(rows.map((r) => String(r.id)))
}

export async function addLowSeen(id: string) {
  await run(`INSERT INTO low_seen (id, seen_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at`, [id, new Date().toISOString()])
}

// Product/table/order upserts and getters for offline POS
export type LocalProduct = { id: string; name: string; price: number; category_id: string | null; image_url: string | null; updated_at: string | null }
export async function upsertProducts(rows: LocalProduct[]) {
  if (!rows || rows.length === 0) return
  const d = await getDb()
  await d.runAsync('BEGIN')
  try {
    for (const p of rows) {
      await d.runAsync(
        `INSERT INTO products (id, name, price, category_id, image_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price, category_id=excluded.category_id, image_url=excluded.image_url, updated_at=excluded.updated_at`,
        [p.id, p.name, p.price, p.category_id ?? null, p.image_url ?? null, p.updated_at ?? null]
      )
    }
    await d.runAsync('COMMIT')
  } catch (e) {
    await d.runAsync('ROLLBACK')
    throw e
  }
}
export async function getProductsLocal(): Promise<LocalProduct[]> {
  return all<LocalProduct>(`SELECT id, name, price, category_id, image_url, updated_at FROM products ORDER BY name ASC`)
}

export type LocalTable = { id: string; branch_id: string | null; name: string; status: string | null }
export async function upsertTables(rows: LocalTable[]) {
  if (!rows || rows.length === 0) return
  const d = await getDb()
  await d.runAsync('BEGIN')
  try {
    for (const t of rows) {
      await d.runAsync(
        `INSERT INTO dining_tables (id, branch_id, name, status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET branch_id=excluded.branch_id, name=excluded.name, status=excluded.status`,
        [t.id, t.branch_id ?? null, t.name, t.status ?? null]
      )
    }
    await d.runAsync('COMMIT')
  } catch (e) {
    await d.runAsync('ROLLBACK')
    throw e
  }
}
export async function getTablesLocal(branchId?: string | null): Promise<LocalTable[]> {
  if (branchId) return all<LocalTable>(`SELECT id, branch_id, name, status FROM dining_tables WHERE branch_id = ? ORDER BY name ASC`, [branchId])
  return all<LocalTable>(`SELECT id, branch_id, name, status FROM dining_tables ORDER BY name ASC`)
}

export type LocalOrderIndex = { id: string; branch_id: string | null; table_id: string | null; status: string | null; payment_status: string | null; total: number; created_at: string }
export async function upsertOrdersIndex(rows: LocalOrderIndex[]) {
  if (!rows || rows.length === 0) return
  const d = await getDb()
  await d.runAsync('BEGIN')
  try {
    for (const o of rows) {
      await d.runAsync(
        `INSERT INTO orders (id, local, branch_id, table_id, status, payment_status, total, created_at)
         VALUES (?, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET branch_id=excluded.branch_id, table_id=excluded.table_id, status=excluded.status, payment_status=excluded.payment_status, total=excluded.total, created_at=excluded.created_at`,
        [o.id, o.branch_id ?? null, o.table_id ?? null, o.status ?? null, o.payment_status ?? null, Number(o.total ?? 0), o.created_at]
      )
    }
    await d.runAsync('COMMIT')
  } catch (e) {
    await d.runAsync('ROLLBACK')
    throw e
  }
}
export async function getUnpaidOrdersLocal(branchId?: string | null, staffId?: string | null): Promise<LocalOrderIndex[]> {
  // staffId not stored locally; we return all unpaid for branch
  if (branchId) return all<LocalOrderIndex>(`SELECT id, branch_id, table_id, status, payment_status, total, created_at FROM orders WHERE branch_id = ? AND (payment_status IS NULL OR payment_status <> 'paid') AND (status IS NULL OR status <> 'cancelled') ORDER BY datetime(created_at) DESC LIMIT 200`, [branchId])
  return all<LocalOrderIndex>(`SELECT id, branch_id, table_id, status, payment_status, total, created_at FROM orders WHERE (payment_status IS NULL OR payment_status <> 'paid') AND (status IS NULL OR status <> 'cancelled') ORDER BY datetime(created_at) DESC LIMIT 200`)
}

export async function getOrderLocal(orderId: string): Promise<LocalOrderIndex | null> {
  const rows = await all<LocalOrderIndex>(`SELECT id, branch_id, table_id, status, payment_status, total, created_at FROM orders WHERE id = ? LIMIT 1`, [orderId])
  return rows[0] ?? null
}

export type LocalOrderItem = { id: string; order_id: string; product_id: string; qty: number; price: number; total: number; note: string | null }
export async function upsertOrderItems(rows: LocalOrderItem[]) {
  if (!rows || rows.length === 0) return
  const d = await getDb()
  await d.runAsync('BEGIN')
  try {
    for (const it of rows) {
      await d.runAsync(
        `INSERT INTO order_items (id, order_id, product_id, qty, price, total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET order_id=excluded.order_id, product_id=excluded.product_id, qty=excluded.qty, price=excluded.price, total=excluded.total, note=excluded.note`,
        [it.id, it.order_id, it.product_id, it.qty, it.price, it.total, it.note ?? null]
      )
    }
    await d.runAsync('COMMIT')
  } catch (e) {
    await d.runAsync('ROLLBACK')
    throw e
  }
}

export async function getOrderItemsLocal(orderId: string): Promise<LocalOrderItem[]> {
  return all<LocalOrderItem>(`SELECT id, order_id, product_id, qty, price, total, note FROM order_items WHERE order_id = ? ORDER BY id ASC`, [orderId])
}

// Outbox helpers for offline-first POS
export async function enqueueOp(op: string, payload: any) {
  await run(`INSERT INTO outbox (op, payload, created_at) VALUES (?, ?, ?)`, [op, JSON.stringify(payload), new Date().toISOString()])
}

export type OutboxRow = { id: number; op: string; payload: string; created_at: string; try_count: number; status: string }

export async function getOutboxBatch(limit = 25): Promise<OutboxRow[]> {
  return all<OutboxRow>(`SELECT id, op, payload, created_at, try_count, status FROM outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?`, [limit])
}

export async function markOutboxProcessed(id: number) {
  await run(`UPDATE outbox SET status = 'done' WHERE id = ?`, [id])
}

export async function bumpOutboxTryCount(id: number) {
  await run(`UPDATE outbox SET try_count = try_count + 1 WHERE id = ?`, [id])
}

export async function countOutboxPending(): Promise<number> {
  const rows = await all<{ c: number }>(`SELECT COUNT(1) as c FROM outbox WHERE status = 'pending'`)
  return Number(rows[0]?.c ?? 0)
}

export async function setIdMap(entity: string, localId: string, remoteId: string) {
  await run(`INSERT INTO id_map (entity, local_id, remote_id) VALUES (?, ?, ?) ON CONFLICT(entity, local_id) DO UPDATE SET remote_id = excluded.remote_id`, [entity, localId, remoteId])
}

export async function getRemoteId(entity: string, localId: string): Promise<string | null> {
  const rows = await all<{ remote_id: string }>(`SELECT remote_id FROM id_map WHERE entity = ? AND local_id = ?`, [entity, localId])
  return rows[0]?.remote_id ?? null
}

