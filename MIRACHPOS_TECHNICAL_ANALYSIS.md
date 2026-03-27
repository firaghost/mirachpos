# MirachPOS — Comprehensive Technical Analysis

> Production-grade POS system for Ethiopian restaurants  
> Solo-developed, offline-first, multi-tenant SaaS  
> Analysis Date: March 2026 | Version: 0.2.6

---

## Executive Summary

**MirachPOS** is a sophisticated, production-ready Point of Sale system designed specifically for the Ethiopian market. Built as a solo-developed project, it demonstrates enterprise-grade architecture patterns including multi-tenancy, offline-first synchronization, role-based access control, and Ethiopian payment gateway integration.

### Key Metrics
| Metric | Value |
|--------|-------|
| **Total Files Analyzed** | 385+ (249 frontend, 136 API) |
| **Database Tables** | 50+ (via migrations) |
| **API Routes** | 45+ route modules |
| **Screens** | 40+ React screens |
| **User Roles** | 5 tiers |
| **Payment Gateways** | 4 integrated (2 live, 1 planned) |
| **Lines of Code** | ~50,000+ estimated |

---

## 1. ARCHITECTURE & STRUCTURE

### 1.1 Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION LAYER                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Screens   │───▶│  Components │───▶│    Hooks    │───▶│    Utils    │  │
│  │  (40+ .tsx) │    │  (Shared UI)│    │ (Custom)    │    │  (Helpers)  │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │                  │         │
│         └──────────────────┴──────────────────┴──────────────────┘         │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        STATE MANAGEMENT                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │  PosContext  │  │ ThemeContext │  │  Session.ts  │              │   │
│  │  │  (POS State) │  │ (Dark/Light) │  │(Persistence) │              │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │   │
│  └─────────┼─────────────────┼─────────────────┼────────────────────────┘   │
│            │                 │                 │                            │
│            └─────────────────┴─────────────────┘                            │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                           API LAYER                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │   api.ts     │  │  apiFetch()  │  │ Interceptors │              │   │
│  │  │(HTTP Client) │  │(Auth Header) │  │(Error/Retry) │              │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │   │
│  └─────────┼─────────────────┼─────────────────┼────────────────────────┘   │
│            │                 │                 │                              │
└────────────┼─────────────────┼─────────────────┼────────────────────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND API                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Routes    │───▶│  Middleware │───▶│   Services  │───▶│  Database   │  │
│  │  (45+ .js)  │    │(Auth/Rate)  │    │(Business)   │    │(Knex/MySQL) │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │   Jobs      │    │   Webhooks  │    │   Events    │                      │
│  │(Background) │    │(Payments)   │    │(Audit Log)  │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Architecture

#### Frontend → API Flow
```
User Action
    │
    ▼
┌─────────────┐
│   Screen    │─── React.lazy() loaded on demand
│  Component  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  useState/  │─── Local component state
│  useReducer │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  PosContext │─── Global POS state (tables, orders, cart)
│  (Provider) │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│   api.ts    │────▶│  apiFetch() │─── JWT token attached
│  (Methods)  │     │ (Wrapper)   │─── Error handling
└──────┬──────┘     └──────┬──────┘─── Retry logic
       │                   │
       └───────────────────┘
                   │
                   ▼
           ┌─────────────┐
           │   Express   │─── Route matching
           │   Server    │─── Middleware chain
           └──────┬──────┘
                  │
                  ▼
           ┌─────────────┐
           │   Route     │─── Handler execution
           │   Handler   │─── Service calls
           └──────┬──────┘
                  │
                  ▼
           ┌─────────────┐
           │   Knex.js   │─── Query building
           │   (Query)   │─── tenant_id scoping
           └──────┬──────┘
                  │
                  ▼
           ┌─────────────┐
           │   MySQL     │─── Transaction
           │  (Cloud)    │─── Result
           └─────────────┘
```

#### Offline-First Sync Flow
```
Desktop App (Electron)
    │
    ├── Online Path ───────────────────────────────┐
    │                                              │
    ▼                                              ▼
┌─────────────┐                           ┌─────────────┐
│  User Action │                          │   Cloud     │
│  (POS UI)   │                           │   MySQL     │
└──────┬──────┘                           └─────────────┘
       │
       ▼
┌─────────────┐
│  Local DB   │─── SQLite (better-sqlite3)
│  (SQLite)   │─── Immediate persistence
└──────┬──────┘
       │
       ├── Event Created ───────────────────────────┐
       │  (events table)                            │
       ▼                                            │
┌─────────────┐                                    │
│  Sync Queue │─── IndexedDB / Memory               │
│  (Pending)  │                                    │
└──────┬──────┘                                    │
       │                                            │
       ▼                                            ▼
┌─────────────┐                           ┌─────────────┐
│  Sync API   │◄─────────────────────────│  Sync       │
│  (POST)     │    When online            │  Service    │
└──────┬──────┘                           └─────────────┘
       │
       ▼
┌─────────────┐
│  Conflict   │─── Server-wins resolution
│  Resolution │─── Cursor updated
└─────────────┘
```

### 1.3 Design Patterns Inventory

| Pattern | Implementation | Location |
|---------|----------------|----------|
| **Singleton** | Database connection | `api/src/db.js` |
| **Factory** | Express app creation | `api/src/app.js` |
| **Provider** | React Context | `PosContext.tsx`, `ThemeContext.tsx` |
| **Observer** | Session sync events | `session.ts` (BroadcastChannel) |
| **Strategy** | Payment gateways | `paymentGatewayService.js` |
| **Repository** | Database queries | Route handlers via Knex |
| **Command** | IPC channels | `electron/preload.mjs` |
| **Event Sourcing** | Change log | `events` table |
| **Circuit Breaker** | Health checks | `app.js` (gateway probes) |

### 1.4 Offline-First Sync Architecture

#### Event Sourcing Model

```typescript
// Event Schema
interface Event {
  id: string;              // UUID v4
  tenant_id: string;       // Multi-tenant isolation
  branch_id: string;       // Branch scope
  type: EventType;        // Event classification
  payload: JSON;          // Event data
  at: ISO8601;           // Event timestamp
  cursor: number;        // Ordering sequence
}

// Event Types
enum EventType {
  // Orders
  ORDER_CREATED = 'order.created',
  ORDER_UPDATED = 'order.updated',
  ORDER_VOIDED = 'order.voided',
  ORDER_PAID = 'order.paid',
  
  // Payments
  PAYMENT_RECEIVED = 'payment.received',
  PAYMENT_REFUNDED = 'payment.refunded',
  
  // Inventory
  INVENTORY_ADJUSTED = 'inventory.adjusted',
  INVENTORY_DEDUCTED = 'inventory.deducted',
  
  // Staff
  STAFF_CLOCK_IN = 'staff.clock_in',
  STAFF_CLOCK_OUT = 'staff.clock_out',
  
  // System
  SYNC_STARTED = 'sync.started',
  SYNC_COMPLETED = 'sync.completed'
}
```

#### Sync State Machine

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  IDLE    │────▶│ SYNCING  │────▶│ RESOLVE  │────▶│ COMPLETE │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                 │                │                │
     │                 │                │                │
     ▼                 ▼                ▼                ▼
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  ERROR   │◄────│  RETRY   │◄────│ CONFLICT │◄────│  PAUSE   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

#### Conflict Resolution Matrix

| Entity Type | Conflict Rule | Rationale |
|-------------|---------------|-----------|
| **Orders** | Server wins | Financial record integrity |
| **Payments** | Server wins | Payment gateway is source of truth |
| **Inventory** | Merge (additive) | Stock adjustments accumulate |
| **Staff Clock** | Server wins | Payroll accuracy |
| **Settings** | Last write wins | User preference |
| **Menu** | Server wins | Centralized menu management |

### 1.5 Electron IPC Channel Contracts

#### Channel Inventory

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `sqlite:query` | Renderer → Main | `{ sql: string, params: any[] }` | `Promise<Row[]>` |
| `sqlite:exec` | Renderer → Main | `{ sql: string, params: any[] }` | `Promise<{ changes: number }>` |
| `sqlite:transaction` | Renderer → Main | `{ queries: Query[] }` | `Promise<void>` |
| `printer:print` | Renderer → Main | `{ commands: ESC_POS[], printer: string }` | `Promise<boolean>` |
| `printer:list` | Renderer → Main | `{}` | `Promise<Printer[]>` |
| `printer:status` | Renderer → Main | `{ printer: string }` | `Promise<Status>` |
| `updater:check` | Renderer → Main | `{}` | `Promise<UpdateInfo>` |
| `updater:download` | Renderer → Main | `{}` | `Promise<void>` |
| `updater:install` | Renderer → Main | `{}` | `Promise<void>` |
| `updater:state` | Main → Renderer | `{ status: string, progress: number }` | Event |
| `app:restart` | Renderer → Main | `{}` | `Promise<void>` |
| `app:version` | Renderer → Main | `{}` | `Promise<string>` |
| `window:minimize` | Renderer → Main | `{}` | `void` |
| `window:maximize` | Renderer → Main | `{}` | `void` |
| `window:close` | Renderer → Main | `{}` | `void` |
| `file:export` | Renderer → Main | `{ data: Buffer, filename: string }` | `Promise<string>` |
| `file:open` | Renderer → Main | `{ path: string }` | `Promise<Buffer>` |

