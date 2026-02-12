const { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'example',
  service: 'mirachpos',
  location: 'us-east4'
};
exports.connectorConfig = connectorConfig;

const createInventoryItemRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateInventoryItem', inputVars);
}
createInventoryItemRef.operationName = 'CreateInventoryItem';
exports.createInventoryItemRef = createInventoryItemRef;

exports.createInventoryItem = function createInventoryItem(dcOrVars, vars) {
  return executeMutation(createInventoryItemRef(dcOrVars, vars));
};

const listMenuItemsRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListMenuItems');
}
listMenuItemsRef.operationName = 'ListMenuItems';
exports.listMenuItemsRef = listMenuItemsRef;

exports.listMenuItems = function listMenuItems(dc) {
  return executeQuery(listMenuItemsRef(dc));
};

const updateMenuItemInStockRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateMenuItemInStock', inputVars);
}
updateMenuItemInStockRef.operationName = 'UpdateMenuItemInStock';
exports.updateMenuItemInStockRef = updateMenuItemInStockRef;

exports.updateMenuItemInStock = function updateMenuItemInStock(dcOrVars, vars) {
  return executeMutation(updateMenuItemInStockRef(dcOrVars, vars));
};

const listOrdersForUserRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListOrdersForUser', inputVars);
}
listOrdersForUserRef.operationName = 'ListOrdersForUser';
exports.listOrdersForUserRef = listOrdersForUserRef;

exports.listOrdersForUser = function listOrdersForUser(dcOrVars, vars) {
  return executeQuery(listOrdersForUserRef(dcOrVars, vars));
};
