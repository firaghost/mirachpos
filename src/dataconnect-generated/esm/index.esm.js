import { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'example',
  service: 'mirachpos',
  location: 'us-east4'
};

export const createInventoryItemRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateInventoryItem', inputVars);
}
createInventoryItemRef.operationName = 'CreateInventoryItem';

export function createInventoryItem(dcOrVars, vars) {
  return executeMutation(createInventoryItemRef(dcOrVars, vars));
}

export const listMenuItemsRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListMenuItems');
}
listMenuItemsRef.operationName = 'ListMenuItems';

export function listMenuItems(dc) {
  return executeQuery(listMenuItemsRef(dc));
}

export const updateMenuItemInStockRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateMenuItemInStock', inputVars);
}
updateMenuItemInStockRef.operationName = 'UpdateMenuItemInStock';

export function updateMenuItemInStock(dcOrVars, vars) {
  return executeMutation(updateMenuItemInStockRef(dcOrVars, vars));
}

export const listOrdersForUserRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListOrdersForUser', inputVars);
}
listOrdersForUserRef.operationName = 'ListOrdersForUser';

export function listOrdersForUser(dcOrVars, vars) {
  return executeQuery(listOrdersForUserRef(dcOrVars, vars));
}

