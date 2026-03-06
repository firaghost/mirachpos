/**
 * menuEvaluationService unit tests
 * Tests: price override, modifier constraints (min/max), 86/unavailable, time/orderType windows, bundles
 */

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const { evaluateMenuCart } = require('../../src/services/menuEvaluationService');

const dbMock = () => global.__MIRACHPOS_DB_MOCK__.buildQuery();

const seedMenu = ({ products = [], ruleSets = [], rules = [], availability = [], bundles = [] }) => {
  const state = global.__MIRACHPOS_DB_MOCK__.state;
  state.tables.menu_products = products.map((p) => ({
    id: String(p.id),
    tenant_id: p.tenantId || 't_test',
    branch_id: p.branchId || null,
    name: String(p.name || ''),
    category: String(p.category || ''),
    status: String(p.status || 'Active'),
    price: Number(p.price ?? 0) || 0,
    product_json: JSON.stringify(p.meta || {}),
    updated_at: new Date().toISOString(),
  }));
  state.tables.menu_rule_sets = ruleSets.map((rs) => ({
    id: String(rs.id),
    tenant_id: rs.tenantId || 't_test',
    branch_id: rs.branchId || null,
    status: String(rs.status || 'active'),
    priority: Number(rs.priority ?? 0) || 0,
    starts_at: rs.startsAt || null,
    ends_at: rs.endsAt || null,
    schedule_json: JSON.stringify(rs.schedule || null),
    order_types_json: JSON.stringify(rs.orderTypes || null),
    updated_at: new Date().toISOString(),
  }));
  state.tables.menu_rules = rules.map((r) => ({
    id: String(r.id),
    tenant_id: r.tenantId || 't_test',
    branch_id: r.branchId || null,
    rule_set_id: String(r.ruleSetId),
    kind: String(r.kind || 'price_override'),
    match_json: JSON.stringify(r.match || {}),
    effect_json: JSON.stringify(r.effect || {}),
    updated_at: new Date().toISOString(),
  }));
  state.tables.menu_availability = availability.map((a) => ({
    id: String(a.id || Math.random().toString(36).slice(2)),
    tenant_id: a.tenantId || 't_test',
    branch_id: a.branchId || 'b_1',
    target_type: a.targetType || 'product',
    target_id: String(a.targetId),
    state: a.state || 'unavailable',
    reason: a.reason || '',
    expires_at: a.expiresAt || null,
    updated_at: new Date().toISOString(),
  }));
  state.tables.menu_bundles = bundles.map((b) => ({
    id: String(b.id),
    tenant_id: b.tenantId || 't_test',
    branch_id: b.branchId || null,
    name: String(b.name || ''),
    status: String(b.status || 'active'),
    priority: Number(b.priority ?? 0) || 0,
    bundle_json: JSON.stringify(b.bundle || {}),
    updated_at: new Date().toISOString(),
  }));
  state.tables.menu_modifier_groups = [];
  state.tables.menu_modifier_options = [];
  state.tables.menu_product_modifier_groups = [];
};

