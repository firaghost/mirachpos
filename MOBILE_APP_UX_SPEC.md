# MirachPOS Mobile (Flutter) — UX / Page Map Spec

## Goal
Build a Flutter mobile application (iOS + Android) for restaurant operations.

- Waiter must continue working when internet is down (offline-first).
- Manager/Owner use mobile too (role-based access).
- Orders/tables are **owned by a single device** (no concurrent editing from multiple devices).
- Payments:
  - **Offline cash** supported (record payment locally, sync later)
  - All other payment methods require internet and use existing Node/Express API.
- Printers:
  - Branch/tenant-configured printer settings
  - Support both **Bluetooth** and **Network** printers (per branch settings, per device pairing as needed)

## Non-Goals (v1)
- Offline card processing (requires specialized terminals + offline authorization rules).
- Multi-device collaborative editing of the same order while offline.

---

## Personas / Roles
This mobile app supports the following roles (mapped to existing RBAC):

- **Waiter**: create/update orders, send to kitchen, take cash payments, print receipts, view assigned tables.
- **Branch Manager**: manage staff shifts, void/refund (online-only where needed), configure printers, review branch reports.
- **Cafe Owner**: manage branches, menu high-level, reports and oversight.
- **Super Admin** (optional in mobile): tenant support/diagnostics (keep minimal on mobile).

### Role Gating Rules (UI)
- The UI must hide/disable screens and actions not allowed by permissions.
- The server remains the source of truth when online.
- Offline mode uses cached role/permissions from the last successful login.

---

## Navigation Model (High Level)
Use an adaptive navigation strategy:

- **Phone**: Bottom tabs (max 4) + stack navigation.
- **Tablet**: Navigation rail (left) + detail pane (master-detail) where applicable.

### Primary Navigation Groups
- **Operations** (Waiter-focused)
- **Payments**
- **Reports** (role-gated)
- **Settings**

---

## App Lifecycle: Splash → End

### 0) Splash
- **Screen**: `SplashScreen`
- **Purpose**: app boot, local DB init, load cached session, check sync state.
- **States**:
  - Loading
  - DB migration required
  - Session found → route to Home
  - No session → route to Login

### 1) Onboarding / Environment Setup (First Run)
- **Screen**: `EnvironmentSetupScreen`
- **Shown when**: app has no tenant/branch context configured or no valid session.
- **Actions**:
  - Enter API base URL (or choose from known deployments)
  - Optional QR scan for branch config (future)
  - Continue

### 2) Authentication
#### 2.1) Login Method Select
- **Screen**: `LoginMethodScreen`
- Options:
  - PIN login (waiter)
  - Email + password (manager/owner)

#### 2.2) PIN Login
- **Screen**: `PinLoginScreen`
- **Primary CTA**: Login
- **Offline behavior**:
  - If previously logged-in user exists for this device and PIN matches cached credential: allow offline login.
  - Otherwise require online.

#### 2.3) Email + Password Login
- **Screen**: `CredentialsLoginScreen`
- **Online required**.

#### 2.4) Branch Select (if user has multiple branches)
- **Screen**: `BranchSelectScreen`
- **Offline behavior**:
  - If branches are cached, allow selection; otherwise online required.

---

## Home Routing (Role-Based)
After login, route to the appropriate home shell:

- Waiter → `WaiterHomeShell`
- Branch Manager → `ManagerHomeShell`
- Cafe Owner → `OwnerHomeShell`
- Super Admin → `AdminHomeShell` (optional)

Each shell is an adaptive scaffold (tabs on phone / rail on tablet).

---

# Waiter Experience (Offline-First)

## Waiter Tab Map (Phone)
- Tab 1: **Tables**
- Tab 2: **Orders**
- Tab 3: **Payments**
- Tab 4: **More** (Settings, Sync, Profile)

## Waiter Screens

