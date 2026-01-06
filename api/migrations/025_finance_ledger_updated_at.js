exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('finance_ledger', 'updated_at');
  if (!has) {
    await knex.schema.table('finance_ledger', (t) => {
      t.datetime('updated_at').nullable().index();
    });
  }
};

exports.down = async (knex) => {
  const has = await knex.schema.hasColumn('finance_ledger', 'updated_at');
  if (has) {
    await knex.schema.table('finance_ledger', (t) => {
      t.dropColumn('updated_at');
    });
  }
};
