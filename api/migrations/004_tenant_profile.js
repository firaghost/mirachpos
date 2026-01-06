exports.up = async (knex) => {
  await knex.schema.createTable('tenant_profile', (t) => {
    t.string('tenant_id', 64).primary();
    t.longtext('profile_json').nullable();
    t.datetime('updated_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tenant_profile');
};
