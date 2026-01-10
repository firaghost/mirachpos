/**
 * Migration: Staff Sales Summary
 *
 * Creates pre-aggregated daily staff sales table for consistent staff-based reporting.
 */

exports.up = async (knex) => {
  const hasTable = async (name) => {
    try {
      return await knex.schema.hasTable(name);
    } catch {
      return false;
    }
  };

  if (!(await hasTable('staff_sales_summary'))) {
    await knex.schema.createTable('staff_sales_summary', (t) => {
      t.string('id', 96).primary(); // sss_tenantId_branchId_date_staffId
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.date('report_date').notNullable();
      t.string('staff_id', 64).notNullable().index();
      t.string('staff_name', 255).nullable();

      t.integer('order_count').notNullable().defaultTo(0);
      t.decimal('gross_sales_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('discounts_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('net_sales_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('tips_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('total_collected_etb', 14, 2).notNullable().defaultTo(0);

      t.text('payment_breakdown_json').nullable();
      t.decimal('avg_ticket_etb', 14, 2).notNullable().defaultTo(0);

      t.datetime('first_order_at').nullable();
      t.datetime('last_order_at').nullable();
      t.datetime('computed_at').notNullable();

      t.unique(['tenant_id', 'branch_id', 'report_date', 'staff_id'], 'uq_sss_t_b_d_s');
    });
  }

  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_sss_tenant_date ON staff_sales_summary (tenant_id, report_date)');
  } catch {}

  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_sss_tenant_branch_staff ON staff_sales_summary (tenant_id, branch_id, staff_id, report_date)');
  } catch {}
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('staff_sales_summary');
};
