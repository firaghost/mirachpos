import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, MutationRef, MutationPromise } from 'firebase/data-connect';

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

interface CreateInventoryItemRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateInventoryItemVariables): MutationRef<CreateInventoryItemData, CreateInventoryItemVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateInventoryItemVariables): MutationRef<CreateInventoryItemData, CreateInventoryItemVariables>;
  operationName: string;
}
export const createInventoryItemRef: CreateInventoryItemRef;

export function createInventoryItem(vars: CreateInventoryItemVariables): MutationPromise<CreateInventoryItemData, CreateInventoryItemVariables>;
export function createInventoryItem(dc: DataConnect, vars: CreateInventoryItemVariables): MutationPromise<CreateInventoryItemData, CreateInventoryItemVariables>;

interface ListMenuItemsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListMenuItemsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListMenuItemsData, undefined>;
  operationName: string;
}
export const listMenuItemsRef: ListMenuItemsRef;

export function listMenuItems(): QueryPromise<ListMenuItemsData, undefined>;
export function listMenuItems(dc: DataConnect): QueryPromise<ListMenuItemsData, undefined>;

interface UpdateMenuItemInStockRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateMenuItemInStockVariables): MutationRef<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateMenuItemInStockVariables): MutationRef<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
  operationName: string;
}
export const updateMenuItemInStockRef: UpdateMenuItemInStockRef;

export function updateMenuItemInStock(vars: UpdateMenuItemInStockVariables): MutationPromise<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
export function updateMenuItemInStock(dc: DataConnect, vars: UpdateMenuItemInStockVariables): MutationPromise<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;

interface ListOrdersForUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListOrdersForUserVariables): QueryRef<ListOrdersForUserData, ListOrdersForUserVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ListOrdersForUserVariables): QueryRef<ListOrdersForUserData, ListOrdersForUserVariables>;
  operationName: string;
}
export const listOrdersForUserRef: ListOrdersForUserRef;

export function listOrdersForUser(vars: ListOrdersForUserVariables): QueryPromise<ListOrdersForUserData, ListOrdersForUserVariables>;
export function listOrdersForUser(dc: DataConnect, vars: ListOrdersForUserVariables): QueryPromise<ListOrdersForUserData, ListOrdersForUserVariables>;

