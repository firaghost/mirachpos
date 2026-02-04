---
description: Rebuild report generation (clean contract, minimal data)
---

# Goal

Replace the current report generation flows with a clean, consistent, minimal set of report endpoints and exports, removing unnecessary data and heavy client-side aggregation.

# Current State (Observed)

## Owner reports

- `GET /api/owner/reports` (implemented in `api/src/routes/owner.js`)
  - Aggregates directly from `orders` for `totals`, `ledger`, `branchBreakdown`
  - Then does a heavy best-effort parse of `orders.payload` (up to 2000 rows) to derive:
    - `soldItems`
    - `soldCategories`
    - `paymentMethods`
  - Response also includes `kpis/trend/categories/shift` fields in UI type definitions, but not all of those are clearly derived in one place.

- `GET /api/owner/reports/*` (implemented in `api/src/routes/enhancedReports.js`)
  - Uses pre-aggregated tables (see `api/migrations/030_report_aggregates.js` + `api/src/services/reportAggregationService.js`)
  - Provides:
    - hourly heatmap (`/owner/reports/hourly`)
    - product performance (`/owner/reports/products`)
    - shift reports (`/owner/reports/shifts`, `/owner/reports/shifts/:id`)
    - void/refund analysis (`/owner/reports/voids-refunds`)
    - exports (`/owner/reports/export/csv`, `/owner/reports/export/pdf`)

## Manager reports

- `GET /api/manager/reports` returns *non-report* data (staff list, shift logs, cash sessions, expenses) for the UI; the UI then separately calls:
  - `GET /api/manager/reports/daily`
  - `GET /api/manager/reports/hourly`
  - `GET /api/manager/reports/products`
  - `GET /api/manager/reports/categories`
  - `GET /api/manager/reports/shifts`
  - `GET /api/manager/reports/voids`
  - `GET /api/manager/reports/staff`
  - and additionally `GET /api/manager/payments` which returns detailed per-order payload (items, staff, method, reference, etc.)

# Decision: What “from scratch” means for this task

- Keep the **pre-aggregated** report tables as the source of truth for report outputs.
- Stop mixing “reporting” with unrelated payload-heavy datasets.
- Define a **single clean report contract** for:
  - date range inputs
  - branch scoping
  - output shapes
  - export format handling

# Target Architecture

## Backend

- A single service layer responsible for report queries/aggregation:
  - Inputs: `{ tenantId, branchId?, fromDate, toDate, ... }`
  - Outputs: stable DTOs with minimal fields

- API routes:
  - Owner: `GET /api/owner/reports/summary` (new), plus keep existing `/owner/reports/*` endpoints but normalize shapes
  - Manager: keep `/api/manager/reports/*` but ensure they do not require client-side recomputation from payments payload

- Export:
  - Prefer server-generated export for CSV/PDF using the same DTOs
  - Avoid duplicating export logic between UI and API

## Frontend

- `screens/owner/GlobalReports.tsx` should stop relying on the large `/api/owner/reports` response that parses order payloads.
- `screens/manager/BranchReports.tsx` should not need to fetch `/api/manager/payments` just to compute aggregates.

# Clean Contract (Draft)

## Shared query parameters

- **Branch scope**
  - `branchId` optional for owner endpoints
  - required for manager endpoints (already enforced)

- **Range**
  - `from`: ISO date `YYYY-MM-DD` (preferred for aggregated tables)
  - `to`: ISO date `YYYY-MM-DD`

## DTOs (minimal)

- **Daily summary row**
  - `date`, `orderCount`, `netSales`, `tax`, `tips`, `discounts`, `totalCollected`, `avgTicket`

- **Payment breakdown (optional)**
  - `paymentBreakdown: Record<string, number>`

- **Products**
  - `productId`, `name`, `category`, `qtySold`, `revenue`, `voidQty`

- **Hourly heatmap**
  - `hour`, `orderCount`, `sales`, `avgSales`

# Milestones

1. Define final API contract (owner + manager) and list fields to remove from current responses.
2. Implement backend report endpoints using only pre-aggregated tables (and remove payload scanning).
3. Update owner/manager report screens to consume the new endpoints.
4. Add/adjust integration tests for report endpoints.
5. Verify exports (CSV/PDF) match contract and work end-to-end.

# Open Questions (need user input)

1. Which report screen(s) are the priority to fix first?
   - Owner: `GlobalReports`?
   - Manager: `BranchReports`?
   - Both?
2. Do you want to keep “What’s Sold” (sold items/categories) in the owner report?
   - If yes: should it be derived from `product_sales_summary` instead of parsing `orders.payload`?
3. Should “payment methods breakdown” be based on `daily_sales_summary.payment_breakdown_json` only?
   - If you support split payments, do you want the breakdown to reflect splits accurately (requires storing splits in aggregation), or is best-effort fine?
