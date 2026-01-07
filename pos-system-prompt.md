# 🏗️ POS SYSTEM REDESIGN - COMPLETE AI ENGINEERING PROMPT

**Document Version:** 1.0  
**Created:** January 2026  
**Target Audience:** AI Code Assistants (Claude, GPT-4, Copilot)  
**Target Implementation:** Full Production-Grade SaaS POS System

---

## 📋 TABLE OF CONTENTS

1. [Executive Summary & Goals](#executive-summary)
2. [System Overview & Architecture](#system-overview)
3. [Role-Based Access Control (RBAC) System](#rbac-system)
4. [Subscription Management & Billing](#subscription-management)
5. [Implementation Phases](#implementation-phases)
6. [Technical Stack & Database Design](#technical-stack)
7. [API Specifications](#api-specifications)
8. [Feature Specifications by Phase](#feature-specifications)
9. [Code Quality & Safety Guidelines](#code-quality)
10. [AI Instruction Rules](#ai-instruction-rules)

---

## EXECUTIVE SUMMARY {#executive-summary}

### 🎯 Project Goals

Build a **multi-tenant SaaS POS system** for cafes and restaurants with:
- **4-tier role hierarchy** with granular permission control
- **3-tier subscription model** (Trial, Basic, Pro, Enterprise) with feature gating
- **Cloud-native architecture** supporting offline-first operations
- **100% code safety** - no hallucinations, no pseudo-code
- **Phased implementation** from MVP to enterprise features

### 💼 Business Model

**SaaS Multi-Tenant Platform:**
- **Platform Owner (Super Admin):** Manages all cafes, subscription tiers, global settings
- **Cafe Owner (Global Manager):** Owns multiple branches, manages billing, global menu
- **Branch Manager:** Manages single branch operations, staff, daily reports
- **Waiter (POS Staff):** Takes orders, processes payments, views assigned tables/orders

**Revenue:** Monthly subscription per cafe (not per user)

---

## SYSTEM OVERVIEW {#system-overview}

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                          │
├─────────────┬──────────────┬──────────────┬────────────────┤
│   Web App   │  Mobile App  │   KDS Panel  │ Admin Dashboard│
│  (React)    │ (React Native)│  (Electron) │   (Next.js)    │
└──────┬──────┴──────┬───────┴──────┬───────┴────────┬───────┘
       │             │              │                │
       └─────────────┴──────────────┴────────────────┘
                      │
        ┌─────────────────────────────┐
        │  API GATEWAY / AUTH LAYER   │
        │  (JWT + Role Middleware)    │
        └──────────────┬──────────────┘
                       │
     ┌─────────────────────────────────────────────┐
     │    BACKEND SERVICES (Microservices)         │
     ├──────────┬──────────┬────────┬───────────┬──┤
     │  Auth    │  Orders  │Payment │ Inventory │..│
     │  Service │ Service  │Service │ Service   │  │
     └─────┬────┴────┬─────┴──┬─────┴────┬──────┴──┘
           │         │        │          │
     ┌─────────────────────────────────────────────┐
     │         DATABASE LAYER                      │
     ├──────────────┬──────────────┬──────────────┤
     │ PostgreSQL   │ Redis Cache  │  File Store  │
     │ (Main DB)    │ (Sessions)   │  (S3 / GCS)  │
     └──────────────┴──────────────┴──────────────┘
           │
     ┌─────────────────────────────┐
     │   INTEGRATIONS             │
     ├──────────────┬──────────────┤
     │ Payment APIs │ Billing APIs │
     │ (Stripe)     │ (Recurly)    │
     └──────────────┴──────────────┘
```

### Core Principles

1. **Multi-Tenancy:** Cafes are completely isolated; one compromised tenant cannot access another
2. **Feature Gating:** Features unlock by subscription tier, not by user type
3. **Offline-First:** All operations work offline, sync when online
4. **Least Privilege:** Each role gets minimum required permissions
5. **Audit Trail:** Every action logged for compliance and debugging
6. **Idempotency:** All operations can safely retry without side effects

---

## ROLE-BASED ACCESS CONTROL (RBAC) SYSTEM {#rbac-system}

### 🔐 Role Hierarchy & Permissions Matrix

#### ROLE 1: SUPER ADMIN / PLATFORM OWNER

**Purpose:** System administrator managing entire platform.

**Permissions:**
```javascript
{
  "role": "SUPER_ADMIN",
  "permissions": {
    // Platform Management
    "cafes.create": true,
    "cafes.read.all": true,
    "cafes.update": true,
    "cafes.delete": true,
    
    // User Management
    "users.create": true,
    "users.read.all": true,
    "users.update": true,
    "users.delete": true,
    "users.reset_password": true,
    
    // Subscription Management
    "subscriptions.manage": true,
    "subscriptions.upgrade": true,
    "subscriptions.downgrade": true,
    "subscriptions.cancel": true,
    
    // Billing & Finance
    "billing.view.all": true,
    "billing.invoices.download": true,
    "billing.payments.refund": true,
    "financial.reports.export": true,
    
    // System Configuration
    "system.config.manage": true,
    "system.feature_flags.manage": true,
    "system.integrations.manage": true,
    "system.backups.trigger": true,
    "system.audit_logs.view": true,
    
    // Analytics
    "analytics.platform.view": true,
    "analytics.export": true
  },
  "restrictions": {
    "max_cafes_viewable": "unlimited",
    "feature_access": "all"
  },
  "audit_requirement": true,
  "created_by": "system"
}
```

**Use Cases:**
- Monitor platform health and usage
- Manage subscription tiers and pricing
- Handle customer escalations
- Run platform-wide analytics
- Manage integrations and API keys

**Login:** Email + Password (with 2FA required)

---

#### ROLE 2: CAFE OWNER / GLOBAL MANAGER

**Purpose:** Business owner managing one or multiple branch locations.

**Permissions:**
```javascript
{
  "role": "CAFE_OWNER",
  "tenant_scoped": true,  // Can only access own cafe's data
  "permissions": {
    // Own Cafe Management
    "cafe.read.own": true,
    "cafe.update.own": true,
    "cafe.settings.manage": true,
    
    // Branch Management
    "branches.create.own_cafe": true,
    "branches.read.own_cafe": true,
    "branches.update.own_cafe": true,
    "branches.delete.own_cafe": true,
    
    // Staff Management
    "staff.create.own_cafe": true,
    "staff.read.own_cafe": true,
    "staff.update.own_cafe": true,
    "staff.delete.own_cafe": true,
    "staff.assign_roles": true,
    "staff.manage_permissions": true,
    
    // Menu Management (Global)
    "menu.create": true,
    "menu.read": true,
    "menu.update": true,
    "menu.delete": true,
    "menu.publish_to_branches": true,
    "menu_items.bulk_import": true,
    
    // Inventory (Global & Branch Level)
    "inventory.read.own_cafe": true,
    "inventory.update.own_cafe": true,
    "inventory.reconcile": true,
    "inventory.reports": true,
    
    // Supplier Management
    "suppliers.create.own_cafe": true,
    "suppliers.read.own_cafe": true,
    "suppliers.update.own_cafe": true,
    
    // Orders & Sales
    "orders.read.own_cafe": true,
    "orders.refund": true,
    "orders.analytics": true,
    
    // Payments
    "payments.read.own_cafe": true,
    "payments.reconcile": true,
    
    // Billing & Subscription
    "billing.read.own": true,
    "billing.invoices.download": true,
    "billing.upgrade_plan": true,
    "billing.add_payment_method": true,
    
    // Reports
    "reports.daily_sales": true,
    "reports.menu_performance": true,
    "reports.staff_performance": true,
    "reports.financial": true,
    "reports.export": true,
    
    // Customer Management
    "customers.read": true,
    "customers.export": true,
    "loyalty.manage": true,
    
    // Analytics
    "analytics.cafe.view": true,
    "analytics.export": true,
    
    // POS Operations
    "pos.transactions.view": true,
    "pos.transactions.void": true,
    "pos.till.reconcile": true
  },
  "restrictions": {
    "data_access_scope": "own_cafe_and_branches",
    "staff_management": "limited_to_own_locations",
    "feature_access": "based_on_subscription_tier"
  },
  "audit_requirement": true
}
```

**Use Cases:**
- View all branch sales and performance
- Create and manage menus across locations
- Hire and manage staff across locations
- Track financial performance
- Upgrade/manage subscription tier
- View consolidated reports
- Manage customer loyalty programs

**Login:** Email + Password (with optional 2FA)

---

#### ROLE 3: BRANCH MANAGER

**Purpose:** Manager of a single branch/location.

**Permissions:**
```javascript
{
  "role": "BRANCH_MANAGER",
  "tenant_scoped": true,
  "location_scoped": true,  // Single branch only
  "permissions": {
    // Own Branch Management
    "branch.read.own": true,
    "branch.update.own": true,
    "branch.settings.manage": true,
    
    // Staff Management (Own Branch Only)
    "staff.create.own_branch": true,
    "staff.read.own_branch": true,
    "staff.update.own_branch": true,
    "staff.delete.own_branch": true,
    "staff.schedule.manage": true,
    "staff.clock_in_out.manage": true,
    
    // Menu (Read-Only, Global Menu)
    "menu.read": true,
    "menu_local_customization.update": true,  // Can customize for own branch
    
    // Inventory (Own Branch)
    "inventory.read.own_branch": true,
    "inventory.update.own_branch": true,
    "inventory.count.manage": true,  // Physical inventory counts
    "inventory.transfers.approve": true,
    
    // Orders & Sales (Own Branch)
    "orders.read.own_branch": true,
    "orders.refund": true,
    "orders.void": true,
    
    // Payments (Own Branch)
    "payments.read.own_branch": true,
    "payments.cash_reconciliation": true,
    
    // POS Operations
    "pos.terminal.setup": true,
    "pos.transactions.view.own_branch": true,
    "pos.till.reconcile": true,
    "pos.till.close": true,
    
    // Reports (Own Branch)
    "reports.daily_sales": true,
    "reports.hourly_sales": true,
    "reports.menu_performance": true,
    "reports.staff_performance": true,
    "reports.inventory": true,
    "reports.export": true,
    
    // Customer Management (Own Branch)
    "customers.read.own_branch": true,
    
    // Kitchen Display System
    "kds.view": true,
    "kds.configure": true,
    
    // Analytics (Own Branch)
    "analytics.branch.view": true
  },
  "restrictions": {
    "data_access_scope": "own_branch_only",
    "cannot_manage": ["cafe_settings", "global_menu", "staff_from_other_branches", "cafe_subscription"],
    "feature_access": "based_on_subscription_tier"
  },
  "audit_requirement": true
}
```

**Use Cases:**
- Daily operations management
- Staff scheduling and management
- Inventory counting and tracking
- Till reconciliation at end of shift
- View daily/hourly sales reports
- Manage local inventory levels
- Approve local menu customizations
- Monitor branch performance

**Login:** PIN (4-6 digits) or Password

---

#### ROLE 4: WAITER / POS STAFF

**Purpose:** Front-line staff taking orders and processing payments.

**Permissions:**
```javascript
{
  "role": "WAITER",
  "tenant_scoped": true,
  "location_scoped": true,
  "permissions": {
    // Order Management
    "orders.create": true,
    "orders.read.own": true,  // Can only see assigned orders
    "orders.update.own": true,
    "orders.modify.items": true,  // Add/remove items before payment
    "orders.view_assigned_tables": true,
    "orders.void.own": true,  // Void unpaid orders only
    
    // Payment Processing
    "payments.process": true,
    "payments.accept_cash": true,
    "payments.accept_card": true,
    "payments.accept_digital_wallet": true,
    "payments.apply_discount.limited": true,  // Max X% discount
    "payments.tip_suggestion.show": true,
    
    // Menu Access
    "menu.read": true,
    "menu.view_prices": true,
    "menu.view_availability": true,  // See 86ed items
    
    // Inventory
    "inventory.view.own_branch": true,  // View stock levels
    "inventory.report_shortage": true,  // Report low stock
    
    // Customer Management
    "customers.create": true,  // Create new customer record
    "customers.read": true,
    "customers.view_loyalty_balance": true,
    "customers.enroll_loyalty": true,
    
    // POS Terminal
    "pos.login": true,
    "pos.operations": true,
    "pos.view_assigned_tables": true,
    
    // Reporting
    "reports.view.own_orders": true,
    "reports.daily_summary": true
  },
  "restrictions": {
    "data_access_scope": "own_branch_only",
    "cannot_view": ["financial_data", "staff_data", "settings", "other_orders"],
    "cannot_modify": ["menu", "inventory", "pricing"],
    "cannot_access": ["admin_dashboard", "analytics", "billing"],
    "discount_limit_percent": 15,  // Max 15% discount per transaction
    "refund_allowed": false,  // Needs manager approval for refunds
    "feature_access": "core_pos_only"
  },
  "audit_requirement": true,
  "activity_tracking": true  // Track all transactions
}
```

**Use Cases:**
- Take customer orders
- Process payments (cash, card, digital)
- Apply available discounts
- Enroll customers in loyalty program
- View assigned tables/orders
- Check item availability
- Create new customer profiles
- View personal daily summary

**Login:** PIN (4 digits only for speed) or Biometric (fingerprint)

---

### Permission Enforcement Rules

```javascript
// Pseudo-code for permission checking in middleware

async function checkPermission(user, resource, action, context) {
  // 1. Verify user role exists
  const role = getRoleDefinition(user.role);
  if (!role) throw new UnauthorizedError("Role not found");
  
  // 2. Check if permission exists for this role
  const permission = `${resource}.${action}`;
  if (!role.permissions[permission]) {
    logUnauthorizedAttempt(user.id, permission, context);
    throw new ForbiddenError("Permission denied");
  }
  
  // 3. Check tenant scope
  if (role.tenant_scoped && context.tenant_id !== user.tenant_id) {
    throw new ForbiddenError("Not authorized for this tenant");
  }
  
  // 4. Check location scope
  if (role.location_scoped && context.location_id !== user.location_id) {
    throw new ForbiddenError("Not authorized for this location");
  }
  
  // 5. Check additional restrictions
  if (role.restrictions) {
    validateRestrictions(user, role, context);
  }
  
  // 6. Log action if audit required
  if (role.audit_requirement) {
    logAuditTrail(user.id, permission, context);
  }
  
  return true;
}
```

---

## SUBSCRIPTION MANAGEMENT & BILLING {#subscription-management}

### 📊 Subscription Tier Matrix

| Feature | TRIAL | BASIC | PRO | ENTERPRISE |
|---------|-------|-------|-----|------------|
| **Duration** | 14 days | Monthly | Monthly | Custom |
| **Cost** | $0 | $49/month | $149/month | Custom |
| **Branches Allowed** | 1 | 1 | Unlimited | Unlimited |
| **Users/Locations** | Unlimited | Up to 5 staff | Unlimited | Unlimited |
| **Core POS** | ✅ | ✅ | ✅ | ✅ |
| **Menu Management** | ✅ | ✅ | ✅ | ✅ |
| **Inventory Tracking** | ✅ Basic | ✅ Full | ✅ Advanced | ✅ Advanced |
| **Kitchen Display (KDS)** | ✅ Basic | ✅ Full | ✅ Full + Routing | ✅ AI-Optimized |
| **Order Management** | ✅ | ✅ | ✅ | ✅ |
| **Payment Processing** | ✅ | ✅ | ✅ | ✅ |
| **Multi-Location Sync** | ❌ | ❌ | ✅ Unlimited | ✅ Unlimited |
| **Customer Loyalty Program** | ❌ | ❌ | ✅ | ✅ |
| **Gift Cards** | ❌ | ❌ | ✅ | ✅ |
| **Advanced Analytics** | ❌ | Basic | ✅ Full | ✅ Full + Custom |
| **Integrations** | ❌ | 2 (Stripe + 1) | 5+ | Unlimited |
| **Mobile Staff App** | ❌ | ❌ | ✅ | ✅ |
| **Delivery App Integration** | ❌ | ❌ | ✅ Limited | ✅ Full |
| **API Access** | ❌ | ❌ | Limited | Full |
| **Offline Mode** | ✅ | ✅ | ✅ | ✅ |
| **Support** | Email | Email | Priority | 24/7 Dedicated |
| **Transactions/Month Limit** | 1,000 | 10,000 | Unlimited | Unlimited |
| **Storage** | 1 GB | 10 GB | 100 GB | 1 TB |
| **Auto-Backups** | ✅ | ✅ | ✅ | ✅ |
| **SLA Uptime** | 99% | 99.5% | 99.9% | 99.99% |
| **Custom Branding** | ❌ | ❌ | ❌ | ✅ |
| **Single Sign-On (SSO)** | ❌ | ❌ | ❌ | ✅ |

### Subscription Tier Code Model

```javascript
// Subscription Tier Definition
const SUBSCRIPTION_TIERS = {
  TRIAL: {
    id: "trial",
    name: "Trial",
    duration_days: 14,
    price_monthly: 0,
    price_annual: 0,
    currency: "USD",
    auto_renew: false,
    requires_payment_method: false,
    features: {
      core_pos: true,
      menu_management: true,
      inventory_basic: true,
      kds_basic: true,
      orders: true,
      payments: true,
      loyalty_program: false,
      gift_cards: false,
      multi_location: false,
      advanced_analytics: false,
      mobile_staff_app: false,
      delivery_integration: false,
      api_access: false
    },
    limits: {
      branches: 1,
      users: 3,
      transactions_per_month: 1000,
      storage_gb: 1,
      api_calls_per_day: 0,
      integrations: 0
    },
    support: "email",
    sla_uptime_percent: 99.0
  },
  
  BASIC: {
    id: "basic",
    name: "Basic",
    duration_days: 30,
    price_monthly: 4900,  // in cents: $49.00
    price_annual: 44100,  // in cents: $441.00 (10% discount)
    currency: "USD",
    auto_renew: true,
    requires_payment_method: true,
    features: {
      core_pos: true,
      menu_management: true,
      inventory_basic: true,
      kds_full: true,
      orders: true,
      payments: true,
      loyalty_program: false,
      gift_cards: false,
      multi_location: false,
      advanced_analytics: false,
      mobile_staff_app: false,
      delivery_integration: false,
      api_access: false
    },
    limits: {
      branches: 1,
      users: 5,
      transactions_per_month: 10000,
      storage_gb: 10,
      api_calls_per_day: 0,
      integrations: 2  // Stripe + 1 other
    },
    support: "email",
    sla_uptime_percent: 99.5
  },
  
  PRO: {
    id: "pro",
    name: "Pro",
    duration_days: 30,
    price_monthly: 14900,  // $149.00
    price_annual: 134100,  // $1341.00 (10% discount)
    currency: "USD",
    auto_renew: true,
    requires_payment_method: true,
    features: {
      core_pos: true,
      menu_management: true,
      inventory_advanced: true,
      kds_advanced: true,
      orders: true,
      payments: true,
      loyalty_program: true,
      gift_cards: true,
      multi_location: true,
      advanced_analytics: true,
      mobile_staff_app: true,
      delivery_integration: true,
      api_access: "limited"
    },
    limits: {
      branches: -1,  // unlimited
      users: -1,
      transactions_per_month: -1,
      storage_gb: 100,
      api_calls_per_day: 10000,
      integrations: 5
    },
    support: "priority_email",
    sla_uptime_percent: 99.9
  },
  
  ENTERPRISE: {
    id: "enterprise",
    name: "Enterprise",
    duration_days: 365,
    price_monthly: null,  // Custom pricing
    price_annual: null,
    currency: "USD",
    auto_renew: true,
    requires_payment_method: true,
    features: {
      core_pos: true,
      menu_management: true,
      inventory_advanced: true,
      kds_ai_optimized: true,
      orders: true,
      payments: true,
      loyalty_program: true,
      gift_cards: true,
      multi_location: true,
      advanced_analytics: true,
      mobile_staff_app: true,
      delivery_integration: true,
      api_access: "full",
      custom_branding: true,
      sso: true
    },
    limits: {
      branches: -1,  // unlimited
      users: -1,
      transactions_per_month: -1,
      storage_gb: 1024,
      api_calls_per_day: -1,
      integrations: -1
    },
    support: "24/7_dedicated",
    sla_uptime_percent: 99.99
  }
};

// User's Active Subscription Object
interface UserSubscription {
  id: string;
  tenant_id: string;  // Cafe's ID
  tier: keyof typeof SUBSCRIPTION_TIERS;
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'expired';
  
  // Dates
  start_date: Date;
  end_date: Date;
  renewal_date: Date;
  trial_ends_at: Date | null;
  
  // Billing
  billing_cycle: 'monthly' | 'annual';
  price_paid: number;  // in cents
  currency: string;
  
  // Payment Method
  payment_method_id: string;  // Stripe token
  billing_email: string;
  
  // Metadata
  stripe_subscription_id: string;
  stripe_customer_id: string;
  created_at: Date;
  updated_at: Date;
  
  // Feature Access
  getFeature(featureName: string): boolean;
  getLimit(limitName: string): number;
  canAccessResource(resource: string): boolean;
  isExpired(): boolean;
}
```

### Feature Gating Logic

```javascript
// Feature Gate Service - Check if user can access a feature
class FeatureGateService {
  
  async canAccessFeature(userId, featureName) {
    // 1. Get user's subscription
    const subscription = await Subscription.findByUserId(userId);
    
    // 2. Check if subscription is active
    if (subscription.status !== 'active') {
      return false;
    }
    
    // 3. Check if tier has this feature
    const tier = SUBSCRIPTION_TIERS[subscription.tier];
    if (!tier.features[featureName]) {
      return false;  // Feature not in tier
    }
    
    // 4. Check if feature is enabled (not in beta)
    const feature = await Feature.findByName(featureName);
    if (feature.status === 'beta' && !subscription.isBetaTester) {
      return false;
    }
    
    return true;
  }
  
  async checkLimit(userId, limitName) {
    const subscription = await Subscription.findByUserId(userId);
    const tier = SUBSCRIPTION_TIERS[subscription.tier];
    const limit = tier.limits[limitName];
    
    if (limit === -1) return { allowed: true, remaining: "unlimited" };
    
    const used = await Usage.getUsage(userId, limitName);
    const remaining = Math.max(0, limit - used);
    
    return {
      allowed: remaining > 0,
      limit: limit,
      used: used,
      remaining: remaining
    };
  }
}

// Example: Feature gate in order creation
async function createOrder(userId, orderData) {
  // Check if user's subscription allows orders
  const canCreateOrders = await featureGate.canAccessFeature(
    userId,
    'orders'
  );
  
  if (!canCreateOrders) {
    throw new FeatureNotAvailableError(
      'Your subscription does not include order management. Upgrade to Pro or higher.'
    );
  }
  
  // Check transaction limit
  const limitCheck = await featureGate.checkLimit(
    userId,
    'transactions_per_month'
  );
  
  if (!limitCheck.allowed) {
    throw new LimitExceededError(
      `You've reached your monthly transaction limit (${limitCheck.limit}). ` +
      'Please upgrade your subscription.'
    );
  }
  
  // Create order...
  return Order.create(orderData);
}
```

### Billing & Payment Workflow

```javascript
// Subscription Lifecycle
class SubscriptionManager {
  
  // 1. START TRIAL
  async startTrial(tenantId, ownerEmail) {
    const subscription = new Subscription({
      tenant_id: tenantId,
      tier: 'trial',
      status: 'active',
      start_date: new Date(),
      end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),  // 14 days
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    });
    
    await subscription.save();
    
    // Schedule trial expiration check
    this.scheduleTrialExpiration(subscription.id);
    
    return subscription;
  }
  
  // 2. UPGRADE FROM TRIAL
  async upgradeFromTrial(subscriptionId, tier, paymentMethodId) {
    const subscription = await Subscription.findById(subscriptionId);
    
    if (subscription.tier !== 'trial') {
      throw new Error('Can only upgrade from trial');
    }
    
    const tierData = SUBSCRIPTION_TIERS[tier];
    
    // Create Stripe subscription
    const stripeSubscription = await stripe.subscriptions.create({
      customer: await this.getOrCreateStripeCustomer(subscription.tenant_id),
      items: [{ price: tierData.stripe_price_id }],
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: Math.floor(Date.now() / 1000)
    });
    
    // Update subscription
    subscription.tier = tier;
    subscription.status = 'active';
    subscription.stripe_subscription_id = stripeSubscription.id;
    subscription.end_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await subscription.save();
    
    return subscription;
  }
  
  // 3. UPGRADE/DOWNGRADE BETWEEN TIERS
  async changeTier(subscriptionId, newTier) {
    const subscription = await Subscription.findById(subscriptionId);
    const oldTier = SUBSCRIPTION_TIERS[subscription.tier];
    const newTierData = SUBSCRIPTION_TIERS[newTier];
    
    // If downgrading, check for feature compatibility
    if (newTierData.features.multi_location === false && 
        subscription.branchCount > 1) {
      throw new Error(
        'Cannot downgrade to ' + newTier + 
        '. You have multiple branches. Upgrade to Pro or higher.'
      );
    }
    
    // Update Stripe
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{
        id: subscription.stripe_item_id,
        price: newTierData.stripe_price_id
      }],
      billing_cycle_anchor: 'now',
      proration_behavior: 'create_prorations'  // Bill/credit difference
    });
    
    subscription.tier = newTier;
    await subscription.save();
    
    return subscription;
  }
  
  // 4. CANCEL SUBSCRIPTION
  async cancelSubscription(subscriptionId, reason) {
    const subscription = await Subscription.findById(subscriptionId);
    
    // Cancel in Stripe
    await stripe.subscriptions.del(subscription.stripe_subscription_id);
    
    // Mark as canceled
    subscription.status = 'canceled';
    subscription.canceled_at = new Date();
    subscription.cancellation_reason = reason;
    
    await subscription.save();
    
    // Schedule data retention (GDPR: keep for 90 days then delete)
    this.scheduleDataRetention(subscriptionId, 90);
    
    return subscription;
  }
  
  // 5. HANDLE PAYMENT FAILURE
  async handlePaymentFailure(stripeEventId) {
    // Get subscription from Stripe event
    const event = await stripe.events.retrieve(stripeEventId);
    const stripeSubscription = event.data.object;
    
    const subscription = await Subscription.findOne({
      stripe_subscription_id: stripeSubscription.id
    });
    
    if (!subscription) return;
    
    // Mark as past due
    subscription.status = 'past_due';
    subscription.payment_failed_at = new Date();
    subscription.payment_failed_attempts = (subscription.payment_failed_attempts || 0) + 1;
    
    await subscription.save();
    
    // Send email reminder
    await emailService.sendPaymentFailedEmail(
      subscription.billing_email,
      subscription.tenant_id,
      stripeSubscription.latest_invoice
    );
    
    // If 3 failures, suspend access
    if (subscription.payment_failed_attempts >= 3) {
      await this.suspendAccess(subscription.id);
    }
  }
  
  // 6. SUSPEND ACCESS (after failed payments)
  async suspendAccess(subscriptionId) {
    const subscription = await Subscription.findById(subscriptionId);
    
    subscription.status = 'suspended';
    subscription.suspended_at = new Date();
    
    await subscription.save();
    
    // Disable all API access for this tenant
    await TenantAccess.disable(subscription.tenant_id);
    
    // Notify tenant owner
    await notificationService.notifyTenantOwner(
      subscription.tenant_id,
      'Your subscription has been suspended due to payment failure. ' +
      'Please update your payment method to resume access.'
    );
  }
}
```

---

## IMPLEMENTATION PHASES {#implementation-phases}

### 🎯 PHASE 1: MVP (Weeks 1-4) - Core POS Functionality

**Goal:** Functional POS system with basic operations, trial subscription, single role (admin only).

**Deliverables:**

1. **Authentication & Authorization**
   - User registration (email + password)
   - Login with JWT tokens
   - Password reset flow
   - Single role (SUPER_ADMIN for MVP)

2. **Cafe Setup**
   - Cafe creation and configuration
   - Branch/location setup (single branch for MVP)
   - Basic settings (name, address, timezone)
   - POS terminal assignment

3. **Menu Management**
   - Create menu with categories
   - Add items with prices, descriptions, images
   - Menu publish/unpublish
   - Item availability (86 items)

4. **Order Management**
   - Order creation (dine-in only for MVP)
   - Add/remove items, modifiers
   - Order status tracking (pending → completed)
   - Basic order history

5. **Payment Processing**
   - Cash payments
   - Card payments (Stripe integration)
   - Basic receipt printing
   - Transaction logging

6. **Inventory Tracking**
   - Basic inventory counts
   - Manual stock updates
   - Low stock alerts
   - Simple reports

7. **Kitchen Display System (KDS)**
   - Basic kitchen screen showing orders
   - Mark items as done
   - Order ready notifications

8. **Subscription**
   - Trial tier activation (14 days)
   - Auto-expire trial
   - Feature gating for trial tier

**Tech Stack (MVP):**
```
Frontend: React (web), React Native (mobile)
Backend: Node.js + Express
Database: PostgreSQL
Cache: Redis
Auth: JWT
Payments: Stripe
Hosting: AWS EC2 + RDS
```

**Database Schema (MVP Core Tables):**
```sql
-- Users & Auth
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  role VARCHAR(50),
  created_at TIMESTAMP
);

-- Tenants (Cafes)
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  owner_id INT,
  subscription_tier VARCHAR(50),
  created_at TIMESTAMP
);

-- Branches
CREATE TABLE branches (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  name VARCHAR(255),
  address TEXT,
  timezone VARCHAR(50),
  created_at TIMESTAMP
);

-- Menu
CREATE TABLE menu_categories (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  name VARCHAR(255),
  display_order INT
);

CREATE TABLE menu_items (
  id SERIAL PRIMARY KEY,
  category_id INT,
  tenant_id INT,
  name VARCHAR(255),
  description TEXT,
  price INT,  -- in cents
  image_url VARCHAR(255),
  available BOOLEAN,
  created_at TIMESTAMP
);

-- Orders
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  branch_id INT,
  order_number VARCHAR(50),
  status VARCHAR(50),  -- pending, in_progress, completed
  created_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT,
  menu_item_id INT,
  quantity INT,
  unit_price INT,
  modifiers TEXT,  -- JSON
  status VARCHAR(50)  -- pending, ready
);

-- Payments
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  branch_id INT,
  order_id INT,
  amount INT,  -- in cents
  payment_method VARCHAR(50),  -- cash, card, etc
  stripe_transaction_id VARCHAR(255),
  status VARCHAR(50),  -- completed, failed
  created_at TIMESTAMP
);

-- Inventory
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  branch_id INT,
  product_name VARCHAR(255),
  quantity DECIMAL(10,2),
  unit VARCHAR(50),
  low_stock_threshold DECIMAL(10,2),
  last_updated TIMESTAMP
);

-- Subscriptions
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  tier VARCHAR(50),  -- trial, basic, pro, enterprise
  status VARCHAR(50),  -- active, expired, canceled
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP
);
```

---

### 🚀 PHASE 2: Multi-Role RBAC & Billing (Weeks 5-8)

**Goal:** Implement 4-role RBAC system, subscription billing (Stripe + Recurly), customer management.

**Deliverables:**

1. **Complete RBAC System**
   - 4 roles: SUPER_ADMIN, CAFE_OWNER, BRANCH_MANAGER, WAITER
   - Permission matrix implementation
   - Role assignment and management
   - Permission middleware

2. **Subscription Tiers**
   - All 4 tiers: Trial, Basic, Pro, Enterprise
   - Feature gating per tier
   - Usage limits tracking
   - Upgrade/downgrade flows

3. **Billing Integration**
   - Stripe integration for credit card processing
   - Recurring billing setup
   - Invoice generation
   - Payment failure handling
   - Billing dashboard for cafe owners

4. **Customer Management**
   - Customer database
   - Purchase history tracking
   - Customer profiles
   - Basic loyalty tracking

5. **Enhanced Reports**
   - Daily sales reports
   - Staff performance reports
   - Menu popularity reports
   - Inventory reports
   - Report export (CSV, PDF)

6. **Multi-Location (Pro tier)**
   - Multiple branches support
   - Central menu management
   - Cross-location inventory sync
   - Consolidated reporting

7. **Audit & Logging**
   - Comprehensive audit trail
   - User activity logging
   - Permission change logging
   - Data access logging

**New Database Tables:**
```sql
CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  permission_code VARCHAR(255),
  description TEXT
);

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(50),
  tenant_id INT,  -- NULL for platform roles
  created_at TIMESTAMP
);

