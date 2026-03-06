---
description: Unified POS payments state machine with idempotency, immutable event ledger, webhook replay safety, UI timeline, and reconciliation.
---

# Goals

- Unify payment flow behind a single state machine.
- Full idempotency for client retries (create/capture/refund).
- Immutable append-only audit log of all payment mutations.
- Webhook handling with signature verification and replay safety.
- Reconciliation reporting by branch/day/payment method that matches ledger.
- Backward compatibility for existing APIs and UI.

# Codebase reality (discovery)

## Existing tables already in use

- `payments` + `invoices` (subscription billing domain)
- `pos_payment_gateway_transactions` (POS gateway attempt tracking)
- `order_payments` (POS normalized snapshot of payments on an order)
- `idempotency_keys` (global dedupe store)
- `webhook_events` (replay-safe webhook dedupe store)

## Existing gateway flows

### POS flows today

- Chapa POS: `init -> pending` then `webhook success` OR `verify polling` marks order paid and marks tx as completed.
- SantimPay POS: `init -> pending` then `webhook COMPLETED` OR `verify polling` marks order paid and marks tx as completed.
- Telebirr POS: init endpoint exists, but webhook route is currently placeholder. Treat as "pending" until verification/webhook is implemented.

Implication: POS gateways are **single-step capture** in practice (no separate authorize/capture today).

# State machine

## States

- `initialized`
- `pending_authorization`
- `authorized`
- `capture_pending`
- `captured`
- `failed`
- `voided`
- `refunded_partial`
- `refunded_full`

## Core invariants

- A payment has exactly one current `state`.
- All state changes are recorded in `payment_events` (append-only).
- Mutations are idempotent by `(tenant_id, idempotency_key, operation)`.
- Webhook processing is replay-safe by unique `(provider, provider_event_id)`.

## Allowed transitions (high level)

- `initialized` -> `pending_authorization` | `authorized` | `failed`
- `pending_authorization` -> `authorized` | `failed` | `voided`
- `authorized` -> `capture_pending` | `voided` | `failed`
- `capture_pending` -> `captured` | `failed`
- `captured` -> `refunded_partial` | `refunded_full`
- `refunded_partial` -> `refunded_partial` | `refunded_full`
- Any -> `failed` only via provider failure events and must be terminal for that attempt

## Gateway-to-state mapping (current)

### POS (`pos_payment_gateway_transactions`)

Current `status` values observed:

- `pending`
- `completed`

Unified `state` mapping:

- `pending` -> `pending_authorization` (meaning "waiting for gateway result")
- `completed` -> `captured`

Failure mapping (to be implemented):

- expiry or explicit gateway failure -> `failed`
- cancellation/void -> `voided`

### Subscription billing (`payments` table)

Current `payments.status` values observed:

- `pending`
- `verified`
- `rejected`
- `refunded`

Unified `state` mapping:

- `pending` -> `pending_authorization`
- `verified` -> `captured`
- `rejected` -> `failed`
- `refunded` -> `refunded_full` (or `refunded_partial` when partial supported)

# Data model

## New table: `payment_events` (append-only)

Purpose: immutable timeline for UI, reconciliation, audit, and replay-safe webhook processing.

Columns (proposed):

- `id` (pk)
- `tenant_id`
- `branch_id`
- `payment_id`
- `order_id`
- `event_type` (string)
- `from_state` (nullable)
- `to_state` (nullable)
- `amount` (nullable)
- `currency` (nullable)
- `payment_method` (nullable)
- `provider` (nullable)
- `provider_payment_id` (nullable)
- `provider_event_id` (nullable)
- `idempotency_key` (nullable)
- `request_hash` (nullable)
- `actor_type` (system|staff|webhook)
- `actor_id` (nullable)
- `payload_json` (nullable)
- `created_at`

Constraints (proposed):

- Index: `(tenant_id, payment_id, created_at)`
- Unique: `(tenant_id, idempotency_key, event_type)` where `idempotency_key` is not null
- Unique: `(tenant_id, provider, provider_event_id)` where `provider_event_id` is not null

Event types (initial):

- `payment.initialized`
- `payment.gateway.initiated`
- `payment.authorize.requested`
- `payment.authorize.succeeded`
- `payment.authorize.failed`
- `payment.capture.requested`
- `payment.capture.succeeded`
- `payment.capture.failed`
- `payment.refund.requested`
- `payment.refund.succeeded`
- `payment.refund.failed`
- `payment.voided`
- `webhook.received`
- `webhook.duplicate_ignored`

## Payments table

Keep existing `payments` table as source of truth for current state, but add:

- `state` (new, nullable for backfill)
- `provider` / `provider_payment_id` (if not present)
- `authorized_amount`, `captured_amount`, `refunded_amount`
- `last_idempotency_key` (optional convenience)

## POS canonical record (decision)

POS canonical record for this build: **extend `pos_payment_gateway_transactions`** (choice A)

Add fields to support state machine + idempotency + event linking:

- `state` (new)
- `idempotency_key` (new)
- `request_hash` (new)
- `captured_at` (new, can reuse `paid_at` but keep explicit)
- `refunded_amount` (new)
- `voided_at` (new)

