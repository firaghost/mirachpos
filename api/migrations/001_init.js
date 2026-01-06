exports.up = async (knex) => {
  await knex.schema.createTable('tenants', (t) => {
    t.string('id', 64).primary();
    t.string('slug', 64).notNullable().unique();
    t.string('name', 255).notNullable();
    t.enu('status', ['trial', 'active', 'suspended']).notNullable().defaultTo('trial');
    t.datetime('trial_ends_at').nullable();
    t.string('plan', 32).notNullable().defaultTo('trial');
    t.datetime('plan_ends_at').nullable();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').nullable();
  });

  await knex.schema.createTable('branches', (b) => {
    b.string('id', 64).primary();
    b.string('tenant_id', 64).notNullable().index();
    b.string('name', 255).notNullable();
    b.string('status', 32).notNullable().defaultTo('Open');
    b.string('city', 128).nullable();
    b.string('address', 255).nullable();
    b.string('phone', 64).nullable();
    b.datetime('created_at').notNullable();
    b.datetime('updated_at').nullable();
  });

  await knex.schema.createTable('roles', (r) => {
    r.string('id', 64).primary();
    r.string('tenant_id', 64).notNullable().index();
    r.string('name', 64).notNullable();
    r.enu('scope', ['global', 'branch']).notNullable().defaultTo('branch');
    r.longtext('permissions').nullable();
    r.datetime('created_at').notNullable();
  });

  await knex.schema.createTable('staff', (s) => {
    s.string('id', 64).primary();
    s.string('tenant_id', 64).notNullable().index();
    s.string('branch_id', 64).nullable().index();
    s.string('role_id', 64).nullable().index();
    s.string('role_name', 64).notNullable();
    s.string('name', 255).notNullable();
    s.string('email', 255).notNullable();
    s.string('phone', 64).nullable();
    s.string('code', 64).nullable();
    s.string('password_hash', 255).notNullable();
    s.string('pin_hash', 255).nullable();
    s.enu('status', ['Active', 'On Leave', 'Suspended']).notNullable().defaultTo('Active');
    s.datetime('last_login_at').nullable();
    s.datetime('created_at').notNullable();
    s.datetime('updated_at').nullable();
    s.unique(['tenant_id', 'email']);
  });

  await knex.schema.createTable('refresh_tokens', (rt) => {
    rt.string('id', 64).primary();
    rt.string('tenant_id', 64).notNullable().index();
    rt.string('staff_id', 64).notNullable().index();
    rt.string('token_hash', 255).notNullable();
    rt.datetime('expires_at').notNullable();
    rt.datetime('revoked_at').nullable();
    rt.datetime('created_at').notNullable();
  });

  await knex.schema.createTable('events', (e) => {
    e.string('id', 64).primary();
    e.string('tenant_id', 64).notNullable().index();
    e.string('branch_id', 64).nullable().index();
    e.string('type', 64).notNullable().index();
    e.longtext('payload').nullable();
    e.datetime('at').notNullable().index();
  });

  await knex.schema.createTable('shift_logs', (l) => {
    l.string('id', 64).primary();
    l.string('tenant_id', 64).notNullable().index();
    l.string('branch_id', 64).notNullable().index();
    l.string('staff_id', 64).notNullable().index();
    l.datetime('clock_in_at').notNullable().index();
    l.datetime('clock_out_at').nullable().index();
  });

  await knex.schema.createTable('schedules_by_week', (sw) => {
    sw.string('id', 64).primary();
    sw.string('tenant_id', 64).notNullable().index();
    sw.string('branch_id', 64).notNullable().index();
    sw.string('week_start', 10).notNullable().index();
    sw.longtext('rows').nullable();
    sw.datetime('updated_at').notNullable();
    sw.unique(['tenant_id', 'branch_id', 'week_start']);
  });

  await knex.schema.createTable('orders', (o) => {
    o.string('id', 64).primary();
    o.string('tenant_id', 64).notNullable().index();
    o.string('branch_id', 64).notNullable().index();
    o.string('status', 32).notNullable();
    o.decimal('total', 12, 2).notNullable().defaultTo(0);
    o.decimal('tax', 12, 2).notNullable().defaultTo(0);
    o.decimal('tip', 12, 2).notNullable().defaultTo(0);
    o.decimal('discount', 12, 2).notNullable().defaultTo(0);
    o.datetime('created_at').notNullable().index();
    o.datetime('paid_at').nullable().index();
    o.longtext('payload').nullable();
  });

  await knex.schema.createTable('pos_state', (p) => {
    p.string('id', 64).primary();
    p.string('tenant_id', 64).notNullable().index();
    p.string('branch_id', 64).notNullable().index();
    p.longtext('state_json').nullable();
    p.datetime('updated_at').notNullable();
    p.unique(['tenant_id', 'branch_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('pos_state');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('schedules_by_week');
  await knex.schema.dropTableIfExists('shift_logs');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('staff');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('branches');
  await knex.schema.dropTableIfExists('tenants');
};
