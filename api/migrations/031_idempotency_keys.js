/**
 * Migration: Add idempotency_keys table for payment deduplication
 */

exports.up = async function (knex) {
    // Create idempotency_keys table
    await knex.schema.createTable('idempotency_keys', (t) => {
        t.string('id', 64).primary();
        t.string('key', 255).notNullable().unique();
        t.string('path', 255);
        t.text('response_json');
        t.datetime('created_at').notNullable();
        t.index(['key']);
        t.index(['created_at']);
    });

    // Add idempotency_key to payments table if not exists
    const hasColumn = await knex.schema.hasColumn('payments', 'idempotency_key');
    if (!hasColumn) {
        await knex.schema.alterTable('payments', (t) => {
            t.string('idempotency_key', 255).nullable();
            t.index(['idempotency_key']);
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('idempotency_keys');

    const hasColumn = await knex.schema.hasColumn('payments', 'idempotency_key');
    if (hasColumn) {
        await knex.schema.alterTable('payments', (t) => {
            t.dropColumn('idempotency_key');
        });
    }
};
