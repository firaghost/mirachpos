# MirachPOS — Developer Handbook

> Complete system documentation for the MirachPOS SaaS platform  
> Version: 0.2.6 | Last Updated: March 2026

---

## 1. Overview

**MirachPOS** is a comprehensive, role-based Point of Sale (POS) system designed specifically for Ethiopian restaurants and cafes. Built as a multi-tenant SaaS platform with offline-first capabilities, it bridges the gap between modern cloud-based POS systems and the realities of operating in markets with intermittent connectivity.

### Purpose & Market Fit
- **Target Market:** Restaurants, cafes, and hospitality businesses in Ethiopia
- **Key Differentiator:** 100% offline-first architecture with seamless cloud sync
- **Competitive Edge:** Native integration with Ethiopian payment gateways (Telebirr, Chapa)
- **Compliance:** ERCA (Ethiopian Revenue & Customs Authority) tax reporting ready
- **Deployment:** Desktop-first via Electron, with web fallback

### System Capabilities
- Multi-branch restaurant management
- Real-time Kitchen Display System (KDS)
- Ethiopian mobile money integration
- Role-based access control (5 role tiers)
- Inventory with recipe costing
- Staff scheduling & shift management
- Comprehensive reporting & analytics

---

## 2. Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Frontend Framework** | React | 19.2.3 | UI components & state management |
| **Language** | TypeScript | 5.8.2 | Type safety across codebase |
| **Build Tool** | Vite | 6.2.0 | Fast development & production builds |
| **Desktop Shell** | Electron | 38.0.0 | Cross-platform desktop app |
| **Desktop Builder** | electron-builder | 26.4.0 | NSIS installer generation |
| **Backend Runtime** | Node.js | 22.x / 20.x | API server |
| **Backend Framework** | Express.js | 4.x | HTTP routing & middleware |
| **Primary Database** | MySQL2 | - | Cloud production database |
| **Local Database** | SQLite / better-sqlite3 | 11.7.0 | Offline desktop storage |
| **Query Builder** | Knex.js | - | SQL migrations & queries |
| **Styling** | Tailwind CSS | 3.4.17 | Utility-first CSS |
| **Animation** | tailwindcss-animate | 1.0.7 | UI transitions |
| **Icons** | Lucide React | 0.542.0 | Icon library |
| **Charts** | Recharts | 3.6.0 | Data visualization |
| **PDF Generation** | jsPDF + jspdf-autotable | 4.0.0 | Receipt & report PDFs |
| **Excel Export** | exceljs | 4.4.0 | XLSX report generation |
| **Testing** | Vitest + jsdom | 3.2.4 | Unit testing |
| **Linting** | ESLint + @typescript-eslint | 8.26.1 | Code quality |
| **Process Management** | concurrently | 9.2.1 | Dev script orchestration |
| **Monitoring** | Grafana Faro | 2.2.2 | Frontend observability |
| **Firebase** | firebase | 12.9.0 | Auth & real-time features |

### CI/CD & Deployment
- **Version Control:** GitHub (mirachpos repo)
- **Auto-Updater:** GitHub Releases (mirachpos-releases repo)
- **Containerization:** Docker + docker-compose
- **Hosting:** cPanel-ready with deployment guides
- **Package Manager:** npm with lockfile enforcement

---

## 3. Project Structure

```
mirachpos/
├── api/                          # Backend API
│   ├── migrations/               # 50+ Knex database migrations
│   ├── src/
│   │   ├── routes/               # 45+ API route modules
│   │   ├── middleware/           # Auth, rate limiting, validation
│   │   ├── services/             # Business logic layer
│   │   ├── jobs/                 # Background job handlers
│   │   ├── pages/                # Server-rendered pages (checkout, receipt)
│   │   ├── utils/                # Helper utilities
│   │   ├── config.js             # Environment configuration
│   │   ├── db.js                 # Database connection manager
│   │   ├── app.js                # Express app factory
│   │   └── index.js              # Server entry point (clustering support)
│   ├── tests/                    # API test suite
│   └── uploads/                  # File upload storage
├── screens/                      # React screen components
│   ├── waiter/                   # Waiter & Waiter Manager screens (16 files)
│   ├── waiter2/                  # POS UI v2 components
│   ├── manager/                  # Branch Manager screens (14 files)
│   ├── owner/                    # Cafe Owner screens (10 files)
│   ├── superadmin/               # Super Admin screens (14 files)
│   ├── support/                  # Support request screens
│   └── desktop/                  # Desktop-specific screens
├── components/                   # Shared React components
│   ├── ui/                       # Base UI components
│   ├── settings/                 # Settings forms
│   └── lib/                      # Component utilities
├── hooks/                        # Custom React hooks
│   ├── usePosIdleTimeout.ts      # Auto-logout on inactivity
│   └── useSessionEventWiring.ts  # Cross-tab session sync
├── electron/                     # Desktop app files
│   ├── main.mjs                  # Main process entry
│   ├── preload.mjs/cjs           # Context bridge (IPC)
│   └── sqlite.mjs                # Local database operations
├── src/                          # Additional source (minimal)
│   └── dataconnect-generated/    # Firebase generated code
├── lib/                          # Utility libraries
├── utils/                        # Helper functions
├── public/                       # Static assets
│   └── app.icon.png              # App icon
├── types.ts                      # Shared TypeScript types/enums
├── rbac.ts                       # Role-based access control logic
├── api.ts                        # HTTP client with interceptors
├── session.ts                    # Session storage helpers
├── PosContext.tsx                # POS global state provider
├── ThemeContext.tsx              # Dark/light theme provider
├── App.tsx                       # Root component with screen router
├── vite.config.ts                # Vite configuration
├── vitest.config.ts              # Test configuration
├── tailwind.config.cjs           # Tailwind theme config
├── tsconfig.json                 # TypeScript configuration
├── docker-compose.yml            # Docker orchestration
├── vercel.json                   # Vercel deployment config
├── .eslintrc.cjs                 # ESLint rules
└── package.json                  # Dependencies & scripts
```