CREATE TABLE role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INT,
  permission_id INT,
  UNIQUE(role_id, permission_id)
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  user_id INT,
  action VARCHAR(255),
  resource_type VARCHAR(100),
  resource_id INT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMP
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  branch_id INT,
  phone VARCHAR(20),
  email VARCHAR(255),
  created_at TIMESTAMP
);

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  subscription_id INT,
  stripe_invoice_id VARCHAR(255),
  amount INT,
  status VARCHAR(50),
  due_date DATE,
  created_at TIMESTAMP
);
```

---

### 💎 PHASE 3: Advanced Features (Weeks 9-12)

**Goal:** Loyalty programs, gift cards, mobile app, advanced analytics, offline mode.

**Deliverables:**

1. **Loyalty Program**
   - Points earning rules
   - Points redemption
   - Loyalty tiers
   - Automatic point tracking
   - Loyalty dashboard

2. **Gift Cards**
   - Digital gift cards
   - Balance tracking
   - Redemption tracking
   - Gift card reports

3. **Mobile Staff App**
   - iOS & Android app (React Native)
   - Staff login with PIN
   - View assigned orders/tables
   - Mark items complete
   - Clock in/out

4. **Advanced Analytics**
   - Sales trends
   - Customer segmentation
   - Product profitability analysis
   - Peak hours analysis
   - Staff productivity metrics
   - Predictive inventory

5. **Offline Mode**
   - Local data caching
   - Transaction queuing
   - Automatic sync on reconnect
   - Conflict resolution

6. **Integrations** (Pro tier+)
   - Delivery platforms (Uber Eats, DoorDash)
   - Accounting software (QuickBooks)
   - Email marketing
   - SMS notifications

7. **Advanced KDS**
   - Routing rules by item type
   - Station-based preparation
   - Expediter view
   - Time tracking per item
   - Priority ordering

8. **Multi-Location Management**
   - Centralized inventory across locations
   - Inventory transfers
   - Centralized menu
   - Cross-location customer data
   - Consolidated analytics

**New Database Tables:**
```sql
CREATE TABLE loyalty_programs (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  points_per_dollar DECIMAL(5,2),
  created_at TIMESTAMP
);