#### IPC Security Model

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    Renderer     │◄───────▶│     Preload     │◄───────▶│      Main       │
│   (React App)   │  IPC    │  (Context Bridge)│   IPC   │  (Node.js)      │
│                 │         │                 │         │                 │
│  - No Node API  │         │  - Exposed API  │         │  - Full Node    │
│  - Isolated     │         │  - Whitelisted  │         │  - SQLite       │
│  - CSP enforced │         │  - Validated    │         │  - Printer      │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

### 1.6 Background Jobs & Cron Tasks

#### Job Types

| Job | Schedule | Handler | Purpose |
|-----|----------|---------|---------|
| `invoice.daily` | Daily 00:00 | `invoiceJobs.js` | Generate daily invoices |
| `invoice.weekly` | Weekly | `invoiceJobs.js` | Weekly billing summaries |
| `invoice.monthly` | Monthly | `invoiceJobs.js` | Monthly statements |
| `telebirr.standing` | Hourly | `telebirrStandingOrderJobs.js` | Recurring payment processing |
| `sync.retry` | Every 5 min | `syncService.js` | Retry failed syncs |
| `cleanup.tokens` | Daily | `authService.js` | Expired token cleanup |
| `cleanup.events` | Weekly | `db.js` | Archive old events |
| `health.check` | Every 1 min | `schedulerService.js` | System health monitoring |

#### Job Queue Schema

```sql
CREATE TABLE jobs (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(64) NOT NULL INDEX,
  payload LONGTEXT,
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  priority INT DEFAULT 0,
  scheduled_at DATETIME NOT NULL INDEX,
  started_at DATETIME,
  completed_at DATETIME,
  last_error TEXT,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3
);
```

---

## 2. DATABASE & DATA MODEL

### 2.1 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TENANT ISOLATION                                   │
│                         (All tables have tenant_id)                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   tenants    │───────│   branches   │───────│    staff     │
│──────────────│  1:M  │──────────────│  1:M  │──────────────│
│ id (PK)      │       │ id (PK)      │       │ id (PK)      │
│ slug (UQ)    │       │ tenant_id(FK)│       │ tenant_id(FK)│
│ name         │       │ name         │       │ branch_id(FK)│
│ status       │       │ status       │       │ role_id(FK)  │
│ plan         │       │ city         │       │ name         │
│ trial_ends   │       │ address      │       │ email (UQ)   │
└──────────────┘       │ phone        │       │ password_hash│
                       └──────────────┘       │ pin_hash     │
                                              │ status       │
                                              └──────────────┘
                                                     │
                       ┌──────────────┐              │
                       │    roles     │◄─────────────┘
                       │──────────────│
                       │ id (PK)      │
                       │ tenant_id(FK)│
                       │ name         │
                       │ scope        │
                       │ permissions  │
                       └──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    orders    │───────│ order_items  │───────│   products   │
│──────────────│  1:M  │──────────────│  M:1  │──────────────│
│ id (PK)      │       │ id (PK)      │       │ id (PK)      │
│ tenant_id(FK)│       │ order_id(FK)│       │ tenant_id(FK)│
│ branch_id(FK)│       │ product_id  │       │ name         │
│ status       │       │ qty          │       │ price        │
│ total        │       │ unit_price   │       │ category_id  │
│ tax          │       │ modifiers    │       └──────────────┘
│ payload      │       └──────────────┘
│ created_at   │
│ paid_at      │       ┌──────────────┐
└──────────────┘       │   payments   │
       │               │──────────────│
       │               │ id (PK)      │
       └──────────────▶│ order_id(FK) │
                       │ method       │
                       │ amount       │
                       │ reference    │
                       └──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   events     │       │  pos_state   │       │ shift_logs   │
