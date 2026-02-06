exports.up = async (knex) => {
  await knex.schema.createTable('audit_log', (t) => {
    t.string('id', 64).primary();
    t.string('request_id', 96).nullable().index();
    t.string('tenant_id', 64).nullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('actor_staff_id', 64).nullable().index();
    t.string('actor_role', 64).nullable().index();
    t.string('type', 64).notNullable().index();
    t.string('summary', 255).nullable();
    t.longtext('payload_json').nullable();
    t.datetime('created_at').notNullable().index();
  });

  await knex.schema.createTable('sync_events', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('device_id', 64).nullable().index();
    t.string('type', 64).notNullable().index();
    t.longtext('payload_json').nullable();
    t.datetime('created_at').notNullable().index();
  });

  await knex.schema.createTable('sync_drafts', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('status', 32).notNullable().defaultTo('SUBMITTED').index();
    t.longtext('draft_json').nullable();
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sync_drafts');
  await knex.schema.dropTableIfExists('sync_events');
  await knex.schema.dropTableIfExists('audit_log');
};
