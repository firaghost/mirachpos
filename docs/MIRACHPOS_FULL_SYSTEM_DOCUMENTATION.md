# MirachPOS Full System Documentation and Growth Blueprint

## 1) Scope and analysis method

This document was prepared from a repository-level technical review of the web app, desktop runtime, API server, mobile app workspace, RBAC model, and operational docs.

Review inputs included:

- Root product and scripts (`README.md`, `package.json`).
- Frontend shell and navigation/routing (`App.tsx`, `types.ts`, `rbac.ts`, `api.ts`).
- API bootstrap and middleware pipeline (`api/src/index.js`, `api/src/app.js`, `api/src/config.js`, `api/src/db.js`).
- API surface and modules (`api/src/routes/**`, `api/src/services/**`, `api/migrations/**`).
- Electron desktop shell (`electron/main.mjs`).
- Mobile workspace (`mobile/package.json`, `mobile/src/**`).

High-level size snapshot (via local file counting):

- `screens`: 68 files
- `components`: 29 files
- `api/src/routes`: 66 files
- `api/migrations`: 63 files
- `mobile/src`: 88 files

---

## 2) What MirachPOS is today

MirachPOS is a **multi-surface, role-based restaurant POS platform** with:

- Web frontend (React + Vite + TypeScript).
- Desktop packaging/runtime (Electron).
- Server-side API (Node.js + Express + Knex + MySQL, with optional Redis and job workers).
- Mobile app workspace (Expo/React Native).
- Multi-tenant operation model (`X-Tenant` routing and tenant-aware API behavior).
- Role and permission model for waiter, waiter manager, branch manager, cafe owner, and super admin.

It is not a thin cashier app; it is a broader hospitality SaaS foundation spanning POS, reporting, owner controls, superadmin tooling, and integration/payment layers.

---

## 3) System architecture (current)

## 3.1 Frontend (web)

**Stack:** React 19 + TypeScript + Vite, with lazy-loaded screen modules and custom role-aware routing.

### Core frontend behavior

- `App.tsx` acts as a central app shell.
- Screen navigation uses a combination of:
  - internal `Screen` enum values,
  - path conversion helpers (`screenToPath`, `pathToScreen`),
  - session and last-screen persistence.
- Client session is managed via session helpers and browser storage.
- RBAC is enforced in-app with role checks + permission checks + subscription module checks.

### Role-based screen architecture

Screen groups are defined explicitly for:

- Waiter/waiter manager workflows.
- Branch manager workflows.
- Owner (global) workflows.
- Superadmin workflows.

This gives strong functional segmentation but also creates a large monolithic shell (`App.tsx`) that now carries significant orchestration complexity.

## 3.2 API/backend

**Stack:** Express + Knex + MySQL (+ Redis optional), with security middleware, metrics, webhooks, background jobs.

### API pipeline highlights

- Request IDs are injected early for observability.
- Helmet, compression, CORS, timeout control, rate limiting, and centralized error handling are wired.
- Health and metrics endpoints exist.
- Webhook raw-body handling is explicitly configured.
- Extensive route registration covers public, auth, owner, manager, waiter, POS, superadmin, support, integrations, and reporting areas.

### Operational/runtime characteristics

- Environment validation is run at process boot.
- Startup can initialize DB connectivity with retry logic (`initDb`).
- Optional cluster mode support and worker auto-respawn exist.
- Background services include scheduler and job workers.

## 3.3 Desktop runtime (Electron)

Desktop uses Electron as a secure shell:

- Context isolation and sandbox enabled.
- Can target local dev server in development.
- Can optionally spawn packaged API server if configured for local API origin.
- Includes auto-update integration and IPC channels for updater state and print workflows.

This is a strong foundation for a Toast-like dedicated terminal experience.

## 3.4 Mobile workspace

Mobile workspace is present with Expo + React Native + Zustand + React Query and generated dataconnect client artifacts.

This indicates multi-device ambition, though product parity and production maturity relative to web/desktop should be evaluated as a separate readiness stream.

---

## 4) Domain model and access model

## 4.1 Role model

Core roles:

- Waiter
- Waiter Manager
- Branch Manager
- Cafe Owner
- Super Admin

Each role maps to different home screens and screen-access sets.

## 4.2 Permission and module gating

Access control is layered:

1. Role-based screen visibility.
2. Permission-based checks (`hasPermission`, `requirePermission` patterns).
3. Subscription module gating (tier modules such as `pos`, `orders`, `tables`, `inventory`, etc.).

This is a solid SaaS-grade model, comparable in concept to entitlement matrices in mature POS products.

---

## 5) Current functional coverage map

