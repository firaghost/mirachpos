exports.up = async (knex) => {
  // Add a monotonic cursor for sync ordering.
  // MySQL: AUTO_INCREMENT column must be indexed; we keep existing string id primary key.
  await knex.raw(
    'ALTER TABLE sync_events ' +
      'ADD COLUMN `cursor` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ' +
      'ADD UNIQUE KEY `ux_sync_events_cursor` (`cursor`)',
  );
};

exports.down = async (knex) => {
  // Best-effort rollback.
  await knex.raw('ALTER TABLE sync_events DROP INDEX `ux_sync_events_cursor`');
  await knex.raw('ALTER TABLE sync_events DROP COLUMN `cursor`');
};
