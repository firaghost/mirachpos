
// Silence pino logger during tests
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
    requestLogger: (req, res, next) => next(),
    createRequestLogger: jest.fn().mockReturnThis(),
    createServiceLogger: jest.fn().mockReturnThis(),
    logAudit: jest.fn(async () => undefined),
}));

jest.mock(
    'africastalking',
    () => {
        return () => ({
            SMS: {
                send: jest.fn(async () => ({
                    SMSMessageData: {
                        Recipients: [{ messageId: 'test-message-id' }],
                    },
                })),
            },
        });
    },
    { virtual: true },
);

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn(async () => ({})),
        verify: jest.fn(async () => true),
    })),
}));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.CACHE_DISABLED = process.env.CACHE_DISABLED || 'true';

let restoreConsole = null;

beforeAll(() => {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };

    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    restoreConsole = () => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.error = original.error;
    };
});

afterAll(() => {
    try {
        if (typeof restoreConsole === 'function') restoreConsole();
    } catch {
        // ignore
    }
});

afterAll(async () => {
    try {
        jest.clearAllTimers();
    } catch {
        // ignore
    }

    try {
        const { getGlobalDispatcher } = require('undici');
        const dispatcher = typeof getGlobalDispatcher === 'function' ? getGlobalDispatcher() : null;
        if (dispatcher && typeof dispatcher.close === 'function') {
            await dispatcher.close();
        }
    } catch {
        // ignore
    }
});

