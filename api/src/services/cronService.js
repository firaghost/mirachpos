const { db } = require('../db');

const runDailyCron = async () => {
  const nowIso = new Date().toISOString();
  const tenants = await db().select(['id', 'status', 'trial_ends_at', 'plan_ends_at']).from('tenants');
  let suspended = 0;

  for (const t of tenants) {
    const trialEnds = t.trial_ends_at ? new Date(t.trial_ends_at).getTime() : 0;
    const planEnds = t.plan_ends_at ? new Date(t.plan_ends_at).getTime() : 0;
    const now = Date.now();

    const expired = (trialEnds && now > trialEnds) || (planEnds && now > planEnds);
    if (expired && t.status !== 'suspended') {
      await db().from('tenants').where({ id: t.id }).update({ status: 'suspended', updated_at: nowIso });
      suspended += 1;
    }
  }

  return { ok: true, suspended };
};

module.exports = { runDailyCron };
