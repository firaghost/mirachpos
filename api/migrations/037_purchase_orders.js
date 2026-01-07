exports.up = async (knex) => {
  const hasPo = await knex.schema.hasTable('purchase_orders');
  if (!hasPo) {
    await knex.schema.createTable('purchase_orders', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('supplier_id', 64).notNullable().index();
      t.string('reference_no', 64).nullable().index();
      t.string('status', 32).notNullable().defaultTo('Draft').index();
      t.decimal('total', 14, 2).notNullable().defaultTo(0);
      t.longtext('notes').nullable();
      t.longtext('po_json').nullable();
      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();
      t.datetime('sent_at').nullable().index();
      t.datetime('received_at').nullable().index();
      t.unique(['tenant_id', 'branch_id', 'reference_no'], 'uq_po_ref');
    });
  }

  // Ensure unique index exists (migration might have partially run before failing)
  try {
    await knex.schema.alterTable('purchase_orders', (t) => {
      t.unique(['tenant_id', 'branch_id', 'reference_no'], 'uq_po_ref');
    });
  } catch {
    // ignore (already exists or table missing during rollback)
  }

  const hasItems = await knex.schema.hasTable('purchase_order_items');
  if (!hasItems) {
    await knex.schema.createTable('purchase_order_items', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('purchase_order_id', 64).notNullable().index();
      t.string('inventory_item_id', 64).notNullable().index();
      t.string('name', 255).notNullable();
      t.string('unit', 32).nullable();
      t.decimal('qty_ordered', 14, 3).notNullable().defaultTo(0);
      t.decimal('qty_received', 14, 3).notNullable().defaultTo(0);
      t.decimal('unit_cost', 14, 2).notNullable().defaultTo(0);
      t.decimal('line_total', 14, 2).notNullable().defaultTo(0);
      t.longtext('item_json').nullable();
      t.datetime('created_at').notNullable().index();
      t.datetime('updated_at').notNullable().index();
      t.index(['tenant_id', 'branch_id', 'purchase_order_id']);
      t.unique(['tenant_id', 'branch_id', 'purchase_order_id', 'inventory_item_id'], 'uq_poi_po_inv');
    });
  }

  // Ensure unique index exists (MySQL identifier name length limit)
  try {
    await knex.schema.alterTable('purchase_order_items', (t) => {
      t.unique(['tenant_id', 'branch_id', 'purchase_order_id', 'inventory_item_id'], 'uq_poi_po_inv');
    });
  } catch {
    // ignore
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('purchase_order_items');
  await knex.schema.dropTableIfExists('purchase_orders');
};
