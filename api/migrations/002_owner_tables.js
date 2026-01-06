exports.up = async (knex) => {
  await knex.schema.createTable('owner_settings', (t) => {
    t.string('tenant_id', 64).primary();
    t.longtext('settings_json').nullable();
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('owner_onboarding', (t) => {
    t.string('tenant_id', 64).primary();
    t.boolean('completed').notNullable().defaultTo(false);
    t.datetime('completed_at').nullable();
    t.datetime('updated_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('owner_onboarding');
  await knex.schema.dropTableIfExists('owner_settings');
};
