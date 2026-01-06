exports.up = async (knex) => {
  const hasPriceMonthly = await knex.schema.hasColumn('plans', 'price_monthly_etb');
  if (!hasPriceMonthly) {
    await knex.schema.table('plans', (t) => {
      t.decimal('price_monthly_etb', 12, 2).notNullable().defaultTo(0);
      t.decimal('price_yearly_etb', 12, 2).notNullable().defaultTo(0);
      t.longtext('limits_json').nullable();
    });
  }

  const nowIso = new Date().toISOString();
  const setIfExists = async (tier, patch) => {
    const row = await knex('plans').where({ tier }).first();
    if (!row) return;
    await knex('plans').where({ tier }).update({ ...patch, updated_at: nowIso });
  };

  // Default ETB pricing (edit later via Super Admin).
  await setIfExists('Trial', { price_monthly_etb: 0, price_yearly_etb: 0, limits_json: JSON.stringify({ branchLimit: 1, staffLimit: 5 }) });
  await setIfExists('Basic', { price_monthly_etb: 2500, price_yearly_etb: 2500 * 10, limits_json: JSON.stringify({ branchLimit: 1, staffLimit: 25 }) });
  await setIfExists('Pro', { price_monthly_etb: 6000, price_yearly_etb: 6000 * 10, limits_json: JSON.stringify({ branchLimit: 3, staffLimit: 100 }) });
  await setIfExists('Enterprise', { price_monthly_etb: 12000, price_yearly_etb: 12000 * 10, limits_json: JSON.stringify({ branchLimit: 999, staffLimit: 9999 }) });
};

exports.down = async (knex) => {
  const hasPriceMonthly = await knex.schema.hasColumn('plans', 'price_monthly_etb');
  if (!hasPriceMonthly) return;

  await knex.schema.table('plans', (t) => {
    t.dropColumn('limits_json');
    t.dropColumn('price_yearly_etb');
    t.dropColumn('price_monthly_etb');
  });
};
