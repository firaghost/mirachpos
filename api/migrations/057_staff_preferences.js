/**
 * Migration: Add staff preferences column
 */

exports.up = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('staff', 'preferences_json');
  if (!hasColumn) {
    await knex.schema.alterTable('staff', (table) => {
      table.text('preferences_json').nullable();
    });
  }
};

exports.down = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('staff', 'preferences_json');
  if (hasColumn) {
    await knex.schema.alterTable('staff', (table) => {
      table.dropColumn('preferences_json');
    });
  }
};
