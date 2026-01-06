exports.up = async (knex) => {
  await knex.schema.createTable('plans', (t) => {
    t.string('tier', 32).primary();
    t.longtext('modules_json').nullable();
    t.datetime('updated_at').notNullable();
  });

  await knex.schema.createTable('tenant_subscription', (t) => {
    t.string('tenant_id', 64).primary();
    t.string('tier', 32).notNullable();
    t.longtext('modules_json').nullable();
    t.string('cycle', 32).notNullable().defaultTo('Monthly');
    t.string('status', 32).notNullable().defaultTo('active');
    t.string('method', 32).notNullable().defaultTo('manual');
    t.datetime('next_bill_at').nullable();
    t.decimal('amount_etb', 12, 2).notNullable().defaultTo(0);
    t.datetime('grace_ends_at').nullable();
    t.datetime('updated_at').notNullable();
  });

  const nowIso = new Date().toISOString();

  // These rows live in the database (not hardcoded in API responses). You can edit them later.
  await knex('plans').insert([
    { tier: 'Trial', modules_json: JSON.stringify(['settings']), updated_at: nowIso },
    { tier: 'Basic', modules_json: JSON.stringify(['settings']), updated_at: nowIso },
    { tier: 'Pro', modules_json: JSON.stringify(['settings']), updated_at: nowIso },
  ]);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tenant_subscription');
  await knex.schema.dropTableIfExists('plans');
};
