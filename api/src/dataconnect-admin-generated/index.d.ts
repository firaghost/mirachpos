import { ConnectorConfig, DataConnect, OperationOptions, ExecuteOperationResponse } from 'firebase-admin/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export interface CreateInventoryItemData {
  inventoryItem_insert: InventoryItem_Key;
}

export interface CreateInventoryItemVariables {
  name: string;
  unitOfMeasure: string;
  currentStock: number;
}

export interface InventoryItem_Key {
  id: UUIDString;
  __typename?: 'InventoryItem_Key';
}

export interface ListMenuItemsData {
  menuItems: ({
    id: UUIDString;
    name: string;
    description?: string | null;
    price: number;
    imageUrl?: string | null;
    category: string;
    inStock?: boolean | null;
  } & MenuItem_Key)[];
}

export interface ListOrdersForUserData {
  orders: ({
    id: UUIDString;
    orderDate: DateString;
    totalAmount: number;
    status: string;
    paymentMethod?: string | null;
    discountApplied?: number | null;
    createdAt: TimestampString;
    userId?: UUIDString | null;
  } & Order_Key)[];
}

export interface ListOrdersForUserVariables {
  userId: UUIDString;
}

export interface MenuItem_Key {
  id: UUIDString;
  __typename?: 'MenuItem_Key';
}

export interface OrderItem_Key {
  id: UUIDString;
  __typename?: 'OrderItem_Key';
}

export interface Order_Key {
  id: UUIDString;
  __typename?: 'Order_Key';
}

export interface UpdateMenuItemInStockData {
  menuItem_update?: MenuItem_Key | null;
}

export interface UpdateMenuItemInStockVariables {
  id: UUIDString;
  inStock: boolean;
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

/** Generated Node Admin SDK operation action function for the 'CreateInventoryItem' Mutation. Allow users to execute without passing in DataConnect. */
export function createInventoryItem(dc: DataConnect, vars: CreateInventoryItemVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateInventoryItemData>>;
/** Generated Node Admin SDK operation action function for the 'CreateInventoryItem' Mutation. Allow users to pass in custom DataConnect instances. */
export function createInventoryItem(vars: CreateInventoryItemVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateInventoryItemData>>;

/** Generated Node Admin SDK operation action function for the 'ListMenuItems' Query. Allow users to execute without passing in DataConnect. */
export function listMenuItems(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListMenuItemsData>>;
/** Generated Node Admin SDK operation action function for the 'ListMenuItems' Query. Allow users to pass in custom DataConnect instances. */
export function listMenuItems(options?: OperationOptions): Promise<ExecuteOperationResponse<ListMenuItemsData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateMenuItemInStock' Mutation. Allow users to execute without passing in DataConnect. */
export function updateMenuItemInStock(dc: DataConnect, vars: UpdateMenuItemInStockVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateMenuItemInStockData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateMenuItemInStock' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateMenuItemInStock(vars: UpdateMenuItemInStockVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateMenuItemInStockData>>;

/** Generated Node Admin SDK operation action function for the 'ListOrdersForUser' Query. Allow users to execute without passing in DataConnect. */
export function listOrdersForUser(dc: DataConnect, vars: ListOrdersForUserVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListOrdersForUserData>>;
/** Generated Node Admin SDK operation action function for the 'ListOrdersForUser' Query. Allow users to pass in custom DataConnect instances. */
export function listOrdersForUser(vars: ListOrdersForUserVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListOrdersForUserData>>;