CREATE TABLE customer_loyalty (
  id SERIAL PRIMARY KEY,
  customer_id INT,
  points_balance INT,
  tier VARCHAR(50),  -- bronze, silver, gold
  created_at TIMESTAMP
);

CREATE TABLE gift_cards (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  card_number VARCHAR(255),
  initial_balance INT,
  current_balance INT,
  status VARCHAR(50),
  created_at TIMESTAMP
);

CREATE TABLE kds_routing_rules (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  menu_item_id INT,
  station_id INT,
  order_type VARCHAR(50),  -- dine-in, takeout, delivery
  priority INT
);

CREATE TABLE kds_stations (
  id SERIAL PRIMARY KEY,
  branch_id INT,
  station_name VARCHAR(100),
  station_type VARCHAR(50),  -- grill, fryer, prep, bar
  display_order INT
);
```

---

### 🏆 PHASE 4: Enterprise Features (Weeks 13-16)

**Goal:** Advanced security, compliance, custom integrations, AI features, white-label.

**Deliverables:**

1. **Enterprise Security**
   - Single Sign-On (SSO) / SAML
   - Advanced 2FA (Authy, Google Authenticator)
   - IP whitelisting
   - Advanced audit trails
   - Data encryption at rest and in transit

2. **Compliance & Certifications**
   - GDPR compliance
   - PCI DSS Level 1 compliance
   - SOC 2 Type II
   - Data residency options
   - Advanced backup and disaster recovery

3. **Custom Integrations**
   - Custom API development
   - Webhook support
   - Custom data exports
   - Third-party app marketplace

4. **White-Labeling**
   - Custom domain
   - Custom branding (logo, colors)
   - Custom email templates
   - Mobile app white-labeling

5. **AI-Powered Features**
   - Demand forecasting
   - Intelligent KDS routing
   - Automated inventory optimization
   - Churn prediction
   - Customer lifetime value prediction

6. **Advanced Analytics Engine**
   - Custom report builder
   - Real-time dashboards
   - Predictive analytics
   - Export to BI tools (Tableau, Power BI)
   - Data warehouse integration

7. **Dedicated Support**
   - 24/7 phone support
   - Dedicated account manager
   - Custom SLA
   - Training and onboarding

8. **API Rate Limits & Monitoring**
   - Unlimited API calls
   - Webhooks for real-time data
   - Developer dashboard
   - API analytics

---

## TECHNICAL STACK & DATABASE DESIGN {#technical-stack}

### Backend Architecture

```
┌─────────────────────────────────────┐
│        API Gateway (Express)        │
├──────────┬──────────┬───────┬──────┤
│  Auth    │  Orders  │ Menu  │ Other│
│  Service │  Service │Service│      │
└──────┬───┴────┬─────┴──┬────┴──┬───┘
       │        │        │       │
    ┌──────────────────────────┐
    │    Middleware Layer      │
    ├──────────────────────────┤
    │ • JWT Auth               │
    │ • RBAC Enforcement       │
    │ • Logging                │
    │ • Error Handling         │
    │ • Rate Limiting          │
    └─────────┬────────────────┘
              │
    ┌─────────────────────────┐
    │    Database Layer       │
    ├─────────────────────────┤
    │ • PostgreSQL (main)     │
    │ • Redis (cache/queue)   │
    │ • S3 (files)            │
    └─────────────────────────┘
