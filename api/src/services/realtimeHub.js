const { EventEmitter } = require('events');

const hub = new EventEmitter();

const publish = (event) => {
  try {
    const e = event && typeof event === 'object' ? event : null;
    if (!e) return;
    const tenantId = typeof e.tenantId === 'string' ? e.tenantId : '';
    if (!tenantId) return;
    const payload = {
      tenantId,
      branchId: typeof e.branchId === 'string' && e.branchId.trim() ? e.branchId.trim() : null,
      type: typeof e.type === 'string' ? e.type : 'unknown',
      at: new Date().toISOString(),
      data: e.data && typeof e.data === 'object' ? e.data : {},
    };
    hub.emit('event', payload);
  } catch {
    // ignore
  }
};

const subscribe = (listener) => {
  hub.on('event', listener);
  return () => {
    hub.off('event', listener);
  };
};

module.exports = { publish, subscribe };
