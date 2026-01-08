exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('pos_payment_gateway_transactions');
  if (exists) return;

  await knex.schema.createTable('pos_payment_gateway_transactions', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).notNullable().index();
    t.string('order_id', 64).notNullable().index();

    t.string('gateway', 32).notNullable();
    t.string('method', 64).nullable();

    t.string('tx_ref', 128).notNullable().unique();
    t.string('gateway_tx_id', 128).nullable().index();
    t.text('checkout_url').nullable();

    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.string('currency', 8).notNullable().defaultTo('ETB');

    t.string('status', 32).notNullable().defaultTo('pending');
    t.datetime('expires_at').nullable().index();
    t.datetime('paid_at').nullable().index();

    t.longtext('init_response_json').nullable();
    t.longtext('verify_response_json').nullable();
    t.longtext('webhook_payload_json').nullable();

    t.datetime('created_at').notNullable().index();
    t.datetime('updated_at').notNullable().index();

    t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_pos_pgt_order_scope');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('pos_payment_gateway_transactions');
};
