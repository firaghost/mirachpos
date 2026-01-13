# MirachPOS – System Audit (Codebase Review)

Generated: 2026-01-13

## Scope & methodology
This report is based on a **static code review** of the current repository (frontend React/Vite + Electron bridge + Node/Express API).

- Reviewed entry points:
  - `App.tsx` (screen router)
  - `PosContext.tsx` (POS state, offline cache, printing)
  - `session.ts` + `api.ts` (session + API transport)
  - `rbac.ts` (access gating)
  - API: `api/src/app.js` + `api/src/routes/*`
- Reviewed navigation: `components/Sidebar.tsx`
- Sampled high-risk screens/flows:
  - Waiter payment/receipt
  - Branch settings
  - Owner billing

**Important:** This audit does not execute the app. Some items below are “likely issues” that should be confirmed by running flows.

---

## Architecture overview (what calls what)

### Frontend routing
- Uses a **hash-based screen router**:
  - `currentScreen` is restored from:
    - `window.location.hash`
    - `mirachpos.lastScreen.v1`
    - `session.screen`
  - Rendering is a large conditional block in `App.tsx`.

### Session model
- Session stored primarily in **`sessionStorage`** (`SESSION_KEY = mirachpos.session.v1`).
- A “legacy” copy is also stored in `localStorage` but **per-role scoped** to avoid collisions.
- Session changes are broadcast via `window.dispatchEvent(new Event('mirachpos-session-changed'))`.

### RBAC / entitlements
- UI gating:
  - `canAccessScreenWithPermissions(role, screen, subscription, permissions)`
  - Includes subscription module gating for owner (`canAccessScreenWithSubscription`).
- API gating (server-side): `requireAuth`, `requireRole`, `requirePermission`, `requireModule` (in multiple route files).

### POS state
- `PosContext.tsx` is a large “POS domain layer”:
  - local state in browser localStorage (`mirachpos.state.v1`)
  - branch-scoped Electron SQLite cache via `window.mirachpos.pos.*`
  - offline outbox via `window.mirachpos.outbox.*`
  - printing via `window.open` print windows (HTML strings)

---

## Roles
- `Waiter`
- `Waiter Manager`
- `Branch Manager`
- `Cafe Owner`
- `Super Admin`

---

## Pages / Screens inventory (authoritative: `types.ts` + `App.tsx` + Sidebar)

### Global / shared
- `LOGIN`
- `BRANCH_SELECT`
- `SUPPORT_REQUEST`
- `DESKTOP_DRAFT_INBOX`
- `DASHBOARD` (legacy)
- `ORDERS` (legacy)
- `TABLE_ASSIGNMENT`
- `GUESTS`

### Waiter
- `WAITER_DASHBOARD`
- `WAITER_MENU`
- `WAITER_REVIEW`
- `WAITER_PAYMENT`
- `WAITER_RECEIPT`
- `WAITER_ACTIVE_ORDERS`
- `WAITER_STATUS`
- `WAITER_KDS`
- `WAITER_HISTORY`
- `WAITER_NOTIFICATIONS`
- `WAITER_SYSTEM`
- `WAITER_SETTINGS`
- `WAITER_SHIFT_REPORT`
- `WAITER_SCHEDULE`
- `WAITER_DRAFT_SIM` (exists in enum + file)

### Branch Manager
- `MANAGER_DASHBOARD`
- `MANAGER_ORDERS`
- `MANAGER_ORDER_DETAILS`
- `MANAGER_FLOOR_MAP`
- `MANAGER_TABLE_DETAILS`
- `MANAGER_CUSTOMERS`
- `MANAGER_INVENTORY`
- `MANAGER_RECIPE_BUILDER`
- `MANAGER_MENU_BUILDER`
- `MANAGER_STAFF`
- `MANAGER_SETTINGS`
- `MANAGER_FINANCE`
- `MANAGER_REPORTS`
- `STAFF_SCHEDULE`

### Cafe Owner
- `OWNER_ONBOARDING`
- `OWNER_DASHBOARD`
- `OWNER_BRANCHES`
- `OWNER_REPORTS`
- `OWNER_INVENTORY`
- `OWNER_STAFF`
- `OWNER_FINANCE`
- `OWNER_MENU`
- `OWNER_SETTINGS`
- `OWNER_AUDIT`
- `OWNER_BILLING`

### Super Admin
- `SA_OVERVIEW`
- `SA_TENANTS`
- `SA_TENANT_DETAILS`
- `SA_ONBOARDING`
- `SA_BILLING`
- `SA_PAYMENT_CONFIG`
- `SA_INTEGRATIONS`
- `SA_ADDONS`
- `SA_DEMO_REQUESTS`
- `SA_SYSTEM_HEALTH`
- `SA_SUPPORT`
- `SA_AUDIT`
- `SA_FEATURE_FLAGS`
- `SA_SETTINGS`

