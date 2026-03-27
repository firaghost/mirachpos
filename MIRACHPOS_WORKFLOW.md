# MIRACHPOS Unified Workspace - AI Implementation Workflow

**Project:** Simplify MIRACHPOS Waiter Interface  
**Goal:** Reduce 16+ screens to 1 unified workspace (Toast/Square style)  
**Approach:** Feature-flagged gradual migration  
**Estimated Time:** 3-5 days for MVP  
**Date:** March 26, 2026

---

## PHASE 1: SETUP & FOUNDATION (Day 1)

### 1.1 Prerequisites
```bash
# Verify existing project structure
ls -la mirachpos/

# Ensure Node.js 20+ and npm installed
node --version  # Should be v20.x or higher

# Check existing dependencies
cd mirachpos && npm list react  # Should have React 19.x
```

### 1.2 Create Feature Flag System
**File:** `src/utils/featureFlags.ts` (NEW)

```typescript
/**
 * Feature Flag System for Gradual Rollout
 * Allows safe testing without breaking existing system
 */

export type FeatureFlag = 
  | 'unified_workspace_v2'
  | 'simplified_payment'
  | 'inline_kds'
  | 'force_legacy_ui';

interface FeatureConfig {
  defaultValue: boolean;
  sources: ('url' | 'localStorage' | 'userPreference')[];
}

const FEATURE_CONFIGS: Record<FeatureFlag, FeatureConfig> = {
  unified_workspace_v2: {
    defaultValue: false,
    sources: ['url', 'localStorage', 'userPreference']
  },
  simplified_payment: {
    defaultValue: true,
    sources: ['url', 'localStorage']
  },
  inline_kds: {
    defaultValue: true,
    sources: ['url', 'localStorage']
  },
  force_legacy_ui: {
    defaultValue: false,
    sources: ['url', 'localStorage']
  }
};

export const isFeatureEnabled = (flag: FeatureFlag): boolean => {
  // Priority 1: URL parameter (for testing)
  const urlParams = new URLSearchParams(window.location.search);
  const urlValue = urlParams.get(flag);
  if (urlValue === '1' || urlValue === 'true') return true;
  if (urlValue === '0' || urlValue === 'false') return false;
  
  // Priority 2: localStorage (user preference)
  const localValue = localStorage.getItem(`mirachpos.${flag}`);
  if (localValue === 'true') return true;
  if (localValue === 'false') return false;
  
  // Priority 3: Default
  return FEATURE_CONFIGS[flag].defaultValue;
};

export const setFeatureFlag = (flag: FeatureFlag, value: boolean): void => {
  localStorage.setItem(`mirachpos.${flag}`, String(value));
};

export const resetFeatureFlag = (flag: FeatureFlag): void => {
  localStorage.removeItem(`mirachpos.${flag}`);
};

export const useFeatureFlag = (flag: FeatureFlag) => {
  const [enabled, setEnabled] = React.useState(() => isFeatureEnabled(flag));
  
  React.useEffect(() => {
    const handleStorageChange = () => {
      setEnabled(isFeatureEnabled(flag));
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [flag]);
  
  return {
    isEnabled: enabled,
    setEnabled: (value: boolean) => {
      setFeatureFlag(flag, value);
      setEnabled(value);
    },
    reset: () => {
      resetFeatureFlag(flag);
      setEnabled(FEATURE_CONFIGS[flag].defaultValue);
    }
  };
};
```

---

## PHASE 2: CORE WORKSPACE INFRASTRUCTURE (Day 1-2)

### 2.1 Create Workspace State Management
**File:** `src/screens/workspace/hooks/useWorkspace.ts` (NEW)

