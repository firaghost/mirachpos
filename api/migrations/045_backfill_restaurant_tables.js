const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

exports.up = async (knex) => {
  const hasPosState = await knex.schema.hasTable('pos_state');
  const hasTables = await knex.schema.hasTable('restaurant_tables');
  if (!hasPosState || !hasTables) return;

  const rows = await knex('pos_state').select(['tenant_id', 'branch_id', 'state_json']);
  if (!rows || rows.length === 0) return;

  const nowIso = new Date().toISOString();

  for (const r of rows) {
    const state = safeJsonParse(r.state_json, null);
    const tables = Array.isArray(state?.tables) ? state.tables : [];
    if (!tables.length) continue;

    const payload = tables
      .filter((t) => t && (t.id || t.name))
      .map((t) => {
        const id = String(t.id || '').trim() || String(t.name || '').trim();
        const name = String(t.name || '').trim() || id;
        return {
          tenant_id: String(r.tenant_id),
          branch_id: String(r.branch_id),
          id,
          name,
          area: typeof t.area === 'string' ? t.area : null,
          status: typeof t.status === 'string' && t.status.trim() ? t.status.trim() : 'Free',
          seats: Number.isFinite(Number(t.seats)) ? Number(t.seats) : 4,
          open_order_id: t.openOrderId ? String(t.openOrderId) : null,
          last_order_id: t.lastOrderId ? String(t.lastOrderId) : null,
          assigned_staff_id: t.assignedStaffId ? String(t.assignedStaffId) : null,
          assigned_staff_name: t.assignedStaffName ? String(t.assignedStaffName) : null,
          updated_at: nowIso,
        };
      });

    for (const rec of payload) {
      // eslint-disable-next-line no-await-in-loop
      await knex('restaurant_tables')
        .insert(rec)
        .onConflict(['tenant_id', 'branch_id', 'id'])
        .merge({
          name: rec.name,
          area: rec.area,
          status: rec.status,
          seats: rec.seats,
          open_order_id: rec.open_order_id,
          last_order_id: rec.last_order_id,
          assigned_staff_id: rec.assigned_staff_id,
          assigned_staff_name: rec.assigned_staff_name,
          updated_at: nowIso,
        });
    }
  }
};

exports.down = async () => {
  // no-op
};
