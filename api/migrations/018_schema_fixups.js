exports.up = async (knex) => {
  const hasTable = async (name) => {
    try {
      return await knex.schema.hasTable(name);
    } catch {
      return false;
    }
  };

  const hasColumn = async (table, col) => {
    try {
      return await knex.schema.hasColumn(table, col);
    } catch {
      return false;
    }
  };

  // ---- Public/support tables ----
  if (!(await hasTable('demo_requests'))) {
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
  }

  if (!(await hasTable('owner_invites'))) {
    await knex.schema.createTable('owner_invites', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('role_name', 64).notNullable();
      t.string('branch_id', 64).nullable().index();
      t.string('code', 64).notNullable().unique();
      t.datetime('expires_at').notNullable().index();
      t.datetime('used_at').nullable().index();
      t.string('used_by_staff_id', 64).nullable().index();
      t.datetime('created_at').notNullable().index();
    });
  }

  // ---- Audit/sync tables ----
  if (!(await hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).nullable().index();
      t.string('branch_id', 64).nullable().index();
      t.string('actor_staff_id', 64).nullable().index();
      t.string('actor_role', 64).nullable().index();
      t.string('type', 64).notNullable().index();
      t.string('summary', 255).nullable();
      t.longtext('payload_json').nullable();
      t.datetime('created_at').notNullable().index();
    });
  }

  if (await hasTable('sync_events')) {
    // Ensure monotonic cursor exists for ordering.
    if (!(await hasColumn('sync_events', 'cursor'))) {
      // MySQL requires AUTO_INCREMENT columns to be indexed.
      await knex.raw(
        'ALTER TABLE sync_events ' +
          'ADD COLUMN `cursor` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ' +
          'ADD UNIQUE KEY `ux_sync_events_cursor` (`cursor`)',
      );
    }
  }

  // ---- Superadmin tables ----
  if (!(await hasTable('feature_flags'))) {
    await knex.schema.createTable('feature_flags', (t) => {
      t.string('id', 64).primary();
      t.string('name', 128).notNullable();
      t.string('plan', 32).nullable().index();
      t.string('risk', 32).nullable().index();
      t.boolean('enabled').notNullable().defaultTo(false).index();
      t.longtext('meta_json').nullable();
      t.datetime('updated_at').notNullable().index();
      t.unique(['name']);
    });
  }

  if (!(await hasTable('tenant_notes'))) {
    await knex.schema.createTable('tenant_notes', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('staff_id', 64).nullable().index();
      t.longtext('message').notNullable();
      t.datetime('created_at').notNullable().index();
    });
  }

  if (!(await hasTable('platform_settings_admin'))) {
    await knex.schema.createTable('platform_settings_admin', (t) => {
      t.integer('id').primary();
      t.longtext('settings_json').nullable();
      t.datetime('updated_at').notNullable();
    });
  }

  if (!(await hasTable('support_ticket_replies'))) {
    await knex.schema.createTable('support_ticket_replies', (t) => {
      t.string('id', 64).primary();
      t.string('ticket_id', 64).notNullable().index();
      t.string('tenant_id', 64).notNullable().index();
      t.string('staff_id', 64).nullable().index();
      t.longtext('message').notNullable();
      t.datetime('created_at').notNullable().index();
    });
  }
};

exports.down = async (_knex) => {
  // Intentionally left empty: fixup migrations are not meant to be rolled back.
};
