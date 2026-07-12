#!/usr/bin/env node
/**
 * Recompute daily_sales_summary with corrected aggregation math.
 *
 * Run ONCE after applying the source patches:
 *   node recompute-daily-summaries.js --from=2026-01-01 --to=2026-12-31
 *
 * It walks every tenant/branch/day pair within the date range and rewrites
 * every row in daily_sales_summary (and staff/category/product/hourly) by
 * calling the live aggregation functions, which now use the fixed math.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { db } = require('../src/db');
const {
    ensureAggregatedForRange,
} = require('../src/services/reportAggregationService');

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const m = arg.match(/^--([^=]+)=(.+)$/);
        return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
    })
);

const from = String(args.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
const to = String(args.to || new Date().toISOString().slice(0, 10));
const tenantId = args.tenant ? String(args.tenant) : null;
const branchId = args.branch ? String(args.branch) : null;

(async () => {
    console.log(`[Recompute] from=${from} to=${to} tenant=${tenantId || '*ALL*'} branch=${branchId || '*ALL*'}`);

    const tenants = tenantId
        ? [{ id: tenantId }]
        : await db().select('id').from('tenants');

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const t of tenants) {
        const tid = t.id;
        const branches = branchId
            ? [{ id: branchId }]
            : await db().select('id').from('branches').where({ tenant_id: tid });

        for (const b of branches) {
            try {
                const result = await ensureAggregatedForRange({
                    tenantId: tid,
                    branchId: b.id,
                    fromDate: from,
                    toDate: to,
                });
                if (result?.ok) {
                    totalProcessed += result.processed || 0;
                    console.log(`[Recompute] ${tid}/${b.id}: processed=${result.processed} errors=${result.errors}`);
                } else {
                    totalErrors += 1;
                    console.error(`[Recompute] ${tid}/${b.id} FAILED:`, result?.error);
                }
            } catch (e) {
                totalErrors += 1;
                console.error(`[Recompute] ${tid}/${b.id} EXCEPTION:`, e?.message || String(e));
            }
        }
    }

    console.log(`\n[Recompute] DONE. processed=${totalProcessed} errors=${totalErrors}`);
    process.exit(totalErrors > 0 ? 1 : 0);
})().catch((e) => {
    console.error('[Recompute] FATAL:', e);
    process.exit(2);
});