---

## 4. Roles & Permissions

### User Role Hierarchy

| Role | Level | Scope | Typical Users |
|------|-------|-------|---------------|
| **Super Admin** | 5 | System-wide | Platform administrators |
| **Cafe Owner** | 4 | Multi-branch | Business owners, CEOs |
| **Branch Manager** | 3 | Single branch | Location managers |
| **Waiter Manager** | 2 | Single branch | Head waiters, shift supervisors |
| **Waiter** | 1 | Single branch | Front-line staff |

### Role Capabilities Matrix

```typescript
enum UserRole {
  WAITER = 'Waiter',
  WAITER_MANAGER = 'Waiter Manager',
  BRANCH_MANAGER = 'Branch Manager',
  CAFE_OWNER = 'Cafe Owner',
  SUPER_ADMIN = 'Super Admin'
}
```

#### Waiter
- Floor plan view & table management
- Order taking & menu browsing
- Payment processing (cash, mobile, split bills)
- Receipt printing & reprinting
- Kitchen Display System (KDS) view
- Shift reports (personal)
- Order history (personal)
- Active orders management

#### Waiter Manager
- **Everything Waiter can do, plus:**
- Void orders (with reason)
- View all staff orders (not just own)
- Manage table assignments
- Override prices (if permitted)
- View team performance

#### Branch Manager
- Branch dashboard & analytics
- Complete order management (all orders)
- Floor plan editor (table layout)
- Menu builder & recipe management
- Inventory management (stock in/out)
- Supplier management
- Staff management (branch level)
- Shift scheduling
- Customer management
- Branch reports & exports
- Settings (branch level)

#### Cafe Owner
- **Everything Branch Manager can do, plus:**
- Global dashboard (all branches)
- Multi-branch financial reports
- Cross-branch inventory view
- Staff management (all branches)
- Subscription & billing management
- Branch onboarding & creation
- Audit logs (system-wide)
- Owner-level settings
- Support request submission

#### Super Admin
- System overview dashboard
- Tenant management (all cafes/restaurants)
- Feature flag management
- System health monitoring
- Demo request handling
- Global billing oversight
- Payment gateway configuration
- Integration management
- Add-on marketplace control

### Permission System

Permissions are stored as an array of strings in the session:

```typescript
type PermissionList = string[];

// Examples
['orders.read', 'orders.write', 'inventory.read']
['*'] // Super permission (all access)
```

**Key Permissions:**
| Permission | Description |
|------------|-------------|
| `orders.read` | View orders |
| `orders.write` | Create/modify orders |
| `inventory.read` | View inventory |
| `inventory.manage` | Modify stock |
| `staff.read` | View staff list |
| `staff.manage` | Add/edit staff |
| `finance.read` | View financial data |
| `finance.manage` | Manage finances |
| `settings.manage` | Change settings |
| `menu.manage` | Edit menus |
| `branches.read` | View branches |
| `manager.settings.read` | Branch settings |

---

## 5. Screen Routing

### Navigation Architecture

- **Router Type:** Custom hash-based screen router + URL path support
- **State Management:** URL path + sessionStorage + localStorage
- **Lazy Loading:** All screens loaded via React.lazy()

### Screen Enum (Complete)