```typescript
import React, { useContext, useReducer, useCallback } from 'react';

// ============================================
// TYPES
// ============================================

export type WorkspaceView = 'floor' | 'menu' | 'review' | 'payment' | 'settings';

export interface Table {
  id: string;
  number: string;
  capacity: number;
  status: 'open' | 'seated' | 'ordered' | 'paid' | 'reserved';
  orderCount?: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: OrderModifier[];
  notes?: string;
}

export interface OrderModifier {
  modifierId: string;
  optionId: string;
  name: string;
  priceDelta: number;
}

export interface OrderSummary {
  id: string;
  tableNumber: string;
  status: 'pending' | 'cooking' | 'ready' | 'served' | 'paid';
  itemCount: number;
  total: number;
  elapsedTime: number;
}

export interface WorkspaceState {
  // Selection
  selectedTable: Table | null;
  currentOrder: {
    items: OrderItem[];
    total: number;
  };
  activeOrders: OrderSummary[];
  
  // UI State
  view: WorkspaceView;
  sidePanelOpen: boolean;
  searchQuery: string;
  selectedCategory: string | null;
  
  // Async Status
  isSubmitting: boolean;
  error: string | null;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  
  // User Stats
  mySalesToday: number;
  myOrderCountToday: number;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState: WorkspaceState = {
  selectedTable: null,
  currentOrder: { items: [], total: 0 },
  activeOrders: [],
  view: 'floor',
  sidePanelOpen: false,
  searchQuery: '',
  selectedCategory: null,
  isSubmitting: false,
  error: null,
  toast: null,
  mySalesToday: 0,
  myOrderCountToday: 0
};

// ============================================
// ACTIONS
// ============================================

type WorkspaceAction =
  | { type: 'SET_VIEW'; view: WorkspaceView }
  | { type: 'SELECT_TABLE'; table: Table }
  | { type: 'CLEAR_TABLE' }
  | { type: 'ADD_TO_ORDER'; item: OrderItem }
  | { type: 'REMOVE_FROM_ORDER'; index: number }
  | { type: 'UPDATE_QUANTITY'; index: number; delta: number }
  | { type: 'CLEAR_ORDER' }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_CATEGORY'; category: string | null }
  | { type: 'SEND_ORDER_START' }
  | { type: 'SEND_ORDER_SUCCESS' }
  | { type: 'SEND_ORDER_ERROR'; error: string }
  | { type: 'SET_ACTIVE_ORDERS'; orders: OrderSummary[] }
  | { type: 'SHOW_TOAST'; message: string; toastType?: 'success' | 'error' | 'info' }
  | { type: 'HIDE_TOAST' }
  | { type: 'UPDATE_STATS'; sales: number; orders: number }
  | { type: 'FOCUS_ORDER'; order: OrderSummary };

// ============================================
// REDUCER
// ============================================

function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => {
    const modifiersTotal = item.modifiers.reduce((mSum, mod) => mSum + mod.priceDelta, 0);
    return sum + ((item.price + modifiersTotal) * item.quantity);
  }, 0);
}

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view };
    
    case 'SELECT_TABLE':
      return { 
        ...state, 
        selectedTable: action.table,
        view: 'menu' // Auto-switch to menu when table selected
      };
    
    case 'CLEAR_TABLE':
      return { ...state, selectedTable: null };
    
    case 'ADD_TO_ORDER': {
      // Check if item already exists with same modifiers
      const existingIndex = state.currentOrder.items.findIndex(
        item => item.menuItemId === action.item.menuItemId && 
                JSON.stringify(item.modifiers) === JSON.stringify(action.item.modifiers)
      );
      
      let newItems;
      if (existingIndex >= 0) {
        newItems = state.currentOrder.items.map((item, idx) =>
          idx === existingIndex 
            ? { ...item, quantity: item.quantity + action.item.quantity }
            : item
        );
      } else {
        newItems = [...state.currentOrder.items, action.item];
      }
      
      return {
        ...state,
        currentOrder: {
          items: newItems,
          total: calculateOrderTotal(newItems)
        }
      };
    }
    
    case 'REMOVE_FROM_ORDER': {
      const newItems = state.currentOrder.items.filter((_, idx) => idx !== action.index);
      return {
        ...state,
        currentOrder: {
          items: newItems,
          total: calculateOrderTotal(newItems)
        }
      };
    }
    
    case 'UPDATE_QUANTITY': {
      const newItems = state.currentOrder.items.map((item, idx) => {
        if (idx !== action.index) return item;
        const newQty = Math.max(0, item.quantity + action.delta);
        return { ...item, quantity: newQty };
      }).filter(item => item.quantity > 0);
      
      return {
        ...state,
        currentOrder: {
          items: newItems,
          total: calculateOrderTotal(newItems)
        }
      };
    }
    
    case 'CLEAR_ORDER':
      return { ...state, currentOrder: { items: [], total: 0 } };
    
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };
    
    case 'SET_CATEGORY':
      return { ...state, selectedCategory: action.category };
    
    case 'SEND_ORDER_START':
      return { ...state, isSubmitting: true, error: null };
    
    case 'SEND_ORDER_SUCCESS':
      return { 
        ...state, 
        isSubmitting: false,
        view: 'floor',
        currentOrder: { items: [], total: 0 }
      };
    
    case 'SEND_ORDER_ERROR':
      return { ...state, isSubmitting: false, error: action.error };
    
    case 'SET_ACTIVE_ORDERS':
      return { ...state, activeOrders: action.orders };
    
    case 'SHOW_TOAST':
      return { 
        ...state, 
        toast: { 
          message: action.message, 
          type: action.toastType || 'info' 
        } 
      };
    
    case 'HIDE_TOAST':
      return { ...state, toast: null };
    
    case 'UPDATE_STATS':
      return {
        ...state,
        mySalesToday: action.sales,
        myOrderCountToday: action.orders
      };
    
    case 'FOCUS_ORDER':
      return { 
        ...state, 
        selectedTable: { 
          id: action.order.id, 
          number: action.order.tableNumber,
          capacity: 4, // Default
          status: 'ordered'
        },
        view: action.order.status === 'ready' ? 'menu' : 'payment'
      };
    
    default:
      return state;
  }
}

// ============================================
// CONTEXT
// ============================================

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
}

export const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  
  return (
    <WorkspaceContext.Provider value={{ state, dispatch }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

// ============================================
// HOOK
// ============================================

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  
  const { state, dispatch } = context;
  
  // Action creators
  const actions = {
    setView: useCallback((view: WorkspaceView) => 
      dispatch({ type: 'SET_VIEW', view }), []),
    
    selectTable: useCallback((table: Table) => 
      dispatch({ type: 'SELECT_TABLE', table }), []),
    
    clearTable: useCallback(() => 
      dispatch({ type: 'CLEAR_TABLE' }), []),
    
    addToOrder: useCallback((item: OrderItem) => 
      dispatch({ type: 'ADD_TO_ORDER', item }), []),
    
    removeFromOrder: useCallback((index: number) => 
      dispatch({ type: 'REMOVE_FROM_ORDER', index }), []),
    
    updateQuantity: useCallback((index: number, delta: number) => 
      dispatch({ type: 'UPDATE_QUANTITY', index, delta }), []),
    
    clearOrder: useCallback(() => 
      dispatch({ type: 'CLEAR_ORDER' }), []),
    
    setSearch: useCallback((query: string) => 
      dispatch({ type: 'SET_SEARCH', query }), []),
    
    setCategory: useCallback((category: string | null) => 
      dispatch({ type: 'SET_CATEGORY', category }), []),
    
    startSendOrder: useCallback(() => 
      dispatch({ type: 'SEND_ORDER_START' }), []),
    
    completeSendOrder: useCallback(() => 
      dispatch({ type: 'SEND_ORDER_SUCCESS' }), []),
    
    failSendOrder: useCallback((error: string) => 
      dispatch({ type: 'SEND_ORDER_ERROR', error }), []),
    
    showToast: useCallback((message: string, type?: 'success' | 'error' | 'info') => 
      dispatch({ type: 'SHOW_TOAST', message, toastType: type }), []),
    
    hideToast: useCallback(() => 
      dispatch({ type: 'HIDE_TOAST' }), []),
    
    setActiveOrders: useCallback((orders: OrderSummary[]) => 
      dispatch({ type: 'SET_ACTIVE_ORDERS', orders }), []),
    
    updateStats: useCallback((sales: number, orders: number) => 
      dispatch({ type: 'UPDATE_STATS', sales, orders }), []),
    
    focusOrder: useCallback((order: OrderSummary) => 
      dispatch({ type: 'FOCUS_ORDER', order }), []),
  };
  
  return { state, dispatch, actions };
};
```