│──────────────│       │──────────────│       │──────────────│
│ id (PK)      │       │ id (PK)      │       │ id (PK)      │
│ tenant_id(FK)│       │ tenant_id(FK)│       │ tenant_id(FK)│
│ branch_id(FK)│       │ branch_id(FK)│       │ branch_id(FK)│
│ type         │       │ state_json   │       │ staff_id(FK) │
│ payload      │       │ updated_at   │       │ clock_in_at  │
│ at           │       └──────────────┘       │ clock_out_at │
└──────────────┘                               └──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  inventory   │       │   recipes    │       │  customers   │
│──────────────│       │──────────────│       │──────────────│
│ id (PK)      │       │ id (PK)      │       │ id (PK)      │
│ tenant_id(FK)│       │ product_id   │       │ tenant_id(FK)│
│ name         │       │ ingredients  │       │ name         │
│ stock        │       │ instructions │       │ phone        │
│ unit         │       └──────────────┘       │ loyalty_pts  │
│ min_stock    │                              └──────────────┘
└──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│subscriptions │       │    jobs      │       │refresh_tokens│
│──────────────│       │──────────────│       │──────────────│
│ id (PK)      │       │ id (PK)      │       │ id (PK)      │
│ tenant_id(FK)│       │ type         │       │ tenant_id(FK)│
│ tier         │       │ status       │       │ staff_id(FK) │
│ status       │       │ scheduled_at │       │ token_hash   │
│ current_period│      │ payload      │       │ expires_at   │
└──────────────┘       └──────────────┘       └──────────────┘
```

### 2.2 Migration History Analysis

#### Migration Timeline

| Range | Count | Theme |
|-------|-------|-------|
| 001-010 | 10 | Core schema (tenants, branches, staff, orders, events) |
| 011-020 | 10 | Super admin, billing, entitlements |
| 021-030 | 10 | Inventory enhancements, reporting |
| 031-040 | 10 | Payment features, webhooks |
| 041-050 | 10+ | KDS, sync improvements, optimizations |

#### Migration Patterns

```javascript
// Standard Migration Pattern
exports.up = async (knex) => {
  // 1. Create table with tenant_id FK
  await knex.schema.createTable('new_table', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    // ... columns
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').nullable();
  });
  
  // 2. Add composite indexes for common queries
  await knex.schema.table('new_table', (t) => {
    t.index(['tenant_id', 'branch_id', 'created_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('new_table');
};
```

#### Potential Migration Conflicts

| Risk | Mitigation |
|------|------------|
| Concurrent migrations | Single deploy process, locking |
| Long-running migrations | Off-peak deployment, chunked updates |
| Rollback failures | Tested rollback scripts, backups |
| Schema drift | Migration checksum validation |

### 2.3 Index Analysis

#### Current Indexes (Key Tables)

```sql
-- tenants: slug lookup
CREATE UNIQUE INDEX tenants_slug_unique ON tenants(slug);

-- branches: tenant scoping
CREATE INDEX branches_tenant_id_index ON branches(tenant_id);

-- staff: login + tenant isolation
CREATE UNIQUE INDEX staff_tenant_id_email_unique ON staff(tenant_id, email);
CREATE INDEX staff_tenant_id_index ON staff(tenant_id);
CREATE INDEX staff_branch_id_index ON staff(branch_id);

-- orders: time-series queries
CREATE INDEX orders_tenant_id_index ON orders(tenant_id);
CREATE INDEX orders_branch_id_index ON orders(branch_id);
CREATE INDEX orders_created_at_index ON orders(created_at);
CREATE INDEX orders_paid_at_index ON orders(paid_at);

-- events: sync queries
CREATE INDEX events_tenant_id_index ON events(tenant_id);
CREATE INDEX events_branch_id_index ON events(branch_id);
CREATE INDEX events_type_index ON events(type);
CREATE INDEX events_at_index ON events(at);

-- shift_logs: payroll queries
CREATE INDEX shift_logs_staff_id_index ON shift_logs(staff_id);
CREATE INDEX shift_logs_clock_in_at_index ON shift_logs(clock_in_at);
```

#### Missing Index Recommendations

| Table | Column(s) | Query Pattern |
|-------|-----------|---------------|
| `orders` | `(tenant_id, status, created_at)` | Status-based reports |
| `orders` | `(tenant_id, branch_id, status)` | Branch order lists |
| `events` | `(tenant_id, cursor)` | Sync cursor queries |
| `inventory` | `(tenant_id, status)` | Low stock alerts |
| `payments` | `(tenant_id, method, created_at)` | Payment method reports |

### 2.4 Multi-Tenancy Isolation Strategy

#### Tenant ID Pattern

```javascript
// Every query includes tenant_id filter
const getOrders = async (tenantId, branchId, filters) => {
  return db('orders')
    .where({ tenant_id: tenantId })  // Mandatory
    .where({ branch_id: branchId })  // Optional scope
    .where(filters)
    .orderBy('created_at', 'desc');
};

// Row-level security via query scoping
const getById = async (tenantId, table, id) => {
  return db(table)
    .where({ tenant_id: tenantId, id })
    .first();
};
```

#### Isolation Levels

| Level | Implementation | Use Case |
|-------|----------------|----------|
| **Database** | Separate databases per tenant | Enterprise tier (future) |
| **Schema** | Separate schemas per tenant | Not implemented |
| **Row-level** | tenant_id column filtering | Current implementation |
| **Application** | Query scoping in code | Current implementation |

#### Tenant Context Propagation

```
Request
  │
  ├── JWT Payload: { tenantId, branchId }
  │
  ▼
Middleware: extract tenant from JWT
  │
  ▼
Route Handler: pass tenantId to services
  │
  ▼
Service: include tenant_id in all queries
  │
  ▼
Database: row-level filtering
```

### 2.5 Offline Sync State Machine

#### pos_state Table Schema

```sql
CREATE TABLE pos_state (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  state_json LONGTEXT,  -- JSON blob
  updated_at DATETIME NOT NULL,
  UNIQUE KEY (tenant_id, branch_id)
);
```

#### State JSON Structure

```typescript
interface PosStateJson {
  // Tables
  tables: Table[];
  
  // Active orders (in-memory + local)
  activeOrders: Order[];
  
  // Menu data
  menu: {
    categories: Category[];
    products: Product[];
    modifiers: Modifier[];
  };
  
  // Inventory snapshot
  inventory: InventoryItem[];
  
  // Sync metadata
  sync: {
    lastSyncAt: ISO8601;
    cursor: number;
    pendingEvents: number;
    status: 'idle' | 'syncing' | 'error';
  };
  
  // Session data
  session: {
    staffId: string;
    shiftStartedAt: ISO8601;
    deviceId: string;
  };
}
```

#### Event Replay Logic

```javascript
// Replay events from cursor to rebuild state
const replayEvents = async (tenantId, branchId, fromCursor) => {
  const events = await db('events')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .where('cursor', '>', fromCursor)
    .orderBy('cursor', 'asc');
  
  const state = await loadState(tenantId, branchId);
  
  for (const event of events) {
    applyEvent(state, event);
  }
  
  await saveState(tenantId, branchId, state);
  return state;
};

// Event application
const applyEvent = (state, event) => {
  switch (event.type) {
    case 'order.created':
      state.activeOrders.push(event.payload.order);
      break;
    case 'order.paid':
      const order = state.activeOrders.find(o => o.id === event.payload.orderId);
      if (order) order.status = 'Paid';
      break;
    case 'inventory.adjusted':
      const item = state.inventory.find(i => i.id === event.payload.itemId);
      if (item) item.stock += event.payload.delta;
      break;
    // ... etc
  }
};
```

---

## 3. API SURFACE

### 3.1 Complete Route Inventory

#### Route Categories

| Category | Routes | Auth Level |
|----------|--------|------------|
| **Authentication** | `auth.js`, `superadminAuth.js` | Public |
| **Public** | `public.js` | Public |
| **Core POS** | `pos.js`, `waiter.js`, `posCustomers.js` | Waiter+ |
| **Management** | `manager.js`, `managerStaff.js`, `managerMenu.js`, `managerFinance.js`, `managerCustomers.js`, `managerSuppliers.js`, `managerPurchaseOrders.js`, `managerPrint.js`, `managerAudit.js`, `managerPayments.js` | Branch Manager+ |
| **Owner** | `owner.js`, `ownerStaff.js` | Cafe Owner |
| **Admin** | `admin.js`, `superadmin.js`, `adminMetrics.js` | Super Admin |
| **Support** | `support.js`, `audit.js` | Authenticated |
| **Billing** | `subscription.js`, `subscriptionStatus.js` | Cafe Owner |
| **Sync** | `sync.js` | Authenticated |
| **Payments** | `webhook.js`, `telebirrStandingOrder.js` | Mixed |
| **Integrations** | `integrations.js`, `realtime.js`, `fcm.js` | Authenticated |
| **Reports** | `enhancedReports.js`, `customReports.js` | Branch Manager+ |
| **Inventory** | `inventory.js` | Branch Manager+ |
| **Staff** | `staff.js`, `schedule.js` | Authenticated |

#### Route Handler Pattern

```javascript
// Standard route structure
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { rateLimit } = require('../middleware/rateLimiter');

const makeRouter = () => {
  const router = express.Router();
  
  // Apply middleware chain
  router.use(authenticate);
  
  // GET /api/orders - List orders
  router.get('/orders', 
    requirePermission('orders.read'),
    async (req, res, next) => {
      try {
        const { tenantId, branchId } = req.user;
        const orders = await orderService.list(tenantId, branchId, req.query);
        res.json({ success: true, data: orders });
      } catch (err) {
        next(err);
      }
    }
  );
  
  // POST /api/orders - Create order
  router.post('/orders',
    requirePermission('orders.write'),
    async (req, res, next) => {
      try {
        const { tenantId, branchId, staffId } = req.user;
        const order = await orderService.create(tenantId, branchId, staffId, req.body);
        res.status(201).json({ success: true, data: order });
      } catch (err) {
        next(err);
      }
    }
  );
  
  return router;
};

module.exports = { makeRouter };
```

### 3.2 Middleware Execution Order

```
Request
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. requestIdMiddleware                                       │
│    - Generate X-Request-ID                                   │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. helmet()                                                  │
│    - Security headers (HSTS, CSP, etc.)                      │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. compression()                                             │
│    - Gzip response bodies                                    │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. webhookBodyParser (conditional)                           │
│    - Raw body for signature verification                     │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. express.json()                                            │
│    - Parse JSON body (10MB limit)                            │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. cors()                                                    │
│    - Origin validation                                       │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. requestLogger                                             │
│    - Structured logging (pino)                               │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. metricsMiddleware                                         │
│    - Prometheus metrics collection                           │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. requestTimeout                                            │
│    - Request timeout enforcement                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. globalLimiter                                            │
│    - Rate limiting (100 req/min)                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. Route-specific middleware                                │
│    - authLimiter, strictLimiter, paymentLimiter, etc.        │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. authenticate (route-level)                               │
│    - JWT validation                                          │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 13. requirePermission (route-level)                          │
│    - Permission check                                        │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
Route Handler
```

### 3.3 Authentication Flow

#### JWT Structure

```typescript
interface JWTPayload {
  // Identity
  userId: string;        // staff.id
  role: UserRole;         // Waiter | Waiter Manager | Branch Manager | Cafe Owner | Super Admin
  
  // Tenant Context
  tenantId: string;       // tenants.id
  tenantSlug: string;     // URL-friendly identifier
  branchId: string;       // branches.id | 'global'
  
  // Permissions
  permissions: string[];  // ['orders.read', 'orders.write', ...]
  
  // Timestamps
  iat: number;           // Issued at (Unix timestamp)
  exp: number;           // Expires at (Unix timestamp)
  
  // Device tracking
  deviceId?: string;     // For session invalidation
}
```

#### Token Lifecycle

```
┌──────────────┐
│   Login      │
│  (Password   │
│   or PIN)    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Validate    │
│  Credentials │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Generate    │     ┌──────────────┐
│  Access Token│────▶│  Access JWT  │─── 15 min expiry
│  (15 min)    │     │  (Short)     │
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  Generate    │────▶│ Refresh Token│─── 7 days expiry
│  Refresh     │     │  (Long)      │─── Stored in DB
│  Token       │     └──────────────┘
│  (7 days)    │
└──────────────┘

Refresh Flow:
┌──────────────┐
│ Access Token │
│   Expired    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ POST /auth/  │
│   refresh    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Validate     │
│ Refresh Token│─── Check DB + expiry
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Generate    │
│  New Tokens  │
└──────────────┘
```

#### PIN Login Flow

```javascript
// PIN is a bcrypt hash stored in staff.pin_hash
// Used for quick login on shared devices

const loginWithPin = async (staffId, pin) => {
  const staff = await db('staff').where({ id: staffId }).first();
  
  // Validate PIN
  const valid = await bcrypt.compare(pin, staff.pin_hash);
  if (!valid) throw new Error('Invalid PIN');
  
  // Generate tokens
  return generateTokens(staff);
};
```

### 3.4 Rate Limiting Configuration

#### Limiter Definitions

```javascript
// Global: 100 requests per minute
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 100,                  // 100 requests
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  }
});

