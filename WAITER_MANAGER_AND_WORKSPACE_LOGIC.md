# Waiter Manager & Unified Workspace Logic

## Overview

This document describes the architecture and flow of the **Waiter Manager** role and the **Unified Workspace** interface in MirachPOS. It covers how tables, orders, and payments flow through the system.

---

## 1. Waiter Manager Logic

### Role Definition
The `Waiter Manager` role (`UserRole.WAITER_MANAGER`) is a supervisory position that can:
- View and manage all tables in their assigned branch
- Impersonate individual waiters to see their view
- Override table assignments
- Access the full Service Workspace with all inline panels

### Key Capabilities

```typescript
// From types.ts
WAITER_MANAGER = 'Waiter Manager'
```

| Capability | Description |
|------------|-------------|
| **Impersonation** | Can view the app as any specific waiter via `impersonateWaiterId` |
| **All Table Access** | Unlike regular waiters, sees ALL tables not just assigned ones |
| **Manager Override** | Can reassign tables, override payments, void orders |
| **Inline Panels** | Full access to Active Orders, Kitchen, Expo, Notifications, System Status, Settings |

### Impersonation Flow

1. **Manager Login** → Checks `isImpersonationEnabled` (true for Branch Manager, Cafe Owner, Waiter Manager)
2. **Select Waiter** → Sets `impersonateWaiterId` in localStorage
3. **View Filter** → `visibleTables` computed based on effective waiter ID:
   ```typescript
   const effectiveWaiterId = impersonateWaiterId || staffId;
   // If impersonating: only see that waiter's assigned tables + unassigned
   // If not impersonating: see ALL tables (manager view)
   ```

---

## 2. Unified Workspace Logic

### Workspace vs ServiceWorkspace

| Component | Purpose | Used By |
|-----------|---------|---------|
| `Workspace.tsx` | Simplified unified interface | Branch Manager, Owner |
| `ServiceWorkspace.tsx` | Full-featured service interface | Waiters, Waiter Managers |

### Unified Workspace (Workspace.tsx)

A **3-panel layout** designed for fast-paced table service:

```
┌─────────────────┬───────────────┬─────────────┐
│   TABLES        │    MENU       │    CART     │
│  (Left 40%)     │  (Center)     │ (Right 360px)│
├─────────────────┼───────────────┼─────────────┤
│ • Grid view     │ • Categories  │ • Items     │
│ • Status colors │ • Search      │ • Qty +/-   │
│ • Auto-assign   │ • Products    │ • Notes     │
│ • Order total   │ • Add to cart │ • Totals    │
└─────────────────┴───────────────┴─────────────┘
```

#### Table Flow in Workspace

1. **Select Table** (`handleSelectTable`)
   ```typescript
   selectTable(tableId);
   // Auto-assign if unassigned
   if (!table.assignedStaffId && actor.staffId) {
     setTableAssignment([tableId], actor.staffId, actor.staffName);
   }
   // Load existing order if present
   if (openOrderId) selectOrder(openOrderId);
   ```

2. **Add Items** (`handleAddItem`)
   - Adds to `cartByTableId` in state
   - Updates table `currentTotal` computed value
   - Validates stock availability

3. **Send Order** (`handleSendOrder`)
   - Calls `sendOrderToKitchen(selectedTableId, notes)`
   - Opens kitchen ticket print window
   - Creates order with status `'Pending'`

4. **Payment** (`handlePay` / `handleConfirmPayment`)
   - Opens payment modal
   - Supports Cash, Telebirr, Bank Transfer
   - Validates tendered amount
   - Calls `confirmPayment(orderId, method, tendered, splitId, reference)`

---

## 3. Table Status Lifecycle

### Status States

```typescript
// PosTable.status
'Free'       // No open order, available
'Occupied'   // Has open order in progress  
'Payment'    // Order served, ready for payment
'Reserved'   // Future reservation
```

### Status Transitions

```
┌─────────┐    Select Table     ┌───────────┐
│  Free   │ ───────────────────> │ Occupied  │
│         │   (create order)    │ (Pending) │
└─────────┘                      └───────────┘
                                         │
                        Kitchen Ready    │
                                         ▼
                                  ┌───────────┐
                                  │  Cooking  │
                                  └───────────┘
                                         │
                        Kitchen Done     │
                                         ▼
                                  ┌───────────┐
                                  │   Ready   │
                                  └───────────┘
                                         │
                        Served           │
                                         ▼
                                  ┌───────────┐
                                  │  Payment  │
                                  └───────────┘
                                         │
                        Paid             │
                                         ▼
                                  ┌───────────┐
                                  │  Paid     │ ─────> ┌─────────┐
                                  └───────────┘          │  Free   │
                                                         └─────────┘
```

