import { CreateInventoryItemData, CreateInventoryItemVariables, ListMenuItemsData, UpdateMenuItemInStockData, UpdateMenuItemInStockVariables, ListOrdersForUserData, ListOrdersForUserVariables } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateInventoryItem(options?: useDataConnectMutationOptions<CreateInventoryItemData, FirebaseError, CreateInventoryItemVariables>): UseDataConnectMutationResult<CreateInventoryItemData, CreateInventoryItemVariables>;
export function useCreateInventoryItem(dc: DataConnect, options?: useDataConnectMutationOptions<CreateInventoryItemData, FirebaseError, CreateInventoryItemVariables>): UseDataConnectMutationResult<CreateInventoryItemData, CreateInventoryItemVariables>;

export function useListMenuItems(options?: useDataConnectQueryOptions<ListMenuItemsData>): UseDataConnectQueryResult<ListMenuItemsData, undefined>;
export function useListMenuItems(dc: DataConnect, options?: useDataConnectQueryOptions<ListMenuItemsData>): UseDataConnectQueryResult<ListMenuItemsData, undefined>;

export function useUpdateMenuItemInStock(options?: useDataConnectMutationOptions<UpdateMenuItemInStockData, FirebaseError, UpdateMenuItemInStockVariables>): UseDataConnectMutationResult<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
export function useUpdateMenuItemInStock(dc: DataConnect, options?: useDataConnectMutationOptions<UpdateMenuItemInStockData, FirebaseError, UpdateMenuItemInStockVariables>): UseDataConnectMutationResult<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;

export function useListOrdersForUser(vars: ListOrdersForUserVariables, options?: useDataConnectQueryOptions<ListOrdersForUserData>): UseDataConnectQueryResult<ListOrdersForUserData, ListOrdersForUserVariables>;
export function useListOrdersForUser(dc: DataConnect, vars: ListOrdersForUserVariables, options?: useDataConnectQueryOptions<ListOrdersForUserData>): UseDataConnectQueryResult<ListOrdersForUserData, ListOrdersForUserVariables>;
