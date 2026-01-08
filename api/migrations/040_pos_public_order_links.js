exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('pos_public_order_links');
  if (exists) return;

  await knex.schema.createTable('pos_public_order_links', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('order_id', 64).notNullable().index();

    t.string('token', 128).notNullable().unique();
    t.string('purpose', 32).notNullable(); // payer | receipt

    t.datetime('expires_at').nullable().index();
    t.longtext('meta_json').nullable();

    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();

    t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_pos_public_link_scope');
    t.index(['token', 'purpose'], 'idx_pos_public_link_lookup');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('pos_public_order_links');
};
