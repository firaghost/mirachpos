---
description: Phase A core revenue features (loyalty, customer display, kitchen printer fallback)
---

# Phase A Core Revenue Features Plan

## Goals
- Implement loyalty/rewards program.
- Add customer-facing display for order totals.
- Add kitchen printer fallback logic.

## Open Questions (must confirm before implementation)
1. Loyalty model: points per currency? tiers? expiry?
2. Customer display: second screen (browser window), separate device, or in-app split view?
3. Kitchen fallback: retry same printer, failover to secondary printer, or save to queue for manual reprint?

## Tasks
1. **Loyalty/Rewards**
   - Schema: customers_loyalty, loyalty_transactions
   - APIs: earn/redeem points, balance
   - UI: customer profile and checkout toggle

2. **Customer Facing Display**
   - Web page route with read-only order state
   - Optional pairing code per terminal
   - Real-time updates (polling or websocket)

3. **Kitchen Printer Fallback**
   - Printer priority list per branch
   - Retry policy + failover
   - Audit log + UI status

## Validation
- Loyalty points accrue/redeem correctly
- Customer display matches order state
- Printer fallback succeeds when primary fails


