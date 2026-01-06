exports.up = async (knex) => {
  await knex.schema.createTable('menu_products', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('name', 255).notNullable().index();
    t.string('category', 128).nullable().index();
    t.string('status', 32).notNullable().defaultTo('Active').index();
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.longtext('product_json').nullable();
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });

  await knex.schema.createTable('inventory_items', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('name', 255).notNullable().index();
    t.string('category', 128).nullable().index();
    t.string('status', 32).notNullable().defaultTo('Active').index();
    t.decimal('on_hand', 12, 2).notNullable().defaultTo(0);
    t.decimal('reorder_level', 12, 2).notNullable().defaultTo(0);
    t.string('unit', 32).nullable();
    t.longtext('item_json').nullable();
    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('inventory_items');
  await knex.schema.dropTableIfExists('menu_products');
};