```

### Microservices Design

**Split services for independent scaling:**

1. **Auth Service** - User registration, login, JWT tokens, 2FA
2. **Order Service** - Order creation, management, KDS updates
3. **Payment Service** - Stripe integration, transaction processing
4. **Inventory Service** - Stock tracking, updates, forecasting
5. **Menu Service** - Menu management, categorization, publishing
6. **Customer Service** - Customer profiles, loyalty, history
7. **Reporting Service** - Analytics, report generation
8. **Billing Service** - Subscription management, invoicing
9. **KDS Service** - Kitchen display coordination, routing

Each service:
- Has its own database (database per service pattern)
- Communicates via REST API
- Can scale independently
- Has API contracts defined

### Database Design (Complete Schema)

```sql
-- ============================================
-- MULTI-TENANCY & USERS
-- ============================================

CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  owner_id INT NOT NULL,
  subscription_tier VARCHAR(50) NOT NULL DEFAULT 'trial',
  subscription_status VARCHAR(50) DEFAULT 'active',
  trial_ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  full_name VARCHAR(255),
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL,  -- SUPER_ADMIN, CAFE_OWNER, BRANCH_MANAGER, WAITER
  branch_id INT,  -- NULL for CAFE_OWNER, set for BRANCH_MANAGER & WAITER
  status VARCHAR(50) DEFAULT 'active',  -- active, inactive, deleted
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_email (email)
);

