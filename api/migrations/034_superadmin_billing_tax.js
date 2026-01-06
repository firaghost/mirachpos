exports.up = async (knex) => {
  await knex.schema.createTable('superadmin_billing_policy', (t) => {
    t.integer('id').primary();
    t.boolean('auto_renew_default').notNullable().defaultTo(true);
    t.boolean('proration_on_upgrade').notNullable().defaultTo(true);
    t.enu('billing_cycle_anchor', ['signup_date', 'first_of_month']).notNullable().defaultTo('signup_date');
    t.enu('currency_default', ['ETB', 'USD']).notNullable().defaultTo('ETB');
    t.boolean('auto_suspension_trigger').notNullable().defaultTo(true);
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('superadmin_offline_accounts', (t) => {
    t.string('id', 64).primary();
    t.string('bank_name', 255).notNullable();
    t.string('account_number', 255).notNullable();
    t.string('account_holder', 255).notNullable();
    t.boolean('active').notNullable().defaultTo(true).index();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('tax_rules', (t) => {
    t.string('code', 64).primary();
    t.string('name', 255).notNullable();
    t.decimal('rate_pct', 6, 2).notNullable();
    t.enu('logic', ['exclusive', 'inclusive']).notNullable().defaultTo('exclusive');
    t.enu('status', ['active', 'suspended', 'archived']).notNullable().defaultTo('active').index();
    t.date('effective_date').notNullable();
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('tax_rule_categories', (t) => {
    t.string('id', 64).primary();
    t.string('name', 255).notNullable().unique();
    t.datetime('created_at').notNullable();
  });

  await knex.schema.createTable('tax_rule_category_map', (t) => {
    t.string('tax_code', 64).notNullable();
    t.string('category_id', 64).notNullable();
    t.primary(['tax_code', 'category_id']);
    t.foreign('tax_code').references('tax_rules.code').onDelete('CASCADE');
    t.foreign('category_id').references('tax_rule_categories.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('tax_system_status', (t) => {
    t.integer('id').primary();
    t.string('fiscal_printer_status', 64).nullable();
    t.boolean('fiscal_signature_ok').nullable();
    t.datetime('last_erca_sync_at').nullable();
    t.datetime('next_erca_sync_at').nullable();
    t.datetime('updated_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tax_system_status');
  await knex.schema.dropTableIfExists('tax_rule_category_map');
  await knex.schema.dropTableIfExists('tax_rule_categories');
  await knex.schema.dropTableIfExists('tax_rules');
  await knex.schema.dropTableIfExists('superadmin_offline_accounts');
  await knex.schema.dropTableIfExists('superadmin_billing_policy');
};
