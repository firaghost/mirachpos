exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('audit_log', 'request_id');
  if (has) return;
  await knex.schema.alterTable('audit_log', (t) => {
    t.string('request_id', 96).nullable().index();
  });
};

exports.down = async (knex) => {
  const has = await knex.schema.hasColumn('audit_log', 'request_id');
  if (!has) return;
  await knex.schema.alterTable('audit_log', (t) => {
    t.dropColumn('request_id');
  });
};
