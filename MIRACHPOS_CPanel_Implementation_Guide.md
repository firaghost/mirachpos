# MirachPOS Production Analysis & cPanel Implementation Guide

**Date:** 2026-02-04  
**Scope:** Email system, Trial flow, Password reset, cPanel deployment  
**Target:** Production-ready setup on cPanel shared hosting

---

## 🔍 Current System State Analysis

### ✅ What's Already Built (Good)

#### 1. Email Infrastructure
- **Mail utility:** `api/src/utils/mail.js` - Creates nodemailer transporter
- **Welcome email:** Sent after trial signup with workspace details
- **Password reset:** OTP-based system exists
- **Premium email template:** HTML + text versions with branding

#### 2. Trial System
- **Auto-provisioning:** 14-day trial created on signup
- **Database tracking:** `trial_ends_at` in tenants table
- **Plan tiers:** Trial → Starter → Growth → Pro
- **Soft downgrade:** `maybeDowngradeDueSubscription()` checks billing

#### 3. Authentication Flow
- Email/password login
- PIN login for waiters
- JWT token auth with tenant isolation
- Password reset with 6-digit OTP

#### 4. Landing Page Integration
- Registration form collects: restaurant, owner, phone, email, password
- Turnstile bot protection
- Calls `/api/public/signup` endpoint
- Auto-creates tenant + trial + logs user in

---

## 🚨 Critical Gaps Found

### 1. Trial Expiration Enforcement is WEAK
**Problem:** Trial expiration exists but doesn't block login/system access properly.

**Current behavior:**
- `trial_ends_at` is set but only checked in `maybeDowngradeDueSubscription()`
- Users can still log in after trial expires
- No hard block on system usage

**Impact:** Free users forever = no revenue

---

### 2. cPanel Email Configuration Missing
**Problem:** No documentation for cPanel SMTP setup.

cPanel uses specific settings:
- SMTP Host: `mail.yourdomain.com` or server IP
- Ports: 465 (SSL) or 587 (TLS)
- Auth: cPanel email + password
- Important: cPanel has hourly sending limits (usually 250-500/hour)

---

### 3. Password Reset Email Delivery Issues
**Problem:** Password reset email has fallback logic but may fail silently.

**Current issues:**
- Port 587 → fallback to 465, but no error logging to admin
- If email fails, user never knows
- No queue/retry mechanism

---

### 4. No Support Ticket System
**Problem:** Contact form on landing page has no backend integration.

Users can message but:
- No ticket tracking
- No email notification to you
- No CRM integration

---

### 5. Trial to Paid Conversion Flow is Broken
**Problem:** No automated upgrade flow exists.

Current gaps:
- No in-app billing page
- No "trial expires in X days" warnings
- No auto-downgrade to free plan
- No payment link generation

---

## 📋 cPanel-Specific Implementation Guide

### Phase 1: Email Configuration (1-2 hours)

#### Step 1: Create Email Account in cPanel
1. Log in to cPanel
2. Go to **Email Accounts**
3. Create: `noreply@mirachpos.com` (for system emails)
4. Create: `support@mirachpos.com` (for customer support)
5. Note the passwords

#### Step 2: Configure Environment Variables
Edit your `.env` file on cPanel (via File Manager or SSH):

```bash
# cPanel SMTP Settings (Option A: SSL)
MAIL_HOST=mail.mirachpos.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USERNAME=noreply@mirachpos.com
MAIL_PASSWORD=your_strong_password
MAIL_FROM=noreply@mirachpos.com
CONTACT_RECEIVER_EMAIL=support@mirachpos.com

# Alternative (Option B: TLS)
# MAIL_HOST=mail.mirachpos.com
# MAIL_PORT=587
# MAIL_SECURE=false
```

**Note:** If `mail.mirachpos.com` doesn't work, use your server's hostname from cPanel (e.g., `server123.hostinger.com`)

#### Step 3: Test Email Configuration
Create a test file `test-email.js`:

```javascript
const { createMailTransporter } = require('./api/src/utils/mail');

async function test() {
  const transporter = createMailTransporter();
  if (!transporter) {
    console.error('Mail not configured');
    return;
  }
  
  try {
    await transporter.sendMail({
      from: '"MirachPOS" <noreply@mirachpos.com>',
      to: 'your-email@gmail.com',
      subject: 'Test Email from MirachPOS',
      text: 'If you receive this, email is working!',
    });
    console.log('Email sent successfully!');
  } catch (err) {
    console.error('Email failed:', err.message);
  }
}

test();
```

