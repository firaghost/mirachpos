exports.up = async (knex) => {
  await knex.schema.createTable('manager_settings', (t) => {
    t.string('tenant_id', 64).notNullable();
    t.string('branch_id', 64).notNullable();
    t.longtext('settings_json').nullable();
    t.datetime('updated_at').notNullable();
    t.primary(['tenant_id', 'branch_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('manager_settings');
};
