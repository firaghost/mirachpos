exports.up = async function (knex) {
    const hasSubs = await knex.schema.hasTable('telebirr_subscriptions');
    if (!hasSubs) {
        await knex.schema.createTable('telebirr_subscriptions', (t) => {
            t.string('id').primary();
            t.string('tenant_id').notNullable().index();
            t.string('user_id').nullable().index();

            t.string('phone_number', 15).notNullable();
            t.decimal('plan_amount', 10, 2).notNullable();

            t.string('out_subscription_no', 100).notNullable();
            t.string('telebirr_subscription_id', 100).nullable();

            t.unique(['out_subscription_no'], 'ux_tso_out_sub_no');
            t.unique(['telebirr_subscription_id'], 'ux_tso_tb_sub_id');

            t.string('status').notNullable().defaultTo('pending').index(); // pending, active, cancelled, failed

            t.date('next_charge_date').notNullable().index();
            t.string('cycle').notNullable().defaultTo('MONTHLY'); // DAILY, MONTHLY, YEARLY
            t.integer('execute_day').notNullable().defaultTo(1); // day-of-month
            t.integer('validity_months').notNullable().defaultTo(12);

            // Audit trail
            t.datetime('last_webhook_at').nullable();
            t.integer('webhook_count').notNullable().defaultTo(0);
            t.integer('failure_count').notNullable().defaultTo(0);

            t.text('last_error').nullable();

            t.datetime('created_at').notNullable();
            t.datetime('updated_at').notNullable();
        });
    }

    const hasTx = await knex.schema.hasTable('subscription_transactions');
    if (!hasTx) {
        await knex.schema.createTable('subscription_transactions', (t) => {
            t.string('id').primary();
            t.string('subscription_id').notNullable().index();

            t.string('out_subscription_no', 100).notNullable();
            t.string('telebirr_order_sn', 100).nullable();
            t.decimal('amount', 10, 2).notNullable();

            t.string('status').notNullable().defaultTo('pending').index(); // pending, success, failed
            t.text('raw_payload_json').nullable();

            t.datetime('processed_at').nullable();
            t.datetime('created_at').notNullable();
            t.datetime('updated_at').notNullable();

            t.unique(['subscription_id', 'out_subscription_no'], 'ux_stx_sub_out');
        });
    }

    // FK (best-effort) - avoid failing if already exists.
    // If this throws in a specific MySQL version, it can be added manually.
    try {
        await knex.schema.alterTable('subscription_transactions', (t) => {
            t.foreign('subscription_id').references('telebirr_subscriptions.id');
        });
    } catch {
        // ignore
    }
};

exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('subscription_transactions')
        .dropTableIfExists('telebirr_subscriptions');
};
