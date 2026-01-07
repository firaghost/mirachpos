exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('po_counters');
  if (exists) return;

  await knex.schema.createTable('po_counters', (t) => {
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('key', 32).notNullable();
    t.bigInteger('next_value').notNullable().defaultTo(1);
    t.datetime('updated_at').notNullable().index();
    t.primary(['tenant_id', 'branch_id', 'key']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('po_counters');
};