// Auth: 5 requests per minute (strict)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skipSuccessfulRequests: false,
});

// Strict: 3 requests per minute (signup, etc.)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
});

// Payment: 10 requests per minute
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});

// Payment verify: 20 requests per minute
const paymentVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
});
```

#### Endpoint Mapping

| Endpoint | Limiter | Reason |
|----------|---------|--------|
| `POST /api/login` | authLimiter | Brute force protection |
| `POST /api/public/signup` | strictLimiter | Abuse prevention |
| `POST /api/public/pos-links/*/initiate-chapa` | paymentLimiter | Payment spam |
| `POST /api/admin/*` | strictLimiter | Admin protection |
| `GET /api/*` | globalLimiter | General API |

### 3.5 Webhook Handlers

#### Telebirr Webhook

```javascript
// /api/webhooks/telebirr
router.post('/telebirr', 
  express.raw({ type: '*/*' }),
  async (req, res) => {
    try {
      // 1. Verify signature
      const signature = req.headers['x-telebirr-signature'];
      const payload = req.body.toString();
      
      if (!verifyTelebirrSignature(signature, payload)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
      
      // 2. Parse payload
      const event = JSON.parse(payload);
      
      // 3. Idempotency check
      const existing = await db('payments')
        .where({ reference: event.transactionId })
        .first();
      
      if (existing) {
        return res.status(200).json({ status: 'already processed' });
      }
      
      // 4. Process payment
      await paymentService.processTelebirrPayment(event);
      
      // 5. Acknowledge
      res.status(200).json({ status: 'success' });
    } catch (err) {
      logger.error({ err }, 'Telebirr webhook failed');
      res.status(500).json({ error: 'Internal error' });
    }
  }
);
```

#### Chapa Webhook

```javascript
// /api/webhooks/chapa
router.post('/chapa',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    try {
      // 1. Verify signature (HMAC)
      const signature = req.headers['x-chapa-signature'];
      const secret = config.chapaSecret;
      
      const expected = crypto
        .createHmac('sha256', secret)
        .update(req.body)
        .digest('hex');
      
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
      
      // 2. Parse and process
      const event = JSON.parse(req.body);
      
      // 3. Idempotency
      const existing = await db('payments')
        .where({ chapa_reference: event.reference })
        .first();
      
      if (existing) {
        return res.status(200).json({ status: 'duplicate' });
      }
      
      // 4. Update order
      await orderService.markPaid(event.reference, {
        method: 'Chapa',
        amount: event.amount,
        reference: event.reference
      });
      
      res.status(200).json({ status: 'success' });
    } catch (err) {
      logger.error({ err }, 'Chapa webhook failed');
      res.status(500).json({ error: 'Internal error' });
    }
  }
);
```

#### Webhook Security Checklist

| Check | Implementation |
|-------|----------------|
| Signature verification | HMAC-SHA256 with secret |
| Idempotency | Check reference in payments table |
| Timestamp validation | Reject old webhooks (>5 min) |
| IP allowlisting | Optional gateway IP check |
| Raw body preservation | express.raw() before JSON parsing |

### 3.6 Error Handling Patterns

#### Current Pattern (Inconsistent)

```javascript
// Pattern A: Inline try-catch
router.get('/orders', async (req, res) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Pattern B: next() delegation
router.get('/orders', async (req, res, next) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// Pattern C: Service-level handling
router.get('/orders', async (req, res) => {
  const result = await orderService.listSafe(req.user.tenantId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json(result.data);
});
```

#### Recommended Standard Pattern

```javascript
// Standardized error response
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid order data",
    "details": { "field": "total", "issue": "must be positive" },
    "requestId": "req_abc123"
  }
}

// Central error handler
app.use((err, req, res, next) => {
  req.log.error({ err, requestId: req.requestId }, 'Request failed');
  
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE', message: 'Resource already exists', requestId: req.requestId }
    });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message, details: err.details, requestId: req.requestId }
    });
  }
  
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An error occurred', requestId: req.requestId }
  });
});
```

---

## 4. FRONTEND ARCHITECTURE

### 4.1 Screen Routing System

#### Router Implementation

```typescript
// Custom hash-based router with URL path support
// Location: App.tsx

const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(() => {
    // Priority: URL path > hash > localStorage > session
    const fromPath = readPathScreen();
    const fromHash = readHashScreen();
    const fromLast = readLastScreen();
    const fromSession = parseScreen(parsed?.screen);
    
    return fromPath || fromHash || fromLast || fromSession || Screen.LOGIN;
  });
  
  // Navigation function
  const navigate = (screen: Screen) => {
    setCurrentScreen(screen);
    writeLastScreen(screen);           // localStorage
    writePathScreen(screen);           // URL path
    updateSession({ screen });         // sessionStorage
  };
  
  // Screen rendering with lazy loading
  return (
    <Suspense fallback={<ScreenFallback />}>
      {currentScreen === Screen.WAITER_DASHBOARD && <WaiterDashboard />}
      {currentScreen === Screen.WAITER_MENU && <WaiterMenu />}
      {/* ... 40+ screens */}
    </Suspense>
  );
};
```

#### URL Path Mapping

```typescript
// Path to Screen conversion
const pathToScreen = (pathname: string): Screen | null => {
  const parts = pathname.split('/').filter(Boolean);
  const [root, leaf] = parts;
  
  switch (root) {
    case 'waiter':
      return parseScreen(`WAITER_${leaf.toUpperCase()}`);
    case 'manager':
      return parseScreen(`MANAGER_${leaf.toUpperCase()}`);
    case 'owner':
      return parseScreen(`OWNER_${leaf.toUpperCase()}`);
    case 'superadmin':
      return parseScreen(`SA_${leaf.toUpperCase()}`);
    default:
      return parseScreen(root.toUpperCase());
  }
};

// Examples:
// /waiter/dashboard → WAITER_DASHBOARD
// /manager/orders → MANAGER_ORDERS
// /owner/billing → OWNER_BILLING
// /superadmin/tenants → SA_TENANTS
```

### 4.2 Component Hierarchy

```
App (Root)
│
├── ThemeProvider (Dark/Light mode)
│
├── PosProvider (Global POS state)
│
└── AppContent
    │
    ├── Sidebar (Navigation)
    │   ├── Role-based menu items
    │   ├── Branch selector
    │   └── Logout
    │
    ├── TrialBanner (Subscription status)
    │
    └── Screen Router
        │
        ├── Waiter Screens
        │   ├── WaiterDashboard (Floor view)
        │   ├── WaiterMenu (Order builder)
        │   ├── WaiterReview (Order confirmation)
        │   ├── WaiterPayment (Payment processing)
        │   ├── WaiterReceipt (Receipt/print)
        │   ├── WaiterKDS (Kitchen display)
        │   └── WaiterHistory (Past orders)
        │
        ├── Manager Screens
        │   ├── BranchDashboard (Analytics)
        │   ├── BranchOrders (Order management)
        │   ├── ManagerFloorMap (Table editor)
        │   ├── ManagerMenuBuilder
        │   ├── ManagerInventory
        │   └── ManagerReports
        │
        ├── Owner Screens
        │   ├── OwnerDashboard (Global view)
        │   ├── OwnerBranches (Multi-branch)
        │   ├── OwnerFinance
        │   ├── OwnerBilling (Subscription)
        │   └── OwnerStaff
        │
        └── Super Admin Screens
            ├── SA_Overview
            ├── SA_Tenants
            ├── SA_Billing
            └── SA_SystemHealth
```

### 4.3 State Management

#### PosContext Structure

```typescript
interface PosContextValue {
  // Tables
  tables: Table[];
  selectedTable: Table | null;
  setSelectedTable: (table: Table) => void;
  
  // Orders
  activeOrders: Order[];
  currentOrder: Order | null;
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  
  // Menu
  menu: MenuData;
  categories: Category[];
  products: Product[];
  
  // Sync
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncAt: Date | null;
  pendingSyncCount: number;
  
  // Actions
  placeOrder: () => Promise<Order>;
  voidOrder: (orderId: string, reason: string) => Promise<void>;
  processPayment: (payment: Payment) => Promise<void>;
  syncNow: () => Promise<void>;
}
```

#### Session Persistence Layers

| Layer | Storage | Data | TTL |
|-------|---------|------|-----|
| **sessionStorage** | Browser tab | Token, role, tenant, screen | Tab lifetime |
| **localStorage** | Browser permanent | Last screen, preferences, offline queue | Indefinite |
| **IndexedDB** | Browser structured | Events queue, large payloads | Indefinite |
| **SQLite** | Desktop only | Complete POS state | Indefinite |
| **BroadcastChannel** | Cross-tab | Session sync events | Real-time |

### 4.4 Role-Based UI Gating

#### Permission to UI Mapping

```typescript
// rbac.ts - Screen access control
export const canAccessScreen = (
  role: UserRole,
  screen: Screen,
  subscription: SubscriptionInfo | null,
  permissions: string[]
): boolean => {
  // 1. Check role allows screen
  if (!roleCanAccess(role, screen)) return false;
  
  // 2. Check subscription module access
  if (!subscriptionCanAccess(role, screen, subscription)) return false;
  
  // 3. Check specific permission
  if (!permissionCanAccess(role, screen, permissions)) return false;
  
  return true;
};