From route/screen structure, MirachPOS covers major restaurant POS capabilities:

- POS table and order management.
- Waiter flows (menu, review, payment, receipt, KDS/status/history).
- Branch operations (orders, floor map, customers, staff, finance, settings, reports).
- Owner-level multi-branch visibility and controls.
- Superadmin tenancy and platform controls.
- Payment gateway hooks (Telebirr/Chapa related flows present).
- Printing and device-related APIs.
- Reporting/custom reports and export services.
- Support and audit-related flows.

The platform breadth is already larger than many early-stage POS apps.

---

## 6) End-to-end flow (how the system works today)

## 6.1 Authentication and tenant context

1. User logs in through auth endpoints.
2. Session token + role + tenant context is stored client-side.
3. API requests include auth bearer token.
4. Tenant is resolved in requests primarily via `X-Tenant` header (except superadmin-specific paths).
5. Backend middleware validates auth, tenant scope, permissions, modules.

## 6.2 POS order lifecycle

1. Staff selects table/floor context.
2. Items are added and order payload assembled client-side.
3. Order is submitted to POS/order endpoints.
4. Backend persists order records + related normalized rows (items/splits/payments).
5. Status progresses (pending/cooking/ready/served/paid/refunded/etc).
6. Receipt and kitchen print paths can be triggered.
7. Finance/inventory/loyalty side effects are applied where enabled.

## 6.3 Reporting and management loop

1. Operational data enters transactional tables via POS/staff/manager flows.
2. Reporting endpoints aggregate and expose branch/owner/superadmin analytics.
3. Owner and superadmin portals consume these results for oversight and decision-making.

## 6.4 Platform/admin loop

1. Tenant and plan settings configured via superadmin/admin routes.
2. Feature flags/modules and payment settings influence runtime behavior.
3. Cron/scheduler/worker services process async jobs and maintenance tasks.

---

## 7) Strengths and constraints

## 7.1 Strengths

- Broad functional scope across frontline, management, ownership, and platform layers.
- Clear role separation and entitlement model.
- Security and reliability middleware already present (rate limits, request IDs, health, structured boot checks).
- Desktop strategy already in place (critical for real-world restaurant operations).
- Multi-tenant architecture and sizable migration history indicate SaaS intent and data evolution discipline.

## 7.2 Constraints / technical debt signals

- App shell complexity (large orchestration in one central frontend entry).
- Large route surface area can drift in consistency (validation, error contracts, response formats).
- Multi-surface parity risk (web vs desktop vs mobile capability mismatch).
- Potentially uneven API schema governance across many modules.
- Need for stronger “productized” operational telemetry (SLO-linked dashboards, business event quality checks).

---

## 8) What to add and what to fix (prioritized)

## Priority 0 — Must-do foundations (before aggressive scaling)

1. **Unified API contract standardization**
   - Enforce one error envelope and success envelope format across all routes.
   - Add schema-first request/response validation and generated typings.

2. **Validation completion drive**
   - Ensure every write endpoint has strict validation and sanitization.
   - Add endpoint-level contract tests for invalid payloads and permission boundaries.

3. **Observability maturity**
   - Instrument business events (order created, sent-to-kitchen, ticket printed, payment authorized, payment settled, refund approved).
   - Create traceability from UI action -> request ID -> backend logs -> DB event.

4. **Offline and sync hardening plan**
   - Define explicit conflict resolution rules (table lock, item merge, payment idempotency).
   - Introduce deterministic reconciliation audit trails.

## Priority 1 — POS competitiveness accelerators

1. **KDS 2.0**
   - Course firing, expo mode, prep-time SLA indicators, bump analytics, station load balancing.

2. **Payments abstraction layer hardening**
   - Unified payment state machine across cash/card/mobile.
   - Full idempotency keys + retry-safe webhook processing.

3. **Hardware orchestration layer**
   - Canonical device registry (printer, display, scanner, drawer) + health status + remote diagnostics.

4. **Menu and pricing engine**
   - Dayparts, dynamic pricing, combo rules, forced modifiers, item availability by station/time.

## Priority 2 — Owner/superadmin differentiation

1. **Financial intelligence**
   - Prime cost dashboard, labor % vs sales, COGS drift, menu contribution margin.

2. **Tenant operations toolkit**
   - Feature rollout pipelines, audit-grade change history, tenant health scoring.

3. **Automated compliance packs**
   - Export packs for tax/regulatory needs and accounting handoff.

---

## 9) How to evolve toward Toast POS / Square POS level

Toast and Square win through **workflow polish + reliability + ecosystem**, not only feature count.

To get closer, MirachPOS should adopt a product operating model with three pillars:

