exports.up = async (knex) => {
  await knex.schema.createTable('support_tickets', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('staff_id', 64).notNullable().index();
    t.string('severity', 32).notNullable();
    t.string('subject', 255).notNullable();
    t.longtext('description').nullable();
    t.string('status', 32).notNullable().defaultTo('Open');
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('support_tickets');
};