// Usage in component
const SidebarItem = ({ screen, label, icon }) => {
  const { userRole, subscription, permissions } = useSession();
  
  if (!canAccessScreen(userRole, screen, subscription, permissions)) {
    return null; // Hide if no access
  }
  
  return (
    <button onClick={() => navigate(screen)}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
};
```

#### UI Element Gating

```typescript
// Button-level permission checking
const VoidOrderButton = ({ order }) => {
  const { permissions } = useSession();
  
  // Check specific permission
  if (!hasPermission(permissions, 'orders.void')) {
    return null; // Don't render
  }
  
  return (
    <Button 
      variant="danger"
      onClick={() => voidOrder(order.id)}
    >
      Void Order
    </Button>
  );
};

// Feature-level gating
const AdvancedReports = () => {
  const { subscription } = useSession();
  
  // Check subscription tier
  if (!hasModule(subscription, 'advanced_reports')) {
    return (
      <Paywall 
        message="Upgrade to Pro for advanced reports"
        onUpgrade={() => navigate(Screen.OWNER_BILLING)}
      />
    );
  }
  
  return <ReportBuilder />;
};
```

### 4.5 Lazy Loading Strategy

#### Code Split Points

```typescript
// App.tsx - All screens lazy loaded
const Dashboard = React.lazy(() => 
  import('./screens/Dashboard').then(m => ({ default: m.Dashboard }))
);

const WaiterDashboard = React.lazy(() => 
  import('./screens/waiter/WaiterDashboard').then(m => ({ default: m.WaiterDashboard }))
);

const ManagerDashboard = React.lazy(() => 
  import('./screens/manager/BranchDashboard').then(m => ({ default: m.BranchDashboard }))
);

// Bundle organization
// - vendor.js: React, ReactDOM, utilities
// - main.js: App shell, router, contexts
// - screens/*.js: Individual screen bundles (loaded on demand)
```

#### Preloading Strategy

```typescript
// Preload likely next screens
const usePreloadScreens = (currentScreen: Screen) => {
  useEffect(() => {
    // Preload screens user is likely to visit next
    switch (currentScreen) {
      case Screen.WAITER_DASHBOARD:
        // User likely to go to menu next
        import('./screens/waiter/WaiterMenu');
        break;
      case Screen.WAITER_MENU:
        // User likely to review next
        import('./screens/waiter/WaiterOrderReview');
        break;
    }
  }, [currentScreen]);
};
```

### 4.6 Feature Flag Implementation

#### Flag Sources (Priority Order)

```typescript
const isFeatureEnabled = (feature: string): boolean => {
  // 1. URL parameter (highest priority, for testing)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get(feature) === '1') return true;
  if (urlParams.get(feature) === '0') return false;
  
  // 2. localStorage (user preference)
  const localFlag = localStorage.getItem(`mirachpos.${feature}`);
  if (localFlag === '1') return true;
  if (localFlag === '0') return false;
  
  // 3. Subscription entitlements
  const { subscription } = useSession();
  if (subscription?.features?.includes(feature)) return true;
  
  // 4. Default (disabled)
  return false;
};
```

#### Feature Flag Usage

```typescript
// Conditional rendering
const ServiceWorkspace = () => {
  const serviceWorkspaceEnabled = isFeatureEnabled('service_workspace_v1');
  
  if (!serviceWorkspaceEnabled) {
    return <LegacyWaiterUI />;
  }
  
  return <NewUnifiedWorkspace />;
};

// Conditional routing
const posUiV2Enabled = isFeatureEnabled('pos_ui_v2');

{currentScreen === Screen.WAITER_MENU && (
  posUiV2Enabled ? <WaiterOrderV2 /> : <WaiterMenu />
)}
```

---

## 5. SECURITY AUDIT

### 5.1 Authentication Weaknesses

| Issue | Severity | Details | Mitigation |
|-------|----------|---------|------------|
| **No MFA for Super Admin** | 🔴 High | Super admin has god-mode access without 2FA | Implement TOTP for SA operations |
| **PIN brute force** | 🟡 Medium | No rate limiting on PIN attempts | Add PIN attempt lockout |
| **Token lifetime** | 🟡 Medium | 15 min access, 7 day refresh is standard | Consider shorter refresh for sensitive ops |
| **No device binding** | 🟡 Medium | Tokens work across devices | Add device fingerprinting |
| **JWT secret rotation** | 🟢 Low | No automated rotation | Document rotation procedure |

### 5.2 Authorization Holes

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| **Missing permission checks** | 🔴 High | Some routes only check role, not permissions | Add requirePermission middleware |
| **Role escalation risk** | 🟡 Medium | Owner can assign any role | Validate role hierarchy |
| **Cross-tenant access** | 🔴 Critical | Must verify tenant_id on every query | Audit all queries |
| **Super admin impersonation** | 🟡 Medium | SA can impersonate users | Add audit logging |

### 5.3 Input Validation Coverage

#### Current State

| Layer | Coverage | Notes |
|-------|----------|-------|
| **Zod schemas** | ~30% | Critical paths only |
| **Manual validation** | ~50% | Inconsistent patterns |
| **No validation** | ~20% | Trusts client input |

#### Validation Gaps

```javascript
// ❌ No validation - direct use
router.post('/orders', async (req, res) => {
  const { tableId, items, discount } = req.body;
  // Used directly in DB query
  const order = await createOrder(tableId, items, discount);
});

// ✅ Zod validation
const orderSchema = z.object({
  tableId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(100),
    modifiers: z.array(z.string()).optional()
  })).min(1),
  discount: z.number().min(0).max(100).optional()
});

router.post('/orders', validateBody(orderSchema), async (req, res) => {
  const order = await createOrder(req.validatedBody);
});
```

### 5.4 SQL Injection Vectors

#### Risk Assessment

| Pattern | Risk | Location |
|---------|------|----------|
| **Knex query builder** | 🟢 Low | Used correctly with parameterized queries |
| **Raw queries** | 🟡 Medium | Some raw queries in migrations |
| **String concatenation** | 🔴 High | None found (good) |
| **Dynamic table names** | 🟡 Medium | Must validate table names |

#### Safe Query Patterns

```javascript
// ✅ Safe - parameterized
await db('orders')
  .where({ tenant_id: tenantId, id: orderId })
  .first();

// ✅ Safe - query builder
await db('orders')
  .where('created_at', '>', date)
  .andWhere('status', status)
  .select('*');