---

## Flow maps (high-level)

### 1) Login / session establishment
- UI: `screens/Login.tsx`
- API: `POST /api/auth/login` or `/api/login` (both wired)
- Stores session via `writeSession({ token, role, tenantId, tenantSlug, staffId, staffName, branchId, permissions, subscription, billing, screen })`
- `App.tsx` then routes to role home.

Risks:
- Multiple sources of tenant slug:
  - `api.ts` prefers `session.tenantSlug` then `session.tenant.slug`, then env, then `localStorage.lastWorkspace`.

### 2) Branch selection (Owner / Super Admin)
- UI: `screens/BranchSelect.tsx`
- API: `GET /api/branches`
- Persists branch selection:
  - `localStorage.mirachpos.owner.selectedBranchId.v1`
  - updates session `branchId`
  - sets `window.location.hash` to return screen

### 3) POS ordering (Waiter)
- UI: Waiter screens call into `PosContext` methods.
- `PosContext` maintains cart per table, orders list, statuses.
- API sync:
  - route file `api/src/routes/pos.js` stores normalized order rows + item rows + split rows + payments.

### 4) Payment
- UI: `screens/waiter/WaiterPayment.tsx`
  - reads `/api/pos/settings` (branch-scoped)
  - supports:
    - offline cash
    - telebirr QR
    - chapa online (mobile pay)
    - split payments
    - discount with optional PIN policy
  - finalizes through `confirmPayment` from `PosContext`.

### 5) Receipt / printing
- UI: `screens/waiter/WaiterReceipt.tsx`
- Settings from `/api/pos/settings` (receipt header/footer, VAT/service)
- Uses `window.open` and `print()`.

### 6) Subscription / billing (Owner)
- UI: `screens/owner/OwnerBilling.tsx`
- API:
  - `/api/owner/subscription`
  - `/api/owner/invoices`
  - `/api/owner/payment-instructions`
  - `/api/owner/plans`
- Supports proof uploads via `fetch` with FormData.

---

## Findings (needs fixing / not correct)

### A) Definite bug: JavaScript syntax error in API HTML
- File: `api/src/app.js`
- In `/p/:token` checkout page HTML:
  - `const money = (n) => (Math.round((Number(n)||0)*100)/100).toFixed(2);`
  - **Missing closing parenthesis `)` before the semicolon**.
- Impact:
  - The payment page JS will fail to parse, breaking checkout UI.

### B) Screen exists but is unreachable: `WAITER_DRAFT_SIM`
- `Screen.WAITER_DRAFT_SIM` exists in `types.ts` and `screens/waiter/WaiterDraftSim.tsx` exists.
- It is **not rendered** in `App.tsx` and **not linked** in Sidebar.
- Impact:
  - dead/unreachable feature; may indicate a half-finished flow.

### C) RBAC permission mapping is overly coarse for Waiter
- In `rbac.ts`, almost all waiter screens map to `orders.read`.
- Payment/void/discount actions likely require stricter perms (e.g. `payments.pay`, `orders.void`, `discounts.apply`).
- Impact:
  - permission model can’t express least-privilege; risk of unauthorized sensitive actions.

### D) Branch scoping logic is duplicated and inconsistent
Multiple places implement “append branchId if token branch is global” logic:
- `api.ts` (auto-append for `/api/manager/*` when owner)
- `PosContext.tsx` (`withBranchQuery`, `getEffectiveBranchIdForApi`, `getBranchScopeKey`)
- `Sidebar.tsx` (`withBranchQuery`)
- Waiter screens sometimes implement their own.

Impact:
- high chance of drift and edge cases:
  - one module appends for owner only; another includes waiter manager; another does not.

### E) `BranchSelect.tsx` reads session once and never updates
- `const session = useMemo(() => readSession<any>(), []);`
- If session changes (impersonation, token refresh, branch changes), UI might show stale identity.

### F) Role checks sometimes rely on raw strings
Examples:
- `PosContext.tsx` uses `role === 'Cafe Owner'` etc (string literals).
- Elsewhere role comes from `UserRole` enum.

Impact:
- if role values change or case/spacing differs, branch-scoping and feature gating breaks.

### G) OwnerBilling mixes tenant source of truth
- Uses `X-Tenant: localStorage.getItem('mirachpos.lastWorkspace.v1')` for FormData uploads.
- But `api.ts` already has a more correct tenant slug resolution (prefers session tenant).

Impact:
- can submit invoice proof to wrong tenant if `lastWorkspace` drifts from actual JWT tenant.

### H) Printing code is duplicated across multiple files
- `PosContext.tsx`, `WaiterReceipt.tsx`, `BranchSettings.tsx` each have `escapeHtml` + `openPrintWindow` + receipt HTML building.