jest.mock('../src/db', () => {
    const state = {
        tables: {
            tenants: [
                { id: 't_test', slug: 'test', name: 'Test', status: 'active' },
                { id: 't_test', slug: 'test-tenant', name: 'Test', status: 'active' },
                { id: 't_test', slug: 'test-tenant-id', name: 'Test', status: 'active' },
            ],
            knex_migrations: Array.from({ length: 60 }).map((_, i) => ({ id: i + 1, name: `migration_${i + 1}` })),
            'information_schema.tables': [
                { table_name: 'tenants', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'branches', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'staff', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'orders', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'order_items', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'payments', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'products', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'inventory_items', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'customers', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'subscriptions', table_schema: process.env.DB_NAME || 'test' },
                { table_name: 'invoices', table_schema: process.env.DB_NAME || 'test' },
            ],
            pos_public_order_links: [],
            orders: [],
            owner_settings: [{ tenant_id: 't_test', settings_json: JSON.stringify({ business: { businessName: 'Test Cafe' } }) }],
            branches: [{ tenant_id: 't_test', id: 'b_1', name: 'Main' }],
            manager_settings: [{ tenant_id: 't_test', branch_id: 'b_1', settings_json: JSON.stringify({}) }],
            platform_payment_config: [{ id: 1, chapa_config_json: JSON.stringify({ enabled: true }), telebirr_config_json: JSON.stringify({ enabled: true }) }],
            tenant_pos_payment_gateways: [],
            pos_payment_gateway_transactions: [],
            superadmins: [],
            jobs: [],
        },
    };

    global.__MIRACHPOS_DB_MOCK__ = {
        state,
        reset: () => {
            state.tables.pos_public_order_links = [];
            state.tables.orders = [];
            state.tables.pos_payment_gateway_transactions = [];
            state.tables.superadmins = [];
            state.tables.jobs = [];
            state.tables.tenant_pos_payment_gateways = [];
        },
    };

    const buildQuery = () => {
        const ctx = {
            table: '',
            where: {},
            whereOps: [],
            whereIn: null,
            whereNull: null,
            whereBetween: [],
            groupBy: '',
            count: false,
            sum: null,
            orderBy: null,
            first: false,
            limit: null,
            offset: 0,
            pendingInsertRow: null,
            pendingMergePatch: null,
        };

        const normalizeCol = (c) => {
            const s = String(c || '');
            if (!s) return s;
            return s.includes('.') ? s.split('.').pop() : s;
        };

        const normalizeWhereObject = (w) => {
            if (!w || typeof w !== 'object') return {};
            const out = {};
            for (const [k, v] of Object.entries(w)) out[normalizeCol(k)] = v;
            return out;
        };

        const toComparable = (v) => {
            const s = String(v ?? '');
            const ms = Date.parse(s);
            if (Number.isFinite(ms)) return { kind: 'ms', value: ms };
            return { kind: 'str', value: s };
        };

        const compare = (a, b) => {
            const aa = toComparable(a);
            const bb = toComparable(b);
            if (aa.kind === 'ms' && bb.kind === 'ms') return aa.value - bb.value;
            return String(aa.value).localeCompare(String(bb.value));
        };

        const filterRows = (rows) => {
            const keys = Object.keys(ctx.where || {});
            let out = keys.length
                ? rows.filter((r) => keys.every((k) => String(r?.[normalizeCol(k)] ?? '') === String(ctx.where[k] ?? '')))
                : rows;

            if (Array.isArray(ctx.whereOps) && ctx.whereOps.length) {
                out = out.filter((r) => {
                    return ctx.whereOps.every((w) => {
                        const lhs = r?.[normalizeCol(w.col)];
                        const rhs = w.value;
                        const cmp = compare(lhs, rhs);
                        switch (w.op) {
                            case 'like': {
                                const text = String(lhs ?? '');
                                const pattern = String(rhs ?? '');
                                const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const re = new RegExp(`^${escaped.replace(/%/g, '.*')}$`, 'i');
                                return re.test(text);
                            }
                            case '<':
                                return cmp < 0;
                            case '<=':
                                return cmp <= 0;
                            case '>':
                                return cmp > 0;
                            case '>=':
                                return cmp >= 0;
                            case '=':
                            default:
                                return String(lhs ?? '') === String(rhs ?? '');
                        }
                    });
                });
            }

            if (ctx.whereIn && ctx.whereIn.col && Array.isArray(ctx.whereIn.values)) {
                const allowed = new Set(ctx.whereIn.values.map((v) => String(v ?? '')));
                out = out.filter((r) => allowed.has(String(r?.[normalizeCol(ctx.whereIn.col)] ?? '')));
            }

            if (Array.isArray(ctx.whereBetween) && ctx.whereBetween.length) {
                out = out.filter((r) => {
                    return ctx.whereBetween.every((b) => {
                        const val = r?.[normalizeCol(b.col)];
                        return compare(val, b.from) >= 0 && compare(val, b.to) <= 0;
                    });
                });
            }

            if (Array.isArray(ctx.whereNull) && ctx.whereNull.length) {
                out = out.filter((r) => ctx.whereNull.every((col) => r?.[normalizeCol(col)] == null));
            }

            return out;
        };

        const exec = () => {
            const rows = state.tables[ctx.table] || [];
            const filtered = filterRows(rows);

            const ordered = (() => {
                if (!ctx.orderBy?.col) return filtered;
                const col = normalizeCol(ctx.orderBy.col);
                const dir = String(ctx.orderBy.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
                return [...filtered].sort((a, b) => compare(a?.[col], b?.[col]) * dir);
            })();

            const start = Math.max(0, Number(ctx.offset || 0) || 0);
            const lim = ctx.limit == null ? null : Math.max(0, Number(ctx.limit) || 0);
            const sliced = lim == null ? ordered.slice(start) : ordered.slice(start, start + lim);

            if (ctx.groupBy && (ctx.count || (ctx.sum && ctx.sum.col))) {
                const rawKey = String(ctx.groupBy || '').trim();
                const key = rawKey.includes('.') ? rawKey.split('.').pop() : rawKey;
                const byKey = new Map();

                for (const r of filtered) {
                    const k = String(r?.[key] ?? '');
                    const cur = byKey.get(k) || { count: 0, sum: 0 };
                    cur.count += 1;
                    if (ctx.sum && ctx.sum.col) cur.sum += Number(r?.[ctx.sum.col] ?? 0) || 0;
                    byKey.set(k, cur);
                }

                return Array.from(byKey.entries()).map(([k, agg]) => {
                    const row = { [key]: k, count: agg.count };
                    if (ctx.sum && ctx.sum.col) row[ctx.sum.alias] = agg.sum;
                    return row;
                });
            }

            if (ctx.count && ctx.sum && ctx.sum.col) {
                const total = ordered.reduce((acc, r) => acc + (Number(r?.[normalizeCol(ctx.sum.col)] ?? 0) || 0), 0);
                return [{ count: ordered.length, [ctx.sum.alias]: total }];
            }

            if (ctx.count) {
                return [{ count: ordered.length }];
            }

            if (ctx.sum && ctx.sum.col) {
                const total = ordered.reduce((acc, r) => acc + (Number(r?.[normalizeCol(ctx.sum.col)] ?? 0) || 0), 0);
                return [{ [ctx.sum.alias]: total }];
            }

            return sliced;
        };

        const q = {
            select: jest.fn(() => q),
            from: jest.fn((t) => {
                if (t && typeof t === 'object' && !Array.isArray(t)) {
                    const values = Object.values(t);
                    ctx.table = String(values[0] || '');
                } else {
                    ctx.table = String(t || '');
                }
                return q;
            }),
            into: jest.fn((t) => {
                ctx.table = String(t || '');
                return q;
            }),
            innerJoin: jest.fn(() => q),
            join: jest.fn(() => q),
            leftJoin: jest.fn(() => q),
            clone: jest.fn(() => q),
            modify: jest.fn((fn) => {
                if (typeof fn === 'function') fn(q);
                return q;
            }),
            where: jest.fn((arg1, arg2, arg3) => {
                if (typeof arg1 === 'string') {
                    const col = normalizeCol(arg1);
                    if (typeof arg3 !== 'undefined') {
                        ctx.whereOps.push({ col, op: String(arg2 || '='), value: arg3 });
                    } else if (typeof arg2 !== 'undefined') {
                        ctx.whereOps.push({ col, op: '=', value: arg2 });
                    }
                    return q;
                }
                const w = arg1;
                ctx.where = normalizeWhereObject(w);
                return q;
            }),
            orWhere: jest.fn(() => q),
            orWhereRaw: jest.fn(() => q),
            whereIn: jest.fn((col, values) => {
                ctx.whereIn = { col: normalizeCol(col), values: Array.isArray(values) ? values : [] };
                return q;
            }),
            orWhereIn: jest.fn(() => q),
            whereNotIn: jest.fn(() => q),
            whereNotNull: jest.fn(() => q),
            whereBetween: jest.fn((col, range) => {
                const arr = Array.isArray(range) ? range : [];
                if (arr.length >= 2) {
                    ctx.whereBetween.push({ col: normalizeCol(col), from: arr[0], to: arr[1] });
                }
                return q;
            }),
            orWhereBetween: jest.fn(() => q),
            whereNull: jest.fn((col) => {
                ctx.whereNull = Array.isArray(ctx.whereNull) ? ctx.whereNull : [];
                ctx.whereNull.push(normalizeCol(col));
                return q;
            }),
            orWhereNull: jest.fn(() => q),
            andWhere: jest.fn((arg1, arg2, arg3) => {
                if (typeof arg1 === 'function') {
                    arg1.call(q, q);
                    return q;
                }
                if (typeof arg1 === 'string' && typeof arg3 !== 'undefined') {
                    ctx.whereOps.push({ col: normalizeCol(arg1), op: String(arg2 || '='), value: arg3 });
                    return q;
                }
                if (typeof arg1 === 'string' && typeof arg2 !== 'undefined') {
                    ctx.whereOps.push({ col: normalizeCol(arg1), op: '=', value: arg2 });
                    return q;
                }
                if (arg1 && typeof arg1 === 'object') {
                    ctx.where = { ...(ctx.where || {}), ...normalizeWhereObject(arg1) };
                }
                return q;
            }),
            andWhereRaw: jest.fn(() => q),
            whereRaw: jest.fn(() => q),
            orderBy: jest.fn((col, dir) => {
                ctx.orderBy = { col: String(col || ''), dir: String(dir || 'asc') };
                return q;
            }),
            limit: jest.fn((n) => {
                ctx.limit = n;
                return q;
            }),
            offset: jest.fn((n) => {
                ctx.offset = n;
                return q;
            }),
            clearSelect: jest.fn(() => q),
            clearOrder: jest.fn(() => q),
            onConflict: jest.fn(() => q),
            forUpdate: jest.fn(() => q),
            merge: jest.fn(async (patch) => {
                ctx.pendingMergePatch = patch && typeof patch === 'object' ? patch : {};
                await q.then(() => undefined);
                return 1;
            }),
            count: jest.fn(() => {
                ctx.count = true;
                return q;
            }),
            sum: jest.fn((obj) => {
                if (obj && typeof obj === 'object') {
                    const entries = Object.entries(obj);
                    if (entries.length) {
                        const [alias, col] = entries[0];
                        ctx.sum = { alias: String(alias), col: normalizeCol(col) };
                    }
                }
                return q;
            }),
            groupBy: jest.fn((col) => {
                ctx.groupBy = String(col || '');
                return q;
            }),
            groupByRaw: jest.fn(() => q),
            first: jest.fn(() => {
                ctx.first = true;
                return q;
            }),
            insert: jest.fn((row) => {
                if (Array.isArray(row)) {
                    ctx.pendingInsertRow = row.filter((r) => r && typeof r === 'object');
                    return q;
                }
                ctx.pendingInsertRow = row && typeof row === 'object' ? row : null;
                return q;
            }),
            update: jest.fn(async (patch) => {
                const rows = state.tables[ctx.table] || [];
                const keys = Object.keys(ctx.where || {});
                let count = 0;
                for (const r of rows) {
                    if (!keys.length || keys.every((k) => String(r?.[k] ?? '') === String(ctx.where[k] ?? ''))) {
                        Object.assign(r, patch);
                        count += 1;
                    }
                }
                return count;
            }),
            del: jest.fn(async () => {
                const rows = state.tables[ctx.table] || [];
                const keep = [];
                const keys = Object.keys(ctx.where || {});
                let removed = 0;

                for (const r of rows) {
                    const match = !keys.length || keys.every((k) => String(r?.[k] ?? '') === String(ctx.where[k] ?? ''));
                    if (match) {
                        removed += 1;
                    } else {
                        keep.push(r);
                    }
                }

                state.tables[ctx.table] = keep;
                return removed;
            }),
            increment: jest.fn(async (col, by) => {
                const rows = state.tables[ctx.table] || [];
                const keys = Object.keys(ctx.where || {});
                const delta = Number(by);
                const inc = Number.isFinite(delta) ? delta : 1;
                let count = 0;
                for (const r of rows) {
                    if (!keys.length || keys.every((k) => String(r?.[k] ?? '') === String(ctx.where[k] ?? ''))) {
                        const prev = Number(r?.[col] ?? 0) || 0;
                        r[col] = prev + inc;
                        count += 1;
                    }
                }
                return count;
            }),
            transaction: jest.fn(async (fn) => {
                // NOTE: `trx` must NOT be thenable, otherwise `await db().transaction()` will unwrap trx.then.
                // We return a callable trx that produces query builders, and expose helpers for common Knex patterns.
                const trx = (t) => {
                    const inner = buildQuery();
                    inner.from(t);
                    return inner;
                };

                trx.from = (t) => {
                    const inner = buildQuery();
                    inner.from(t);
                    return inner;
                };

                trx.into = (t) => {
                    const inner = buildQuery();
                    inner.into(t);
                    return inner;
                };

                trx.insert = (row) => {
                    const inner = buildQuery();
                    inner.insert(row);
                    return inner;
                };

                trx.commit = jest.fn(async () => undefined);
                trx.rollback = jest.fn(async () => undefined);
                trx.raw = jest.fn((expr) => expr);

                if (typeof fn === 'function') return fn(trx);
                return trx;
            }),
            then: (resolve, reject) => {
                try {
                    if (ctx.pendingInsertRow) {
                        const rows = state.tables[ctx.table] || (state.tables[ctx.table] = []);
                        const insertMany = Array.isArray(ctx.pendingInsertRow) ? ctx.pendingInsertRow : [ctx.pendingInsertRow];
                        const insertedIds = [];

                        for (const row of insertMany) {
                            const incomingId = String(row?.id ?? '');
                            const existingIndex = incomingId ? rows.findIndex((r) => String(r?.id ?? '') === incomingId) : -1;

                            if (existingIndex >= 0) {
                                const patch = ctx.pendingMergePatch && typeof ctx.pendingMergePatch === 'object' ? ctx.pendingMergePatch : {};
                                rows[existingIndex] = { ...rows[existingIndex], ...patch };
                            } else {
                                rows.push(row);
                            }

                            if (row?.id) insertedIds.push(row.id);
                        }
                        ctx.pendingInsertRow = null;
                        ctx.pendingMergePatch = null;
                        return Promise.resolve(insertedIds).then(resolve, reject);
                    }

                    const rows = exec();
                    if (ctx.first) return Promise.resolve(rows[0] || null).then(resolve, reject);
                    return Promise.resolve(rows).then(resolve, reject);
                } catch (e) {
                    return Promise.reject(e).then(resolve, reject);
                }
            },
        };
        return q;
    };

    const db = (table) => {
        const q = buildQuery();
        if (typeof table !== 'undefined') q.from(table);
        q.raw = jest.fn(async (sql) => {
            const s = String(sql || '').toLowerCase();
            if (s.includes('select 1') && s.includes(' as test')) return [{ test: 1 }];
            if (s.includes('information_schema.statistics')) {
                return [{ INDEX_NAME: 'idx_orders_tenant_id', COLUMN_NAME: 'tenant_id' }];
            }
            return [];
        });
        q.schema = { hasTable: jest.fn(async () => false) };
        q.destroy = jest.fn(async () => undefined);
        return q;
    };

    db.raw = jest.fn(async (sql) => {
        const s = String(sql || '').toLowerCase();
        if (s.includes('select 1') && s.includes(' as test')) return [{ test: 1 }];
        if (s.includes('information_schema.statistics')) {
            return [{ INDEX_NAME: 'idx_orders_tenant_id', COLUMN_NAME: 'tenant_id' }];
        }
        return [];
    });
    db.schema = { hasTable: jest.fn(async () => false) };
    db.destroy = jest.fn(async () => undefined);

    return { db, initDb: jest.fn(async () => db()) };
});

jest.mock('../src/services/paymentGatewayService', () => ({
    getGatewayConfig: jest.fn(async () => ({ enabled: false })),
    chapaInitializeForTenantPos: jest.fn(async () => ({ checkoutUrl: 'https://checkout.test/abc' })),
    chapaVerifyForTenantPos: jest.fn(async () => ({ status: 'success', rawResponse: { status: 'success' } })),
}));

// Set reasonable timeout
jest.setTimeout(30000);
