exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('suppliers');
  if (exists) return;

  await knex.schema.createTable('suppliers', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();

    t.string('name', 255).notNullable().index();
    t.string('phone', 64).nullable();
    t.string('email', 255).nullable().index();
    t.string('address', 255).nullable();
    t.string('status', 32).notNullable().defaultTo('Active').index();
    t.longtext('supplier_json').nullable();

    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();

    t.unique(['tenant_id', 'branch_id', 'name']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('suppliers');
};
