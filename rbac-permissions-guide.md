# 🔐 POS SYSTEM - ROLE PERMISSIONS QUICK REFERENCE GUIDE

## Complete Permission Matrix by Role

This document serves as a quick reference for what each role can and cannot do.

---

## ROLE 1: SUPER ADMIN / PLATFORM OWNER

**Access Level:** Platform-wide (all cafes)  
**Login Method:** Email + Password + 2FA  
**Use Cases:** System administration, platform monitoring, customer support escalations

### What They Can Do
- ✅ View all cafes and their data
- ✅ Create, update, delete cafes
- ✅ Manage all users across all cafes
- ✅ Reset any user's password
- ✅ View billing and revenue
- ✅ Manage subscription tiers and pricing
- ✅ Upgrade/downgrade/cancel any subscription
- ✅ View comprehensive platform analytics
- ✅ Manage system integrations
- ✅ Configure system settings
- ✅ View complete audit logs
- ✅ Handle platform emergency issues
- ✅ Issue refunds for transaction disputes
- ✅ Trigger system backups

### What They CANNOT Do
- ❌ They can do everything on the platform

### Permissions List
```
cafes.read.all
cafes.create
cafes.update
cafes.delete
users.read.all
users.create
users.update
users.delete
users.reset_password
subscriptions.manage
subscriptions.upgrade
subscriptions.downgrade
subscriptions.cancel
billing.view.all
billing.invoices.download
billing.payments.refund
financial.reports.export
system.config.manage
system.feature_flags.manage
system.integrations.manage
system.backups.trigger
system.audit_logs.view
analytics.platform.view
analytics.export
```

---

## ROLE 2: CAFE OWNER / GLOBAL MANAGER

**Access Level:** Single cafe (can have multiple branches)  
**Login Method:** Email + Password (optional 2FA)  
**Use Cases:** Business owner managing entire cafe operation across all branches

### What They Can Do
- ✅ View own cafe's data and settings
- ✅ Update own cafe's information
- ✅ Create and manage branches
- ✅ Hire and fire staff
- ✅ Assign roles to staff (Manager, Waiter)
- ✅ Create global menu (applies to all branches)
- ✅ Manage menu items and categories
- ✅ View inventory across all branches
- ✅ Manage suppliers and ordering
- ✅ View consolidated sales across all branches
- ✅ Generate financial reports
- ✅ View all staff performance metrics
- ✅ Manage customer loyalty program
- ✅ View and manage gift cards
- ✅ Process refunds
- ✅ Upgrade/downgrade subscription tier
- ✅ Manage billing and payment methods
- ✅ Download invoices
- ✅ View audit logs for own cafe
- ✅ Configure integrations (Stripe, etc)
- ✅ Manage customer data

### What They CANNOT Do
- ❌ Access other cafes' data
- ❌ Modify subscription pricing
- ❌ View platform-wide analytics
- ❌ Manage other cafe owners
- ❌ Access Super Admin settings
- ❌ Trigger system backups
- ❌ Manage system integrations (only connect to them)
- ❌ Delete transaction history (locked for compliance)

### Permissions List
```
cafe.read.own
cafe.update.own
cafe.settings.manage
branches.create.own_cafe
branches.read.own_cafe
branches.update.own_cafe
branches.delete.own_cafe
staff.create.own_cafe
staff.read.own_cafe
staff.update.own_cafe
staff.delete.own_cafe
staff.assign_roles
staff.manage_permissions
menu.create
menu.read
menu.update
menu.delete
menu.publish_to_branches
menu_items.bulk_import
inventory.read.own_cafe
inventory.update.own_cafe
inventory.reconcile
inventory.reports
suppliers.create.own_cafe
suppliers.read.own_cafe
suppliers.update.own_cafe
orders.read.own_cafe
orders.refund
orders.analytics
payments.read.own_cafe
payments.reconcile
billing.read.own
billing.invoices.download
billing.upgrade_plan
billing.add_payment_method
reports.daily_sales
reports.menu_performance
reports.staff_performance
reports.financial
reports.export
customers.read
customers.export
loyalty.manage
analytics.cafe.view
analytics.export
pos.transactions.view
pos.transactions.void
pos.till.reconcile
```

---

## ROLE 3: BRANCH MANAGER

**Access Level:** Single branch only  
**Login Method:** Email + Password  
**Use Cases:** Day-to-day management of a single cafe location

### What They Can Do
- ✅ View own branch data and settings
- ✅ Update own branch information
- ✅ Hire and schedule staff for own branch
- ✅ Manage staff clock in/out
- ✅ View menu (global menu set by cafe owner)
- ✅ Customize menu for own branch (86 items, local pricing)
- ✅ View inventory for own branch
- ✅ Count and update inventory
- ✅ Approve inventory transfers to/from other branches
- ✅ View orders and sales for own branch
- ✅ Process refunds for orders
- ✅ View daily and hourly sales reports
- ✅ View staff performance reports
- ✅ View inventory reports
- ✅ Reconcile till at end of shift
- ✅ Close daily cash register
- ✅ Manage KDS (kitchen display) configuration
- ✅ View customer data (own branch)
- ✅ Create customer profiles
- ✅ Enroll customers in loyalty program

