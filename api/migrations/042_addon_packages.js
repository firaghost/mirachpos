exports.up = async (knex) => {
  const hasAddons = await knex.schema.hasTable('addon_packages');
  if (!hasAddons) {
    await knex.schema.createTable('addon_packages', (t) => {
      t.string('id', 64).primary();
      t.string('code', 128).notNullable().unique();
      t.string('name', 255).notNullable();
      t.longtext('description').nullable();
      t.string('category', 128).nullable().index();

      t.decimal('price_monthly_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('price_yearly_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('setup_fee_etb', 14, 2).notNullable().defaultTo(0);

      t.longtext('modules_json').nullable();
      t.longtext('limits_json').nullable();
      t.longtext('meta_json').nullable();

      t.boolean('is_available').notNullable().defaultTo(true).index();
      t.string('availability_tier', 32).nullable().index();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();
    });
  }

  const hasTenantAddons = await knex.schema.hasTable('tenant_addon_subscriptions');
  if (!hasTenantAddons) {
    await knex.schema.createTable('tenant_addon_subscriptions', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('addon_id', 64).notNullable().index();

      t.string('status', 32).notNullable().defaultTo('active').index();
      t.string('billing_frequency', 16).notNullable().defaultTo('monthly').index();
      t.decimal('price_paid_etb', 14, 2).notNullable().defaultTo(0);

      t.datetime('activation_date').notNullable().index();
      t.datetime('next_renewal_date').nullable().index();
      t.datetime('cancellation_date').nullable().index();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.unique(['tenant_id', 'addon_id']);
      t.index(['tenant_id', 'status'], 'idx_tenant_addons_status');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tenant_addon_subscriptions');
  await knex.schema.dropTableIfExists('addon_packages');
};
