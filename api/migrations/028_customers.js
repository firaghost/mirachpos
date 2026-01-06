exports.up = async (knex) => {
  const has = await knex.schema.hasTable('customers');
  if (has) return;

  await knex.schema.createTable('customers', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();

    t.string('name', 255).notNullable();
    t.string('phone', 64).notNullable();

    t.integer('loyalty_points').notNullable().defaultTo(0);
    t.decimal('loyalty_balance', 12, 2).notNullable().defaultTo(0);

    t.string('status').notNullable().defaultTo('Active');

    // Use DATETIME (not TIMESTAMP) to avoid MySQL strict-mode invalid default errors.
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();

    t.unique(['tenant_id', 'branch_id', 'phone']);
  });
};

exports.down = async (knex) => {
  const has = await knex.schema.hasTable('customers');
  if (!has) return;
  await knex.schema.dropTable('customers');
};
