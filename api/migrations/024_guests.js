exports.up = async (knex) => {
  await knex.schema.createTable('guests_profiles', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('name', 255).notNullable();
    t.string('role', 32).notNullable().index();
    t.decimal('monthly_limit', 12, 2).notNullable().defaultTo(0);
    t.string('status', 16).notNullable().defaultTo('Active').index();
    t.string('avatar_url', 1024).nullable();
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });

  await knex.schema.createTable('guests_transactions', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('guest_id', 64).notNullable().index();
    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.string('items', 1024).nullable();
    t.longtext('payload_json').nullable();
    t.datetime('at').notNullable().index();
    t.datetime('created_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('guests_transactions');
  await knex.schema.dropTableIfExists('guests_profiles');
};
