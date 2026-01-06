
exports.up = function (knex) {
    return knex.schema.createTable('jobs', table => {
        table.string('id').primary();
        table.string('type').notNullable().index(); // e.g., 'email', 'check_invoice', 'webhook'
        table.json('payload_json').nullable();

        // Status tracking
        table.string('status').notNullable().defaultTo('pending').index(); // pending, processing, completed, failed
        table.integer('attempts').notNullable().defaultTo(0);
        table.text('last_error').nullable();

        // Scheduling
        table.datetime('run_at').notNullable().index(); // When to run (defaults to now)

        // Timestamps
        table.datetime('created_at').notNullable();
        table.datetime('updated_at').notNullable();
        table.datetime('completed_at').nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('jobs');
};
