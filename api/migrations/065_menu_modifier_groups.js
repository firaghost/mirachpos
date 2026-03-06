exports.up = async (knex) => {
  const hasGroups = await knex.schema.hasTable('menu_modifier_groups');
  if (!hasGroups) {
    await knex.schema.createTable('menu_modifier_groups', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).nullable().index();

      t.string('name', 120).notNullable();
      t.integer('min_select').notNullable().defaultTo(0);
      t.integer('max_select').notNullable().defaultTo(0);
      t.integer('sort_order').notNullable().defaultTo(0);

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'sort_order', 'updated_at'], 'idx_menu_modifier_groups_scope');
      t.unique(['tenant_id', 'branch_id', 'name'], 'ux_menu_modifier_groups_name');
    });
  }

  const hasOptions = await knex.schema.hasTable('menu_modifier_options');
  if (!hasOptions) {
    await knex.schema.createTable('menu_modifier_options', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('group_id', 64).notNullable().index();

      t.string('name', 120).notNullable();
      t.decimal('price_delta', 12, 2).notNullable().defaultTo(0);
      t.integer('sort_order').notNullable().defaultTo(0);

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'group_id', 'sort_order', 'updated_at'], 'idx_menu_modifier_options_group');
      t.unique(['tenant_id', 'group_id', 'name'], 'ux_menu_modifier_options_name');
    });
  }

  const hasMap = await knex.schema.hasTable('menu_product_modifier_groups');
  if (!hasMap) {
    await knex.schema.createTable('menu_product_modifier_groups', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).nullable().index();
      t.string('product_id', 64).notNullable().index();
      t.string('group_id', 64).notNullable().index();
      t.integer('sort_order').notNullable().defaultTo(0);

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.unique(['tenant_id', 'branch_id', 'product_id', 'group_id'], 'ux_menu_product_modifier_groups');
      t.index(['tenant_id', 'branch_id', 'product_id', 'sort_order'], 'idx_menu_product_modifier_groups_scope');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('menu_product_modifier_groups');
  await knex.schema.dropTableIfExists('menu_modifier_options');
  await knex.schema.dropTableIfExists('menu_modifier_groups');
};
