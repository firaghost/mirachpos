exports.up = async (knex) => {
  await knex.schema.createTable('demo_requests', (t) => {
    t.string('id', 64).primary();
    t.string('status', 32).notNullable().defaultTo('New').index();

    t.string('name', 255).notNullable();
    t.string('email', 255).notNullable().index();
    t.string('phone', 64).nullable();
    t.string('company', 255).nullable();
    t.string('country', 128).nullable();
    t.string('source', 128).nullable();

    t.longtext('message').nullable();
    t.longtext('meta_json').nullable();

    t.string('provisioned_tenant_id', 64).nullable().index();
    t.datetime('processed_at').nullable().index();

    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('demo_requests');
};
