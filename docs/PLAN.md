---
description: Phase A core revenue features implementation plan
---

# Phase A Core Revenue Features Plan

## Decisions
- Loyalty earning rate is configurable per manager/owner (per-branch settings).
- Redemption rule: **100 points = 10 ETB** (confirmed).
- Loyalty expiry is configurable per manager/owner (per-branch settings).
- Customer display uses **second screen (separate browser window)** and supports **separate device** pairing.
- Kitchen printer fallback: **failover to secondary printer** and **queue for manual reprint**.

## Scope
- **Loyalty/Rewards**: configurable earning rate + expiry, earn on payment, redeem via balance conversion.
- **Customer Display**: read-only view of current order totals on a second screen/device.
- **Kitchen Printer Fallback**: retry/secondary printer failover + manual reprint queue.

## Tasks
1. **Loyalty/Rewards (Backend + Frontend)**
   - Add branch settings for loyalty rate + expiry.
   - Add loyalty transaction logging and earn on payment.
   - Update customer UI to manage settings and view balances.

2. **Customer Facing Display (Frontend + API)**
   - Create customer display route and UI.
   - Add pairing/token (branch + device code) and read-only order feed.

3. **Kitchen Printer Fallback (Backend + Frontend)**
   - Add printer priority list per branch.
   - Failover to secondary printer when primary fails.
   - Queue for manual reprint with status in UI.

## Validation
- Points accrue per configured rate and expire per policy.
- Customer display shows current order totals live.
- Kitchen prints succeed via failover or queue for manual reprint.
