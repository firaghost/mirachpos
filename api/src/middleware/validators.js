/**
 * Input Validation Middleware (Zod)
 * 
 * Schema-based validation for API inputs.
 * Prevents invalid/malicious data from reaching handlers.
 */

const { z } = require('zod');
const { ValidationError } = require('../utils/errors');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Login schema
const loginSchema = z.object({
    email: z
        .string({ required_error: 'Email is required' })
        .email('Invalid email format')
        .max(255, 'Email too long'),
    password: z
        .string({ required_error: 'Password is required' })
        .min(1, 'Password is required')
        .max(255, 'Password too long'),
});

// Login with code/pin schema
const loginPinSchema = z.object({
    code: z
        .string({ required_error: 'Code is required' })
        .min(1, 'Code is required')
        .max(50, 'Code too long'),
    pin: z
        .string({ required_error: 'PIN is required' })
        .regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
});

// Forgot-password request schema
const forgotPasswordRequestSchema = z.object({
    email: z
        .string({ required_error: 'Email is required' })
        .email('Invalid email format')
        .max(255, 'Email too long'),
});

// Forgot-password confirm schema
const forgotPasswordConfirmSchema = z.object({
    email: z
        .string({ required_error: 'Email is required' })
        .email('Invalid email format')
        .max(255, 'Email too long'),
    otp: z
        .string({ required_error: 'OTP is required' })
        .regex(/^\d{4,8}$/, 'OTP must be 4-8 digits'),
    password: z
        .string({ required_error: 'Password is required' })
        .min(6, 'Password must be at least 6 characters')
        .max(255, 'Password too long'),
    passwordConfirm: z
        .string({ required_error: 'Password confirmation is required' })
        .min(6, 'Password confirmation must be at least 6 characters')
        .max(255, 'Password confirmation too long'),
});

// Public signup schema
const publicSignupSchema = z.object({
    restaurantName: z
        .string({ required_error: 'Restaurant name is required' })
        .min(2, 'Restaurant name must be at least 2 characters')
        .max(120, 'Restaurant name too long'),
    ownerName: z
        .string({ required_error: 'Owner name is required' })
        .min(2, 'Owner name must be at least 2 characters')
        .max(120, 'Owner name too long'),
    email: z
        .string({ required_error: 'Email is required' })
        .email('Invalid email format')
        .max(255, 'Email too long'),
    password: z
        .string({ required_error: 'Password is required' })
        .min(6, 'Password must be at least 6 characters')
        .max(255, 'Password too long'),
    turnstileToken: z.string().min(1, 'Turnstile token is required').max(2000).optional(),
    meta: z
        .object({
            phone: z.string().max(30).optional(),
            cityRegion: z.string().max(120).optional(),
            addressLine: z.string().max(255).optional(),
        })
        .optional(),
});

// Public POS link token param schema
const tokenParamSchema = z.object({
    token: z.string().min(1, 'Token is required').max(200),
});

// Chapa initiate schema
const chapaInitiateSchema = z.object({
    tipAmount: z.number().min(0).max(1000000).optional(),
    tipPct: z.number().min(0).max(100).optional(),
});

// Demo request schema
const demoRequestSchema = z.object({
    name: z.string({ required_error: 'Name is required' }).min(2).max(120),
    email: z.string({ required_error: 'Email is required' }).email().max(255),
    phone: z.string().max(30).optional(),
    company: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    source: z.string().max(120).optional(),
    message: z.string().max(1000).optional(),
});

// Accept invite schema
const acceptInviteSchema = z.object({
    code: z.string({ required_error: 'Invite code is required' }).min(1).max(120),
    name: z.string({ required_error: 'Name is required' }).min(2).max(120),
    email: z.string({ required_error: 'Email is required' }).email().max(255),
    password: z.string({ required_error: 'Password is required' }).min(6).max(255),
});

// Contact admin schema
const contactAdminSchema = z.object({
    name: z.string({ required_error: 'Name is required' }).min(2).max(120),
    email: z.string({ required_error: 'Email is required' }).email().max(255),
    phone: z.string().max(30).optional(),
    message: z.string({ required_error: 'Message is required' }).min(1).max(2000),
});

// Support ticket create schema
const supportTicketCreateSchema = z.object({
    severity: z.string().max(20).optional(),
    subject: z.string({ required_error: 'Subject is required' }).min(1).max(200),
    description: z.string().max(2000).optional(),
});

// Support ticket update schema
const supportTicketUpdateSchema = z.object({
    status: z.enum(['Open', 'Closed'], { required_error: 'Status is required' }),
});

// Sync push schema
const syncPushSchema = z.object({
    events: z
        .array(
            z
                .object({
                    event_id: z.string().min(1).optional(),
                    tenant_id: z.string().min(1).optional(),
                    branch_id: z.string().min(1).optional(),
                    device_id: z.string().min(1).optional(),
                    event_type: z.string().min(1).optional(),
                    created_at_local: z.string().min(1).optional(),
                    payload: z.any().optional(),
                    aggregate_id: z.string().min(1).optional(),
                })
                .passthrough()
        )
        .default([]),
});

const syncPullQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.string().optional(),
});

const syncDraftsQuerySchema = z.object({
    branchId: z.string().optional(),
    status: z.string().optional(),
});

// Waiter account update schema
const waiterAccountSchema = z
    .object({
        currentPassword: z.string().optional(),
        newPassword: z.string().min(4).optional(),
        currentPin: z.string().optional(),
        newPin: z.string().min(3).optional(),
    })
    .refine((data) => Boolean(data.newPassword || data.newPin), {
        message: 'No changes provided',
        path: ['newPassword'],
    });

const waiterHistoryQuerySchema = z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.string().optional(),
    pageSize: z.string().optional(),
    branchId: z.string().optional(),
});

// Telebirr standing order
const telebirrSubscribeSchema = z.object({
    phone: z.string().min(6).max(30),
    planAmount: z.number().min(0),
    plan_amount: z.number().min(0).optional(),
    cycle: z.string().min(1).optional(),
    executeDay: z.number().int().min(1).max(31).optional(),
    execute_day: z.number().int().min(1).max(31).optional(),
    validityMonths: z.number().int().min(1).max(60).optional(),
    validity_months: z.number().int().min(1).max(60).optional(),
});

const telebirrCancelParamSchema = z.object({
    id: z.string().min(1),
});

// Superadmin schemas
const superadminTenantIdSchema = z.object({
    tenantId: z.string().min(1),
});

const tierParamSchema = z.object({
    tier: z.string().min(1),
});

const superadminPlanCreateSchema = z.object({
    tier: z.string().min(1),
    modules: z.array(z.string().min(1)).optional(),
    limits: z.record(z.any()).optional(),
    pricing: z
        .object({
            monthlyEtb: z.number().min(0).optional(),
            yearlyEtb: z.number().min(0).optional(),
        })
        .optional(),
});

const superadminPlanUpdateSchema = z.object({
    modules: z.array(z.string().min(1)).optional(),
    limits: z.record(z.any()).optional().nullable(),
    pricing: z
        .object({
            monthlyEtb: z.number().min(0).optional(),
            yearlyEtb: z.number().min(0).optional(),
        })
        .optional(),
});

const superadminDemoRequestUpdateSchema = z.object({
    status: z.string().min(1).max(40).optional(),
    provisionedTenantId: z.string().min(1).optional(),
});

const superadminDemoRequestProvisionSchema = z.object({
    slug: z.string().min(1).max(60),
    tenantName: z.string().min(1).max(120),
    branchName: z.string().max(120).optional(),
    ownerName: z.string().max(120).optional(),
    ownerPassword: z.string().min(6).max(255),
    trialDays: z.number().int().min(0).max(365).optional(),
});

const superadminBillingVerifySchema = z.object({
    tenantId: z.string().min(1),
});

const superadminBillingManualInvoiceSchema = z.object({
    tenantId: z.string().min(1),
    amountEtb: z.number().positive(),
    dueAt: z.string().optional(),
    method: z.string().optional(),
    notes: z.string().optional(),
});

const superadminBillingSetNextBillSchema = z.object({
    tenantId: z.string().min(1),
    nextBillAt: z.string().min(1),
});

const superadminBillingSetGraceSchema = z.object({
    tenantId: z.string().min(1),
    graceEndsAt: z.string().min(1),
});

const superadminBillingSetStatusSchema = z.object({
    tenantId: z.string().min(1),
    status: z.string().min(1),
});

const superadminBillingSetCycleSchema = z.object({
    tenantId: z.string().min(1),
    cycle: z.string().min(1),
});

const superadminBillingSetMethodSchema = z.object({
    tenantId: z.string().min(1),
    method: z.string().min(1),
});

const superadminBillingPolicySchema = z.object({
    autoRenewDefault: z.boolean().optional(),
    prorationOnUpgrade: z.boolean().optional(),
    billingCycleAnchor: z.string().optional(),
    currencyDefault: z.string().optional(),
    autoSuspensionTrigger: z.boolean().optional(),
});

const superadminTenantCreateSchema = z.object({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(60),
    tier: z.string().optional(),
    ownerName: z.string().optional(),
    ownerEmail: z.string().email().optional(),
    ownerPhone: z.string().optional(),
    ownerPassword: z.string().min(6).optional(),
    address1: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    timezone: z.string().optional(),
    currency: z.string().optional(),
    branchName: z.string().optional(),
});

const superadminTenantUpdateSchema = z.object({
    name: z.string().optional(),
    status: z.string().optional(),
    tier: z.string().optional(),
    onboardingStage: z.string().optional(),
    internalTags: z.array(z.string()).optional(),
    enabledModules: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    profile: z.record(z.any()).optional(),
});

