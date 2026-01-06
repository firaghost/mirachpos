exports.up = async (knex) => {
  await knex.schema.table('tenants', (t) => {
    t.longtext('enabled_modules_json').nullable();
    t.longtext('features_json').nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.table('tenants', (t) => {
    t.dropColumn('features_json');
    t.dropColumn('enabled_modules_json');
  });
};
