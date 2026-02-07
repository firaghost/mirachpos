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
const { createMailTransporter } = require('../utils/mail');
const { paymentReminderTemplate, overdueTemplate, suspendedTemplate } = require('./emailTemplates');

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
const sendNotification = async ({ tenantId, invoiceId, type, channel, recipient, message, subject, html }) => {
    const nowIso = new Date().toISOString();
    const notificationId = makeId('notif');

    let status = 'pending';
    let errorMessage = null;

    try {
        if (channel === 'email') {
            const transporter = createMailTransporter();
            if (!transporter) {
                status = 'failed';
                errorMessage = 'Email service not configured';
                console.error('[Scheduler] Email service not configured - check MAIL_HOST, MAIL_USER, MAIL_PASS');
            } else {
                await transporter.sendMail({
                    from: `"MirachPOS" <${process.env.MAIL_FROM || process.env.MAIL_USERNAME}>`,
                    to: recipient,
                    subject,
                    text: message,
                    html: html || `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
        .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>MirachPOS</h1>
    </div>
    <div class="content">
        <p>${message.replace(/\n/g, '<br>')}</p>
        <div class="footer">
            <p>This is an automated message from MirachPOS.<br>
            Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>`,
                });
                status = 'sent';
                console.log(`[Scheduler] Email sent successfully to ${recipient}: ${subject}`);
            }
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

            const daysRemaining = 3;
            const message = `Reminder: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is due on ${new Date(invoice.due_date).toLocaleDateString()}. Please complete payment to avoid service interruption.`;

            if (contacts.email && contacts.emailEnabled) {
                const html = paymentReminderTemplate({
                    invoiceNumber: invoice.invoice_number,
                    amount: invoice.total_etb,
                    dueDate: invoice.due_date,
                    daysRemaining,
                });
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_3day',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `Payment Reminder: Invoice ${invoice.invoice_number}`,
                    message,
                    html,
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

            const daysRemaining = 1;
            const message = `URGENT: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is due TOMORROW. Pay now to avoid service interruption.`;

            if (contacts.email && contacts.emailEnabled) {
                const html = paymentReminderTemplate({
                    invoiceNumber: invoice.invoice_number,
                    amount: invoice.total_etb,
                    dueDate: invoice.due_date,
                    daysRemaining,
                });
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'reminder_1day',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `URGENT: Invoice ${invoice.invoice_number} Due Tomorrow`,
                    message,
                    html,
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

            const daysOverdue = Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24));
            const message = `OVERDUE: Your invoice ${invoice.invoice_number} for ETB ${invoice.total_etb} is past due. Please pay immediately to restore full service access.`;

            if (contacts.email && contacts.emailEnabled) {
                const html = overdueTemplate({
                    invoiceNumber: invoice.invoice_number,
                    amount: invoice.total_etb,
                    dueDate: invoice.due_date,
                    daysOverdue,
                });
                await sendNotification({
                    tenantId: invoice.tenant_id,
                    invoiceId: invoice.id,
                    type: 'overdue',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: `OVERDUE: Invoice ${invoice.invoice_number} Past Due`,
                    message,
                    html,
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
                const html = suspendedTemplate({ tenantName: '' });
                await sendNotification({
                    tenantId: sub.tenant_id,
                    invoiceId: null,
                    type: 'suspended',
                    channel: 'email',
                    recipient: contacts.email,
                    subject: 'Account Suspended - Payment Required',
                    message: 'Your MirachPOS account has been suspended due to non-payment. Please complete payment to restore access.',
                    html,
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
const SCHEDULE = {
    paymentReminders: 6 * 60 * 60 * 1000, // Every 6 hours
    gracePeriod: 60 * 60 * 1000, // Every hour
    reportAggregation: 24 * 60 * 60 * 1000, // Every 24 hours
    scheduledReportEmails: 24 * 60 * 60 * 1000, // Send scheduled report emails
};

const runScheduledReportEmailsJob = async () => {
    if (jobStatus.isRunning.scheduledReportEmails) return;
    jobStatus.isRunning.scheduledReportEmails = true;

    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const dayOfMonth = now.getDate();

        // Determine which frequencies should run today
        const frequenciesToRun = ['daily'];
        if (dayOfWeek === 1) frequenciesToRun.push('weekly'); // Monday
        if (dayOfMonth === 1) frequenciesToRun.push('monthly'); // 1st of month

        const schedules = await db()
            .select(['id', 'tenant_id', 'branch_id', 'frequency', 'emails'])
            .from('report_email_schedules')
            .where({ is_active: true })
            .whereIn('frequency', frequenciesToRun);

        const transporter = createMailTransporter();
        if (!transporter) {
            console.error('[Scheduler] Cannot send report emails - mail not configured');
            return;
        }

        for (const schedule of schedules) {
            try {
                const emails = safeJsonParse(schedule.emails, []);
                if (!emails.length) continue;

                const tenant = await db()
                    .select(['slug', 'name'])
                    .from('tenants')
                    .where({ id: schedule.tenant_id })
                    .first();

                const branch = schedule.branch_id
                    ? await db().select(['name']).from('branches').where({ id: schedule.branch_id }).first()
                    : null;

                // Generate simple report summary
                const from = today;
                const to = today;
                const { getDailySalesSummary } = require('./reportAggregationService');
                const daily = await getDailySalesSummary({
                    tenantId: schedule.tenant_id,
                    branchId: schedule.branch_id,
                    fromDate: from,
                    toDate: to,
                });

                const summary = daily[0] || { netSales: 0, orderCount: 0, avgTicket: 0 };

                const subject = `MirachPOS Report - ${today} - ${tenant?.name || 'Your Business'}`;
                const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #eead2b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
        .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
        .metric:last-child { border-bottom: none; }
        .label { color: #6b7280; }
        .value { font-weight: bold; color: #111827; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="header">
        <h1>MirachPOS</h1>
        <p>${tenant?.name || 'Your Business'} - ${branch?.name || 'All Locations'}</p>
    </div>
    <div class="content">
        <h2>Daily Report - ${today}</h2>
        <div class="metric">
            <span class="label">Net Sales:</span>
            <span class="value">ETB ${summary.netSales?.toFixed(2) || '0.00'}</span>
        </div>
        <div class="metric">
            <span class="label">Orders:</span>
            <span class="value">${summary.orderCount || 0}</span>
        </div>
        <div class="metric">
            <span class="label">Avg Ticket:</span>
            <span class="value">ETB ${summary.avgTicket?.toFixed(2) || '0.00'}</span>
        </div>
        <div class="footer">
            <p>This is an automated report from MirachPOS.<br>
            Frequency: ${schedule.frequency} | 
            <a href="${process.env.APPS_URL || 'https://apps.mirachpos.com'}">View Dashboard</a></p>
        </div>
    </div>
</body>
</html>`;

                for (const email of emails) {
                    await transporter.sendMail({
                        from: `"MirachPOS" <${process.env.MAIL_FROM || process.env.MAIL_USERNAME}>`,
                        to: email,
                        subject,
                        html,
                    });
                    console.log(`[Scheduler] Report email sent to ${email} for tenant ${schedule.tenant_id}`);
                }

                // Update last run timestamp
                await db()
                    .from('report_email_schedules')
                    .where({ id: schedule.id })
                    .update({ last_run_at: new Date().toISOString() });

            } catch (err) {
                console.error(`[Scheduler] Failed to send report for schedule ${schedule.id}:`, err.message);
            }
        }

        jobStatus.lastRun.scheduledReportEmails = new Date().toISOString();
    } catch (e) {
        console.error('[Scheduler] Error in scheduled report emails job:', e.message);
    } finally {
        jobStatus.isRunning.scheduledReportEmails = false;
    }
};

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

    // Scheduled report emails - every 24 hours at 8 AM
    const scheduleReportEmails = () => {
        const now = new Date();
        const targetHour = 8; // 8 AM
        const nextRun = new Date(now);
        nextRun.setHours(targetHour, 0, 0, 0);
        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }
        const delay = nextRun.getTime() - now.getTime();

        setTimeout(() => {
            runScheduledReportEmailsJob();
            scheduleReportEmails(); // Schedule next run
        }, delay);

        console.log(`[Scheduler] Report emails scheduled for ${nextRun.toISOString()}`);
    };

    scheduleReportEmails();

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
            scheduledReportEmails: {
                lastRun: jobStatus.lastRun.scheduledReportEmails || null,
                isRunning: Boolean(jobStatus.isRunning.scheduledReportEmails),
                interval: SCHEDULE.scheduledReportEmails,
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
    runScheduledReportEmailsJob,
    sendNotification,
};