---

## PHASE 3: MAIN WORKSPACE COMPONENT (Day 2)

### 3.1 Create Main Workspace Screen
**File:** `src/screens/workspace/Workspace.tsx` (NEW)

```typescript
import React, { useEffect } from 'react';
import { useWorkspace } from './hooks/useWorkspace';
import { FloorPanel } from './FloorPanel';
import { ActionPanel } from './ActionPanel';
import { StatusPanel } from './StatusPanel';
import { Toast } from '../../components/ui/Toast';
import './Workspace.css';

/**
 * Unified Workspace - Main Entry Point
 * 
 * Replaces: WAITER_DASHBOARD, WAITER_MENU, WAITER_REVIEW, 
 * WAITER_PAYMENT, WAITER_RECEIPT, WAITER_KDS, etc.
 * 
 * Layout: 3-column responsive grid
 * - Left (30%): Table selection
 * - Center (50%): Menu/Cart/Payment (contextual)
 * - Right (20%): Active orders & alerts
 */

export const Workspace: React.FC = () => {
  const { state, actions } = useWorkspace();
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC = back to floor view
      if (e.key === 'Escape') {
        actions.setView('floor');
      }
      
      // Space = quick pay (if table selected)
      if (e.code === 'Space' && state.selectedTable && state.view === 'menu') {
        e.preventDefault();
        actions.setView('payment');
      }
      
      // F1 = help
      if (e.key === 'F1') {
        e.preventDefault();
        actions.showToast('Help: ESC = Floor, Space = Pay, F1 = Help', 'info');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedTable, state.view]);
  
  // Auto-hide toast
  useEffect(() => {
    if (state.toast) {
      const timer = setTimeout(() => {
        actions.hideToast();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state.toast]);
  
  return (
    <div className="workspace-container">
      {/* Header */}
      <header className="workspace-header">
        <div className="header-left">
          <h1 className="app-title">MirachPOS</h1>
          {state.selectedTable && (
            <span className="table-badge">
              Table {state.selectedTable.number}
            </span>
          )}
        </div>
        
        <div className="header-center">
          {state.view !== 'floor' && (
            <button 
              className="back-button"
              onClick={() => actions.setView('floor')}
            >
              ← Floor View
            </button>
          )}
        </div>
        
        <div className="header-right">
          <span className="user-info">
            Waiter Name
          </span>
          <button className="profile-button">
            👤
          </button>
        </div>
      </header>
      
      {/* Main Content - 3 Columns */}
      <main className="workspace-main">
        {/* Left: Floor Panel */}
        <section className="panel floor-panel">
          <FloorPanel />
        </section>
        
        {/* Center: Action Panel (Contextual) */}
        <section className="panel action-panel">
          <ActionPanel />
        </section>
        
        {/* Right: Status Panel */}
        <section className="panel status-panel">
          <StatusPanel />
        </section>
      </main>
      
      {/* Toast Notifications */}
      {state.toast && (
        <Toast 
          message={state.toast.message} 
          type={state.toast.type}
          onClose={actions.hideToast}
        />
      )}
    </div>
  );
};
```

