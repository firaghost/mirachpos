exports.up = async (knex) => {
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const upsert = async (tier, modules) => {
    const exists = await knex('plans').where({ tier }).first();
    if (exists) {
      await knex('plans').where({ tier }).update({ modules_json: JSON.stringify(modules), updated_at: nowIso });
      return;
    }
    await knex('plans').insert({ tier, modules_json: JSON.stringify(modules), updated_at: nowIso });
  };

  // Trial: core usability, but enforced by limits (branchLimit=1, staffLimit=5) at runtime.
  await upsert('Trial', ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'settings']);

  await upsert('Basic', ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings']);

  await upsert('Pro', ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings']);

  await upsert('Enterprise', ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings']);
};

exports.down = async (knex) => {
  // Do not delete plan rows on rollback; only leave as-is.
};