## 9.1 Pillar A — Service reliability and trust

Target outcomes:

- Near-zero order loss.
- Deterministic payment reconciliation.
- Transparent failover behavior at branch level.

Execution themes:

- Idempotent write APIs everywhere.
- Outbox/event log for critical transaction events.
- POS “degraded mode” UX with guided recovery.
- Device/offline diagnostics surfaced to frontline staff in plain language.

## 9.2 Pillar B — Frontline speed and ergonomics

Target outcomes:

- Fewer taps to complete common actions.
- Faster order entry and modification under rush conditions.
- Kitchen coordination that reduces ticket times.

Execution themes:

- One-handed waiter mode, smart defaults, and modifier shortcuts.
- Predictive reorder and favorites by table/staff.
- KDS station choreography with SLA timers.

## 9.3 Pillar C — Ecosystem and extensibility

Target outcomes:

- Third-party integrations become a growth channel.
- Marketplace-style add-ons and partner APIs.

Execution themes:

- Public developer API with OAuth app model.
- Webhook catalog with signed replay-safe delivery.
- Integration sandbox + tenant-scoped API keys.

---

## 10) Recommended target flow (Toast/Square-style operating flow)

Use this as the “future-state” reference architecture for runtime behavior.

## 10.1 Open-of-day

1. Device health check (printer/KDS/display/network) with pass/fail and guided fixes.
2. Staff clock-in + role-based station assignment.
3. Cash drawer open and shift initialization with expected float.

## 10.2 Service flow

1. Seat/table activation.
2. Order capture with modifier guardrails and allergen prompts.
3. Course routing to stations/KDS.
4. Real-time status and expedite handling.
5. Bill split/merge with clear operator approvals.
6. Multi-method payment with idempotent finalization.
7. Auto receipt + optional digital receipt.

## 10.3 Mid-shift control

1. Manager exception queue (voids/discounts/comps).
2. Station backlog alerts.
3. Low-stock and outage alerts with substitution prompts.

## 10.4 End-of-day

1. Shift reconciliation (sales vs tenders vs expected cash).
2. Variance and anomaly report.
3. Scheduled backups and export pipeline.
4. Next-day readiness report (menu availability, staff coverage, device status).

---

## 11) 90-day implementation roadmap

## Days 1–30 (stabilize and standardize)

- API contract and validation sweep.
- Global error-envelope standardization.
- Payment + webhook idempotency audit.
- Baseline reliability dashboards.

## Days 31–60 (frontline speed + KDS)

- KDS 2.0 essentials.
- Order-entry friction reduction.
- Hardware/device status center.
- Offline conflict simulation and fixes.

## Days 61–90 (owner intelligence + ecosystem)

- Advanced owner finance metrics.
- Integration hardening and partner-facing docs.
- Tenant operations controls and rollout playbooks.
- Pilot “premium reliability mode” with select branches.

---

## 12) Final assessment

MirachPOS already has the breadth and architecture shape of a serious POS platform. The next leap is not “more screens”; it is **operational excellence, consistency, and ecosystem maturity**.

If the priorities above are executed in order, MirachPOS can move from a feature-rich POS into a **Toast/Square-class regional leader** with strong local payment and market alignment advantages.

---

## 13) POS Competitiveness Accelerators — Detailed Implementation Specification

This section is intentionally implementation-heavy so product, design, frontend, backend, and QA teams can execute with minimal ambiguity.

## 13.1 Accelerator A: KDS 2.0 (Kitchen Performance Engine)

### A. Product goal
Build a kitchen system that reduces ticket times, prevents missed items, and gives managers a live throughput view.

### B. Core capabilities
1. **Station-aware routing**
   - Route items by prep station (`grill`, `fry`, `bar`, `dessert`).
   - Split one order into multiple station tickets while keeping one parent order ID.
2. **Course firing**
   - Support `fire_now`, `hold`, `fire_on_next_course`, `manual_fire` states.
3. **Expo mode**
   - Consolidate readiness from all stations before final handoff.
4. **SLA timers**
   - Per item and per ticket timers with color states:
     - Green: `0-60%` of SLA
     - Yellow: `61-90%`
     - Red: `>90%`
5. **Bump analytics**
   - Track `start_prep_at`, `ready_at`, `bumped_at`, `handoff_at`.
6. **Recall/reopen**
   - Prevent irreversible mistakes when wrong ticket is bumped.

### C. Data model additions
- `kds_tickets`:
  - `id`, `tenant_id`, `branch_id`, `order_id`, `station`, `course_no`, `status`, `priority`, `created_at`, `fired_at`, `ready_at`, `bumped_at`