CREATE TABLE user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code VARCHAR(255) NOT NULL,
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  granted_by_user_id INT,
  UNIQUE(user_id, permission_code)
);

-- ============================================
-- ROLES & PERMISSIONS
-- ============================================

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  tenant_id INT,  -- NULL for platform roles
  role_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, role_name)
);

CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  permission_code VARCHAR(255) UNIQUE NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resource_action (resource, action)
);

CREATE TABLE role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE(role_id, permission_id)
);

-- ============================================
-- BRANCHES / LOCATIONS
-- ============================================

CREATE TABLE branches (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_name VARCHAR(255) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  zip_code VARCHAR(20),
  phone VARCHAR(20),
  timezone VARCHAR(50),
  currency VARCHAR(3) DEFAULT 'USD',
  is_main_branch BOOLEAN DEFAULT false,
  manager_id INT REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  INDEX idx_tenant_id (tenant_id)
);

-- ============================================
-- MENU MANAGEMENT
-- ============================================

CREATE TABLE menu_categories (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(255),
  display_order INT,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_id_order (tenant_id, display_order)
);

CREATE TABLE menu_items (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES menu_categories(id),
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  price INT NOT NULL,  -- in cents
  cost_price INT,  -- for profitability
  image_url VARCHAR(255),
  is_available BOOLEAN DEFAULT true,
  display_order INT,
  tags VARCHAR(255),  -- vegetarian, gluten-free, etc
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_id_available (tenant_id, is_available)
);

CREATE TABLE menu_modifiers (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  menu_item_id INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  modifier_name VARCHAR(255) NOT NULL,
  modifier_type VARCHAR(50),  -- single_select, multi_select, text_input
  price_adjustment INT DEFAULT 0,  -- in cents (can be negative)
  display_order INT,
  is_required BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ORDERS & TRANSACTIONS
-- ============================================

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  branch_id INT NOT NULL REFERENCES branches(id),
  order_number VARCHAR(50) NOT NULL,
  order_type VARCHAR(50) NOT NULL,  -- dine-in, takeout, delivery
  dining_option VARCHAR(50),  -- table_number for dine-in
  customer_id INT REFERENCES users(id),
  order_status VARCHAR(50) DEFAULT 'pending',  -- pending, in_progress, ready, completed, canceled, refunded
  
  -- Amounts
  subtotal INT DEFAULT 0,  -- in cents
  tax_amount INT DEFAULT 0,
  discount_amount INT DEFAULT 0,
  total_amount INT DEFAULT 0,
  
  -- Payment
  payment_method VARCHAR(50),  -- cash, card, digital_wallet
  paid_at TIMESTAMP,
  payment_transaction_id INT,
  
  -- Timing
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_cooking_at TIMESTAMP,
  ready_at TIMESTAMP,
  served_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- Metadata
  special_instructions TEXT,
  created_by_user_id INT REFERENCES users(id),
  served_by_user_id INT REFERENCES users(id),
  
  deleted_at TIMESTAMP,
  INDEX idx_tenant_order_status (tenant_id, order_status),
  INDEX idx_branch_created (branch_id, created_at),
  INDEX idx_customer_id (customer_id)
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INT NOT NULL REFERENCES menu_items(id),
  quantity INT NOT NULL DEFAULT 1,
  unit_price INT NOT NULL,  -- price at time of order
  item_subtotal INT NOT NULL,  -- quantity * unit_price
  item_status VARCHAR(50) DEFAULT 'pending',  -- pending, in_progress, ready, served, canceled
  
  -- Modifiers (JSON)
  modifiers JSON DEFAULT '{}',
  special_instructions TEXT,
  
  -- KDS Info
  station_id INT,  -- for kitchen display
  prepared_by_user_id INT REFERENCES users(id),
  
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_id_status (order_id, item_status)
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  branch_id INT NOT NULL REFERENCES branches(id),
  order_id INT NOT NULL REFERENCES orders(id),
  
  -- Amount info
  amount INT NOT NULL,  -- in cents
  currency VARCHAR(3) DEFAULT 'USD',
  payment_method VARCHAR(50),  -- cash, stripe_card, apple_pay, google_pay, etc
  
  -- Payment Processing
  stripe_charge_id VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  authorization_code VARCHAR(255),
  
  -- Status
  transaction_status VARCHAR(50),  -- completed, pending, failed, refunded
  
  -- Refund info
  is_refunded BOOLEAN DEFAULT false,
  refund_amount INT,
  refund_reason VARCHAR(255),
  refund_initiated_by INT REFERENCES users(id),
  refunded_at TIMESTAMP,
  
  -- Metadata
  receipt_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_status (tenant_id, transaction_status),
  INDEX idx_stripe_charge (stripe_charge_id)
);