// ⚠️ Caution - raw with validation
const allowedTables = ['orders', 'payments', 'inventory'];
if (!allowedTables.includes(tableName)) {
  throw new Error('Invalid table');
}
await db.raw(`SELECT * FROM ?? WHERE id = ?`, [tableName, id]);
```

### 5.5 File Upload Security

#### Current Implementation

```javascript
// File upload via multer
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // MIME type validation
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});
```

#### Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Size limits | ✅ | 10MB configured |
| MIME validation | ✅ | Whitelist approach |
| Extension validation | ⚠️ | Should verify extension matches MIME |
| Path traversal | ✅ | Uses multer's safe naming |
| Virus scanning | ❌ | Not implemented |
| Storage isolation | ✅ | Separate uploads directory |

### 5.6 CORS Configuration

```javascript
// Current CORS setup
app.use(cors({
  origin: (origin, callback) => {
    // Allow whitelisted origins
    const allowedOrigins = config.corsOrigins;
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // Allow cookies/auth headers
}));
```

#### Security Assessment

| Aspect | Status | Recommendation |
|--------|--------|----------------|
| Origin validation | ✅ | Whitelist-based |
| Credentials | ✅ | Required for auth |
| Preflight caching | ⚠️ | Consider maxAge |
| Wildcard origins | ❌ | Not used (good) |
| Vary header | ✅ | Set correctly |

### 5.7 Secrets Management

#### Current State

| Secret | Location | Risk |
|--------|----------|------|
| `JWT_SECRET` | Environment | 🟢 Low |
| `DB_PASSWORD` | Environment | 🟢 Low |
| `TENANT_GATEWAY_SECRETS_KEY` | Environment | 🟢 Low |
| `GEMINI_API_KEY` | Environment | 🟢 Low |
| Chapa secret | Database (encrypted) | 🟡 Medium |
| Telebirr credentials | Database (encrypted) | 🟡 Medium |

#### Recommendations

1. **Use AWS Secrets Manager / HashiCorp Vault** for production
2. **Rotate payment gateway secrets** quarterly
3. **Encrypt secrets at rest** in database
4. **Audit secret access** with logging

---

## 6. PAYMENT & BILLING SYSTEM

### 6.1 Payment Gateway Abstraction

```typescript
// Payment gateway interface
interface PaymentGateway {
  name: string;
  enabled: boolean;
  
  // Initialize payment
  initiatePayment(params: PaymentParams): Promise<PaymentSession>;
  
  // Verify payment (webhook or poll)
  verifyPayment(reference: string): Promise<PaymentStatus>;
  
  // Refund
  refund(reference: string, amount: number): Promise<RefundResult>;
  
  // Webhook handler
  handleWebhook(payload: unknown, signature: string): Promise<WebhookResult>;
}

// Gateway registry
const gateways: Record<string, PaymentGateway> = {
  telebirr: new TelebirrGateway(),
  chapa: new ChapaGateway(),
  cash: new CashGateway(),
  loyalty: new LoyaltyGateway()
};
```

### 6.2 Telebirr USSD Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Waiter  │────▶│   API    │────▶│ Telebirr │────▶│ Customer │
│  Selects │     │  Creates│     │  Sends   │     │ Receives │
│  Telebirr│     │  Payment│     │  USSD    │     │  USSD    │
│          │     │  Request│     │  Prompt  │     │  Prompt  │
└──────────┘     └──────────┘     └──────────┘     └────┬─────┘
                                                       │
                                                       │
┌──────────┐     ┌──────────┐     ┌──────────┐        │
│  Order    │◄────│   API    │◄────│ Telebirr │◄───────┘
│  Marked   │     │  Verifies│     │  Callback│  Confirms
│  Paid     │     │  Webhook │     │          │  Payment
└──────────┘     └──────────┘     └──────────┘
```

#### Implementation

```javascript
// Telebirr gateway
class TelebirrGateway {
  async initiatePayment({ orderId, amount, phoneNumber }) {
    // 1. Create payment request
    const response = await fetch(`${this.baseUrl}/payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: JSON.stringify({
        amount,
        phoneNumber,
        reference: orderId,
        callbackUrl: `${config.apiUrl}/webhooks/telebirr`
      })
    });
    
    // 2. Return session for polling
    return {
      reference: response.transactionId,
      status: 'pending',
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 min
    };
  }
  
  async handleWebhook(payload, signature) {
    // Verify signature
    if (!this.verifySignature(payload, signature)) {
      throw new Error('Invalid signature');
    }
    
    // Process based on status
    switch (payload.status) {
      case 'SUCCESS':
        return { status: 'completed', amount: payload.amount };
      case 'FAILED':
        return { status: 'failed', reason: payload.failureReason };
      default:
        return { status: 'pending' };
    }
  }
}
```

### 6.3 Chapa Checkout Session

```javascript
// Chapa integration
class ChapaGateway {
  async initiatePayment({ orderId, amount, email, callbackUrl }) {
    const response = await fetch('https://api.chapa.co/v1/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount.toString(),
        currency: 'ETB',
        email,
        tx_ref: orderId,
        callback_url: callbackUrl,
        return_url: `${config.appUrl}/payment/success`
      })
    });
    
    return {
      checkoutUrl: response.data.checkout_url,
      reference: response.data.tx_ref
    };
  }
}

// Usage in frontend
const processChapaPayment = async (order) => {
  const session = await api.post('/payments/chapa/initiate', {
    orderId: order.id,
    amount: order.total
  });
  
  // Redirect to Chapa checkout
  window.location.href = session.checkoutUrl;
};
```

### 6.4 Webhook Idempotency

```javascript
// Idempotency implementation
const processWebhook = async (gateway, payload, signature) => {
  // 1. Verify signature
  if (!gateway.verifySignature(payload, signature)) {
    return { status: 401, error: 'Invalid signature' };
  }
  
  // 2. Check idempotency (reference-based)
  const reference = payload.reference || payload.transactionId;
  const existing = await db('webhook_events')
    .where({ gateway: gateway.name, reference })
    .first();
  
  if (existing) {
    logger.info({ reference }, 'Duplicate webhook, already processed');
    return { status: 200, message: 'Already processed' };
  }
  
  // 3. Record webhook receipt
  await db('webhook_events').insert({
    id: generateId(),
    gateway: gateway.name,
    reference,
    payload: JSON.stringify(payload),
    received_at: new Date()
  });
  
  // 4. Process payment
  const result = await gateway.processPayment(payload);
  
  // 5. Update webhook record
  await db('webhook_events')
    .where({ gateway: gateway.name, reference })
    .update({ processed: true, processed_at: new Date() });
  
  return result;
};
```

### 6.5 Offline Payment Recording

```javascript
// Offline payment flow
const recordOfflinePayment = async (orderId, payment) => {
  // 1. Record locally
  const offlinePayment = {
    id: generateId(),
    orderId,
    method: payment.method,
    amount: payment.amount,
    recordedAt: new Date(),
    synced: false
  };
  
  await localDb('payments').insert(offlinePayment);
  
  // 2. Create sync event
  await localDb('events').insert({
    id: generateId(),
    type: 'payment.recorded',
    payload: offlinePayment,
    at: new Date(),
    synced: false
  });
  
  // 3. Update order status locally
  await localDb('orders')
    .where({ id: orderId })
    .update({ status: 'Paid', paidAt: new Date() });
  
  // 4. Queue for sync
  syncQueue.add({ type: 'payment', data: offlinePayment });
};

// Sync reconciliation
const reconcileOfflinePayments = async () => {
  const unsynced = await localDb('payments').where({ synced: false });
  
  for (const payment of unsynced) {
    try {
      // Send to server
      await api.post('/payments/offline-sync', payment);
      
      // Mark as synced
      await localDb('payments')
        .where({ id: payment.id })
        .update({ synced: true, syncedAt: new Date() });
    } catch (err) {
      logger.error({ payment, err }, 'Failed to sync payment');
      // Will retry on next sync cycle
    }
  }
};
```

### 6.6 Subscription Tier Enforcement

```typescript
// Entitlement checking
interface SubscriptionInfo {
  tier: 'trial' | 'basic' | 'pro' | 'enterprise';
  modules: string[];
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: Date;
}

const MODULES_BY_TIER = {
  trial: ['settings'],
  basic: ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings'],
  pro: ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'],
  enterprise: ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings', 'enterprise_support']
};