- `kds_ticket_items`:
  - `id`, `ticket_id`, `order_item_id`, `qty`, `voided_qty`, `notes`, `allergens`, `prep_state`
- `kds_events` (append-only):
  - `id`, `ticket_id`, `event_type`, `actor_staff_id`, `payload_json`, `created_at`

### D. API endpoints
- `POST /api/pos/kds/tickets/fire`
- `POST /api/pos/kds/tickets/:id/ready`
- `POST /api/pos/kds/tickets/:id/bump`
- `POST /api/pos/kds/tickets/:id/recall`
- `GET /api/pos/kds/board?station=<station>`
- `GET /api/pos/kds/analytics?from=<iso>&to=<iso>`

### E. UI views to implement/modify
1. **Kitchen Board View**
   - Columns: `New`, `In Prep`, `Ready`, `Expedite`.
   - Filters: station, course, priority, order type.
2. **Expo View**
   - Group by order; show station readiness map.
3. **Ticket Detail Drawer**
   - Item modifiers, allergy flags, hold/fire controls, notes, history timeline.

### F. Acceptance criteria
- No ticket may disappear without event log.
- Reconnect after offline period restores exact board state.
- P95 ticket board refresh latency < 800ms (intra-branch).

---

## 13.2 Accelerator B: Payment Abstraction + Reliability Layer

### A. Product goal
Make payments deterministic across cash/card/mobile with zero double-charge and auditable reconciliation.

### B. Unified payment state machine
States:
- `initialized`
- `pending_authorization`
- `authorized`
- `capture_pending`
- `captured`
- `failed`
- `voided`
- `refunded_partial`
- `refunded_full`

Rules:
- Only legal transitions are allowed.
- Every transition writes to `payment_events` append-only log.
- All external callbacks/webhooks must be idempotent.

### C. Data model additions
- `payments`: transaction summary record
- `payment_attempts`: each retry/attempt
- `payment_events`: immutable state transitions
- `reconciliation_batches`: day-end settlement grouping

### D. API + integration hardening
- Require `Idempotency-Key` for all payment-create/capture/refund endpoints.
- Store hash of request payload + idempotency key for mismatch prevention.
- Webhook verification required (signature + timestamp + nonce replay window).

### E. UI views
1. **Checkout pane redesign**
   - Method chips: Cash/Card/Telebirr/Chapa/House Account.
   - Real-time status badge and retry guidance.
2. **Payment timeline modal**
   - Attempt history + webhook status + operator + timestamps.
3. **End-of-day reconciliation view**
   - Expected vs settled totals by method.

### F. Acceptance criteria
- Same idempotency key never creates second capture.
- Duplicate webhook receives 200 but performs no duplicate mutation.
- Reconciliation report reproducible from ledger + payment events only.

---

## 13.3 Accelerator C: Hardware Orchestration Platform

### A. Product goal
Treat printers/displays/drawers as managed assets with health, policy, fallback, and diagnostics.

### B. Capabilities
- Device registry with branch-scoped assignment.
- Primary/fallback printer routing per ticket type.
- Heartbeat and health state (`online`, `degraded`, `offline`).
- Remote test print and diagnostics.
- Capability matrix (USB/LAN/Bluetooth, paper width, ESC/POS features).

### C. Data model
- `devices`
- `device_capabilities`
- `device_heartbeats`
- `print_jobs`
- `print_job_attempts`

### D. UI pages
1. **Device Fleet Manager (manager settings)**
   - List + status + last heartbeat + assigned flows.
2. **Print Queue Monitor**
   - Jobs by state, retry actions, dead-letter queue.
3. **Device Policy Editor**
   - For each branch: receipt, kitchen, bar, customer-display routing rules.

### E. Acceptance criteria
- If primary printer is offline, job auto-routes to fallback within 3s.
- Every failed print has actionable error category and retry policy trace.

---

## 13.4 Accelerator D: Menu, Pricing, and Availability Engine

### A. Product goal
Deliver enterprise-grade menu controls with real-time availability and rule-based pricing.

### B. Capabilities
- Daypart menus (breakfast/lunch/dinner/night).
- Modifier groups (`required`, `optional`, min/max constraints).
- Combo/bundle pricing and upcharge rules.
- Branch-level overrides from global menu templates.
- 86ing (item unavailable) with auto-kitchen/FOH propagation.

### C. Data model
- `menu_catalogs`, `menu_items`, `modifier_groups`, `modifier_options`, `pricing_rules`, `availability_windows`, `branch_menu_overrides`

### D. UI pages
1. **Visual Menu Builder**
   - Drag/drop categories + item cards + modifiers.
2. **Rule Builder**
   - “If time/day/branch/order_type then price/modifier visibility.”
