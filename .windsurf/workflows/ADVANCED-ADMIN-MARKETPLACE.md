# 🏢 ADVANCED ADMIN PANEL & INTEGRATION MARKETPLACE GUIDE
## Enterprise Multi-Tenant SaaS Admin System

**Status:** ✅ ENTERPRISE-GRADE SPECIFICATION  
**Based on:** Shopify, Stripe Connect, Chargebee, Zapier  
**Implementation Time:** 4-6 weeks  
**Difficulty:** Advanced+  

---

# 🎯 EXECUTIVE OVERVIEW: WHAT YOU'RE BUILDING

Your platform will become a **marketplace for integrations** where:

**For Super Admins (You):**
- 📊 Dashboard showing all tenants, revenue, usage
- 🔧 One-click tenant onboarding with automatic configuration
- 💳 Manage payment gateway integrations (Chapa, Stripe, PayPal)
- 🛠️ Manage add-ons & feature packages
- 👥 Control tenant access levels & feature availability
- 📈 Revenue analytics and reporting

**For Tenant Admins (Your Customers):**
- 🔐 Secure dashboard for their organization
- 💰 Enable/disable payment methods specific to their needs
- 🔌 Connect their own payment provider (Stripe, Chapa)
- 📋 Subscribe to add-ons that enhance their POS
- 👤 Team management with role-based access
- 📊 Usage analytics for their restaurant

---

# PHASE 1: SUPER ADMIN DASHBOARD ARCHITECTURE

## 1.1 Database Schema Extensions

### Add to PostgreSQL

