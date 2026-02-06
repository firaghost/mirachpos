exports.up = async (knex) => {
  const has = await knex.schema.hasTable('print_queue');
  if (!has) {
    await knex.schema.createTable('print_queue', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();
      t.string('profile', 32).notNullable();
      t.string('device_id', 64).nullable();
      t.string('fallback_device_id', 64).nullable();
      t.string('status', 32).notNullable().defaultTo('pending');
      t.string('error', 128).nullable();
      t.longtext('payload_json').nullable();
      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();
      t.index(['tenant_id', 'branch_id', 'status'], 'idx_print_queue_status');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('print_queue');
};