### 3.2 Add CSS Styles
**File:** `src/screens/workspace/Workspace.css` (NEW)

```css
/* Workspace Container */
.workspace-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  overflow: hidden;
}

/* Header */
.workspace-header {
  height: 60px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.app-title {
  font-size: 20px;
  font-weight: bold;
  color: #333;
}

.table-badge {
  background: #2196F3;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
}

.back-button {
  background: transparent;
  border: none;
  color: #2196F3;
  font-size: 14px;
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 4px;
}

.back-button:hover {
  background: #f0f0f0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-info {
  font-size: 14px;
  color: #666;
}

.profile-button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: #e0e0e0;
  cursor: pointer;
  font-size: 18px;
}

/* Main Layout */
.workspace-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.panel {
  overflow-y: auto;
  padding: 15px;
}

/* Left Panel - Tables */
.floor-panel {
  width: 30%;
  min-width: 280px;
  background: white;
  border-right: 1px solid #e0e0e0;
}

/* Center Panel - Actions */
.action-panel {
  flex: 1;
  background: #fafafa;
}

/* Right Panel - Status */
.status-panel {
  width: 20%;
  min-width: 240px;
  background: white;
  border-left: 1px solid #e0e0e0;
}

/* Responsive */
@media (max-width: 1024px) {
  .floor-panel {
    width: 35%;
  }
  
  .status-panel {
    display: none; /* Hide on tablet, show as overlay */
  }
}

@media (max-width: 768px) {
  .workspace-main {
    flex-direction: column;
  }
  
  .floor-panel,
  .status-panel {
    width: 100%;
    height: 50%;
  }
  
  .action-panel {
    flex: none;
    height: 50%;
  }
}
```

