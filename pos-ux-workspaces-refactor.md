# POS UX Workspaces Refactor (Waiter/Manager/Owner/Superadmin)

## Mission
Refactor the POS UX and supporting architecture into a professional, high-speed, low-error system comparable to Toast/Square **while preserving current business coverage**.

## Non-Negotiables
- Preserve **all existing business-critical flows** (order lifecycle, kitchen tickets, payments).
- Preserve **existing route compatibility**:
  - Existing `Screen` values continue to work.
  - Existing URL paths (derived from `Screen`) continue to load the correct surface.
- Rollout must be **feature-flagged** with an immediate rollback path.
- No hardcoded “fake” page data in UI. Use existing API/DB-backed data paths.

---

## Discovery Snapshot (As-Is)
### Route model
- App uses a `Screen` enum (`types.ts`) and `currentScreen` state in `App.tsx`.
- URL paths are derived from `Screen` (e.g. `WAITER_*` → `/waiter/*`).
- Access control enforced in `rbac.ts` via:
  - role → allowed screens
  - subscription module gates
  - permission gates

### Waiter screens (current)
- `WAITER_DASHBOARD` (Floor)
- `WAITER_MENU` (Order Builder; v1/v2 gated by `pos_ui_v2`)
- `WAITER_REVIEW`
- `WAITER_PAYMENT`
- `WAITER_RECEIPT`
- `WAITER_ACTIVE_ORDERS`
- Kitchen surfaces: `WAITER_STATUS`, `WAITER_KDS`, `WAITER_KITCHEN`
- `WAITER_EXPO` (gated by `kds_expo`)

### Manager screens (current)
- `MANAGER_DASHBOARD`, `MANAGER_ORDERS`, `MANAGER_ORDER_DETAILS`
- Table/floor: `TABLE_ASSIGNMENT`, `MANAGER_FLOOR_MAP`, `MANAGER_TABLE_DETAILS`
- `DESKTOP_DRAFT_INBOX`
- Inventory/menu/staff/settings/finance/reports

### Owner screens (current)
- HQ mode: dashboard/branches/reports/finance/inventory/staff
- Governance: billing/settings/audit/support
- Owner-as-manager mode exists when subscription lacks `owner_dashboard`

### Superadmin screens (current)
- Overview/tenants/tenant details
- Billing/payment config/integrations/addons
- System health/support/audit/feature flags/settings

---

## To-Be Information Architecture
### Workspaces
1) **Service Workspace** (waiter)
2) **Operations Workspace** (manager)
3) **Business Workspace** (owner)
4) **Platform Workspace** (superadmin)

### Workspace shell requirements
Each workspace provides:
- Persistent context bar
- Role-safe action set
- Alert center
- Command palette shortcuts

---

## Refactor Matrix (As-Is → To-Be)
### Service Workspace (Waiter)
- `WAITER_DASHBOARD` → Floor pane (Keep, refactor)
- `WAITER_MENU` (v1/v2) → Order Builder pane (Keep, consolidate)
- `WAITER_REVIEW` → Checkout/Summary sub-pane (Merge)
- `WAITER_PAYMENT` → Checkout/Split pane (Keep, refactor later)
- `WAITER_RECEIPT` → Receipt pane (Keep)
- `WAITER_ACTIVE_ORDERS` → Checks list (Merge into workspace)
- `WAITER_STATUS`/`WAITER_KDS`/`WAITER_KITCHEN` → Kitchen Status pane (Merge)
- `WAITER_EXPO` → Expo mode/pane (Keep; capability gated)
- `WAITER_NOTIFICATIONS` → Alert center (Merge)
- `WAITER_SYSTEM` → Device/Network panel (Merge)

### Operations Workspace (Manager)
- Orders list + details: merge into one module with drilldown
- Tables/floor: consolidate into one canonical module
- Draft inbox: elevate to Exceptions Queue
- Device health: first-class module

### Business Workspace (Owner)
- Maintain HQ IA; module gating should not abruptly swap entire IA

### Platform Workspace (Superadmin)
- Segment large config surfaces into safer task areas

---

## Implementation Strategy (Strangler Fig)
### Phase 1 (Now): Service Workspace Shell + Compatibility Routing
**Goal:** Introduce Service Workspace layout **behind a feature flag** and render existing waiter screens inside panes (no business logic changes).

Deliverables:
- Feature flag `service_workspace_v1`
- New `ServiceWorkspace` component that hosts panes
- Compatibility mapping from old `Screen.*` waiter screens → workspace pane
- Old waiter URLs remain functional

### Phase 1.1: Minimal Persistent Context Bar
**Goal:** Show table/order context persistently without altering core logic.

### Phase 2: Reduce navigation hops
- Merge Review into Checkout
- Convert Notifications/System into workspace panels
- Consolidate kitchen surfaces

### Phase 3: Guardrails + Failure UX
- PIN + reason for void/discount/refund
- Unified offline/error states

### Phase 4: KDS/Expo 2.0
- Station routing + SLA heat + immutable event timeline
- Offline-safe reconstruction

### Phase 5: Payment system refactor
- Unified payment state machine
- Idempotency keys end-to-end
- Payment timeline UI
- Day-end reconciliation console

---

## Acceptance Criteria
### Functional
- All existing order/payment lifecycle flows preserved.
- No regression in kitchen ticket creation and updates.

### UX performance
- Measurable tap/time reduction (tracked via telemetry) on:
  - open table → add first item
  - add items → send to kitchen
  - split → pay → close

### Reliability
- No duplicate charge on retries/webhooks.
- No lost kitchen ticket under reconnect scenarios.

### Testing
- Unit tests for state machines/rules
- Integration tests for core workflows
- Role/permission tests
- E2E happy + failure paths