### W1) Tables (Assigned)
- **Screen**: `TablesScreen`
- **Data**: assigned tables for waiter; cached locally.
- **UI**:
  - Table cards with status: Empty / Has open order / Waiting for payment / Sent to kitchen
  - Search/filter (zone/area)
- **Primary actions**:
  - Tap table → open table details/order
  - New order
- **Offline**: fully functional

### W2) Table Detail
- **Screen**: `TableDetailScreen`
- Shows:
  - Table meta
  - Current open order summary (if any)
  - Quick actions: Add items, Send to kitchen, Request bill, Take cash payment

### W3) Menu Browse
- **Screen**: `MenuBrowseScreen`
- **UI**:
  - Category chips
  - Item list (image optional), availability/stock hints
  - Search
- **Action**:
  - Tap item → add to cart (order draft)
- **Offline**:
  - Uses cached menu + last known availability

### W4) Order Builder / Cart
- **Screen**: `OrderBuilderScreen`
- Sections:
  - Selected items list (qty stepper)
  - Notes per item
  - Order-level notes
  - Customer (optional)
- **Actions**:
  - Save draft
  - Submit / Send to kitchen
- **Offline**: yes

### W5) Order Detail
- **Screen**: `OrderDetailScreen`
- Displays:
  - Items, totals, discounts (limited)
  - Status timeline: Draft → Sent → Served → Closed
- **Actions**:
  - Add/remove items (if unpaid)
  - Void unpaid order (role-gated)
  - Print pre-receipt / kitchen ticket
  - Proceed to payment
- **Offline**:
  - Can modify unpaid orders

### W6) Send to Kitchen
- **Flow**: action from order builder/detail
- **Offline behavior**:
  - Queue a `SEND_TO_KITCHEN` event.
  - UI shows “Queued” badge until synced.
  - If kitchen relies on server/KDS, actual kitchen dispatch happens when internet returns.

### W7) Payment
- **Screen**: `PaymentScreen`
- Payment methods:
  - Cash (offline supported)
  - Card / Wallet / Online methods (internet required)
- **Cash payment**:
  - Enter amount received
  - Auto-calc change
  - Confirm
  - Generates local receipt number and marks order paid locally
  - Queues payment sync
- **Online payment**:
  - Block with “Internet required” UI if offline

### W8) Receipt / Printing
- **Screen**: `ReceiptPreviewScreen`
- **Actions**:
  - Print receipt
  - Share PDF (optional)
- **Printer selection**:
  - Default printer comes from branch configuration
  - Device-level pairing for Bluetooth if needed
- **Offline**:
  - Printing should work offline if printer is reachable (BT/LAN)

### W9) Orders List
- **Screen**: `OrdersScreen`
- Filters:
  - Open / Closed
  - Today / custom
- **Offline**:
  - Shows local orders; closed orders synced later.

### W10) Offline/Sync Center
- **Screen**: `SyncCenterScreen`
- Shows:
  - Online/offline indicator
  - Queue length
  - Last sync time
  - Conflicts needing resolution
- Actions:
  - Sync now
  - Export debug bundle (role-gated)

### W11) Profile / Shift
- **Screen**: `WaiterProfileScreen`
- Optional:
  - Start shift / End shift
  - Daily summary

---

# Branch Manager Experience

## Manager Tab Map (Phone)
- Tab 1: **Dashboard**
- Tab 2: **Operations** (Tables/Orders)
- Tab 3: **Staff**
- Tab 4: **Settings**

## Manager Screens

### M1) Branch Dashboard
- **Screen**: `BranchDashboardScreen`
- KPIs:
  - Sales today
  - Open orders
  - Top items
  - Cash totals (when available)
- **Offline**:
  - Shows cached KPIs + local aggregates

### M2) Orders Oversight
- **Screen**: `ManagerOrdersScreen`
- Actions:
  - View any order in branch
  - Void unpaid (as permitted)
  - Refund (online-only)

### M3) Table Ownership / Device Ownership
- **Screen**: `TableOwnershipScreen`
- Purpose:
  - See which device owns which table/order
  - Transfer ownership (online preferred; offline allowed only if same device)