# API changes

## Idempotency-Key

- Support `Idempotency-Key` header on:
  - create payment
  - capture
  - refund

Rules:

- First request creates the event and applies state transition.
- Retry with same key returns the same response and does not duplicate captures/refunds.
- If same key is reused with a different request body, return 409.

## Endpoints (conceptual)

- `POST /api/pos/payments` create/init
- `POST /api/pos/payments/:id/authorize` (if applicable)
- `POST /api/pos/payments/:id/capture`
- `POST /api/pos/payments/:id/refund`
- `GET /api/pos/payments/:id/events` timeline
- `GET /api/pos/reports/reconciliation/payments?branchId=&day=&method=`

# Webhooks

- Verify signatures using provider secret.
- Store raw webhook and processing result as `payment_events`.
- Use unique `(provider, provider_event_id)` to ensure duplicates are no-op.
- State transitions from webhook must be validated against current state and be idempotent.

Existing replay safety:

- `webhook_events` already dedupes by `(gateway,event_key)`.
- This build will keep it, but also write into `payment_events` so UI/reconciliation uses a single source.

# UI: PaymentTimeline

- Show chronological events with:
  - state transitions
  - attempts
  - provider ids
  - amounts
  - failures

# Reconciliation

- Endpoint returns totals grouped by day/branch/payment_method.
- Totals derived from `payment_events` of type capture/refund (and possibly void).
- Must match ledger fields on `payments`.

# Backward compatibility

- Keep existing endpoints operational.
- Internally map legacy status fields to new `state`.
- Backfill `payments.state` for existing rows.
- Dual-write: on any legacy mutation, also append `payment_events`.

# Rollout Plan

## Phase 1: Schema Migration (Week 1)

**Actions:**
1. Run migration `062_payment_events_and_states.js` to create:
   - `payment_events` table
   - New columns on `pos_payment_gateway_transactions` (state, idempotency_key, request_hash, captured_at, refunded_amount, voided_at)
   - New columns on `payments` (state, provider, provider_payment_id, authorized_amount, captured_amount, refunded_amount, last_idempotency_key)

**Rollback:**
- Migration has `down()` that drops new columns and table if needed

## Phase 2: Deploy Backend Service (Week 1-2)

**Actions:**
1. Deploy `paymentEventsService.js` (no breaking changes - it's new code)
2. Deploy updated webhook handlers with:
   - Existing signature verification (unchanged)
   - Added `safeAppendPaymentEvent()` calls (wrapped in try/catch)
   - Added state/captured_at updates to existing table updates

**Backward Compatibility:**
- Webhook handlers still respond the same way to gateways
- POS order status updates remain unchanged
- New fields are nullable; old code doesn't break

## Phase 3: Deploy POS Payment Routes (Week 2)

**Actions:**
1. Deploy updated POS payment init endpoints:
   - `POST /pos/orders/:id/pay-chapa`
   - `POST /pos/orders/:id/pay-santimpay`
   - `POST /pos/orders/:id/pay-telebirr`
2. Deploy refund endpoint updates:
   - `POST /pos/orders/:id/refund`

**Idempotency:**
- Clients can optionally send `Idempotency-Key` or `X-Idempotency-Key` header
- Without header, behavior is same as before (no idempotency enforced)

## Phase 4: Deploy API Endpoints (Week 2-3)

**Actions:**
1. Deploy new endpoints:
   - `GET /pos/orders/:id/payment-timeline`
   - `GET /pos/reports/reconciliation/payments`
2. These are read-only and don't affect existing functionality

## Phase 5: Frontend Integration (Week 3-4)

**Actions:**
1. Import and use `PaymentTimeline` component where needed
2. Example usage:
   ```tsx
   import PaymentTimeline from '../components/PaymentTimeline';
   
   // In order detail screen:
   <PaymentTimeline orderId={order.id} refreshInterval={30000} />
   ```

## Verification Checklist

- [ ] Migration runs successfully in staging
- [ ] Existing POS payments still work without Idempotency-Key header
- [ ] Webhooks still process correctly (signature verify + order updates)
- [ ] Duplicate webhooks are no-ops (replay safe)
- [ ] Idempotent retries return same response without double-capture
- [ ] Refund partial vs full logic works correctly
- [ ] PaymentTimeline API returns events for an order
- [ ] Reconciliation API totals match expected values
- [ ] All tests pass: `npm test -- paymentStateMachine.test.js`

## Rollback Procedure

If issues are detected:

1. **Immediate:** Revert the last deployment (routes file changes)
2. **Database:** Run migration down: `npx knex migrate:down`
3. **Verification:** Confirm old behavior restored

## Post-Rollout Monitoring

Monitor for 1 week:
- Webhook processing latency
- Duplicate webhook rate (should see deduplication working)
- Idempotency key usage (if any clients start using it)
- Payment_events table growth rate
- Any errors in `safeAppendPaymentEvent` (should be none)

# Tests

- Unit tests:
  - transition legality
  - idempotency request hash mismatch -> 409
- Integration tests:
  - duplicate capture request with same idempotency key does not double capture
  - duplicate webhook is no-op
  - reconciliation totals match events and payment aggregates