-- ============================================
-- INVENTORY MANAGEMENT
-- ============================================

CREATE TABLE inventory_items (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  branch_id INT NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  unit_type VARCHAR(50),  -- kg, liter, pcs, etc
  
  quantity_on_hand DECIMAL(10,2) NOT NULL DEFAULT 0,
  reorder_point DECIMAL(10,2),
  reorder_quantity DECIMAL(10,2),
  
  supplier_id INT,
  supplier_sku VARCHAR(100),
  
  cost_per_unit DECIMAL(10,2),
  
  last_counted TIMESTAMP,
  last_ordered TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_branch (tenant_id, branch_id),
  INDEX idx_low_stock (reorder_point, quantity_on_hand)
);

CREATE TABLE inventory_transactions (
  id SERIAL PRIMARY KEY,
  inventory_item_id INT NOT NULL REFERENCES inventory_items(id),
  transaction_type VARCHAR(50),  -- sale, restock, adjustment, transfer, waste
  quantity_change DECIMAL(10,2) NOT NULL,
  
  reference_id INT,  -- order_id for sales, transfer_id for transfers
  reason TEXT,
  
  recorded_by_user_id INT REFERENCES users(id),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_item_type_date (inventory_item_id, transaction_type, created_at)
);

-- ============================================
-- CUSTOMERS & LOYALTY
-- ============================================

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  phone VARCHAR(20),
  email VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  
  total_visits INT DEFAULT 0,
  total_spent INT DEFAULT 0,  -- in cents
  
  loyalty_tier VARCHAR(50),  -- bronze, silver, gold
  loyalty_points INT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  INDEX idx_tenant_phone (tenant_id, phone),
  INDEX idx_tenant_email (tenant_id, email)
);

CREATE TABLE customer_transactions (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  order_id INT NOT NULL REFERENCES orders(id),
  points_earned INT,
  points_redeemed INT,
  transaction_type VARCHAR(50),  -- order, points_earn, points_redeem
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE loyalty_programs (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  program_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  
  -- Points Settings
  points_per_dollar DECIMAL(5,2) DEFAULT 1,
  points_multiplier_special_items DECIMAL(5,2),
  
  -- Redemption
  points_per_discount INT,  -- e.g., 100 points = $5 off
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gift_cards (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  branch_id INT NOT NULL REFERENCES branches(id),
  gift_card_number VARCHAR(255) UNIQUE NOT NULL,
  initial_balance INT NOT NULL,  -- in cents
  current_balance INT NOT NULL,
  
  status VARCHAR(50),  -- active, used, expired
  
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  
  customer_id INT REFERENCES customers(id),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_number (tenant_id, gift_card_number),
  INDEX idx_status (status)
);

-- ============================================
-- SUBSCRIPTIONS & BILLING
-- ============================================

CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  
  tier VARCHAR(50) NOT NULL,  -- trial, basic, pro, enterprise
  status VARCHAR(50) NOT NULL,  -- active, past_due, canceled, expired
  billing_cycle VARCHAR(20),  -- monthly, annual
  
  -- Dates
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  renewal_date DATE,
  trial_ends_at TIMESTAMP,
  
  -- Billing
  price_paid_cents INT,
  currency VARCHAR(3) DEFAULT 'USD',
  billing_email VARCHAR(255),
  
  -- Stripe Integration
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),
  
  -- Payment Method
  payment_method_id VARCHAR(255),
  
  -- Metadata
  auto_renew BOOLEAN DEFAULT true,
  requires_payment_method BOOLEAN,
  canceled_at TIMESTAMP,
  cancellation_reason VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_stripe_customer (stripe_customer_id)
);

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  subscription_id INT REFERENCES subscriptions(id),
  
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  
  amount_cents INT NOT NULL,
  tax_cents INT DEFAULT 0,
  total_cents INT NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  
  status VARCHAR(50),  -- draft, sent, paid, failed, void
  
  issue_date DATE,
  due_date DATE,
  paid_date DATE,
  
  stripe_invoice_id VARCHAR(255),
  
  pdf_url VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_date (tenant_id, issue_date),
  INDEX idx_status (status)
);

-- ============================================
-- KITCHEN DISPLAY SYSTEM (KDS)
-- ============================================

CREATE TABLE kds_stations (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  station_name VARCHAR(100) NOT NULL,
  station_type VARCHAR(50),  -- grill, fryer, prep, bar, dessert, etc
  station_number INT,
  display_order INT,
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_branch_type (branch_id, station_type)
);

CREATE TABLE kds_routing_rules (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  menu_item_id INT NOT NULL REFERENCES menu_items(id),
  station_id INT NOT NULL REFERENCES kds_stations(id),
  
  -- Conditions
  order_type VARCHAR(50),  -- dine-in, takeout, delivery, or null for all
  
  priority INT DEFAULT 0,  -- higher = more urgent
  estimated_prep_time_minutes INT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(menu_item_id, station_id, order_type)
);

CREATE TABLE kds_tickets (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  station_id INT NOT NULL REFERENCES kds_stations(id),
  
  ticket_status VARCHAR(50),  -- pending, in_progress, complete
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  assigned_to_user_id INT REFERENCES users(id),
  completed_by_user_id INT REFERENCES users(id),
  
  INDEX idx_station_status (station_id, ticket_status)
);

-- ============================================
-- AUDIT & LOGGING
-- ============================================

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  user_id INT NOT NULL REFERENCES users(id),
  
  action VARCHAR(255) NOT NULL,  -- created, updated, deleted, etc
  resource_type VARCHAR(100) NOT NULL,  -- order, menu_item, user, etc
  resource_id INT,
  
  old_values TEXT,  -- JSON
  new_values TEXT,  -- JSON
  
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_created (tenant_id, created_at),
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_resource (resource_type, resource_id)
);

CREATE TABLE error_logs (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  user_id INT REFERENCES users(id),
  
  error_type VARCHAR(100),
  error_message TEXT,
  error_stack TEXT,
  
  request_url VARCHAR(255),
  request_method VARCHAR(10),
  
  ip_address VARCHAR(45),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_type (tenant_id, error_type, created_at)
);
```

---

## API SPECIFICATIONS {#api-specifications}

### Authentication Endpoints

```javascript
/**
 * POST /api/v1/auth/register
 * Register a new cafe owner (create new tenant)
 */
{
  request: {
    cafe_name: "My Coffee Shop",
    owner_email: "owner@email.com",
    password: "SecurePassword123",
    phone: "+1234567890",
    address: "123 Main St",
    timezone: "America/New_York"
  },
  response: {
    tenant_id: "abc123",
    subscription_id: "sub123",
    subscription_tier: "trial",
    trial_ends_at: "2026-01-21T11:46:00Z",
    auth_token: "eyJhbGc..."
  }
}

/**
 * POST /api/v1/auth/login
 * User login (any role)
 */
{
  request: {
    email: "user@email.com",
    password: "SecurePassword123",
    // OR for PIN login (waiter)
    pin: "1234"
  },
  response: {
    auth_token: "eyJhbGc...",
    user_id: 123,
    role: "BRANCH_MANAGER",
    tenant_id: "abc123",
    branch_id: 456,
    subscription_tier: "pro",
    permissions: ["orders.create", "orders.read", ...],
    expires_at: "2026-01-08T11:46:00Z"
  }
}

/**
 * POST /api/v1/auth/logout
 * Logout user
 */
{
  response: {
    success: true,
    message: "Logged out successfully"
  }
}

/**
 * POST /api/v1/auth/refresh-token
 * Refresh JWT token
 */
{
  response: {
    auth_token: "eyJhbGc...",
    expires_at: "2026-01-08T12:46:00Z"
  }
}
```

### Orders API

```javascript
/**
 * POST /api/v1/branches/{branchId}/orders
 * Create new order
 * PERMISSION: orders.create
 */
{
  request: {
    order_type: "dine-in",  // dine-in, takeout, delivery
    table_number: 5,  // for dine-in
    customer_id: 789,  // optional
    items: [
      {
        menu_item_id: 123,
        quantity: 2,
        modifiers: {
          modifier_id_1: "option_value",
          modifier_id_2: ["option1", "option2"]
        },
        special_instructions: "No onions"
      }
    ],
    special_instructions: "Allergic to nuts"
  },
  response: {
    order_id: 999,
    order_number: "ORD-001",
    order_type: "dine-in",
    status: "pending",
    subtotal_cents: 2500,
    tax_cents: 225,
    total_cents: 2725,
    created_at: "2026-01-07T11:46:00Z",
    items: [...]
  }
}

