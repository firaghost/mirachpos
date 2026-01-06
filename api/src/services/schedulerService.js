/**
 * Scheduler Service
 * 
 * Background job scheduler for:
 * - Payment reminder notifications (email + SMS)
 * - Overdue invoice handling
 * - Grace period expiration
 * - Daily report aggregation
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { checkDueInvoices } = require('./invoiceService');
const { runDailyAggregation, cleanupOldReports } = require('./reportAggregationService');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

// Job execution tracker
const jobStatus = {
    lastRun: {},
    isRunning: {},
};

// Get notification configuration
const getNotificationConfig = async () => {
    const row = await db()
        .select(['sms_config_json', 'bank_details_json'])
        .from('platform_payment_config')
        .where({ id: 1 })
        .first();

    return {
        sms: safeJsonParse(row?.sms_config_json, { enabled: false }),
        email: { enabled: true }, // Email is always enabled if SMTP is configured
    };
};

// Send notification (email or SMS)
const sendNotification = async ({ tenantId, invoiceId, type, channel, recipient, message, subject }) => {
    const nowIso = new Date().toISOString();
    const notificationId = makeId('notif');

    let status = 'pending';
    let errorMessage = null;

    try {
        if (channel === 'email') {
            // In production, integrate with email service (SendGrid, AWS SES, etc.)
            console.log(`[Scheduler] Email notification to ${recipient}: ${subject}`);
            console.log(`[Scheduler] Message: ${message}`);
            status = 'sent';
        } else if (channel === 'sms') {
            const config = await getNotificationConfig();
            if (!config.sms.enabled) {
                status = 'failed';
                errorMessage = 'SMS not configured';
            } else {
                // In production, integrate with SMS service (Africa's Talking, Twilio, etc.)
                console.log(`[Scheduler] SMS notification to ${recipient}: ${message}`);
                status = 'sent';
            }
        }
    } catch (e) {
        status = 'failed';
        errorMessage = e.message || 'Unknown error';
    }

    // Log the notification
    await db().from('billing_notifications').insert({
        id: notificationId,
        tenant_id: tenantId,
        invoice_id: invoiceId,
        type,
        channel,
        recipient,
        status,
        error_message: errorMessage,
        sent_at: status === 'sent' ? nowIso : null,
        created_at: nowIso,
    });

    return { notificationId, status, errorMessage };
};

// Check if notification was already sent recently
const wasNotificationSentRecently = async (tenantId, invoiceId, type, hoursAgo = 24) => {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();

    const existing = await db()
        .select(['id'])
        .from('billing_notifications')
        .where({ tenant_id: tenantId, invoice_id: invoiceId, type })
        .andWhere('status', 'sent')
        .andWhere('sent_at', '>=', cutoff)
        .first();

    return !!existing;
};

// Get tenant contact info for notifications
const getTenantContacts = async (tenantId) => {
    // First check payment prefs
    const prefs = await db()
        .select(['billing_email', 'billing_phone', 'email_reminders', 'sms_reminders'])
        .from('tenant_payment_prefs')
        .where({ tenant_id: tenantId })
        .first();

    // Fall back to owner staff member
    const owner = await db()
        .select(['phone'])
        .from('staff')
        .where({ tenant_id: tenantId })
        .andWhere(function () {
            this.where('role_name', 'like', '%Owner%').orWhere('role_name', 'like', '%owner%');
        })
        .first();

    return {
        email: prefs?.billing_email || null,
        phone: prefs?.billing_phone || owner?.phone || null,
        emailEnabled: prefs?.email_reminders !== false,
        smsEnabled: Boolean(prefs?.sms_reminders),
    };
};

// Job: Send payment reminders
const runPaymentReminderJob = async () => {
    if (jobStatus.isRunning.paymentReminders) {
        console.log('[Scheduler] Payment reminder job already running, skipping');
        return;
    }

    jobStatus.isRunning.paymentReminders = true;
    console.log('[Scheduler] Running payment reminder job...');

    try {
        const { dueSoon, dueTomorrow, overdue } = await checkDueInvoices();

        let remindersSent = 0;

        // Send 3-day reminders
        for (const invoice of dueSoon) {
            const alreadySent = await wasNotificationSentRecently(invoice.tenant_id, invoice.id, 'reminder_3day', 72);
            if (alreadySent) continue;

            const contacts = await getTenantContacts(invoice.tenant_id);
            if (!contacts.email && !contacts.phone) continue;

            const message = `Reminder: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is due on ${new Date(invoice.due_date).toLocaleDateString()}. Please complete payment to avoid service interruption.`;

            if (contacts.email && contacts.emailEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_3day',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `Payment Reminder: Invoice ${invoice.invoice_number}`,
                    message,
                });
                remindersSent++;
            }

            if (contacts.phone && contacts.smsEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_3day',
                    channel: 'sms',
                    recipient: contacts.phone,
                    message,
                });
                remindersSent++;
            }
        }

        // Send 1-day reminders
        for (const invoice of dueTomorrow) {
            const alreadySent = await wasNotificationSentRecently(invoice.tenant_id, invoice.id, 'reminder_1day', 24);
            if (alreadySent) continue;

            const contacts = await getTenantContacts(invoice.tenant_id);
            if (!contacts.email && !contacts.phone) continue;

            const message = `URGENT: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is due TOMORROW. Pay now to avoid service interruption.`;

            if (contacts.email && contacts.emailEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_1day',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `URGENT: Invoice ${invoice.invoice_number} Due Tomorrow`,
                    message,
                });
                remindersSent++;
            }

            if (contacts.phone && contacts.smsEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_1day',
                    channel: 'sms',
                    recipient: contacts.phone,
                    message,
                });
                remindersSent++;
            }
        }

        // Send overdue notifications
        for (const invoice of overdue) {
            const alreadySent = await wasNotificationSentRecently(invoice.tenant_id, invoice.id, 'overdue', 48);
            if (alreadySent) continue;

            const contacts = await getTenantContacts(invoice.tenant_id);
            if (!contacts.email && !contacts.phone) continue;

            const message = `OVERDUE: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is past due. Please pay immediately to restore full service access.`;

            if (contacts.email && contacts.emailEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'overdue',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `OVERDUE: Invoice ${invoice.invoice_number} Past Due`,
                    message,
                });
                remindersSent++;
            }

            if (contacts.phone && contacts.smsEnabled) {
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'overdue',
                    channel: 'sms',
                    recipient: contacts.phone,
                    message,
                });
                remindersSent++;
            }
        }

        console.log(`[Scheduler] Payment reminder job completed. Sent ${remindersSent} reminders.`);
        jobStatus.lastRun.paymentReminders = new Date().toISOString();
    } catch (e) {
        console.error('[Scheduler] Payment reminder job error:', e);
    } finally {
        jobStatus.isRunning.paymentReminders = false;
    }
};

// Job: Check grace period expirations
const runGracePeriodExpirationJob = async () => {
    if (jobStatus.isRunning.gracePeriod) {
        console.log('[Scheduler] Grace period job already running, skipping');
        return;
    }

    jobStatus.isRunning.gracePeriod = true;
    console.log('[Scheduler] Running grace period expiration job...');

    try {
        const nowIso = new Date().toISOString();

        // Find subscriptions where grace period has expired
        const expiredGrace = await db()
            .select(['tenant_id', 'status', 'grace_ends_at'])
            .from('tenant_subscription')
            .whereIn('status', ['active', 'past_due'])
            .andWhere('grace_ends_at', '<', nowIso);

        let suspended = 0;

        for (const sub of expiredGrace) {
            // Check if there's a pending payment
            const pendingPayment = await db()
                .select(['id'])
                .from('payments')
                .where({ tenant_id: sub.tenant_id, status: 'pending' })
                .first();

            if (pendingPayment) {
                console.log(`[Scheduler] Tenant ${sub.tenant_id} has pending payment, not suspending`);
                continue;
            }

            // Suspend the subscription
            await db()
                .from('tenant_subscription')
                .where({ tenant_id: sub.tenant_id })
                .update({
                    status: 'suspended',
                    updated_at: nowIso,
                });

            // Record in history
            await db().from('subscription_history').insert({
                id: makeId('subh'),
                tenant_id: sub.tenant_id,
                action: 'suspended',
                reason: 'Grace period expired without payment',
                actor_type: 'system',
                actor_id: null,
                metadata_json: JSON.stringify({ grace_ends_at: sub.grace_ends_at }),
                created_at: nowIso,
            });

            // Notify tenant
            const contacts = await getTenantContacts(sub.tenant_id);
            if (contacts.email && contacts.emailEnabled) {
                await sendNotification({
                    tenantId: sub.tenant_id,
                    invoiceId: null,
                    type: 'suspended',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: 'Account Suspended - Payment Required',
                    message: 'Your MirachPOS account has been suspended due to non-payment. Please complete payment to restore access.',
                });
            }

            suspended++;
        }

        console.log(`[Scheduler] Grace period job completed. Suspended ${suspended} accounts.`);
        jobStatus.lastRun.gracePeriod = new Date().toISOString();
    } catch (e) {
        console.error('[Scheduler] Grace period job error:', e);
    } finally {
        jobStatus.isRunning.gracePeriod = false;
    }
};

// Job: Daily report aggregation
const runReportAggregationJob = async () => {
    if (jobStatus.isRunning.reportAggregation) {
        console.log('[Scheduler] Report aggregation job already running, skipping');
        return;
    }

    jobStatus.isRunning.reportAggregation = true;
    console.log('[Scheduler] Running report aggregation job...');

    try {
        const result = await runDailyAggregation();
        console.log(`[Scheduler] Report aggregation completed for ${result.date}: ${result.processed} branches processed`);

        // Also cleanup old data
        const cleanup = await cleanupOldReports();
        console.log(`[Scheduler] Cleanup completed: ${cleanup.deleted} old records removed`);

        jobStatus.lastRun.reportAggregation = new Date().toISOString();
    } catch (e) {
        console.error('[Scheduler] Report aggregation job error:', e);
    } finally {
        jobStatus.isRunning.reportAggregation = false;
    }
};

// Schedule configuration
const SCHEDULE = {
    paymentReminders: 6 * 60 * 60 * 1000, // Every 6 hours
    gracePeriod: 60 * 60 * 1000, // Every hour
    reportAggregation: 24 * 60 * 60 * 1000, // Every 24 hours
};

let schedulerIntervals = {};
let schedulerStarted = false;

// Start the scheduler
const startScheduler = () => {
    if (schedulerStarted) {
        console.log('[Scheduler] Already started');
        return;
    }

    console.log('[Scheduler] Starting background jobs...');

    // Payment reminders - every 6 hours
    schedulerIntervals.paymentReminders = setInterval(runPaymentReminderJob, SCHEDULE.paymentReminders);

    // Grace period check - every hour
    schedulerIntervals.gracePeriod = setInterval(runGracePeriodExpirationJob, SCHEDULE.gracePeriod);

    // Report aggregation - every 24 hours
    schedulerIntervals.reportAggregation = setInterval(runReportAggregationJob, SCHEDULE.reportAggregation);

    // Run initial jobs after a short delay
    setTimeout(() => {
        runPaymentReminderJob();
        runGracePeriodExpirationJob();
    }, 30 * 1000); // 30 seconds after startup

    // Run report aggregation at a specific time (e.g., 2 AM)
    const scheduleReportAggregation = () => {
        const now = new Date();
        const targetHour = 2; // 2 AM
        const nextRun = new Date(now);
        nextRun.setHours(targetHour, 0, 0, 0);
        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }
        const delay = nextRun.getTime() - now.getTime();

        setTimeout(() => {
            runReportAggregationJob();
            scheduleReportAggregation(); // Schedule next run
        }, delay);

        console.log(`[Scheduler] Report aggregation scheduled for ${nextRun.toISOString()}`);
    };

    scheduleReportAggregation();

    schedulerStarted = true;
    console.log('[Scheduler] Background jobs started');
};

// Stop the scheduler
const stopScheduler = () => {
    console.log('[Scheduler] Stopping background jobs...');

    for (const key of Object.keys(schedulerIntervals)) {
        clearInterval(schedulerIntervals[key]);
    }
    schedulerIntervals = {};
    schedulerStarted = false;

    console.log('[Scheduler] Background jobs stopped');
};

// Get scheduler status
const getSchedulerStatus = () => {
    return {
        started: schedulerStarted,
        jobs: {
            paymentReminders: {
                lastRun: jobStatus.lastRun.paymentReminders || null,
                isRunning: Boolean(jobStatus.isRunning.paymentReminders),
                interval: SCHEDULE.paymentReminders,
            },
            gracePeriod: {
                lastRun: jobStatus.lastRun.gracePeriod || null,
                isRunning: Boolean(jobStatus.isRunning.gracePeriod),
                interval: SCHEDULE.gracePeriod,
            },
            reportAggregation: {
                lastRun: jobStatus.lastRun.reportAggregation || null,
                isRunning: Boolean(jobStatus.isRunning.reportAggregation),
                interval: SCHEDULE.reportAggregation,
            },
        },
    };
};

module.exports = {
    startScheduler,
    stopScheduler,
    getSchedulerStatus,
    runPaymentReminderJob,
    runGracePeriodExpirationJob,
    runReportAggregationJob,
    sendNotification,
};
