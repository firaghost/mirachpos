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
    await knex.schema.raw(`DROP INDEX ${index} ON ${table}`);
  } catch {
    // ignore
  }
};

exports.up = async (knex) => {
  // Index for invoice listing with sorting (tenant billing pages)
  await createIndexIfMissing(knex, {
    table: 'invoices',
    index: 'idx_invoices_tenant_created',
    columns: 'tenant_id, created_at',
  });

  // Index for pending invoice lookups
  await createIndexIfMissing(knex, {
    table: 'invoices',
    index: 'idx_invoices_tenant_status',
    columns: 'tenant_id, status',
  });

  // Index for payment gateway webhook lookups (tx_ref + gateway combo)
  await createIndexIfMissing(knex, {
    table: 'pos_payment_gateway_transactions',
    index: 'idx_pgt_tx_ref_gateway',
    columns: 'tx_ref, gateway',
  });

  // Index for tenant subscription lookups (entitlements, auth)
  await createIndexIfMissing(knex, {
    table: 'tenant_subscription',
    index: 'idx_tenant_sub_tenant_id',
    columns: 'tenant_id',
  });

  // Index for subscription status checks
  await createIndexIfMissing(knex, {
    table: 'tenant_subscription',
    index: 'idx_tenant_sub_status',
    columns: 'status',
  });
};

exports.down = async (knex) => {
  await dropIndexIfExists(knex, { table: 'invoices', index: 'idx_invoices_tenant_created' });
  await dropIndexIfExists(knex, { table: 'invoices', index: 'idx_invoices_tenant_status' });
  await dropIndexIfExists(knex, { table: 'pos_payment_gateway_transactions', index: 'idx_pgt_tx_ref_gateway' });
  await dropIndexIfExists(knex, { table: 'tenant_subscription', index: 'idx_tenant_sub_tenant_id' });
  await dropIndexIfExists(knex, { table: 'tenant_subscription', index: 'idx_tenant_sub_status' });
};