const superadminResetCredsSchema = z.object({
    tenantId: z.string().min(1),
});

const superadminImpersonateSchema = z.object({
    tenantId: z.string().min(1),
    role: z.string().optional(),
});

const superadminGatewayParamSchema = z.object({
    gateway: z.string().min(1),
});

const superadminPosGatewayUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
});

const superadminTenantNoteSchema = z.object({
    message: z.string().min(1).max(2000),
});

const superadminDunningCreateSchema = z.object({
    offsetDays: z.number().int().min(-365).max(365),
    title: z.string().min(1).max(200),
    bodyTemplate: z.string().optional(),
    channel: z.string().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000000),
});

const superadminDunningUpdateSchema = z.object({
    offsetDays: z.number().int().min(-365).max(365).optional(),
    title: z.string().min(1).max(200).optional(),
    bodyTemplate: z.string().optional(),
    channel: z.string().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000000).optional(),
});

const superadminPlatformSettingsSchema = z.record(z.any());

const superadminFeatureFlagCreateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    plan: z.string().optional(),
    risk: z.string().optional(),
    enabled: z.boolean().optional(),
});

const superadminFeatureFlagUpdateSchema = z.object({
    name: z.string().optional(),
    plan: z.string().optional(),
    risk: z.string().optional(),
    enabled: z.boolean().optional(),
});

const gatewayConfigSchema = z.object({
    enabled: z.boolean().optional(),
    enabledForPos: z.boolean().optional(),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    webhookSecret: z.string().optional(),
    encryptionKey: z.string().optional(),
    appId: z.string().optional(),
    appKey: z.string().optional(),
    shortCode: z.string().optional(),
    merchantId: z.string().optional(),
    merchantAppId: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    fabricAppId: z.string().optional(),
    appSecret: z.string().optional(),
    merchantCode: z.string().optional(),
    privateKey: z.string().optional(),
});

const superadminPaymentConfigSchema = z.object({
    bankDetails: z.any().optional(),
    chapa: gatewayConfigSchema.optional(),
    telebirr: gatewayConfigSchema.optional(),
    sms: z.any().optional(),
    settings: z.any().optional(),
    fcm: z.object({
        enabled: z.boolean().optional(),
    }).optional(),
});

const superadminSmsTestSchema = z.object({
    to: z.string().min(3).max(50),
    message: z.string().min(1).max(480),
});

const superadminOfflineAccountCreateSchema = z.object({
    bankName: z.string().min(1).max(200),
    accountNumber: z.string().min(1).max(200),
    accountHolder: z.string().min(1).max(200),
    active: z.boolean().optional(),
});

const superadminOfflineAccountUpdateSchema = z.object({
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    accountHolder: z.string().optional(),
    active: z.boolean().optional(),
});

const superadminTaxCodeParamSchema = z.object({
    code: z.string().min(1),
});

const superadminTaxRuleCreateSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    ratePct: z.number(),
    logic: z.string().optional(),
    status: z.string().optional(),
    effectiveDate: z.string().min(1),
    applicabilityCategories: z.array(z.string()).optional(),
});

const superadminTaxRuleUpdateSchema = z.object({
    name: z.string().optional(),
    ratePct: z.number().optional(),
    logic: z.string().optional(),
    status: z.string().optional(),
    effectiveDate: z.string().optional(),
    applicabilityCategories: z.array(z.string()).optional(),
});

const superadminTaxCategoryIdParamSchema = z.object({
    id: z.string().min(1),
});

const superadminTaxCategoryCreateSchema = z.object({
    name: z.string().min(1),
});

const superadminTaxCategoryUpdateSchema = z.object({
    name: z.string().min(1),
});

const superadminTaxStatusUpdateSchema = z.object({
    fiscalPrinterStatus: z.string().optional(),
    fiscalSignatureOk: z.boolean().optional(),
    lastErcaSyncAt: z.string().optional(),
    nextErcaSyncAt: z.string().optional(),
});

const superadminInvoiceManualSchema = z.object({
    tenantId: z.string().min(1),
    description: z.string().min(1),
    amountEtb: z.number(),
    dueInDays: z.number().optional(),
    notes: z.string().optional().nullable(),
});

const superadminInvoicesQuerySchema = z.object({
    page: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().optional(),
    status: z.string().optional(),
    tenantId: z.string().optional(),
    q: z.string().optional(),
    tier: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

const superadminInvoiceIdParamSchema = z.object({
    id: z.string().min(1),
});

const superadminInvoiceVerifySchema = z.object({
    paymentId: z.string().optional(),
    method: z.string().optional(),
});

const superadminPaymentRejectSchema = z.object({
    reason: z.string().optional(),
});

const superadminIntegrationsQuerySchema = z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    available: z.string().optional(),
});

const superadminIntegrationCreateSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    category: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    integrationType: z.string().optional(),
    requiredTier: z.string().optional().nullable(),
    isAvailable: z.boolean().optional(),
    configSchema: z.record(z.any()).optional().nullable(),
    meta: z.record(z.any()).optional(),
});

const superadminIntegrationUpdateSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    integrationType: z.string().optional(),
    requiredTier: z.string().optional().nullable(),
    isAvailable: z.boolean().optional(),
    configSchema: z.record(z.any()).optional().nullable(),
    meta: z.record(z.any()).optional(),
});

const superadminAddonQuerySchema = z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    available: z.string().optional(),
});

const addonPricingSchema = z.object({
    monthlyEtb: z.number().optional(),
    yearlyEtb: z.number().optional(),
    setupFeeEtb: z.number().optional(),
});

const superadminAddonCreateSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    category: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    availabilityTier: z.string().optional().nullable(),
    isAvailable: z.boolean().optional(),
    pricing: addonPricingSchema.optional(),
    modules: z.array(z.string()).optional(),
    limits: z.record(z.any()).optional(),
    meta: z.record(z.any()).optional(),
});

const superadminAddonUpdateSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    availabilityTier: z.string().optional().nullable(),
    isAvailable: z.boolean().optional(),
    pricing: addonPricingSchema.optional(),
    modules: z.array(z.string()).optional(),
    limits: z.record(z.any()).optional(),
    meta: z.record(z.any()).optional(),
});

const superadminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const superadminSupportReplySchema = z.object({
    message: z.string().min(1).max(5000),
});

const superadminSupportStatusSchema = z.object({
    status: z.string().min(1),
});

const superadminSupportTicketsQuerySchema = z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
    tenantId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
});

const superadminOverviewQuerySchema = z.object({
    range: z.string().optional(),
});

const superadminDemoRequestsQuerySchema = z.object({
    status: z.string().optional(),
    q: z.string().optional(),
});

const superadminTenantsQuerySchema = z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    tier: z.string().optional(),
    sort: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
});

const superadminPaymentsPendingQuerySchema = z.object({
    limit: z.string().optional(),
});

const superadminAuditQuerySchema = z.object({
    page: z.string().optional(),
    pageSize: z.string().optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    tenantId: z.string().optional(),
    branchId: z.string().optional(),
    actorRole: z.string().optional(),
    actorStaffId: z.string().optional(),
    type: z.string().optional(),
    requestId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

const superadminFeatureFlagsQuerySchema = z.object({
    page: z.string().optional(),
    pageSize: z.string().optional(),
    q: z.string().optional(),
    plan: z.string().optional(),
    risk: z.string().optional(),
});

// Payment submission schema
const paymentSubmissionSchema = z.object({
    method: z
        .enum(['bank_transfer', 'chapa', 'telebirr'], {
            errorMap: () => ({ message: 'Invalid payment method' }),
        }),
    reference: z
        .string()
        .min(3)
        .max(255, 'Reference too long')
        .optional(),
});

// Invoice creation schema
const createInvoiceSchema = z.object({
    lineItems: z
        .array(
            z.object({
                description: z.string().min(1).max(255),
                qty: z.number().int().positive(),
                unitPrice: z.number().min(0),
                amount: z.number().min(0),
            })
        )
        .min(1, 'At least one line item required'),
    dueInDays: z.number().int().min(1).max(365).optional(),
    notes: z.string().max(1000).optional(),
});

// Plan change request schema
const planChangeSchema = z.object({
    tier: z.enum(['Basic', 'Pro', 'Enterprise'], {
        errorMap: () => ({ message: 'Invalid plan tier' }),
    }),
    cycle: z.enum(['Monthly', 'Yearly'], {
        errorMap: () => ({ message: 'Invalid billing cycle' }),
    }),
});

// Tenant creation schema
const createTenantSchema = z.object({
    name: z
        .string({ required_error: 'Business name is required' })
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name too long'),
    slug: z
        .string()
        .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes')
        .min(2)
        .max(50)
        .optional(),
    ownerEmail: z.string().email('Invalid email format').optional(),
    ownerPhone: z.string().max(20).optional(),
});

// Staff creation schema
const createStaffSchema = z.object({
    name: z
        .string({ required_error: 'Name is required' })
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name too long'),
    email: z.string().email('Invalid email format').optional(),
    phone: z.string().max(20).optional(),
    pin: z
        .string()
        .regex(/^\d{4,6}$/, 'PIN must be 4-6 digits')
        .optional(),
    roleName: z.string().max(50).optional(),
});

// Admin routes schemas
const adminProvisionSchema = z.object({
    slug: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    trialDays: z.number().int().min(1).max(30).optional(),
    ownerName: z.string().max(120).optional(),
    ownerEmail: z.string().email().optional(),
    ownerPassword: z.string().min(6).max(255).optional(),
    branchName: z.string().max(120).optional(),
});

const adminSuperadminSeedSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().max(120).optional(),
});

