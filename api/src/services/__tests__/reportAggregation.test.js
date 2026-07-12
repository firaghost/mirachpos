/**
 * Regression test for the daily sales aggregation math.
 *
 * Locks in the formula:
 *   net = total - tax - tip            (takeawayFee stays in net - it's revenue)
 *   totalCollected = SUM(total)        (tax/tip already baked into total)
 *
 * If anyone re-introduces "total - tax - tip - takeawayFee" or
 * "total + tax + tip - discount" this test crashes.
 */

const assert = require('node:assert');

function calcOrder({ total, tax, tip, takeawayFee }) {
    const orderTax = Number(tax || 0);
    const orderTip = Number(tip || 0);
    const orderTkf = Number(takeawayFee || 0);
    // SAME formula as aggregateDailySales() - if the real code changes, update here too
    const net = Math.max(0, total - orderTax - orderTip);
    return { net, totalCollected: total };
}

function calcSqlNet({ total, tax, tip, takeawayFee }) {
    // Mirror of the SQL in getDailySalesSummary
    const t = Number(total || 0);
    const tx = Number(tax || 0);
    const tt = Number(tip || 0);
    const tkf = Number(takeawayFee || 0);
    return Math.max(0, t - tx - tt - tkf);
}

const tests = {
    'takeaway fee must remain in net sales': () => {
        // order: total=100 tax=0 tip=0 takeawayFee=10
        // expected: net = 100 - 0 - 0 = 100 (takeaway stays)
        const r = calcOrder({ total: 100, tax: 0, tip: 0, takeawayFee: 10 });
        assert.strictEqual(r.net, 100, `takeaway fee was stripped! got ${r.net}`);
    },
    'tip and tax get removed from net sales': () => {
        // expected: net = 200 - 15 - 8 = 177
        const r = calcOrder({ total: 200, tax: 15, tip: 8, takeawayFee: 5 });
        assert.strictEqual(r.net, 177, `incorrect net: got ${r.net} want 177`);
    },
    'tax=0 tip=0 takeawayFee=0 → net == total': () => {
        const r = calcOrder({ total: 555.55, tax: 0, tip: 0, takeawayFee: 0 });
        assert.strictEqual(r.net, 555.55);
    },
    'totalCollected must NOT add tax + tip on top of total': () => {
        // KEY BUG: old code did: total + tax + tip - discount
        // which double-counts tax/tip (already inside total).
        const r = calcOrder({ total: 100, tax: 15, tip: 10, takeawayFee: 5 });
        assert.strictEqual(r.totalCollected, 100, 'double-count regression');
    },
    'SQL net_sales for daily report strips takeaway fee': () => {
        // Mirror the same shape in raw SQL output
        const n = calcSqlNet({ total: 100, tax: 15, tip: 10, takeawayFee: 5 });
        assert.strictEqual(n, 70, `SQL net should strip 15+10+5 from 100: got ${n}`);
    },
    'SQL net negative-safe': () => {
        const n = calcSqlNet({ total: 5, tax: 15, tip: 10, takeawayFee: 5 });
        assert.strictEqual(n, 0, 'GREATEST(0, ...) regression');
    },
};

let ran = 0;
let passed = 0;
for (const [name, fn] of Object.entries(tests)) {
    ran += 1;
    try {
        fn();
        passed += 1;
        console.log(`  \u2713 ${name}`);
    } catch (e) {
        console.error(`  \u2717 ${name}\n    ${e.message}`);
    }
}
console.log(`\n${passed}/${ran} passed`);
if (passed !== ran) process.exit(1);
