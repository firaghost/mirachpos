exports.up = async (knex) => {
  try {
    const hasPlans = await knex.schema.hasTable('plans');
    if (!hasPlans) return;

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const renameTier = async (from, to) => {
    if (from === to) return;

    const fromRow = await knex('plans').where({ tier: from }).first();
    if (!fromRow) return;

    const toRow = await knex('plans').where({ tier: to }).first();
    if (toRow) {
      await knex('plans').where({ tier: from }).del();
    } else {
      await knex('plans').where({ tier: from }).update({ tier: to, updated_at: nowIso });
    }

    const hasTenantSub = await knex.schema.hasTable('tenant_subscription');
    if (hasTenantSub) {
      const cols = await knex('tenant_subscription').columnInfo();
      if (cols?.tier) await knex('tenant_subscription').where({ tier: from }).update({ tier: to });
      if (cols?.requested_tier) await knex('tenant_subscription').where({ requested_tier: from }).update({ requested_tier: to });
    }

    const hasHistory = await knex.schema.hasTable('subscription_history');
    if (hasHistory) {
      const cols = await knex('subscription_history').columnInfo();
      if (cols?.from_tier) await knex('subscription_history').where({ from_tier: from }).update({ from_tier: to });
      if (cols?.to_tier) await knex('subscription_history').where({ to_tier: from }).update({ to_tier: to });
    }

    const hasEnt = await knex.schema.hasTable('tenant_entitlements');
    if (hasEnt) {
      const cols = await knex('tenant_entitlements').columnInfo();
      if (cols?.tier) await knex('tenant_entitlements').where({ tier: from }).update({ tier: to });
    }
  };

  await renameTier('Basic', 'Starter');
  await renameTier('Pro', 'Growth');
  await renameTier('Enterprise', 'Pro');

  const hasPricingCols = await knex.schema.hasColumn('plans', 'price_monthly_etb');
  if (!hasPricingCols) return;

  const upsertPlan = async ({ tier, monthlyEtb, yearlyEtb, limits }) => {
    const row = await knex('plans').where({ tier }).first();
    const patch = {
      price_monthly_etb: monthlyEtb,
      price_yearly_etb: yearlyEtb,
      limits_json: JSON.stringify(limits || {}),
      updated_at: nowIso,
    };

    if (row) {
      await knex('plans').where({ tier }).update(patch);
      return;
    }

    await knex('plans').insert({ tier, modules_json: JSON.stringify([]), ...patch });
  };

    await upsertPlan({ tier: 'Trial', monthlyEtb: 0, yearlyEtb: 0, limits: { branchLimit: 1, staffLimit: 5 } });
    await upsertPlan({ tier: 'Starter', monthlyEtb: 1500, yearlyEtb: 1500 * 10, limits: { branchLimit: 1, staffLimit: 25 } });
    await upsertPlan({ tier: 'Growth', monthlyEtb: 3500, yearlyEtb: 3500 * 10, limits: { branchLimit: 3, staffLimit: 100 } });
    await upsertPlan({ tier: 'Pro', monthlyEtb: 7000, yearlyEtb: 7000 * 10, limits: { branchLimit: 999, staffLimit: 9999 } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[049_pricing_tiers_starter_growth_pro] up failed', err);
    throw err;
  }
};

exports.down = async (knex) => {
  try {
    const hasPlans = await knex.schema.hasTable('plans');
    if (!hasPlans) return;

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const renameTier = async (from, to) => {
    if (from === to) return;
    const fromRow = await knex('plans').where({ tier: from }).first();
    if (!fromRow) return;

    const toRow = await knex('plans').where({ tier: to }).first();
    if (toRow) {
      await knex('plans').where({ tier: from }).del();
    } else {
      await knex('plans').where({ tier: from }).update({ tier: to, updated_at: nowIso });
    }

    const hasTenantSub = await knex.schema.hasTable('tenant_subscription');
    if (hasTenantSub) {
      const cols = await knex('tenant_subscription').columnInfo();
      if (cols?.tier) await knex('tenant_subscription').where({ tier: from }).update({ tier: to });
      if (cols?.requested_tier) await knex('tenant_subscription').where({ requested_tier: from }).update({ requested_tier: to });
    }

    const hasHistory = await knex.schema.hasTable('subscription_history');
    if (hasHistory) {
      const cols = await knex('subscription_history').columnInfo();
      if (cols?.from_tier) await knex('subscription_history').where({ from_tier: from }).update({ from_tier: to });
      if (cols?.to_tier) await knex('subscription_history').where({ to_tier: from }).update({ to_tier: to });
    }

    const hasEnt = await knex.schema.hasTable('tenant_entitlements');
    if (hasEnt) {
      const cols = await knex('tenant_entitlements').columnInfo();
      if (cols?.tier) await knex('tenant_entitlements').where({ tier: from }).update({ tier: to });
    }
  };

    await renameTier('Starter', 'Basic');
    await renameTier('Growth', 'Pro');
    await renameTier('Pro', 'Enterprise');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[049_pricing_tiers_starter_growth_pro] down failed', err);
    throw err;
  }
};
