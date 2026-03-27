const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeModifiers = (mods) => {
  const arr = Array.isArray(mods) ? mods : [];
  return arr
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 200);
};

const countModifiersByGroup = (mods) => {
  const map = new Map();
  for (const token of mods) {
    const gid = String(token.split(':')[0] || '').trim();
    if (!gid) continue;
    map.set(gid, (map.get(gid) || 0) + 1);
  }
  return map;
};

const matchAppliesToProduct = ({ product, match }) => {
  const m = match && typeof match === 'object' ? match : {};
  const productIds = Array.isArray(m.productIds) ? m.productIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const categories = Array.isArray(m.categories) ? m.categories.map((x) => String(x || '').trim()).filter(Boolean) : [];

  if (productIds.length && productIds.includes(String(product.id))) return true;
  if (categories.length && categories.includes(String(product.category || ''))) return true;
  if (!productIds.length && !categories.length) return true;
  return false;
};

const normalizeEvalItems = (itemsRaw) => {
  const arr = Array.isArray(itemsRaw) ? itemsRaw : [];
  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      productId: String(x.productId || x.product_id || '').trim(),
      qty: Math.max(1, Math.min(999, Number(x.qty ?? x.quantity ?? 1) || 1)),
      modifiers: normalizeModifiers(x.modifiers),
    }))
    .filter((x) => x.productId);
};

const chooseBranchOverGlobal = (rows) => {
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id);
    const isBranch = Boolean(row.branch_id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { row, isBranch });
      continue;
    }
    if (isBranch && !prev.isBranch) byId.set(id, { row, isBranch });
  }
  return byId;
};