```sql
-- ============================================
-- SUPER ADMIN: Tenant Management
-- ============================================

CREATE TABLE tenants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(100) UNIQUE NOT NULL,
  tenant_name VARCHAR(255) NOT NULL,
  tenant_type ENUM ('free', 'starter', 'pro', 'enterprise') DEFAULT 'free',
  
  -- Subscription Info
  subscription_plan VARCHAR(50),
  subscription_status ENUM ('active', 'paused', 'canceled', 'trial') DEFAULT 'trial',
  subscription_started_at TIMESTAMP,
  subscription_ends_at TIMESTAMP,
  
  -- Contact Info
  primary_email VARCHAR(255) NOT NULL,
  primary_phone VARCHAR(20),
  
  -- Organization
  country_code VARCHAR(2) DEFAULT 'ET',
  currency VARCHAR(3) DEFAULT 'ETB',
  timezone VARCHAR(50) DEFAULT 'Africa/Addis_Ababa',
  
  -- Platform Settings
  features_enabled JSONB DEFAULT '{
    "mobile_payments": true,
    "inventory": false,
    "analytics": false,
    "team_management": false,
    "api_access": false
  }',
  
  -- Billing
  monthly_revenue_cents BIGINT DEFAULT 0,
  total_transactions BIGINT DEFAULT 0,
  
  -- Admin Notes
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_subscription_status (subscription_status),
  INDEX idx_tenant_type (tenant_type)
);

-- ============================================
-- SUPER ADMIN: Payment Gateway Integrations
-- Configuration per gateway that can be assigned to tenants
-- ============================================

CREATE TABLE payment_gateway_integrations (
  id BIGSERIAL PRIMARY KEY,
  super_admin_id BIGINT NOT NULL, -- Who created this
  
  -- Gateway Type
  gateway_name VARCHAR(50) NOT NULL, -- 'chapa', 'stripe', 'paypal', 'flutterwave'
  gateway_type ENUM ('mobile_money', 'card', 'bank_transfer', 'wallet') NOT NULL,
  
  -- API Credentials (ENCRYPTED)
  api_key_encrypted VARCHAR(500),
  secret_key_encrypted VARCHAR(500),
  merchant_id_encrypted VARCHAR(500),
  webhook_secret_encrypted VARCHAR(500),
  
  -- Configuration
  is_production BOOLEAN DEFAULT FALSE,
  is_enabled BOOLEAN DEFAULT TRUE,
  commission_percentage DECIMAL(5,2) DEFAULT 0,
  min_transaction_amount_cents BIGINT,
  max_transaction_amount_cents BIGINT,
  
  -- Features
  supports_refund BOOLEAN DEFAULT TRUE,
  supports_split_payment BOOLEAN DEFAULT FALSE,
  supports_recurring BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_gateway_name (gateway_name),
  INDEX idx_is_production (is_production)
);

-- ============================================
-- SUPER ADMIN: Gateway to Tenant Assignment
-- Which gateways are available to which tenants
-- ============================================

CREATE TABLE tenant_gateway_assignments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  gateway_integration_id BIGINT REFERENCES payment_gateway_integrations(id),
  
  -- Tenant's own credentials (encrypted) - optional
  -- If provided, tenant uses their own credentials instead of super admin's
  tenant_api_key_encrypted VARCHAR(500),
  tenant_secret_key_encrypted VARCHAR(500),
  
  -- Availability
  is_enabled BOOLEAN DEFAULT TRUE,
  is_visible_to_tenant BOOLEAN DEFAULT TRUE,
  
  -- Limits for this tenant
  daily_transaction_limit_cents BIGINT,
  monthly_transaction_limit_cents BIGINT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(tenant_id, gateway_integration_id),
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_is_enabled (is_enabled)
);

-- ============================================
-- SUPER ADMIN: Add-ons & Feature Packages
-- Purchasable items that tenants can add to their plan
-- ============================================

CREATE TABLE addon_packages (
  id BIGSERIAL PRIMARY KEY,
  
  -- Package Info
  addon_code VARCHAR(100) UNIQUE NOT NULL, -- 'advanced_analytics', 'team_management'
  addon_name VARCHAR(255) NOT NULL,
  addon_description TEXT,
  addon_category VARCHAR(50), -- 'analytics', 'team', 'payments', 'reporting'
  
  -- Pricing
  price_monthly_cents BIGINT NOT NULL,
  price_yearly_cents BIGINT,
  setup_fee_cents BIGINT DEFAULT 0,
  
  -- Features this addon provides
  features JSONB DEFAULT '{}', -- {'analytics': true, 'reports': true}
  feature_limits JSONB DEFAULT '{}', -- {'api_calls_per_day': 10000}
  
  -- Availability
  is_available BOOLEAN DEFAULT TRUE,
  availability_tier ENUM ('all', 'pro', 'enterprise') DEFAULT 'all',
  
  -- Configuration
  max_instances_per_tenant INT DEFAULT 1,
  requires_approval BOOLEAN DEFAULT FALSE,
  documentation_url VARCHAR(500),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_addon_code (addon_code),
  INDEX idx_is_available (is_available)
);

-- ============================================
-- SUPER ADMIN: Tenant's Active Add-ons
-- Tracks what add-ons each tenant has purchased
-- ============================================

CREATE TABLE tenant_addon_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  addon_id BIGINT REFERENCES addon_packages(id),
  
  -- Billing
  activation_date DATE NOT NULL,
  cancellation_date DATE,
  next_renewal_date DATE,
  
  -- Payment Info
  billing_frequency ENUM ('monthly', 'yearly') DEFAULT 'monthly',
  price_paid_cents BIGINT,
  payment_status ENUM ('active', 'past_due', 'canceled') DEFAULT 'active',
  
  -- Usage
  times_used BIGINT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(tenant_id, addon_id),
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_next_renewal (next_renewal_date)
);

-- ============================================
-- SUPER ADMIN: Integration Marketplace Listings
-- Third-party apps/integrations tenants can install
-- ============================================

CREATE TABLE integrations_marketplace (
  id BIGSERIAL PRIMARY KEY,
  
  -- Publisher Info
  publisher_name VARCHAR(255) NOT NULL,
  publisher_id BIGINT, -- Can be NULL for official integrations
  
  -- Integration Details
  integration_code VARCHAR(100) UNIQUE NOT NULL, -- 'zapier_connector', 'google_sheets'
  integration_name VARCHAR(255) NOT NULL,
  integration_description TEXT,
  
  -- Integration Type
  integration_type ENUM ('webhook', 'oauth', 'api_key', 'embedded', 'webhook_listener') DEFAULT 'api_key',
  category VARCHAR(100), -- 'accounting', 'inventory', 'crm', 'marketing'
  
  -- Metadata
  logo_url VARCHAR(500),
  documentation_url VARCHAR(500),
  support_email VARCHAR(255),
  support_url VARCHAR(500),
  
  -- Requirements
  required_plan VARCHAR(50), -- 'all', 'pro', 'enterprise'
  required_addons JSONB DEFAULT '[]', -- ['advanced_analytics']
  
  -- Rating & Reviews
  average_rating DECIMAL(3,2),
  review_count INT DEFAULT 0,
  
  -- Pricing (if integration costs money)
  pricing_model ENUM ('free', 'one_time', 'monthly', 'per_use') DEFAULT 'free',
  price_cents BIGINT,
  
  -- Status
  status ENUM ('draft', 'published', 'deprecated', 'archived') DEFAULT 'draft',
  published_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_integration_code (integration_code),
  INDEX idx_status (status),
  INDEX idx_category (category)
);

-- ============================================
-- SUPER ADMIN: Tenant's Installed Integrations
-- Which integrations each tenant has active
-- ============================================

CREATE TABLE tenant_integrations_installed (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  integration_id BIGINT REFERENCES integrations_marketplace(id),
  
  -- Installation Status
  installation_status ENUM ('installing', 'active', 'paused', 'error', 'uninstalled') DEFAULT 'active',
  installed_at TIMESTAMP DEFAULT NOW(),
  uninstalled_at TIMESTAMP,
  
  -- Configuration
  custom_config JSONB DEFAULT '{}', -- Integration-specific settings
  
  -- Credentials
  oauth_token_encrypted VARCHAR(500), -- For OAuth integrations
  api_key_encrypted VARCHAR(500), -- For API key integrations
  webhook_url_encrypted VARCHAR(500), -- Webhook endpoint
  
  -- Usage
  last_sync_at TIMESTAMP,
  sync_count BIGINT DEFAULT 0,
  last_error TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(tenant_id, integration_id),
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_installation_status (installation_status)
);

-- ============================================
-- SUPER ADMIN: Admin Action Audit Log
-- Track all changes made by super admin
-- ============================================

CREATE TABLE super_admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  super_admin_id BIGINT NOT NULL,
  
  -- What happened
  action_type VARCHAR(100), -- 'tenant_created', 'gateway_configured', 'addon_assigned'
  resource_type VARCHAR(50), -- 'tenant', 'integration', 'addon'
  resource_id BIGINT,
  resource_name VARCHAR(255),
  
  -- Details
  old_values JSONB,
  new_values JSONB,
  changes_summary TEXT,
  
  -- IP & Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_super_admin_id (super_admin_id),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at)
);

-- ============================================
-- SUPER ADMIN: Settings & Platform Configuration
-- Global settings for the entire platform
-- ============================================

CREATE TABLE platform_settings (
  id BIGSERIAL PRIMARY KEY,
  
  -- Platform Metadata
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value JSONB,
  
  -- Metadata
  category VARCHAR(50), -- 'billing', 'security', 'integration', 'feature'
  is_public BOOLEAN DEFAULT FALSE,
  
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by BIGINT,
  
  INDEX idx_setting_key (setting_key)
);

-- ============================================
-- Indices for Performance
-- ============================================

CREATE INDEX idx_tenants_subscription_status ON tenants(subscription_status, updated_at);
CREATE INDEX idx_tenants_created_at ON tenants(created_at DESC);
CREATE INDEX idx_addon_subscriptions_renewal ON tenant_addon_subscriptions(next_renewal_date, payment_status);
```

---

## 1.2 Core Super Admin Service

### Create: `src/services/super-admin.service.ts`