```typescript
enum Screen {
  // Auth
  LOGIN = 'LOGIN',
  BRANCH_SELECT = 'BRANCH_SELECT',
  OWNER_ONBOARDING = 'OWNER_ONBOARDING',
  
  // Shared
  DASHBOARD = 'DASHBOARD',
  ORDERS = 'ORDERS',
  TABLE_ASSIGNMENT = 'TABLE_ASSIGNMENT',
  GUESTS = 'GUESTS',
  SUPPORT_REQUEST = 'SUPPORT_REQUEST',
  
  // Waiter
  WAITER_DASHBOARD = 'WAITER_DASHBOARD',
  WAITER_MENU = 'WAITER_MENU',
  WAITER_REVIEW = 'WAITER_REVIEW',
  WAITER_PAYMENT = 'WAITER_PAYMENT',
  WAITER_RECEIPT = 'WAITER_RECEIPT',
  WAITER_ACTIVE_ORDERS = 'WAITER_ACTIVE_ORDERS',
  WAITER_STATUS = 'WAITER_STATUS',
  WAITER_KDS = 'WAITER_KDS',
  WAITER_KITCHEN = 'WAITER_KITCHEN',
  WAITER_EXPO = 'WAITER_EXPO',
  WAITER_HISTORY = 'WAITER_HISTORY',
  WAITER_NOTIFICATIONS = 'WAITER_NOTIFICATIONS',
  WAITER_SYSTEM = 'WAITER_SYSTEM',
  WAITER_SETTINGS = 'WAITER_SETTINGS',
  WAITER_SHIFT_REPORT = 'WAITER_SHIFT_REPORT',
  WAITER_SCHEDULE = 'WAITER_SCHEDULE',
  POS_FLOOR = 'POS_FLOOR',
  POS_MENU = 'POS_MENU',
  
  // Branch Manager
  MANAGER_DASHBOARD = 'MANAGER_DASHBOARD',
  MANAGER_ORDERS = 'MANAGER_ORDERS',
  MANAGER_ORDER_DETAILS = 'MANAGER_ORDER_DETAILS',
  MANAGER_FLOOR_MAP = 'MANAGER_FLOOR_MAP',
  MANAGER_TABLE_DETAILS = 'MANAGER_TABLE_DETAILS',
  MANAGER_CUSTOMERS = 'MANAGER_CUSTOMERS',
  MANAGER_INVENTORY = 'MANAGER_INVENTORY',
  MANAGER_RECIPE_BUILDER = 'MANAGER_RECIPE_BUILDER',
  MANAGER_MENU_BUILDER = 'MANAGER_MENU_BUILDER',
  MANAGER_STAFF = 'MANAGER_STAFF',
  MANAGER_SETTINGS = 'MANAGER_SETTINGS',
  MANAGER_FINANCE = 'MANAGER_FINANCE',
  MANAGER_REPORTS = 'MANAGER_REPORTS',
  STAFF_SCHEDULE = 'STAFF_SCHEDULE',
  DESKTOP_DRAFT_INBOX = 'DESKTOP_DRAFT_INBOX',
  
  // Cafe Owner
  OWNER_DASHBOARD = 'OWNER_DASHBOARD',
  OWNER_FINANCE = 'OWNER_FINANCE',
  OWNER_REPORTS = 'OWNER_REPORTS',
  OWNER_INVENTORY = 'OWNER_INVENTORY',
  OWNER_STAFF = 'OWNER_STAFF',
  OWNER_AUDIT = 'OWNER_AUDIT',
  OWNER_SETTINGS = 'OWNER_SETTINGS',
  OWNER_MENU = 'OWNER_MENU',
  OWNER_BRANCHES = 'OWNER_BRANCHES',
  OWNER_BILLING = 'OWNER_BILLING',
  
  // Super Admin
  SA_OVERVIEW = 'SA_OVERVIEW',
  SA_TENANTS = 'SA_TENANTS',
  SA_TENANT_DETAILS = 'SA_TENANT_DETAILS',
  SA_ONBOARDING = 'SA_ONBOARDING',
  SA_BILLING = 'SA_BILLING',
  SA_PAYMENT_CONFIG = 'SA_PAYMENT_CONFIG',
  SA_SYSTEM_HEALTH = 'SA_SYSTEM_HEALTH',
  SA_SUPPORT = 'SA_SUPPORT',
  SA_AUDIT = 'SA_AUDIT',
  SA_FEATURE_FLAGS = 'SA_FEATURE_FLAGS',
  SA_SETTINGS = 'SA_SETTINGS',
  SA_DEMO_REQUESTS = 'SA_DEMO_REQUESTS',
  SA_INTEGRATIONS = 'SA_INTEGRATIONS',
  SA_ADDONS = 'SA_ADDONS'
}
```

### URL Routing Mapping

| URL Path | Screen | Role Access |
|----------|--------|-------------|
| `/waiter/dashboard` | WAITER_DASHBOARD | Waiter, Waiter Manager |
| `/waiter/menu` | WAITER_MENU | Waiter, Waiter Manager |
| `/waiter/payment` | WAITER_PAYMENT | Waiter, Waiter Manager |
| `/waiter/kds` | WAITER_KDS | Waiter, Waiter Manager |
| `/manager/dashboard` | MANAGER_DASHBOARD | Branch Manager, Cafe Owner |
| `/manager/orders` | MANAGER_ORDERS | Branch Manager, Cafe Owner |
| `/manager/inventory` | MANAGER_INVENTORY | Branch Manager, Cafe Owner |
| `/owner/dashboard` | OWNER_DASHBOARD | Cafe Owner |
| `/owner/branches` | OWNER_BRANCHES | Cafe Owner |
| `/owner/billing` | OWNER_BILLING | Cafe Owner |
| `/superadmin/overview` | SA_OVERVIEW | Super Admin |
| `/superadmin/tenants` | SA_TENANTS | Super Admin |

### Session Persistence

Session data is stored across multiple mechanisms:

1. **sessionStorage** — Primary session data (token, role, tenant)
2. **localStorage** — Long-term preferences (last screen, last workspace)
3. **BroadcastChannel** — Cross-tab synchronization
4. **URL hash/path** — Deep linking & refresh recovery

```typescript
// Key storage keys
'mirachpos.session.v1'           // Main session
'mirachpos.lastScreen.v1'        // Last active screen
'mirachpos.lastWorkspace.v1'     // Last selected tenant
'mirachpos.waiter.selectedBranchId.v1'
'mirachpos.manager.selectedBranchId.v1'
'mirachpos.owner.selectedBranchId.v1'
```

---

## 6. API Architecture

### Route Organization

Routes are organized by domain and role access level:

| Route File | Purpose | Auth Level |
|------------|---------|------------|
| `auth.js` | Login, logout, password reset | Public |
| `superadminAuth.js` | Super admin login | Public |
| `public.js` | Signup, public POS links | Public |
| `branches.js` | Branch CRUD operations | Authenticated |
| `owner.js` | Cafe owner operations | Cafe Owner |
| `ownerStaff.js` | Owner-level staff management | Cafe Owner |
| `manager.js` | Branch manager operations | Branch Manager+ |
| `managerStaff.js` | Branch staff management | Branch Manager+ |
| `managerMenu.js` | Menu builder | Branch Manager+ |
| `managerFinance.js` | Financial operations | Branch Manager+ |
| `managerPayments.js` | Payment processing | Branch Manager+ |
| `managerCustomers.js` | Customer management | Branch Manager+ |
| `managerSuppliers.js` | Supplier management | Branch Manager+ |
| `managerPurchaseOrders.js` | Purchase orders | Branch Manager+ |
| `managerPrint.js` | Receipt printing | Branch Manager+ |
| `managerAudit.js` | Branch audit logs | Branch Manager+ |
| `waiter.js` | Waiter operations | Waiter+ |
| `pos.js` | Core POS operations | Waiter+ |
| `posCustomers.js` | POS customer operations | Waiter+ |
| `inventory.js` | Inventory management | Branch Manager+ |
| `staff.js` | Staff operations (general) | Authenticated |
| `schedule.js` | Shift scheduling | Branch Manager+ |
| `subscription.js` | Subscription management | Cafe Owner |
| `subscriptionStatus.js` | Status checks | Authenticated |
| `superadmin.js` | Super admin operations | Super Admin |
| `admin.js` | Admin operations | Admin+ |
| `adminMetrics.js` | System metrics | Super Admin |
| `audit.js` | Audit logging | Authenticated |
| `support.js` | Support tickets | Authenticated |
| `sync.js` | Offline sync endpoints | Authenticated |
| `webhook.js` | Payment gateway webhooks | Public (signed) |
| `realtime.js` | WebSocket/realtime events | Authenticated |
| `fcm.js` | Firebase Cloud Messaging | Authenticated |
| `integrations.js` | Third-party integrations | Super Admin |
| `telebirrStandingOrder.js` | Telebirr standing orders | Cafe Owner |
| `customReports.js` | Custom report builder | Cafe Owner |
| `enhancedReports.js` | Enhanced reporting | Branch Manager+ |
| `guests.js` | Guest/loyalty management | Branch Manager+ |

### Middleware Stack

Middleware executes in this order:

1. **requestIdMiddleware** — Generates unique request ID for tracing
2. **addRequestIdToResponse** — Adds X-Request-ID header
3. **addRequestIdToJsonBody** — Injects requestId into JSON responses
4. **helmet** — Security headers (CSP, HSTS, frameguard)
5. **compression** — Gzip compression (threshold: 1KB)
6. **webhookBodyParser** — Raw body handling for webhooks
7. **express.json()** — JSON body parsing (10MB limit)
8. **cors** — Cross-origin request handling
9. **requestLogger** — Structured request logging
10. **metricsMiddleware** — Request metrics collection
11. **requestTimeout** — Request timeout enforcement
12. **globalLimiter** — Rate limiting (100 req/min)
13. **role-specific limiters** — Stricter limits on auth/payments

### Service Layer

Business logic is abstracted into services:

| Service | Responsibility |
|---------|----------------|
| `authService.js` | Authentication & token management |
| `tenantService.js` | Multi-tenant data isolation |
| `paymentGatewayService.js` | Payment provider abstraction |
| `invoiceService.js` | Invoice generation & management |
| `subscriptionEnforcement.js` | Feature gating by tier |
| `entitlements.js` | Module access control |
| `schedulerService.js` | Cron job scheduling |
| `jobService.js` | Background job queue |
| `realtimeHub.js` | WebSocket event broadcasting |
| `fcmService.js` | Push notification handling |
| `kdsService.js` | Kitchen Display System logic |
| `smsService.js` | SMS notification sending |
| `emailTemplates.js` | Email composition |
| `reportAggregationService.js` | Report data aggregation |
| `reportXlsxExportService.js` | Excel export generation |
| `pdfService.js` | PDF generation |
| `menuEvaluationService.js` | Menu pricing & costing |
| `integrationService.js` | Third-party integrations |
| `telebirrStandingOrderService.js` | Telebirr recurring payments |
| `provisionService.js` | Tenant provisioning |
| `cronService.js` | Scheduled task runner |

---

## 7. Database Schema

### Core Tables

#### tenants
```sql
CREATE TABLE tenants (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  status ENUM('trial', 'active', 'suspended') DEFAULT 'trial',
  trial_ends_at DATETIME NULL,
  plan VARCHAR(32) DEFAULT 'trial',
  plan_ends_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);
```

#### branches
```sql
CREATE TABLE branches (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) DEFAULT 'Open',
  city VARCHAR(128) NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL
);
```

#### staff
```sql
CREATE TABLE staff (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NULL INDEX,
  role_id VARCHAR(64) NULL INDEX,
  role_name VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NULL,
  code VARCHAR(64) NULL,
  password_hash VARCHAR(255) NOT NULL,
  pin_hash VARCHAR(255) NULL,
  status ENUM('Active', 'On Leave', 'Suspended') DEFAULT 'Active',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY (tenant_id, email)
);
```

#### roles
```sql
CREATE TABLE roles (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  name VARCHAR(64) NOT NULL,
  scope ENUM('global', 'branch') DEFAULT 'branch',
  permissions LONGTEXT NULL,
  created_at DATETIME NOT NULL
);
```

#### orders
```sql
CREATE TABLE orders (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NOT NULL INDEX,
  status VARCHAR(32) NOT NULL,
  total DECIMAL(12,2) DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  tip DECIMAL(12,2) DEFAULT 0,
  discount DECIMAL(12,2) DEFAULT 0,
  created_at DATETIME NOT NULL INDEX,
  paid_at DATETIME NULL INDEX,
  payload LONGTEXT NULL  -- JSON order details
);
```

#### events (Event Sourcing)
```sql
CREATE TABLE events (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NULL INDEX,
  type VARCHAR(64) NOT NULL INDEX,
  payload LONGTEXT NULL,
  at DATETIME NOT NULL INDEX
);
```

#### shift_logs
```sql
CREATE TABLE shift_logs (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NOT NULL INDEX,
  staff_id VARCHAR(64) NOT NULL INDEX,
  clock_in_at DATETIME NOT NULL INDEX,
  clock_out_at DATETIME NULL INDEX
);
```

#### schedules_by_week
```sql
CREATE TABLE schedules_by_week (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NOT NULL INDEX,
  week_start VARCHAR(10) NOT NULL INDEX,
  rows LONGTEXT NULL,  -- JSON schedule data
  updated_at DATETIME NOT NULL,
  UNIQUE KEY (tenant_id, branch_id, week_start)
);
```

