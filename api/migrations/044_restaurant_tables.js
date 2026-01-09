exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('restaurant_tables');
  if (exists) return;

  await knex.schema.createTable('restaurant_tables', (t) => {
    t.string('id', 64).notNullable();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();

    t.string('name', 64).notNullable();
    t.string('area', 64).nullable();
    t.string('status', 32).notNullable().defaultTo('Free').index();
    t.integer('seats').notNullable().defaultTo(4);

    t.string('open_order_id', 64).nullable().index();
    t.string('last_order_id', 64).nullable().index();

    t.string('assigned_staff_id', 64).nullable().index();
    t.string('assigned_staff_name', 255).nullable();

    t.datetime('updated_at').notNullable().index();

    t.primary(['tenant_id', 'branch_id', 'id']);
    t.unique(['tenant_id', 'branch_id', 'name']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('restaurant_tables');
};
