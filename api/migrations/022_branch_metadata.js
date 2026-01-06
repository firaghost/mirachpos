exports.up = async (knex) => {
  const hasManager = await knex.schema.hasColumn('branches', 'manager_name');
  if (!hasManager) {
    await knex.schema.table('branches', (t) => {
      t.string('manager_name', 255).nullable();
      t.string('region', 128).nullable();
      t.decimal('rating', 4, 2).notNullable().defaultTo(4.6);
    });
  }
};

exports.down = async (knex) => {
  const hasManager = await knex.schema.hasColumn('branches', 'manager_name');
  if (!hasManager) return;
  await knex.schema.table('branches', (t) => {
    t.dropColumn('rating');
    t.dropColumn('region');
    t.dropColumn('manager_name');
  });
};
