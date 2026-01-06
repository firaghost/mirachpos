const { uid } = require('../utils/ids');

const makeDefaultTables = ({ count, seats, area }) => {
  const n = Math.max(1, Math.min(200, Number(count) || 0));
  const s = Math.max(1, Math.min(20, Number(seats) || 4));
  const a = typeof area === 'string' && area.trim() ? area.trim() : 'Main Hall';

  const pad2 = (x) => String(x).padStart(2, '0');
  return Array.from({ length: n }).map((_, i) => {
    const name = `T-${pad2(i + 1)}`;
    return {
      id: uid('tbl'),
      name,
      area: a,
      status: 'Free',
      seats: s,
      openOrderId: null,
      lastOrderId: null,
      cartItemCount: 0,
      currentTotal: 0,
      assignedStaffId: null,
      assignedStaffName: null,
    };
  });
};

const makeInitialPosState = ({ count, seats, area }) => ({
  version: 1,
  products: [],
  tables: makeDefaultTables({ count, seats, area }),
  orders: [],
  notifications: [],
  cartByTableId: {},
  selectedTableId: null,
  selectedOrderId: null,
});

module.exports = { makeInitialPosState };
