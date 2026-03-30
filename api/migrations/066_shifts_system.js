/**
 * Migration 066: Shift Management System
 * 
 * Creates the shifts table and adds shift-related columns to existing tables
 * for DAY/NIGHT shift management in 24-hour cafés.
 */

exports.up = async (knex) => {
  // Create shifts table
  const hasShiftsTable = await knex.schema.hasTable('shifts');
  if (!hasShiftsTable) {
    await knex.schema.createTable('shifts', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.enum('shift_type', ['DAY', 'NIGHT']).notNullable();
      t.date('business_date').notNullable().index();
      t.enum('status', ['OPEN', 'CLOSED']).notNullable().defaultTo('OPEN').index();
      t.datetime('opened_at').notNullable();
      t.datetime('closed_at').nullable();
      t.string('opened_by', 64).notNullable(); // staff_id
      t.string('closed_by', 64).nullable(); // staff_id
      t.decimal('opening_cash_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('closing_cash_etb', 14, 2).nullable();
      t.decimal('expected_cash_etb', 14, 2).nullable();
      t.decimal('cash_difference_etb', 14, 2).nullable();
      t.integer('order_count').notNullable().defaultTo(0);
      t.decimal('gross_sales_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('discounts_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('net_sales_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax_etb', 14, 2).notNullable().defaultTo(0);
      t.decimal('tips_etb', 14, 2).notNullable().defaultTo(0);
      t.text('payment_breakdown_json').nullable();
      t.text('notes').nullable();
      t.datetime('created_at').notNullable();
      t.datetime('updated_at').notNullable();

      // Indexes for common queries
      t.index(['tenant_id', 'branch_id', 'status'], 'idx_shifts_tenant_branch_status');
      t.index(['tenant_id', 'branch_id', 'business_date'], 'idx_shifts_tenant_branch_date');
      // Note: Only one OPEN shift per branch is enforced in application logic, not DB
    });
  }

  // Add shift_id and business_date to orders table
  const hasOrdersTable = await knex.schema.hasTable('orders');
  if (hasOrdersTable) {
    const orderCols = await knex('information_schema.columns')
      .select(['column_name'])
      .where({ table_name: 'orders' })
      .then((rows) => rows.map((r) => String(r.column_name)));

    if (!orderCols.includes('shift_id')) {
      await knex.schema.alterTable('orders', (t) => {
        t.string('shift_id', 64).nullable().index();
      });
    }

    if (!orderCols.includes('business_date')) {
      await knex.schema.alterTable('orders', (t) => {
        t.date('business_date').nullable().index();
      });
    }

    // Add foreign key constraint (optional, can be added later)
    try {
      await knex.schema.alterTable('orders', (t) => {
        t.foreign('shift_id')
          .references('id')
          .inTable('shifts')
          .onDelete('SET NULL');
      });
    } catch {
      // Foreign key may fail on some setups, continue without it
    }
  }

  // Add shift_id to order_payments table
  const hasOrderPaymentsTable = await knex.schema.hasTable('order_payments');
  if (hasOrderPaymentsTable) {
    const paymentCols = await knex('information_schema.columns')
      .select(['column_name'])
      .where({ table_name: 'order_payments' })
      .then((rows) => rows.map((r) => String(r.column_name)));

    if (!paymentCols.includes('shift_id')) {
      await knex.schema.alterTable('order_payments', (t) => {
        t.string('shift_id', 64).nullable().index();
      });
    }

    if (!paymentCols.includes('business_date')) {
      await knex.schema.alterTable('order_payments', (t) => {
        t.date('business_date').nullable().index();
      });
    }
  }

  // Add shift_type to restaurant_tables table
  const hasRestaurantTables = await knex.schema.hasTable('restaurant_tables');
  if (hasRestaurantTables) {
    const tableCols = await knex('information_schema.columns')
      .select(['column_name'])
      .where({ table_name: 'restaurant_tables' })
      .then((rows) => rows.map((r) => String(r.column_name)));

    if (!tableCols.includes('shift_type')) {
      await knex.schema.alterTable('restaurant_tables', (t) => {
        t.string('shift_type', 16).notNullable().defaultTo('ALL').index();
      });
    }
  }

  // Add enable_shift_management to branches table
  const hasBranchesTable = await knex.schema.hasTable('branches');
  if (hasBranchesTable) {
    const branchCols = await knex('information_schema.columns')
      .select(['column_name'])
      .where({ table_name: 'branches' })
      .then((rows) => rows.map((r) => String(r.column_name)));

    if (!branchCols.includes('enable_shift_management')) {
      await knex.schema.alterTable('branches', (t) => {
        t.boolean('enable_shift_management').notNullable().defaultTo(false);
      });
    }
  }

  // Create shift_audit_log table for tracking all shift-related actions
  const hasShiftAuditTable = await knex.schema.hasTable('shift_audit_log');
  if (!hasShiftAuditTable) {
    await knex.schema.createTable('shift_audit_log', (t) => {
      t.string('id', 64).primary();
      t.string('tenant_id', 64).notNullable().index();
      t.string('branch_id', 64).notNullable().index();
      t.string('shift_id', 64).notNullable().index();
      t.string('action', 64).notNullable(); // 'shift.opened', 'shift.closed', 'table.assigned', etc.
      t.string('actor_staff_id', 64).notNullable();
      t.string('actor_role', 64).nullable();
      t.text('payload_json').nullable();
      t.datetime('created_at').notNullable().index();
    });
  }

  // Add indexes for performance
  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_orders_shift_id ON orders (shift_id)');
  } catch {}
  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_orders_business_date ON orders (business_date)');
  } catch {}
  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_order_payments_shift_id ON order_payments (shift_id)');
  } catch {}
  try {
    await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_restaurant_tables_shift_type ON restaurant_tables (shift_type)');
  } catch {}
};

exports.down = async (knex) => {
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('shift_audit_log');

  // Remove columns from orders
  const hasOrdersTable = await knex.schema.hasTable('orders');
  if (hasOrdersTable) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('shift_id');
      t.dropColumn('business_date');
    });
  }

  // Remove columns from order_payments
  const hasOrderPaymentsTable = await knex.schema.hasTable('order_payments');
  if (hasOrderPaymentsTable) {
    await knex.schema.alterTable('order_payments', (t) => {
      t.dropColumn('shift_id');
      t.dropColumn('business_date');
    });
  }

  // Remove columns from restaurant_tables
  const hasRestaurantTables = await knex.schema.hasTable('restaurant_tables');
  if (hasRestaurantTables) {
    await knex.schema.alterTable('restaurant_tables', (t) => {
      t.dropColumn('shift_type');
    });
  }

  // Remove columns from branches
  const hasBranchesTable = await knex.schema.hasTable('branches');
  if (hasBranchesTable) {
    await knex.schema.alterTable('branches', (t) => {
      t.dropColumn('enable_shift_management');
    });
  }

  // Drop shifts table last
  await knex.schema.dropTableIfExists('shifts');
};