Run: `node test-email.js`

#### Step 4: cPanel Email Rate Limits
**Important:** cPanel has limits (usually 250-500 emails/hour).

Implement batching for bulk operations:
```javascript
// Add to your config
const EMAIL_RATE_LIMIT = {
  maxPerHour: 250,
  batchSize: 50,
  delayBetweenBatches: 60000 // 1 minute
};
```

---

### Phase 2: Fix Trial Enforcement (2-3 hours)

#### Step 1: Create Trial Check Middleware
Create `api/src/middleware/trialCheck.js`:

```javascript
const { db } = require('../db');

const checkTrialStatus = async (req, res, next) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) return next();

    const tenant = await db()
      .select(['id', 'status', 'trial_ends_at', 'plan'])
      .from('tenants')
      .where({ id: tenantId })
      .first();

    if (!tenant) return next();

    // Check if trial expired
    if (tenant.trial_ends_at) {
      const trialEnd = new Date(tenant.trial_ends_at);
      const now = new Date();
      
      if (now > trialEnd && tenant.plan === 'trial') {
        // Trial expired, check if they have subscription
        const sub = await db()
          .select(['status', 'tier'])
          .from('tenant_subscription')
          .where({ tenant_id: tenantId })
          .first();

        // If no active paid subscription, block access
        if (!sub || sub.status !== 'active') {
          return res.status(403).json({
            error: 'TRIAL_EXPIRED',
            message: 'Your trial has expired. Please subscribe to continue.',
            upgradeUrl: '/billing',
            expiredAt: tenant.trial_ends_at
          });
        }
      }
    }

    // Attach trial info to request
    req.trialInfo = {
      isTrial: tenant.plan === 'trial',
      trialEndsAt: tenant.trial_ends_at,
      daysRemaining: tenant.trial_ends_at 
        ? Math.ceil((new Date(tenant.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
        : null
    };

    next();
  } catch (err) {
    console.error('Trial check error:', err);
    next();
  }
};

module.exports = { checkTrialStatus };
```

#### Step 2: Apply Middleware to All Protected Routes
Edit `api/src/app.js`:

```javascript
// After auth routes, add trial check
const { checkTrialStatus } = require('./middleware/trialCheck');

// Apply to all API routes except public
app.use('/api/waiter', requireAuth, checkTrialStatus, makeWaiterRouter());
app.use('/api/manager', requireAuth, checkTrialStatus, makeManagerRouter());
app.use('/api/owner', requireAuth, checkTrialStatus, makeOwnerRouter());
app.use('/api/pos', requireAuth, checkTrialStatus, makePosRouter());
// ... etc
```

#### Step 3: Add Trial Warning Headers
Modify the trial check middleware to add headers:

```javascript
// Add to response headers for frontend to show warnings
res.set('X-Trial-Status', req.trialInfo.isTrial ? 'trial' : 'active');
if (req.trialInfo.daysRemaining !== null) {
  res.set('X-Trial-Days-Remaining', String(req.trialInfo.daysRemaining));
}
```

#### Step 4: Frontend Trial Banner
Create a component that reads these headers and shows warnings:

```typescript
// components/TrialBanner.tsx
import { useEffect, useState } from 'react';

export function TrialBanner() {
  const [trialInfo, setTrialInfo] = useState({ days: null, isTrial: false });

  useEffect(() => {
    // Read from recent API response headers
    const days = localStorage.getItem('trial_days_remaining');
    const isTrial = localStorage.getItem('trial_status') === 'trial';
    if (days) setTrialInfo({ days: parseInt(days), isTrial });
  }, []);

  if (!trialInfo.isTrial || trialInfo.days === null) return null;
  
  if (trialInfo.days <= 0) {
    return (
      <div className="bg-red-600 text-white p-4 text-center">
        <strong>Trial Expired!</strong> 
        Your trial has ended. <a href="/billing" className="underline">Subscribe now</a> to continue.
      </div>
    );
  }
  
  if (trialInfo.days <= 3) {
    return (
      <div className="bg-yellow-500 text-black p-4 text-center">
        <strong>Trial ending soon!</strong> 
        {trialInfo.days} days remaining. <a href="/billing" className="underline">Upgrade</a>
      </div>
    );
  }
  
  return null;
}
```

