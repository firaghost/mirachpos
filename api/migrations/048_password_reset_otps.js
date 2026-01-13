exports.up = async (knex) => {
  const has = await knex.schema.hasTable('password_reset_otps');
  if (has) return;

  await knex.schema.createTable('password_reset_otps', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('email', 255).notNullable().index();

    t.string('otp_hash', 255).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);

    t.datetime('expires_at').notNullable().index();
    t.datetime('used_at').nullable().index();

    t.string('request_ip', 64).nullable();
    t.datetime('created_at').notNullable().index();

    t.index(['tenant_id', 'email', 'created_at'], 'idx_pwreset_email_scope');
  });
};

exports.down = async (knex) => {
  const has = await knex.schema.hasTable('password_reset_otps');
  if (!has) return;
  await knex.schema.dropTable('password_reset_otps');
};
