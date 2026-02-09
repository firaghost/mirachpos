
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
}));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';

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
                { table_name: 'tenants' },
                { table_name: 'branches' },
                { table_name: 'staff' },
                { table_name: 'orders' },
                { table_name: 'order_items' },
                { table_name: 'payments' },
                { table_name: 'products' },
                { table_name: 'inventory_items' },
                { table_name: 'customers' },
                { table_name: 'subscriptions' },
                { table_name: 'invoices' },
            ],
            pos_public_order_links: [],
            orders: [],
            owner_settings: [{ tenant_id: 't_test', settings_json: JSON.stringify({ business: { businessName: 'Test Cafe' } }) }],
            branches: [{ tenant_id: 't_test', id: 'b_1', name: 'Main' }],
            manager_settings: [{ tenant_id: 't_test', branch_id: 'b_1', settings_json: JSON.stringify({}) }],
            platform_payment_config: [{ id: 1, chapa_config_json: JSON.stringify({ enabled: true }), telebirr_config_json: JSON.stringify({ enabled: true }), cbe_birr_config_json: JSON.stringify({ enabled: true }) }],
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
            whereIn: null,
            whereNull: null,
            groupBy: '',
            count: false,
            limit: null,
            offset: 0,
            pendingInsertRow: null,
            pendingMergePatch: null,
        };

        const filterRows = (rows) => {
            const keys = Object.keys(ctx.where || {});
            let out = keys.length
                ? rows.filter((r) => keys.every((k) => String(r?.[k] ?? '') === String(ctx.where[k] ?? '')))
                : rows;

            if (ctx.whereIn && ctx.whereIn.col && Array.isArray(ctx.whereIn.values)) {
                const allowed = new Set(ctx.whereIn.values.map((v) => String(v ?? '')));
                out = out.filter((r) => allowed.has(String(r?.[ctx.whereIn.col] ?? '')));
            }

            if (Array.isArray(ctx.whereNull) && ctx.whereNull.length) {
                out = out.filter((r) => ctx.whereNull.every((col) => r?.[col] == null));
            }

            return out;
        };

        const exec = () => {
            const rows = state.tables[ctx.table] || [];
            const filtered = filterRows(rows);

            const start = Math.max(0, Number(ctx.offset || 0) || 0);
            const lim = ctx.limit == null ? null : Math.max(0, Number(ctx.limit) || 0);
            const sliced = lim == null ? filtered.slice(start) : filtered.slice(start, start + lim);

            if (ctx.count && ctx.groupBy === 'status') {
                const byStatus = new Map();
                for (const r of filtered) {
                    const st = String(r?.status ?? '');
                    byStatus.set(st, (byStatus.get(st) || 0) + 1);
                }
                return Array.from(byStatus.entries()).map(([status, count]) => ({ status, count }));
            }

            return sliced;
        };

        const q = {
            select: jest.fn(() => q),
            from: jest.fn((t) => {
                ctx.table = String(t || '');
                return q;
            }),
            innerJoin: jest.fn(() => q),
            join: jest.fn(() => q),
            leftJoin: jest.fn(() => q),
            clone: jest.fn(() => q),
            where: jest.fn((w) => {
                ctx.where = w && typeof w === 'object' ? w : {};
                return q;
            }),
            orWhere: jest.fn(() => q),
            orWhereRaw: jest.fn(() => q),
            whereIn: jest.fn((col, values) => {
                ctx.whereIn = { col: String(col || ''), values: Array.isArray(values) ? values : [] };
                return q;
            }),
            orWhereIn: jest.fn(() => q),
            whereNotIn: jest.fn(() => q),
            whereNotNull: jest.fn(() => q),
            whereBetween: jest.fn(() => q),
            orWhereBetween: jest.fn(() => q),
            whereNull: jest.fn((col) => {
                ctx.whereNull = Array.isArray(ctx.whereNull) ? ctx.whereNull : [];
                ctx.whereNull.push(String(col || ''));
                return q;
            }),
            orWhereNull: jest.fn(() => q),
            andWhere: jest.fn((arg1, arg2) => {
                if (typeof arg1 === 'function') return q;
                if (typeof arg1 === 'string' && typeof arg2 !== 'undefined') return q;
                if (arg1 && typeof arg1 === 'object') {
                    ctx.where = { ...(ctx.where || {}), ...arg1 };
                }
                return q;
            }),
            andWhereRaw: jest.fn(() => q),
            orderBy: jest.fn(() => q),
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
            merge: jest.fn(async (patch) => {
                ctx.pendingMergePatch = patch && typeof patch === 'object' ? patch : {};
                await q.then(() => undefined);
                return 1;
            }),
            count: jest.fn(() => {
                ctx.count = true;
                return q;
            }),
            groupBy: jest.fn((col) => {
                ctx.groupBy = String(col || '');
                return q;
            }),
            first: jest.fn(async () => {
                const rows = exec();
                return rows[0] || null;
            }),
            insert: jest.fn((row) => {
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
                trx.commit = jest.fn(async () => undefined);
                trx.rollback = jest.fn(async () => undefined);

                if (typeof fn === 'function') return fn(trx);
                return trx;
            }),
            then: (resolve, reject) => {
                try {
                    if (ctx.pendingInsertRow) {
                        const rows = state.tables[ctx.table] || (state.tables[ctx.table] = []);
                        const incomingId = String(ctx.pendingInsertRow?.id ?? '');
                        const existingIndex = incomingId ? rows.findIndex((r) => String(r?.id ?? '') === incomingId) : -1;

                        if (existingIndex >= 0) {
                            const patch = ctx.pendingMergePatch && typeof ctx.pendingMergePatch === 'object' ? ctx.pendingMergePatch : {};
                            rows[existingIndex] = { ...rows[existingIndex], ...patch };
                        } else {
                            rows.push(ctx.pendingInsertRow);
                        }

                        const insertedIds = [ctx.pendingInsertRow?.id].filter(Boolean);
                        ctx.pendingInsertRow = null;
                        ctx.pendingMergePatch = null;
                        return Promise.resolve(insertedIds).then(resolve, reject);
                    }

                    return Promise.resolve(exec()).then(resolve, reject);
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