const canAccessModule = (subscription: SubscriptionInfo, module: string): boolean => {
  // Check subscription status
  if (subscription.status === 'canceled') return false;
  
  // Check module entitlement
  const allowedModules = subscription.modules.length > 0 
    ? subscription.modules 
    : MODULES_BY_TIER[subscription.tier];
  
  return allowedModules.includes(module);
};
```

### 6.7 Trial Mode Restrictions

```javascript
// Trial enforcement
const enforceTrialRestrictions = (tenant) => {
  // Check trial expiry
  if (tenant.plan === 'trial') {
    if (new Date() > new Date(tenant.trial_ends_at)) {
      // Trial expired
      return {
        allowed: false,
        redirect: '/billing',
        message: 'Your trial has expired. Please subscribe to continue.'
      };
    }
    
    // Trial active - limited features
    return {
      allowed: true,
      restrictedModules: ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches'],
      allowedModules: ['settings'],
      daysRemaining: Math.ceil((new Date(tenant.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
    };
  }
  
  // Paid subscription
  return { allowed: true, restrictedModules: [] };
};
```

---

## 7. OFFLINE & SYNC MECHANICS

### 7.1 Local SQLite Schema

```sql
-- Local database mirrors cloud subset
-- Location: electron/sqlite.mjs

-- Core tables (simplified from cloud)
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  total REAL NOT NULL,
  tax REAL NOT NULL,
  items TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL,
  paid_at TEXT,
  synced INTEGER DEFAULT 0,
  sync_error TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);

CREATE TABLE pos_state (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id)
);

-- Sync tracking
CREATE TABLE sync_cursor (
  tenant_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  cursor INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Pending operations queue
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  error TEXT
);
```

### 7.2 Event Sourcing Implementation

#### Event Store Schema

```typescript
// Event payload schemas by type
interface EventPayloads {
  'order.created': {
    order: Order;
    tableId: string;
    staffId: string;
  };
  
  'order.updated': {
    orderId: string;
    changes: Partial<Order>;
    previous: Order;
  };
  
  'order.voided': {
    orderId: string;
    reason: string;
    voidedBy: string;
  };
  
  'order.paid': {
    orderId: string;
    payment: Payment;
    change?: number;
  };
  
  'inventory.adjusted': {
    itemId: string;
    delta: number;
    reason: string;
    previousStock: number;
  };
  
  'staff.clock_in': {
    staffId: string;
    shiftId: string;
    deviceId: string;
  };
  
  'staff.clock_out': {
    staffId: string;
    shiftId: string;
    duration: number;
  };
}
```

#### Event Ordering Guarantees

```javascript
// Cursor-based ordering
const getEventsSince = async (tenantId, branchId, cursor) => {
  return db('events')
    .where({ tenant_id: tenantId, branch_id: branchId })
    .where('cursor', '>', cursor)
    .orderBy('cursor', 'asc')  // Strict ordering
    .limit(100);               // Batch size
};

// Cursor generation
const generateCursor = () => {
  // Hybrid logical clock: timestamp + sequence
  return Date.now() * 1000 + (sequence++ % 1000);
};
```

### 7.3 Sync API Contract

#### Sync Request

```typescript
interface SyncRequest {
  // Client state
  cursor: number;              // Last received event cursor
  pendingEvents: Event[];     // Client events to push
  
  // Metadata
  deviceId: string;
  appVersion: string;
  timestamp: ISO8601;
}
```

#### Sync Response

```typescript
interface SyncResponse {
  // Server events
  events: Event[];            // New events since cursor
  newCursor: number;          // Updated cursor position
  hasMore: boolean;           // More events available?
  
  // Acknowledgments
  acceptedEvents: string[];   // Event IDs accepted
  rejectedEvents: {          // Event IDs rejected with reason
    id: string;
    reason: string;
  }[];
  
  // State snapshot (if requested)
  snapshot?: PosState;
}
```

#### Batch Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Event batch size** | 100 | Balance latency vs. payload size |
| **Sync interval** | 30 seconds | Near real-time without hammering |
| **Retry interval** | 5 seconds (exponential) | Recover from transient errors |
| **Max retry** | 5 | Prevent infinite loops |
| **Timeout** | 30 seconds | Handle slow connections |

### 7.4 Conflict Resolution Rules

#### Resolution Matrix

| Entity | Rule | Implementation |
|--------|------|----------------|
| **Orders** | Server wins | Reject client update if server version newer |
| **Payments** | Server wins | Payment gateway is source of truth |
| **Inventory** | Merge (additive) | Sum adjustments from both sides |
| **Staff clock** | Server wins | Payroll accuracy critical |
| **Settings** | Last write wins | User preference, low risk |
| **Menu** | Server wins | Centralized management |
| **Customers** | Merge (update fields) | Combine changes if no overlap |

#### Conflict Detection

```javascript
const detectConflict = (localEvent, serverEvent) => {
  // Same entity modified on both sides
  if (localEvent.entityId === serverEvent.entityId) {
    // Check timestamps
    const localTime = new Date(localEvent.at);
    const serverTime = new Date(serverEvent.at);
    
    if (Math.abs(localTime - serverTime) < 5000) {
      // Within 5 seconds - potential conflict
      return { conflict: true, type: 'simultaneous' };
    }
    
    if (localTime < serverTime) {
      return { conflict: true, type: 'server_newer' };
    }
  }
  
  return { conflict: false };
};
```

### 7.5 Network State Detection

```javascript
// Network state management
const useNetworkState = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      triggerSync(); // Sync when coming back online
    };
    
    const handleOffline = () => {
      setOnline(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  // Periodic sync when online
  useEffect(() => {
    if (!online) return;
    
    const interval = setInterval(() => {
      triggerSync();
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, [online]);
  
  return { online, syncing };
};
```

### 7.6 Data Loss Scenarios

#### Scenario Analysis

| Scenario | Risk | Mitigation |
|----------|------|------------|
| **Device crash** | Local data loss | SQLite WAL mode, frequent sync |
| **Sync failure** | Data not reaching cloud | Retry queue, exponential backoff |
| **Conflict resolution** | Data overwritten | Event sourcing, audit log |
| **Concurrent edits** | Lost updates | Optimistic locking, version numbers |
| **Network partition** | Split-brain | Server-wins for critical data |
| **App uninstall** | Total local loss | Cloud is primary, local is cache |

#### Recovery Paths

```javascript
// Data recovery flow
const recoverData = async (tenantId, branchId) => {
  // 1. Fetch latest state from cloud
  const cloudState = await api.get(`/sync/state?tenantId=${tenantId}&branchId=${branchId}`);
  
  // 2. Rebuild local database
  await localDb.transaction(async (trx) => {
    // Clear local data
    await trx('orders').del();
    await trx('events').del();
    
    // Insert cloud data
    await trx('orders').insert(cloudState.orders);
    await trx('events').insert(cloudState.events);
    
    // Update cursor
    await trx('sync_cursor').insert({
      tenant_id: tenantId,
      branch_id: branchId,
      cursor: cloudState.cursor,
      updated_at: new Date().toISOString()
    });
  });
  
  // 3. Replay events to rebuild state
  await replayEvents(tenantId, branchId, 0);
};
```

---

## 8. DESKTOP-SPECIFIC SYSTEMS

### 8.1 Electron Main Process Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS (Node.js)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Window     │  │    Menu      │  │    Tray      │          │
│  │   Manager    │  │    Bar       │  │    Icon      │          │
│  │              │  │              │  │              │          │
│  │ - Create     │  │ - App menu   │  │ - Show/hide  │          │
│  │ - Destroy    │  │ - Context    │  │ - Quit       │          │
│  │ - Focus      │  │ - Shortcuts  │  │ - Status     │          │
│  └──────┬───────┘  └──────────────┘  └──────────────┘          │
│         │                                                       │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   SQLite     │  │   Printer    │  │   Updater    │          │
│  │   Database   │  │   Service    │  │   Service    │          │
│  │              │  │              │  │              │          │
│  │ - better-    │  │ - ESC/POS    │  │ - GitHub     │          │
│  │   sqlite3    │  │   commands   │  │   Releases   │          │
│  │ - Local      │  │ - Network    │  │ - Auto-      │          │
│  │   storage    │  │   discovery  │  │   download   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │   File       │  │   IPC        │                            │
│  │   System     │  │   Handler    │                            │
│  │              │  │              │                            │
│  │ - Exports    │  │ - Channel    │                            │
│  │ - Logs       │  │   routing    │                            │
│  │ - User data  │  │ - Security   │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 IPC Channel Inventory

#### Complete Channel List

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `sqlite:query` | R→M | `handleQuery` | Execute SELECT |
| `sqlite:exec` | R→M | `handleExec` | Execute INSERT/UPDATE/DELETE |
| `sqlite:transaction` | R→M | `handleTransaction` | Multi-statement transaction |
| `sqlite:backup` | R→M | `handleBackup` | Backup database |
| `sqlite:restore` | R→M | `handleRestore` | Restore from backup |
| `printer:print` | R→M | `handlePrint` | Send to thermal printer |
| `printer:list` | R→M | `handleListPrinters` | Discover printers |
| `printer:status` | R→M | `handlePrinterStatus` | Check printer status |
| `printer:configure` | R→M | `handleConfigurePrinter` | Set default printer |
| `updater:check` | R→M | `handleCheckUpdate` | Check for updates |
| `updater:download` | R→M | `handleDownloadUpdate` | Download update |
| `updater:install` | R→M | `handleInstallUpdate` | Install and restart |
| `updater:state` | M→R | Event emitter | Update status changes |
| `app:restart` | R→M | `handleRestart` | Restart application |
| `app:version` | R→M | `handleGetVersion` | Get app version |
| `app:quit` | R→M | `handleQuit` | Quit application |
| `window:minimize` | R→M | `handleMinimize` | Minimize window |
| `window:maximize` | R→M | `handleMaximize` | Maximize/restore |
| `window:close` | R→M | `handleClose` | Close window |
| `window:open-devtools` | R→M | `handleOpenDevTools` | Open DevTools |
| `file:export` | R→M | `handleExport` | Save file to disk |
| `file:open` | R→M | `handleOpen` | Read file from disk |
| `file:select` | R→M | `handleSelectFile` | Show file picker |
| `notification:show` | R→M | `handleShowNotification` | OS notification |
| `log:write` | R→M | `handleWriteLog` | Write to log file |

### 8.3 Auto-Updater Implementation

#### Update Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│   App    │────▶│  Check   │────▶│ Download │────▶│ Install  │
│  Starts  │     │  Update  │     │  Update  │     │ & Restart│
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                 │                 │                 │
     │                 │                 │                 │
     ▼                 ▼                 ▼                 ▼
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Check   │     │ Compare  │     │ Download │     │ Quit &  │
│  GitHub  │     │ Version  │     │  .exe    │     │ Install  │
│ Releases │     │  > ?     │     │  to temp │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

#### Implementation

```javascript
// electron/main.mjs
import { autoUpdater } from 'electron-updater';

// Configuration
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'firaghost',
  repo: 'mirachpos-releases'
});

// Check on startup
app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

// Event handlers
autoUpdater.on('checking-for-update', () => {
  sendToRenderer('updater:state', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  sendToRenderer('updater:state', { 
    status: 'available', 
    version: info.version 
  });
});

autoUpdater.on('download-progress', (progress) => {
  sendToRenderer('updater:state', {
    status: 'downloading',
    progress: progress.percent
  });
});

autoUpdater.on('update-downloaded', () => {
  sendToRenderer('updater:state', { status: 'downloaded' });
});

// Install handler
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});
```

### 8.4 Printer Integration

#### ESC/POS Command Generation

```javascript
// ESC/POS receipt generator
class ReceiptPrinter {
  generateReceipt(order) {
    const commands = [];
    
    // Initialize printer
    commands.push(Buffer.from([0x1B, 0x40])); // ESC @
    
    // Center alignment
    commands.push(Buffer.from([0x1B, 0x61, 0x01]));
    
    // Header
    commands.push(this.text('MIRACH POS', { bold: true, size: 2 }));
    commands.push(this.text(order.branchName));
    commands.push(this.text('------------------------------'));
    
    // Order details
    commands.push(this.text(`Order #${order.number}`));
    commands.push(this.text(`Table: ${order.tableName}`));
    commands.push(this.text(`Date: ${formatDate(order.createdAt)}`));
    commands.push(this.text('------------------------------'));
    
    // Items
    commands.push(this.text('QTY  ITEM              PRICE'));
    for (const item of order.items) {
      commands.push(this.text(
        `${item.qty}x ${item.name.padEnd(15)} ${formatCurrency(item.unitPrice * item.qty)}`
      ));
    }
    
    commands.push(this.text('------------------------------'));
    
    // Totals
    commands.push(this.text(`Subtotal: ${formatCurrency(order.subtotal)}`, { align: 'right' }));
    commands.push(this.text(`Tax: ${formatCurrency(order.tax)}`, { align: 'right' }));
    commands.push(this.text(`Total: ${formatCurrency(order.total)}`, { align: 'right', bold: true }));
    
    // Footer
    commands.push(this.text('------------------------------'));
    commands.push(this.text('Thank you for your business!'));
    commands.push(this.text('Powered by MirachPOS'));
    
    // Cut paper
    commands.push(Buffer.from([0x1D, 0x56, 0x00]));
    
    return Buffer.concat(commands);
  }
  
  text(str, options = {}) {
    let buffer = Buffer.from(str + '\n', 'ascii');
    
    if (options.bold) {
      buffer = Buffer.concat([
        Buffer.from([0x1B, 0x45, 0x01]), // Bold on
        buffer,
        Buffer.from([0x1B, 0x45, 0x00])  // Bold off
      ]);
    }
    
    return buffer;
  }
}
```

#### Network Printer Discovery

```javascript
// Discover network printers
const discoverPrinters = async () => {
  const printers = [];
  
  // mDNS/Bonjour discovery
  const bonjour = require('bonjour')();
  const browser = bonjour.find({ type: 'ipp' });
  
  browser.on('up', (service) => {
    printers.push({
      name: service.name,
      address: service.referer.address,
      port: service.port,
      type: 'network'
    });
  });
  
  // Direct IP scan (common printer IPs)
  const commonIPs = ['192.168.1.100', '192.168.1.101'];
  for (const ip of commonIPs) {
    try {
      await fetch(`http://${ip}:9100`, { method: 'HEAD', timeout: 1000 });
      printers.push({ name: `Printer at ${ip}`, address: ip, port: 9100, type: 'raw' });
    } catch {
      // Not a printer
    }
  }
  
  return printers;
};
```

### 8.5 Local File System Access

#### User Data Directory Structure

```
~/.config/MirachPOS/          # Linux
~/Library/Application Support/MirachPOS/  # macOS
%APPDATA%/MirachPOS/          # Windows
├── mirachpos.db              # SQLite database
├── mirachpos.db-wal          # Write-ahead log
├── mirachpos.db-shm          # Shared memory
├── logs/
│   ├── main.log              # Main process logs
│   ├── renderer.log          # Renderer logs
│   └── sync.log              # Sync operation logs
├── exports/                  # Exported files
│   ├── reports/
│   ├── backups/
│   └── receipts/
├── cache/                    # Temporary files
└── config.json               # Local settings
```

#### File Access Patterns

```javascript
// IPC handlers for file operations
ipcMain.handle('file:export', async (event, { data, filename, type }) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: [
      { name: 'Excel', extensions: ['xlsx'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!filePath) return { canceled: true };
  
  await fs.writeFile(filePath, Buffer.from(data));
  return { success: true, path: filePath };
});

ipcMain.handle('file:select', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'png'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  return filePaths?.[0] || null;
});
```

---

## 9. PERFORMANCE & SCALABILITY

### 9.1 Current Bottlenecks

| Area | Issue | Impact |
|------|-------|--------|
| **Database** | No read replicas | Single point of failure |
| **Caching** | No Redis layer | Repeated queries |
| **API** | Single Node.js process | CPU bottleneck |
| **Frontend** | Large bundle size | Slow initial load |
| **Sync** | Full state sync | Bandwidth heavy |

### 9.2 Scalability Roadmap

| Phase | Target | Actions |
|-------|--------|---------|
| **Phase 1** | 10 customers | Monitoring, backups, basic optimization |
| **Phase 2** | 50 customers | Redis caching, DB indexes, clustering |
| **Phase 3** | 100+ customers | Read replicas, CDN, microservices |
| **Phase 4** | Enterprise | Multi-region, sharding, dedicated infra |

### 9.3 Monitoring & Observability

#### Metrics Collection

```javascript
// Prometheus metrics
const metrics = {
  // Request metrics
  httpRequestsTotal: new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status']
  }),
  
  httpRequestDuration: new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route']
  }),
  
  // Business metrics
  ordersCreated: new Counter({
    name: 'orders_created_total',
    help: 'Total orders created',
    labelNames: ['tenant_id', 'branch_id']
  }),
  
  paymentsProcessed: new Counter({
    name: 'payments_processed_total',
    help: 'Total payments processed',
    labelNames: ['method', 'status']
  }),
  
  // Sync metrics
  syncEventsTotal: new Counter({
    name: 'sync_events_total',
    help: 'Total sync events',
    labelNames: ['direction', 'status']
  })
};
```

#### Health Checks

```javascript
// /health endpoint
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    disk: checkDiskSpace(),
    memory: checkMemory()
  };
  
  const healthy = Object.values(checks).every(c => c.status === 'up');
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks
  });
});
```

---

## 10. DEPLOYMENT & OPERATIONS

### 10.1 Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: ./api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=mysql
      - DB_USER=mirachpos
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=mirachpos
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - mysql
      - redis
    restart: unless-stopped
    
  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - MYSQL_DATABASE=mirachpos
      - MYSQL_USER=mirachpos
      - MYSQL_PASSWORD=${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped
    
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    
volumes:
  mysql_data:
  redis_data:
```

