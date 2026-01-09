exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('tenant_pos_payment_gateways');
  if (exists) return;

  await knex.schema.createTable('tenant_pos_payment_gateways', (t) => {
    t.string('tenant_id', 64).notNullable().index();
    t.string('gateway', 32).notNullable().index(); // chapa | telebirr | cbe_birr

    t.boolean('enabled').notNullable().defaultTo(false).index();
    t.longtext('config_json').nullable(); // { secretKey, webhookSecret, ... }

    t.datetime('updated_at').notNullable().index();

    t.primary(['tenant_id', 'gateway']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('tenant_pos_payment_gateways');
};