---

### Phase 3: Password Reset Improvements (1 hour)

#### Step 1: Add Better Error Logging
Edit `api/src/routes/auth.js` forgot-password section:

```javascript
// After email send attempt, log to admin
if (!sent) {
  // Notify admin of email failure
  await db('admin_alerts').insert({
    type: 'email_failed',
    message: `Password reset email failed for ${email}`,
    error: debug.mail?.error || 'unknown',
    created_at: new Date().toISOString()
  });
}
```

#### Step 2: Add Resend with Cooldown
Add rate limiting for resends:

```javascript
const otpResends = new Map(); // In production, use Redis

const canResendOtp = (email) => {
  const lastSend = otpResends.get(email);
  if (!lastSend) return true;
  const minutesSince = (Date.now() - lastSend) / 60000;
  return minutesSince >= 2; // 2 minute cooldown
};
```

---

### Phase 4: Support Ticket System (3-4 hours)

#### Step 1: Create Support Tables
Migration file:

```javascript
exports.up = async (knex) => {
  await knex.schema.createTable('support_tickets', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').unsigned().nullable();
    table.string('email', 255).notNullable();
    table.string('name', 255).notNullable();
    table.string('subject', 255).notNullable();
    table.text('message').notNullable();
    table.enum('status', ['open', 'in_progress', 'resolved', 'closed']).defaultTo('open');
    table.enum('priority', ['low', 'medium', 'high', 'urgent']).defaultTo('medium');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('resolved_at').nullable();
    
    table.index(['status', 'created_at']);
    table.index(['tenant_id']);
  });

  await knex.schema.createTable('support_ticket_replies', (table) => {
    table.increments('id').primary();
    table.integer('ticket_id').unsigned().notNullable();
    table.integer('staff_id').unsigned().nullable(); // null = customer reply via email
    table.text('message').notNullable();
    table.boolean('is_internal').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('ticket_id').references('id').inTable('support_tickets').onDelete('CASCADE');
  });
};
```

#### Step 2: Create Support API Endpoint

```javascript
// api/src/routes/support.js
router.post('/support/tickets', async (req, res) => {
  const { email, name, subject, message, tenantId } = req.body;
  
  // Save ticket
  const [ticketId] = await db('support_tickets').insert({
    tenant_id: tenantId || null,
    email,
    name,
    subject,
    message,
    status: 'open',
    created_at: new Date().toISOString()
  });
  
  // Send confirmation to customer
  await sendSupportConfirmation({ to: email, ticketId, subject });
  
  // Notify admin
  await sendAdminNotification({
    to: config.mail.receiver,
    subject: `New Support Ticket #${ticketId}: ${subject}`,
    message: `From: ${name} (${email})\n\n${message}`
  });
  
  res.json({ ok: true, ticketId });
});
```

---

### Phase 5: Billing/Upgrade Flow (4-6 hours)

#### Step 1: Create Simple Billing Page
Create `api/src/routes/billing.js`:

```javascript
router.get('/billing/plans', requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  
  const [currentSub, plans] = await Promise.all([
    db('tenant_subscription').where({ tenant_id: tenantId }).first(),
    db('plans').select(['tier', 'price_monthly_etb', 'limits_json'])
  ]);
  
  res.json({
    current: currentSub,
    plans: plans.map(p => ({
      id: p.tier,
      name: p.tier,
      price: p.price_monthly_etb,
      limits: JSON.parse(p.limits_json || '{}')
    }))
  });
});

