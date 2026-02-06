
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
            tenants: [{ id: 't_test', slug: 'test', name: 'Test', status: 'active' }],
            pos_public_order_links: [],
            orders: [],
            owner_settings: [{ settings_json: JSON.stringify({ business: { businessName: 'Test Cafe' } }) }],
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
        },
    };

    const buildQuery = () => {
        const ctx = { table: '', where: {}, groupBy: '', count: false };

        const filterRows = (rows) => {
            const keys = Object.keys(ctx.where || {});
            if (!keys.length) return rows;
            return rows.filter((r) => keys.every((k) => String(r?.[k] ?? '') === String(ctx.where[k] ?? '')));
        };

        const exec = () => {
            const rows = state.tables[ctx.table] || [];
            const filtered = filterRows(rows);

            if (ctx.count && ctx.groupBy === 'status') {
                const byStatus = new Map();
                for (const r of filtered) {
                    const st = String(r?.status ?? '');
                    byStatus.set(st, (byStatus.get(st) || 0) + 1);
                }
                return Array.from(byStatus.entries()).map(([status, count]) => ({ status, count }));
            }

            return filtered;
        };

        const q = {
            select: jest.fn(() => q),
            from: jest.fn((t) => {
                ctx.table = String(t || '');
                return q;
            }),
            where: jest.fn((w) => {
                ctx.where = w && typeof w === 'object' ? w : {};
                return q;
            }),
            andWhereRaw: jest.fn(() => q),
            orderBy: jest.fn(() => q),
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
            insert: jest.fn(async (row) => {
                const rows = state.tables[ctx.table] || (state.tables[ctx.table] = []);
                rows.push(row);
                return [row?.id].filter(Boolean);
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
            transaction: jest.fn(async (fn) => {
                const trx = {
                    from: (t) => {
                        const inner = buildQuery();
                        inner.from(t);
                        return inner;
                    },
                };
                return fn(trx);
            }),
            then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
        };
        return q;
    };

    const db = () => {
        const q = buildQuery();
        q.raw = jest.fn(async () => ({ ok: true }));
        q.schema = { hasTable: jest.fn(async () => false) };
        q.destroy = jest.fn(async () => undefined);
        return q;
    };

    return { db, initDb: jest.fn(async () => db()) };
});

jest.mock('../src/services/paymentGatewayService', () => ({
    getGatewayConfig: jest.fn(async () => ({ enabled: false })),
    chapaInitializeForTenantPos: jest.fn(async () => ({ checkoutUrl: 'https://checkout.test/abc' })),
    chapaVerifyForTenantPos: jest.fn(async () => ({ status: 'success', rawResponse: { status: 'success' } })),
}));

// Set reasonable timeout
jest.setTimeout(30000);
