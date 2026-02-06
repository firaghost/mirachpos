exports.up = async (knex) => {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_dss_tenant_branch_date ON daily_sales_summary (tenant_id, branch_id, report_date)',
    'CREATE INDEX IF NOT EXISTS idx_hss_tenant_branch_date ON hourly_sales_summary (tenant_id, branch_id, report_date)',
    'CREATE INDEX IF NOT EXISTS idx_pss_tenant_branch_date ON product_sales_summary (tenant_id, branch_id, report_date)',
    'CREATE INDEX IF NOT EXISTS idx_css_tenant_branch_date ON category_sales_summary (tenant_id, branch_id, report_date)',
    'CREATE INDEX IF NOT EXISTS idx_sss_tenant_branch_date ON staff_sales_summary (tenant_id, branch_id, report_date)',
    'CREATE INDEX IF NOT EXISTS idx_shift_reports_tenant_branch_opened ON shift_reports (tenant_id, branch_id, opened_at)',
    'CREATE INDEX IF NOT EXISTS idx_orders_tenant_branch_paid ON orders (tenant_id, branch_id, paid_at)',
  ];

  for (const stmt of statements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.raw(stmt);
    } catch {
      // ignore
    }
  }
};

exports.down = async (knex) => {
  const statements = [
    'DROP INDEX IF EXISTS idx_dss_tenant_branch_date ON daily_sales_summary',
    'DROP INDEX IF EXISTS idx_hss_tenant_branch_date ON hourly_sales_summary',
    'DROP INDEX IF EXISTS idx_pss_tenant_branch_date ON product_sales_summary',
    'DROP INDEX IF EXISTS idx_css_tenant_branch_date ON category_sales_summary',
    'DROP INDEX IF EXISTS idx_sss_tenant_branch_date ON staff_sales_summary',
    'DROP INDEX IF EXISTS idx_shift_reports_tenant_branch_opened ON shift_reports',
    'DROP INDEX IF EXISTS idx_orders_tenant_branch_paid ON orders',
  ];

  for (const stmt of statements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.raw(stmt);
    } catch {
      // ignore
    }
  }
};