#### pos_state (Offline Sync)
```sql
CREATE TABLE pos_state (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  branch_id VARCHAR(64) NOT NULL INDEX,
  state_json LONGTEXT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY (tenant_id, branch_id)
);
```

#### refresh_tokens
```sql
CREATE TABLE refresh_tokens (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL INDEX,
  staff_id VARCHAR(64) NOT NULL INDEX,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL
);
```

### Migration Strategy

- **Framework:** Knex.js migrations
- **Count:** 50+ migrations
- **Pattern:** Timestamped incremental changes
- **Rollback:** Supported via `exports.down`

**Key Migrations:**
| File | Purpose |
|------|---------|
| `001_init.js` | Core tables (tenants, branches, staff, roles, orders, events) |
| `002_owner_tables.js` | Owner-specific tables |
| `003_platform_settings.js` | Global platform settings |
| `004_tenant_profile.js` | Extended tenant data |
| `005_support_tickets.js` | Support system |
| `006_manager_settings.js` | Branch manager settings |
| `007_billing_tables.js` | Subscription billing |
| `008_owner_invites.js` | Owner invitation system |
| `009_menu_inventory.js` | Menu & inventory enhancements |
| `010_audit_sync.js` | Audit logging & sync |
| `011_superadmin_tables.js` | Super admin features |
| `012_finance.js` | Financial reporting tables |
| `013_branch_events.js` | Branch-level events |
| `014_superadmins.js` | Super admin accounts |
| `015_tenant_entitlements.js` | Feature entitlements |
| `016_sync_cursor.js` | Sync tracking |
| `017_demo_requests.js` | Demo request handling |
| `018_schema_fixups.js` | Schema corrections |
| `019_tenant_entitlements_snapshot.js` | Entitlement snapshots |
| `020_fix_plan_modules.js` | Plan module corrections |

---

## 8. Authentication & Security

### JWT Authentication Flow

```
┌──────────┐     POST /api/auth/login     ┌─────────┐
│  Client  │ ─────────────────────────────> │  API    │
│          │    {email, password, tenant}   │         │
│          │ <───────────────────────────── │         │
│          │     {token, refreshToken,      │         │
│          │      role, permissions}          │         │
└──────────┘                               └─────────┘
       │
       │  All subsequent requests:
       │  Authorization: Bearer {token}
       ▼
```

### Token Structure

```typescript
// JWT Payload
{
  userId: string,
  role: UserRole,
  tenantId: string,
  branchId: string | 'global',
  permissions: string[],
  iat: number,  // Issued at
  exp: number   // Expires at
}
```

### Security Measures

| Layer | Implementation |
|-------|----------------|
| **Password Hashing** | bcrypt (configurable rounds) |
| **PIN Hashing** | bcrypt (for quick login) |
| **JWT Secret** | Environment variable, no fallback |
| **Token Expiry** | Access: 15 min, Refresh: 7 days |
| **CORS** | Whitelist-based origin validation |
| **Rate Limiting** | 100 req/min global, stricter on auth |
| **Request Timeout** | Configurable (default 30s) |
| **Input Validation** | Zod on critical paths (needs expansion) |