const normalizeActiveRuleSets = ({ rows, at, orderType }) => {
  return rows
    .map((x) => {
      const startsAt = x.starts_at ? new Date(x.starts_at) : null;
      const endsAt = x.ends_at ? new Date(x.ends_at) : null;
      const orderTypes = safeJsonParse(x.order_types_json, null);
      return {
        id: String(x.id),
        branchId: x.branch_id ? String(x.branch_id) : null,
        priority: Number(x.priority || 0) || 0,
        startsAt: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : null,
        endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
        schedule: safeJsonParse(x.schedule_json, null),
        orderTypes,
        updatedAt: x.updated_at ? new Date(x.updated_at).getTime() : 0,
      };
    })
    .filter((x) => {
      if (x.startsAt && at < x.startsAt) return false;
      if (x.endsAt && at > x.endsAt) return false;
      if (x.orderTypes && Array.isArray(x.orderTypes?.include)) {
        const include = x.orderTypes.include.map((t) => String(t || '').trim()).filter(Boolean);
        if (include.length && orderType && !include.includes(orderType)) return false;
      }
      if (x.orderTypes && Array.isArray(x.orderTypes?.exclude)) {
        const exclude = x.orderTypes.exclude.map((t) => String(t || '').trim()).filter(Boolean);
        if (exclude.length && orderType && exclude.includes(orderType)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return a.priority - b.priority;
      const aBranch = a.branchId ? 1 : 0;
      const bBranch = b.branchId ? 1 : 0;
      if (bBranch !== aBranch) return bBranch - aBranch;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
};

const buildRulesByRuleSetId = (rulesRows) => {
  const map = new Map();
  for (const row of rulesRows) {
    const rid = String(row.rule_set_id);
    const arr = map.get(rid) || [];
    arr.push({
      id: String(row.id),
      kind: String(row.kind || ''),
      match: safeJsonParse(row.match_json, {}),
      effect: safeJsonParse(row.effect_json, {}),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    });
    map.set(rid, arr);
  }
  return map;
};

const evaluateMenuCart = async ({
  db,
  tenantId,
  branchId,
  at,
  orderType,
  items,
}) => {
  const normalizedItems = normalizeEvalItems(items);

  if (!normalizedItems.length) {
    return {
      items: [],
      products: [],
      constraintsByProductId: {},
      unavailableByProductId: new Map(),
      effectivePriceByProductId: new Map(),
      trace: [],
      violations: [],
    };
  }

  const productIds = Array.from(new Set(normalizedItems.map((x) => x.productId)));

  const prodRows = await db
    .from('menu_products')
    .where({ tenant_id: tenantId })
    .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
    .whereIn('id', productIds)
    .select(['id', 'branch_id', 'name', 'category', 'status', 'price', 'product_json', 'updated_at']);

  const productsById = chooseBranchOverGlobal(prodRows);
  const missing = productIds.filter((pid) => !productsById.has(pid));
  if (missing.length) {
    return {
      items: normalizedItems,
      products: [],
      constraintsByProductId: {},
      unavailableByProductId: new Map(),
      effectivePriceByProductId: new Map(),
      trace: [],
      violations: [{ type: 'product_not_found', productIds: missing }],
    };
  }

  const availabilityRows = await db
    .from('menu_availability')
    .where({ tenant_id: tenantId, branch_id: branchId, target_type: 'product', state: 'unavailable' })
    .andWhere((b) => b.whereNull('expires_at').orWhere('expires_at', '>', at.toISOString()))
    .whereIn('target_id', productIds)
    .select(['target_id', 'reason', 'expires_at']);

  const unavailableByProductId = new Map();
  for (const row of availabilityRows) {
    unavailableByProductId.set(String(row.target_id), {
      reason: row.reason ? String(row.reason) : '',
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    });
  }

  const ruleSetRows = await db
    .from('menu_rule_sets')
    .where({ tenant_id: tenantId, status: 'active' })
    .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
    .select(['id', 'branch_id', 'priority', 'starts_at', 'ends_at', 'schedule_json', 'order_types_json', 'updated_at']);

  const activeRuleSets = normalizeActiveRuleSets({ rows: ruleSetRows, at, orderType });
  const ruleSetIds = activeRuleSets.map((x) => x.id);

  const rulesRows = ruleSetIds.length
    ? await db
        .from('menu_rules')
        .where({ tenant_id: tenantId })
        .whereIn('rule_set_id', ruleSetIds)
        .select(['id', 'rule_set_id', 'kind', 'match_json', 'effect_json', 'updated_at'])
    : [];

  const rulesByRuleSetId = buildRulesByRuleSetId(rulesRows);

  const constraintsByProductId = {};
  const effectivePriceByProductId = new Map();
  const trace = [];

  for (const pid of productIds) {
    const { row } = productsById.get(pid);
    const pj = safeJsonParse(row.product_json, {});
    const product = {
      id: String(row.id),
      name: String(row.name || ''),
      category: String(row.category || 'Uncategorized'),
      status: String(row.status || 'Active'),
      basePrice: Number(row.price || 0) || 0,
      meta: pj,
    };

    let price = product.basePrice;
    const constraints = {};

    for (const rs of activeRuleSets) {
      const rsRules = rulesByRuleSetId.get(rs.id) || [];
      for (const rule of rsRules) {
        if (!matchAppliesToProduct({ product, match: rule.match })) continue;

        if (rule.kind === 'price_override') {
          const next = Number(rule.effect?.price ?? NaN);
          if (!Number.isNaN(next)) {
            price = next;
            trace.push({ ruleSetId: rs.id, ruleId: rule.id, kind: 'price_override', productId: pid });
          }
        }

        if (rule.kind === 'modifier_constraint') {
          const groups = rule.effect?.groups;
          if (groups && typeof groups === 'object') {
            for (const [groupId, v] of Object.entries(groups)) {
              const vv = v && typeof v === 'object' ? v : {};
              const min = vv.min != null ? Math.max(0, Number(vv.min) || 0) : undefined;
              const max = vv.max != null ? Math.max(0, Number(vv.max) || 0) : undefined;
              constraints[String(groupId)] = { ...(constraints[String(groupId)] || {}), min, max };
            }
            trace.push({ ruleSetId: rs.id, ruleId: rule.id, kind: 'modifier_constraint', productId: pid });
          }
        }
      }
    }

    effectivePriceByProductId.set(pid, price);
    constraintsByProductId[pid] = constraints;
  }

  const violations = [];
  for (const it of normalizedItems) {
    const unavailable = unavailableByProductId.get(it.productId);
    if (unavailable) {
      violations.push({ type: 'unavailable', productId: it.productId, reason: unavailable.reason || 'unavailable' });
    }

    const constraints = constraintsByProductId[it.productId] || {};
    const counts = countModifiersByGroup(it.modifiers);

    for (const [groupId, rule] of Object.entries(constraints)) {
      const min = rule && typeof rule === 'object' && rule.min != null ? Number(rule.min || 0) || 0 : 0;
      const max = rule && typeof rule === 'object' && rule.max != null ? Number(rule.max || 0) || 0 : 0;
      const c = counts.get(groupId) || 0;
      if (min > 0 && c < min) violations.push({ type: 'modifier_min', productId: it.productId, groupId, min, count: c });
      if (max > 0 && c > max) violations.push({ type: 'modifier_max', productId: it.productId, groupId, max, count: c });
    }
  }

  let bundleApplied = null;
  let bundleSubtotal = null;
  try {
    const bundleRows = await db
      .from('menu_bundles')
      .where({ tenant_id: tenantId, status: 'active' })
      .andWhere((b) => b.whereNull('branch_id').orWhere('branch_id', branchId))
      .select(['id', 'branch_id', 'name', 'priority', 'bundle_json', 'updated_at'])
      .orderBy([{ column: 'priority', order: 'desc' }, { column: 'updated_at', order: 'desc' }])
      .limit(200);

    const cartQtyByProductId = new Map();
    for (const it of normalizedItems) cartQtyByProductId.set(it.productId, (cartQtyByProductId.get(it.productId) || 0) + it.qty);

    const parseBundle = (row) => {
      const b = safeJsonParse(row.bundle_json, {});
      const type = String(b?.type || '').trim();
      if (type !== 'fixed') return null;
      const price = Number(b?.price ?? NaN);
      const itemsRaw = Array.isArray(b?.items) ? b.items : [];
      const reqItems = itemsRaw
        .map((x) => ({ productId: String(x?.productId || x?.product_id || '').trim(), qty: Math.max(1, Number(x?.qty ?? 1) || 1) }))
        .filter((x) => x.productId);
      if (!Number.isFinite(price) || price < 0) return null;
      if (!reqItems.length) return null;
      return { id: String(row.id), name: String(row.name || ''), priority: Number(row.priority || 0) || 0, price, reqItems };
    };

    const candidates = bundleRows.map(parseBundle).filter(Boolean);
    const matches = candidates.filter((b) => b.reqItems.every((ri) => (cartQtyByProductId.get(ri.productId) || 0) >= ri.qty));
    if (matches.length) {
      const best = matches.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
      const remainingQtyByProductId = new Map(cartQtyByProductId);
      for (const ri of best.reqItems) remainingQtyByProductId.set(ri.productId, (remainingQtyByProductId.get(ri.productId) || 0) - ri.qty);
      let restTotal = 0;
      for (const [pid, qty] of remainingQtyByProductId.entries()) {
        const q = Number(qty || 0) || 0;
        if (q <= 0) continue;
        const unit = Number(effectivePriceByProductId.get(pid) || 0) || 0;
        restTotal += unit * q;
      }

      bundleApplied = { id: best.id, name: best.name, price: best.price, items: best.reqItems };
      bundleSubtotal = best.price + restTotal;
    }
  } catch {
    bundleApplied = null;
    bundleSubtotal = null;
  }

  const products = productIds.map((pid) => {
    const { row } = productsById.get(pid);
    const pj = safeJsonParse(row.product_json, {});
    const unavailable = unavailableByProductId.get(pid);
    const price = effectivePriceByProductId.get(pid);
    return {
      id: String(row.id),
      name: String(row.name || ''),
      category: String(row.category || 'Uncategorized'),
      status: String(row.status || 'Active'),
      basePrice: Number(row.price || 0) || 0,
      price: Number(price || 0) || 0,
      available: !unavailable,
      unavailableReason: unavailable ? String(unavailable.reason || '') : '',
      meta: pj,
    };
  });

  return {
    items: normalizedItems,
    products,
    constraintsByProductId,
    unavailableByProductId,
    effectivePriceByProductId,
    trace,
    violations,
    bundleApplied,
    bundleSubtotal,
  };
};

module.exports = {
  evaluateMenuCart,
};
