exports.up = async (knex) => {
  const hasRuleSets = await knex.schema.hasTable('menu_rule_sets');
  if (!hasRuleSets) {
    await knex.schema.createTable('menu_rule_sets', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).nullable().index();

      t.string('name', 255).notNullable();
      t.string('status', 16).notNullable().defaultTo('active').index();
      t.integer('priority').notNullable().defaultTo(0).index();

      t.datetime('starts_at').nullable().index();
      t.datetime('ends_at').nullable().index();
      t.longtext('schedule_json').nullable();
      t.longtext('order_types_json').nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'status', 'priority'], 'idx_menu_rule_sets_scope');
    });
  }

  const hasRules = await knex.schema.hasTable('menu_rules');
  if (!hasRules) {
    await knex.schema.createTable('menu_rules', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('rule_set_id', 64).notNullable().index();

      t.string('kind', 32).notNullable().index();
      t.longtext('match_json').nullable();
      t.longtext('effect_json').nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'rule_set_id', 'kind'], 'idx_menu_rules_set_kind');
    });
  }

  const hasAvailability = await knex.schema.hasTable('menu_availability');
  if (!hasAvailability) {
    await knex.schema.createTable('menu_availability', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();

      t.string('target_type', 16).notNullable().index();
      t.string('target_id', 64).notNullable().index();

      t.string('state', 16).notNullable().defaultTo('available').index();
      t.string('reason', 255).nullable();
      t.datetime('expires_at').nullable().index();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.unique(['tenant_id', 'branch_id', 'target_type', 'target_id'], 'ux_menu_availability_target');
      t.index(['tenant_id', 'branch_id', 'state', 'expires_at'], 'idx_menu_availability_scope');
    });
  }

  const hasBundles = await knex.schema.hasTable('menu_bundles');
  if (!hasBundles) {
    await knex.schema.createTable('menu_bundles', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).nullable().index();

      t.string('name', 255).notNullable();
      t.string('status', 16).notNullable().defaultTo('active').index();
      t.integer('priority').notNullable().defaultTo(0).index();

      t.longtext('bundle_json').nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'status', 'priority'], 'idx_menu_bundles_scope');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('menu_bundles');
  await knex.schema.dropTableIfExists('menu_availability');
  await knex.schema.dropTableIfExists('menu_rules');
  await knex.schema.dropTableIfExists('menu_rule_sets');
};
