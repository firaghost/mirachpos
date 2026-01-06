exports.up = async (knex) => {
  const hasRequestedTier = await knex.schema.hasColumn('tenant_subscription', 'requested_tier');
  const hasRequestedCycle = await knex.schema.hasColumn('tenant_subscription', 'requested_cycle');
  const hasRequestedAt = await knex.schema.hasColumn('tenant_subscription', 'requested_at');

  if (!hasRequestedTier || !hasRequestedCycle || !hasRequestedAt) {
    await knex.schema.table('tenant_subscription', (t) => {
      if (!hasRequestedTier) t.string('requested_tier', 32).nullable();
      if (!hasRequestedCycle) t.string('requested_cycle', 32).nullable();
      if (!hasRequestedAt) t.datetime('requested_at').nullable();
    });
  }
};

exports.down = async (knex) => {
  const hasRequestedTier = await knex.schema.hasColumn('tenant_subscription', 'requested_tier');
  const hasRequestedCycle = await knex.schema.hasColumn('tenant_subscription', 'requested_cycle');
  const hasRequestedAt = await knex.schema.hasColumn('tenant_subscription', 'requested_at');

  if (!hasRequestedTier && !hasRequestedCycle && !hasRequestedAt) return;

  await knex.schema.table('tenant_subscription', (t) => {
    if (hasRequestedAt) t.dropColumn('requested_at');
    if (hasRequestedCycle) t.dropColumn('requested_cycle');
    if (hasRequestedTier) t.dropColumn('requested_tier');
  });
};