### Rate Limiting Tiers

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/login` | 5 | 1 minute |
| `/api/public/signup` | 3 | 1 minute |
| `/api/public/pos-links/*/initiate-chapa` | 10 | 1 minute |
| `/api/public/pos-links/*/verify-chapa` | 10 | 1 minute |
| `/api/admin/*` | 20 | 1 minute |
| `/api/superadmin/*` | 20 | 1 minute |
| Global API | 100 | 1 minute |

### Security Headers (Helmet)

```javascript
{
  contentSecurityPolicy: false,           // Disabled for API
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'deny' },        // No iframes
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  hsts: {
    maxAge: 31536000,                     // 1 year
    includeSubDomains: true,
    preload: true
  }
}
```

### Cache Control

All authenticated API responses include:
```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
Expires: 0
Vary: Origin, Authorization, X-Tenant
```

### File Upload Security

- **Size Limit:** Configurable (default 10MB)
- **Path:** `/uploads/` served statically
- **Validation:** MIME type checking
- **Storage:** Local filesystem (API server)

### MFA / 2FA

**Current Status:** Not implemented for Super Admin
**Recommendation:** Add TOTP for Super Admin operations

---

## 9. Payments & Subscriptions

### Payment Gateways

| Gateway | Type | Status | Flow |
|---------|------|--------|------|
| **Cash** | Offline | ✅ Live | Immediate, no processing |
| **Telebirr** | Mobile Money | ✅ Live | USSD + callback webhook |
| **Chapa** | Payment Gateway | ✅ Live | Redirect + callback |
| **CBE Birr** | Mobile Banking | 📝 TODO | Stub exists |
| **Bank Transfer** | Manual | ✅ Live | Upload proof + admin verify |
| **Loyalty Points** | Internal | ✅ Live | Deduct from customer balance |

### Telebirr Integration

```
1. Waiter selects "Telebirr" payment
2. API generates payment request
3. Customer receives USSD prompt on phone
4. Customer confirms payment via USSD
5. Telebirr sends webhook callback
6. Order marked as paid
```

### Chapa Integration

```
1. Waiter selects "Chapa" payment
2. API creates checkout session
3. Customer redirected to Chapa page
4. Customer completes payment
5. Redirect back + webhook callback
6. Order marked as paid
```

### Webhook Handling

```javascript
// /api/webhooks/*
- Signature verification using raw body
- Idempotency key support
- Event types: payment.success, payment.failed
- Automatic retry on failure
```

### Subscription Tiers

| Tier | Price (ETB) | Modules Included |
|------|-------------|------------------|
| **Trial** | Free | settings only (14 days) |
| **Basic** | 2,500/mo | pos, orders, tables, inventory, menu, staff, reports, finance, branches |
| **Pro** | 5,000/mo | Basic + guests, owner_dashboard, advanced reports |
| **Enterprise** | Custom | Pro + priority support, custom integrations |

### Module Access Control

```typescript
const defaultModulesForTier = (tier: string): string[] => {
  switch(tier) {
    case 'trial': return ['settings'];
    case 'basic': return ['pos', 'orders', 'tables', 'inventory', 'menu', 
                          'staff', 'reports', 'finance', 'branches', 'settings'];
    case 'pro': return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu',
                        'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
    case 'enterprise': return [...pro, 'enterprise_support'];
  }
};
```

### Billing Cycle

- **Currency:** ETB (Ethiopian Birr)
- **Periods:** Monthly, Yearly (discount available)
- **Payment Methods:** Telebirr, Chapa, Bank Transfer
- **Grace Period:** 3 days after due date
- **Downgrade:** Automatic to "Basic" if payment fails

### Tip Flow

1. Waiter enters tip amount during payment
2. Tip recorded in order payload
3. Reported in shift reports
4. Optional: Tip pooling calculation

### Offline Payment Handling

- Orders can be created while offline
- Payment method recorded locally
- Synced to cloud when connection restored
- Webhook replay for missed callbacks

---

## 10. Offline-First / Sync Logic

### Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Desktop   │  <---->  │  Local DB   │  <----> │   Cloud     │
│   (Electron)│  (always) │  (SQLite)   │  (when    │   (MySQL)   │
│             │         │             │  online)  │             │
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │                       │
       │                ┌────────┴────────┐           │
       │                │   Event Queue   │           │
       │                │   (IndexedDB)   │           │
       │                └─────────────────┘           │
```

### Local Database (SQLite)

- **Library:** better-sqlite3
- **Location:** User data directory (Electron)
- **Schema:** Mirrors cloud schema (subset)
- **Encryption:** Not currently implemented (recommendation: SQLCipher)

### Event Sourcing

All changes recorded as events:

```typescript
interface Event {
  id: string;           // UUID
  tenantId: string;
  branchId: string;
  type: string;         // e.g., 'order.created', 'payment.received'
  payload: object;      // Event data
  at: Date;           // Timestamp
}
```

**Event Types:**
| Type | Description |
|------|-------------|
| `order.created` | New order placed |
| `order.updated` | Order modified |
| `order.voided` | Order voided |
| `payment.received` | Payment recorded |
| `inventory.adjusted` | Stock level changed |
| `staff.clock_in` | Shift started |
| `staff.clock_out` | Shift ended |

### Sync Strategy

1. **Cursor-based:** Each client tracks last sync position
2. **Incremental:** Only fetch events since last sync
3. **Conflict Resolution:** Server wins (last write wins)
4. **Retry Logic:** Exponential backoff on failure

### Sync API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/sync/events` | Fetch events since cursor |
| `POST /api/sync/events` | Push local events to cloud |
| `GET /api/sync/state` | Fetch current POS state |
| `POST /api/sync/state` | Update cloud POS state |

### POS State Table

Stores complete POS state for offline operation:

```typescript
interface PosState {
  tenantId: string;
  branchId: string;
  stateJson: {
    tables: Table[];
    activeOrders: Order[];
    menu: Menu[];
    inventory: InventoryItem[];
    lastSyncAt: Date;
  };
  updatedAt: Date;
}
```

### Conflict Scenarios

| Scenario | Resolution |
|----------|------------|
| Same order edited offline on 2 devices | Last sync wins |
| Payment processed offline, webhook arrives online | Merge payment data |
| Stock reduced offline, sale happens online | Allow negative stock, alert manager |

---

## 11. Feature Flags & Modules

### Feature Flag System

Features can be enabled via:

1. **Subscription tier** (entitlements)
2. **URL parameter** (`?feature=name`)
3. **localStorage** flag
4. **Super Admin dashboard** (feature flags table)

### Current Feature Flags

| Flag | Type | Description |
|------|------|-------------|
| `pos_ui_v2` | URL/localStorage | New POS interface |
| `kds_expo` | Subscription | Expo board feature |
| `service_inline_security_v1` | URL/localStorage | Inline security panel |
| `service_inline_system_v1` | URL/localStorage | Inline system status |
| `service_inline_notifications_v1` | URL/localStorage | Inline notifications |
| `service_inline_expo_v1` | URL/localStorage | Inline expo view |
| `service_inline_kitchen_v1` | URL/localStorage | Inline kitchen view |
| `service_inline_active_v1` | URL/localStorage | Inline active orders |
| `service_inline_review_v1` | URL/localStorage | Inline order review |
| `service_workspace_v1` | URL/localStorage | Unified workspace UI |

### Module System

Modules are gated by subscription tier:

```typescript
const screenRequiredModule = (screen: Screen): string | null => {
  switch(screen) {
    case Screen.WAITER_DASHBOARD:
    case Screen.WAITER_MENU:
      return 'pos';
    case Screen.MANAGER_INVENTORY:
      return 'inventory';
    case Screen.OWNER_DASHBOARD:
      return 'owner_dashboard';
    case Screen.GUESTS:
      return 'guests';
    // ... etc
  }
};
```

### Trial Mode Restrictions

- Module: `settings` only
- Duration: 14 days
- `trial_ends_at` column tracks expiry
- Post-trial: Must subscribe or downgrade to "Basic"

---

## 12. Desktop App (Electron)

### Architecture

```
┌─────────────────┐
│   Renderer      │  React + Vite app
│   (BrowserView) │
└────────┬────────┘
         │ IPC
┌────────▼────────┐
│    Preload      │  Context bridge
│    (preload.mjs)│
└────────┬────────┘
         │ IPC
┌────────▼────────┐
│     Main        │  Node.js runtime
│    (main.mjs)   │  - SQLite access
│                 │  - Printer access
│                 │  - Auto-updater
└─────────────────┘
```

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `sqlite:query` | Renderer → Main | Execute SQL queries |
| `sqlite:exec` | Renderer → Main | Execute SQL commands |
| `printer:print` | Renderer → Main | Send to thermal printer |
| `printer:list` | Renderer → Main | List available printers |
| `updater:check` | Renderer → Main | Check for updates |
| `updater:install` | Renderer → Main | Install update & restart |
| `updater:state` | Main → Renderer | Update status events |
| `app:restart` | Renderer → Main | Restart application |

### Auto-Updater

- **Provider:** GitHub Releases
- **Repository:** `firaghost/mirachpos-releases`
- **Flow:**
  1. App checks GitHub on startup
  2. If update available, downloads in background
  3. Badge appears: "Update ready"
  4. User clicks "Restart" to install
- **Configuration:** `build.publish` in package.json

### Local Database (SQLite)

```javascript
// electron/sqlite.mjs
const Database = require('better-sqlite3');
const db = new Database(userDataPath + '/mirachpos.db');

// IPC handlers
ipcMain.handle('sqlite:query', (event, sql, params) => {
  return db.prepare(sql).all(...params);
});

ipcMain.handle('sqlite:exec', (event, sql, params) => {
  return db.prepare(sql).run(...params);
});
```

### Receipt Printing

**Supported Printers:**
- Network thermal printers (ESC/POS)
- Bluetooth printers (via OS)
- PDF generation for email

**Print Flow:**
1. Generate receipt HTML/ESC-POS commands
2. Send to `printer:print` IPC channel
3. Main process sends to printer driver
4. Returns success/failure

---

## 13. Reporting & Analytics

### Report Categories

| Category | Reports | Export |
|----------|---------|--------|
| **Sales** | Daily sales, Hourly breakdown, Top products, Category performance | Excel, PDF |
| **Inventory** | Stock levels, Low stock alerts, Usage reports, Waste reports | Excel, PDF |
| **Staff** | Shift summaries, Hours worked, Performance metrics, Tips | Excel, PDF |
| **Financial** | Revenue, Expenses, Taxes, Profit margins | Excel, PDF |
| **Customers** | Top customers, Loyalty activity, Visit frequency | Excel, PDF |

### Dashboard Widgets

- Real-time sales chart (today vs yesterday)
- Active orders counter
- Top selling items
- Staff on duty
- Inventory alerts
- Payment method breakdown

### Custom Report Builder

Users can create custom reports:
- Select data source (orders, inventory, staff)
- Apply filters (date range, branch, category)
- Choose aggregations (sum, count, average)
- Group by dimensions (hour, day, category, staff)
- Export to Excel

### Export Formats

**Excel (.xlsx):**
- Library: `exceljs`
- Features: Formulas, formatting, multiple sheets
- Use case: Data analysis, accounting imports

**PDF:**
- Library: `jspdf` + `jspdf-autotable`
- Features: Tables, headers, footers, page numbers
- Use case: Printing, email attachments

---

## 14. KDS / POS-Specific Workflows

### Kitchen Display System (KDS)

**Components:**
1. **Kitchen Board** — Orders being prepared
2. **Expo Board** — Orders ready to serve
3. **Active Orders** — All in-flight orders

**Order Lifecycle:**
```
Pending → Cooking → Ready → Served → Paid
         (Kitchen)   (Expo)
```

**Features:**
- Color-coded status (red → yellow → green)
- Cooking timers (configurable per item)
- Bump button (mark as ready)
- Recall button (move back to cooking)
- Order notes/allergies display
- Sound notifications

### Shift Management

**Shift Flow:**
1. Staff logs in
2. Clock in (if not already clocked in)
3. Work (take orders, process payments)
4. Clock out at end of shift
5. Shift report generated

**Shift Report Includes:**
- Total orders taken
- Total sales
- Payment breakdown (cash, mobile, card)
- Tips received
- Voids/voided orders

### Notifications

**Types:**
| Type | Trigger | Display |
|------|---------|---------|
| Order ready | Kitchen marks ready | Toast + sound |
| Low stock | Inventory below threshold | Badge + toast |
| Payment received | Webhook callback | Toast |
| Shift ending | 15 min before shift end | Toast |
| System alert | Sync failure, etc | Toast + system |

### Timers

- **Order timers:** Track time since order placed
- **Cooking timers:** Per-item cooking estimates
- **Table timers:** How long table occupied
- **Shift timers:** Hours worked this shift

---

## 15. Development Workflow

### Prerequisites

- Node.js 20.x or 22.x
- npm 10.x
- MySQL 8.x (for API development)
- Git

### Installation

```bash
# Clone repository
git clone https://github.com/firaghost/mirachpos.git
cd mirachpos

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local
# Edit .env.local with your values
```

### Development Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server (web only) |
| `npm run dev:api` | Start API server only |
| `npm run dev:desktop` | Start API + Vite + Electron |
| `npm run dev:desktop:noapi` | Start Vite + Electron (no API) |
| `npm run build` | Build for web production |
| `npm run build:desktop` | Build for desktop production |
| `npm run dist:desktop` | Create desktop installer |
| `npm run dist:win` | Create Windows NSIS installer |
| `npm run start:desktop` | Run built desktop app |
| `npm run preview` | Preview production build |

### Testing

| Command | Purpose |
|---------|---------|
| `npm run test:ui` | Run Vitest in watch mode |
| `npm run test:ui:coverage` | Run tests with coverage report |

### Code Quality

| Command | Purpose |
|---------|---------|
| `npm run lint` | Run ESLint on all files |
| `npm run lint:fix` | Fix auto-fixable ESLint issues |
| `npm run lint:api` | Lint API code specifically |
| `npm run analyze` | Analyze web bundle size |
| `npm run analyze:desktop` | Analyze desktop bundle size |

### Docker

| Command | Purpose |
|---------|---------|
| `npm run docker:up` | Start Docker containers |
| `npm run docker:down` | Stop Docker containers |
| `npm run docker:logs` | View API logs |
| `npm run docker:build` | Build Docker images |
| `npm run docker:clean` | Clean Docker volumes |

### Git Workflow

1. **Branch naming:** `feature/description`, `fix/description`
2. **Commits:** Conventional commits preferred
3. **Pull requests:** Required for main branch
4. **Versioning:** Semantic versioning in package.json

---

## 16. Known Issues / TODOs

### Security Gaps

| Issue | Severity | Status |
|-------|----------|--------|
| Super Admin MFA | Medium | Not implemented |
| File upload size validation | Medium | Needs verification |
| SQL injection on some routes | Low | Partial Zod coverage |
| JWT secret rotation | Low | Not implemented |

### Feature Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| CBE Birr integration | TODO | Stub exists |
| Flutter mobile app | Planned | Spec exists |
| Loyalty program | Partial | Basic points system |
| Customer facing display | Planned | Spec exists |
| Multi-language (Amharic) | Planned | i18n setup needed |
| AI features (Gemini) | Configured | Not actively used |

### Performance TODOs

| Item | Priority |
|------|----------|
| Redis caching layer | High |
| Database query optimization | High |
| Database indexes audit | Medium |
| Node.js clustering | Medium |
| Read replicas | Low |
| CDN for static assets | Low |

### Technical Debt

| Item | Impact |
|------|--------|
| Inconsistent error handling | Medium |
| Missing API documentation (OpenAPI) | Medium |
| Test coverage gaps | Medium |
| TypeScript strict mode violations | Low |

---

## 17. Country-Specific / Market Features

### Ethiopia-Specific Implementation

#### Currency
- **Code:** ETB (Ethiopian Birr)
- **Symbol:** Br
- **Formatting:** `1,234.56 Br` (Western numerals)
- **No decimal coins** in practice (prices often whole numbers)

#### Tax (ERCA Compliance)
- **Rate:** Configurable (typically 15% VAT)
- **Reporting:** ERCA-compliant reports available
- **Invoice format:** Meets Ethiopian standards
- **Fiscal printer:** Support planned

#### Payment Methods

**Telebirr (Ethiopian Telecom):**
- USSD-based payment flow
- Dominant mobile money in Ethiopia
- ~70% of mobile payments

**Chapa:**
- Ethiopian payment gateway
- Cards, bank transfer, Telebirr
- Growing market share

**CBE Birr (Commercial Bank of Ethiopia):**
- Mobile banking app
- Integration planned

#### Localization

| Aspect | Status | Notes |
|--------|--------|-------|
| English | ✅ Complete | Primary language |
| Amharic | 📝 Planned | UI translation needed |
| Oromiffa | 📝 Planned | UI translation needed |
| Date format | ✅ DD/MM/YYYY | Ethiopian calendar support planned |
| Time zone | ✅ Africa/Addis_Ababa | UTC+3 |

#### Regulatory

- **Data residency:** Ethiopia (future consideration)
- **Tax reporting:** ERCA-compliant exports
- **Receipts:** Customer copy + merchant copy
- **Refunds:** Full and partial supported

---

## Appendix A: Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | MySQL database |
| `JWT_SECRET` | JWT signing secret |
| `TENANT_GATEWAY_SECRETS_KEY` | Encryption key for gateway secrets |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PORT` | 3306 | MySQL port |
| `PORT` | 3000 | API server port |
| `NODE_ENV` | development | Environment |
| `GEMINI_API_KEY` | - | Google Gemini AI key |
| `CORS_ORIGINS` | - | Comma-separated allowed origins |
| `METRICS_KEY` | - | Key for /metrics endpoint |
| `BACKGROUND_DISABLED` | false | Disable background jobs |
| `CLUSTER_MODE` | false | Enable Node.js clustering |
| `CLUSTER_WORKERS` | CPU count | Number of cluster workers |
| `REQUEST_TIMEOUT_MS` | 30000 | Request timeout |
| `SWAGGER_ENABLED` | true (dev) | Enable Swagger docs |

---

## Appendix B: File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Components | PascalCase.tsx | `Sidebar.tsx` |
| Screens | PascalCase.tsx | `WaiterDashboard.tsx` |
| Hooks | camelCase.ts | `usePosIdleTimeout.ts` |
| Utilities | camelCase.ts | `api.ts` |
| Types | PascalCase in types.ts | `UserRole`, `Screen` |
| Routes | camelCase.js | `managerFinance.js` |
| Services | camelCase.js | `paymentGatewayService.js` |
| Tests | *.test.ts | `Modal.test.tsx` |

---

## Appendix C: Quick Reference

### Start Development
```bash
npm install
npm run dev:desktop  # Full stack with Electron
```

### Database Migration
```bash
cd api
npx knex migrate:latest
npx knex migrate:rollback
```

### Build for Production
```bash
npm run dist:win  # Windows installer
```

### Check Logs
```bash
npm run docker:logs  # If using Docker
# Or check logs/ directory
```

---

**End of Handbook**

*For updates, refer to the MIRACHPOS_ANALYSIS.md in the repository root.*
