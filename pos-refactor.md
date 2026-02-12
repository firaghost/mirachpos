# POS Routes Refactor (api/src/routes/pos.js)

## Goal
Refactor the oversized `api/src/routes/pos.js` into smaller domain-specific routers under `api/src/routes/pos/` while preserving **all existing endpoint URLs and behaviors**.

## Non-Negotiables
- **No URL changes** (paths must remain identical).
- **No behavior changes**:
  - Keep middleware order (`tenantMiddleware`, `requireAuth`, `requireRole`, `loadEntitlements`, `requireModule`, `requirePermission`, etc.).
  - Keep validation, DB queries, side-effects, and response shapes/status codes the same.
- Avoid duplicated route registration (remove inline routes after mounting extracted sub-routers).
- Keep tests green after each extraction step.

## Extraction Strategy (Strangler-Fig)
1. Extract one cohesive block into `api/src/routes/pos/<domain>.js`.
2. Mount it from `makePosRouter()` using `r.use(makePos<Domain>Router())`.
3. Delete the original inline route handlers from `pos.js`.
4. Run `api` tests.

## Planned Modules (order = low risk first)
- `pos/shifts.js` (DONE)
- `pos/customerDisplay.js`
- `pos/printQueue.js`
- `pos/menu.js`
- `pos/loyalty.js`
- `pos/publicLinks.js` (payer/receipt/display links)
- `pos/gatewayPayments.js` (Telebirr/Chapa/SantimPay + payment-status endpoints)
- `pos/orders.js` (core order create/update/list/detail/refund/etc.)

## Verification Checklist (per extraction)
- Endpoints removed from `pos.js` are present in the extracted router.
- No duplicates when grepping `r.(get|post|put|delete)` in `pos.js`.
- `npm test` passes from `api/`.

## Notes
- If any helper is shared across multiple extracted routers, keep it in `pos.js` until the end, then consider moving shared helpers to `api/src/routes/pos/utils.js` (only if it reduces duplication without behavior drift).