### Table Status Updates

From `PosContext.tsx`:

```typescript
const nextTables = s.tables.map((t) => {
  if (t.openOrderId !== orderId) return t;
  if (status === 'Served') return { ...t, status: 'Payment' };
  if (status === 'Pending') return { ...t, status: 'Occupied' };
  return t;
});
```

---

## 4. Order Flow

### Order Creation (sendOrderToKitchen)

```typescript
const sendOrderToKitchen = (tableId: string, notes?: string): string => {
  // 1. Generate order ID and number
  const orderId = generateId();
  const orderNumber = orderNumberFromId(orderId); // #XXXXXX

  // 2. Calculate totals
  const subtotal = calcSubtotal(orderItems);
  const tax = calcTax(subtotal);
  const serviceCharge = calcServiceCharge(subtotal);
  const total = calcTotal(subtotal);

  // 3. Create PosOrder object
  const newOrder: PosOrder = {
    id: orderId,
    number: orderNumber,
    tableId,
    tableName,
    items: orderItems,
    subtotal, tax, serviceCharge, total,
    status: 'Pending',
    createdAt: now.toISOString(),
    syncedToServer: false,  // Will sync via persistOrder
  };

  // 4. Update state
  setState((s) => ({
    orders: [newOrder, ...s.orders],
    tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
    cartByTableId: { ...s.cartByTableId, [tableId]: [] }, // Clear cart
  }));

  // 5. Persist to server/Electron
  void persistOrder(newOrder);

  // 6. Print kitchen ticket
  printKitchenTicket(orderId);

  return orderId;
};
```

### Order Status Transitions (setOrderStatus)

```typescript
const allowed: Record<string, PosOrder['status'][]> = {
  Pending: ['Cooking', 'Ready', 'Served', 'Voided'],
  Cooking: ['Ready', 'Served', 'Voided'],
  Ready: ['Served', 'Voided'],
  Served: ['Paid', 'Voided'],
};
```

Terminal states: `Paid`, `Voided`, `Refunded` (no further transitions allowed)

---

## 5. Payment Flow (Unified Workspace)

### Payment Methods Supported

```typescript
type PaymentMethod = 'Cash' | 'Card' | 'Telebirr' | 'Bank Transfer' | 'Loyalty';
```

### Payment Flow Steps

```
┌────────────────┐
│   Open Order   │
│  (Served status)│
└────────┬───────┘
         │
         ▼
┌────────────────┐     ┌─────────────────┐
│  Click PAY     │────>│  Payment Modal  │
│  (Ctrl+P)      │     │  Opens          │
└────────────────┘     └────────┬────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐     ┌──────────┐     ┌──────────┐
        │   Cash   │     │ Telebirr │     │   Bank   │
        └────┬─────┘     └────┬─────┘     └────┬─────┘
             │                │                │
             ▼                ▼                ▼
        ┌──────────┐     ┌──────────┐     ┌──────────┐
        │Tendered  │     │  QR Code │     │Reference │
        │Input     │     │  Display │     │ Required │
        └────┬─────┘     └────┬─────┘     └────┬─────┘
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                    ┌──────────────────┐
                    │ Confirm Payment  │
                    │ (handleConfirm)  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  confirmPayment  │
                    │  (PosContext)    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Order -> Paid  │
                    │   Table -> Free  │
                    │   Print Receipt  │
                    └──────────────────┘
```

### confirmPayment Logic (Unified Workspace)