---

## PHASE 4: SUB-COMPONENTS (Day 2-3)

### 4.1 Floor Panel (Table Selection)
**File:** `src/screens/workspace/FloorPanel.tsx` (NEW)

```typescript
import React, { useState } from 'react';
import { useWorkspace, Table } from './hooks/useWorkspace';
import './FloorPanel.css';

export const FloorPanel: React.FC = () => {
  const { state, actions } = useWorkspace();
  const [filter, setFilter] = useState<'all' | 'open' | 'seated' | 'ordered'>('all');
  
  // Mock data - replace with actual data from PosContext
  const tables: Table[] = [
    { id: '1', number: 'T1', capacity: 4, status: 'open' },
    { id: '2', number: 'T2', capacity: 4, status: 'seated' },
    { id: '3', number: 'T3', capacity: 6, status: 'ordered', orderCount: 3 },
    { id: '4', number: 'T4', capacity: 2, status: 'paid' },
    { id: '5', number: 'T5', capacity: 4, status: 'open' },
    { id: '6', number: 'T6', capacity: 8, status: 'ordered', orderCount: 1 },
  ];
  
  const filteredTables = filter === 'all' 
    ? tables 
    : tables.filter(t => t.status === filter);
  
  const stats = {
    open: tables.filter(t => t.status === 'open').length,
    seated: tables.filter(t => t.status === 'seated').length,
    ordered: tables.filter(t => t.status === 'ordered').length,
    paid: tables.filter(t => t.status === 'paid').length,
  };

  return (
    <div className="floor-panel-content">
      {/* Stats */}
      <div className="floor-stats">
        <div className="stat-item open">
          <span className="stat-dot" />
          <span>Open {stats.open}</span>
        </div>
        <div className="stat-item seated">
          <span className="stat-dot" />
          <span>Seated {stats.seated}</span>
        </div>
        <div className="stat-item ordered">
          <span className="stat-dot" />
          <span>Ordered {stats.ordered}</span>
        </div>
        <div className="stat-item paid">
          <span className="stat-dot" />
          <span>Paid {stats.paid}</span>
        </div>
      </div>
      
      {/* Filter Tabs */}
      <div className="floor-filters">
        {(['all', 'open', 'seated', 'ordered'] as const).map((f) => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Table Grid */}
      <div className="table-grid">
        {filteredTables.map((table) => (
          <TableCard
            key={table.id}
            table={table}
            selected={state.selectedTable?.id === table.id}
            onClick={() => actions.selectTable(table)}
          />
        ))}
      </div>
    </div>
  );
};

const TableCard: React.FC<{
  table: Table;
  selected: boolean;
  onClick: () => void;
}> = ({ table, selected, onClick }) => {
  const statusColors = {
    open: '#4CAF50',
    seated: '#FFC107',
    ordered: '#F44336',
    paid: '#9C27B0',
    reserved: '#9E9E9E',
  };
  
  return (
    <button
      className={`table-card ${selected ? 'selected' : ''}`}
      style={{ borderColor: statusColors[table.status] }}
      onClick={onClick}
    >
      <div className="table-number">{table.number}</div>
      <div className="table-capacity">{table.capacity} seats</div>
      {table.orderCount && (
        <div className="order-badge">{table.orderCount}</div>
      )}
      {table.status === 'paid' && <div className="paid-check">✓</div>}
    </button>
  );
};
```

