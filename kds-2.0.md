---
description: KDS 2.0 implementation plan (station-aware routing, course firing, expo readiness, SLA timers, append-only event log)
---

# KDS 2.0 Plan

## Goals
- Implement station-aware ticket routing, course firing, expo readiness, bump/recall, and SLA timers.
- Preserve backward compatibility with existing order flows and waiter screens.
- Enforce append-only event logs for every ticket transition.

## Non-goals (for this phase)
- Advanced analytics endpoints (beyond what is needed to power boards).
- Complex station configuration UI (use simple station identifiers and existing branch settings patterns).

## Current system notes (baseline)
- “KDS” today is order status (`Pending` -> `Cooking` -> `Ready` -> `Served`) in `orders` and UI screens like `WaiterKDS`.
- Realtime exists via SSE `/api/realtime/pos` and an in-process event hub (`api/src/services/realtimeHub.js`).
- Offline-first patterns exist via Electron outbox (`PosContext.tsx` uses outbox for HTTP + print jobs).
- Strict API validation exists via Zod middleware (`api/src/middleware/validators.js`).

## Data model (new)
### `kds_tickets`
Represents a station-scoped view of work derived from an order.
- Scope keys: `tenant_id`, `branch_id`, `order_id`
- Routing keys: `station` (string), `course_no` (int)
- Status: `NEW`, `FIRED`, `IN_PREP`, `READY`, `BUMPED`, `RECALLED`, `CANCELLED`
- Timing: `created_at`, `fired_at`, `ready_at`, `bumped_at`, plus `sla_ms` and `sla_due_at`

### `kds_ticket_items`
A denormalized set of order lines on a ticket.
- Links: `ticket_id`, optional `order_item_id` (from normalized `order_items`)
- Snapshot fields: `name`, `qty`, `voided_qty`, `notes`, `allergens_json`, `station`, `course_no`
- Per-item prep state: `HOLD`, `FIRED`, `IN_PREP`, `READY`, `BUMPED`, `VOIDED`

### `kds_events` (append-only)
Immutable event log for ticket transitions and item-level updates.
- Keys: `tenant_id`, `branch_id`, `ticket_id`, `event_type`
- Actor: `actor_staff_id`, `actor_role`
- Idempotency: `action_id` (client-provided), unique per `tenant_id` + `action_id`
- Payload: `payload_json`
- Timestamp: `created_at`

## State machine
### Ticket statuses
- `NEW` -> `FIRED`
- `FIRED` -> `IN_PREP`
- `IN_PREP` -> `READY`
- `READY` -> `BUMPED`
- `BUMPED` -> `RECALLED` (allowed within configurable window)
- `RECALLED` -> `IN_PREP` or `READY` (depending on station workflow)

### Legality rules
- Transitions must be validated server-side; illegal transitions return `409 conflict`.
- Every successful transition must write exactly one `kds_events` row.

### Idempotency
- Every action endpoint requires `actionId`.
- Duplicate `actionId` returns the same semantic result (no duplicate event, no extra mutation).

## API contracts (new)
All under `/api/pos/kds/*` with existing middleware:
- `tenantMiddleware`, `requireAuth`, `loadEntitlements`, `requireModule('pos')`, and `requireFeature/requireModule` for `kds` as applicable.

Endpoints:
- `POST /api/pos/kds/tickets/fire`
- `POST /api/pos/kds/tickets/:id/ready`
- `POST /api/pos/kds/tickets/:id/bump`
- `POST /api/pos/kds/tickets/:id/recall`
- `GET /api/pos/kds/board`

Board response must be reconstructable from events.

## Realtime + offline-safe rehydration
- Server publishes `pos.kds.*` events to existing realtime hub for SSE clients.
- Board clients:
  - Prefer SSE live updates.
  - On reconnect, rehydrate by calling `GET /api/pos/kds/board?sinceEventId=<lastSeen>` OR full board if missing.
- Electron offline:
  - Action endpoints are enqueued via existing outbox when offline.
  - On flush, duplicate `actionId` must be safe.

## Frontend deliverables
- `KitchenBoard`: station filter, Kanban columns, SLA heat indicators.
- `ExpoBoard`: grouped by order, show per-station readiness rollup.
- `TicketDetailDrawer`: ticket timeline, items, fire/ready/bump/recall actions.

## Backward compatibility
- Existing order status flows remain unchanged.
- KDS 2.0 is additive: tickets are derived from orders and do not replace `orders.status`.
- Existing `WaiterKDS` continues to operate; optionally enhance it later to read from KDS board.

## Tests
- Transition legality (unit tests for state machine + integration tests for endpoints).
- Duplicate action idempotency (same `actionId` twice).
- Board reconstruction from events (apply events fold -> expected board state).

## Rollout
- Migration first (additive tables).
- Ship API endpoints behind `kds` feature requirement.
- Ship frontend screens gated by entitlement/module.
- Monitor logs by `requestId` + actionId; verify no missing events.
