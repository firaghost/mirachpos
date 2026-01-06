exports.up = async (knex) => {
  await knex.schema.createTable('platform_settings', (t) => {
    t.integer('id').primary();
    t.longtext('settings_json').nullable();
    t.datetime('updated_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('platform_settings');
};
