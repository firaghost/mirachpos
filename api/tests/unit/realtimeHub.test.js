const { publish, subscribe } = require('../../src/services/realtimeHub');

describe('services/realtimeHub', () => {
  it('publish emits event to subscribers', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({
      tenantId: 't_1',
      branchId: 'b_1',
      type: 'order.created',
      data: { orderId: 'o_1' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: 't_1',
      branchId: 'b_1',
      type: 'order.created',
      data: { orderId: 'o_1' },
    });
    expect(events[0].at).toMatch(/^\d{4}-/);

    unsubscribe();
  });

  it('publish handles events without branchId', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({
      tenantId: 't_1',
      type: 'tenant.updated',
      data: { name: 'New Name' },
    });

    expect(events).toHaveLength(1);
    expect(events[0].branchId).toBeNull();
    expect(events[0].type).toBe('tenant.updated');

    unsubscribe();
  });

  it('publish ignores events without tenantId', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({
      type: 'order.created',
      data: { orderId: 'o_1' },
    });

    expect(events).toHaveLength(0);
    unsubscribe();
  });

  it('publish ignores events with empty tenantId', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({
      tenantId: '',
      type: 'order.created',
      data: {},
    });

    expect(events).toHaveLength(0);
    unsubscribe();
  });

  it('publish ignores non-object events', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish(null);
    publish('string');
    publish(123);
    publish(undefined);

    expect(events).toHaveLength(0);
    unsubscribe();
  });

  it('unsubscribe removes listener', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({ tenantId: 't_1', type: 'test' });
    expect(events).toHaveLength(1);

    unsubscribe();

    publish({ tenantId: 't_1', type: 'test2' });
    expect(events).toHaveLength(1); // No new events after unsubscribe
  });

  it('publish handles multiple subscribers', () => {
    const events1 = [];
    const events2 = [];
    const unsub1 = subscribe((e) => events1.push(e));
    const unsub2 = subscribe((e) => events2.push(e));

    publish({ tenantId: 't_1', type: 'test', data: { foo: 'bar' } });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]).toEqual(events2[0]);

    unsub1();
    unsub2();
  });

  it('publish defaults type to unknown', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({ tenantId: 't_1' });

    expect(events[0].type).toBe('unknown');
    unsubscribe();
  });

  it('publish defaults data to empty object', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({ tenantId: 't_1', type: 'test' });

    expect(events[0].data).toEqual({});
    unsubscribe();
  });

  it('publish sanitizes branchId whitespace', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({ tenantId: 't_1', branchId: '  b_1  ', type: 'test' });

    expect(events[0].branchId).toBe('b_1');
    unsubscribe();
  });

  it('publish ignores branchId if only whitespace', () => {
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    publish({ tenantId: 't_1', branchId: '   ', type: 'test' });

    expect(events[0].branchId).toBeNull();
    unsubscribe();
  });

  it('publish handles errors gracefully', () => {
    // Should not throw even with malformed input
    expect(() => publish(null)).not.toThrow();
    expect(() => publish(undefined)).not.toThrow();
    expect(() => publish('string')).not.toThrow();
    expect(() => publish(123)).not.toThrow();
  });
});