3. **Availability Console**
   - Live toggle with reason (`out_of_stock`, `equipment_down`, `promo_stop`).

### E. Acceptance criteria
- Invalid modifier combinations blocked at UI and API validation levels.
- Availability changes propagate to waiter ordering UI in < 1 second.

---

## 13.5 Accelerator E: Frontline UX Speed Kit (Toast/Square-grade interactions)

### Must-have UX changes
1. **Quick actions ribbon**
   - `Repeat last`, `Popular combos`, `Split equally`, `Send all`, `Fire next`.
2. **One-handed mode**
   - Bottom thumb zone actions for tablets.
3. **Contextual defaults**
   - Auto-select frequent modifier combinations by item/time/staff.
4. **Shift-safe confirmations**
   - High-risk actions require PIN + reason (`void`, `discount > threshold`, `refund`).
5. **Zero-friction table transfer**
   - Transfer table with ownership and printed history intact.

### UX performance SLOs
- Open table -> first item add: P50 < 2.0s
- Add item -> send to kitchen: P50 < 1.5s
- Checkout initiate -> payment confirmation: P50 < 4.0s (cash), < 8.0s (digital)

---

## 14) Detailed Page Design Modification Guide

Use this guide for redesigning existing views to enterprise POS quality.

## 14.1 Waiter Dashboard (Floor + Table Grid)

### Layout
- Left rail: area filters and section occupancy stats.
- Main: adaptive table canvas with occupancy colors + elapsed timer.
- Right drawer: selected table summary (open checks, seat count, assigned staff).

### Interactions
- Single tap: table summary.
- Double tap: open order builder.
- Long press: quick actions (`transfer`, `merge`, `split`, `request manager`).

### Visual language
- Color-safe status palette and icon reinforcement.
- Live badges: `new item`, `payment pending`, `kitchen delayed`.

## 14.2 Order Builder Screen

### Layout
- Top: table/order context + guest count + timer.
- Left: category tabs + search + favorites.
- Center: product grid with availability and prep-time chips.
- Right: cart with modifier editor and send controls.

### Advanced interactions
- Batch apply modifier to multiple items.
- Hold/fire per line item.
- Seat tagging for split checks.

## 14.3 Checkout + Split View

### Layout
- Header: total, tax, service, discounts, comps.
- Body: split designer (by seat/item/equal/custom).
- Footer: payment action rail with method-specific forms.

### Controls
- Multi-tender support.
- Manager override for high discount or refund rules.
- Recoverable failed payment with guided retries.

## 14.4 KDS + Expo Boards

### Layout
- Multi-column Kanban plus SLA heat indicators.
- Priority lane for expedite or delayed tickets.
- Expo board grouped by order with station readiness map.

## 14.5 Manager Control Center

### Tabs
- Live operations, exception queue, staff activity, device health, low-stock alerts.
- Alert center with acknowledgment workflow.

## 14.6 Owner Command Center

### Tabs
- Multi-branch sales health, labor %, COGS trend, promo ROI, payment settlement status.
- Drill-down from global -> branch -> shift -> transaction.

---

## 15) AI Implementation Prompt Pack (copy/paste-ready)

Use these prompts with your coding AI. Replace placeholders (`<...>`) with your repo specifics.

## Prompt 1 — KDS 2.0 architecture and implementation

```text
You are a senior staff engineer. Implement KDS 2.0 in this POS repository.

Goals:
1) Add station-aware ticket routing, course firing, expo readiness, bump/recall, and SLA timers.
2) Preserve backward compatibility for current order flows.
3) Enforce append-only event logs for every ticket transition.

Deliverables:
- DB migrations for kds_tickets, kds_ticket_items, kds_events.
- API routes:
  - POST /api/pos/kds/tickets/fire
  - POST /api/pos/kds/tickets/:id/ready
  - POST /api/pos/kds/tickets/:id/bump
  - POST /api/pos/kds/tickets/:id/recall
  - GET /api/pos/kds/board
- Frontend screens:
  - KitchenBoard
  - ExpoBoard
  - TicketDetailDrawer
- Real-time updates and offline-safe rehydration.
- Tests:
  - state transition legality
  - duplicate action idempotency
  - board reconstruction from events

Constraints:
- Use existing middleware (auth, tenant, permissions, entitlements).
- Add strict input validation schemas.
- Add clear telemetry logs with requestId correlation.

Output format:
1) architecture summary
2) migration files
3) route/service implementation
4) frontend implementation
5) tests + run commands
6) rollout notes
```

## Prompt 2 — payment reliability and idempotency

