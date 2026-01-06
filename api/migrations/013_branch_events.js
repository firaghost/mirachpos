exports.up = async (knex) => {
  await knex.schema.createTable('branch_events', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('type', 64).notNullable().index();
    t.longtext('payload_json').nullable();
    t.datetime('created_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('branch_events');
};