// Branch routes schemas
const branchCreateSchema = z.object({
    name: z.string().min(1).max(120),
    status: z.enum(['Open', 'Closed', 'Maintenance']).optional(),
    city: z.string().max(120).optional(),
    address: z.string().max(255).optional(),
    phone: z.string().max(50).optional(),
    managerName: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    rating: z.number().min(0).max(5).optional(),
});

const branchUpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(['Open', 'Closed', 'Maintenance']).optional(),
    city: z.string().max(120).optional(),
    address: z.string().max(255).optional(),
    phone: z.string().max(50).optional(),
    managerName: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    rating: z.number().min(0).max(5).optional(),
});

const branchEventSchema = z.object({
    type: z.string().min(1).max(80),
    payload: z.record(z.any()).optional(),
});

// Manager customers schemas
const managerCustomerCreateSchema = z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(50),
    loyaltyPoints: z.number().int().min(0).optional(),
    loyaltyBalance: z.number().int().min(0).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
});

const managerCustomerUpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(50).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    loyaltyPoints: z.number().int().min(0).optional(),
    loyaltyBalance: z.number().int().min(0).optional(),
    updatedAt: z.string().optional(),
});

const managerCustomersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
    q: z.string().optional(),
});

// Manager finance schemas
const managerFinanceExpenseCreateSchema = z.object({
    category: z.string().min(1).max(60),
    amount: z.number().positive(),
    memo: z.string().max(500).optional(),
    at: z.string().optional(),
    title: z.string().max(120).optional(),
    vendor: z.string().max(120).optional(),
    icon: z.enum(['local_shipping', 'build', 'sanitizer', 'receipt_long']).optional(),
});

const managerFinanceExpenseUpdateSchema = z.object({
    category: z.string().max(60).optional(),
    amount: z.number().min(0).optional(),
    memo: z.string().max(500).optional(),
    at: z.string().optional(),
    createdAt: z.string().optional(),
    title: z.string().max(120).optional(),
    vendor: z.string().max(120).optional(),
    icon: z.enum(['local_shipping', 'build', 'sanitizer', 'receipt_long']).optional(),
});

const managerFinanceCashSessionCreateSchema = z.object({
    register: z.string().max(60).optional(),
    openingCash: z.number().min(0).optional(),
});

const managerFinanceCashSessionCloseSchema = z.object({
    actualCash: z.number().min(0),
});

const managerFinanceCashSessionUpdateSchema = z.object({
    register: z.string().max(60).optional(),
    staffName: z.string().max(120).optional(),
    staffRole: z.string().max(120).optional(),
    status: z.enum(['Active', 'Closed', 'Audit']).optional(),
    openedAt: z.string().optional(),
    closedAt: z.string().optional(),
    openingCash: z.number().min(0).optional(),
    expectedCash: z.number().min(0).optional(),
    actualCash: z.number().min(0).optional(),
});

const managerFinanceQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

// Manager menu schemas
const managerMenuProductCreateSchema = z.object({
    name: z.string().min(1).max(120),
    price: z.number().positive(),
    category: z.string().max(60).optional(),
    description: z.string().max(500).optional(),
    code: z.string().max(24).optional(),
    stock: z.number().int().min(0).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    image: z.string().url().optional(),
});

const managerMenuProductUpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    price: z.number().positive().optional(),
    category: z.string().max(60).optional(),
    description: z.string().max(500).optional(),
    code: z.string().max(24).optional(),
    stock: z.number().int().min(0).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    image: z.string().url().optional(),
});

const managerMenuProductsQuerySchema = z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
});

const managerMenuRecipesQuerySchema = z.object({
    productId: z.string().optional(),
    productIds: z.string().optional(),
});

const productIdParamSchema = z.object({
    productId: z.string().min(1),
});

const managerMenuRecipeUpsertSchema = z.object({
    recipe: z.object({
        ingredients: z
            .array(
                z.object({
                    ingredientId: z.string().min(1),
                    name: z.string().min(1),
                    quantity: z.number().min(0),
                    cost: z.number().min(0),
                })
            )
            .optional(),
        totalCost: z.number().min(0).optional(),
    }),
});

// ID parameter schema
const idParamSchema = z.object({
    id: z.string().min(1, 'ID is required'),
});

