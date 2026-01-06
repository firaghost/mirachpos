exports.up = async (knex) => {
  const has = await knex.schema.hasTable('superadmin_dunning_steps');
  if (!has) {
    await knex.schema.createTable('superadmin_dunning_steps', (t) => {
      t.string('id', 64).primary();
      t.integer('offset_days').notNullable(); // relative to due date (negative = before)
      t.string('title', 128).notNullable();
      t.longtext('body_template').nullable();
      t.string('channel', 32).notNullable().defaultTo('email');
      t.boolean('enabled').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.datetime('created_at').notNullable();
      t.datetime('updated_at').notNullable();
    });
  }

  const nowIso = new Date().toISOString();
  const existing = await knex('superadmin_dunning_steps').count({ c: '*' }).first().catch(() => null);
  const total = Number(existing?.c || 0);
  if (total === 0) {
    await knex('superadmin_dunning_steps').insert([
      {
        id: `dsn_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        offset_days: -7,
        title: 'Upcoming Invoice',
        body_template: 'Dear {Tenant}, your invoice for {Amount} will be generated next week.',
        channel: 'email',
        enabled: true,
        sort_order: 10,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: `dsn_${Math.random().toString(16).slice(2)}_${(Date.now() + 1).toString(16)}`,
        offset_days: 0,
        title: 'Payment Due Now',
        body_template: 'Your payment is due today. Please complete payment to avoid service disruption.',
        channel: 'email',
        enabled: true,
        sort_order: 20,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: `dsn_${Math.random().toString(16).slice(2)}_${(Date.now() + 2).toString(16)}`,
        offset_days: 3,
        title: 'Overdue Notice 1',
        body_template: 'Action required: your invoice is overdue. Service suspension may occur soon.',
        channel: 'email',
        enabled: true,
        sort_order: 30,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('superadmin_dunning_steps');
};