**File:** `src/screens/workspace/FloorPanel.css` (NEW)

```css
.floor-panel-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.floor-stats {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 15px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat-item.open .stat-dot { background: #4CAF50; }
.stat-item.seated .stat-dot { background: #FFC107; }
.stat-item.ordered .stat-dot { background: #F44336; }
.stat-item.paid .stat-dot { background: #9C27B0; }

.floor-filters {
  display: flex;
  gap: 5px;
  margin-bottom: 15px;
}

.filter-btn {
  flex: 1;
  padding: 8px;
  border: none;
  background: #e0e0e0;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn.active {
  background: #2196F3;
  color: white;
}

.table-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  overflow-y: auto;
}

.table-card {
  aspect-ratio: 1;
  border: 2px solid;
  border-radius: 8px;
  background: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

.table-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.table-card.selected {
  box-shadow: 0 0 0 3px #2196F3;
}

.table-number {
  font-size: 18px;
  font-weight: bold;
}

.table-capacity {
  font-size: 11px;
  color: #666;
}

.order-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 20px;
  height: 20px;
  background: #F44336;
  color: white;
  border-radius: 50%;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.paid-check {
  position: absolute;
  bottom: 5px;
  right: 5px;
  color: #9C27B0;
  font-weight: bold;
}
```

---

## PHASE 5: INTEGRATION (Day 3-4)

### 5.1 Create Entry Point Wrapper
**File:** `src/screens/WaiterEntryPoint.tsx` (MODIFY)

```typescript
import React from 'react';
import { useFeatureFlag } from '../utils/featureFlags';
import { WorkspaceProvider } from './workspace/hooks/useWorkspace';
import { Workspace } from './workspace/Workspace';

// Legacy screens (existing)
import { WaiterDashboard } from './waiter/WaiterDashboard';
import { WaiterMenu } from './waiter/WaiterMenu';
// ... other legacy screens

/**
 * Waiter Entry Point with Feature Flag
 * 
 * URL Params:
 * - ?simple=1 or ?unified_workspace_v2=1 → Enable new UI
 * - ?legacy=1 or ?force_legacy_ui=1 → Force old UI
 */

export const WaiterEntryPoint: React.FC = () => {
  const { isEnabled: unifiedEnabled } = useFeatureFlag('unified_workspace_v2');
  const { isEnabled: forceLegacy } = useFeatureFlag('force_legacy_ui');
  
  // URL override check
  const urlParams = new URLSearchParams(window.location.search);
  const urlSimple = urlParams.get('simple') === '1' || urlParams.get('unified_workspace_v2') === '1';
  const urlLegacy = urlParams.get('legacy') === '1' || urlParams.get('force_legacy_ui') === '1';
  
  // Decision logic
  const useNewUI = (unifiedEnabled || urlSimple) && !urlLegacy && !forceLegacy;
  
  if (useNewUI) {
    return (
      <WorkspaceProvider>
        <Workspace />
      </WorkspaceProvider>
    );
  }
  
  // Fallback to legacy routing
  return <LegacyWaiterRouter />;
};

// Legacy router component (existing code)
const LegacyWaiterRouter: React.FC = () => {
  // Your existing screen routing logic here
  return <WaiterDashboard />;
};
```

