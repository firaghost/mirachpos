exports.up = async (knex) => {
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

    await addIfMissing('order_type', (t) => t.string('order_type', 32).nullable().index());
    await addIfMissing('takeaway_fee', (t) => t.decimal('takeaway_fee', 12, 2).nullable());
  }
};

exports.down = async (knex) => {
  const hasOrders = await knex.schema.hasTable('orders');
  if (hasOrders) {
    await knex.schema.alterTable('orders', (t) => {
      try { t.dropColumn('order_type'); } catch {}
      try { t.dropColumn('takeaway_fee'); } catch {}
    });
  }
};