```text
Refactor POS payments into a unified payment state machine with full idempotency.

Requirements:
- Introduce states: initialized, pending_authorization, authorized, capture_pending, captured, failed, voided, refunded_partial, refunded_full.
- Add Idempotency-Key support to create/capture/refund APIs.
- Add immutable payment_events table.
- Ensure webhook handlers are signature-verified and replay-safe.
- Expose a PaymentTimeline UI showing attempts/events.
- Build reconciliation report endpoint by payment method/day/branch.

Acceptance:
- Duplicate client retry with same idempotency key must not duplicate capture.
- Duplicate webhook must be no-op after first successful mutation.
- Reconciliation totals must match ledger and payment events.

Provide:
- migration scripts
- API/service code
- test suite updates
- UI changes
- backward compatibility strategy
```

## Prompt 3 — hardware/device orchestration

```text
Implement a hardware orchestration module for POS devices.

Scope:
- Device registry with assignment policies.
- Heartbeat health model (online/degraded/offline).
- Print queue with retry + dead-letter handling.
- Primary/fallback printer routing by print job type.

Frontend pages:
- DeviceFleetManager
- PrintQueueMonitor
- DevicePolicyEditor

Backend:
- device CRUD endpoints
- heartbeat ingest endpoint
- print dispatch service with failover
- structured error taxonomy for print failures

Tests:
- failover behavior when primary printer offline
- retry policy execution
- dead-letter visibility
```

## Prompt 4 — menu/pricing rule engine

```text
Build a rule-based menu and pricing engine suitable for enterprise POS.

Features:
- dayparts
- modifier constraints (required/min/max)
- bundle pricing
- branch overrides
- real-time availability (86ing)

Need:
- schema + migration
- API for rule CRUD and evaluation
- waiter UI integration with validation
- manager Rule Builder UI
- automated tests for rule evaluation edge cases

Success criteria:
- price and availability are deterministic for any time/branch/order type
- invalid modifier selection blocked in UI and API
```

## Prompt 5 — complete UX redesign toward Toast/Square

```text
Act as a principal product designer + frontend architect.
Redesign the POS experience to be Toast/Square competitive while preserving existing business logic.

Design goals:
- speed under rush-hour
- low cognitive load
- high error recoverability

Deliver:
1) IA map for waiter, manager, owner workflows
2) high-fidelity screen specs (layout, states, empty/error/loading)
3) component library updates (buttons, cards, status chips, drawers, keyboard shortcuts)
4) interaction specs (tap, long-press, swipe, keyboard)
5) accessibility specs (contrast, target sizes, focus, screen reader labels)
6) implementation plan with file-by-file refactor sequence

Also provide:
- new routes/screens list
- migration strategy from old screens
- test plan (unit + integration + UAT checklists)
```

---

## 16) Documentation standards for engineering handoff

To ensure any engineer can execute quickly, each new module doc should include:

1. Purpose and scope
2. Data model and migration references
3. API contracts (request/response + error codes)
4. Security and permission model
5. UI states and interactions
6. Telemetry events and dashboards
7. QA scenarios and expected outcomes
8. Rollout strategy and rollback plan

This standard should be applied to KDS, Payments, Devices, Menu/Pricing, and Checkout redesign streams.

---

## 17) Current UI Deep Analysis (page-by-page refactor baseline)

This section translates the current screen structure into a practical redesign map so the next AI implementation can refactor with clear intent.

## 17.1 Navigation and IA baseline from current code

Current screen inventory indicates these role clusters:

- **Entry/Core**: Login, BranchSelect, POS, Orders, Reports, Settings, ShiftSchedule, Staff, Guests, Inventory, Finance.
- **Waiter cluster**: WaiterDashboard, WaiterMenu, WaiterOrderReview, WaiterPayment, WaiterReceipt, WaiterActiveOrders, WaiterOrderStatus, WaiterKDS, WaiterHistory, WaiterNotifications, WaiterSystemStatus, WaiterSettings, WaiterShiftReport, WaiterDraftSim.
- **Manager cluster**: BranchDashboard, BranchOrders, BranchOrderDetails, ManagerFloorMap, ManagerTableDetails, ManagerCustomers, ManagerTeam, MenuBuilder, RecipeBuilder, BranchReports, BranchSettings.
- **Owner cluster**: OwnerDashboard, OwnerBranches, OwnerFinance, OwnerInventory, OwnerStaffManagement, GlobalReports, OwnerAudit, OwnerBilling, OwnerOnboarding.
- **Superadmin cluster**: Overview, Tenants, TenantDetails, Onboarding, Billing, PaymentConfig, PlansMatrix, FeatureFlags, Integrations, Addons, Support, Audit, SystemHealth, Settings.

