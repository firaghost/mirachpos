exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable('tenant_entitlements');
  if (hasTable) return;

  await knex.schema.createTable('tenant_entitlements', (t) => {
    t.string('tenant_id', 64).primary();
    t.string('tier', 32).notNullable();
    t.longtext('modules_json').nullable();
    t.longtext('limits_json').nullable();
    t.string('status', 32).notNullable().defaultTo('active');
    t.datetime('grace_ends_at').nullable();
    t.datetime('computed_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tenant_entitlements');
};
