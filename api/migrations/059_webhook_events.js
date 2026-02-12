exports.up = async (knex) => {
    const exists = await knex.schema.hasTable('webhook_events');
    if (exists) return;

    await knex.schema.createTable('webhook_events', (t) => {
        t.increments('id').primary();
        t.string('gateway', 32).notNullable();
        t.string('event_key', 128).notNullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.unique(['gateway', 'event_key'], { indexName: 'ux_webhook_events_gateway_key' });
    });
};

exports.down = async (knex) => {
    const exists = await knex.schema.hasTable('webhook_events');
    if (!exists) return;
    await knex.schema.dropTable('webhook_events');
};