### IA issue observed
The product has rich coverage but navigation and workflow continuity are fragmented by role-specific screens that sometimes overlap in purpose.

### IA redesign principle
Move to **task-first IA** instead of page-first IA:

- Service (floor, orders, kitchen, checkout)
- Operations (inventory, staffing, device health, exceptions)
- Management (reports, finance, compliance)
- Platform (tenant, plans, feature flags, integrations)

---

## 17.2 Waiter flow analysis and redesign targets

### Current page set (from code)
- WaiterDashboard (floor/tables)
- WaiterMenu (order builder)
- WaiterOrderReview
- WaiterPayment
- WaiterReceipt
- WaiterActiveOrders
- WaiterOrderStatus / WaiterKDS
- WaiterHistory / Notifications / Settings / SystemStatus / ShiftReport

### Pain points to eliminate
1. Too many sequential screens for one service journey.
2. Review/payment/receipt can feel disconnected from table context.
3. Operational alerts (kitchen delay, connectivity, payment retry) are not centralized in one “service HUD”.

### Refactor target
Implement a **single Service Workspace** with tabbed subpanes:

- Pane A: Floor
- Pane B: Order Builder
- Pane C: Kitchen Status
- Pane D: Checkout & Split
- Pane E: Receipt & Follow-up

All panes preserve same `order context`, `table context`, and `guest context`.

---

## 17.3 Manager flow analysis and redesign targets

### Current page set
- BranchDashboard, BranchOrders, BranchOrderDetails
- ManagerFloorMap, ManagerTableDetails
- ManagerCustomers, ManagerTeam
- MenuBuilder, RecipeBuilder
- BranchReports, BranchSettings

### Pain points to eliminate
1. “Live operations” and “configuration” are mixed in navigation.
2. Exception workflows (voids, discounts, failed payments, kitchen delays) are not unified.

### Refactor target
Create a **Manager Control Center** with fixed modules:

- Live Ops board
- Exceptions queue
- People & shifts
- Menu & recipes
- Device health
- Reports snapshot

---

## 17.4 Owner flow analysis and redesign targets

### Current page set
- OwnerDashboard, OwnerBranches, OwnerFinance, OwnerInventory
- OwnerStaffManagement, GlobalReports, OwnerAudit, OwnerBilling, OwnerOnboarding

### Pain points to eliminate
1. Weak drill-down continuity from global KPI to branch root cause.
2. Billing/plan impact not clearly connected to feature availability and branch performance.

### Refactor target
Create an **Owner Command Center** with hierarchy drill:

`Global KPI -> Region/Branch -> Shift -> Order -> Payment event`

Must include cross-branch alert feed and profitability heatmaps.

---

## 17.5 Superadmin flow analysis and redesign targets

### Current page set
- Tenants, Billing, PaymentConfig, FeatureFlags, Integrations, Support, Audit, SystemHealth, etc.

### Refactor target
Create a **Platform Operations Cockpit**:

- Tenant lifecycle pipeline
- Plan/feature governance matrix
- Incident center (health + support + payment reliability)
- Risk/compliance monitor (audit anomalies, auth risks)

---

## 17.6 Shared UX debt list (must be fixed in full refactor)

1. Inconsistent loading/empty/error states between screens.
2. Non-unified action hierarchy (`primary`, `secondary`, `danger`, `manager-approval`).
3. Missing keyboard command system for desktop-heavy usage.
4. Fragmented status language across orders/kitchen/payments.
5. Mixed information density and card styles reducing scan speed.

---

## 18) Master AI Prompt for Full Refactor (based on current UI code)

Use this single prompt to drive a complete, professional, Toast/Square-style transformation.

