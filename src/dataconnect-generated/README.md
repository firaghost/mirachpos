# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `example`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*ListMenuItems*](#listmenuitems)
  - [*ListOrdersForUser*](#listordersforuser)
- [**Mutations**](#mutations)
  - [*CreateInventoryItem*](#createinventoryitem)
  - [*UpdateMenuItemInStock*](#updatemenuiteminstock)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `example`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## ListMenuItems
You can execute the `ListMenuItems` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listMenuItems(): QueryPromise<ListMenuItemsData, undefined>;

interface ListMenuItemsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListMenuItemsData, undefined>;
}
export const listMenuItemsRef: ListMenuItemsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listMenuItems(dc: DataConnect): QueryPromise<ListMenuItemsData, undefined>;

interface ListMenuItemsRef {
  ...
  (dc: DataConnect): QueryRef<ListMenuItemsData, undefined>;
}
export const listMenuItemsRef: ListMenuItemsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listMenuItemsRef:
```typescript
const name = listMenuItemsRef.operationName;
console.log(name);
```

### Variables
The `ListMenuItems` query has no variables.
### Return Type
Recall that executing the `ListMenuItems` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListMenuItemsData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListMenuItems`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listMenuItems } from '@dataconnect/generated';


// Call the `listMenuItems()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listMenuItems();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listMenuItems(dataConnect);

console.log(data.menuItems);

// Or, you can use the `Promise` API.
listMenuItems().then((response) => {
  const data = response.data;
  console.log(data.menuItems);
});
```

### Using `ListMenuItems`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listMenuItemsRef } from '@dataconnect/generated';


// Call the `listMenuItemsRef()` function to get a reference to the query.
const ref = listMenuItemsRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listMenuItemsRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.menuItems);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.menuItems);
});
```

## ListOrdersForUser
You can execute the `ListOrdersForUser` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listOrdersForUser(vars: ListOrdersForUserVariables): QueryPromise<ListOrdersForUserData, ListOrdersForUserVariables>;

interface ListOrdersForUserRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListOrdersForUserVariables): QueryRef<ListOrdersForUserData, ListOrdersForUserVariables>;
}
export const listOrdersForUserRef: ListOrdersForUserRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listOrdersForUser(dc: DataConnect, vars: ListOrdersForUserVariables): QueryPromise<ListOrdersForUserData, ListOrdersForUserVariables>;

interface ListOrdersForUserRef {
  ...
  (dc: DataConnect, vars: ListOrdersForUserVariables): QueryRef<ListOrdersForUserData, ListOrdersForUserVariables>;
}
export const listOrdersForUserRef: ListOrdersForUserRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listOrdersForUserRef:
```typescript
const name = listOrdersForUserRef.operationName;
console.log(name);
```

### Variables
The `ListOrdersForUser` query requires an argument of type `ListOrdersForUserVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListOrdersForUserVariables {
  userId: UUIDString;
}
```
### Return Type
Recall that executing the `ListOrdersForUser` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListOrdersForUserData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListOrdersForUser`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listOrdersForUser, ListOrdersForUserVariables } from '@dataconnect/generated';

// The `ListOrdersForUser` query requires an argument of type `ListOrdersForUserVariables`:
const listOrdersForUserVars: ListOrdersForUserVariables = {
  userId: ..., 
};

// Call the `listOrdersForUser()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listOrdersForUser(listOrdersForUserVars);
// Variables can be defined inline as well.
const { data } = await listOrdersForUser({ userId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listOrdersForUser(dataConnect, listOrdersForUserVars);

console.log(data.orders);

// Or, you can use the `Promise` API.
listOrdersForUser(listOrdersForUserVars).then((response) => {
  const data = response.data;
  console.log(data.orders);
});
```

### Using `ListOrdersForUser`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listOrdersForUserRef, ListOrdersForUserVariables } from '@dataconnect/generated';

// The `ListOrdersForUser` query requires an argument of type `ListOrdersForUserVariables`:
const listOrdersForUserVars: ListOrdersForUserVariables = {
  userId: ..., 
};

// Call the `listOrdersForUserRef()` function to get a reference to the query.
const ref = listOrdersForUserRef(listOrdersForUserVars);
// Variables can be defined inline as well.
const ref = listOrdersForUserRef({ userId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listOrdersForUserRef(dataConnect, listOrdersForUserVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.orders);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.orders);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateInventoryItem
You can execute the `CreateInventoryItem` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createInventoryItem(vars: CreateInventoryItemVariables): MutationPromise<CreateInventoryItemData, CreateInventoryItemVariables>;

interface CreateInventoryItemRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateInventoryItemVariables): MutationRef<CreateInventoryItemData, CreateInventoryItemVariables>;
}
export const createInventoryItemRef: CreateInventoryItemRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createInventoryItem(dc: DataConnect, vars: CreateInventoryItemVariables): MutationPromise<CreateInventoryItemData, CreateInventoryItemVariables>;

interface CreateInventoryItemRef {
  ...
  (dc: DataConnect, vars: CreateInventoryItemVariables): MutationRef<CreateInventoryItemData, CreateInventoryItemVariables>;
}
export const createInventoryItemRef: CreateInventoryItemRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createInventoryItemRef:
```typescript
const name = createInventoryItemRef.operationName;
console.log(name);
```

### Variables
The `CreateInventoryItem` mutation requires an argument of type `CreateInventoryItemVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateInventoryItemVariables {
  name: string;
  unitOfMeasure: string;
  currentStock: number;
}
```
### Return Type
Recall that executing the `CreateInventoryItem` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateInventoryItemData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateInventoryItemData {
  inventoryItem_insert: InventoryItem_Key;
}
```
### Using `CreateInventoryItem`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createInventoryItem, CreateInventoryItemVariables } from '@dataconnect/generated';

// The `CreateInventoryItem` mutation requires an argument of type `CreateInventoryItemVariables`:
const createInventoryItemVars: CreateInventoryItemVariables = {
  name: ..., 
  unitOfMeasure: ..., 
  currentStock: ..., 
};

// Call the `createInventoryItem()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createInventoryItem(createInventoryItemVars);
// Variables can be defined inline as well.
const { data } = await createInventoryItem({ name: ..., unitOfMeasure: ..., currentStock: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createInventoryItem(dataConnect, createInventoryItemVars);

console.log(data.inventoryItem_insert);

// Or, you can use the `Promise` API.
createInventoryItem(createInventoryItemVars).then((response) => {
  const data = response.data;
  console.log(data.inventoryItem_insert);
});
```

### Using `CreateInventoryItem`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createInventoryItemRef, CreateInventoryItemVariables } from '@dataconnect/generated';

// The `CreateInventoryItem` mutation requires an argument of type `CreateInventoryItemVariables`:
const createInventoryItemVars: CreateInventoryItemVariables = {
  name: ..., 
  unitOfMeasure: ..., 
  currentStock: ..., 
};

// Call the `createInventoryItemRef()` function to get a reference to the mutation.
const ref = createInventoryItemRef(createInventoryItemVars);
// Variables can be defined inline as well.
const ref = createInventoryItemRef({ name: ..., unitOfMeasure: ..., currentStock: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createInventoryItemRef(dataConnect, createInventoryItemVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.inventoryItem_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.inventoryItem_insert);
});
```

## UpdateMenuItemInStock
You can execute the `UpdateMenuItemInStock` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updateMenuItemInStock(vars: UpdateMenuItemInStockVariables): MutationPromise<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;

interface UpdateMenuItemInStockRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateMenuItemInStockVariables): MutationRef<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
}
export const updateMenuItemInStockRef: UpdateMenuItemInStockRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateMenuItemInStock(dc: DataConnect, vars: UpdateMenuItemInStockVariables): MutationPromise<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;

interface UpdateMenuItemInStockRef {
  ...
  (dc: DataConnect, vars: UpdateMenuItemInStockVariables): MutationRef<UpdateMenuItemInStockData, UpdateMenuItemInStockVariables>;
}
export const updateMenuItemInStockRef: UpdateMenuItemInStockRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateMenuItemInStockRef:
```typescript
const name = updateMenuItemInStockRef.operationName;
console.log(name);
```

### Variables
The `UpdateMenuItemInStock` mutation requires an argument of type `UpdateMenuItemInStockVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateMenuItemInStockVariables {
  id: UUIDString;
  inStock: boolean;
}
```
### Return Type
Recall that executing the `UpdateMenuItemInStock` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateMenuItemInStockData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateMenuItemInStockData {
  menuItem_update?: MenuItem_Key | null;
}
```
### Using `UpdateMenuItemInStock`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateMenuItemInStock, UpdateMenuItemInStockVariables } from '@dataconnect/generated';

// The `UpdateMenuItemInStock` mutation requires an argument of type `UpdateMenuItemInStockVariables`:
const updateMenuItemInStockVars: UpdateMenuItemInStockVariables = {
  id: ..., 
  inStock: ..., 
};

// Call the `updateMenuItemInStock()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateMenuItemInStock(updateMenuItemInStockVars);
// Variables can be defined inline as well.
const { data } = await updateMenuItemInStock({ id: ..., inStock: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateMenuItemInStock(dataConnect, updateMenuItemInStockVars);

console.log(data.menuItem_update);

// Or, you can use the `Promise` API.
updateMenuItemInStock(updateMenuItemInStockVars).then((response) => {
  const data = response.data;
  console.log(data.menuItem_update);
});
```

### Using `UpdateMenuItemInStock`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateMenuItemInStockRef, UpdateMenuItemInStockVariables } from '@dataconnect/generated';

// The `UpdateMenuItemInStock` mutation requires an argument of type `UpdateMenuItemInStockVariables`:
const updateMenuItemInStockVars: UpdateMenuItemInStockVariables = {
  id: ..., 
  inStock: ..., 
};

// Call the `updateMenuItemInStockRef()` function to get a reference to the mutation.
const ref = updateMenuItemInStockRef(updateMenuItemInStockVars);
// Variables can be defined inline as well.
const ref = updateMenuItemInStockRef({ id: ..., inStock: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateMenuItemInStockRef(dataConnect, updateMenuItemInStockVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.menuItem_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.menuItem_update);
});
```

