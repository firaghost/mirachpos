exports.up = async (knex) => {
  const hasCatalog = await knex.schema.hasTable('integrations_catalog');
  if (!hasCatalog) {
    await knex.schema.createTable('integrations_catalog', (t) => {
      t.string('id', 64).primary();
      t.string('code', 128).notNullable().unique();
      t.string('name', 255).notNullable();
      t.longtext('description').nullable();
      t.string('category', 128).nullable().index();
      t.string('integration_type', 32).notNullable().defaultTo('api_key').index();
      t.boolean('is_available').notNullable().defaultTo(true).index();
      t.string('required_tier', 32).nullable().index();
      t.longtext('config_schema_json').nullable();
      t.longtext('meta_json').nullable();
      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();
    });
  }

  const hasTenantIntegrations = await knex.schema.hasTable('tenant_integrations');
  if (!hasTenantIntegrations) {
    await knex.schema.createTable('tenant_integrations', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('integration_id', 64).notNullable().index();
      t.string('status', 32).notNullable().defaultTo('installed').index();
      t.longtext('config_json').nullable();
      t.longtext('secrets_json').nullable();
      t.datetime('installed_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.unique(['tenant_id', 'integration_id']);
      t.index(['tenant_id', 'status'], 'idx_tenant_integrations_status');
    });
  }

  const hasEvents = await knex.schema.hasTable('integration_events');
  if (!hasEvents) {
    await knex.schema.createTable('integration_events', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('integration_id', 64).notNullable().index();
      t.string('type', 128).notNullable().index();
      t.longtext('payload_json').nullable();
      t.datetime('created_at').notNullable().index();

      t.index(['tenant_id', 'integration_id', 'created_at'], 'idx_integration_events_scope');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('integration_events');
  await knex.schema.dropTableIfExists('tenant_integrations');
  await knex.schema.dropTableIfExists('integrations_catalog');
};
