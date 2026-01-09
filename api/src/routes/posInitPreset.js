const { uid } = require('../utils/ids');

const makeInitialPosState = () => ({
  version: 1,
  products: [],
  orders: [],
  notifications: [],
  cartByTableId: {},
  selectedTableId: null,
  selectedOrderId: null,
});

module.exports = { makeInitialPosState };
