exports.up = async (knex) => {
  await knex.schema.createTable('finance_ledger', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('branch_id', 64).nullable().index();
    t.string('category', 64).notNullable().index();
    t.string('type', 16).notNullable().index();
    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.string('currency', 16).nullable();
    t.string('memo', 255).nullable();
    t.longtext('payload_json').nullable();
    t.datetime('at').notNullable().index();
    t.datetime('created_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('finance_ledger');
};
