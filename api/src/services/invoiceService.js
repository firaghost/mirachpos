/**
 * Invoice Service
 * 
 * Handles invoice generation, payment processing, and subscription billing.
 * Supports Chapa, Telebirr, CBE Birr, and bank transfer payments.
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const normalizeBillingFrequency = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'yearly' || s === 'annual' || s === 'annually') return 'yearly';
    return 'monthly';
};

// Get platform payment configuration
const getPlatformPaymentConfig = async () => {
    const row = await db()
        .select(['*'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

    if (!row) return null;

    return {
        bankDetails: safeJsonParse(row.bank_details_json, {}),
        chapa: safeJsonParse(row.chapa_config_json, { enabled: false }),
        telebirr: safeJsonParse(row.telebirr_config_json, { enabled: false }),
        cbeBirr: safeJsonParse(row.cbe_birr_config_json, { enabled: false }),
        sms: safeJsonParse(row.sms_config_json, { enabled: false }),
        defaultGraceDays: Number(row.default_grace_days || 3) || 3,
        reportRetentionDays: Number(row.report_retention_days || 365) || 365,
    };
};

// Generate next invoice number (Tenant-scoped)
const generateInvoiceNumber = async (tenantId) => {
    const year = new Date().getFullYear();

    // Get tenant slug short code
    const tenant = await db().select('slug').from('tenants').where({ id: tenantId }).first();
    const slug = (tenant?.slug || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 4);

    const prefix = `INV-${slug}-${year}-`;

    const lastInvoice = await db()
        .select(['invoice_number'])
        .from('invoices')
        .where('invoice_number', 'like', `${prefix}%`)
        .orderBy('created_at', 'desc')
        .first();

    let nextNum = 1;
    if (lastInvoice?.invoice_number) {
        // INV-SLUG-2026-0001
        const parts = lastInvoice.invoice_number.split('-');
        const lastSeq = parts[parts.length - 1];
        const n = parseInt(lastSeq, 10);
        if (!Number.isNaN(n)) {
            nextNum = n + 1;
        }
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
};

// Calculate prorated amount for plan changes
const calculateProration = ({ currentPlan, newPlan, daysRemaining, totalDays, currentAmount, newAmount }) => {
    if (!daysRemaining || daysRemaining <= 0) {
        return { creditAmount: 0, chargeAmount: newAmount, netAmount: newAmount };
    }

    const dailyCurrentRate = currentAmount / totalDays;
    const creditAmount = Math.round(dailyCurrentRate * daysRemaining * 100) / 100;

    const dailyNewRate = newAmount / totalDays;
    const chargeAmount = Math.round(dailyNewRate * daysRemaining * 100) / 100;

    const netAmount = Math.max(0, chargeAmount - creditAmount);

    return {
        creditAmount,
        chargeAmount,
        netAmount,
        calculation: {
            currentPlan,
            newPlan,
            daysRemaining,
            totalDays,
            currentAmount,
            newAmount,
        },
    };
};

// Get plan pricing
const getPlanPricing = async (tier, cycle) => {
    // Case-insensitive lookup
    const row = await db()
        .select(['price_monthly_etb', 'price_yearly_etb'])
        .from('plans')
        .whereRaw('LOWER(tier) = ?', [String(tier).toLowerCase()])
        .first();

    if (!row) {
        console.warn(`[getPlanPricing] Plan not found for tier: ${tier}`);
        return 0;
    }

    const isYearly = String(cycle).toLowerCase() === 'yearly';
    const price = isYearly
        ? Number(row.price_yearly_etb || 0)
        : Number(row.price_monthly_etb || 0);

    return price || 0;
};

// Generate invoice for subscription
const generateSubscriptionInvoice = async ({
    tenantId,
    tier,
    cycle,
    isProrated = false,
    prorationData = null,
    dueInDays = 7,
}) => {
    const nowIso = new Date().toISOString();
    const invoiceId = makeId('inv');
    const invoiceNumber = await generateInvoiceNumber(tenantId);

    const amount = await getPlanPricing(tier, cycle);
    const isYearly = String(cycle).toLowerCase() === 'yearly';

    let finalAmount = amount;
    let lineItems = [];

    if (isProrated && prorationData) {
        lineItems = [
            {
                description: `Credit for remaining ${prorationData.currentPlan} subscription`,
                qty: 1,
                unitPrice: -prorationData.creditAmount,
                amount: -prorationData.creditAmount,
            },
            {
                description: `${tier} Plan - ${cycle} (Prorated ${prorationData.daysRemaining} days)`,
                qty: 1,
                unitPrice: prorationData.chargeAmount,
                amount: prorationData.chargeAmount,
            },
        ];
        finalAmount = prorationData.netAmount;
    } else {
        lineItems = [
            {
                description: `${tier} Plan - ${cycle} Subscription`,
                qty: 1,
                unitPrice: amount,
                amount: amount,
            },
        ];
    }

    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + dueInDays * 24 * 60 * 60 * 1000);

    // Calculate period
    const periodStart = issueDate.toISOString().split('T')[0];
    const periodEndDate = new Date(issueDate);
    if (isYearly) {
        periodEndDate.setFullYear(periodEndDate.getFullYear() + 1);
    } else {
        periodEndDate.setMonth(periodEndDate.getMonth() + 1);
    }
    const periodEnd = periodEndDate.toISOString().split('T')[0];

    await db().from('invoices').insert({
        id: invoiceId,
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        type: 'subscription',
        status: 'pending',
        line_items_json: JSON.stringify(lineItems),
        subtotal_etb: finalAmount,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: finalAmount,
        currency: 'ETB',
        issue_date: issueDate.toISOString(),
        due_date: dueDate.toISOString(),
        paid_at: null,
        period_start: periodStart,
        period_end: periodEnd,
        notes: null,
        metadata_json: JSON.stringify({
            planTier: tier,
            cycle,
            isProrated,
            prorationData,
        }),
        created_at: nowIso,
        updated_at: nowIso,
    });

    return {
        invoiceId,
        invoiceNumber,
        amount: finalAmount,
        dueDate: dueDate.toISOString(),
        lineItems,
    };
};

// Create manual invoice
const createManualInvoice = async ({
    tenantId,
    lineItems,
    dueInDays = 7,
    notes = null,
    type = 'manual',
    metadata = null,
}) => {
    const nowIso = new Date().toISOString();
    const invoiceId = makeId('inv');
    const invoiceNumber = await generateInvoiceNumber(tenantId);

    const subtotal = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + dueInDays * 24 * 60 * 60 * 1000);

    await db().from('invoices').insert({
        id: invoiceId,
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        type,
        status: 'pending',
        line_items_json: JSON.stringify(lineItems),
        subtotal_etb: subtotal,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: subtotal,
        currency: 'ETB',
        issue_date: issueDate.toISOString(),
        due_date: dueDate.toISOString(),
        paid_at: null,
        period_start: null,
        period_end: null,
        notes,
        metadata_json: metadata != null ? JSON.stringify(metadata) : null,
        created_at: nowIso,
        updated_at: nowIso,
    });

    return {
        invoiceId,
        invoiceNumber,
        amount: subtotal,
        dueDate: dueDate.toISOString(),
    };
};

// Record payment submission
const recordPaymentSubmission = async ({
    invoiceId,
    tenantId,
    method,
    amount,
    reference = null,
    proofUrl = null,
    proofFilename = null,
    notes = null,
}) => {
    return db().transaction(async (trx) => {
        const nowIso = new Date().toISOString();
        const paymentId = makeId('pay');

        await trx('payments').insert({
            id: paymentId,
            invoice_id: invoiceId,
            tenant_id: tenantId,
            method,
            status: 'pending',
            amount_etb: amount,
            currency: 'ETB',
            reference,
            proof_url: proofUrl,
            proof_filename: proofFilename,
            gateway_response_json: null,
            gateway_tx_id: null,
            verified_by: null,
            verified_at: null,
            rejection_reason: null,
            notes,
            created_at: nowIso,
            updated_at: nowIso,
        });

        // Update invoice status
        await trx('invoices')
            .where({ id: invoiceId })
            .update({
                status: 'pending',
                updated_at: nowIso,
            });

        return { paymentId };
    });
};

// Verify payment (super admin action)
const verifyPayment = async ({ paymentId, verifiedBy }) => {
    return db().transaction(async (trx) => {
        const nowIso = new Date().toISOString();

        const payment = await trx('payments')
            .select(['id', 'invoice_id', 'tenant_id', 'amount_etb'])
            .where({ id: paymentId })
            .first();

        if (!payment) throw new Error('Payment not found');

        // Update payment status
        await trx('payments')
            .where({ id: paymentId })
            .update({
                status: 'verified',
                verified_by: verifiedBy,
                verified_at: nowIso,
                updated_at: nowIso,
            });

        // Update invoice status
        await trx('invoices')
            .where({ id: payment.invoice_id })
            .update({
                status: 'paid',
                paid_at: nowIso,
                updated_at: nowIso,
            });

        // Get invoice to check if it's subscription related
        const invoice = await trx('invoices')
            .select(['metadata_json'])
            .where({ id: payment.invoice_id })
            .first();

        const metadata = safeJsonParse(invoice?.metadata_json, {});

        // If subscription invoice, activate the subscription
        if (metadata.planTier) {
            await activateSubscription({
                tenantId: payment.tenant_id,
                tier: metadata.planTier,
                cycle: metadata.cycle,
                paymentId,
                invoiceId: payment.invoice_id,
            }, trx);
        }

        // If addon invoice, activate addon subscription
        if (metadata.addonId) {
            await activateAddonSubscription({
                tenantId: payment.tenant_id,
                addonId: String(metadata.addonId),
                billingFrequency: normalizeBillingFrequency(metadata.billingFrequency),
                pricePaidEtb: Number(payment.amount_etb || 0) || 0,
                paymentId,
                invoiceId: payment.invoice_id,
            }, trx);
        }

        // Record in subscription history
        await trx('subscription_history').insert({
            id: makeId('subh'),
            tenant_id: payment.tenant_id,
            action: 'payment_verified',
            to_tier: metadata.planTier || null,
            to_cycle: metadata.cycle || null,
            amount_etb: payment.amount_etb,
            invoice_id: payment.invoice_id,
            payment_id: paymentId,
            actor_type: 'superadmin',
            actor_id: verifiedBy,
            reason: null,
            metadata_json: null,
            created_at: nowIso,
        });

        return { success: true };
    });
};

const activateAddonSubscription = async ({ tenantId, addonId, billingFrequency, pricePaidEtb, paymentId, invoiceId }, trx) => {
    const query = trx || db();
    const nowIso = new Date().toISOString();

    const addon = await query('addon_packages').select(['id', 'is_available']).where({ id: addonId }).first();
    if (!addon) return { success: false, error: 'addon_not_found' };

    const freq = normalizeBillingFrequency(billingFrequency);
    const nextRenewal = (() => {
        const d = new Date();
        if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
        else d.setMonth(d.getMonth() + 1);
        return d.toISOString();
    })();

    // Upsert subscription row (by unique tenant_id + addon_id)
    const id = makeId('tas');
    await query('tenant_addon_subscriptions')
        .insert({
            id,
            tenant_id: tenantId,
            addon_id: addonId,
            status: 'active',
            billing_frequency: freq,
            price_paid_etb: pricePaidEtb,
            activation_date: nowIso,
            next_renewal_date: nextRenewal,
            cancellation_date: null,
            created_at: nowIso,
            updated_at: nowIso,
        })
        .onConflict(['tenant_id', 'addon_id'])
        .merge({
            status: 'active',
            billing_frequency: freq,
            price_paid_etb: pricePaidEtb,
            activation_date: nowIso,
            next_renewal_date: nextRenewal,
            cancellation_date: null,
            updated_at: nowIso,
        });

    // Track in subscription_history to reuse existing audit surface
    await query('subscription_history').insert({
        id: makeId('subh'),
        tenant_id: tenantId,
        action: 'addon_activated',
        from_tier: null,
        to_tier: null,
        from_cycle: null,
        to_cycle: null,
        amount_etb: pricePaidEtb,
        invoice_id: invoiceId || null,
        payment_id: paymentId || null,
        actor_type: 'system',
        actor_id: null,
        reason: null,
        metadata_json: JSON.stringify({ addonId, billingFrequency: freq }),
        created_at: nowIso,
    });

    return { success: true };
};

// Reject payment (super admin action)
const rejectPayment = async ({ paymentId, rejectedBy, reason }) => {
    return db().transaction(async (trx) => {
        const nowIso = new Date().toISOString();

        const payment = await trx('payments')
            .select(['id', 'invoice_id', 'tenant_id'])
            .where({ id: paymentId })
            .first();

        if (!payment) throw new Error('Payment not found');

        await trx('payments')
            .where({ id: paymentId })
            .update({
                status: 'rejected',
                rejection_reason: reason,
                verified_by: rejectedBy,
                verified_at: nowIso,
                updated_at: nowIso,
            });

        // Invoice stays pending for re-submission
        await trx('invoices')
            .where({ id: payment.invoice_id })
            .update({
                status: 'pending',
                updated_at: nowIso,
            });

        return { success: true };
    });
};

// Activate subscription after payment verification
const activateSubscription = async ({ tenantId, tier, cycle, paymentId, invoiceId }, trx) => {
    const query = trx || db();
    const nowIso = new Date().toISOString();

    // Get plan modules
    const planRow = await query('plans')
        .select(['modules_json', 'price_monthly_etb', 'price_yearly_etb'])
        .where({ tier })
        .first();

    const modules = safeJsonParse(planRow?.modules_json, []);
    const isYearly = String(cycle).toLowerCase() === 'yearly';
    const amount = isYearly
        ? Number(planRow?.price_yearly_etb || 0) || 0
        : Number(planRow?.price_monthly_etb || 0) || 0;

    // Calculate next bill date
    const nextBillDate = new Date();
    if (isYearly) {
        nextBillDate.setFullYear(nextBillDate.getFullYear() + 1);
    } else {
        nextBillDate.setMonth(nextBillDate.getMonth() + 1);
    }

    // Get grace days (tenant override or platform default)
    const config = await getPlatformPaymentConfig();
    const tenantPrefs = await query('tenant_subscription')
        .select(['grace_days'])
        .where({ tenant_id: tenantId })
        .first();

    const graceDays = tenantPrefs?.grace_days || config?.defaultGraceDays || 3;
    const graceEndsAt = new Date(nextBillDate.getTime() + graceDays * 24 * 60 * 60 * 1000);

    // Update subscription
    await query('tenant_subscription')
        .where({ tenant_id: tenantId })
        .update({
            tier,
            cycle,
            modules_json: JSON.stringify(modules),
            status: 'active',
            amount_etb: amount,
            next_bill_at: nextBillDate.toISOString(),
            grace_ends_at: graceEndsAt.toISOString(),
            requested_tier: null,
            requested_cycle: null,
            requested_at: null,
            updated_at: nowIso,
        });

    // Update tenant status to active
    await query('tenants')
        .where({ id: tenantId })
        .update({
            status: 'active',
            updated_at: nowIso,
        });

    return { success: true, nextBillAt: nextBillDate.toISOString() };
};

// Get invoices for a tenant
const getTenantInvoices = async ({ tenantId, limit = 50, offset = 0 }) => {
    const rows = await db()
        .select([
            'id',
            'invoice_number',
            'type',
            'status',
            'total_etb',
            'currency',
            'issue_date',
            'due_date',
            'paid_at',
            'period_start',
            'period_end',
        ])
        .from('invoices')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

    return rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        type: r.type,
        status: r.status,
        totalEtb: Number(r.total_etb || 0),
        currency: r.currency,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        paidAt: r.paid_at,
        periodStart: r.period_start,
        periodEnd: r.period_end,
    }));
};

// Get invoice details
const getInvoiceDetails = async (invoiceId) => {
    const invoice = await db()
        .select(['*'])
        .from('invoices')
        .where({ id: invoiceId })
        .first();

    if (!invoice) return null;

    const payments = await db()
        .select(['*'])
        .from('payments')
        .where({ invoice_id: invoiceId })
        .orderBy('created_at', 'desc');

    return {
        id: invoice.id,
        tenantId: invoice.tenant_id,
        invoiceNumber: invoice.invoice_number,
        type: invoice.type,
        status: invoice.status,
        lineItems: safeJsonParse(invoice.line_items_json, []),
        subtotalEtb: Number(invoice.subtotal_etb || 0),
        taxEtb: Number(invoice.tax_etb || 0),
        discountEtb: Number(invoice.discount_etb || 0),
        totalEtb: Number(invoice.total_etb || 0),
        currency: invoice.currency,
        issueDate: invoice.issue_date,
        dueDate: invoice.due_date,
        paidAt: invoice.paid_at,
        periodStart: invoice.period_start,
        periodEnd: invoice.period_end,
        notes: invoice.notes,
        metadata: safeJsonParse(invoice.metadata_json, {}),
        payments: payments.map((p) => ({
            id: p.id,
            method: p.method,
            status: p.status,
            amountEtb: Number(p.amount_etb || 0),
            reference: p.reference,
            proofUrl: p.proof_url,
            proofFilename: p.proof_filename,
            rejectionReason: p.rejection_reason,
            createdAt: p.created_at,
            verifiedAt: p.verified_at,
        })),
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at,
    };
};

// Check for due invoices (for cron job)
const checkDueInvoices = async () => {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // Find invoices due in 3 days
    const dueSoon = await db()
        .select(['id', 'tenant_id', 'invoice_number', 'total_etb', 'due_date'])
        .from('invoices')
        .where({ status: 'pending' })
        .andWhere('due_date', '<=', threeDaysFromNow.toISOString())
        .andWhere('due_date', '>', oneDayFromNow.toISOString());

    // Find invoices due tomorrow
    const dueTomorrow = await db()
        .select(['id', 'tenant_id', 'invoice_number', 'total_etb', 'due_date'])
        .from('invoices')
        .where({ status: 'pending' })
        .andWhere('due_date', '<=', oneDayFromNow.toISOString())
        .andWhere('due_date', '>', now.toISOString());

    // Find overdue invoices
    const overdue = await db()
        .select(['id', 'tenant_id', 'invoice_number', 'total_etb', 'due_date'])
        .from('invoices')
        .where({ status: 'pending' })
        .andWhere('due_date', '<', now.toISOString());

    // Update overdue invoices
    if (overdue.length > 0) {
        const overdueIds = overdue.map((i) => i.id);
        await db()
            .from('invoices')
            .whereIn('id', overdueIds)
            .update({ status: 'overdue', updated_at: now.toISOString() });
    }

    return {
        dueSoon,
        dueTomorrow,
        overdue,
    };
};

module.exports = {
    getPlatformPaymentConfig,
    generateInvoiceNumber,
    calculateProration,
    getPlanPricing,
    generateSubscriptionInvoice,
    createManualInvoice,
    recordPaymentSubmission,
    verifyPayment,
    rejectPayment,
    activateSubscription,
    activateAddonSubscription,
    getTenantInvoices,
    getInvoiceDetails,
    checkDueInvoices,
};
