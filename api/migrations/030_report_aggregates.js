/**
 * Migration: Report Aggregation Tables
 * 
 * Creates pre-aggregated tables for fast report generation:
 * - daily_sales_summary: Daily totals per branch
 * - hourly_sales_summary: Hourly breakdowns for peak analysis
 * - product_sales_summary: Product performance aggregates
 * - shift_reports: Shift-based financial summaries
 */

exports.up = async (knex) => {
    const hasTable = async (name) => {
        try {
            return await knex.schema.hasTable(name);
        } catch {
            return false;
        }
    };

    if (!(await hasTable('daily_sales_summary'))) {
        await knex.schema.createTable('daily_sales_summary', (t) => {
        t.string('id', 64).primary(); // dss_tenantId_branchId_date
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.date('report_date').notNullable();
        t.integer('order_count').notNullable().defaultTo(0);
        t.integer('item_count').notNullable().defaultTo(0);
        t.decimal('gross_sales_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('discounts_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('net_sales_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('tax_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('tips_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('total_collected_etb', 14, 2).notNullable().defaultTo(0);
        t.integer('void_count').notNullable().defaultTo(0);
        t.decimal('void_amount_etb', 14, 2).notNullable().defaultTo(0);
        t.integer('refund_count').notNullable().defaultTo(0);
        t.decimal('refund_amount_etb', 14, 2).notNullable().defaultTo(0);
        t.text('payment_breakdown_json').nullable(); // { cash: 1000, card: 500, telebirr: 200 }
        t.decimal('avg_ticket_etb', 14, 2).notNullable().defaultTo(0);
        t.datetime('first_order_at').nullable();
        t.datetime('last_order_at').nullable();
        t.datetime('computed_at').notNullable();
        t.unique(['tenant_id', 'branch_id', 'report_date'], 'uq_dss_t_b_d');
        });
    }

    // Hourly sales summary (for peak hour analysis)
    if (!(await hasTable('hourly_sales_summary'))) {
        await knex.schema.createTable('hourly_sales_summary', (t) => {
        t.string('id', 64).primary(); // hss_tenantId_branchId_date_hour
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.date('report_date').notNullable();
        t.integer('hour').notNullable(); // 0-23
        t.integer('order_count').notNullable().defaultTo(0);
        t.decimal('net_sales_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('total_collected_etb', 14, 2).notNullable().defaultTo(0);
        t.datetime('computed_at').notNullable();
        t.unique(['tenant_id', 'branch_id', 'report_date', 'hour'], 'uq_hss_t_b_d_h');
        });
    }

    // Product sales summary (daily)
    if (!(await hasTable('product_sales_summary'))) {
        await knex.schema.createTable('product_sales_summary', (t) => {
        t.string('id', 64).primary(); // pss_tenantId_branchId_productId_date
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.string('product_id', 64).notNullable().index();
        t.string('product_name', 255).nullable();
        t.string('category', 128).nullable();
        t.date('report_date').notNullable();
        t.integer('qty_sold').notNullable().defaultTo(0);
        t.decimal('revenue_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('cost_etb', 14, 2).notNullable().defaultTo(0);
        t.decimal('profit_etb', 14, 2).notNullable().defaultTo(0);
        t.integer('void_qty').notNullable().defaultTo(0);
        t.datetime('computed_at').notNullable();
        t.unique(['tenant_id', 'branch_id', 'product_id', 'report_date'], 'uq_pss_t_b_p_d');
        });
    }

    // Shift reports
    if (!(await hasTable('shift_reports'))) {
        await knex.schema.createTable('shift_reports', (t) => {
        t.string('id', 64).primary(); // shift_xxx
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.string('staff_id', 64).nullable(); // Cashier who ran the shift
        t.string('staff_name', 255).nullable();
        t.string('status', 32).notNullable().defaultTo('open'); // open, closed
        t.datetime('opened_at').notNullable();
        t.datetime('closed_at').nullable();
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
        t.integer('void_count').notNullable().defaultTo(0);
        t.decimal('void_amount_etb', 14, 2).notNullable().defaultTo(0);
        t.integer('refund_count').notNullable().defaultTo(0);
        t.decimal('refund_amount_etb', 14, 2).notNullable().defaultTo(0);
        t.text('notes').nullable();
        t.text('metadata_json').nullable();
        t.datetime('created_at').notNullable();
        t.datetime('updated_at').notNullable();
        });
    }

    // Category sales summary (daily)
    if (!(await hasTable('category_sales_summary'))) {
        await knex.schema.createTable('category_sales_summary', (t) => {
        t.string('id', 64).primary();
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.string('category', 128).notNullable();
        t.date('report_date').notNullable();
        t.integer('qty_sold').notNullable().defaultTo(0);
        t.decimal('revenue_etb', 14, 2).notNullable().defaultTo(0);
        t.integer('order_count').notNullable().defaultTo(0);
        t.datetime('computed_at').notNullable();
        t.unique(['tenant_id', 'branch_id', 'category', 'report_date'], 'uq_css_t_b_c_d');
        });
    }

    // Void/Refund detailed log for analysis
    if (!(await hasTable('void_refund_log'))) {
        await knex.schema.createTable('void_refund_log', (t) => {
        t.string('id', 64).primary();
        t.string('tenant_id', 64).notNullable().index();
        t.string('branch_id', 64).notNullable().index();
        t.string('order_id', 64).notNullable();
        t.string('type', 16).notNullable(); // void, refund
        t.string('product_id', 64).nullable();
        t.string('product_name', 255).nullable();
        t.integer('qty').notNullable().defaultTo(1);
        t.decimal('amount_etb', 14, 2).notNullable();
        t.string('reason', 255).nullable();
        t.string('authorized_by', 64).nullable(); // Staff who authorized
        t.string('performed_by', 64).nullable(); // Staff who performed
        t.datetime('occurred_at').notNullable();
        t.datetime('created_at').notNullable();
        });
    }

    // Add indexes for common queries
    try { await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_dss_tenant_date ON daily_sales_summary (tenant_id, report_date)'); } catch {}
    try { await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_hss_tenant_date ON hourly_sales_summary (tenant_id, report_date)'); } catch {}
    try { await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_pss_tenant_date ON product_sales_summary (tenant_id, report_date)'); } catch {}
    try { await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_shift_tenant_branch ON shift_reports (tenant_id, branch_id, opened_at)'); } catch {}
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists('void_refund_log');
    await knex.schema.dropTableIfExists('category_sales_summary');
    await knex.schema.dropTableIfExists('shift_reports');
    await knex.schema.dropTableIfExists('product_sales_summary');
    await knex.schema.dropTableIfExists('hourly_sales_summary');
    await knex.schema.dropTableIfExists('daily_sales_summary');
};
