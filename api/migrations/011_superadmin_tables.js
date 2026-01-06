exports.up = async (knex) => {
  await knex.schema.createTable('feature_flags', (t) => {
    t.string('id', 64).primary();
    t.string('name', 128).notNullable();
    t.string('plan', 32).nullable().index();
    t.string('risk', 32).nullable().index();
    t.boolean('enabled').notNullable().defaultTo(false).index();
    t.longtext('meta_json').nullable();
    t.datetime('updated_at').notNullable().index();
    t.unique(['name']);
  });

  await knex.schema.createTable('tenant_notes', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('staff_id', 64).nullable().index();
    t.longtext('message').notNullable();
    t.datetime('created_at').notNullable().index();
  });

  await knex.schema.createTable('platform_settings_admin', (t) => {
    t.integer('id').primary();
    t.longtext('settings_json').nullable();
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('support_ticket_replies', (t) => {
    t.string('id', 64).primary();
    t.string('ticket_id', 64).notNullable().index();
    t.string('tenant_id', 64).notNullable().index();
    t.string('staff_id', 64).nullable().index();
    t.longtext('message').notNullable();
    t.datetime('created_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('support_ticket_replies');
  await knex.schema.dropTableIfExists('platform_settings_admin');
  await knex.schema.dropTableIfExists('tenant_notes');
  await knex.schema.dropTableIfExists('feature_flags');
};
