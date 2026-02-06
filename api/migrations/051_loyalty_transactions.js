exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable('loyalty_transactions');
  if (!hasTable) {
    await knex.schema.createTable('loyalty_transactions', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('customer_id', 64).notNullable().index();
      t.string('order_id', 64).nullable().index();

      t.string('type', 32).notNullable();
      t.integer('points_delta').notNullable().defaultTo(0);
      t.decimal('balance_delta', 12, 2).notNullable().defaultTo(0);
      t.decimal('earn_rate', 10, 4).nullable();
      t.integer('expiry_days').nullable();
      t.datetime('expires_at').nullable().index();
      t.longtext('meta_json').nullable();

      t.datetime('created_at').notNullable().index();
      t.index(['tenant_id', 'branch_id', 'customer_id'], 'idx_loyalty_scope');
    });
  }

  const hasPointsExpiry = await knex.schema.hasColumn('customers', 'loyalty_points_expires_at');
  if (!hasPointsExpiry) {
    await knex.schema.table('customers', (t) => {
      t.datetime('loyalty_points_expires_at').nullable().index();
    });
  }

  const hasPointsUpdatedAt = await knex.schema.hasColumn('customers', 'loyalty_points_updated_at');
  if (!hasPointsUpdatedAt) {
    await knex.schema.table('customers', (t) => {
      t.datetime('loyalty_points_updated_at').nullable().index();
    });
  }
};

exports.down = async (knex) => {
  const hasPointsExpiry = await knex.schema.hasColumn('customers', 'loyalty_points_expires_at');
  if (hasPointsExpiry) {
    await knex.schema.table('customers', (t) => {
      t.dropColumn('loyalty_points_expires_at');
    });
  }

  const hasPointsUpdatedAt = await knex.schema.hasColumn('customers', 'loyalty_points_updated_at');
  if (hasPointsUpdatedAt) {
    await knex.schema.table('customers', (t) => {
      t.dropColumn('loyalty_points_updated_at');
    });
  }

  await knex.schema.dropTableIfExists('loyalty_transactions');
};
