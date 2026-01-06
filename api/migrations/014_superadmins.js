exports.up = async (knex) => {
  await knex.schema.createTable('superadmins', (t) => {
    t.string('id', 64).primary();
    t.string('email', 255).notNullable().unique();
    t.string('name', 255).nullable();
    t.string('password_hash', 255).notNullable();
    t.enu('status', ['Active', 'Suspended']).notNullable().defaultTo('Active');
    t.datetime('last_login_at').nullable();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('superadmins');
};