/**
 * GET /api/v1/branches/{branchId}/orders/{orderId}
 * Get single order details
 * PERMISSION: orders.read
 */
{
  response: {
    id: 999,
    order_number: "ORD-001",
    status: "in_progress",
    customer_id: 789,
    items: [
      {
        id: 111,
        menu_item_id: 123,
        quantity: 2,
        unit_price: 1250,
        item_status: "in_progress",
        station_id: 5,
        started_at: "2026-01-07T11:47:00Z"
      }
    ],
    timeline: {
      created_at: "2026-01-07T11:46:00Z",
      started_cooking_at: "2026-01-07T11:47:00Z",
      ready_at: null,
      served_at: null
    }
  }
}

/**
 * POST /api/v1/branches/{branchId}/orders/{orderId}/payment
 * Process payment for order
 * PERMISSION: payments.process
 */
{
  request: {
    payment_method: "card",  // cash, card, digital_wallet, loyalty
    amount_cents: 2725,
    currency: "USD",
    // For card:
    stripe_token: "tok_visa",
    // For loyalty:
    points_to_redeem: 50
  },
  response: {
    transaction_id: 555,
    payment_status: "completed",
    amount_charged_cents: 2725,
    payment_method: "card",
    authorization_code: "AUTH123456",
    receipt_url: "https://...",
    loyalty_points_earned: 27
  }
}
```

### Menu API

```javascript
/**
 * GET /api/v1/menus
 * Get current active menu
 * PERMISSION: menu.read
 */
{
  response: {
    menu_id: 123,
    categories: [
      {
        id: 1,
        name: "Coffee",
        items: [
          {
            id: 100,
            name: "Espresso",
            price_cents: 350,
            description: "Double shot",
            image_url: "https://...",
            available: true,
            modifiers: [
              {
                id: 501,
                name: "Size",
                type: "single_select",
                options: [
                  { name: "Small", price_adjustment: 0 },
                  { name: "Large", price_adjustment: 75 }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

/**
 * POST /api/v1/menus/items
 * Create menu item
 * PERMISSION: menu.create
 * ROLE: CAFE_OWNER+
 */
{
  request: {
    category_id: 1,
    name: "Latte",
    price_cents: 500,
    cost_price_cents: 150,
    description: "Espresso with steamed milk",
    image_file: "base64...",
    is_available: true,
    tags: ["coffee", "milk-based"]
  },
  response: {
    menu_item_id: 101,
    // ... full item object
  }
}
```

### Inventory API

```javascript
/**
 * GET /api/v1/branches/{branchId}/inventory
 * Get inventory items for branch
 * PERMISSION: inventory.read
 */
{
  response: {
    items: [
      {
        id: 201,
        item_name: "Espresso Beans",
        sku: "BEANS-ESP-001",
        quantity_on_hand: 15,
        unit_type: "kg",
        reorder_point: 5,
        cost_per_unit: 8.50,
        low_stock: false,
        last_counted: "2026-01-05T10:00:00Z"
      },
      {
        id: 202,
        item_name: "Whole Milk",
        sku: "MILK-WHOLE-001",
        quantity_on_hand: 3,
        unit_type: "liter",
        reorder_point: 10,
        cost_per_unit: 2.25,
        low_stock: true,
        alert_threshold_reached: true,
        last_counted: "2026-01-07T08:00:00Z"
      }
    ],
    low_stock_alerts: [
      {
        item_id: 202,
        item_name: "Whole Milk",
        current_quantity: 3,
        reorder_point: 10
      }
    ]
  }
}

/**
 * POST /api/v1/branches/{branchId}/inventory/{itemId}/adjust
 * Adjust inventory (sale, restock, waste, count)
 * PERMISSION: inventory.update
 */
{
  request: {
    transaction_type: "sale",  // sale, restock, adjustment, waste
    quantity_change: -1,  // negative for deduct, positive for add
    reason: "Sold in order ORD-001"
  },
  response: {
    inventory_transaction_id: 5001,
    item_id: 201,
    quantity_on_hand: 14,
    transaction_type: "sale",
    recorded_at: "2026-01-07T11:48:00Z"
  }
}
```

### Customer & Loyalty API

```javascript
/**
 * POST /api/v1/customers
 * Create new customer
 * PERMISSION: customers.create
 */
{
  request: {
    phone: "+1234567890",
    email: "customer@email.com",
    first_name: "John",
    last_name: "Doe"
  },
  response: {
    customer_id: 789,
    phone: "+1234567890",
    loyalty_points: 0,
    loyalty_tier: "bronze",
    created_at: "2026-01-07T11:48:00Z"
  }
}

/**
 * POST /api/v1/customers/{customerId}/loyalty-enroll
 * Enroll customer in loyalty program
 * PERMISSION: loyalty.manage
 */
{
  response: {
    customer_id: 789,
    loyalty_program_id: 1,
    enrolled_at: "2026-01-07T11:48:00Z",
    initial_points: 0
  }
}

/**
 * POST /api/v1/orders/{orderId}/apply-loyalty
 * Apply loyalty points discount to order
 * PERMISSION: payments.process
 */
{
  request: {
    customer_id: 789,
    points_to_redeem: 50
  },
  response: {
    points_redeemed: 50,
    discount_applied_cents: 500,
    remaining_points: 0,
    new_total: 2225  // 2725 - 500
  }
}
```

### KDS API

```javascript
/**
 * GET /api/v1/branches/{branchId}/kds/tickets
 * Get active KDS tickets
 * PERMISSION: kds.view
 */
{
  response: {
    tickets: [
      {
        ticket_id: 1001,
        order_number: "ORD-001",
        station_id: 5,
        station_name: "Grill",
        status: "pending",
        created_at: "2026-01-07T11:46:00Z",
        estimated_prep_time_minutes: 10,
        items: [
          {
            id: 111,
            name: "Burger",
            quantity: 2,
            special_instructions: "No onions",
            status: "pending"
          }
        ]
      }
    ]
  }
}

/**
 * POST /api/v1/branches/{branchId}/kds/tickets/{ticketId}/mark-complete
 * Mark ticket item as complete
 * PERMISSION: kds.update
 * ROLE: BRANCH_MANAGER, WAITER
 */
{
  request: {
    item_id: 111
  },
  response: {
    ticket_id: 1001,
    item_id: 111,
    status: "complete",
    completed_at: "2026-01-07T11:52:00Z"
  }
}
```

### Reports API

```javascript
/**
 * GET /api/v1/reports/sales?start_date=2026-01-01&end_date=2026-01-07
 * Get sales report
 * PERMISSION: reports.view
 * ROLE: CAFE_OWNER+
 */
{
  response: {
    period: {
      start_date: "2026-01-01",
      end_date: "2026-01-07"
    },
    summary: {
      total_orders: 245,
      total_revenue_cents: 125750,
      average_order_value_cents: 513,
      payment_breakdown: {
        cash: 45000,
        card: 80750
      }
    },
    hourly_breakdown: [
      {
        hour: 7,
        orders: 12,
        revenue: 5800,
        avg_order_value: 483
      }
    ],
    by_menu_item: [
      {
        item_name: "Espresso",
        quantity_sold: 89,
        revenue: 31150,
        cost: 13350,
        profit: 17800,
        profit_margin: 57.1
      }
    ]
  }
}

/**
 * POST /api/v1/reports/export
 * Export report as PDF/CSV
 * PERMISSION: reports.export
 */
{
  request: {
    report_type: "sales",  // sales, menu_performance, staff, inventory, financial
    format: "pdf",  // pdf, csv, excel
    start_date: "2026-01-01",
    end_date: "2026-01-07"
  },
  response: {
    file_url: "https://...",
    file_name: "sales_report_2026-01-01_to_2026-01-07.pdf",
    generated_at: "2026-01-07T11:50:00Z"
  }
}
```

### Subscription & Billing API

```javascript
/**
 * GET /api/v1/subscriptions/current
 * Get current subscription
 * PERMISSION: billing.read
 */
{
  response: {
    subscription_id: "sub123",
    tier: "basic",
    status: "active",
    billing_cycle: "monthly",
    start_date: "2025-12-24",
    renewal_date: "2026-01-24",
    price_monthly_cents: 4900,
    features: {
      core_pos: true,
      multi_location: false,
      loyalty_program: false,
      // ...
    },
    limits: {
      branches: 1,
      users: 5,
      transactions_per_month: 10000
    }
  }
}

/**
 * POST /api/v1/subscriptions/upgrade
 * Upgrade subscription tier
 * PERMISSION: billing.upgrade
 * ROLE: CAFE_OWNER
 */
{
  request: {
    new_tier: "pro"
  },
  response: {
    subscription_id: "sub123",
    old_tier: "basic",
    new_tier: "pro",
    effective_date: "2026-01-07",
    prorated_credit_cents: 2450,
    new_monthly_price_cents: 14900,
    next_billing_date: "2026-01-24"
  }
}

/**
 * GET /api/v1/invoices
 * Get invoices
 * PERMISSION: billing.read
 */
{
  response: {
    invoices: [
      {
        invoice_id: "INV-001",
        subscription_id: "sub123",
        issue_date: "2025-12-24",
        due_date: "2026-01-03",
        amount_cents: 4900,
        status: "paid",
        pdf_url: "https://...",
        paid_date: "2025-12-24"
      }
    ]
  }
}
```

---

## FEATURE SPECIFICATIONS BY PHASE {#feature-specifications}

### Phase 1: MVP - Core Features

**1. Order Creation & Management**
- Create dine-in orders only
- Add/remove items before payment
- See real-time menu
- Assign table number
- View order status in real-time

**2. Payment Processing**
- Cash payment
- Stripe card payment
- Receipt printing
- Transaction logging

**3. Menu Management**
- Admin: Create categories
- Admin: Add items with price, image
- Admin: Mark items as available/unavailable (86)
- POS: Display menu with real-time availability

**4. KDS (Basic)**
- Display orders on kitchen screen
- Mark items as done
- Display "Ready" alert when all items done

**5. Inventory (Basic)**
- Manual stock count
- Adjust after each sale
- Low stock warnings
- Basic inventory report

**6. Subscription**
- 14-day free trial
- Trial expiration reminder
- Upgrade prompt after trial

**7. Users**
- Admin registration
- Admin login
- PIN login for staff
- Single role: ADMIN (can do everything)

---

### Phase 2: RBAC & Billing - Complete Feature Set

**See Phases section above for full specifications**

---

### Phase 3 & 4: See Implementation Phases section

---

## CODE QUALITY & SAFETY GUIDELINES {#code-quality}

### 💻 Code Generation Rules

1. **No Pseudo-Code**
   - ❌ "// implement validation here"
   - ✅ Full working code with all validations

2. **Production-Grade Only**
   - All error handling
   - Input validation
   - Security checks
   - Logging

3. **Type Safety**
   - TypeScript for backend
   - Strict mode enabled
   - All types defined
   - No `any` types without justification

4. **No Hallucinations**
   - Don't invent APIs that don't exist
   - Don't invent libraries that don't exist
   - Only use real, documented packages
   - Check package versions

5. **Security First**
   - Sanitize all inputs
   - Use parameterized queries (SQL injection prevention)
   - Encrypt sensitive data
   - Hash passwords (bcrypt)
   - Validate permissions on every endpoint

6. **Performance**
   - Database indexes on frequently queried fields
   - Caching strategies (Redis)
   - Pagination for large datasets (limit 50 items)
   - N+1 query prevention

7. **Testing**
   - Unit tests for business logic
   - Integration tests for APIs
   - Security tests for authorization
   - At least 80% code coverage

8. **Documentation**
   - JSDoc comments for all functions
   - README with setup instructions
   - API documentation (Swagger/OpenAPI)
   - Database schema documentation

---

## AI INSTRUCTION RULES {#ai-instruction-rules}

### 🤖 How to Use This Prompt

**IMPORTANT: Copy-paste this entire document when asking AI to implement.**

#### Example Usage

```markdown
# POS SYSTEM REDESIGN - COMPLETE AI ENGINEERING PROMPT

[Copy entire prompt]

---

## IMPLEMENTATION REQUEST

**Phase:** 1 (MVP)
**Module:** Authentication Service
**Task:** Implement user registration and login endpoints

**Specific Instructions:**
- Use TypeScript + Node.js
- Implement JWT authentication
- Hash passwords with bcrypt
- Add comprehensive error handling
- Include unit tests
- Follow the database schema provided above
- Ensure all security best practices

---

## CONTEXT

[Provide any specific files or code they should build upon]
```

### 💡 How AI Will Use This Prompt

The AI will:
1. **Analyze** the complete architecture and understand your system
2. **Extract** the relevant specifications for the requested task
3. **Generate** complete, production-grade code
4. **Cross-reference** permissions, database schema, API specs
5. **Prevent** hallucinations by strictly following defined specs
6. **Test** code against the provided requirements

### ⚠️ Common Pitfalls to Avoid

When asking AI to implement:

❌ **Too Vague**
```
"Build the POS system"
```

✅ **Specific**
```
"Phase 1, Module: Order Service
Task: Implement POST /api/v1/branches/{branchId}/orders endpoint
with complete validation, permission checks, and unit tests.
Reference the orders API spec in section API-SPECIFICATIONS"
```

❌ **Missing Context**
```
"Add role-based access control"
```

✅ **With Context**
```
"Implement RBAC middleware for the 4 roles defined in RBAC-SYSTEM section.
Use the permission matrix provided.
Protect all endpoints with checkPermission() middleware.
Include audit logging for all permission denials."
```

❌ **Unrealistic**
```
"Build entire system in one request"
```

✅ **Phased**
```
"Phase 1 / Module: Authentication
Task: Implement user registration, JWT login, and password reset.
Files to create: auth.service.ts, auth.controller.ts, auth.test.ts"
```

### 🎯 Best Practice Workflow

**1. Copy This Entire Prompt**

**2. Add Your Specific Request**
```markdown
[Paste entire prompt above]

---

## MY IMPLEMENTATION REQUEST

**Project Phase:** 2
**Module:** RBAC Middleware
**Task:** Implement permission checking middleware

**Specific Instructions:**
- Add to src/middleware/rbac.middleware.ts
- Check tenant scope, location scope, and specific permissions
- Return 403 Forbidden with clear error messages
- Log all denied attempts to audit_logs table
- Support feature gating based on subscription tier
- Reference: RBAC-SYSTEM section, checkPermission pseudo-code
```

**3. Attach Your Current Code** (if building on existing)

**4. Provide Screenshots/Context** (if needed)

**5. Ask Specific Questions**
- "How should offline sync handle conflicts when X?"
- "Should refunds require manager approval? (per business logic?)"
- "What's the best caching strategy for menu data?"

### 📝 Prompt Maintenance

**Update this prompt when:**
- Adding new roles
- Adding new features
- Changing subscription tiers
- Updating API contracts
- Refining business logic

**Keep sections in sync:**
- RBAC matrix ↔ Permission middleware
- API specs ↔ Database schema
- Subscription tiers ↔ Feature gates
- Phases ↔ Feature list

---

## QUICK REFERENCE

### File Structure
```
/src
  /api
    /routes
      auth.routes.ts
      orders.routes.ts
      menu.routes.ts
      ...
    /controllers
      auth.controller.ts
      orders.controller.ts
      ...
    /services
      auth.service.ts
      orders.service.ts
      ...
  /middleware
    auth.middleware.ts
    rbac.middleware.ts
    error.middleware.ts
  /models
    user.model.ts
    order.model.ts
    ...
  /utils
    jwt.utils.ts
    encryption.utils.ts
    ...
  /tests
    /unit
      auth.service.test.ts
      ...
    /integration
      auth.api.test.ts
      ...
  app.ts
  server.ts
/database
  /migrations
    001_create_users.sql
    ...
  /seeds
    seed.sql
```

### Environment Variables
```
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@localhost/pos_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RECURLY_API_KEY=...
AWS_S3_BUCKET=pos-system-bucket
AWS_REGION=us-east-1
SENDGRID_API_KEY=...
LOG_LEVEL=info
```

### Key NPM Packages
```
// Backend
express 4.x
typescript
jsonwebtoken
bcrypt
pg (PostgreSQL)
redis
stripe
joi (validation)
winston (logging)
jest (testing)

// Frontend
react 18.x
react-router-dom
axios
zustand (state management)
tailwindcss
recharts (charts)
```

---

## SUCCESS CRITERIA

✅ **System is complete when:**

1. All 4 phases implemented
2. All role permissions enforced
3. All subscription tiers feature-gated
4. 80%+ test coverage
5. Zero security vulnerabilities
6. API documentation complete
7. Database optimized (indexes, relationships)
8. Offline mode working
9. All integrations functional
10. Audit logging comprehensive
11. Production deployment ready
12. Disaster recovery tested

---

**Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Ready for Implementation  
**Maintainer:** Senior Engineering Team

---

## FINAL NOTES TO AI

When implementing based on this prompt:

1. **Preserve Structure** - Keep the architecture layers as defined
2. **Enforce Security** - Never skip authorization checks
3. **Maintain Consistency** - All code follows patterns established in phase 1
4. **Document Everything** - Every function, endpoint, table has documentation
5. **Test Thoroughly** - Every feature has unit + integration tests
6. **Handle Errors** - Every error path is logged and handled gracefully
7. **Optimize Queries** - Use indexes, avoid N+1, paginate large datasets
8. **Plan for Scale** - Design for multi-tenant, high-transaction load
9. **Stay Current** - Use latest stable versions of libraries
10. **Ask Questions** - If something is ambiguous, ask for clarification rather than assume

---

**Ready to build? Let's create production-grade software.**
```

