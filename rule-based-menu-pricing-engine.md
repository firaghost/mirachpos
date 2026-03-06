# Rule-Based Menu & Pricing Engine (Enterprise)

## Goal
Build a deterministic, rule-based menu and pricing engine suitable for enterprise POS.

**Success criteria**
- Deterministic price + availability for any `(tenant, branch, orderType, time, cart)`.
- Invalid modifier selection blocked in **UI and API**.

## Scope
### Features
- Dayparts
- Modifier constraints (required/min/max)
- Bundle pricing
- Branch overrides
- Real-time availability (86ing)

### Non-goals (initial)
- Personalized pricing per customer
- ML-based suggestions
- Cross-tenant shared catalogs

## Current Codebase Integration Points
### Menu data
- Manager CRUD exists in `api/src/routes/managerMenu.js`
- Products are in `menu_products` (global + branch-specific rows via `branch_id` NULL vs branch)
- Recipes exist in `menu_recipes`

### Existing modifier constraints (mobile)
- Mobile currently enforces `min_select/max_select` in UI (see `mobile/src/screens/pos/ModifiersSheet.tsx` and `ProductDetail.tsx`).
- Web/waiter flow must be aligned to a shared server-side rule evaluation.

## Product Decisions Needed (Blocking Questions)
1) **Rule precedence**
- When multiple rules match, do we apply:
  - `last_updated_wins`
  - explicit `priority` integer (higher wins)
  - most-specific-wins (branch > global, product > category)

2) **Branch override model**
- Do we keep branch overrides as:
  - separate rows (already done for products)
  - rule overrides (recommended)
  - both

3) **Order types**
- What order types must rules consider?
  - dine_in, takeaway, delivery, pickup, catering (confirm list)

4) **Bundles**
- Bundle scope:
  - fixed bundle (exact items)
  - choice bundle (pick 1 from group)
  - mix-and-match (buy N from set for price)

5) **86ing granularity**
- Availability targets:
  - product-level
  - modifier-level
  - category-level

## Proposed Architecture
### Core concept
A server-side **evaluation endpoint** returns:
- Effective price per product
- Effective availability
- Effective modifier constraints
- Applicable bundle pricing adjustments

The client uses this response to:
- render availability
- validate modifier selection
- show price breakdown

### Determinism
Evaluation inputs are explicit:
- `tenantId`
- `branchId`
- `at` (ISO timestamp)
- `orderType`
- `cart` (items + modifiers)

Output contains:
- computed totals
- per-line pricing
- rule trace (for debugging)

## Data Model (Schema Proposal)
### 1) `menu_rule_sets`
- id, tenant_id, branch_id (nullable for global)
- name
- status: active|inactive
- priority (int)
- starts_at, ends_at (nullable)
- day_mask (bitmask) OR json schedule
- order_types_json
- created_at, updated_at

### 2) `menu_rules`
- id, tenant_id, rule_set_id
- kind: daypart|modifier_constraint|bundle|availability|price_override
- match_json (what it applies to: product ids, category, tags)
- effect_json (what it does)
- created_at, updated_at

### 3) Availability (86ing)
`menu_availability`
- id, tenant_id, branch_id
- target_type: product|modifier|category
- target_id
- state: available|unavailable
- reason
- expires_at (optional)
- created_at, updated_at

### 4) Bundle definitions
`menu_bundles`
- id, tenant_id, branch_id (nullable)
- name
- bundle_json (requirements + pricing)
- status
- created_at, updated_at

Indexes
- `(tenant_id, branch_id, status)`
- `(tenant_id, rule_set_id, kind)`
- `(tenant_id, branch_id, target_type, target_id)`

## APIs
### Manager CRUD
- `GET /api/manager/menu/rules?branchId=...`
- `POST /api/manager/menu/rules?branchId=...`
- `PUT /api/manager/menu/rules/:id?branchId=...`
- `DELETE /api/manager/menu/rules/:id?branchId=...`

- `GET /api/manager/menu/availability?branchId=...`
- `POST /api/manager/menu/availability?branchId=...`
- `DELETE /api/manager/menu/availability/:id?branchId=...`

### Evaluation
- `POST /api/pos/menu/evaluate?branchId=...`
Payload:
- `at`
- `orderType`
- `cart`: items { productId, qty, modifiers[] }

Response:
- `products`: effective price + availability
- `constraints`: per product modifier groups constraints
- `pricing`: per line totals + bundle adjustments
- `trace`: applied rules

### Server-side validation
- Order create/update must call evaluation/validation and reject invalid carts:
  - invalid modifier counts
  - unavailable products/modifiers

## UI
### Manager Rule Builder UI
- Location: Manager → Menu Management → Rules (or Settings → Menu Rules)
- Capabilities:
  - create rule set
  - add rules
  - preview evaluation for a sample cart/time

### Waiter UI
- Order builder uses evaluation endpoint:
  - disable unavailable items
  - enforce min/max required modifiers
  - show bundle pricing adjustments

## Tests
- Daypart boundary conditions (start/end)
- Multiple overlapping rules + precedence
- Branch override precedence
- Modifier constraints:
  - min required
  - max exceeded
  - multi-group constraints
- Bundle pricing:
  - exact match
  - partial match
  - multiple bundles
- 86ing:
  - immediate unavailable
  - expires_at reverts

## Rollout
- Phase 1: availability + modifier constraints validation
- Phase 2: dayparts + price overrides
- Phase 3: bundles
