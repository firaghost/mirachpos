==============================================================
MIRACHPOS REPORT BUG FIX - CPANEL MANUAL DEPLOYMENT STEPS
==============================================================

WHAT THIS FIXES:
- Cafe owner's manual reports don't match MIRACHPOS daily reports
- Two bugs combined: takeawayFee stripped from revenue AND totalCollected
  was double-counting tax/tip that are already inside orders.total

SITE STRUCTURE ON CPANEL:
  /home/<user>/<api-folder>/src/services/reportAggregationService.js
  /home/<user>/<api-folder>/src/routes/owner/dashboard.js

USE CPANEL FILE MANAGER -> EDIT BLANK -> REPLACE BLOCK AS BELOW.
OR SSH INTO CPANEL AND PATCH WITH `sed` OR EDIT TOOL.

=============================================================
FILE 1: src/services/reportAggregationService.js
=============================================================

PATCH 1A (fixes net sales in daily aggregation):
- Around line 359-364, REPLACE this block:

  // order.total includes tax + tip (and service charge). To avoid double-counting:
  const takeawayFee = Number(safeJsonParse(order.payload, {}).takeawayFee || 0);
  const net = Math.max(0, total - orderTax - orderTip - takeawayFee);
  const gross = net + Math.max(0, orderDiscount);

- WITH:

  // order.total includes tax + tip (and service charge) + takeawayFee.
  // TakeawayFee is revenue to the cafe, so it stays in net sales.
  // Only tax + tip are stripped out for the pure-food "net" view.
  const takeawayFee = Number(safeJsonParse(order.payload, {}).takeawayFee || 0);
  const net = Math.max(0, total - orderTax - orderTip);
  const gross = net + Math.max(0, orderDiscount);


PATCH 1B (fixes staff aggregation - same bug, second copy):
- Around line 466-470, REPLACE this block:

  const takeawayFee = Number(safeJsonParse(order.payload, {}).takeawayFee || 0);
  const net = Math.max(0, total - orderTax - orderTip - takeawayFee);
  const gross = net + Math.max(0, orderDiscount);

- WITH:

  const takeawayFee = Number(safeJsonParse(order.payload, {}).takeawayFee || 0);
  const net = Math.max(0, total - orderTax - orderTip);
  const gross = net + Math.max(0, orderDiscount);


PATCH 1C (fixes the SQL that powers /manager/reports/daily):
- Search for this exact line (appears TWICE in getDailySalesSummary):

  db().raw('COALESCE(SUM(GREATEST(0, COALESCE(o.total, 0) - COALESCE(o.tax, 0) - COALESCE(o.tip, 0))), 0) as net_sales_etb'),

- REPLACE BOTH OCCURRENCES with:

  db().raw(`COALESCE(SUM(GREATEST(0,
      COALESCE(o.total, 0)
      - COALESCE(o.tip, 0)
      - COALESCE(o.tax, 0)
      - COALESCE((JSON_EXTRACT(o.payload, '$.takeawayFee')), 0)
  )), 0) as net_sales_etb`),


=============================================================
FILE 2: src/routes/owner/dashboard.js
=============================================================

PATCH 2A (fixes totalCollected double-count):
- Around line 369, REPLACE this block:

  totalCollected: (Number(sumRow?.netSales || 0) || 0) + (Number(sumRow?.tax || 0) || 0) + (Number(sumRow?.tips || 0) || 0) - (Number(sumRow?.discounts || 0) || 0),

- WITH:

  // orders.total already includes tax + tip + takeawayFee, so totalCollected
  // should equal the SUM of total the customer actually paid.
  // Use SUM(total) directly to avoid double-counting tax/tip.
  totalCollected: Number(sumRow?.netSales || 0) || 0,


=============================================================
AFTER PATCHING
=============================================================

1. Restart your Node.js API on cPanel (Application Manager -> Restart,
   or `pm2 restart mirachpos` if using PM2).

2. Recompute old reports that have ALREADY been aggregated into the
   daily_sales_summary table. The aggregation functions now write
   correctly, but rows already stored still have the old bug.
   Trigger this by hitting:
     GET /api/manager/reports/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
   for the affected date range (the function runs ensureAggregatedForRange
   which overwrites the summary table on conflict).

3. Verify the new numbers match the cafe owner's manual daily sheet.

=============================================================
ROLLBACK (if something breaks)
=============================================================
Revert each patch by reversing the "REPLACE" substitution:
  1A: change `total - orderTax - orderTip` back to `total - orderTax - orderTip - takeawayFee`
  1B: same
  1C: switch the multi-line raw back to the one-line version
  2A: restore the + tax + tips - discounts expression
