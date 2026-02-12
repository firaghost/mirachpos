/**
 * Migration: Firebase Cloud Messaging (FCM) Push Notification Support
 * 
 * Creates tables for:
 * - fcm_tokens: Store device tokens per user
 * - push_notifications: Track push notification delivery
 */

exports.up = async (knex) => {
  // FCM Device Tokens table
  const hasTokensTable = await knex.schema.hasTable('fcm_tokens');
  if (!hasTokensTable) {
    await knex.schema.createTable('fcm_tokens', (t) => {
      t.string('id', 64).primary(); // fcm_xxx
      t.string('tenant_id', 64).notNullable().index();
      t.string('staff_id', 64).notNullable().index(); // User who owns this token
      t.string('token', 255).notNullable().unique(); // FCM device token
      t.string('device_type', 32).nullable(); // android, ios, web
      t.string('device_name', 128).nullable(); // User-friendly device name
      t.boolean('is_active').notNullable().defaultTo(true);
      t.datetime('last_used_at').nullable();
      t.datetime('created_at').notNullable();
      t.datetime('updated_at').notNullable();

      // Composite indexes for common queries
      t.index(['tenant_id', 'staff_id', 'is_active'], 'idx_fcm_tokens_user_active');
      t.index(['token', 'is_active'], 'idx_fcm_tokens_token_active');
    });
  }

  // Push Notifications Log table
  const hasPushTable = await knex.schema.hasTable('push_notifications');
  if (!hasPushTable) {
    await knex.schema.createTable('push_notifications', (t) => {
      t.string('id', 64).primary(); // push_xxx
      t.string('tenant_id', 64).notNullable().index();
      t.string('staff_id', 64).nullable().index(); // Target user
      t.string('fcm_token_id', 64).nullable().index(); // Link to fcm_tokens

      // Notification content
      t.string('title', 255).notNullable();
      t.text('body').notNullable();
      t.string('image_url', 512).nullable();
      t.text('data_json').nullable(); // Additional payload data
      t.string('click_action', 255).nullable(); // Deep link

      // Status tracking
      t.string('status', 32).notNullable().defaultTo('pending'); // pending, sent, delivered, failed
      t.string('fcm_message_id', 128).nullable(); // FCM response message ID
      t.text('error_message').nullable();
      t.integer('retry_count').notNullable().defaultTo(0);

      // Related entity (optional)
      t.string('entity_type', 64).nullable(); // order, invoice, booking, etc.
      t.string('entity_id', 64).nullable();

      t.datetime('sent_at').nullable();
      t.datetime('delivered_at').nullable();
      t.datetime('failed_at').nullable();
      t.datetime('created_at').notNullable();
      t.datetime('updated_at').notNullable();

      // Indexes
      t.index(['tenant_id', 'status', 'created_at'], 'idx_push_notif_status');
      t.index(['staff_id', 'status'], 'idx_push_notif_user_status');
      t.index(['entity_type', 'entity_id'], 'idx_push_notif_entity');
    });
  }

  // Add FCM config column to platform_payment_config
  const hasFcmConfig = await knex.schema.hasColumn('platform_payment_config', 'fcm_config_json');
  if (!hasFcmConfig) {
    await knex.schema.table('platform_payment_config', (t) => {
      t.text('fcm_config_json').nullable(); // { serviceAccountKey: {...}, enabled: true }
    });
  }

  // Add push notification preferences to staff
  const hasPushPrefs = await knex.schema.hasColumn('staff', 'push_notification_prefs_json');
  if (!hasPushPrefs) {
    await knex.schema.table('staff', (t) => {
      t.text('push_notification_prefs_json').nullable(); // { enabled: true, orderUpdates: true, billingAlerts: true }
    });
  }

  console.log('[058] FCM push notification support tables created');
};

exports.down = async (knex) => {
  const hasPushPrefs = await knex.schema.hasColumn('staff', 'push_notification_prefs_json');
  if (hasPushPrefs) {
    await knex.schema.table('staff', (t) => {
      t.dropColumn('push_notification_prefs_json');
    });
  }

  const hasFcmConfig = await knex.schema.hasColumn('platform_payment_config', 'fcm_config_json');
  if (hasFcmConfig) {
    await knex.schema.table('platform_payment_config', (t) => {
      t.dropColumn('fcm_config_json');
    });
  }

  await knex.schema.dropTableIfExists('push_notifications');
  await knex.schema.dropTableIfExists('fcm_tokens');
};