### M4) Staff Management
- **Screen**: `StaffListScreen`
- **Online required** for most edits.
- Offline: view cached list

### M5) Shift Management
- **Screen**: `ShiftManagementScreen`
- Clock-in/out oversight
- End-of-day reconciliation (online preferred)

### M6) Printer Configuration (Branch)
- **Screen**: `PrinterSettingsScreen`
- Config:
  - Receipt printer: Bluetooth / Network
  - Kitchen printer (optional): Bluetooth / Network
  - IP/port (LAN)
  - Bluetooth pairing wizard
- Offline:
  - Config changes stored locally and synced later

### M7) Reports (Branch)
- **Screen**: `BranchReportsScreen`
- Reports:
  - Daily sales
  - Hourly sales
  - Staff performance
  - Inventory snapshot (view)
- Offline:
  - Show cached reports; exporting requires internet (optional)

---

# Cafe Owner Experience

## Owner Tab Map (Phone)
- Tab 1: **Overview**
- Tab 2: **Branches**
- Tab 3: **Menu**
- Tab 4: **Settings**

## Owner Screens

### O1) Cafe Overview
- **Screen**: `CafeOverviewScreen`
- KPIs:
  - Sales by branch
  - Trends
  - Subscription status (optional)
- Offline:
  - Cached view only

### O2) Branches
- **Screen**: `BranchesScreen`
- Actions:
  - View branches
  - Create/update branch (online)

### O3) Menu Management
- **Screen**: `MenuManagementScreen`
- Actions:
  - Categories
  - Items
  - Publish
- Offline:
  - View cached; edits require internet

### O4) Audit / Activity (Optional)
- **Screen**: `AuditLogScreen`
- Online required

---

# Super Admin (Optional Mobile Scope)
Keep minimal:

- `TenantSearchScreen`
- `TenantHealthScreen`
- `FeatureFlagsScreen` (read-only)

---

## Global Settings (All Roles)

### S1) Settings
- **Screen**: `SettingsScreen`
- Sections:
  - Account
  - Branch
  - Printers
  - Offline & Sync
  - Security
  - About

### S2) Offline & Sync
- **Screen**: `OfflineSettingsScreen`
- Controls:
  - Sync on Wi-Fi only
  - Background sync interval (if allowed)
  - Max queue retries

### S3) About
- **Screen**: `AboutScreen`
- App version, build, device id

### S4) Logout
- **Flow**: logout confirmation
- Behavior:
  - Option: keep offline cached data or wipe local DB (manager/owner choice)

---

## Cross-Cutting UX Requirements

### Offline UX
- Persistent indicator: Online / Offline
- When offline:
  - Continue core waiter flows
  - Disable online-only actions with clear reason and “Try again”
  - Queue all writes that need server

### Errors
- Every async action has:
  - Loading state
  - Error state
  - Retry

### Tablet UX
- Use master-detail where it improves speed:
  - Tables list (left) + order detail (right)
  - Orders list (left) + order detail (right)

### Accessibility
- Touch targets >= 44–48
- High contrast for critical states
- Large text support

---

## Screen Inventory Checklist (Quick Index)

### App
- Splash
- Environment Setup
- Login Method
- PIN Login
- Credentials Login
- Branch Select

### Waiter
- Tables
- Table Detail
- Menu Browse
- Order Builder
- Order Detail
- Payment
- Receipt Preview
- Orders List
- Sync Center
- Profile/Shift

### Manager
- Branch Dashboard
- Orders Oversight
- Table Ownership
- Staff List
- Shift Management
- Printer Settings
- Branch Reports

### Owner
- Cafe Overview
- Branches
- Menu Management
- Audit Log (optional)

### Global
- Settings
- Offline Settings
- About
- Logout

---

## Implementation Notes (for later build)
- Place Flutter project in `./mobile/`.
- Use local DB + sync queue.
- Use existing Node/Express API for online features.