### What They CANNOT Do
- ❌ Access other branches' data
- ❌ Create or modify global menu
- ❌ Delete staff (only deactivate)
- ❌ View cafe-wide reports
- ❌ Access billing and subscription
- ❌ Process large refunds without approval
- ❌ Export data outside the system
- ❌ View financial/profit reports
- ❌ Change cafe settings
- ❌ Manage suppliers
- ❌ View other branches' inventory

### Permissions List
```
branch.read.own
branch.update.own
branch.settings.manage
staff.create.own_branch
staff.read.own_branch
staff.update.own_branch
staff.delete.own_branch
staff.schedule.manage
staff.clock_in_out.manage
menu.read
menu_local_customization.update
inventory.read.own_branch
inventory.update.own_branch
inventory.count.manage
inventory.transfers.approve
orders.read.own_branch
orders.refund
orders.void
payments.read.own_branch
payments.cash_reconciliation
pos.terminal.setup
pos.transactions.view.own_branch
pos.till.reconcile
pos.till.close
reports.daily_sales
reports.hourly_sales
reports.menu_performance
reports.staff_performance
reports.inventory
reports.export
customers.read.own_branch
kds.view
kds.configure
analytics.branch.view
```

---

## ROLE 4: WAITER / POS STAFF

**Access Level:** Own orders + assigned tables only  
**Login Method:** PIN (4 digits) or Biometric fingerprint  
**Use Cases:** Taking orders and processing payments at POS

### What They Can Do
- ✅ Create new orders
- ✅ See their own orders
- ✅ Modify orders before payment
- ✅ Remove items from unpaid orders
- ✅ Add special instructions
- ✅ View menu and item availability
- ✅ Process cash payments
- ✅ Process card payments
- ✅ Accept digital wallets (Apple Pay, Google Pay)
- ✅ Apply limited discounts (up to 15% max)
- ✅ View loyalty points balance
- ✅ Enroll customers in loyalty program
- ✅ View assigned tables
- ✅ See inventory stock levels
- ✅ Report low stock items
- ✅ Create new customer profiles (basic info)
- ✅ View daily order summary
- ✅ View personal transaction summary
- ✅ Void unpaid orders
- ✅ Print receipts

### What They CANNOT Do
- ❌ Process refunds (manager approval needed)
- ❌ View other staff's orders
- ❌ Change menu or prices
- ❌ Access inventory beyond viewing
- ❌ View financial data
- ❌ Access admin settings
- ❌ See staff schedules or info
- ❌ Export any data
- ❌ Apply discounts over 15%
- ❌ Void paid orders
- ❌ Access other branches
- ❌ View reports
- ❌ Modify customer data beyond creation

### Permissions List
```
orders.create
orders.read.own
orders.update.own
orders.modify.items
orders.view_assigned_tables
orders.void.own
payments.process
payments.accept_cash
payments.accept_card
payments.accept_digital_wallet
payments.apply_discount.limited
payments.tip_suggestion.show
menu.read
menu.view_prices
menu.view_availability
inventory.view.own_branch
inventory.report_shortage
customers.create
customers.read
customers.view_loyalty_balance
customers.enroll_loyalty
pos.login
pos.operations
pos.view_assigned_tables
reports.view.own_orders
reports.daily_summary
```

---

## SUBSCRIPTION TIER FEATURE ACCESS

### TRIAL (14 days, Free)
**Features Accessible:**
- Core POS (create orders, payments)
- Basic menu management
- Basic inventory tracking
- Basic KDS
- Single branch
- Up to 3 users
- 1,000 transactions/month
- 1 GB storage
- Email support only

**Features NOT Accessible:**
- Multi-location
- Loyalty program
- Gift cards
- Advanced analytics
- Mobile staff app
- Delivery integrations
- API access
- Custom integrations

### BASIC ($49/month)
**Additional Features vs Trial:**
- Full KDS (all functions)
- Up to 5 staff users
- 10,000 transactions/month
- 10 GB storage
- Basic analytics
- 2 integrations (Stripe + 1 other)

**Still NOT Accessible:**
- Multi-location
- Loyalty program
- Gift cards
- Advanced analytics
- Mobile app
- Delivery integrations
- API access

### PRO ($149/month)
**Additional Features vs Basic:**
- UNLIMITED branches/locations
- Inventory advanced features
- Advanced KDS with routing rules
- Loyalty program (full)
- Gift cards (full)
- Advanced analytics
- Mobile staff app
- Delivery integration (limited)
- Limited API access (10,000 calls/day)
- 5 integrations
- 100 GB storage
- Priority email support

### ENTERPRISE (Custom)
**All Features Included:**
- Everything in Pro
- Unlimited API calls
- Unlimited integrations
- Custom branding
- Single Sign-On (SSO)
- Advanced security (IP whitelist)
- 24/7 dedicated support
- Custom SLA
- 1 TB storage
- Data residency options

