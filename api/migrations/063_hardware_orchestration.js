exports.up = async (knex) => {
  const hasDevices = await knex.schema.hasTable('pos_devices');
  if (!hasDevices) {
    await knex.schema.createTable('pos_devices', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();

      t.string('type', 32).notNullable().index();
      t.string('name', 128).notNullable();

      t.string('transport', 32).notNullable().defaultTo('tcp');
      t.string('host', 255).nullable();
      t.integer('port').nullable();

      t.longtext('capabilities_json').nullable();

      t.string('status_override', 16).nullable();
      t.string('health_state', 16).notNullable().defaultTo('offline').index();
      t.datetime('last_seen_at').nullable().index();
      t.datetime('last_heartbeat_at').nullable().index();
      t.longtext('health_meta_json').nullable();

      t.boolean('deleted').notNullable().defaultTo(false).index();
      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'type'], 'idx_pos_devices_branch_type');
      t.index(['tenant_id', 'branch_id', 'health_state'], 'idx_pos_devices_branch_health');
    });
  }

  const hasAssignments = await knex.schema.hasTable('pos_device_assignments');
  if (!hasAssignments) {
    await knex.schema.createTable('pos_device_assignments', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('job_type', 32).notNullable();

      t.string('primary_device_id', 64).notNullable();
      t.string('fallback_device_id', 64).nullable();
      t.longtext('policy_json').nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.unique(['tenant_id', 'branch_id', 'job_type'], 'ux_pos_device_assignments_branch_job');
      t.index(['tenant_id', 'branch_id'], 'idx_pos_device_assignments_branch');
    });
  }

  const hasHeartbeats = await knex.schema.hasTable('pos_device_heartbeats');
  if (!hasHeartbeats) {
    await knex.schema.createTable('pos_device_heartbeats', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('device_id', 64).notNullable().index();

      t.datetime('received_at').notNullable().index();
      t.string('reported_state', 16).nullable();
      t.longtext('payload_json').nullable();

      t.index(['tenant_id', 'branch_id', 'device_id', 'received_at'], 'idx_pos_device_heartbeats_device');
    });
  }

  const hasPrintQueue = await knex.schema.hasTable('print_queue');
  if (hasPrintQueue) {
    const hasJobType = await knex.schema.hasColumn('print_queue', 'job_type');
    if (!hasJobType) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.string('job_type', 32).nullable().index();
      });
    }

    const hasDeadLetteredAt = await knex.schema.hasColumn('print_queue', 'dead_lettered_at');
    if (!hasDeadLetteredAt) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.datetime('dead_lettered_at').nullable().index();
      });
    }

    const hasDeadLetterReason = await knex.schema.hasColumn('print_queue', 'dead_letter_reason');
    if (!hasDeadLetterReason) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.string('dead_letter_reason', 128).nullable();
      });
    }
  }
};

exports.down = async (knex) => {
  const hasPrintQueue = await knex.schema.hasTable('print_queue');
  if (hasPrintQueue) {
    const hasDeadLetterReason = await knex.schema.hasColumn('print_queue', 'dead_letter_reason');
    if (hasDeadLetterReason) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.dropColumn('dead_letter_reason');
      });
    }

    const hasDeadLetteredAt = await knex.schema.hasColumn('print_queue', 'dead_lettered_at');
    if (hasDeadLetteredAt) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.dropColumn('dead_lettered_at');
      });
    }

    const hasJobType = await knex.schema.hasColumn('print_queue', 'job_type');
    if (hasJobType) {
      await knex.schema.alterTable('print_queue', (t) => {
        t.dropColumn('job_type');
      });
    }
  }

  await knex.schema.dropTableIfExists('pos_device_heartbeats');
  await knex.schema.dropTableIfExists('pos_device_assignments');
  await knex.schema.dropTableIfExists('pos_devices');
};