router.post('/billing/subscribe', requireAuth, async (req, res) => {
  const { planId, paymentMethod } = req.body;
  const tenantId = req.user.tenant_id;
  
  // Generate invoice
  const plan = await db('plans').where({ tier: planId }).first();
  const invoiceNumber = `INV-${Date.now()}`;
  
  const [invoiceId] = await db('invoices').insert({
    tenant_id: tenantId,
    invoice_number: invoiceNumber,
    amount_etb: plan.price_monthly_etb,
    status: 'pending',
    created_at: new Date().toISOString()
  });
  
  // Return payment instructions
  res.json({
    ok: true,
    invoiceId,
    invoiceNumber,
    amount: plan.price_monthly_etb,
    paymentMethods: {
      telebirr: { account: '0940111111', name: 'MirachPOS' },
      bank: { bank: 'CBE', account: '1000123456789', name: 'MirachPOS Trading' }
    }
  });
});
```

#### Step 2: Payment Verification Flow
After customer pays, they upload proof:

```javascript
router.post('/billing/upload-proof', requireAuth, multer.single('proof'), async (req, res) => {
  const { invoiceId } = req.body;
  const filePath = req.file.path;
  
  await db('invoice_payments').insert({
    invoice_id: invoiceId,
    proof_url: filePath,
    status: 'pending_verification',
    created_at: new Date().toISOString()
  });
  
  // Notify admin
  await sendAdminNotification({
    subject: `Payment Proof Uploaded - Invoice ${invoiceId}`,
    message: `Please verify and activate subscription.`
  });
  
  res.json({ ok: true, message: 'Proof uploaded. We will verify within 24 hours.' });
});
```

---

## 🔧 cPanel Deployment Checklist

### Server Requirements
- [x] Node.js 20+ installed (via cPanel Setup Node.js App)
- [x] MySQL database created
- [x] Run all migrations
- [x] Environment variables configured
- [x] Email accounts created

### Security
- [x] SSL certificate installed (Let's Encrypt)
- [x] JWT_SECRET set to strong random value
- [x] Turnstile keys configured
- [x] Rate limiting enabled

### Monitoring
- [x] Worker process available (scheduler + job worker)
- [x] Cron job for daily trial expiration check (cron mode)
- [ ] Log rotation configured
- [x] Error alerting setup (email on 500 errors)

**Notes (already implemented in code):**

- **Critical error alerts (email)** are sent on:
  - `unhandledRejection`
  - `uncaughtException`
  - unexpected API errors (500-class that hit the centralized error handler)
- **Background scheduler + DB job worker** are started by default unless disabled.

**Where:**

- Alerts: `api/src/utils/alerting.js`, `api/src/utils/errors.js`, `api/src/index.js`
- Background services: `api/src/services/schedulerService.js`, `api/src/services/jobService.js`, `api/src/index.js`

### Monitoring: cPanel setup (recommended)

#### Option A (Recommended): Run a dedicated Worker Node app

Create a second cPanel **Setup Node.js App** entry for the worker and set:

```bash
BACKGROUND_DISABLED=false
CLUSTER_MODE=false
```

For the web process, set:

```bash
BACKGROUND_DISABLED=true
CLUSTER_MODE=false
```

This ensures only the worker runs scheduled/background tasks.

#### Option B: Cron-only mode (if you cannot keep a worker running)

If you choose not to run a worker continuously, you can use cPanel Cron Jobs to invoke the same logic periodically. Prefer Option A.

**Cron entrypoint (already added):** `api/src/cronDaily.js`

In **cPanel → Cron Jobs**, add a daily cron (example: 2:15am server time):

```bash
/bin/bash -lc 'cd /home/<cpanel-user>/<your-app-root>/api && node src/cronDaily.js >> /home/<cpanel-user>/logs/mirachpos-cron.log 2>&1'
```

**Recommended web process env (cron mode):**

```bash
BACKGROUND_DISABLED=true
CLUSTER_MODE=false
```

This keeps the HTTP app lightweight and ensures the cron is responsible for enforcement.

### Error alerting: required env

Alerts use the same SMTP config and deliver to `CONTACT_RECEIVER_EMAIL`.

```bash
CONTACT_RECEIVER_EMAIL=support@mirachpos.com
ALERT_COOLDOWN_MS=300000
```

### Log rotation (cPanel-friendly)

MirachPOS logs to stdout/stderr (cPanel captures these). Configure log rotation at the hosting level:

- If your host exposes an "Application logs" rotation setting, enable it.
- If you have SSH access, rotate the cPanel app log files daily with retention (7-30 days).

If you do **not** have SSH or a managed rotation feature, you can rotate the cron log you create yourself (e.g. `~/logs/mirachpos-cron.log`) using a simple cron job:

```bash
/bin/bash -lc 'mkdir -p /home/<cpanel-user>/logs && if [ -f /home/<cpanel-user>/logs/mirachpos-cron.log ]; then ts=$(date -u +%Y%m%d_%H%M%S); cp /home/<cpanel-user>/logs/mirachpos-cron.log /home/<cpanel-user>/logs/mirachpos-cron.log.$ts && gzip -f /home/<cpanel-user>/logs/mirachpos-cron.log.$ts && : > /home/<cpanel-user>/logs/mirachpos-cron.log; fi'
```

Then add a weekly cleanup cron (keep last 30 rotated logs):

```bash
/bin/bash -lc 'ls -1t /home/<cpanel-user>/logs/mirachpos-cron.log.*.gz 2>/dev/null | tail -n +31 | xargs -r rm -f'
```

If you later move to a VPS/container setup, run the Node app under a process manager (e.g. PM2) and enable pm2-logrotate.

---

## � Backups Strategy (MySQL) — cPanel Friendly

### Goals
1. Daily automated database backups
2. Compressed storage + retention policy
3. Documented restore procedure

### Backup Script
File: `api/scripts/backup_mysql.sh`

**Note:** This script already exists in the repo and uses `mysqldump` + gzip.

**Prerequisite:** Ensure `mysqldump` is available in cron PATH. If it is not, use a full path (common examples: `/usr/bin/mysqldump` or `/usr/local/bin/mysqldump`).

### Environment Variables (cPanel)
Set these in your cPanel Node app environment (or in a cron wrapper):

```bash
DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...

