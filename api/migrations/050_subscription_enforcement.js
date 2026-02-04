/**
 * Migration: Device sessions for subscription enforcement
 */

exports.up = async function(knex) {
  // Create device_sessions table to track active devices
  await knex.schema.createTable('device_sessions', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').unsigned().notNullable();
    table.integer('branch_id').unsigned().nullable();
    table.integer('staff_id').unsigned().nullable();
    table.string('device_id', 255).notNullable(); // Unique device identifier
    table.string('device_name', 255).nullable();
    table.string('device_type', 50).nullable(); // 'cashier', 'tablet', 'mobile'
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 500).nullable();
    table.timestamp('last_seen').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('tenant_id').references('id').inTable('tenants').onDelete('CASCADE');
    table.foreign('branch_id').references('id').inTable('branches').onDelete('SET NULL');
    table.foreign('staff_id').references('id').inTable('staff').onDelete('SET NULL');
    
    table.index(['tenant_id', 'last_seen']);
    table.index(['device_id']);
    table.unique(['tenant_id', 'device_id']);
  });

  // Add plan_id to subscriptions table if not exists
  const hasPlanId = await knex.schema.hasColumn('subscriptions', 'plan_id');
  if (!hasPlanId) {
    await knex.schema.alterTable('subscriptions', (table) => {
      table.string('plan_id', 50).nullable().after('tenant_id');
      table.index('plan_id');
    });
  }

  // Ensure subscriptions table has proper status enum
  await knex.raw(`
    ALTER TABLE subscriptions 
    MODIFY COLUMN status ENUM('trialing', 'active', 'past_due', 'canceled', 'unpaid') 
    DEFAULT 'trialing'
  `).catch(() => {
    // Ignore if already set or not supported
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('device_sessions');
};