const kdsFireSchema = z.object({
    actionId: z.string({ required_error: 'actionId is required' }).min(1).max(96),
    orderId: z.string({ required_error: 'orderId is required' }).min(1).max(64),
    station: z.string({ required_error: 'station is required' }).min(1).max(64),
    courseNo: z.number().int().min(1).max(50).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    slaMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

const kdsTicketActionSchema = z.object({
    actionId: z.string({ required_error: 'actionId is required' }).min(1).max(96),
});

const kdsBoardQuerySchema = z.object({
    station: z.string().max(64).optional(),
    status: z.string().max(32).optional(),
    limit: z.coerce.number().int().min(1).max(400).optional(),
    branchId: z.string().max(64).optional(),
});

// =============================================================================
// VALIDATION MIDDLEWARE FACTORY
// =============================================================================

/**
 * Creates a validation middleware for request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateBody = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const issues = Array.isArray(result.error?.issues)
                ? result.error.issues
                : Array.isArray(result.error?.errors)
                    ? result.error.errors
                    : [];
            const errors = issues.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid request data', errors);
        }
        req.validatedBody = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

/**
 * Creates a validation middleware for query parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateQuery = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            const issues = Array.isArray(result.error?.issues)
                ? result.error.issues
                : Array.isArray(result.error?.errors)
                    ? result.error.errors
                    : [];
            const errors = issues.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid query parameters', errors);
        }
        req.validatedQuery = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

/**
 * Creates a validation middleware for route parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateParams = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            const issues = Array.isArray(result.error?.issues)
                ? result.error.issues
                : Array.isArray(result.error?.errors)
                    ? result.error.errors
                    : [];
            const errors = issues.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid route parameters', errors);
        }
        req.validatedParams = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

module.exports = {
    // Schemas
    loginSchema,
    loginPinSchema,
    forgotPasswordRequestSchema,
    forgotPasswordConfirmSchema,
    publicSignupSchema,
    tokenParamSchema,
    chapaInitiateSchema,
    demoRequestSchema,
    acceptInviteSchema,
    contactAdminSchema,
    supportTicketCreateSchema,
    supportTicketUpdateSchema,
    syncPushSchema,
    syncPullQuerySchema,
    syncDraftsQuerySchema,
    waiterAccountSchema,
    waiterHistoryQuerySchema,
    telebirrSubscribeSchema,
    telebirrCancelParamSchema,
    superadminTenantIdSchema,
    tierParamSchema,
    superadminPlanCreateSchema,
    superadminPlanUpdateSchema,
    superadminDemoRequestUpdateSchema,
    superadminDemoRequestProvisionSchema,
    superadminBillingVerifySchema,
    superadminBillingManualInvoiceSchema,
    superadminBillingSetNextBillSchema,
    superadminBillingSetGraceSchema,
    superadminBillingSetStatusSchema,
    superadminBillingSetCycleSchema,
    superadminBillingSetMethodSchema,
    superadminBillingPolicySchema,
    superadminTenantCreateSchema,
    superadminTenantUpdateSchema,
    superadminResetCredsSchema,
    superadminImpersonateSchema,
    superadminGatewayParamSchema,
    superadminPosGatewayUpdateSchema,
    superadminTenantNoteSchema,
    superadminDunningCreateSchema,
    superadminDunningUpdateSchema,
    superadminPlatformSettingsSchema,
    superadminFeatureFlagCreateSchema,
    superadminFeatureFlagUpdateSchema,
    superadminPaymentConfigSchema,
    superadminOfflineAccountCreateSchema,
    superadminOfflineAccountUpdateSchema,
    superadminTaxCodeParamSchema,
    superadminTaxRuleCreateSchema,
    superadminTaxRuleUpdateSchema,
    superadminTaxCategoryIdParamSchema,
    superadminTaxCategoryCreateSchema,
    superadminTaxCategoryUpdateSchema,
    superadminTaxStatusUpdateSchema,
    superadminInvoiceManualSchema,
    superadminInvoicesQuerySchema,
    superadminInvoiceIdParamSchema,
    superadminInvoiceVerifySchema,
    superadminPaymentRejectSchema,
    superadminIntegrationsQuerySchema,
    superadminIntegrationCreateSchema,
    superadminIntegrationUpdateSchema,
    superadminAddonQuerySchema,
    superadminAddonCreateSchema,
    superadminAddonUpdateSchema,
    superadminLoginSchema,
    superadminSupportReplySchema,
    superadminSupportStatusSchema,
    superadminSupportTicketsQuerySchema,
    superadminOverviewQuerySchema,
    superadminDemoRequestsQuerySchema,
    superadminTenantsQuerySchema,
    superadminPaymentsPendingQuerySchema,
    superadminAuditQuerySchema,
    superadminFeatureFlagsQuerySchema,
    paymentSubmissionSchema,
    createInvoiceSchema,
    planChangeSchema,
    createTenantSchema,
    createStaffSchema,
    idParamSchema,

    kdsFireSchema,
    kdsTicketActionSchema,
    kdsBoardQuerySchema,

    // Admin routes schemas
    adminProvisionSchema,
    adminSuperadminSeedSchema,

    // Branch routes schemas
    branchCreateSchema,
    branchUpdateSchema,
    branchEventSchema,

    // Manager customers schemas
    managerCustomerCreateSchema,
    managerCustomerUpdateSchema,
    managerCustomersQuerySchema,

    // Manager finance schemas
    managerFinanceExpenseCreateSchema,
    managerFinanceExpenseUpdateSchema,
    managerFinanceCashSessionCreateSchema,
    managerFinanceCashSessionCloseSchema,
    managerFinanceCashSessionUpdateSchema,
    managerFinanceQuerySchema,

    // Manager menu schemas
    managerMenuProductCreateSchema,
    managerMenuProductUpdateSchema,
    managerMenuProductsQuerySchema,
    managerMenuRecipesQuerySchema,
    productIdParamSchema,
    managerMenuRecipeUpsertSchema,

    // ID parameter schema
    idParamSchema,

    // Middleware factories
    validateBody,
    validateQuery,
    validateParams,

    // Pre-built validators
    validateLogin: validateBody(loginSchema),
    validateLoginPin: validateBody(loginPinSchema),
    validateForgotPasswordRequest: validateBody(forgotPasswordRequestSchema),
    validateForgotPasswordConfirm: validateBody(forgotPasswordConfirmSchema),
    validatePublicSignup: validateBody(publicSignupSchema),
    validateTokenParam: validateParams(tokenParamSchema),
    validateChapaInitiate: validateBody(chapaInitiateSchema),
    validateDemoRequest: validateBody(demoRequestSchema),
    validateAcceptInvite: validateBody(acceptInviteSchema),
    validateContactAdmin: validateBody(contactAdminSchema),
    validateSupportTicketCreate: validateBody(supportTicketCreateSchema),
    validateSupportTicketUpdate: validateBody(supportTicketUpdateSchema),
    validateSyncPush: validateBody(syncPushSchema),
    validateSyncPullQuery: validateQuery(syncPullQuerySchema),
    validateSyncDraftsQuery: validateQuery(syncDraftsQuerySchema),
    validateWaiterAccount: validateBody(waiterAccountSchema),
    validateWaiterHistoryQuery: validateQuery(waiterHistoryQuerySchema),
    validateTelebirrSubscribe: validateBody(telebirrSubscribeSchema),
    validateTelebirrCancelParam: validateParams(telebirrCancelParamSchema),
    validateSuperadminTenantId: validateBody(superadminTenantIdSchema),
    validateTierParam: validateParams(tierParamSchema),
    validateSuperadminPlanCreate: validateBody(superadminPlanCreateSchema),
    validateSuperadminPlanUpdate: validateBody(superadminPlanUpdateSchema),
    validateSuperadminDemoRequestUpdate: validateBody(superadminDemoRequestUpdateSchema),
    validateSuperadminDemoRequestProvision: validateBody(superadminDemoRequestProvisionSchema),
    validateSuperadminBillingVerify: validateBody(superadminBillingVerifySchema),
    validateSuperadminBillingManualInvoice: validateBody(superadminBillingManualInvoiceSchema),
    validateSuperadminBillingSetNextBill: validateBody(superadminBillingSetNextBillSchema),
    validateSuperadminBillingSetGrace: validateBody(superadminBillingSetGraceSchema),
    validateSuperadminBillingSetStatus: validateBody(superadminBillingSetStatusSchema),
    validateSuperadminBillingSetCycle: validateBody(superadminBillingSetCycleSchema),
    validateSuperadminBillingSetMethod: validateBody(superadminBillingSetMethodSchema),
    validateSuperadminBillingPolicy: validateBody(superadminBillingPolicySchema),
    validateSuperadminTenantCreate: validateBody(superadminTenantCreateSchema),
    validateSuperadminTenantUpdate: validateBody(superadminTenantUpdateSchema),
    validateSuperadminResetCreds: validateBody(superadminResetCredsSchema),
    validateSuperadminImpersonate: validateBody(superadminImpersonateSchema),
    validateSuperadminGatewayParam: validateParams(superadminGatewayParamSchema),
    validateSuperadminPosGatewayUpdate: validateBody(superadminPosGatewayUpdateSchema),
    validateSuperadminTenantNote: validateBody(superadminTenantNoteSchema),
    validateSuperadminDunningCreate: validateBody(superadminDunningCreateSchema),
    validateSuperadminDunningUpdate: validateBody(superadminDunningUpdateSchema),
    validateSuperadminPlatformSettings: validateBody(superadminPlatformSettingsSchema),
    validateSuperadminFeatureFlagCreate: validateBody(superadminFeatureFlagCreateSchema),
    validateSuperadminFeatureFlagUpdate: validateBody(superadminFeatureFlagUpdateSchema),
    validateSuperadminPaymentConfig: validateBody(superadminPaymentConfigSchema),
    validateSuperadminSmsTest: validateBody(superadminSmsTestSchema),
    validateSuperadminOfflineAccountCreate: validateBody(superadminOfflineAccountCreateSchema),
    validateSuperadminOfflineAccountUpdate: validateBody(superadminOfflineAccountUpdateSchema),
    validateSuperadminTaxCodeParam: validateParams(superadminTaxCodeParamSchema),
    validateSuperadminTaxRuleCreate: validateBody(superadminTaxRuleCreateSchema),
    validateSuperadminTaxRuleUpdate: validateBody(superadminTaxRuleUpdateSchema),
    validateSuperadminTaxCategoryIdParam: validateParams(superadminTaxCategoryIdParamSchema),
    validateSuperadminTaxCategoryCreate: validateBody(superadminTaxCategoryCreateSchema),
    validateSuperadminTaxCategoryUpdate: validateBody(superadminTaxCategoryUpdateSchema),
    validateSuperadminTaxStatusUpdate: validateBody(superadminTaxStatusUpdateSchema),
    validateSuperadminInvoiceManual: validateBody(superadminInvoiceManualSchema),
    validateSuperadminInvoicesQuery: validateQuery(superadminInvoicesQuerySchema),
    validateSuperadminInvoiceIdParam: validateParams(superadminInvoiceIdParamSchema),
    validateSuperadminInvoiceVerify: validateBody(superadminInvoiceVerifySchema),
    validateSuperadminPaymentReject: validateBody(superadminPaymentRejectSchema),
    validateSuperadminIntegrationsQuery: validateQuery(superadminIntegrationsQuerySchema),
    validateSuperadminIntegrationCreate: validateBody(superadminIntegrationCreateSchema),
    validateSuperadminIntegrationUpdate: validateBody(superadminIntegrationUpdateSchema),
    validateSuperadminAddonQuery: validateQuery(superadminAddonQuerySchema),
    validateSuperadminAddonCreate: validateBody(superadminAddonCreateSchema),
    validateSuperadminAddonUpdate: validateBody(superadminAddonUpdateSchema),
    validateSuperadminLogin: validateBody(superadminLoginSchema),
    validateSuperadminSupportReply: validateBody(superadminSupportReplySchema),
    validateSuperadminSupportStatus: validateBody(superadminSupportStatusSchema),
    validateSuperadminSupportTicketsQuery: validateQuery(superadminSupportTicketsQuerySchema),
    validateSuperadminOverviewQuery: validateQuery(superadminOverviewQuerySchema),
    validateSuperadminDemoRequestsQuery: validateQuery(superadminDemoRequestsQuerySchema),
    validateSuperadminTenantsQuery: validateQuery(superadminTenantsQuerySchema),
    validateSuperadminPaymentsPendingQuery: validateQuery(superadminPaymentsPendingQuerySchema),
    validateSuperadminAuditQuery: validateQuery(superadminAuditQuerySchema),
    validateSuperadminFeatureFlagsQuery: validateQuery(superadminFeatureFlagsQuerySchema),
    validatePaymentSubmission: validateBody(paymentSubmissionSchema),
    validateCreateInvoice: validateBody(createInvoiceSchema),
    validatePlanChange: validateBody(planChangeSchema),
    validateCreateTenant: validateBody(createTenantSchema),
    validateCreateStaff: validateBody(createStaffSchema),
    validateIdParam: validateParams(idParamSchema),

    // Admin routes validators
    validateAdminProvision: validateBody(adminProvisionSchema),
    validateAdminSuperadminSeed: validateBody(adminSuperadminSeedSchema),

    // Branch routes validators
    validateBranchCreate: validateBody(branchCreateSchema),
    validateBranchUpdate: validateBody(branchUpdateSchema),
    validateBranchEvent: validateBody(branchEventSchema),

    // Manager customers validators
    validateManagerCustomerCreate: validateBody(managerCustomerCreateSchema),
    validateManagerCustomerUpdate: validateBody(managerCustomerUpdateSchema),
    validateManagerCustomersQuery: validateQuery(managerCustomersQuerySchema),

    // Manager finance validators
    validateManagerFinanceExpenseCreate: validateBody(managerFinanceExpenseCreateSchema),
    validateManagerFinanceExpenseUpdate: validateBody(managerFinanceExpenseUpdateSchema),
    validateManagerFinanceCashSessionCreate: validateBody(managerFinanceCashSessionCreateSchema),
    validateManagerFinanceCashSessionClose: validateBody(managerFinanceCashSessionCloseSchema),
    validateManagerFinanceCashSessionUpdate: validateBody(managerFinanceCashSessionUpdateSchema),
    validateManagerFinanceQuery: validateQuery(managerFinanceQuerySchema),

    // Manager menu validators
    validateManagerMenuProductCreate: validateBody(managerMenuProductCreateSchema),
    validateManagerMenuProductUpdate: validateBody(managerMenuProductUpdateSchema),
    validateManagerMenuProductsQuery: validateQuery(managerMenuProductsQuerySchema),
    validateManagerMenuRecipesQuery: validateQuery(managerMenuRecipesQuerySchema),
    validateProductIdParam: validateParams(productIdParamSchema),
    validateManagerMenuRecipeUpsert: validateBody(managerMenuRecipeUpsertSchema),
};