# Backup settings
BACKUP_DIR=/home/<cpanel-user>/backups/mirachpos/mysql
RETENTION_DAYS=14
```

### Cron Job (Daily)
In **cPanel → Cron Jobs**, add (example: daily at 2:15am UTC):

```bash
/bin/bash -lc 'cd /home/<cpanel-user>/<your-app-root>/api && chmod +x scripts/backup_mysql.sh && ./scripts/backup_mysql.sh >> /home/<cpanel-user>/backups/mirachpos/backup.log 2>&1'
```

**Retention:** backups older than `RETENTION_DAYS` are deleted automatically by the script.

### Restore Procedure (Emergency)
1. Pick the backup file (example):
   `backups/mirachpos/mysql/<db>_YYYYMMDD_HHMMSS.sql.gz`
2. Restore:

```bash
gunzip -c <backup-file>.sql.gz | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"
```

### Recommended Extra Safety
- Keep at least 1 weekly offsite copy (download to local or store in another server/storage)
- Protect backup folder from public web access (store outside `public_html`)

---

## ⚡ Redis Caching (Optional)

The API supports Redis-backed caching with an in-memory fallback.

### Environment Variables
```bash
# Option A: full URL
REDIS_URL=redis://:<password>@<host>:<port>/<db>

# Option B: host/port
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...
REDIS_DB=0

# Cache controls
CACHE_DISABLED=false
CACHE_KEY_PREFIX=mirachpos:
CACHE_DEFAULT_TTL_SECONDS=60
CACHE_REPORT_TTL_SECONDS=120
```

### Notes
- If Redis is not configured, caching falls back to in-memory (per process)
- You can disable caching quickly with `CACHE_DISABLED=true`

---

## 🧵 Worker Processes (Background Jobs)

MirachPOS supports running background work separately from the HTTP server.

### Web process (HTTP only)
Set:

```bash
BACKGROUND_DISABLED=true
```

Start web:

```bash
node api/src/index.js
```

### Worker process (scheduler + job worker)
Start worker:

```bash
npm --prefix api run worker
```

### Notes
- On cPanel, configure **two Node apps** (or one Node app + a cron/supervisor) if you want both web + worker running
- In cluster mode, background services run only in the primary process (unless disabled)

---

## �� Success Metrics

After implementing:

| Metric | Target |
|--------|--------|
| Email delivery rate | >95% |
| Trial to paid conversion | >20% |
| Password reset success | >90% |
| Support response time | <24 hours |
| System uptime | >99% |

---

## ⏱️ Implementation Timeline

| Phase | Time | Priority |
|-------|------|----------|
| Email config | 2h | P0 |
| Trial enforcement | 3h | P0 |
| Password reset fixes | 1h | P1 |
| Support tickets | 4h | P1 |
| Billing flow | 6h | P2 |
| **Total** | **~16 hours** | |

---

## 🚨 Critical: Do These First (P0)

1. **Fix cPanel email config** - or no emails work
2. **Enable trial enforcement** - or you give away product free forever
3. **Set JWT_SECRET** - or security is broken

After these 3, your system is production-ready for paying customers.