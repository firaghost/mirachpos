/**
 * Migration 056: Report Email Schedules Table
 *
 * Creates table for scheduled report emails with last_run_at tracking
 */

exports.up = async function(knex) {
  // Create report email schedules table if not exists
  const hasTable = await knex.schema.hasTable('report_email_schedules');
  if (!hasTable) {
    await knex.schema.createTable('report_email_schedules', (t) => {
      t.string('id', 32).primary();
      t.string('tenant_id', 32).notNullable();
      t.string('branch_id', 32).nullable();
      t.enum('frequency', ['daily', 'weekly', 'monthly']).notNullable();
      t.text('emails').notNullable(); // JSON array of email addresses
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('last_run_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.index(['tenant_id', 'branch_id', 'frequency']);
      t.index(['is_active']);
      t.index(['last_run_at']);
    });

    // Add unique constraint for tenant/branch/frequency combination
    await knex.raw(
      'ALTER TABLE report_email_schedules ADD CONSTRAINT report_email_schedules_unique_schedule UNIQUE (tenant_id, branch_id, frequency)'
    );
  }

  // Also ensure last_run_at column exists if table was created before this migration
  const hasLastRunAt = await knex.schema.hasColumn('report_email_schedules', 'last_run_at');
  if (!hasLastRunAt) {
    await knex.schema.table('report_email_schedules', (t) => {
      t.timestamp('last_run_at').nullable();
      t.index(['last_run_at']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('report_email_schedules');
};
