exports.up = async (knex) => {
  // Add columns to orders (keep legacy payload for now; will be removed in a later migration)
  const hasOrders = await knex.schema.hasTable('orders');
  if (hasOrders) {
    const cols = await knex('information_schema.columns')
      .select(['column_name'])
      .where({ table_name: 'orders' })
      .then((rows) => rows.map((r) => String(r.column_name)));

    const addIfMissing = async (name, cb) => {
      if (cols.includes(name)) return;
      await knex.schema.alterTable('orders', cb);
      cols.push(name);
    };

    await addIfMissing('display_number', (t) => t.string('display_number', 32).nullable().index());
    await addIfMissing('table_id', (t) => t.string('table_id', 64).nullable().index());
    await addIfMissing('table_name', (t) => t.string('table_name', 64).nullable());

    await addIfMissing('created_by_staff_id', (t) => t.string('created_by_staff_id', 64).nullable().index());
    await addIfMissing('created_by_name', (t) => t.string('created_by_name', 255).nullable());

    await addIfMissing('paid_by_staff_id', (t) => t.string('paid_by_staff_id', 64).nullable().index());
    await addIfMissing('paid_by_name', (t) => t.string('paid_by_name', 255).nullable());

    await addIfMissing('payment_method', (t) => t.string('payment_method', 64).nullable().index());
    await addIfMissing('payment_reference', (t) => t.string('payment_reference', 128).nullable().index());
    await addIfMissing('tendered_amount', (t) => t.decimal('tendered_amount', 12, 2).nullable());

    await addIfMissing('notes', (t) => t.text('notes').nullable());
    await addIfMissing('updated_at', (t) => t.datetime('updated_at').nullable().index());
  }

  const hasOrderItems = await knex.schema.hasTable('order_items');
  if (!hasOrderItems) {
    await knex.schema.createTable('order_items', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();

      t.string('product_id', 64).nullable().index();
      t.string('product_code', 64).nullable().index();
      t.string('name', 255).notNullable();

      t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
      t.decimal('qty', 12, 3).notNullable().defaultTo(0);

      t.decimal('tax_amount', 12, 2).notNullable().defaultTo(0);
      t.decimal('discount_amount', 12, 2).notNullable().defaultTo(0);

      t.text('note').nullable();

      t.decimal('voided_qty', 12, 3).notNullable().defaultTo(0);
      t.text('void_reason').nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_order_items_order_scope');
    });
  }

  const hasOrderSplits = await knex.schema.hasTable('order_splits');
  if (!hasOrderSplits) {
    await knex.schema.createTable('order_splits', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();

      // amount: split is a partial amount not tied to specific items
      // items: split is allocated by items via order_split_items
      // mixed: both item allocation and amount-based top-ups exist
      t.string('mode', 16).notNullable().defaultTo('amount').index();
      t.decimal('target_amount', 12, 2).nullable();

      t.string('label', 64).nullable();
      t.string('status', 32).notNullable().defaultTo('open').index();

      t.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
      t.decimal('tax', 12, 2).notNullable().defaultTo(0);
      t.decimal('tip', 12, 2).notNullable().defaultTo(0);
      t.decimal('discount', 12, 2).notNullable().defaultTo(0);
      t.decimal('total', 12, 2).notNullable().defaultTo(0);

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_order_splits_order_scope');
    });
  }

  const hasOrderSplitItems = await knex.schema.hasTable('order_split_items');
  if (!hasOrderSplitItems) {
    await knex.schema.createTable('order_split_items', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();
      t.string('split_id', 64).notNullable().index();
      t.string('order_item_id', 64).notNullable().index();
      t.decimal('qty', 12, 3).notNullable().defaultTo(0);
      t.datetime('created_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'order_id', 'split_id'], 'idx_order_split_items_split_scope');
    });
  }

  const hasOrderPayments = await knex.schema.hasTable('order_payments');
  if (!hasOrderPayments) {
    await knex.schema.createTable('order_payments', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('order_id', 64).notNullable().index();
      t.string('split_id', 64).nullable().index();

      t.string('method', 64).notNullable().index();
      t.decimal('amount', 12, 2).notNullable().defaultTo(0);
      t.string('currency', 8).notNullable().defaultTo('ETB');
      t.string('reference', 128).nullable().index();

      t.string('status', 32).notNullable().defaultTo('confirmed').index();
      t.datetime('paid_at').nullable().index();

      t.string('paid_by_staff_id', 64).nullable().index();
      t.string('paid_by_name', 255).nullable();

      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();

      t.index(['tenant_id', 'branch_id', 'order_id'], 'idx_order_payments_order_scope');
    });
  }
};

exports.down = async (knex) => {
  // NOTE: This down migration is best-effort and may fail on some DBs if columns/indexes differ.
  // It's acceptable for production to treat migrations as forward-only.
  const hasOrders = await knex.schema.hasTable('orders');
  if (hasOrders) {
    await knex.schema.alterTable('orders', (t) => {
      try { t.dropColumn('display_number'); } catch {}
      try { t.dropColumn('table_id'); } catch {}
      try { t.dropColumn('table_name'); } catch {}
      try { t.dropColumn('created_by_staff_id'); } catch {}
      try { t.dropColumn('created_by_name'); } catch {}
      try { t.dropColumn('paid_by_staff_id'); } catch {}
      try { t.dropColumn('paid_by_name'); } catch {}
      try { t.dropColumn('payment_method'); } catch {}
      try { t.dropColumn('payment_reference'); } catch {}
      try { t.dropColumn('tendered_amount'); } catch {}
      try { t.dropColumn('notes'); } catch {}
      try { t.dropColumn('updated_at'); } catch {}
    });
  }

  await knex.schema.dropTableIfExists('order_payments');
  await knex.schema.dropTableIfExists('order_split_items');
  await knex.schema.dropTableIfExists('order_splits');
  await knex.schema.dropTableIfExists('order_items');
};
