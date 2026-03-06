exports.up = async (knex) => {
  const hasPaymentEvents = await knex.schema.hasTable('payment_events');
  if (!hasPaymentEvents) {
    await knex.schema.createTable('payment_events', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).nullable().index();

      t.string('domain', 16).notNullable().defaultTo('pos').index();
      t.string('payment_ref', 128).notNullable().index();

      t.string('order_id', 64).nullable().index();
      t.string('invoice_id', 64).nullable().index();

      t.string('operation', 32).notNullable().index();
      t.string('event_type', 64).notNullable().index();

      t.string('from_state', 32).nullable();
      t.string('to_state', 32).nullable().index();

      t.decimal('amount', 14, 2).nullable();
      t.string('currency', 8).nullable();

      t.string('payment_method', 64).nullable().index();
      t.string('gateway', 32).nullable().index();

      t.string('provider_payment_id', 128).nullable().index();
      t.string('provider_event_id', 128).nullable();

      t.string('idempotency_key', 255).nullable();
      t.string('request_hash', 128).nullable();

      t.string('actor_type', 32).nullable();
      t.string('actor_id', 64).nullable();

      t.longtext('payload_json').nullable();
      t.datetime('created_at').notNullable().index();

      t.unique(['tenant_id', 'operation', 'idempotency_key'], { indexName: 'ux_payment_events_tenant_op_idem' });
      t.unique(['tenant_id', 'gateway', 'provider_event_id'], { indexName: 'ux_payment_events_tenant_gateway_event' });
      t.index(['tenant_id', 'payment_ref', 'created_at'], 'ix_payment_events_tenant_ref_created');
    });
  }

  const hasPgt = await knex.schema.hasTable('pos_payment_gateway_transactions');
  if (hasPgt) {
    const hasState = await knex.schema.hasColumn('pos_payment_gateway_transactions', 'state');
    if (!hasState) {
      await knex.schema.alterTable('pos_payment_gateway_transactions', (t) => {
        t.string('state', 32).nullable().index();
        t.string('idempotency_key', 255).nullable().index();
        t.string('request_hash', 128).nullable();
        t.datetime('captured_at').nullable().index();
        t.decimal('refunded_amount', 14, 2).notNullable().defaultTo(0);
        t.datetime('voided_at').nullable().index();
      });
    }

    await knex.schema.alterTable('pos_payment_gateway_transactions', (t) => {
      t.index(['tenant_id', 'branch_id', 'gateway', 'state'], 'ix_pos_pgt_scope_gateway_state');
      t.index(['tenant_id', 'branch_id', 'created_at'], 'ix_pos_pgt_scope_created_at');
    });
  }

  const hasPayments = await knex.schema.hasTable('payments');
  if (hasPayments) {
    const hasState = await knex.schema.hasColumn('payments', 'state');
    if (!hasState) {
      await knex.schema.alterTable('payments', (t) => {
        t.string('state', 32).nullable().index();
        t.string('provider', 32).nullable().index();
        t.string('provider_payment_id', 128).nullable().index();
        t.decimal('authorized_amount', 14, 2).notNullable().defaultTo(0);
        t.decimal('captured_amount', 14, 2).notNullable().defaultTo(0);
        t.decimal('refunded_amount', 14, 2).notNullable().defaultTo(0);
        t.string('last_idempotency_key', 255).nullable().index();
      });
    }
  }
};

exports.down = async (knex) => {
  const hasPaymentEvents = await knex.schema.hasTable('payment_events');
  if (hasPaymentEvents) {
    await knex.schema.dropTable('payment_events');
  }

  const hasPgt = await knex.schema.hasTable('pos_payment_gateway_transactions');
  if (hasPgt) {
    const hasState = await knex.schema.hasColumn('pos_payment_gateway_transactions', 'state');
    if (hasState) {
      await knex.schema.alterTable('pos_payment_gateway_transactions', (t) => {
        t.dropColumn('state');
        t.dropColumn('idempotency_key');
        t.dropColumn('request_hash');
        t.dropColumn('captured_at');
        t.dropColumn('refunded_amount');
        t.dropColumn('voided_at');
      });
    }
  }

  const hasPayments = await knex.schema.hasTable('payments');
  if (hasPayments) {
    const hasState = await knex.schema.hasColumn('payments', 'state');
    if (hasState) {
      await knex.schema.alterTable('payments', (t) => {
        t.dropColumn('state');
        t.dropColumn('provider');
        t.dropColumn('provider_payment_id');
        t.dropColumn('authorized_amount');
        t.dropColumn('captured_amount');
        t.dropColumn('refunded_amount');
        t.dropColumn('last_idempotency_key');
      });
    }
  }
};
