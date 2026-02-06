exports.up = async (knex) => {
  const has = await knex.schema.hasTable('print_queue');
  if (!has) return;

  const hasAttempts = await knex.schema.hasColumn('print_queue', 'attempts');
  if (!hasAttempts) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.integer('attempts').notNullable().defaultTo(0);
    });
  }

  const hasLastAttemptAt = await knex.schema.hasColumn('print_queue', 'last_attempt_at');
  if (!hasLastAttemptAt) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.datetime('last_attempt_at').nullable();
    });
  }

  const hasNextAttemptAt = await knex.schema.hasColumn('print_queue', 'next_attempt_at');
  if (!hasNextAttemptAt) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.datetime('next_attempt_at').nullable().index();
    });
  }

  const hasLastError = await knex.schema.hasColumn('print_queue', 'last_error');
  if (!hasLastError) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.string('last_error', 128).nullable();
    });
  }
};

exports.down = async (knex) => {
  const has = await knex.schema.hasTable('print_queue');
  if (!has) return;

  const hasLastError = await knex.schema.hasColumn('print_queue', 'last_error');
  if (hasLastError) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.dropColumn('last_error');
    });
  }

  const hasNextAttemptAt = await knex.schema.hasColumn('print_queue', 'next_attempt_at');
  if (hasNextAttemptAt) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.dropColumn('next_attempt_at');
    });
  }

  const hasLastAttemptAt = await knex.schema.hasColumn('print_queue', 'last_attempt_at');
  if (hasLastAttemptAt) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.dropColumn('last_attempt_at');
    });
  }

  const hasAttempts = await knex.schema.hasColumn('print_queue', 'attempts');
  if (hasAttempts) {
    await knex.schema.alterTable('print_queue', (t) => {
      t.dropColumn('attempts');
    });
  }
};