---

## PERMISSION ENFORCEMENT RULES

### How Permissions Work

1. **Every API endpoint checks permissions**
   - User role is retrieved from JWT token
   - Required permission is checked against role definition
   - If permission missing → 403 Forbidden error
   - Action is logged to audit_logs table

2. **Tenant Scope**
   - Users can only access data from their own tenant (cafe)
   - Even Super Admin filtered by tenant_id in requests
   - Cross-tenant access automatically blocked

3. **Location Scope**
   - Branch Manager only sees own branch data
   - Waiter only sees assigned table/orders
   - Cafe Owner sees all branches

4. **Feature Gating**
   - Features check subscription tier
   - If feature not in tier → feature unavailable
   - User gets error: "Upgrade to X tier to access this feature"
   - Can be checked before showing UI elements

5. **Action-Level Limits**
   - Waiters: Can apply discounts up to 15% only
   - Managers: Can void any order
   - Owners: Can process refunds
   - Super Admin: Can do everything

### Example Permission Checks

**Create Order:**
- User must have: `orders.create` permission
- User's subscription must have: `core_pos` feature enabled
- Result: ✅ Can create order

**Apply Discount > 15%:**
- User must have: `payments.apply_discount.limited` permission
- Requested discount: 20%
- Result: ❌ Permission denied - max 15%

**Access Multi-Location:**
- User must have: `branches.read.own_cafe` permission
- Subscription must have: `multi_location` feature = true
- Subscription tier must be: PRO or ENTERPRISE
- Result: ✅ Can see multi-location menu

**View Cafe Analytics:**
- User must have: `analytics.cafe.view` permission
- User role must be: CAFE_OWNER or SUPER_ADMIN
- Result: ✅ Can view (BRANCH_MANAGER cannot)

---

## QUICK PERMISSION LOOKUP TABLE

| Action | SUPER_ADMIN | CAFE_OWNER | BRANCH_MGR | WAITER |
|--------|:---:|:---:|:---:|:---:|
| Create Order | ❌ | ❌ | ❌ | ✅ |
| Process Payment | ❌ | ❌ | ❌ | ✅ |
| Apply Discount | ❌ | ❌ | ✅ | ✅ (max 15%) |
| Process Refund | ✅ | ✅ | ✅ | ❌ |
| Create Staff | ✅ | ✅ | ✅ | ❌ |
| Create Menu | ✅ | ✅ | ✅ (local) | ❌ |
| View All Cafes | ✅ | ❌ | ❌ | ❌ |
| View Own Cafe | ✅ | ✅ | ✅ (own branch) | ❌ |
| Manage Subscription | ✅ | ✅ | ❌ | ❌ |
| View Billing | ✅ | ✅ | ❌ | ❌ |
| Generate Reports | ✅ | ✅ | ✅ (own branch) | ❌ |
| View Audit Logs | ✅ | ✅ | ✅ (own branch) | ❌ |
| Manage Inventory | ✅ | ✅ | ✅ (own branch) | ❌ (read-only) |
| Configure KDS | ✅ | ✅ | ✅ | ❌ |
| Close Till | ✅ | ✅ | ✅ | ❌ |
| Void Order | ✅ | ✅ | ✅ | ✅ (unpaid only) |

---

## MULTI-TENANT ISOLATION SECURITY

### Data Isolation Rules

1. **Database Level**
   - Every table has `tenant_id` column
   - Queries always filter by `tenant_id`
   - Foreign keys enforce data relationships within tenant

2. **API Level**
   - JWT token contains `tenant_id`
   - All queries add WHERE clause: `tenant_id = user.tenant_id`
   - Cross-tenant requests rejected with 403

3. **Cache Level**
   - Cache keys include tenant_id: `order:{tenant_id}:{order_id}`
   - Prevents leaking data between tenants

4. **Audit Level**
   - All actions logged with tenant_id
   - Separate audit logs per tenant
   - Cannot view other tenant's audit logs

### Example: Multi-Tenant Safety
```
// User requests: GET /api/v1/orders/123
// User token: tenant_id = 1

// Database query becomes:
SELECT * FROM orders WHERE id = 123 AND tenant_id = 1

// If order belongs to tenant_id = 2:
// Result: No rows returned (treats as not found)
// User gets 404 error (not 403, to avoid info leakage)
```

---

## IMPLEMENTATION CHECKLIST

- [ ] Create 4 role definitions in database
- [ ] Create permission matrix (60+ permissions)
- [ ] Implement checkPermission() middleware
- [ ] Add tenant scope validation
- [ ] Add location scope validation
- [ ] Implement feature gating for each tier
- [ ] Add audit logging for permission denials
- [ ] Create role assignment UI for cafe owners
- [ ] Test all permission combinations
- [ ] Document permission matrix
- [ ] Train support team on role capabilities

---

**Last Updated:** January 2026  
**Version:** 1.0

