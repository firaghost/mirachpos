exports.up = async (knex) => {
    const exists = await knex.schema.hasTable('webhook_events');
    if (!exists) return;

    await knex.schema.alterTable('webhook_events', (t) => {
        t.index(['created_at'], 'ix_webhook_events_created_at');
        t.index(['gateway', 'created_at'], 'ix_webhook_events_gateway_created_at');
    });
};

exports.down = async (knex) => {
    const exists = await knex.schema.hasTable('webhook_events');
    if (!exists) return;

    await knex.schema.alterTable('webhook_events', (t) => {
        t.dropIndex(['created_at'], 'ix_webhook_events_created_at');
        t.dropIndex(['gateway', 'created_at'], 'ix_webhook_events_gateway_created_at');
    });
};
