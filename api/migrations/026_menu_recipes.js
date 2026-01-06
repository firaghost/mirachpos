exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('menu_recipes');
  if (exists) return;

  await knex.schema.createTable('menu_recipes', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('product_id', 64).notNullable().index();
    t.longtext('recipe_json').nullable();
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
    t.unique(['tenant_id', 'branch_id', 'product_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('menu_recipes');
};
