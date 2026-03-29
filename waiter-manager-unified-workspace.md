# MirachPOS: Waiter Manager & Unified Workspace Logic

## Table of Contents
1. [Waiter Manager Overview](#waiter-manager-overview)
2. [Unified Workspace (Orders & Payment Focus)](#unified-workspace)
3. [Table Assignment & Visibility](#table-assignment--visibility)
4. [Order Flow](#order-flow)
5. [Payment Flow](#payment-flow)
6. [Status Transitions](#status-transitions)
7. [Key Components](#key-components)

---

## Waiter Manager Overview

The **Waiter Manager** role (`Waiter Manager`) sits between regular waiters and branch managers. It provides:

- **Impersonation capability**: Can act on behalf of any waiter in their branch
- **Table oversight**: Can view all tables (not just assigned ones)
- **Staff switching**: Can switch active waiter context without logging out
- **PIN bypass**: For manager operations, PIN verification is optional for Waiter Managers

### Role Hierarchy
```
Cafe Owner > Branch Manager > Waiter Manager > Waiter
```

### Key Permissions

| Action | Waiter | Waiter Manager | Branch Manager |
|--------|--------|----------------|----------------|
| Create order for self | ✅ | ✅ | ✅ |
| Create order for others | ❌ | ✅ (impersonate) | ✅ |
| View all tables | ❌ | ✅ | ✅ |
| Reassign tables | ❌ | ✅ | ✅ |
| Refund orders | ❌ | ❌ | ✅ |
| Manage staff | ❌ | ❌ | ✅ |

---

## Unified Workspace

The **Unified Workspace** (`screens/workspace/Workspace.tsx`) is a consolidated POS interface that combines table management, menu browsing, cart handling, and payment processing in a single screen with three panes:

### Three-Pane Layout

```
┌─────────────────┬─────────────────┬─────────────────┐
│                 │                 │                 │
│   TABLES PANE   │   MENU PANE     │   CART PANE     │
│   (Left 35%)    │   (Center 35%)  │   (Right 30%)   │
│                 │                 │                 │
│  - Grid view    │  - Categories   │  - Order items  │
│  - Status badges│  - Search       │  - Totals       │
│  - Assignment   │  - Product cards│  - Actions      │
│                 │                 │                 │
└─────────────────┴─────────────────┴─────────────────┘
```

### Unified Workspace States (Orders & Payment Only)

#### State Checkers (lines 197-202 of Workspace.tsx)
```typescript
const isBilling = openOrder?.status === 'Billing';
const canEditOrder = openOrder && ['Pending', 'Cooking', 'Ready', 'Served'].includes(openOrder.status);
const canEnterBilling = openOrder?.status === 'Served';
const isOrderPaid = openOrder?.status === 'Paid';
const isOrderTerminal = openOrder && ['Paid', 'Voided', 'Refunded'].includes(openOrder.status);
```

#### Key State Behaviors

| State | Can Add Items | Can Pay | UI Indicator |
|-------|---------------|---------|--------------|
| **Free** (no order) | ✅ | ❌ | Green badge |
| **Pending** | ✅ | ❌ | Orange badge |
| **Cooking** | ✅ | ❌ | Orange badge |
| **Ready** | ✅ | ❌ | Orange badge |
| **Served** | ✅ | ✅ (Enter Billing) | Orange → Blue transition |
| **Billing** | ❌ | ✅ | Blue overlay + modal |
| **Paid** | ❌ | ❌ | Terminal state |
| **Voided** | ❌ | ❌ | Terminal state |

---

## Table Assignment & Visibility

### Assignment Logic (WaiterDashboard.tsx)

**Automatic Assignment on First Click:**
```typescript
const handleTableClick = (tableId: string) => {
  const effectiveWaiterId = impersonateWaiterId || staffId;
  
  // Auto-assign if unassigned
  if (effectiveWaiterId && !table.assignedStaffId) {
    setTableAssignment([table.id], effectiveWaiterId, staffName || null);
  }
};
```

### Table Visibility Rules

**Regular Waiter:**
- Only sees their assigned tables
- Can see unassigned tables (to take them)
- Cannot see tables assigned to other waiters

**Waiter Manager (with impersonation):**
- Can see ALL tables
- Can switch to any waiter's view
- Can assign/reassign tables

### Table Status Mapping (API)

```javascript
// From orders.js - mapTableStatusFromOrderStatus
order.status → table.status
'Pending'  → 'Occupied'
'Cooking'  → 'Occupied'  
'Ready'    → 'Occupied'
'Served'   → 'Payment'
'Billing'  → 'Payment'
'Paid'     → 'Free'
'Voided'   → 'Free'
'Refunded' → 'Free'
```

---

## Order Flow

### 1. Order Creation (Unified Workspace)

**Trigger:** Click on a free table → Opens menu pane

**Cart Building:**
```typescript
const handleAddItem = (productId: string) => {
  if (!selectedTableId) return;
  addToCart(selectedTableId, productId);
};
```

**Send to Kitchen:**
```typescript
const handleSendOrder = async () => {
  const id = sendOrderToKitchen(selectedTableId, '');
  // Auto-print kitchen ticket
  // Refresh from server
  // Keep table selected for payment
};
```

### 2. Order Creation (API)

**POST `/api/pos/orders`**

Key fields:
- `tableId`: Links order to table
- `items[]`: Product items with qty, price, notes
- `orderType`: 'dine_in' or 'takeaway'
- `status`: Usually 'Pending' (or 'Paid' for immediate payment)

**Waiter-specific enforcement:**
```javascript
// orders.js:967-988
if (role === 'Waiter') {
  const table = await loadRestaurantTable({ tableId });
  const assigned = table?.assigned_staff_id;
  
  // Reject if table assigned to another waiter
  if (assigned && assigned !== staffId) {
    return res.status(403).json({ error: 'table_assigned_to_other' });
  }
  
  // Auto-inject createdByStaffId and createdByName
  payload.createdByStaffId = staffId;
  payload.createdByName = waiterName;
}
```

### 3. Order Updates (PUT)

**Cross-Waiter Protection:**
```javascript
// orders.js:1284-1321
if (role === 'Waiter' && !waiterIsOwner) {
  // Only allow status updates (Cooking → Ready → Served → Paid)
  // Block payload modifications
  const allowedStatusOnly = ['Cooking', 'Ready', 'Served', 'Paid'];
  if (hasNonStatusMutation || !allowedStatusOnly.includes(nextStatus)) {
    return res.status(403).json({ error: 'forbidden' });
  }
}
```

### 4. Inventory Deduction

Happens when order transitions to **Paid**:
```javascript
// orders.js:1042-1048, 1455-1463
if (status === 'Paid' && !payload.inventoryDeductedAt) {
  await applyInventoryDeductionForOrder({ tenantId, branchId, payload });
  payload.inventoryDeductedAt = new Date().toISOString();
}
```

---

## Payment Flow

### 1. Entering Billing Mode

**From Workspace.tsx:**
```typescript
const handlePay = () => {
  // Must be 'Served' to enter billing
  if (!canEnterBilling) {
    alert('Order must be marked as Served before payment');
    return;
  }
  
  // Change order status to 'Billing'
  enterBillingMode(openOrder.id);
  
  // Show payment modal
  setShowPaymentModal(true);
};
```

### 2. Billing State Lock

When `status === 'Billing'`:
- Menu pane shows overlay: "Billing Mode Active"
- Cannot add new items
- Can only proceed to payment or cancel

### 3. Payment Modal

**Supported Methods:**
- **Cash**: Amount tendered, change calculation
- **Telebirr**: QR code display, tip entry, transaction reference
- **Bank**: Transaction reference input, tip entry

**Payment State:**
```typescript
const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Telebirr' | 'Bank'>('Cash');
const [tenderedAmount, setTenderedAmount] = useState('');
const [paymentReference, setPaymentReference] = useState('');
const [tipAmount, setTipAmount] = useState('');
```

### 4. Payment Processing (API)

**Validation Steps:**
1. Check if payment method is enabled in settings
2. Validate reference if required for method
3. Compute totals (subtotal + tax + service charge + tip - discount)
4. Apply loyalty redemption if applicable
5. Create payment record

**Database Writes:**
```javascript
// orders.js:1102-1194 (transaction)
await trx.from('orders').insert({
  id,
  status: 'Paid',
  total,
  tax,
  tip,
  paid_at: nowIso,
  payment_method,
  payment_reference,
  tendered_amount,
  // ... normalized columns
});

// Dual-write to normalized tables
await trx('order_payments').insert(paymentRows);
await trx('order_items').insert(orderItemRows);
```

### 5. Loyalty Integration

**Redemption on Payment:**
```javascript
// orders.js:1079-1093
const redeemAmount = status === 'Paid'
  ? computeLoyaltyRedeemAmount({ payload, paymentMethod, computed })
  : 0;

if (status === 'Paid' && redeemAmount > 0) {
  // Validate customer has sufficient balance
  const balance = row.loyalty_balance;
  if (balance < redeemAmount) {
    return res.status(402).json({ error: 'insufficient_loyalty_balance' });
  }
}
```

**Apply Loyalty:**
```javascript
// After payment confirmed
await applyLoyaltyForPaidOrder({
  trx,
  tenantId,
  branchId,
  orderId: id,
  total: computed.total,
  paymentMethod,
  customer: payload.customer,
  loyaltySettings: settings.loyalty,
  redeemAmount,
});
```

### 6. Refund Flow

**Only Branch Managers/Cafe Owners can refund:**
```javascript
// orders.js:215-219
r.post('/pos/orders/:id/refund',
  requireRole('Cafe Owner', 'Branch Manager'),  // Waiter Manager NOT included
  // ...
);
```

**Refund Requirements:**
- Order must be in 'Paid' status
- Amount > 0
- Reason required
- Manager PIN verification (if settings require)
- Approver staff ID (manager/owner)

---

## Status Transitions

### Valid State Machine

```
Free → Pending → Cooking → Ready → Served → Billing → Paid
                                              ↓
                                         Voided (manager only)
                                              ↓
                                         Refunded (paid orders, manager only)
```

### Transition Permissions

| From → To | Waiter (owner) | Waiter (other) | Waiter Manager | Branch Manager |
|-----------|----------------|----------------|----------------|----------------|
| Pending → Cooking | ✅ | ✅ | ✅ | ✅ |
| Cooking → Ready | ✅ | ✅ | ✅ | ✅ |
| Ready → Served | ✅ | ✅ | ✅ | ✅ |
| Served → Billing | ✅ | ✅ | ✅ | ✅ |
| Billing → Paid | ✅ | ❌ | ✅ | ✅ |
| Any → Voided | ❌ | ❌ | ❌ | ✅ |
| Paid → Refunded | ❌ | ❌ | ❌ | ✅ |

---

## Key Components

### PosContext.tsx - Core Order Functions

```typescript
// Order management
sendOrderToKitchen(tableId: string, notes?: string): string;
setOrderStatus(orderId: string, status: PosOrder['status']): void;
enterBillingMode(orderId: string): void;
confirmPayment(
  orderId: string, 
  paymentMethod: PaymentMethod, 
  tenderedAmount?: number, 
  splitId?: string, 
  paymentReference?: string, 
  tip?: number
): void;
voidOrder(orderId: string, reason?: string): void;
refundOrder(orderId: string, reason: string, managerPin: string): void;

// Table assignment
setTableAssignment(tableIds: string[], staffId: string | null, staffName?: string | null): void;
```

### WaiterDashboard.tsx - Table Management

Key features:
- **Area filtering**: Tables grouped by area
- **Status filters**: All / Free / Occupied / Action (needs attention)
- **Auto-refresh**: Every 15 seconds
- **Draft inbox**: Shows submitted drafts from other devices
- **Audit trail**: Recent activity log

### Workspace.tsx - Unified Interface

**Three-pane responsive layout:**
- Desktop: All three panes visible
- Tablet: Tables + one other pane
- Mobile: Single pane with bottom nav

**Keyboard Shortcuts:**
- `Ctrl+S`: Send order to kitchen
- `Ctrl+P`: Open payment
- `Ctrl+F`: Focus search

### ServiceWorkspace.tsx (Legacy)

Alternative workspace with feature-flagged inline panes:
- `inlineReviewEnabled`: Shows order review alongside payment
- `inlineKitchenEnabled`: Shows KDS within workspace
- `inlineActiveEnabled`: Shows active orders overlay

---

## Database Schema (Orders & Payments)

### Core Tables

```sql
-- Main order table
orders (
  id, tenant_id, branch_id,
  status, total, tax, tip, discount,
  paid_at, display_number,
  table_id, table_name,
  created_by_staff_id, created_by_name,
  paid_by_staff_id, paid_by_name,
  payment_method, payment_reference, tendered_amount,
  notes, payload (JSON),
  created_at, updated_at
)

-- Normalized order items
order_items (
  id, tenant_id, branch_id, order_id,
  product_id, name, unit_price, qty,
  voided_qty, note, void_reason,
  created_at, updated_at
)

-- Split payments (for group orders)
order_splits (
  id, tenant_id, branch_id, order_id,
  split_id, status, subtotal, tax, service_charge, total,
  paid_at, payment_method, created_at
)

-- Individual split items
order_split_items (
  id, tenant_id, branch_id, order_id, split_id,
  product_id, qty, created_at
)

-- Payment records
order_payments (
  id, tenant_id, branch_id, order_id,
  amount, currency, method, reference,
  tip_amount, status, captured_at,
  created_at
)

-- Restaurant tables
restaurant_tables (
  id, tenant_id, branch_id,
  name, area, seats, status,
  assigned_staff_id, assigned_staff_name,
  open_order_id, last_order_id,
  created_at, updated_at
)

-- Public display links (for customer-facing screens)
pos_public_order_links (
  id, tenant_id, branch_id, order_id,
  token, purpose, expires_at, meta_json,
  created_at, updated_at
)
```

---

## Summary

The **Waiter Manager** role provides supervisory capabilities over regular waiters while the **Unified Workspace** streamlines the order-to-payment workflow:

1. **Table selection** → Shows cart for that table
2. **Menu browsing** → Add items to cart
3. **Send to kitchen** → Order created, status = 'Pending'
4. **Kitchen prepares** → Status: Pending → Cooking → Ready
5. **Mark served** → Status: Ready → Served
6. **Enter billing** → Status: Served → Billing (locks menu)
7. **Process payment** → Status: Billing → Paid
8. **Table freed** → Status: Paid → Free

The system enforces **role-based permissions** at both UI and API levels, with **table assignment** controlling which orders each waiter can access and modify.