```typescript
const confirmPayment = (
  orderId: string, 
  paymentMethod: PaymentMethod, 
  tenderedAmount?: number, 
  splitId?: string, 
  paymentReference?: string
) => {
  // 1. Offline check - only Cash works offline
  if (offline && paymentMethod !== 'Cash') {
    showNotification('Offline Payment', 'Cash only offline');
    return;
  }

  // 2. Validate order can be paid
  if (order.status !== 'Served') return;

  // 3. Handle split payments
  const hasSplits = Array.isArray(order.splits) && order.splits.length > 0;
  const payingSplit = hasSplits && typeof splitId === 'string';

  if (payingSplit) {
    // Mark specific split as paid
    const nextSplits = order.splits.map((sp) =>
      sp.id === splitId
        ? { ...sp, status: 'Paid', paidAt: now.toISOString(), paymentMethod }
        : sp
    );
    const allPaid = nextSplits.every((sp) => sp.status === 'Paid');
    
    // Only close order when ALL splits paid
    order.status = allPaid ? 'Paid' : order.status;
  } else {
    // Full payment
    order.status = 'Paid';
    order.splits = order.splits?.map(s => ({ ...s, status: 'Paid' }));
  }

  // 4. Record payment details
  order.paidAt = now.toISOString();
  order.paymentMethod = paymentMethod;
  order.tenderedAmount = tenderedAmount;
  order.paymentReference = paymentReference;
  order.paidByStaffId = actor.paidByStaffId;
  order.paidByName = actor.paidByName;
  order.syncedToServer = false;

  // 5. Close table if fully paid
  if (order.status === 'Paid') {
    table.status = 'Free';
    table.openOrderId = null;
    table.lastOrderId = orderId;
    
    // Deduct inventory
    products = products.map(p => {
      const line = order.items.find(i => i.productId === p.id);
      if (!line) return p;
      return { ...p, stock: Math.max(0, p.stock - effectiveQty(line)) };
    });
  }

  // 6. Persist and sync
  void persistOrder(updatedOrder).then(() => {
    void refreshFromServer();
  });

  // 7. Audit log
  void auditLog({
    action: 'payment.recorded',
    entity_type: 'order',
    entity_id: orderId,
    message: `Payment recorded via ${paymentMethod}`,
    meta: { paymentMethod, tenderedAmount, splitId, paymentReference }
  });
};
```

### Payment Receipt Flow

```typescript
// Auto-print receipt after payment
if (settingsUi.autoPrintReceipts && settingsUi.defaultReceiptPrinterId) {
  const key = `mirachpos.printedReceipt.${order.id}.full`;
  if (sessionStorage.getItem(key) !== '1') {
    sessionStorage.setItem(key, '1');
    void apiFetch(`/api/pos/print/receipt/${order.id}`, {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
  }
}
```

---

## 6. Data Flow Summary

### Cart → Order → Payment Flow

```
User Action                    State Change                    Server/API
───────────                    ────────────                    ──────────
Select Table     ──────────>   selectedTableId = tableId       GET /tables
                                                               GET /orders

Add Item         ──────────>   cartByTableId[tableId].push(item)  (local only)

Send Order       ──────────>   order = createOrder(items)        POST /orders
                               cartByTableId[tableId] = []       POST /print/kitchen
                               table.openOrderId = order.id

Kitchen Ready    ──────────>   order.status = 'Ready'            PUT /orders/:id

Served           ──────────>   order.status = 'Served'            PUT /orders/:id
                               table.status = 'Payment'

Pay (Cash)       ──────────>   order.status = 'Paid'             PUT /orders/:id
                               order.paymentMethod = 'Cash'      POST /print/receipt
                               table.status = 'Free'
                               table.openOrderId = null
```

---

## 7. Key Files Reference

| File | Purpose |
|------|---------|
| `screens/workspace/Workspace.tsx` | Unified 3-panel workspace |
| `screens/waiter/ServiceWorkspace.tsx` | Waiter/Manager service interface |
| `screens/waiter/WaiterDashboard.tsx` | Floor/table grid view |
| `screens/waiter/WaiterPayment.tsx` | Full payment screen |
| `PosContext.tsx` | Core state management, order/payment logic |
| `types.ts` | TypeScript interfaces and enums |

---

## 8. Offline Support

The Unified Workspace supports offline operation:

| Feature | Online | Offline |
|---------|--------|---------|
| Table selection | ✓ | ✓ |
| Add to cart | ✓ | ✓ |
| Send order | ✓ | ✓ (queued) |
| Kitchen print | ✓ | ✓ (popup fallback) |
| Cash payment | ✓ | ✓ |
| Digital payments | ✓ | ✗ |
| Receipt print | ✓ | ✓ (browser print) |

Offline actions are queued via `enqueueOutboxHttp` and sync when connectivity returns.