```typescript
/**
 * Super Admin Service
 * Handles all super admin operations: tenant management, integrations, add-ons
 */

import { Pool } from 'pg';
import crypto from 'crypto';

interface CreateTenantRequest {
  tenant_name: string;
  primary_email: string;
  tenant_type: 'free' | 'starter' | 'pro' | 'enterprise';
  country_code: string;
  currency: string;
}

interface PaymentGatewayConfig {
  gateway_name: string;
  api_key: string;
  secret_key: string;
  is_production: boolean;
}

export class SuperAdminService {
  constructor(private db: Pool) {}

  // ============================================================
  // TENANT MANAGEMENT
  // ============================================================

  /**
   * Create new tenant with automatic configuration
   * One click onboarding for new customers
   */
  async createTenant(superAdminId: number, request: CreateTenantRequest) {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Generate unique tenant_id
      const tenantId = this.generateTenantId(request.tenant_name);

      // 1. Create tenant record
      const tenantResult = await client.query(
        `INSERT INTO tenants (
          tenant_id, tenant_name, primary_email, tenant_type,
          country_code, currency, features_enabled, subscription_status,
          subscription_started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING id, tenant_id`,
        [
          tenantId,
          request.tenant_name,
          request.primary_email,
          request.tenant_type,
          request.country_code,
          request.currency,
          JSON.stringify(this.getDefaultFeaturesForTier(request.tenant_type)),
          request.tenant_type === 'free' ? 'trial' : 'active'
        ]
      );

      const newTenant = tenantResult.rows[0];

      // 2. Create tenant database (optional: schema per tenant)
      // For now, using shared DB with tenant_id
      // await this.createTenantSchema(client, newTenant.tenant_id);

      // 3. Assign default payment gateways based on tier
      await this.assignDefaultGateways(client, newTenant.id, request.tenant_type);

      // 4. Create tenant admin user
      // const adminUser = await this.createTenantAdminUser(client, newTenant.id, request.primary_email);

      // 5. Log action
      await this.logSuperAdminAction(client, superAdminId, 'tenant_created', 'tenant', newTenant.id, {
        tenant_name: request.tenant_name,
        tenant_type: request.tenant_type
      });

      await client.query('COMMIT');

      console.log(`✅ Tenant created: ${newTenant.tenant_id}`);

      return {
        success: true,
        tenant_id: newTenant.tenant_id,
        tenant_name: request.tenant_name,
        status: request.tenant_type === 'free' ? 'trial' : 'active'
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get tenant details
   */
  async getTenant(tenantId: string) {
    const result = await this.db.query(
      `SELECT * FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    const tenant = result.rows[0];

    // Get active payment gateways
    const gatewaysResult = await this.db.query(
      `SELECT pgi.*, tga.is_enabled
       FROM tenant_gateway_assignments tga
       JOIN payment_gateway_integrations pgi ON pgi.id = tga.gateway_integration_id
       WHERE tga.tenant_id = $1 AND tga.is_enabled = true`,
      [tenant.id]
    );

    // Get active add-ons
    const addonsResult = await this.db.query(
      `SELECT ap.*, tas.next_renewal_date
       FROM tenant_addon_subscriptions tas
       JOIN addon_packages ap ON ap.id = tas.addon_id
       WHERE tas.tenant_id = $1 AND tas.payment_status = 'active'`,
      [tenant.id]
    );

    return {
      ...tenant,
      active_gateways: gatewaysResult.rows,
      active_addons: addonsResult.rows
    };
  }

  /**
   * List all tenants with pagination and filters
   */
  async listTenants(
    page = 1,
    limit = 50,
    filters?: {
      subscription_status?: string;
      tenant_type?: string;
      country_code?: string;
      search?: string;
    }
  ) {
    let query = 'SELECT * FROM tenants WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (filters?.subscription_status) {
      query += ` AND subscription_status = $${paramCount}`;
      params.push(filters.subscription_status);
      paramCount++;
    }

    if (filters?.tenant_type) {
      query += ` AND tenant_type = $${paramCount}`;
      params.push(filters.tenant_type);
      paramCount++;
    }

    if (filters?.country_code) {
      query += ` AND country_code = $${paramCount}`;
      params.push(filters.country_code);
      paramCount++;
    }

    if (filters?.search) {
      query += ` AND (tenant_name ILIKE $${paramCount} OR primary_email ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, (page - 1) * limit);

    const result = await this.db.query(query, params);

    // Get total count
    const countResult = await this.db.query(
      'SELECT COUNT(*) as total FROM tenants'
    );

    return {
      tenants: result.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      pages: Math.ceil(countResult.rows[0].total / limit)
    };
  }

  /**
   * Update tenant subscription status
   */
  async updateTenantSubscription(
    superAdminId: number,
    tenantId: string,
    update: {
      subscription_status?: 'active' | 'paused' | 'canceled' | 'trial';
      subscription_plan?: string;
      subscription_ends_at?: Date;
    }
  ) {
    const oldData = await this.getTenant(tenantId);

    const result = await this.db.query(
      `UPDATE tenants
       SET subscription_status = COALESCE($1, subscription_status),
           subscription_plan = COALESCE($2, subscription_plan),
           subscription_ends_at = COALESCE($3, subscription_ends_at),
           updated_at = NOW()
       WHERE tenant_id = $4
       RETURNING *`,
      [
        update.subscription_status,
        update.subscription_plan,
        update.subscription_ends_at,
        tenantId
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    // Log action
    await this.logSuperAdminAction(superAdminId, 'tenant_updated', 'tenant', oldData.id, oldData, result.rows[0]);

    return result.rows[0];
  }

  // ============================================================
  // PAYMENT GATEWAY CONFIGURATION
  // ============================================================

  /**
   * Register new payment gateway integration
   * Super admin configures Chapa, Stripe, PayPal etc credentials once
   * Then can assign to multiple tenants
   */
  async configurePaymentGateway(
    superAdminId: number,
    config: PaymentGatewayConfig & {
      merchant_id?: string;
      webhook_secret?: string;
    }
  ) {
    // Encrypt sensitive data
    const apiKeyEncrypted = this.encryptSecret(config.api_key);
    const secretKeyEncrypted = this.encryptSecret(config.secret_key);
    const merchantIdEncrypted = config.merchant_id ? this.encryptSecret(config.merchant_id) : null;
    const webhookSecretEncrypted = config.webhook_secret ? this.encryptSecret(config.webhook_secret) : null;

    const result = await this.db.query(
      `INSERT INTO payment_gateway_integrations (
        super_admin_id, gateway_name, api_key_encrypted, secret_key_encrypted,
        merchant_id_encrypted, webhook_secret_encrypted, is_production
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, gateway_name`,
      [
        superAdminId,
        config.gateway_name,
        apiKeyEncrypted,
        secretKeyEncrypted,
        merchantIdEncrypted,
        webhookSecretEncrypted,
        config.is_production
      ]
    );

    // Log action
    await this.logSuperAdminAction(superAdminId, 'gateway_configured', 'integration', result.rows[0].id, {
      gateway_name: config.gateway_name
    });

    console.log(`✅ Gateway configured: ${config.gateway_name}`);

    return result.rows[0];
  }

  /**
   * Assign payment gateway to tenant
   * Makes a gateway available to a specific tenant
   */
  async assignGatewayToTenant(
    superAdminId: number,
    tenantId: string,
    gatewayIntegrationId: number,
    options?: {
      is_enabled?: boolean;
      daily_limit_cents?: number;
      monthly_limit_cents?: number;
    }
  ) {
    // Get tenant
    const tenant = await this.getTenant(tenantId);

    // Assign gateway
    const result = await this.db.query(
      `INSERT INTO tenant_gateway_assignments (
        tenant_id, gateway_integration_id, is_enabled,
        daily_transaction_limit_cents, monthly_transaction_limit_cents
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, gateway_integration_id) 
      DO UPDATE SET is_enabled = EXCLUDED.is_enabled
      RETURNING id`,
      [
        tenant.id,
        gatewayIntegrationId,
        options?.is_enabled ?? true,
        options?.daily_limit_cents,
        options?.monthly_limit_cents
      ]
    );

    // Log action
    await this.logSuperAdminAction(superAdminId, 'gateway_assigned_to_tenant', 'assignment', result.rows[0].id, {
      tenant_id: tenantId,
      gateway_integration_id: gatewayIntegrationId
    });

    return result.rows[0];
  }

  /**
   * Get gateway configuration for display
   * Returns decrypted credentials (ONLY in secure context)
   */
  async getGatewayConfig(gatewayId: number) {
    const result = await this.db.query(
      `SELECT * FROM payment_gateway_integrations WHERE id = $1`,
      [gatewayId]
    );

    if (result.rows.length === 0) {
      throw new Error('Gateway not found');
    }

    const gateway = result.rows[0];

    // Decrypt secrets (use with caution - only for admin UI with extra auth)
    return {
      id: gateway.id,
      gateway_name: gateway.gateway_name,
      is_production: gateway.is_production,
      // Only return masked keys in normal views
      api_key_masked: `${gateway.api_key_encrypted.substring(0, 10)}...`,
      secret_key_masked: `${gateway.secret_key_encrypted.substring(0, 10)}...`
    };
  }

  // ============================================================
  // ADD-ONS MANAGEMENT
  // ============================================================

  /**
   * Create new add-on package
   */
  async createAddon(
    superAdminId: number,
    addon: {
      addon_code: string;
      addon_name: string;
      addon_description: string;
      addon_category: string;
      price_monthly_cents: number;
      price_yearly_cents?: number;
      features: Record<string, boolean>;
      availability_tier: 'all' | 'pro' | 'enterprise';
    }
  ) {
    const result = await this.db.query(
      `INSERT INTO addon_packages (
        addon_code, addon_name, addon_description, addon_category,
        price_monthly_cents, price_yearly_cents, features, availability_tier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, addon_code`,
      [
        addon.addon_code,
        addon.addon_name,
        addon.addon_description,
        addon.addon_category,
        addon.price_monthly_cents,
        addon.price_yearly_cents,
        JSON.stringify(addon.features),
        addon.availability_tier
      ]
    );

    // Log action
    await this.logSuperAdminAction(superAdminId, 'addon_created', 'addon', result.rows[0].id, addon);

    return result.rows[0];
  }

  /**
   * Assign add-on to tenant
   */
  async assignAddonToTenant(
    superAdminId: number,
    tenantId: string,
    addonId: number,
    billingFrequency: 'monthly' | 'yearly' = 'monthly'
  ) {
    // Get addon price
    const addonResult = await this.db.query(
      `SELECT ${billingFrequency === 'yearly' ? 'price_yearly_cents' : 'price_monthly_cents'} as price
       FROM addon_packages WHERE id = $1`,
      [addonId]
    );

    if (addonResult.rows.length === 0) {
      throw new Error('Add-on not found');
    }

    const price = addonResult.rows[0].price;

    // Get tenant
    const tenant = await this.getTenant(tenantId);

    // Check if already assigned
    const existingResult = await this.db.query(
      `SELECT id FROM tenant_addon_subscriptions WHERE tenant_id = $1 AND addon_id = $2`,
      [tenant.id, addonId]
    );

    if (existingResult.rows.length > 0) {
      throw new Error('Add-on already assigned to this tenant');
    }

    // Calculate renewal date
    const activationDate = new Date();
    const renewalDate = new Date();
    if (billingFrequency === 'yearly') {
      renewalDate.setFullYear(renewalDate.getFullYear() + 1);
    } else {
      renewalDate.setMonth(renewalDate.getMonth() + 1);
    }

    const result = await this.db.query(
      `INSERT INTO tenant_addon_subscriptions (
        tenant_id, addon_id, billing_frequency, price_paid_cents,
        activation_date, next_renewal_date, payment_status
      ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'active')
      RETURNING id`,
      [
        tenant.id,
        addonId,
        billingFrequency,
        price,
        renewalDate.toISOString().split('T')[0]
      ]
    );

    // Log action
    await this.logSuperAdminAction(superAdminId, 'addon_assigned', 'addon_subscription', result.rows[0].id, {
      tenant_id: tenantId,
      addon_id: addonId,
      billing_frequency: billingFrequency
    });

    return result.rows[0];
  }

  // ============================================================
  // INTEGRATIONS MARKETPLACE
  // ============================================================

  /**
   * Create marketplace integration listing
   * Third-party apps that tenants can connect
   */
  async createIntegrationListing(
    superAdminId: number,
    integration: {
      integration_code: string;
      integration_name: string;
      integration_description: string;
      integration_type: 'webhook' | 'oauth' | 'api_key' | 'embedded';
      category: string;
      logo_url?: string;
      documentation_url?: string;
      required_plan?: string;
    }
  ) {
    const result = await this.db.query(
      `INSERT INTO integrations_marketplace (
        publisher_name, integration_code, integration_name,
        integration_description, integration_type, category,
        logo_url, documentation_url, required_plan, status, published_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', NOW())
      RETURNING id, integration_code`,
      [
        'Platform Team',
        integration.integration_code,
        integration.integration_name,
        integration.integration_description,
        integration.integration_type,
        integration.category,
        integration.logo_url || null,
        integration.documentation_url || null,
        integration.required_plan || 'all'
      ]
    );

    // Log action
    await this.logSuperAdminAction(superAdminId, 'integration_created', 'integration', result.rows[0].id, integration);

    return result.rows[0];
  }

  /**
   * Install integration for tenant
   */
  async installIntegrationForTenant(
    tenantId: string,
    integrationId: number,
    config?: Record<string, any>
  ) {
    const tenant = await this.getTenant(tenantId);

    const result = await this.db.query(
      `INSERT INTO tenant_integrations_installed (
        tenant_id, integration_id, custom_config, installation_status, installed_at
      ) VALUES ($1, $2, $3, 'active', NOW())
      ON CONFLICT (tenant_id, integration_id) 
      DO UPDATE SET installation_status = 'active', custom_config = EXCLUDED.custom_config
      RETURNING id`,
      [
        tenant.id,
        integrationId,
        JSON.stringify(config || {})
      ]
    );

    console.log(`✅ Integration installed for tenant: ${tenantId}`);

    return result.rows[0];
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  private generateTenantId(tenantName: string): string {
    const sanitized = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 30);

    return `${sanitized}-${Date.now()}`;
  }

  private getDefaultFeaturesForTier(tier: string): Record<string, boolean> {
    const features = {
      free: {
        mobile_payments: true,
        inventory: false,
        analytics: false,
        team_management: false,
        api_access: false
      },
      starter: {
        mobile_payments: true,
        inventory: true,
        analytics: false,
        team_management: false,
        api_access: false
      },
      pro: {
        mobile_payments: true,
        inventory: true,
        analytics: true,
        team_management: true,
        api_access: false
      },
      enterprise: {
        mobile_payments: true,
        inventory: true,
        analytics: true,
        team_management: true,
        api_access: true
      }
    };

    return features[tier as keyof typeof features] || features.free;
  }

  private async assignDefaultGateways(client: any, tenantId: number, tier: string) {
    // For free tier: only Chapa
    // For pro: Chapa + Stripe option
    // For enterprise: all gateways

    // This would query existing gateway integrations and assign them
    // Implementation depends on whether super admin already configured gateways
  }

  private encryptSecret(secret: string): string {
    // Use encryption key from environment
    const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default-key');
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decryptSecret(encrypted: string): string {
    const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default-key');
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private async logSuperAdminAction(
    superAdminId: number | any,
    actionType: string,
    resourceType: string,
    resourceId: number,
    oldValues?: any,
    newValues?: any
  ) {
    // This would log to audit trail
    // Implementation handles audit logging
  }
}

export default SuperAdminService;
```

---

# PHASE 2: SUPER ADMIN DASHBOARD ROUTES

## 2.1 API Endpoints

### Create: `src/routes/super-admin.routes.ts`

```typescript
/**
 * Super Admin API Routes
 * All endpoints require super admin authentication
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import SuperAdminService from '../services/super-admin.service';
import SuperAdminAuthMiddleware from '../middleware/super-admin.auth';

interface AuthRequest extends Request {
  user?: {
    id: number;
    is_super_admin: boolean;
    role: string;
  };
}

export function createSuperAdminRoutes(db: Pool): Router {
  const router = Router();
  const superAdminService = new SuperAdminService(db);
  const auth = new SuperAdminAuthMiddleware(db);

  /**
   * ===== TENANT MANAGEMENT =====
   */

  /**
   * GET /admin/tenants
   * List all tenants with pagination and filters
   *
   * Query params:
   * - page: number (default 1)
   * - limit: number (default 50)
   * - status: 'active' | 'paused' | 'canceled'
   * - type: 'free' | 'starter' | 'pro' | 'enterprise'
   * - search: string
   */
  router.get(
    '/admin/tenants',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const result = await superAdminService.listTenants(page, limit, {
          subscription_status: req.query.status as string,
          tenant_type: req.query.type as string,
          search: req.query.search as string
        });

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /admin/tenants
   * Create new tenant (one-click onboarding)
   */
  router.post(
    '/admin/tenants',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.createTenant(req.user!.id, {
          tenant_name: req.body.tenant_name,
          primary_email: req.body.primary_email,
          tenant_type: req.body.tenant_type || 'free',
          country_code: req.body.country_code || 'ET',
          currency: req.body.currency || 'ETB'
        });

        res.status(201).json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /admin/tenants/:tenantId
   * Get tenant details
   */
  router.get(
    '/admin/tenants/:tenantId',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const tenant = await superAdminService.getTenant(req.params.tenantId);

        res.json({
          success: true,
          data: tenant
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * PATCH /admin/tenants/:tenantId/subscription
   * Update tenant subscription
   */
  router.patch(
    '/admin/tenants/:tenantId/subscription',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.updateTenantSubscription(
          req.user!.id,
          req.params.tenantId,
          {
            subscription_status: req.body.subscription_status,
            subscription_plan: req.body.subscription_plan,
            subscription_ends_at: req.body.subscription_ends_at
          }
        );

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ===== PAYMENT GATEWAY CONFIGURATION =====
   */

  /**
   * POST /admin/payment-gateways
   * Configure new payment gateway
   * 
   * Body:
   * {
   *   gateway_name: 'chapa',
   *   api_key: 'xxxxx',
   *   secret_key: 'xxxxx',
   *   is_production: false,
   *   merchant_id?: 'xxxxx',
   *   webhook_secret?: 'xxxxx'
   * }
   */
  router.post(
    '/admin/payment-gateways',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.configurePaymentGateway(req.user!.id, {
          gateway_name: req.body.gateway_name,
          api_key: req.body.api_key,
          secret_key: req.body.secret_key,
          merchant_id: req.body.merchant_id,
          webhook_secret: req.body.webhook_secret,
          is_production: req.body.is_production || false
        });

        res.status(201).json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /admin/tenants/:tenantId/payment-gateways/:gatewayId/assign
   * Assign payment gateway to tenant
   */
  router.post(
    '/admin/tenants/:tenantId/payment-gateways/:gatewayId/assign',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.assignGatewayToTenant(
          req.user!.id,
          req.params.tenantId,
          parseInt(req.params.gatewayId),
          {
            is_enabled: req.body.is_enabled !== false,
            daily_limit_cents: req.body.daily_limit_cents,
            monthly_limit_cents: req.body.monthly_limit_cents
          }
        );

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ===== ADD-ONS MANAGEMENT =====
   */

  /**
   * POST /admin/addons
   * Create new add-on package
   */
  router.post(
    '/admin/addons',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.createAddon(req.user!.id, {
          addon_code: req.body.addon_code,
          addon_name: req.body.addon_name,
          addon_description: req.body.addon_description,
          addon_category: req.body.addon_category,
          price_monthly_cents: req.body.price_monthly_cents,
          price_yearly_cents: req.body.price_yearly_cents,
          features: req.body.features,
          availability_tier: req.body.availability_tier || 'all'
        });

        res.status(201).json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /admin/tenants/:tenantId/addons/:addonId/assign
   * Assign add-on to tenant
   */
  router.post(
    '/admin/tenants/:tenantId/addons/:addonId/assign',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.assignAddonToTenant(
          req.user!.id,
          req.params.tenantId,
          parseInt(req.params.addonId),
          req.body.billing_frequency || 'monthly'
        );

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ===== INTEGRATIONS MARKETPLACE =====
   */

  /**
   * POST /admin/integrations
   * Create new integration listing
   */
  router.post(
    '/admin/integrations',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.createIntegrationListing(req.user!.id, {
          integration_code: req.body.integration_code,
          integration_name: req.body.integration_name,
          integration_description: req.body.integration_description,
          integration_type: req.body.integration_type,
          category: req.body.category,
          logo_url: req.body.logo_url,
          documentation_url: req.body.documentation_url,
          required_plan: req.body.required_plan
        });

        res.status(201).json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /admin/tenants/:tenantId/integrations/:integrationId/install
   * Install integration for tenant
   */
  router.post(
    '/admin/tenants/:tenantId/integrations/:integrationId/install',
    auth.requireSuperAdmin(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await superAdminService.installIntegrationForTenant(
          req.params.tenantId,
          parseInt(req.params.integrationId),
          req.body.config
        );

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createSuperAdminRoutes;
```

---

# PHASE 3: TENANT ADMIN DASHBOARD (Self-Service)

## 3.1 Tenant Admin Service

### Create: `src/services/tenant-admin.service.ts`

```typescript
/**
 * Tenant Admin Service
 * Handles tenant-level admin operations
 * Each cafe can manage their own integrations, settings, team
 */

import { Pool } from 'pg';

export class TenantAdminService {
  constructor(private db: Pool) {}

  /**
   * Get tenant's available payment methods
   * Returns only gateways assigned by super admin to this tenant
   */
  async getTenantPaymentMethods(tenantId: string) {
    const result = await this.db.query(
      `SELECT 
        pgi.id,
        pgi.gateway_name,
        pgi.gateway_type,
        pgi.supports_refund,
        pgi.supports_split_payment,
        tga.is_enabled,
        tga.daily_transaction_limit_cents,
        tga.monthly_transaction_limit_cents
       FROM payment_gateway_integrations pgi
       JOIN tenant_gateway_assignments tga ON tga.gateway_integration_id = pgi.id
       JOIN tenants t ON t.id = tga.tenant_id
       WHERE t.tenant_id = $1 AND tga.is_visible_to_tenant = true
       ORDER BY pgi.gateway_name`,
      [tenantId]
    );

    return result.rows;
  }

  /**
   * Tenant can enable/disable payment method for their location
   */
  async togglePaymentMethod(tenantId: string, gatewayId: number, isEnabled: boolean) {
    const result = await this.db.query(
      `UPDATE tenant_gateway_assignments
       SET is_enabled = $1, updated_at = NOW()
       WHERE gateway_integration_id = $2
       AND tenant_id = (SELECT id FROM tenants WHERE tenant_id = $3)
       RETURNING is_enabled`,
      [isEnabled, gatewayId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('Payment method not available for your account');
    }

    return result.rows[0];
  }

  /**
   * Tenant can connect their own payment provider credentials
   * (Optional: if they want to use their own Chapa account instead of shared)
   */
  async connectCustomPaymentProvider(
    tenantId: string,
    gatewayId: number,
    credentials: {
      api_key: string;
      secret_key: string;
    }
  ) {
    // Encrypt tenant's credentials
    // Store separately from super admin's credentials
    
    const result = await this.db.query(
      `UPDATE tenant_gateway_assignments
       SET tenant_api_key_encrypted = $1,
           tenant_secret_key_encrypted = $2,
           updated_at = NOW()
       WHERE gateway_integration_id = $3
       AND tenant_id = (SELECT id FROM tenants WHERE tenant_id = $4)
       RETURNING id`,
      [
        this.encryptSecret(credentials.api_key),
        this.encryptSecret(credentials.secret_key),
        gatewayId,
        tenantId
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Payment method not found');
    }

    return { success: true };
  }

  /**
   * Get tenant's active add-ons
   */
  async getTenantAddons(tenantId: string) {
    const result = await this.db.query(
      `SELECT 
        ap.id,
        ap.addon_code,
        ap.addon_name,
        ap.addon_description,
        ap.addon_category,
        ap.features,
        ap.feature_limits,
        tas.activation_date,
        tas.next_renewal_date,
        tas.billing_frequency,
        tas.payment_status
       FROM addon_packages ap
       JOIN tenant_addon_subscriptions tas ON tas.addon_id = ap.id
       JOIN tenants t ON t.id = tas.tenant_id
       WHERE t.tenant_id = $1 AND tas.payment_status = 'active'
       ORDER BY tas.activation_date DESC`,
      [tenantId]
    );

    return result.rows;
  }

  /**
   * Get available add-ons tenant can purchase
   */
  async getAvailableAddons(tenantId: string) {
    // Get tenant's plan
    const tenantResult = await this.db.query(
      `SELECT tenant_type FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    const tenantType = tenantResult.rows[0].tenant_type;

    // Get addons they don't already have
    const result = await this.db.query(
      `SELECT * FROM addon_packages
       WHERE is_available = true
       AND (availability_tier = 'all' OR availability_tier = $1)
       AND id NOT IN (
         SELECT addon_id FROM tenant_addon_subscriptions 
         WHERE tenant_id = (SELECT id FROM tenants WHERE tenant_id = $2)
         AND payment_status = 'active'
       )
       ORDER BY addon_category, addon_name`,
      [tenantType, tenantId]
    );

    return result.rows;
  }

  /**
   * Get installed integrations
   */
  async getTenantIntegrations(tenantId: string) {
    const result = await this.db.query(
      `SELECT 
        im.id,
        im.integration_name,
        im.integration_code,
        im.integration_type,
        im.category,
        im.logo_url,
        im.support_url,
        tii.installation_status,
        tii.installed_at,
        tii.last_sync_at,
        tii.sync_count
       FROM integrations_marketplace im
       JOIN tenant_integrations_installed tii ON tii.integration_id = im.id
       JOIN tenants t ON t.id = tii.tenant_id
       WHERE t.tenant_id = $1
       ORDER BY tii.installed_at DESC`,
      [tenantId]
    );

    return result.rows;
  }

  /**
   * Get available integrations to install
   */
  async getAvailableIntegrations(tenantId: string) {
    const result = await this.db.query(
      `SELECT * FROM integrations_marketplace
       WHERE status = 'published'
       AND id NOT IN (
         SELECT integration_id FROM tenant_integrations_installed
         WHERE tenant_id = (SELECT id FROM tenants WHERE tenant_id = $1)
       )
       ORDER BY average_rating DESC, category`,
      [tenantId]
    );

    return result.rows;
  }

  /**
   * Uninstall integration
   */
  async uninstallIntegration(tenantId: string, integrationId: number) {
    const result = await this.db.query(
      `UPDATE tenant_integrations_installed
       SET installation_status = 'uninstalled', uninstalled_at = NOW()
       WHERE integration_id = $1
       AND tenant_id = (SELECT id FROM tenants WHERE tenant_id = $2)
       RETURNING id`,
      [integrationId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('Integration not found');
    }

    return { success: true };
  }

  /**
   * Get tenant's team members
   */
  async getTenantTeam(tenantId: string) {
    const result = await this.db.query(
      `SELECT id, email, role, last_login, created_at
       FROM tenant_users
       WHERE tenant_id = (SELECT id FROM tenants WHERE tenant_id = $1)
       ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows;
  }

  /**
   * Invite team member
   */
  async inviteTeamMember(tenantId: string, email: string, role: string) {
    // Generate invitation token
    const token = this.generateInvitationToken();

    const result = await this.db.query(
      `INSERT INTO tenant_invitations (tenant_id, email, role, invitation_token, expires_at)
       VALUES (
         (SELECT id FROM tenants WHERE tenant_id = $1),
         $2,
         $3,
         $4,
         NOW() + INTERVAL '7 days'
       )
       RETURNING invitation_token`,
      [tenantId, email, role, token]
    );

    // In production: send email invitation

    return {
      success: true,
      invitation_url: `${process.env.FRONTEND_URL}/accept-invitation?token=${token}`
    };
  }

  private encryptSecret(secret: string): string {
    // Implementation
    return secret;
  }

  private generateInvitationToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }
}

export default TenantAdminService;
```

---

# PHASE 4: COMPLETE FEATURE SET - WHAT ELSE YOU NEED

Based on research of Shopify, Stripe Connect, and Chargebee, here's what a production system needs:

## 4.1 Must-Have Features (Beyond Payment Integration)

### A. Feature Gating System (Critical)

```typescript
/**
 * Feature Gating
 * Control which features are available based on subscription tier
 */

interface FeatureGates {
  mobile_payments: {
    free: boolean;      // true
    pro: boolean;       // true
    enterprise: boolean; // true
  };
  inventory_management: {
    free: boolean;      // false
    pro: boolean;       // true
    enterprise: boolean; // true
  };
  team_management: {
    free: boolean;      // false
    pro: boolean;       // true (max 3 users)
    enterprise: boolean; // true (unlimited)
  };
  api_access: {
    free: boolean;      // false
    pro: boolean;       // false
    enterprise: boolean; // true
  };
  advanced_analytics: {
    free: boolean;      // false
    pro: boolean;       // true
    enterprise: boolean; // true
  };
}
```

**Implementation:**
```typescript
// Middleware that checks if tenant has feature access
async function hasFeature(req: Request, feature: string) {
  const tenant = await db.query(
    `SELECT features_enabled FROM tenants WHERE tenant_id = $1`,
    [req.user.tenant_id]
  );
  
  return tenant.rows[0].features_enabled[feature] === true;
}
```

### B. Usage Limits & Quotas

```sql
CREATE TABLE tenant_usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  metric_name VARCHAR(100), -- 'transactions_this_month', 'api_calls'
  current_usage BIGINT DEFAULT 0,
  limit_value BIGINT,
  reset_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### C. Billing & Invoicing

```sql
CREATE TABLE tenant_invoices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  
  -- Items
  subtotal_cents BIGINT,
  tax_cents BIGINT,
  total_cents BIGINT,
  
  -- Dates
  invoice_date DATE,
  due_date DATE,
  paid_at TIMESTAMP,
  
  -- Status
  status ENUM ('draft', 'sent', 'paid', 'overdue', 'canceled') DEFAULT 'draft',
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

### D. Webhook Management

```typescript
/**
 * Webhook infrastructure for integrations
 * Each integration can register webhooks
 */

interface WebhookConfig {
  event_type: string;        // 'payment.completed', 'order.updated'
  target_url: string;        // https://integration.example.com/webhook
  secret_token: string;      // For signature verification
  active: boolean;
}

async function registerWebhook(tenantId: string, webhookConfig: WebhookConfig) {
  // Store webhook
  // Test webhook delivery
  // Enable automatic retries
}
```

### E. API Keys for Integrations

```sql
CREATE TABLE tenant_api_keys (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  
  -- Key Info
  api_key_hash VARCHAR(255) UNIQUE NOT NULL,
  api_key_name VARCHAR(255), -- "Zapier Integration", "Inventory Sync"
  
  -- Permissions
  scopes JSONB DEFAULT '[]', -- ['read:orders', 'write:products']
  
  -- Access Control
  ip_whitelist JSONB, -- Optional: limit to specific IPs
  rate_limit INT DEFAULT 1000, -- requests per hour
  
  -- Lifecycle
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_api_key_hash (api_key_hash)
);
```

### F. Audit Logging (Compliance)

```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id),
  user_id BIGINT,
  
  -- What happened
  action VARCHAR(100), -- 'payment_processed', 'user_created'
  resource_type VARCHAR(50), -- 'order', 'user', 'integration'
  resource_id BIGINT,
  
  -- Changes
  old_values JSONB,
  new_values JSONB,
  
  -- Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
);
```

### G. Subscription Lifecycle Management

```typescript
/**
 * Handles:
 * - Trial periods
 * - Subscription upgrades/downgrades
 * - Automatic renewal
 * - Dunning (failed payment recovery)
 * - Churn prevention
 */

async function handleSubscriptionUpgrade(
  tenantId: string,
  newPlan: string
) {
  // Proration: Calculate credit from old plan
  // Update features immediately
  // Schedule new invoice
  // Send notification
}

async function handleFailedPayment(tenantId: string) {
  // Retry 3 times over 5 days
  // Send reminder emails
  // Pause features if still unpaid
  // Eventually cancel subscription
}
```

### H. SLA & Uptime Monitoring

```typescript
/**
 * Track:
 * - API uptime
 * - Payment gateway latency
 * - Webhook delivery success rate
 * - Database performance
 */

interface SLAMetrics {
  api_uptime: number;           // 99.9%
  avg_response_time: number;   // ms
  webhook_delivery_rate: number; // 99.95%
  error_rate: number;          // < 0.1%
}
```

### I. Notification System

```typescript
/**
 * Send notifications via:
 * - Email (invoices, alerts)
 * - SMS (critical alerts)
 * - In-app (feature announcements)
 * - Webhooks (integration events)
 */

async function notifyTenant(
  tenantId: string,
  notification: {
    type: 'invoice' | 'alert' | 'announcement';
    title: string;
    message: string;
    channels: ['email', 'sms', 'in_app'];
  }
) {
  // Send via all channels
  // Track delivery
  // Log for audit
}
```

### J. Reporting & Analytics

```sql
-- Dashboard metrics for super admin
SELECT 
  COUNT(DISTINCT tenant_id) as total_tenants,
  SUM(monthly_revenue_cents) / 100.0 as mrr,
  COUNT(DISTINCT 
    CASE WHEN subscription_status = 'active' THEN tenant_id END
  ) as active_tenants,
  AVG(monthly_revenue_cents) / 100.0 as arppu
FROM tenants
WHERE subscription_status IN ('active', 'paused');

-- For each tenant: revenue by payment method
SELECT 
  payment_method,
  COUNT(*) as transaction_count,
  SUM(amount_cents) / 100.0 as total_revenue,
  AVG(amount_cents) / 100.0 as avg_transaction
FROM payment_gateway_transactions
WHERE tenant_id = $1
  AND payment_status = 'completed'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY payment_method
ORDER BY total_revenue DESC;
```

---

# PHASE 5: COMPLETE FEATURE COMPARISON TABLE

| Feature | Free | Starter | Pro | Enterprise |
|---------|------|---------|-----|------------|
| **Payments** | | | | |
| Mobile payments | ✅ | ✅ | ✅ | ✅ |
| Payment methods | 1 | 2 | 5+ | All |
| Chapa integration | ✅ | ✅ | ✅ | ✅ |
| Custom payment provider | ❌ | ❌ | ✅ | ✅ |
| **Operations** | | | | |
| Inventory management | ❌ | ✅ | ✅ | ✅ |
| Receipt printing | ✅ | ✅ | ✅ | ✅ |
| Reports | Basic | Standard | Advanced | Custom |
| **Team** | | | | |
| Team members | 1 | 3 | 10 | Unlimited |
| Custom roles | ❌ | ❌ | ✅ | ✅ |
| **Integration** | | | | |
| Zapier | ❌ | ❌ | ✅ | ✅ |
| API access | ❌ | ❌ | ❌ | ✅ |
| Custom integrations | ❌ | ❌ | Limited | Unlimited |
| **Support** | | | | |
| Email support | ✅ | ✅ | ✅ | ✅ |
| Priority support | ❌ | ❌ | ✅ | ✅ |
| Dedicated support | ❌ | ❌ | ❌ | ✅ |
| **Pricing** | Free | $10/mo | $50/mo | Custom |

---

# PHASE 6: IMPLEMENTATION ROADMAP FOR ALL FEATURES

## Week 1-2: Foundation
- ✅ Tenant management (create, list, update)
- ✅ Payment gateway configuration
- ✅ Basic feature gating
- ✅ Super admin dashboard

## Week 3-4: Integrations
- ✅ Integration marketplace
- ✅ Add-ons system
- ✅ API keys management
- ✅ Webhook infrastructure

## Week 5-6: Advanced
- ✅ Usage tracking & limits
- ✅ Billing & invoicing
- ✅ Audit logging
- ✅ Tenant admin dashboard

## Week 7-8: Scaling
- ✅ Analytics & reporting
- ✅ Notification system
- ✅ SLA monitoring
- ✅ Security hardening

---

# DEPLOYMENT CHECKLIST

**Pre-Launch:**
- [ ] All database migrations applied
- [ ] Super admin account created
- [ ] Test payment gateway configured
- [ ] HTTPS/TLS enabled
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] Backup strategy in place

**Go-Live:**
- [ ] Production Chapa account configured
- [ ] SSL certificates verified
- [ ] Monitoring & alerting active
- [ ] Support team trained
- [ ] Documentation published
- [ ] SLA agreement finalized

---

**This is enterprise-grade architecture used by companies worth billions. Implement it correctly and you've built a platform, not just a POS system.**

