exports.up = async (knex) => {
  await knex.schema.createTable('owner_invites', (t) => {
    t.string('id', 64).primary();
    t.string('tenant_id', 64).notNullable().index();
    t.string('role_name', 64).notNullable();
    t.string('branch_id', 64).nullable().index();
    t.string('code', 64).notNullable().unique();
    t.datetime('expires_at').notNullable().index();
    t.datetime('used_at').nullable().index();
    t.string('used_by_staff_id', 64).nullable().index();
    t.datetime('created_at').notNullable().index();
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('owner_invites');
};
