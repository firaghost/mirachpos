/**
 * Migration: Invoices and Payments System
 * 
 * Creates proper billing infrastructure for subscription management:
 * - invoices: Complete invoice records with line items
 * - payments: Payment records with proof uploads and verification
 * - payment_methods_config: Tenant's saved payment preferences
 * - subscription_history: Audit log of all plan changes
 * - platform_payment_config: Global payment gateway settings
 */

exports.up = async (knex) => {
  // Platform-wide payment configuration (bank details, gateway keys, etc.)
  await knex.schema.createTable('platform_payment_config', (t) => {
    t.integer('id').primary().defaultTo(1);
    t.text('bank_details_json').nullable(); // { bankName, accountNumber, accountName, swiftCode }
    t.text('chapa_config_json').nullable(); // { publicKey, secretKey, webhookSecret, enabled }
    t.text('telebirr_config_json').nullable(); // { appId, appKey, shortCode, enabled }
    t.text('cbe_birr_config_json').nullable(); // { merchantId, apiKey, enabled }
    t.text('sms_config_json').nullable(); // { provider, apiKey, senderId, enabled }
    t.integer('default_grace_days').notNullable().defaultTo(3);
    t.integer('report_retention_days').notNullable().defaultTo(365); // 1 year
    t.datetime('updated_at').notNullable();
  });

  // Insert default config
  const nowIso = new Date().toISOString();
  await knex('platform_payment_config').insert({
    id: 1,
    bank_details_json: JSON.stringify({
      bankName: 'Commercial Bank of Ethiopia',
      accountNumber: '',
      accountName: 'MirachPOS',
      swiftCode: 'CBETETAA',
      instructions: 'Please transfer the exact amount and use your Tenant ID as reference.'
    }),
    chapa_config_json: JSON.stringify({ publicKey: '', secretKey: '', webhookSecret: '', enabled: false }),
    telebirr_config_json: JSON.stringify({ appId: '', appKey: '', shortCode: '', enabled: false }),
    cbe_birr_config_json: JSON.stringify({ merchantId: '', apiKey: '', enabled: false }),
    sms_config_json: JSON.stringify({ provider: 'africas_talking', apiKey: '', senderId: 'MirachPOS', enabled: false }),
    default_grace_days: 3,
    report_retention_days: 365,
    updated_at: nowIso
  });

  // Invoices table
  await knex.schema.createTable('invoices', (t) => {
    t.string('id', 64).primary(); // inv_xxx
    t.string('tenant_id', 64).notNullable().index();
    t.string('invoice_number', 32).notNullable(); // INV-2026-0001
    t.string('type', 32).notNullable().defaultTo('subscription'); // subscription, addon, manual
    t.string('status', 32).notNullable().defaultTo('pending'); // draft, pending, paid, overdue, cancelled, refunded
    t.text('line_items_json').notNullable(); // [{ description, qty, unitPrice, amount }]
    t.decimal('subtotal_etb', 14, 2).notNullable().defaultTo(0);
    t.decimal('tax_etb', 14, 2).notNullable().defaultTo(0);
    t.decimal('discount_etb', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_etb', 14, 2).notNullable().defaultTo(0);
    t.string('currency', 8).notNullable().defaultTo('ETB');
    t.datetime('issue_date').notNullable();
    t.datetime('due_date').notNullable();
    t.datetime('paid_at').nullable();
    t.string('period_start', 32).nullable(); // For subscription invoices: billing period
    t.string('period_end', 32).nullable();
    t.text('notes').nullable();
    t.text('metadata_json').nullable(); // { planTier, cycle, prorated, etc. }
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  // Payments table
  await knex.schema.createTable('payments', (t) => {
    t.string('id', 64).primary(); // pay_xxx
    t.string('invoice_id', 64).notNullable().index();
    t.string('tenant_id', 64).notNullable().index();
    t.string('method', 32).notNullable(); // bank_transfer, chapa, telebirr, cbe_birr, cash
    t.string('status', 32).notNullable().defaultTo('pending'); // pending, verified, rejected, refunded
    t.decimal('amount_etb', 14, 2).notNullable();
    t.string('currency', 8).notNullable().defaultTo('ETB');
    t.string('reference', 128).nullable(); // Bank reference, transaction ID
    t.text('proof_url').nullable(); // Uploaded receipt/screenshot path
    t.text('proof_filename').nullable();
    t.text('gateway_response_json').nullable(); // Response from Chapa/Telebirr/CBE
    t.string('gateway_tx_id', 128).nullable(); // Gateway transaction ID
    t.string('verified_by', 64).nullable(); // Super admin who verified
    t.datetime('verified_at').nullable();
    t.text('rejection_reason').nullable();
    t.text('notes').nullable();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  // Subscription history (audit log of plan changes)
  await knex.schema.createTable('subscription_history', (t) => {
    t.string('id', 64).primary(); // subh_xxx
    t.string('tenant_id', 64).notNullable().index();
    t.string('action', 32).notNullable(); // created, upgraded, downgraded, renewed, cancelled, suspended, reactivated
    t.string('from_tier', 32).nullable();
    t.string('to_tier', 32).nullable();
    t.string('from_cycle', 32).nullable();
    t.string('to_cycle', 32).nullable();
    t.decimal('amount_etb', 14, 2).nullable();
    t.string('invoice_id', 64).nullable();
    t.string('payment_id', 64).nullable();
    t.string('actor_type', 32).nullable(); // owner, superadmin, system
    t.string('actor_id', 64).nullable();
    t.text('reason').nullable();
    t.text('metadata_json').nullable();
    t.datetime('created_at').notNullable();
  });

  // Tenant payment method preferences
  await knex.schema.createTable('tenant_payment_prefs', (t) => {
    t.string('tenant_id', 64).primary();
    t.string('preferred_method', 32).nullable(); // bank_transfer, chapa, telebirr, cbe_birr
    t.text('chapa_customer_id').nullable();
    t.text('telebirr_customer_id').nullable();
    t.boolean('auto_pay_enabled').notNullable().defaultTo(false);
    t.boolean('email_reminders').notNullable().defaultTo(true);
    t.boolean('sms_reminders').notNullable().defaultTo(false);
    t.string('billing_email', 255).nullable();
    t.string('billing_phone', 32).nullable();
    t.datetime('updated_at').notNullable();
  });

  // Add grace_days column to tenant_subscription for per-tenant override
  const hasGraceDays = await knex.schema.hasColumn('tenant_subscription', 'grace_days');
  if (!hasGraceDays) {
    await knex.schema.table('tenant_subscription', (t) => {
      t.integer('grace_days').nullable(); // null = use platform default
    });
  }

  // Notification log for billing reminders
  await knex.schema.createTable('billing_notifications', (t) => {
    t.string('id', 64).primary(); // notif_xxx
    t.string('tenant_id', 64).notNullable().index();
    t.string('invoice_id', 64).nullable();
    t.string('type', 32).notNullable(); // reminder_3day, reminder_1day, overdue, payment_received, payment_verified
    t.string('channel', 16).notNullable(); // email, sms
    t.string('recipient', 255).notNullable();
    t.string('status', 16).notNullable().defaultTo('pending'); // pending, sent, failed
    t.text('error_message').nullable();
    t.datetime('sent_at').nullable();
    t.datetime('created_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('billing_notifications');
  
  const hasGraceDays = await knex.schema.hasColumn('tenant_subscription', 'grace_days');
  if (hasGraceDays) {
    await knex.schema.table('tenant_subscription', (t) => {
      t.dropColumn('grace_days');
    });
  }
  
  await knex.schema.dropTableIfExists('tenant_payment_prefs');
  await knex.schema.dropTableIfExists('subscription_history');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('platform_payment_config');
};
