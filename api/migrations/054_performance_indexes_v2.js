const indexExists = async (knex, { table, index }) => {
  try {
    const rows = await knex('information_schema.statistics')
      .select(['index_name'])
      .whereRaw('table_schema = DATABASE()')
      .andWhere({ table_name: table, index_name: index })
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
};

const createIndexIfMissing = async (knex, { table, index, columns }) => {
  if (!table || !index || !columns) return;
  const exists = await indexExists(knex, { table, index });
  if (exists) return;

  try {
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.raw(`CREATE INDEX ${index} ON ${table} (${columns})`);
  } catch {
    // ignore
  }
};

const dropIndexIfExists = async (knex, { table, index }) => {
  if (!table || !index) return;
  const exists = await indexExists(knex, { table, index });
  if (!exists) return;

  try {
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.raw(`DROP INDEX ${index} ON ${table}`);
  } catch {
    // ignore
  }
};

exports.up = async (knex) => {
  await createIndexIfMissing(knex, { table: 'orders', index: 'idx_orders_scope_created', columns: 'tenant_id, branch_id, created_at' });
  await createIndexIfMissing(knex, { table: 'orders', index: 'idx_orders_scope_status_created', columns: 'tenant_id, branch_id, status, created_at' });
  await createIndexIfMissing(knex, { table: 'orders', index: 'idx_orders_scope_status_paid', columns: 'tenant_id, branch_id, status, paid_at' });

  await createIndexIfMissing(knex, { table: 'audit_log', index: 'idx_audit_scope_created', columns: 'tenant_id, branch_id, created_at' });
  await createIndexIfMissing(knex, { table: 'audit_log', index: 'idx_audit_scope_type_created', columns: 'tenant_id, branch_id, type, created_at' });

  await createIndexIfMissing(knex, { table: 'pos_public_order_links', index: 'idx_pos_public_link_scope_purpose', columns: 'tenant_id, branch_id, order_id, purpose' });
  await createIndexIfMissing(knex, { table: 'pos_payment_gateway_transactions', index: 'idx_pgt_scope_order_created', columns: 'tenant_id, branch_id, order_id, created_at' });
};

exports.down = async (knex) => {
  await dropIndexIfExists(knex, { table: 'orders', index: 'idx_orders_scope_created' });
  await dropIndexIfExists(knex, { table: 'orders', index: 'idx_orders_scope_status_created' });
  await dropIndexIfExists(knex, { table: 'orders', index: 'idx_orders_scope_status_paid' });

  await dropIndexIfExists(knex, { table: 'audit_log', index: 'idx_audit_scope_created' });
  await dropIndexIfExists(knex, { table: 'audit_log', index: 'idx_audit_scope_type_created' });

  await dropIndexIfExists(knex, { table: 'pos_public_order_links', index: 'idx_pos_public_link_scope_purpose' });
  await dropIndexIfExists(knex, { table: 'pos_payment_gateway_transactions', index: 'idx_pgt_scope_order_created' });
};
