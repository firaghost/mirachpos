# Waiter Unified Workspace v2

## Goal
Replace the current embedded waiter pages with a single unified waiter workspace (Square/Toast-like) that is controlled by tenant feature flags and powered by existing `PosContext` flows.

## Constraints
- Rollout is tenant-toggle-only via `waiter_workspace_v2` in session `features`.
- Do not embed legacy full-page waiter screens inside the workspace.
- Reuse existing state/actions from `PosContext`.
- Sidebar items must hide when their `waiter_*` feature is disabled.

## UX Reference Notes (Square/Toast patterns)
- Floor plan is organized by areas/sections (Dining Room/Patio/Bar).
- Floor plan shows indicators (time since check opened, color escalation).
- Fast mode switching between Floor, Order, Active tickets.
- Order build flow is optimized for rapid taps: categories + search + quick add.

## Implementation
- `screens/workspace/Workspace.tsx`
  - Owns layout + mobile tab switching.
  - Renders native panels: `FloorPanel`, `MenuPanel`, `CartPanel`, `ActiveOrdersPanel`.
  - Reads session `features` to decide which panels/tabs are visible.
- `screens/workspace/FloorPanel.tsx`
  - Area selector + table grid.
  - Uses `usePos()` tables/orders/selectedTableId/selectTable.
- `screens/workspace/MenuPanel.tsx`
  - Category chips + search + product list.
  - Uses `usePos()` products/selectedTableId/addToCart.
- `screens/workspace/CartPanel.tsx`
  - Current table header + cart items + qty controls + send to kitchen.
  - Uses `usePos()` getCartItems/setCartQty/removeFromCart/setCartItemNote/sendOrderToKitchen/getDraftOrderMeta/setDraftOrderMeta.
- `screens/workspace/ActiveOrdersPanel.tsx`
  - Active tickets list and simple filters.
  - Uses `usePos()` orders/selectOrder/refreshFromServer.

## Feature gating
- `waiter_floor` controls Floor panel.
- `waiter_menu` controls Menu panel.
- `waiter_cart` controls Cart panel.
- `waiter_orders_active` controls Active panel.

## Verification
- With `waiter_workspace_v2` enabled:
  - Waiter sees unified workspace.
  - Disabled waiter modules do not appear in sidebar.
  - Selecting a table + adding items updates cart.
  - Send order moves it into orders list and clears cart.
- With `waiter_workspace_v2` disabled:
  - Waiter remains on legacy screens.
