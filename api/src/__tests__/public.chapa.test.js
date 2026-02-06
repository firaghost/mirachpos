const request = require('supertest');

const { createApp } = require('../app');

describe('public chapa flow', () => {
    beforeEach(() => {
        if (global.__MIRACHPOS_DB_MOCK__?.reset) global.__MIRACHPOS_DB_MOCK__.reset();

        const st = global.__MIRACHPOS_DB_MOCK__?.state;
        if (!st) return;

        st.tables.pos_public_order_links.push({
            token: 'tok_1',
            purpose: 'payer',
            tenant_id: 't_test',
            branch_id: 'b_1',
            order_id: 'o_1',
            expires_at: null,
            meta_json: JSON.stringify({}),
        });

        st.tables.orders.push({
            id: 'o_1',
            tenant_id: 't_test',
            branch_id: 'b_1',
            status: 'Open',
            total: 100,
            tip: 0,
            paid_at: null,
            payload: JSON.stringify({ number: '1' }),
        });
    });

    it('POST /api/public/pos-links/:token/initiate-chapa returns checkoutUrl', async () => {
        const app = createApp();
        const res = await request(app).post('/api/public/pos-links/tok_1/initiate-chapa').send({ tipAmount: 0, tipPct: 0 });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('checkoutUrl');

        const st = global.__MIRACHPOS_DB_MOCK__?.state;
        expect(Array.isArray(st.tables.pos_payment_gateway_transactions)).toBe(true);
        expect(st.tables.pos_payment_gateway_transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/public/pos-links/:token/verify-chapa returns paid=true when verify is success', async () => {
        const app = createApp();

        await request(app).post('/api/public/pos-links/tok_1/initiate-chapa').send({ tipAmount: 0, tipPct: 0 });

        const res = await request(app).post('/api/public/pos-links/tok_1/verify-chapa').send({});
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('paid', true);

        const st = global.__MIRACHPOS_DB_MOCK__?.state;
        const order = st.tables.orders.find((o) => String(o.id) === 'o_1');
        expect(order).toBeTruthy();
        expect(String(order.status)).toBe('Paid');
    });
});