### 10.2 cPanel Deployment

#### Deployment Steps

1. **Upload code** via FTP/Git
2. **Install dependencies:** `npm install --production`
3. **Set environment variables** in `.env`
4. **Run migrations:** `npx knex migrate:latest`
5. **Start with PM2:** `pm2 start api/src/index.js --name mirachpos-api`
6. **Configure Apache/Nginx** reverse proxy

#### .htaccess Configuration

```apache
# Redirect to Node.js app
RewriteEngine On
RewriteRule ^$ http://localhost:3000/ [P,L]
RewriteRule ^(.*)$ http://localhost:3000/$1 [P,L]

# Security headers
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "no-referrer"
```

---

## 11. CONCLUSION

### Strengths

1. **Solid Architecture:** Multi-tenant, offline-first, event-sourced
2. **Market Fit:** Ethiopian payment integration, ERCA compliance
3. **Feature Complete:** Comprehensive POS, KDS, reporting
4. **Modern Stack:** React 19, TypeScript, Electron
5. **Solo Developer Achievement:** ~50K LOC, production-ready

### Areas for Improvement

1. **Security:** Add MFA, expand input validation, audit SQL injection
2. **Scalability:** Add Redis, implement clustering, add read replicas
3. **Testing:** Increase test coverage, add E2E tests
4. **Documentation:** API docs (OpenAPI), runbooks
5. **Monitoring:** Add alerting, improve observability

### Technical Debt Priority

| Priority | Item | Effort |
|----------|------|--------|
| 🔴 High | Input validation (Zod everywhere) | 2 weeks |
| 🔴 High | Super Admin MFA | 1 week |
| 🟡 Medium | Redis caching layer | 2 weeks |
| 🟡 Medium | API documentation | 1 week |
| 🟢 Low | Test coverage | Ongoing |

---

**End of Technical Analysis**

*Generated for MirachPOS v0.2.6 | March 2026*