```text
You are a principal architect + staff product designer + senior full-stack engineer.
You are working on an existing multi-role POS codebase with current screens grouped into waiter, manager, owner, and superadmin modules.

Mission:
Fully refactor the POS UX and supporting architecture into a professional, high-speed, low-error system comparable to Toast/Square while preserving current business coverage.

Critical instruction:
First analyze all existing screen files and current route mappings, then produce a delta plan and implement iteratively.
Do not invent from scratch without mapping old->new behavior.

==================================================
A) DISCOVERY (MANDATORY FIRST OUTPUT)
==================================================
1. Parse and inventory every screen/component route currently used by each role.
2. Build an "As-Is Flow Map" for:
   - Waiter service flow
   - Manager operations flow
   - Owner oversight flow
   - Superadmin platform flow
3. For each flow, identify:
   - friction points
   - redundant navigation hops
   - high-risk error moments
   - inconsistent UI patterns
4. Output a "Refactor Matrix":
   - Old screen -> New module/pane
   - Keep/merge/remove decision
   - migration risk level

==================================================
B) TARGET INFORMATION ARCHITECTURE
==================================================
Implement task-first IA:
1. Service Workspace (waiter)
2. Operations Workspace (manager)
3. Business Workspace (owner)
4. Platform Workspace (superadmin)

Each workspace must define:
- persistent context bar
- role-safe action set
- alert center
- command palette shortcuts

==================================================
C) WAITER REDESIGN (PRODUCTION-GRADE)
==================================================
Build one unified Service Workspace with panes:
- Floor
- Order Builder
- Kitchen Status
- Checkout/Split
- Receipt

Requirements:
1. Keep table/order context persistent when switching panes.
2. Reduce core action taps:
   - open table -> add first item
   - add items -> send to kitchen
   - split -> collect payment -> close check
3. Add quick actions: repeat last, top sellers, split equally, transfer table, manager assist.
4. Add guardrails for void/discount/refund with PIN + reason.
5. Add robust failure UX for network/payment/device failures with clear recovery.

==================================================
D) KDS + EXPO REDESIGN
==================================================
1. Station routing + course control + hold/fire mechanics.
2. Expo consolidation by order with readiness map.
3. SLA timer heat visualization and backlog alerts.
4. Bump/recall with immutable event timeline.
5. Realtime sync with offline-safe reconstruction.

==================================================
E) PAYMENT SYSTEM REFACTOR
==================================================
1. Implement unified payment state machine.
2. Add idempotency keys end-to-end.
3. Add payment timeline UI.
4. Add day-end reconciliation console.
5. Add webhook replay defense and signature enforcement.

==================================================
F) MANAGER/OWNER/SUPERADMIN REDESIGN
==================================================
Manager:
- Live ops dashboard
- Exceptions queue
- staff + station load view
- device health panel

Owner:
- global KPI board
- branch drill-down stack
- profitability and labor intelligence
- settlement and risk monitor

Superadmin:
- tenant lifecycle operations
- feature/plan governance
- platform health + incident command
- compliance/audit anomaly views

==================================================
G) DESIGN SYSTEM + INTERACTION SPEC
==================================================
1. Define a unified component system:
   - layout shell
   - cards
   - status chips
   - drawers/modals
   - toast/alerts
   - keyboard command palette
2. Define states for all pages:
   - loading
   - empty
   - error
   - offline
   - permission denied
3. Accessibility:
   - target size minimums
   - contrast standards
   - keyboard-only usage
   - screen reader labels

==================================================
H) ENGINEERING IMPLEMENTATION PLAN
==================================================
Provide and execute:
1. File-by-file migration plan with sequence.
2. Route transition strategy (old paths compatibility layer).
3. API adjustments and schema migrations.
4. Feature flags to roll out new UX safely.
5. Telemetry events for every critical user action.

==================================================
I) QUALITY + ACCEPTANCE CRITERIA
==================================================
1. Functional:
   - all existing business-critical flows preserved
   - no regression in order/payment lifecycle
2. UX performance:
   - measurable tap/time reduction on key actions
3. Reliability:
   - no duplicate charge on retries/webhooks
   - no lost kitchen ticket under reconnect scenarios
4. Test suite:
   - unit tests (state machines/rules)
   - integration tests (core workflows)
   - role-permission tests
   - E2E happy + failure paths

==================================================
J) OUTPUT FORMAT (STRICT)
==================================================
Return in this order:
1. As-Is analysis summary
2. To-Be IA and workflow map
3. Screen-by-screen redesign spec
4. Data/API changes
5. Stepwise implementation plan
6. Testing plan
7. Rollout/rollback plan
8. Risks and mitigations

When implementing code, commit in logical phases and explain each phase clearly.
```

---

## 19) AI Prompt Add-on: “Explain what you build and why” mode

Use this add-on under any prompt above so AI explains intent and implementation clearly:

```text
For every module you implement, include:
1) plain-language explanation (what it is)
2) business value (why it matters)
3) technical design (how it works)
4) integration points (which existing modules it touches)
5) edge cases and failure handling
6) tests written and what they prove
7) operator runbook notes (how staff/manager should use it)
Do not skip these sections.
```

---

## 20) Recommended execution order for your team

1. Build design system + workspace shell first.
2. Refactor waiter workspace and checkout (highest frontline impact).
3. Upgrade KDS/expo.
4. Upgrade payment reliability and reconciliation.
5. Refactor manager control center.
6. Refactor owner command center.
7. Refactor superadmin cockpit.
8. Finalize telemetry, QA hardening, and staged rollout.

This order maximizes user-visible quality early while reducing operational risk.
