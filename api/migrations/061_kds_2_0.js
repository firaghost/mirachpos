exports.up = async (knex) => {
  const hasTickets = await knex.schema.hasTable('kds_tickets');
  if (!hasTickets) {
    await knex.schema.createTable('kds_tickets', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();

      t.string('station', 64).notNullable().index();
      t.integer('course_no').notNullable().defaultTo(1).index();

      t.string('status', 32).notNullable().index();
      t.integer('priority').notNullable().defaultTo(0).index();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').nullable().index();

      t.datetime('fired_at').nullable().index();
      t.datetime('ready_at').nullable().index();
      t.datetime('bumped_at').nullable().index();

      t.integer('sla_ms').nullable();
      t.datetime('sla_due_at').nullable().index();

      t.longtext('meta_json').nullable();

      t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_kds_tickets_order_scope');
      t.index(['tenant_id', 'branch_id', 'station', 'status'], 'idx_kds_tickets_station_status');
    });
  }

  const hasTicketItems = await knex.schema.hasTable('kds_ticket_items');
  if (!hasTicketItems) {
    await knex.schema.createTable('kds_ticket_items', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('ticket_id', 64).notNullable().index();

      t.string('order_item_id', 64).nullable().index();

      t.string('product_id', 64).nullable().index();
      t.string('name', 255).notNullable();

      t.decimal('qty', 12, 3).notNullable().defaultTo(0);
      t.decimal('voided_qty', 12, 3).notNullable().defaultTo(0);

      t.text('notes').nullable();
      t.longtext('allergens_json').nullable();

      t.string('station', 64).notNullable().index();
      t.integer('course_no').notNullable().defaultTo(1).index();

      t.string('prep_state', 32).notNullable().defaultTo('HOLD').index();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'ticket_id'], 'idx_kds_ticket_items_ticket_scope');
      t.index(['tenant_id', 'branch_id', 'ticket_id', 'prep_state'], 'idx_kds_ticket_items_ticket_state');
    });
  }

  const hasEvents = await knex.schema.hasTable('kds_events');
  if (!hasEvents) {
    await knex.schema.createTable('kds_events', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();

      t.string('ticket_id', 64).notNullable().index();
      t.string('event_type', 64).notNullable().index();

      t.string('action_id', 96).nullable().index();

      t.string('actor_staff_id', 64).nullable().index();
      t.string('actor_role', 64).nullable().index();

      t.longtext('payload_json').nullable();
      t.datetime('created_at').notNullable().index();

      t.unique(['tenant_id', 'action_id']);
      t.index(['tenant_id', 'branch_id', 'ticket_id', 'created_at'], 'idx_kds_events_ticket_time');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('kds_events');
  await knex.schema.dropTableIfExists('kds_ticket_items');
  await knex.schema.dropTableIfExists('kds_tickets');
};
