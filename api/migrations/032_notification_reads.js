exports.up = async (knex) => {
  await knex.schema.createTable('notification_reads', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('staff_id', 64).notNullable().index();
    t.string('notification_id', 64).notNullable().index();
    t.datetime('read_at').notNullable().index();
    t.unique(['tenant_id', 'staff_id', 'notification_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('notification_reads');
};
