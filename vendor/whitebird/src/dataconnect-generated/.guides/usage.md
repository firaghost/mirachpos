# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { createInventoryItem, listMenuItems, updateMenuItemInStock, listOrdersForUser } from '@dataconnect/generated';


// Operation CreateInventoryItem:  For variables, look at type CreateInventoryItemVars in ../index.d.ts
const { data } = await CreateInventoryItem(dataConnect, createInventoryItemVars);

// Operation ListMenuItems: 
const { data } = await ListMenuItems(dataConnect);

// Operation UpdateMenuItemInStock:  For variables, look at type UpdateMenuItemInStockVars in ../index.d.ts
const { data } = await UpdateMenuItemInStock(dataConnect, updateMenuItemInStockVars);

// Operation ListOrdersForUser:  For variables, look at type ListOrdersForUserVars in ../index.d.ts
const { data } = await ListOrdersForUser(dataConnect, listOrdersForUserVars);


```