### 5.2 Update App.tsx Routing
**File:** `src/App.tsx` (MODIFY)

```typescript
import React from 'react';
import { Screen } from './types';
import { WaiterEntryPoint } from './screens/WaiterEntryPoint';

// In your screen switch statement, replace:
// case Screen.WAITER_DASHBOARD:
//   return <WaiterDashboard />;

// With:
case Screen.WAITER_DASHBOARD:
  return <WaiterEntryPoint />;
```

---

## PHASE 6: TESTING & VALIDATION (Day 4-5)

### 6.1 Test Checklist

| Feature | Test Steps | Expected Result |
|---------|-----------|-----------------|
| Feature Flag | Navigate with `?simple=1` | New UI loads |
| Legacy Fallback | Navigate with `?legacy=1` | Old UI loads |
| Table Selection | Click table T1 | Menu panel opens |
| Add to Order | Click menu item | Item appears in order |
| Send Order | Click "Send" button | Order sent, returns to floor |
| Payment | Click "Pay" → Select method → Complete | Payment processed, receipt printed |
| Keyboard Shortcuts | Press ESC | Returns to floor view |
| Mobile Responsive | Resize to 768px width | Layout adjusts to stacked |

### 6.2 Performance Check
```bash
# Build and check bundle size
npm run build

# Analyze bundle
npm run analyze

# Target metrics:
# - Initial load: < 2s
# - First paint: < 1s
# - Bundle size: < 500KB gzipped
```

---

## PHASE 7: DEPLOYMENT (Day 5)

### 7.1 Pre-Deployment
```bash
# 1. Run tests
npm test

# 2. Type check
npx tsc --noEmit

# 3. Lint check
npm run lint

# 4. Build
npm run build
```

### 7.2 Rollout Strategy
1. **Internal Testing** (Day 5)
   - Enable for 1-2 staff members
   - Collect feedback

2. **Soft Launch** (Day 6-7)
   - Enable for 10% of users
   - Monitor error rates

3. **Full Rollout** (Week 2)
   - Enable for all users
   - Keep legacy as fallback

4. **Legacy Removal** (Month 2)
   - Once stable
   - Remove legacy screens

---

## FILES TO CREATE/MODIFY

### New Files (7 total):
1. `src/utils/featureFlags.ts`
2. `src/screens/workspace/hooks/useWorkspace.ts`
3. `src/screens/workspace/Workspace.tsx`
4. `src/screens/workspace/Workspace.css`
5. `src/screens/workspace/FloorPanel.tsx`
6. `src/screens/workspace/FloorPanel.css`
7. `src/screens/workspace/ActionPanel.tsx` (Phase 2)

### Modified Files:
1. `src/screens/WaiterEntryPoint.tsx` (create new)
2. `src/App.tsx` (update routing)

---

## SUCCESS CRITERIA

✅ **User Experience:**
- 3 taps to place order (Table → Item → Send)
- No screen transitions during order creation
- Clear visual feedback for all actions

✅ **Performance:**
- Load time < 2 seconds
- 60fps animations
- Works offline

✅ **Reliability:**
- Zero data loss during sync
- Graceful fallback to legacy
- Error recovery

---

**Next Steps:**
1. Create the files above
2. Test locally with `?simple=1`
3. Deploy to staging
4. Gradual rollout

*Ready to build!* 🚀