Impact:
- fixes/enhancements must be duplicated; formatting inconsistencies likely.

### I) Potential data integrity risks in POS offline merge
- `mergeBranchState` intentionally avoids overwriting tables/products with empty arrays.
- Good intention, but can also make it impossible to clear server-side state when it truly becomes empty.

Impact:
- “ghost tables/products” risk if a branch resets to empty legitimately.

---

## TODO list (prioritized)

### P0 (must fix now)
1. Fix syntax error in `api/src/app.js` checkout page `money()` function.
2. Add missing `WAITER_DRAFT_SIM` routing in `App.tsx` **or** remove the enum + file if it’s not a supported feature.

### P1 (security / correctness)
1. Refine RBAC permissions:
   - Separate read vs pay vs void vs discounts vs settings.
   - Ensure server enforces same permissions as UI.
2. Centralize branch scoping:
   - Create one helper (e.g. `withBranchQueryForRole`) used by `api.ts`, Sidebar, Waiter screens, and `PosContext`.
3. Replace string-literal role checks with `UserRole` enum everywhere.
4. In `OwnerBilling`, stop using `lastWorkspace` for `X-Tenant`; prefer session tenant slug.

### P2 (maintainability / UX)
1. Make `BranchSelect.tsx` reactive to `mirachpos-session-changed`.
2. De-duplicate printing utilities (`escapeHtml`, `openPrintWindow`, receipt template) into one shared module.
3. Add “flow tests” (manual checklist or automated) for:
   - login (email + code/pin)
   - branch select
   - create order -> send kitchen -> pay -> print
   - online payment (chapa/telebirr)
   - owner plan upgrade -> invoice -> proof upload

---

## Per-role checklist (what to validate manually)

### Waiter / Waiter Manager
- Floor map loads tables correctly
- Add items -> review -> send to kitchen
- KDS status changes and notifications
- Payment:
  - cash tender + change
  - split payments
  - reference-required methods validation
  - discount PIN enforcement
- Receipt:
  - totals match payment
  - VAT/service/tip/discount correctness
  - printing works in Electron and browser

### Branch Manager
- Dashboard metrics vs actual orders
- Branch settings saving (taxes/receipt/printers/payment QR)
- Inventory / recipes / menu builder
- Reports

### Cafe Owner
- Onboarding completion gating
- Branch list + selecting a branch and acting as manager
- Billing:
  - invoices list
  - online pay redirects
  - bank transfer proof upload

### Super Admin
- Tenant list/details
- Plans matrix / payment config
- Feature flags and platform settings

---

## Notes / open questions
- The repo’s “66+ pages” likely includes **internal tabs/sections** inside large screens (e.g. `BranchSettings` has multiple tabs, SuperAdmin `PaymentConfig` is huge). If you want the audit broken down into *every sub-tab*, I can expand this report by scanning each screen file and enumerating its internal sections + API endpoints.

---

## Manual flow test checklist (P2)

### Login
1. Email/password login
   - Expect: session written (`token`, `role`, `tenantId`, `tenantSlug`) and navigates to role home.
2. Code/PIN login
   - Expect: role and branch scope correct; waiter lands on `WAITER_DASHBOARD`.
3. Forgot password
   - Request OTP
   - Confirm OTP + set new password

### Branch select
1. Open `BRANCH_SELECT`
   - Expect: user/role display updates if session changes (impersonation / relogin) without refresh.
2. Select a branch
   - Expect: `mirachpos.owner.selectedBranchId.v1` set
   - Expect: `session.branchId` updated
   - Expect: navigates back to stored return screen

### Order -> Kitchen -> Pay -> Print (core POS)
1. Create order
   - Add items from `WAITER_MENU`
   - Review in `WAITER_REVIEW`
   - Send to kitchen
2. Kitchen flow
   - Verify order appears in `WAITER_STATUS` and/or `WAITER_KDS`
   - Mark as Ready/Served (as applicable)
3. Payment
   - Open `WAITER_PAYMENT`
   - Cash: tendered amount -> correct change
   - Split: pay one split and verify remaining unpaid
4. Receipt
   - Open `WAITER_RECEIPT`
   - Verify totals (subtotal/vat/service/tip/discount)
   - Print via browser/Electron

### Online payments (Chapa / Telebirr)
1. Chapa
   - Initiate checkout URL
   - Verify polling detects paid
2. Telebirr
   - QR display loads
   - Offline cache QR works when offline

### Owner plan upgrade -> invoice -> proof
1. Open `OWNER_BILLING`
2. Change plan -> invoice created
3. Pay online gateway redirect works
4. Bank transfer proof upload
   - Verify request has correct `X-Tenant` from session tenant slug
5. Download invoice PDF
   - Verify request has correct `X-Tenant` from session tenant slug