describe('services/menuEvaluationService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__.reset();
    seedMenu({});
  });

  it('returns empty evaluation for empty cart', async () => {
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [],
    });
    expect(res.items).toEqual([]);
    expect(res.violations).toEqual([]);
    expect(res.products).toEqual([]);
  });

  it('returns product_not_found when cart contains unknown product', async () => {
    seedMenu({ products: [] });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p_missing', qty: 1 }],
    });
    expect(res.violations).toContainEqual(expect.objectContaining({ type: 'product_not_found', productIds: ['p_missing'] }));
  });

  it('applies price_override and respects priority', async () => {
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Latte', category: 'Coffee', price: 100 }],
      ruleSets: [
        { id: 'rs1', priority: 10, status: 'active' },
        { id: 'rs2', priority: 20, status: 'active' },
      ],
      rules: [
        { id: 'r1', ruleSetId: 'rs1', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 90 } },
        { id: 'r2', ruleSetId: 'rs2', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 80 } },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(res.violations).toEqual([]);
    expect(res.effectivePriceByProductId.get('p1')).toBe(80);
  });

  it('respects time windows in rule sets', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000 * 60 * 60 * 24);
    const future = new Date(now.getTime() + 1000 * 60 * 60 * 24);
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Latte', category: 'Coffee', price: 100 }],
      ruleSets: [
        { id: 'rs_past', priority: 10, startsAt: past.toISOString(), endsAt: past.toISOString(), status: 'active' },
        { id: 'rs_future', priority: 10, startsAt: future.toISOString(), endsAt: future.toISOString(), status: 'active' },
        { id: 'rs_active', priority: 10, startsAt: past.toISOString(), endsAt: future.toISOString(), status: 'active' },
      ],
      rules: [
        { id: 'r_past', ruleSetId: 'rs_past', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 60 } },
        { id: 'r_future', ruleSetId: 'rs_future', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 70 } },
        { id: 'r_active', ruleSetId: 'rs_active', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 80 } },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: now,
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(res.effectivePriceByProductId.get('p1')).toBe(80);
  });

  it('respects orderType inclusion/exclusion', async () => {
    const now = new Date();
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Latte', category: 'Coffee', price: 100 }],
      ruleSets: [
        { id: 'rs_dine', priority: 10, status: 'active', orderTypes: { include: ['dine_in'] } },
        { id: 'rs_takeaway', priority: 10, status: 'active', orderTypes: { exclude: ['dine_in'] } },
      ],
      rules: [
        { id: 'r_dine', ruleSetId: 'rs_dine', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 95 } },
        { id: 'r_takeaway', ruleSetId: 'rs_takeaway', kind: 'price_override', match: { productIds: ['p1'] }, effect: { price: 85 } },
      ],
    });
    const dineRes = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: now,
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(dineRes.effectivePriceByProductId.get('p1')).toBe(95);

    const takeawayRes = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: now,
      orderType: 'takeaway',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(takeawayRes.effectivePriceByProductId.get('p1')).toBe(85);
  });

  it('flags unavailable (86) products as violations', async () => {
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Mocha', category: 'Coffee', price: 120 }],
      availability: [
        { id: 'a1', targetId: 'p1', tenantId: 't_test', branchId: 'b_1', targetType: 'product', state: 'unavailable', reason: 'Out of stock' },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(res.violations).toContainEqual(expect.objectContaining({ type: 'unavailable', productId: 'p1', reason: 'Out of stock' }));
  });

  it('detects modifier_min violations when modifiers are missing', async () => {
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Latte', category: 'Coffee', price: 100 }],
      ruleSets: [
        { id: 'rs1', priority: 10, status: 'active' },
      ],
      rules: [
        { id: 'r1', ruleSetId: 'rs1', kind: 'modifier_constraint', match: { productIds: ['p1'] }, effect: { groups: { g_size: { min: 1, max: 1 } } } },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1, modifiers: [] }],
    });
    expect(res.violations).toContainEqual(expect.objectContaining({ type: 'modifier_min', productId: 'p1', groupId: 'g_size', min: 1 }));
  });

  it('detects modifier_max violations when too many modifiers selected', async () => {
    seedMenu({
      products: [{ id: 'p1', tenantId: 't_test', branchId: null, name: 'Latte', category: 'Coffee', price: 100 }],
      ruleSets: [
        { id: 'rs1', priority: 10, status: 'active' },
      ],
      rules: [
        { id: 'r1', ruleSetId: 'rs1', kind: 'modifier_constraint', match: { productIds: ['p1'] }, effect: { groups: { g_syrup: { min: 0, max: 1 } } } },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1, modifiers: ['g_syrup:vanilla', 'g_syrup:caramel'] }],
    });
    expect(res.violations).toContainEqual(expect.objectContaining({ type: 'modifier_max', productId: 'p1', groupId: 'g_syrup', max: 1 }));
  });

  it('calculates bundleSubtotal and returns bundleApplied when fixed bundle matches', async () => {
    seedMenu({
      products: [
        { id: 'p1', tenantId: 't_test', branchId: null, name: 'Burger', category: 'Food', price: 200 },
        { id: 'p2', tenantId: 't_test', branchId: null, name: 'Fries', category: 'Food', price: 80 },
        { id: 'p3', tenantId: 't_test', branchId: null, name: 'Soda', category: 'Drink', price: 50 },
      ],
      bundles: [
        {
          id: 'bnd1',
          tenantId: 't_test',
          branchId: null,
          status: 'active',
          priority: 10,
          bundle: {
            type: 'fixed',
            price: 250,
            items: [
              { productId: 'p1', qty: 1 },
              { productId: 'p2', qty: 1 },
            ],
          },
        },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [
        { productId: 'p1', qty: 1 },
        { productId: 'p2', qty: 1 },
        { productId: 'p3', qty: 1 },
      ],
    });
    expect(res.bundleApplied).toBeTruthy();
    expect(res.bundleApplied?.id).toBe('bnd1');
    expect(res.bundleSubtotal).toBe(300);
  });

  it('returns null bundleApplied when no bundle matches', async () => {
    seedMenu({
      products: [
        { id: 'p1', tenantId: 't_test', branchId: null, name: 'Burger', category: 'Food', price: 200 },
      ],
      bundles: [
        {
          id: 'bnd1',
          tenantId: 't_test',
          branchId: null,
          status: 'active',
          priority: 10,
          bundle: {
            type: 'fixed',
            price: 250,
            items: [
              { productId: 'p1', qty: 1 },
              { productId: 'p_missing', qty: 1 },
            ],
          },
        },
      ],
    });
    const res = await evaluateMenuCart({
      db: dbMock,
      tenantId: 't_test',
      branchId: 'b_1',
      at: new Date(),
      orderType: 'dine_in',
      items: [{ productId: 'p1', qty: 1 }],
    });
    expect(res.bundleApplied).toBeNull();
    expect(res.bundleSubtotal).toBeNull();
  });
});
