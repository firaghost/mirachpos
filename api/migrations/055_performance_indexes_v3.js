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
  // Index for tenant-wide reports (no branch filter) - status + paid_at
  await createIndexIfMissing(knex, {
    table: 'orders',
    index: 'idx_orders_tenant_status_paid',
    columns: 'tenant_id, status, paid_at',
  });
};

exports.down = async (knex) => {
  await dropIndexIfExists(knex, { table: 'orders', index: 'idx_orders_tenant_status_paid' });
};
