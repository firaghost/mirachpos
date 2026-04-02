import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItem, PosOrder, PosOrderItem, PosTable, Product, Recipe } from './types';
import { apiFetch, serverNowMs } from './api';
import { readSession, updateSession } from './session';
import { formatDeviceDate, formatDeviceTime } from './datetime';

type PaymentMethod = 'Cash' | 'Card' | 'Telebirr' | 'Bank Transfer' | 'Loyalty';

type PosNotificationType = 'Kitchen' | 'Payments' | 'System';

export type PosNotification = {
  id: string;
  type: PosNotificationType;
  title: string;
  message: string;
  orderId?: string;
  createdAt: string;
  read: boolean;
};

const orderNumberFromId = (id: string) => {
  const raw = String(id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  const tail = raw.slice(-6);
  return `#${(tail || raw || '000000').padStart(6, '0')}`;
};

type BranchSettingsForPrinting = {
  defaultReceiptPrinterId: string | null;
  defaultKitchenPrinterId: string | null;
  defaultBarPrinterId: string | null;
  printerPrefs?: {
    autoPrintKitchenTickets?: boolean;
    kitchenTicketBeep?: boolean;
    separateDrinkTickets?: boolean;
  };
};

const BRANCH_SETTINGS_KEY = 'mirachpos.branchSettings.v1';
const BRANCH_SETTINGS_DRAFT_KEY = 'mirachpos.branchSettings.draft.v1';

const readBranchSettingsRaw = (): string | null => {
  try {
    const saved = localStorage.getItem(BRANCH_SETTINGS_KEY);
    if (saved) return saved;
    return localStorage.getItem(BRANCH_SETTINGS_DRAFT_KEY);
  } catch {
    return null;
  }
};

const printHtmlViaIframe = (html: string): boolean => {
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      return false;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const w = iframe.contentWindow;
    if (!w) {
      document.body.removeChild(iframe);
      return false;
    }

    const cleanup = () => {
      try {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      } catch {
        // ignore
      }
    };

    const doPrint = () => {
      try {
        w.focus();
        w.print();
      } finally {
        window.setTimeout(cleanup, 500);
      }
    };

    try {
      iframe.addEventListener('load', doPrint, { once: true } as any);
    } catch {
      // ignore
    }
    window.setTimeout(doPrint, 350);
    return true;
  } catch {
    return false;
  }
};

const resolveStaffName = (staffId: string): string => {
  if (!staffId) return '';
  const cache = readStaffNameCache();
  return typeof cache[staffId] === 'string' ? cache[staffId] : '';
};

const mergeTablesPreservingAssignments = (currentTables: PosTable[], incomingTables: any): PosTable[] => {
  if (!Array.isArray(incomingTables)) return currentTables;
  const currentById = new Map<string, PosTable>();
  for (const t of currentTables) currentById.set(t.id, t);

  return incomingTables.map((raw: any) => {
    const incoming = raw as PosTable;
    const cur = currentById.get(incoming?.id);

    const hasIncomingAssignedId = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'assignedStaffId');
    const hasIncomingAssignedName = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'assignedStaffName');

    const incomingAssignedId = hasIncomingAssignedId
      ? typeof (incoming as any)?.assignedStaffId === 'string' || (incoming as any)?.assignedStaffId === null
        ? ((incoming as any).assignedStaffId as any)
        : null
      : undefined;
    const incomingAssignedName = hasIncomingAssignedName
      ? typeof (incoming as any)?.assignedStaffName === 'string' || (incoming as any)?.assignedStaffName === null
        ? ((incoming as any).assignedStaffName as any)
        : null
      : undefined;

    const curAssignedId = typeof (cur as any)?.assignedStaffId === 'string' || (cur as any)?.assignedStaffId === null ? ((cur as any)?.assignedStaffId as any) : null;
    const curAssignedName = typeof (cur as any)?.assignedStaffName === 'string' || (cur as any)?.assignedStaffName === null ? ((cur as any)?.assignedStaffName as any) : null;

    const assignedStaffId = hasIncomingAssignedId ? (incomingAssignedId ?? null) : (curAssignedId ?? null);
    const assignedStaffName = hasIncomingAssignedName ? (incomingAssignedName ?? null) : (curAssignedName ?? null);

    // Preserve shiftType from incoming or current
    const hasIncomingShiftType = raw && typeof raw === 'object' && (Object.prototype.hasOwnProperty.call(raw, 'shiftType') || Object.prototype.hasOwnProperty.call(raw, 'shift_type'));
    const incomingShiftType = hasIncomingShiftType
      ? ((raw as any)?.shiftType || (raw as any)?.shift_type)
      : undefined;
    const curShiftType = (cur as any)?.shiftType || (cur as any)?.shift_type;
    // Use incoming if it's a specific value (DAY/NIGHT), otherwise preserve current
    const shiftType = (incomingShiftType && incomingShiftType !== 'ALL') ? incomingShiftType : (curShiftType || 'ALL');

    // DEBUG logging for T-01
    if (String((incoming as any)?.id) === 'T-01' || String((cur as any)?.id) === 'T-01') {
      // eslint-disable-next-line no-console
      console.log('[DEBUG MERGE] T-01:', {
        hasIncomingShiftType,
        incomingShiftType,
        curShiftType,
        resultShiftType: shiftType,
        rawProps: raw ? Object.keys(raw).filter(k => k.includes('shift') || k.includes('type')) : [],
        rawShiftType: (raw as any)?.shiftType,
        rawShift_type: (raw as any)?.shift_type,
      });
    }

    return {
      ...incoming,
      assignedStaffId: assignedStaffId ?? null,
      assignedStaffName: assignedStaffName ?? null,
      shiftType: shiftType || 'ALL',
    };
  });
};

const mergeBranchState = (current: PersistedState, incoming: any): PersistedState => {
  if (!incoming || typeof incoming !== 'object') return current;

  const incomingTables = (incoming as any).tables;
  const incomingProducts = (incoming as any).products;
  const incomingCart = (incoming as any).cartByTableId;
  const incomingDraftMeta = (incoming as any).draftMetaByTableId;

  const next: PersistedState = {
    ...current,
    ...incoming,
    version: 1,
  };

  // Avoid wiping tables/products if server/state contains empty arrays (common when state is partially saved).
  if (Array.isArray(incomingProducts) && incomingProducts.length > 0) next.products = incomingProducts as any;
  if (Array.isArray(incomingTables) && incomingTables.length > 0) next.tables = mergeTablesPreservingAssignments(current.tables, incomingTables);
  else next.tables = current.tables;

  // Avoid wiping draft/cart state when server/state contains empty objects (common when state is partially saved).
  if (incomingCart && typeof incomingCart === 'object' && Object.keys(incomingCart).length > 0) next.cartByTableId = incomingCart as any;
  else next.cartByTableId = current.cartByTableId;

  if (incomingDraftMeta && typeof incomingDraftMeta === 'object' && Object.keys(incomingDraftMeta).length > 0) next.draftMetaByTableId = incomingDraftMeta as any;
  else next.draftMetaByTableId = current.draftMetaByTableId;

  return next;
};

const toPosTables = (rows: any[]): PosTable[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const id = String(r?.id || '').trim();
      const name = String(r?.name || '').trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        area: (typeof r?.area === 'string' && r.area.trim() ? (r.area.trim() as any) : undefined) as any,
        status: (typeof r?.status === 'string' && r.status.trim() ? (r.status.trim() as any) : 'Free') as any,
        seats: Number(r?.seats ?? 4) || 4,
        openOrderId: r?.openOrderId == null ? null : String(r.openOrderId),
        lastOrderId: r?.lastOrderId == null ? null : String(r.lastOrderId),
        cartItemCount: 0,
        currentTotal: 0,
        assignedStaffId: r?.assignedStaffId == null ? null : String(r.assignedStaffId),
        assignedStaffName: r?.assignedStaffName == null ? null : String(r.assignedStaffName),
        shiftType: r?.shiftType || r?.shift_type || 'ALL',
      } as PosTable;
    })
    .filter(Boolean) as PosTable[];
};

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const openPrintWindow = (html: string) => {
  try {
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    let didPrint = false;
    const tryPrint = () => {
      if (didPrint) return;
      didPrint = true;
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    };

    try {
      w.addEventListener('load', tryPrint);
    } catch {
      // ignore
    }

    const t = w.setTimeout(tryPrint, 900);
    w.addEventListener('beforeunload', () => {
      try {
        w.clearTimeout(t);
      } catch {
        // ignore
      }
    });
    return true;
  } catch {
    return false;
  }
};

const readKitchenPrintSettings = (): { autoKitchen: boolean; separateDrinkTickets: boolean; hasBarRoute: boolean; beep: boolean } => {
  try {
    const raw = readBranchSettingsRaw();
    if (!raw) return { autoKitchen: true, separateDrinkTickets: false, hasBarRoute: false, beep: false };
    const settings = JSON.parse(raw) as BranchSettingsForPrinting;
    return {
      autoKitchen: settings?.printerPrefs?.autoPrintKitchenTickets === true,
      separateDrinkTickets: settings?.printerPrefs?.separateDrinkTickets === true,
      beep: settings?.printerPrefs?.kitchenTicketBeep === true,
      hasBarRoute: Boolean(settings?.defaultBarPrinterId),
    };
  } catch {
    return { autoKitchen: true, separateDrinkTickets: false, hasBarRoute: false, beep: false };
  }
};

const isDrinkLine = (name: string) => /drink|juice|tea|coffee|latte|capp|espresso|mocha|soda|water/i.test(String(name || ''));

const kitchenTicketHtml = (title: string, order: PosOrder, lines: Array<{ name: string; qty: number; note?: string }>) => {
  const now = new Date();
  const header = `${escapeHtml(title)}`;
  const table = escapeHtml(order.tableName ?? '');
  const number = escapeHtml(order.number ?? '');
  const time = escapeHtml(order.timeLabel ?? formatTime(now));
  const placedBy = escapeHtml(order.createdByName ?? order.createdByStaffId ?? ' ”');
  const notes = order.notes ? `<div class="notes">${escapeHtml(order.notes)}</div>` : '';
  const items = lines
    .map((l) => {
      const note = l.note?.trim() ? `<div class="note">${escapeHtml(l.note)}</div>` : '';
      return `
        <div class="row">
          <div class="qty">${l.qty}x</div>
          <div class="name">${escapeHtml(l.name)}${note}</div>
        </div>
      `;
    })
    .join('');

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${header}</title>
      <style>
        *{box-sizing:border-box;}
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:16px; color:#111;}
        .top{display:flex; justify-content:space-between; align-items:flex-start; gap:12px;}
        .brand{font-size:14px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;}
        .meta{font-size:12px; text-align:right;}
        .by{margin-top:6px; font-size:12px; font-weight:800;}
        .kds{margin-top:8px; font-size:22px; font-weight:900;}
        .hr{border-top:2px dashed #444; margin:12px 0;}
        .row{display:flex; gap:10px; padding:8px 0; border-bottom:1px dashed #bbb;}
        .qty{width:48px; font-size:18px; font-weight:900;}
        .name{flex:1; font-size:16px; font-weight:800;}
        .note{margin-top:4px; font-size:12px; font-weight:600; color:#333;}
        .notes{margin-top:8px; padding:8px; border:1px dashed #777; font-size:12px; font-weight:700;}
        @media print{body{padding:0} .no-print{display:none}}
      </style>
    </head>
    <body>
      <div class="top">
        <div>
          <div class="brand">${header}</div>
          <div class="kds">${escapeHtml(order.tableName)}    ${number}</div>
          <div class="by">Placed by: ${placedBy}</div>
        </div>
        <div class="meta">
          <div>${time}</div>
        </div>
      </div>
      ${notes}
      <div class="hr"></div>
      ${items}
      <div class="hr"></div>
      <div class="no-print" style="font-size:12px;color:#666">Close this window after printing.</div>
    </body>
  </html>
  `;
};

type PosContextType = {
  products: Product[];
  tables: PosTable[];
  orders: PosOrder[];
  notifications: PosNotification[];
  realtime: { connected: boolean; lastErrorAt: string; lastError: string };
  outbox: { total: number; ready: number; maxAttempts: number; nextAttemptAtMin: string; stuck: number; stuckAfter: number };
  kitchenPrintByOrderId: Record<string, { status: 'printed' | 'queued' | 'failed'; message: string; updatedAt: string }>;
  getUiPref: <T = any>(key: string, fallback: T) => T;
  setUiPref: (key: string, value: any) => void;
  selectedTableId: string | null;
  selectedOrderId: string | null;
  selectTable: (tableId: string | null) => void;
  selectOrder: (orderId: string | null) => void;
  addTable: (table: { id?: string; name: string; seats: number; area?: PosTable['area']; shiftType?: 'DAY' | 'NIGHT' | 'ALL'; assignedStaffId?: string | null; assignedStaffName?: string | null }) => string;
  deleteTable: (tableId: string) => void;
  setTableAssignment: (tableIds: string[], staffId: string | null, staffName?: string | null) => void;
  getCartItems: (tableId: string) => PosOrderItem[];
  addToCart: (tableId: string, productId: string) => void;
  removeFromCart: (tableId: string, productId: string) => void;
  setCartQty: (tableId: string, productId: string, qty: number) => void;
  setCartItemNote: (tableId: string, productId: string, note: string) => void;
  setCartItemModifiers: (tableId: string, productId: string, modifiers: string[]) => void;
  clearCart: (tableId: string) => void;
  getDraftOrderMeta: (tableId: string) => { orderType?: 'dine_in' | 'takeaway'; takeawayFee?: number };
  setDraftOrderMeta: (tableId: string, meta: { orderType?: 'dine_in' | 'takeaway'; takeawayFee?: number }) => void;
  addProduct: (product: { name: string; category: string; price: number; image: string; stock?: number; description?: string }) => string;
  updateProductDetails: (
    productId: string,
    patch: { name?: string; category?: string; price?: number; image?: string; description?: string; stock?: number },
  ) => void;
  deleteProduct: (productId: string) => void;
  updateProductPrice: (productId: string, price: number) => void;
  sendOrderToKitchen: (tableId: string, notes?: string) => string;
  sendAdditionalOrderToKitchen: (tableId: string, notes?: string, orderType?: 'dine_in' | 'takeaway') => string;
  printKitchenTicket: (orderId: string, opts?: { mode?: 'auto' | 'dialog' }) => Promise<void>;
  retryKitchenTicket: (orderId: string) => Promise<void>;
  importDraftToKitchenOrder: (args: {
    draftId: string;
    createdByStaffId?: string;
    notes?: string;
    tableId?: string;
    items: Array<{ productId: string; name: string; unitPrice: number; qty: number; note?: string }>;
  }) => string;
  setPendingOrderItemQty: (orderId: string, productId: string, qty: number) => void;
  setPendingOrderItemNote: (orderId: string, productId: string, note: string) => void;
  swapOrderItem: (orderId: string, oldProductId: string, newProductId: string, newProductName: string, newProductPrice: number) => void;
  setOrderStatus: (orderId: string, status: PosOrder['status']) => void;
  voidOrder: (orderId: string, reason?: string) => void;
  voidOrderItem: (orderId: string, productId: string, qty: number, reason?: string) => void;
  refundOrder: (orderId: string, reason: string, managerPin: string) => void;
  unlockOrder: (orderId: string, managerPin: string, reason?: string) => void;
  confirmPayment: (orderId: string, paymentMethod: PaymentMethod, tenderedAmount?: number, splitId?: string, paymentReference?: string, tip?: number) => void;
  enterBillingMode: (orderId: string) => void;
  setOrderCustomer: (orderId: string, customer: { id: string; name: string; phone: string; loyaltyPoints: number; loyaltyBalance: number } | null) => void;
  setOrderSplits: (
    orderId: string,
    splits:
      | Array<{
        id: string;
        status: 'Unpaid' | 'Paid';
        items: Array<{ productId: string; qty: number }>;
        subtotal: number;
        tax: number;
        serviceCharge: number;
        total: number;
        paidAt?: string;
        paymentMethod?: PaymentMethod;
        tenderedAmount?: number;
      }>
      | null,
  ) => void;
  setOrderType: (orderId: string, orderType: 'dine_in' | 'takeaway', takeawayFee?: number) => void;
  markNotificationRead: (notificationId: string, read: boolean) => void;
  markAllNotificationsRead: () => void;
  resetDemoData: () => void;
  refreshFromServer: () => Promise<void>;
  queueOfflineWrite: (args: { url: string; method: string; body?: any; headers?: Record<string, string> }) => Promise<void>;
  // Cash reconciliation
  getShiftCashSummary: () => { expectedCash: number; cashPayments: Array<{ orderId: string; amount: number; time: string }> };
  reconcileCash: (actualCash: number, managerPin: string) => Promise<{ difference: number; status: 'balanced' | 'short' | 'over' }>;
};

type PersistedState = {
  version: number;
  products: Product[];
  tables: PosTable[];
  orders: PosOrder[];
  notifications: PosNotification[];
  cartByTableId: Record<string, PosOrderItem[]>;
  draftMetaByTableId: Record<string, { orderType?: 'dine_in' | 'takeaway'; takeawayFee?: number }>;
  selectedTableId: string | null;
  selectedOrderId: string | null;
  uiPrefs?: Record<string, any>;
};

const STORAGE_KEY = 'mirachpos.state.v1';
const BRANCH_CACHE_PREFIX = 'mirachpos.pos.branchCache.v1.';
const BRANCH_CACHE_VERSION_KEY = 'mirachpos.pos.branchCache.version.v1';
const BRANCH_CACHE_CURRENT_VERSION = 2; // Increment when schema changes

// Migration: clear stale branch cache if version mismatch (e.g., missing shift_type)
const migrateBranchCache = () => {
  try {
    const currentVersion = Number(localStorage.getItem(BRANCH_CACHE_VERSION_KEY) || '0');
    if (currentVersion < BRANCH_CACHE_CURRENT_VERSION) {
      // Clear all old branch caches
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(BRANCH_CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(BRANCH_CACHE_VERSION_KEY, String(BRANCH_CACHE_CURRENT_VERSION));
      // eslint-disable-next-line no-console
      console.log('[DEBUG] Cleared stale branchCache, upgraded to version', BRANCH_CACHE_CURRENT_VERSION);
    }
  } catch {
    // ignore
  }
};

// Run migration immediately on module load
migrateBranchCache();
const UI_STATE_PREFIX = 'mirachpos.pos.uiState.v1.';

const readUiState = (scopeKey: string): Partial<PersistedState> | null => {
  try {
    const key = `${UI_STATE_PREFIX}${String(scopeKey || '')}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<PersistedState>;
  } catch {
    return null;
  }
};

const writeUiState = (scopeKey: string, patch: Partial<PersistedState>) => {
  try {
    const key = `${UI_STATE_PREFIX}${String(scopeKey || '')}`;
    localStorage.setItem(key, JSON.stringify({ version: 1, ...(patch || {}) }));
  } catch {
    // ignore
  }
};

const INVENTORY_ITEMS_KEY = 'mirachpos.inventory.items.v1';
const RECIPES_KEY = 'mirachpos.inventory.recipes.v1';

const PRODUCT_CODE_COUNTER_KEY = 'mirachpos.counter.products.v1';

const auditLog = async (args: {
  action: string;
  entity_type?: string;
  entity_id?: string;
  message?: string;
  meta?: any;
}) => {
  try {
    await apiFetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: args.action,
        entity_type: args.entity_type || '',
        entity_id: args.entity_id || '',
        message: args.message || '',
        meta: args.meta && typeof args.meta === 'object' ? args.meta : {},
      }),
    });
  } catch {
    // ignore
  }
};

// Role-based permission utilities
const getCurrentRole = (): string => {
  try {
    const s = readSession<any>();
    return s?.role || 'Waiter';
  } catch {
    return 'Waiter';
  }
};

const hasPermission = (action: 'void' | 'refund' | 'unlock' | 'edit_cooking' | 'manage_staff' | 'view_all_tables'): boolean => {
  const role = getCurrentRole();
  
  const permissions: Record<string, string[]> = {
    'Waiter': ['edit_cooking'],
    'Waiter Manager': ['void', 'edit_cooking', 'manage_staff', 'view_all_tables'],
    'Branch Manager': ['void', 'refund', 'unlock', 'edit_cooking', 'manage_staff', 'view_all_tables'],
    'Cafe Owner': ['void', 'refund', 'unlock', 'edit_cooking', 'manage_staff', 'view_all_tables'],
    'Super Admin': ['void', 'refund', 'unlock', 'edit_cooking', 'manage_staff', 'view_all_tables'],
  };
  
  return permissions[role]?.includes(action) || false;
};

const readCounter = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};

const writeCounter = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
};

const ensureNextProductCode = (existing: Product[]) => {
  const current = readCounter(PRODUCT_CODE_COUNTER_KEY);
  if (current > 0) return current;

  let max = 0;
  for (const p of existing) {
    const m = /^PRD(\d+)$/.exec(p.code);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }

  writeCounter(PRODUCT_CODE_COUNTER_KEY, max);
  return max;
};

const PosContext = createContext<PosContextType | undefined>(undefined);

const nowIso = () => new Date().toISOString();

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatTime = (date: Date) => {
  return formatDeviceTime(date, { hour: '2-digit', minute: '2-digit' });
};

const formatDateLabel = (date: Date) => {
  return formatDeviceDate(date, { month: 'short', day: '2-digit', year: 'numeric' });
};

const calcSubtotal = (items: PosOrderItem[]) => items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

const effectiveQty = (item: PosOrderItem) => Math.max(0, item.qty - (item.voidedQty ?? 0));

const calcSubtotalEffective = (items: PosOrderItem[]) => items.reduce((sum, i) => sum + i.unitPrice * effectiveQty(i), 0);

type BranchSettingsPricing = {
  taxes?: {
    vatEnabled?: boolean;
    vatRate?: number;
    serviceChargeEnabled?: boolean;
    serviceChargeRate?: number;
  };
};

const readPricingSettings = (): { vatEnabled: boolean; vatRate: number; serviceEnabled: boolean; serviceRate: number } => {
  try {
    const raw = readBranchSettingsRaw();
    // Default: tax disabled - must be explicitly enabled by manager/owner
    if (!raw) return { vatEnabled: false, vatRate: 15, serviceEnabled: false, serviceRate: 10 };
    const parsed = JSON.parse(raw) as BranchSettingsPricing;
    // Tax is disabled by default - only enabled if explicitly set to true by manager/owner
    const vatEnabled = parsed?.taxes?.vatEnabled === true;
    const vatRate = Number(parsed?.taxes?.vatRate);
    const serviceEnabled = parsed?.taxes?.serviceChargeEnabled === true;
    const serviceRate = Number(parsed?.taxes?.serviceChargeRate);
    return {
      vatEnabled,
      vatRate: Number.isFinite(vatRate) ? vatRate : 15,
      serviceEnabled,
      serviceRate: Number.isFinite(serviceRate) ? serviceRate : 10,
    };
  } catch {
    // Default: tax disabled
    return { vatEnabled: false, vatRate: 15, serviceEnabled: false, serviceRate: 10 };
  }
};

const calcTax = (subtotal: number) => {
  const s = readPricingSettings();
  if (!s.vatEnabled) return 0;
  return subtotal * (s.vatRate / 100);
};

const calcServiceCharge = (subtotal: number) => {
  const s = readPricingSettings();
  if (!s.serviceEnabled) return 0;
  return subtotal * (s.serviceRate / 100);
};

const calcTotal = (subtotal: number) => subtotal + calcTax(subtotal) + calcServiceCharge(subtotal);

const computeInventoryStatus = (stock: number, minStock: number): InventoryItem['status'] => {
  return stock < minStock ? (stock <= 0 ? 'Critical' : 'Low Stock') : 'In Stock';
};

const readInventoryItems = (): InventoryItem[] => {
  try {
    const raw = localStorage.getItem(INVENTORY_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InventoryItem[]) : [];
  } catch {
    return [];
  }
};

const writeInventoryItems = (items: InventoryItem[]) => {
  try {
    localStorage.setItem(INVENTORY_ITEMS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
};

const readRecipes = (): Recipe[] => {
  try {
    const raw = localStorage.getItem(RECIPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Recipe[]) : [];
  } catch {
    return [];
  }
};

const readStaffNameCache = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem('mirachpos.staffNameCache.v1');
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

const adjustInventoryByOrder = (order: PosOrder, direction: 'deduct' | 'restock') => {
  const recipes = readRecipes();
  const items = readInventoryItems();
  if (items.length === 0 || recipes.length === 0) return;

  const byId = new Map<string, InventoryItem>();
  for (const it of items) byId.set(it.id, it);

  const sign = direction === 'deduct' ? -1 : 1;

  for (const line of order.items) {
    const used = effectiveQty(line);
    if (used <= 0) continue;
    const recipe = recipes.find((r) => r.productId === line.productId);
    if (!recipe) continue;

    for (const ing of recipe.ingredients) {
      const inv = byId.get(ing.ingredientId);
      if (!inv) continue;
      const delta = sign * ing.quantity * used;
      const nextStock = Math.max(0, inv.stock + delta);
      byId.set(inv.id, { ...inv, stock: nextStock, status: computeInventoryStatus(nextStock, inv.minStock) });
    }
  }

  writeInventoryItems(Array.from(byId.values()));
};

const restockInventoryForVoidedLineDelta = (productId: string, voidDeltaQty: number) => {
  if (voidDeltaQty <= 0) return;
  const recipes = readRecipes();
  const items = readInventoryItems();
  if (items.length === 0 || recipes.length === 0) return;

  const recipe = recipes.find((r) => r.productId === productId);
  if (!recipe) return;

  const byId = new Map<string, InventoryItem>();
  for (const it of items) byId.set(it.id, it);

  for (const ing of recipe.ingredients) {
    const inv = byId.get(ing.ingredientId);
    if (!inv) continue;
    const nextStock = Math.max(0, inv.stock + ing.quantity * voidDeltaQty);
    byId.set(inv.id, { ...inv, stock: nextStock, status: computeInventoryStatus(nextStock, inv.minStock) });
  }

  writeInventoryItems(Array.from(byId.values()));
};

const seedState = (): PersistedState => {
  return {
    version: 1,
    products: [],
    tables: [],
    orders: [],
    notifications: [],
    cartByTableId: {},
    draftMetaByTableId: {},
    selectedTableId: null,
    selectedOrderId: null,
  };
};

const readBranchCache = (scopeKey: string): Partial<PersistedState> | null => {
  try {
    const key = `${BRANCH_CACHE_PREFIX}${String(scopeKey || '')}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<PersistedState>;
  } catch {
    return null;
  }
};

const writeBranchCache = (scopeKey: string, patch: Partial<PersistedState>) => {
  try {
    const key = `${BRANCH_CACHE_PREFIX}${String(scopeKey || '')}`;
    localStorage.setItem(key, JSON.stringify({ version: 1, ...(patch || {}) }));
  } catch {
    // ignore
  }
};

const readState = (): PersistedState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed) return seedState();
    if (parsed.version != null && parsed.version !== 1) return seedState();

    const seeded = seedState();

    const migratedOrders = Array.isArray(parsed.orders)
      ? parsed.orders.map((o) => ({
        ...o,
        createdByStaffId: typeof (o as any).createdByStaffId === 'string' ? (o as any).createdByStaffId : undefined,
        createdByName: typeof (o as any).createdByName === 'string' ? (o as any).createdByName : undefined,
        syncedToServer: typeof (o as any).syncedToServer === 'boolean' ? (o as any).syncedToServer : false,
        syncedAt: typeof (o as any).syncedAt === 'string' ? (o as any).syncedAt : undefined,
        items: Array.isArray(o.items)
          ? o.items.map((it) => ({
            ...it,
            voidedQty: typeof (it as any).voidedQty === 'number' ? (it as any).voidedQty : 0,
            note: typeof (it as any).note === 'string' ? (it as any).note : '',
            voidReason: typeof (it as any).voidReason === 'string' ? (it as any).voidReason : undefined,
          }))
          : [],
      }))
      : seeded.orders;

    const migratedTables = Array.isArray(parsed.tables)
      ? parsed.tables.map((t) => ({
        ...t,
        openOrderId: typeof t.openOrderId === 'string' || t.openOrderId === null ? t.openOrderId : null,
        lastOrderId: typeof t.lastOrderId === 'string' || t.lastOrderId === null ? t.lastOrderId : null,
        assignedStaffId: typeof t.assignedStaffId === 'string' || t.assignedStaffId === null ? t.assignedStaffId : null,
        assignedStaffName:
          (() => {
            const rawName = (t as any).assignedStaffName;
            const cleaned = typeof rawName === 'string' ? rawName.trim() : '';
            if (rawName === null) return null;
            if (cleaned && cleaned.toLowerCase() !== 'waiter') return cleaned;
            const id = typeof t.assignedStaffId === 'string' ? t.assignedStaffId : '';
            const cached = resolveStaffName(id);
            return cached ? cached : null;
          })(),
        cartItemCount: typeof t.cartItemCount === 'number' ? t.cartItemCount : 0,
        currentTotal: typeof t.currentTotal === 'number' ? t.currentTotal : 0,
        shiftType: ((t as any).shiftType || (t as any).shift_type || 'ALL') as any,
      }))
      : seeded.tables;

    const migratedProducts = Array.isArray(parsed.products)
      ? (() => {
        const src = parsed.products as any[];
        let last = ensureNextProductCode(seeded.products);
        const nextProducts: Product[] = [];

        for (const p of src) {
          const id = typeof p.id === 'string' ? p.id : generateId();
          const name = typeof p.name === 'string' ? p.name : '';
          const price = typeof p.price === 'number' ? p.price : 0;
          const category = typeof p.category === 'string' ? p.category : '';
          const image = typeof p.image === 'string' ? p.image : '';
          const stock = typeof p.stock === 'number' ? p.stock : 0;

          const rawCode = typeof p.code === 'string' ? p.code : '';
          const code = rawCode.trim()
            ? rawCode
            : (() => {
              last += 1;
              return `PRD${last}`;
            })();

          nextProducts.push({ id, code, name, price, category, image, stock });
        }

        writeCounter(PRODUCT_CODE_COUNTER_KEY, last);
        return nextProducts;
      })()
      : seeded.products;

    return {
      ...seeded,
      ...parsed,
      version: 1,
      products: migratedProducts,
      tables: migratedTables,
      orders: migratedOrders,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      cartByTableId: parsed.cartByTableId ?? seeded.cartByTableId,
      selectedTableId: parsed.selectedTableId ?? seeded.selectedTableId,
      selectedOrderId: parsed.selectedOrderId ?? seeded.selectedOrderId,
    };
  } catch {
    return seedState();
  }
};

type ApiPosOrderRow = {
  id: string;
  status: string;
  total: number;
  tax: number;
  tip: number;
  discount: number;
  createdAt: string;
  paidAt?: string | null;
  payload: any;
};

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<PersistedState>(() => readState());
  const [kitchenPrintByOrderId, setKitchenPrintByOrderId] = useState<
    Record<string, { status: 'printed' | 'queued' | 'failed'; message: string; updatedAt: string }>
  >({});
  const lastSentRef = useRef<string>('');
  const lastRefreshAtRef = useRef<number>(0);
  const realtimeRef = useRef<{ es: EventSource | null; retryTimer: number | null }>({ es: null, retryTimer: null });
  const stateRef = useRef<PersistedState>(state);
  const syncInFlightRef = useRef<boolean>(false);
  const uiPersistTimerRef = useRef<number | null>(null);
  const [uiPrefs, setUiPrefs] = useState<Record<string, any>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<{ connected: boolean; lastErrorAt: string; lastError: string }>({
    connected: false,
    lastErrorAt: '',
    lastError: '',
  });

  const normalizeBranchId = (raw: unknown) => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    if (s === 'global') return '';
    if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
    return s;
  };

  const getBranchScopeKey = () => {
    try {
      const s = readSession<any>();
      if (!s) return '';
      const tenantId = typeof s?.tenantId === 'string' ? s.tenantId : '';
      const branchId = (() => {
        const b = typeof s?.branchId === 'string' ? s.branchId : '';
        const norm = normalizeBranchId(b);
        if (norm) return norm;
        try {
          const selected =
            localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
            '';
          return normalizeBranchId(selected);
        } catch {
          return '';
        }
      })();
      if (!tenantId || !branchId) return '';
      return `tenant:${tenantId}:branch:${branchId}:pos_ui_v1`;
    } catch {
      return '';
    }
  };

  const getEffectiveBranchIdForApi = () => {
    try {
      const s = readSession<any>();
      if (!s) return '';
      const role = typeof s?.role === 'string' ? s.role : '';
      const fromToken = typeof s?.branchId === 'string' ? s.branchId : '';
      const tokenBranch = normalizeBranchId(fromToken);

      if (role === 'Cafe Owner' || role === 'Waiter Manager' || role === 'Branch Manager') {
        if (tokenBranch && tokenBranch !== 'global') return tokenBranch;
        try {
          const selected =
            localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
            '';
          return normalizeBranchId(selected);
        } catch {
          return '';
        }
      }

      return tokenBranch;
    } catch {
      return '';
    }
  };

  const withBranchQuery = (url: string) => {
    try {
      if (/[?&]branchId=/i.test(url)) return url;
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      const tokenBranch = typeof s?.branchId === 'string' ? s.branchId : '';
      const needsQueryBranch = (role === 'Cafe Owner' || role === 'Branch Manager' || role === 'Waiter Manager') && (!tokenBranch || !tokenBranch.trim() || tokenBranch.trim() === 'global');
      if (!needsQueryBranch) return url;
      const branchId = getEffectiveBranchIdForApi();
      if (!branchId || branchId === 'global') return url;
      return url.includes('?') ? `${url}&branchId=${encodeURIComponent(branchId)}` : `${url}?branchId=${encodeURIComponent(branchId)}`;
    } catch {
      return url;
    }
  };

  const electronApis = useMemo(() => {
    const w = window as any;
    const pos = w?.mirachpos?.pos;
    const outbox = w?.mirachpos?.outbox;
    const printers = w?.mirachpos?.printers;
    return {
      posUpsertTables: typeof pos?.upsertTables === 'function' ? (pos.upsertTables as (p: any) => Promise<any>) : null,
      posListTables: typeof pos?.listTables === 'function' ? (pos.listTables as (p: any) => Promise<any>) : null,
      posUpsertProducts: typeof pos?.upsertProducts === 'function' ? (pos.upsertProducts as (p: any) => Promise<any>) : null,
      posListProducts: typeof pos?.listProducts === 'function' ? (pos.listProducts as (p: any) => Promise<any>) : null,
      posUpsertOrderBundle: typeof pos?.upsertOrderBundle === 'function' ? (pos.upsertOrderBundle as (p: any) => Promise<any>) : null,
      posGetOrderBundle: typeof pos?.getOrderBundle === 'function' ? (pos.getOrderBundle as (p: any) => Promise<any>) : null,
      posListOrders: typeof pos?.listOrders === 'function' ? (pos.listOrders as (p: any) => Promise<any>) : null,
      outboxEnqueue: typeof outbox?.enqueue === 'function' ? (outbox.enqueue as (p: any) => Promise<any>) : null,
      outboxListReady: typeof outbox?.listReady === 'function' ? (outbox.listReady as (p: any) => Promise<any>) : null,
      outboxStats: typeof outbox?.stats === 'function' ? (outbox.stats as (p: any) => Promise<any>) : null,
      outboxAck: typeof outbox?.ack === 'function' ? (outbox.ack as (p: any) => Promise<any>) : null,
      outboxBump: typeof outbox?.bump === 'function' ? (outbox.bump as (p: any) => Promise<any>) : null,
      printersList: typeof printers?.list === 'function' ? (printers.list as () => Promise<any>) : null,
      printersPrintHtml: typeof printers?.printHtml === 'function' ? (printers.printHtml as (p: any) => Promise<any>) : null,
    };
  }, []);

  const [outboxStatus, setOutboxStatus] = useState<{ total: number; ready: number; maxAttempts: number; nextAttemptAtMin: string; stuck: number; stuckAfter: number }>(
    {
      total: 0,
      ready: 0,
      maxAttempts: 0,
      nextAttemptAtMin: '',
      stuck: 0,
      stuckAfter: 8,
    },
  );

  const bumpDelayMsForAttempts = (attempts: number) => {
    const a = Number.isFinite(Number(attempts)) ? Math.max(0, Math.trunc(Number(attempts))) : 0;
    const base = 2500;
    const max = 5 * 60_000;
    const exp = Math.min(max, base * Math.pow(2, Math.min(10, a)));
    const jitter = 0.75 + Math.random() * 0.5;
    return Math.max(1000, Math.round(exp * jitter));
  };

  const persistTablesToElectron = useCallback(
    async (scopeKey: string, tables: any[]) => {
      try {
        if (!scopeKey) return;
        if (!electronApis.posUpsertTables) return;
        // eslint-disable-next-line no-console
        console.log('[DEBUG PERSIST] Saving tables to Electron:', tables.map((t: any) => ({ id: t.id, shiftType: t.shiftType, shift_type: t.shift_type })));
        await electronApis.posUpsertTables({ scopeKey, tables });
      } catch {
        // ignore
      }
    },
    [electronApis.posUpsertTables],
  );

  const enqueueOutboxHttp = useCallback(
    async (args: { url: string; method: string; body?: any; headers?: Record<string, string> }) => {
      const scopeKey = getBranchScopeKey();
      if (!scopeKey) return;
      if (!electronApis.outboxEnqueue) return;
      const url = String(args?.url || '').trim();
      const method = String(args?.method || '').trim().toUpperCase();
      if (!url || !method) return;
      const headers = args?.headers && typeof args.headers === 'object' ? args.headers : undefined;
      const body = args?.body === undefined ? undefined : args.body;
      try {
        await electronApis.outboxEnqueue({
          scopeKey,
          kind: 'http',
          payload: { url, method, headers, body },
        });
      } catch {
        // ignore
      }
    },
    [electronApis],
  );

  const enqueueOutboxPrintHtml = useCallback(
    async (args: { html: string; deviceName: string }) => {
      const scopeKey = getBranchScopeKey();
      if (!scopeKey) return;
      if (!electronApis.outboxEnqueue) return;
      const html = typeof args?.html === 'string' ? args.html : '';
      const deviceName = typeof args?.deviceName === 'string' ? args.deviceName.trim() : '';
      if (!html.trim() || !deviceName) return;
      try {
        await electronApis.outboxEnqueue({
          scopeKey,
          kind: 'print.html',
          payload: { html, deviceName },
        });
      } catch {
        // ignore
      }
    },
    [electronApis.outboxEnqueue, getBranchScopeKey],
  );

  const loadKitchenPrinterTarget = useCallback(() => {
    try {
      const raw = readBranchSettingsRaw();
      if (!raw) return null;
      const settings = JSON.parse(raw) as any;
      const deviceId = typeof settings?.defaultKitchenPrinterId === 'string' ? settings.defaultKitchenPrinterId : '';
      const devices = Array.isArray(settings?.devices) ? settings.devices : [];
      const device = deviceId ? devices.find((d: any) => String(d?.id || '') === deviceId) : null;
      if (!device) return null;

      const connection = String(device?.connection || '').trim();
      const printerName = typeof device?.printerName === 'string' ? device.printerName.trim() : '';
      return { connection, printerName, deviceId };
    } catch {
      return null;
    }
  }, []);

  const computeKitchenDeltaLines = useCallback(
    (before: Array<{ name: string; qty: number; note?: string }>, after: Array<{ name: string; qty: number; note?: string }>) => {
      const keyFor = (l: { name: string; note?: string }) => `${String(l?.name || '').trim()}|${String(l?.note || '').trim()}`;

      const b = new Map<string, number>();
      for (const x of Array.isArray(before) ? before : []) {
        if (!x) continue;
        const name = String(x?.name || '').trim();
        const qty = Number(x?.qty ?? 0) || 0;
        const note = typeof x?.note === 'string' ? x.note.trim() : '';
        if (!name || qty <= 0) continue;
        const k = keyFor({ name, note });
        b.set(k, (b.get(k) || 0) + qty);
      }

      const a = new Map<string, number>();
      for (const x of Array.isArray(after) ? after : []) {
        if (!x) continue;
        const name = String(x?.name || '').trim();
        const qty = Number(x?.qty ?? 0) || 0;
        const note = typeof x?.note === 'string' ? x.note.trim() : '';
        if (!name || qty <= 0) continue;
        const k = keyFor({ name, note });
        a.set(k, (a.get(k) || 0) + qty);
      }

      const out: Array<{ name: string; qty: number; note?: string }> = [];
      const keys = new Set<string>([...b.keys(), ...a.keys()]);
      for (const k of keys) {
        const diff = (a.get(k) || 0) - (b.get(k) || 0);
        if (!diff) continue;
        const [name, note] = k.split('|');
        out.push({ name: String(name || ''), qty: diff, ...(note ? { note } : {}) });
      }
      return out;
    },
    [],
  );

  const pendingChangePrintTimersRef = useRef<Record<string, number>>({});

  const queueKitchenSnapshot = useCallback((orderId: string, lines: Array<{ name: string; qty: number; note?: string }>) => {
    try {
      const key = `mirachpos.kitchenSnapshot.${orderId}`;
      sessionStorage.setItem(key, JSON.stringify({ lines }));
    } catch {
      // ignore
    }
  }, []);

  const readKitchenSnapshotLines = useCallback((orderId: string) => {
    try {
      const key = `mirachpos.kitchenSnapshot.${orderId}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      return Array.isArray(parsed?.lines) ? parsed.lines : null;
    } catch {
      return null;
    }
  }, []);

  const printKitchenUsbOrQueue = useCallback(
    async (args: { orderId: string; html: string; deviceName: string }) => {
      if (!electronApis.printersPrintHtml) {
        await enqueueOutboxPrintHtml({ html: args.html, deviceName: args.deviceName });
        return;
      }
      try {
        await electronApis.printersPrintHtml({ html: args.html, deviceName: args.deviceName, silent: true });
      } catch {
        await enqueueOutboxPrintHtml({ html: args.html, deviceName: args.deviceName });
      }
    },
    [electronApis.printersPrintHtml, enqueueOutboxPrintHtml],
  );

  const setKitchenPrintStatus = useCallback(
    (args: { orderId: string; status: 'printed' | 'queued' | 'failed'; message: string }) => {
      const oid = String(args?.orderId || '').trim();
      if (!oid) return;
      setKitchenPrintByOrderId((cur) => ({
        ...cur,
        [oid]: { status: args.status, message: String(args.message || ''), updatedAt: nowIso() },
      }));
    },
    [],
  );

  const attemptKitchenAutoPrint = useCallback(
    async (args: { order: PosOrder; lines: Array<{ name: string; qty: number; note?: string }>; title?: string }) => {
      const oid = String(args?.order?.id || '').trim();
      if (!oid) return;

      const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim() : 'Kitchen Ticket';
      const { beep } = readKitchenPrintSettings();
      const lines = Array.isArray(args?.lines) ? args.lines : [];

      const usbTarget = loadKitchenPrinterTarget();
      if (usbTarget && usbTarget.connection === 'USB' && usbTarget.printerName) {
        const html = kitchenTicketHtml(title, args.order, lines);
        if (!electronApis.printersPrintHtml) {
          await enqueueOutboxPrintHtml({ html, deviceName: usbTarget.printerName });
          setKitchenPrintStatus({ orderId: oid, status: 'queued', message: 'Queued (retrying)' });
          return;
        }
        try {
          await electronApis.printersPrintHtml({ html, deviceName: usbTarget.printerName, silent: true });
          setKitchenPrintStatus({ orderId: oid, status: 'printed', message: 'Printed' });
        } catch {
          await enqueueOutboxPrintHtml({ html, deviceName: usbTarget.printerName });
          setKitchenPrintStatus({ orderId: oid, status: 'queued', message: 'Queued (retrying)' });
        }
        return;
      }

      const kitchenDeviceId = (() => {
        try {
          const raw = readBranchSettingsRaw();
          if (!raw) return '';
          const settings = JSON.parse(raw) as BranchSettingsForPrinting;
          return typeof settings?.defaultKitchenPrinterId === 'string' ? settings.defaultKitchenPrinterId : '';
        } catch {
          return '';
        }
      })();

      if (!kitchenDeviceId) {
        setKitchenPrintStatus({ orderId: oid, status: 'failed', message: 'Failed (no kitchen printer)' });
        return;
      }

      try {
        const res = await apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(oid)}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: kitchenDeviceId, title, lines, beep }),
        });
        if (res.ok) {
          setKitchenPrintStatus({ orderId: oid, status: 'printed', message: 'Printed' });
          return;
        }
        if (res.status === 202) {
          setKitchenPrintStatus({ orderId: oid, status: 'queued', message: 'Queued (retrying)' });
          return;
        }
        const json = (await res.json().catch(() => null)) as any;
        const err = typeof json?.error === 'string' && json.error.trim() ? json.error.trim() : `HTTP ${res.status}`;
        setKitchenPrintStatus({ orderId: oid, status: 'failed', message: `Failed (${err})` });
      } catch {
        setKitchenPrintStatus({ orderId: oid, status: 'queued', message: 'Queued (retrying)' });
      }
    },
    [electronApis.printersPrintHtml, enqueueOutboxPrintHtml, loadKitchenPrinterTarget, setKitchenPrintStatus],
  );

  const scheduleKitchenChangesPrint = useCallback(
    (order: PosOrder) => {
      try {
        const { autoKitchen, beep } = readKitchenPrintSettings();
        if (!autoKitchen) return;

        const target = loadKitchenPrinterTarget();
        if (!target || target.connection !== 'USB' || !target.printerName) return;

        const oid = String(order?.id || '').trim();
        if (!oid) return;

        const existing = pendingChangePrintTimersRef.current[oid];
        if (existing) window.clearTimeout(existing);

        pendingChangePrintTimersRef.current[oid] = window.setTimeout(() => {
          try {
            const beforeLines = readKitchenSnapshotLines(oid);
            if (!beforeLines) return;
            const afterLines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));
            const delta = computeKitchenDeltaLines(beforeLines, afterLines);
            if (!delta.length) return;

            const html = kitchenTicketHtml('CHANGES', order, delta);
            void printKitchenUsbOrQueue({ orderId: oid, html, deviceName: target.printerName });
            queueKitchenSnapshot(oid, afterLines);
          } catch {
            // ignore
          }
        }, 700);
      } catch {
        // ignore
      }
    },
    [computeKitchenDeltaLines, loadKitchenPrinterTarget, printKitchenUsbOrQueue, queueKitchenSnapshot, readKitchenSnapshotLines],
  );

  const queueOfflineWrite = useCallback(
    async (args: { url: string; method: string; body?: any; headers?: Record<string, string> }) => {
      await enqueueOutboxHttp(args);
    },
    [enqueueOutboxHttp],
  );

  const [sessionRev, setSessionRev] = useState(0);

  useEffect(() => {
    const onChange = () => setSessionRev((n) => n + 1);
    try {
      window.addEventListener('mirachpos-session-changed', onChange);
    } catch {
      // ignore
    }
    return () => {
      try {
        window.removeEventListener('mirachpos-session-changed', onChange);
      } catch {
        // ignore
      }
    };
  }, []);

  const isBranchUser = useMemo(() => {
    try {
      const s = readSession<any>();
      if (!s) return false;
      const role = String(s?.role || '');
      if (role === 'Branch Manager' || role === 'Waiter' || role === 'Waiter Manager') return true;
      if (role === 'Cafe Owner') {
        const branchId = getEffectiveBranchIdForApi();
        return Boolean(branchId && branchId !== 'global');
      }
      return false;
    } catch {
      return false;
    }
  }, [sessionRev]);

  const [remoteReady, setRemoteReady] = useState(false);

  const uiScopeKey = useMemo(() => {
    try {
      if (!isBranchUser) return 'local_demo';
      const scopeKey = getBranchScopeKey();
      return scopeKey || '';
    } catch {
      return '';
    }
  }, [isBranchUser, sessionRev]);

  useEffect(() => {
    try {
      if (!uiScopeKey) return;
      const cached = readUiState(uiScopeKey);
      if (!cached) return;
      setState((s) => {
        const next: PersistedState = { ...s, version: 1 };
        if (cached.selectedTableId !== undefined) next.selectedTableId = cached.selectedTableId as any;
        if (cached.selectedOrderId !== undefined) next.selectedOrderId = cached.selectedOrderId as any;
        if (cached.cartByTableId && typeof cached.cartByTableId === 'object') next.cartByTableId = cached.cartByTableId as any;
        if (cached.draftMetaByTableId && typeof cached.draftMetaByTableId === 'object') next.draftMetaByTableId = cached.draftMetaByTableId as any;
        return next;
      });
      try {
        const p = (cached as any)?.uiPrefs;
        if (p && typeof p === 'object') setUiPrefs(p as any);
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, [uiScopeKey]);

  useEffect(() => {
    try {
      if (!state.selectedTableId) return;
      if (!Array.isArray(state.tables) || state.tables.length === 0) return;
      const exists = state.tables.some((t) => String((t as any)?.id || '') === String(state.selectedTableId));
      if (!exists) setState((s) => ({ ...s, selectedTableId: null }));
    } catch {
      // ignore
    }
  }, [state.selectedTableId, state.tables]);

  useEffect(() => {
    try {
      if (!uiScopeKey) return;
      if (uiPersistTimerRef.current) window.clearTimeout(uiPersistTimerRef.current);
      uiPersistTimerRef.current = window.setTimeout(() => {
        try {
          writeUiState(uiScopeKey, {
            selectedTableId: state.selectedTableId,
            selectedOrderId: state.selectedOrderId,
            cartByTableId: state.cartByTableId,
            draftMetaByTableId: state.draftMetaByTableId,
            uiPrefs,
          });
        } catch {
          // ignore
        }
      }, 150);
    } catch {
      // ignore
    }
    return () => {
      try {
        if (uiPersistTimerRef.current) window.clearTimeout(uiPersistTimerRef.current);
      } catch {
        // ignore
      }
    };
  }, [uiScopeKey, state.selectedTableId, state.selectedOrderId, state.cartByTableId, state.draftMetaByTableId, uiPrefs]);

  const getUiPref = useCallback(
    <T = any,>(key: string, fallback: T): T => {
      try {
        if (!key) return fallback;
        if (!uiPrefs || typeof uiPrefs !== 'object') return fallback;
        if (!Object.prototype.hasOwnProperty.call(uiPrefs, key)) return fallback;
        const v = (uiPrefs as any)[key];
        return (v as T) ?? fallback;
      } catch {
        return fallback;
      }
    },
    [uiPrefs],
  );

  const setUiPref = useCallback(
    (key: string, value: any) => {
      if (!key) return;
      setUiPrefs((prev) => {
        const next = { ...(prev || {}), [key]: value };
        try {
          if (uiScopeKey) writeUiState(uiScopeKey, { uiPrefs: next as any });
        } catch {
          // ignore
        }
        return next;
      });
    },
    [uiScopeKey],
  );

  useEffect(() => {
    try {
      if (!isBranchUser) return;
      const scopeKey = getBranchScopeKey();
      if (!scopeKey) return;
      const cached = readBranchCache(scopeKey);
      if (!cached) return;
      // Only merge branchCache if we don't have tables yet or if we're offline
      // Server refresh will provide authoritative data including shift_type
      setState((s) => {
        const hasServerTables = Array.isArray(s.tables) && s.tables.length > 0 && s.tables.some((t: any) => t.shiftType && t.shiftType !== 'ALL');
        if (hasServerTables) {
          return s;
        }
        return mergeBranchState(s, cached);
      });
    } catch {
      // ignore
    }
  }, [isBranchUser, sessionRev]);

  useEffect(() => {
    try {
      if (!isBranchUser) return;
      const scopeKey = getBranchScopeKey();
      if (!scopeKey) return;
      if (Array.isArray(state.tables) && state.tables.length) writeBranchCache(scopeKey, { tables: state.tables });
      if (Array.isArray(state.products) && state.products.length) writeBranchCache(scopeKey, { products: state.products });
      if (Array.isArray(state.tables) && state.tables.length) void persistTablesToElectron(scopeKey, state.tables);
      if (Array.isArray(state.products) && state.products.length && electronApis.posUpsertProducts) {
        void electronApis.posUpsertProducts({ scopeKey, products: state.products }).catch(() => {
          // ignore
        });
      }
    } catch {
      // ignore
    }
  }, [isBranchUser, sessionRev, state.tables, state.products, persistTablesToElectron, electronApis.posUpsertProducts]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        if (!isBranchUser) return;
        const scopeKey = getBranchScopeKey();
        if (!scopeKey) return;
        if (!electronApis.posListTables && !electronApis.posListProducts && !electronApis.posListOrders) return;

        // 0) Hydrate tables from local SQLite cache (Electron) for fast startup + offline.
        try {
          if (electronApis.posListTables) {
            const rows = await electronApis.posListTables({ scopeKey, limit: 800 });
            const localTables = Array.isArray(rows)
              ? rows
                  .map((t: any) => ({
                    id: String(t?.id || ''),
                    name: String(t?.name || ''),
                    area: t?.area != null ? String(t.area) : null,
                    status: String(t?.status || 'Free'),
                    seats: Number(t?.seats ?? 4) || 4,
                    openOrderId: t?.open_order_id ? String(t.open_order_id) : null,
                    lastOrderId: t?.last_order_id ? String(t.last_order_id) : null,
                    assignedStaffId: t?.assigned_staff_id ? String(t.assigned_staff_id) : null,
                    assignedStaffName: t?.assigned_staff_name ? String(t.assigned_staff_name) : null,
                    shiftType: String(t?.shift_type || t?.shiftType || 'ALL'),
                  }))
                  .filter((t: any) => t.id && t.name)
              : [];
            if (mounted && localTables.length) {
              const currentTables = stateRef.current.tables;
              const merged = mergeTablesPreservingAssignments(currentTables, localTables);
              setState((s) => ({ ...s, tables: merged }));
            }
          }
        } catch {
          // ignore
        }

        // 0) Hydrate from local SQLite cache (Electron) for fast startup + offline.
        try {
          if (electronApis.posListProducts) {
            const rows = await electronApis.posListProducts({ scopeKey, limit: 800 });
            const nextProducts = Array.isArray(rows)
              ? rows
                  .map((p: any) => ({
                    id: String(p?.id || ''),
                    code: String(p?.code || ''),
                    name: String(p?.name || ''),
                    price: Number(p?.price ?? 0) || 0,
                    category: String(p?.category || ''),
                    image: String(p?.image || ''),
                    stock: Number(p?.stock ?? 0) || 0,
                  }))
                  .filter((p: any) => p.id && p.name)
              : [];
            if (mounted && nextProducts.length) {
              setState((s) => ({ ...s, products: nextProducts }));
            }
          }
        } catch {
          // ignore
        }

        try {
          if (electronApis.posListOrders) {
            const baseOrders = await electronApis.posListOrders({ scopeKey, limit: 200 });
            const list = Array.isArray(baseOrders) ? baseOrders : [];

            const bundles: any[] = [];
            if (electronApis.posGetOrderBundle) {
              for (const o of list.slice(0, 100)) {
                const id = String(o?.id || '').trim();
                if (!id) continue;
                // eslint-disable-next-line no-await-in-loop
                const b = await electronApis.posGetOrderBundle({ scopeKey, orderId: id });
                if (b) bundles.push(b);
              }
            }

            const byId = new Map<string, any>();
            for (const b of bundles) {
              const oid = String(b?.order?.id || '').trim();
              if (!oid) continue;
              byId.set(oid, b);
            }

            const nextOrders: PosOrder[] = list
              .map((o: any) => {
                const id = String(o?.id || '').trim();
                if (!id) return null;
                const bundle = byId.get(id);
                const itemsRaw = Array.isArray(bundle?.items) ? bundle.items : [];
                const splitsRaw = Array.isArray(bundle?.splits) ? bundle.splits : [];
                const paymentsRaw = Array.isArray(bundle?.payments) ? bundle.payments : [];

                return {
                  id,
                  number: String(o?.display_number || o?.displayNumber || o?.number || id),
                  tableId: String(o?.table_id || o?.tableId || ''),
                  tableName: String(o?.table_name || o?.tableName || ''),
                  createdByStaffId: o?.created_by_staff_id ? String(o.created_by_staff_id) : undefined,
                  createdByName: o?.created_by_name ? String(o.created_by_name) : undefined,
                  items: itemsRaw.map((it: any) => ({
                    productId: String(it?.product_id || it?.productId || ''),
                    name: String(it?.name || ''),
                    unitPrice: Number(it?.unit_price ?? it?.unitPrice ?? 0) || 0,
                    qty: Number(it?.qty ?? 0) || 0,
                    voidedQty: Number(it?.voided_qty ?? it?.voidedQty ?? 0) || 0,
                    note: String(it?.note || ''),
                    voidReason: it?.void_reason ? String(it.void_reason) : undefined,
                  })),
                  subtotal: Number(o?.subtotal ?? 0) || 0,
                  tax: Number(o?.tax ?? 0) || 0,
                  serviceCharge: 0,
                  total: Number(o?.total ?? 0) || 0,
                  status: String(o?.status || 'Pending') as any,
                  createdAt: String(o?.created_at || o?.createdAt || new Date().toISOString()),
                  paidAt: o?.paid_at ? String(o.paid_at) : undefined,
                  paymentMethod: o?.payment_method ? String(o.payment_method) : undefined,
                  paymentReference: o?.payment_reference ? String(o.payment_reference) : undefined,
                  tenderedAmount: o?.tendered_amount != null ? Number(o.tendered_amount) : undefined,
                  notes: o?.notes ? String(o.notes) : undefined,
                  splits: splitsRaw as any,
                  syncedToServer: Number(o?.synced_to_server ?? o?.syncedToServer ?? 0) === 1,
                  syncedAt: String(o?.updated_at || o?.updatedAt || new Date().toISOString()),
                  tip: Number(o?.tip ?? 0) || 0,
                  discount: Number(o?.discount ?? 0) || 0,
                  // keep payments raw in payload-derived fields if needed
                  paidByStaffId: o?.paid_by_staff_id ? String(o.paid_by_staff_id) : undefined,
                  paidByName: o?.paid_by_name ? String(o.paid_by_name) : undefined,
                  customer: undefined,
                  inventoryDeducted: true,
                } as any;
              })
              .filter(Boolean) as any;

            if (mounted && nextOrders.length) {
              setState((s) => {
                const existing = new Map<string, PosOrder>();
                for (const o of s.orders) existing.set(o.id, o);
                const merged = nextOrders.map((o) => {
                  const prev = existing.get(o.id);
                  if (prev && (prev as any)?.syncedToServer === false) return prev;
                  return o;
                });
                return { ...s, orders: merged };
              });
            }
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [electronApis, isBranchUser]);

  const buildLocalOrderBundle = useCallback(
    (order: PosOrder) => {
      try {
        const itemsRaw = Array.isArray((order as any)?.items) ? ((order as any).items as any[]) : [];
        const splitsRaw = Array.isArray((order as any)?.splits) ? ((order as any).splits as any[]) : [];
        const paymentsRaw = Array.isArray((order as any)?.payments) ? ((order as any).payments as any[]) : [];

        const items = itemsRaw
          .map((it, idx) => {
            const name = String(it?.name || '').trim();
            if (!name) return null;
            return {
              id: String(it?.id || `${order.id}:item:${idx}`),
              productId: it?.productId ? String(it.productId) : it?.product_id ? String(it.product_id) : null,
              code: it?.code ? String(it.code) : it?.product_code ? String(it.product_code) : null,
              name,
              unitPrice: Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0) || 0,
              qty: Number(it?.qty ?? 0) || 0,
              taxAmount: Number(it?.taxAmount ?? it?.tax_amount ?? 0) || 0,
              discountAmount: Number(it?.discountAmount ?? it?.discount_amount ?? 0) || 0,
              note: it?.note ? String(it.note) : null,
              voidedQty: Number(it?.voidedQty ?? it?.voided_qty ?? 0) || 0,
              voidReason: it?.voidReason ? String(it.voidReason) : it?.void_reason ? String(it.void_reason) : null,
            };
          })
          .filter(Boolean) as any[];

        const splits = splitsRaw
          .map((s, idx) => {
            const id = String(s?.id || `${order.id}:split:${idx}`);
            if (!id.trim()) return null;
            return {
              id,
              mode: s?.mode ? String(s.mode) : s?.splitMode ? String(s.splitMode) : 'amount',
              amount: s?.amount != null ? Number(s.amount) : s?.targetAmount != null ? Number(s.targetAmount) : null,
              label: s?.label ? String(s.label) : null,
              status: s?.status ? String(s.status) : 'open',
              subtotal: Number(s?.subtotal || 0) || 0,
              tax: Number(s?.tax || 0) || 0,
              tip: Number(s?.tip || 0) || 0,
              discount: Number(s?.discount || 0) || 0,
              total: Number(s?.total || 0) || 0,
            };
          })
          .filter(Boolean) as any[];

        const splitItemsRaw = Array.isArray((order as any)?.splitItems) ? ((order as any).splitItems as any[]) : [];
        const splitItems = splitItemsRaw
          .map((si, idx) => {
            const splitId = String(si?.splitId || si?.split_id || '').trim();
            const orderItemId = String(si?.orderItemId || si?.order_item_id || '').trim();
            if (!splitId || !orderItemId) return null;
            return {
              id: String(si?.id || `${order.id}:split_item:${idx}`),
              splitId,
              orderItemId,
              qty: Number(si?.qty || 0) || 0,
            };
          })
          .filter(Boolean) as any[];

        const payments = paymentsRaw
          .map((p, idx) => {
            const method = String(p?.method || p?.paymentMethod || '').trim();
            if (!method) return null;
            return {
              id: String(p?.id || `${order.id}:payment:${idx}`),
              splitId: p?.splitId ? String(p.splitId) : p?.split_id ? String(p.split_id) : null,
              method,
              amount: Number(p?.amount || 0) || 0,
              currency: p?.currency ? String(p.currency) : 'ETB',
              reference: p?.reference ? String(p.reference) : p?.paymentReference ? String(p.paymentReference) : null,
              status: p?.status ? String(p.status) : 'confirmed',
              paidAt: p?.paidAt ? String(p.paidAt) : null,
              paidByStaffId: p?.paidByStaffId ? String(p.paidByStaffId) : null,
              paidByName: p?.paidByName ? String(p.paidByName) : null,
            };
          })
          .filter(Boolean) as any[];

        return { order, items, splits, splitItems, payments };
      } catch {
        return { order, items: [], splits: [], splitItems: [], payments: [] };
      }
    },
    [],
  );

  const upsertLocalOrderBundle = useCallback(
    (order: PosOrder) => {
      try {
        const scopeKey = getBranchScopeKey();
        if (!scopeKey) return;
        if (!electronApis.posUpsertOrderBundle) return;
        const bundle = buildLocalOrderBundle(order);
        void electronApis
          .posUpsertOrderBundle({ scopeKey, order: bundle.order, items: bundle.items, splits: bundle.splits, splitItems: bundle.splitItems, payments: bundle.payments })
          .catch(() => {
            // ignore
          });
      } catch {
        // ignore
      }
    },
    [electronApis, buildLocalOrderBundle],
  );

  const refreshFromServer = useCallback(async () => {
    try {
      if (!isBranchUser) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      const scopeKey = getBranchScopeKey();

      // 1) Refresh tables from DB
      try {
        const tres = await apiFetch(withBranchQuery('/api/pos/tables'));
        const tjson = (await tres.json().catch(() => null)) as any;
        if (tres.ok) {
          const rows = Array.isArray(tjson?.tables) ? (tjson.tables as any[]) : [];
          const incomingTables = toPosTables(rows);
          setState((s) => ({ ...s, tables: updateTableComputed(incomingTables, s.cartByTableId, s.draftMetaByTableId) }));
          if (scopeKey && incomingTables.length) writeBranchCache(scopeKey, { tables: incomingTables });
          if (scopeKey && incomingTables.length) void persistTablesToElectron(scopeKey, incomingTables);
        } else {
          // If tables are missing, try initialize then re-fetch.
          await apiFetch(withBranchQuery('/api/pos/initialize'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          const tres2 = await apiFetch(withBranchQuery('/api/pos/tables'));
          const tjson2 = (await tres2.json().catch(() => null)) as any;
          if (tres2.ok) {
            const rows2 = Array.isArray(tjson2?.tables) ? (tjson2.tables as any[]) : [];
            const incomingTables2 = toPosTables(rows2);
            setState((s) => ({ ...s, tables: updateTableComputed(incomingTables2, s.cartByTableId, s.draftMetaByTableId) }));
            if (scopeKey && incomingTables2.length) writeBranchCache(scopeKey, { tables: incomingTables2 });
            if (scopeKey && incomingTables2.length) void persistTablesToElectron(scopeKey, incomingTables2);
          }
        }
      } catch {
        // ignore
      }

      // 1b) Refresh authoritative menu products for waiter/manager ordering UI.
      // (POS state may not include full menu catalog; this keeps waiter menu in sync with manager-created items.)
      try {
        const res = await apiFetch(withBranchQuery('/api/pos/menu/products?limit=500'));
        const json = (await res.json().catch(() => null)) as any;
        if (res.ok) {
          const rows = Array.isArray(json?.products) ? (json.products as any[]) : [];
          const nextProducts = rows
            .map((p) => ({
              id: String(p?.id || ''),
              code: String(p?.code || ''),
              name: String(p?.name || ''),
              price: Number(p?.price ?? 0) || 0,
              category: String(p?.category || ''),
              image: String(p?.image || ''),
              stock: Number(p?.stock ?? 0) || 0,
              available: p?.available !== false,
              unavailableReason: typeof p?.unavailableReason === 'string' ? p.unavailableReason : '',
            }))
            .filter((p) => p.id && p.name);
          if (nextProducts.length) {
            setState((prev) => {
              const byId = new Map(nextProducts.map((p) => [p.id, p]));
              const nextCartByTableId: Record<string, PosOrderItem[]> = {};
              for (const [tableId, items] of Object.entries(prev.cartByTableId || {})) {
                const nextItems = (Array.isArray(items) ? items : [])
                  .map((it) => {
                    const pid = String(it?.productId || '').trim();
                    if (!pid) return null;
                    const prod = byId.get(pid);
                    if (!prod) return null;
                    if (prod.available === false) return null;
                    return {
                      ...it,
                      name: prod.name,
                      unitPrice: Number(prod.price ?? it.unitPrice ?? 0) || 0,
                    };
                  })
                  .filter(Boolean) as PosOrderItem[];
                if (nextItems.length) nextCartByTableId[tableId] = nextItems;
              }

              const tables = updateTableComputed(prev.tables, nextCartByTableId, prev.draftMetaByTableId);
              return { ...prev, products: nextProducts, cartByTableId: nextCartByTableId, tables };
            });
          }

          try {
            const scopeKey = getBranchScopeKey();
            if (scopeKey && electronApis.posUpsertProducts && nextProducts.length) {
              void electronApis
                .posUpsertProducts({ scopeKey, products: nextProducts })
                .catch(() => {
                  // ignore
                });
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      // 2) Refresh authoritative orders list from DB
      try {
        const res = await apiFetch(withBranchQuery('/api/pos/orders?limit=200&light=1'));
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as any;
        const rows = Array.isArray(json?.orders) ? (json.orders as any[]) : [];

        const serverOrders: PosOrder[] = rows
          .map((r) => {
            const id = String(r?.id || '');
            const status = String(r?.status || 'Pending') as any;
            const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};

            const orderTypeRaw = String((payload as any)?.orderType ?? (payload as any)?.order_type ?? '').trim();
            const orderType = orderTypeRaw === 'takeaway' ? 'takeaway' : orderTypeRaw === 'dine_in' ? 'dine_in' : undefined;
            const takeawayFee = orderType === 'takeaway' ? Math.max(0, Number((payload as any)?.takeawayFee ?? (payload as any)?.takeaway_fee ?? 0) || 0) : 0;

            const createdAt = typeof r?.createdAt === 'string' && r.createdAt ? r.createdAt : typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString();
            const number = typeof payload?.number === 'string' && payload.number ? payload.number : id;
            const tableId = typeof payload?.tableId === 'string' ? payload.tableId : '';
            const tableName = typeof payload?.tableName === 'string' ? payload.tableName : '';
            const items = Array.isArray(payload?.items) ? (payload.items as any[]) : [];

            const tipFromBreakdown =
              (Number(payload?.tipAmount ?? 0) || 0) + (Number(payload?.tipPctAmount ?? 0) || 0);
            const tip = Number(r?.tip ?? payload?.tip ?? tipFromBreakdown ?? 0) || 0;

            // Recalculate tax/service based on CURRENT settings (not server values)
            const pricing = readPricingSettings();
            const serverSubtotal = Number(payload?.subtotal ?? 0) || 0;
            const tax = pricing.vatEnabled ? serverSubtotal * (pricing.vatRate / 100) : 0;
            const serviceCharge = pricing.serviceEnabled ? serverSubtotal * (pricing.serviceRate / 100) : 0;
            const total = serverSubtotal + tax + serviceCharge + tip;
            const discount = Number(r?.discount ?? payload?.discount ?? 0) || 0;
            const subtotal = serverSubtotal;

            const paidAt = typeof r?.paidAt === 'string' && r.paidAt ? r.paidAt : typeof payload?.paidAt === 'string' ? payload.paidAt : null;
            const voidedAt = typeof payload?.voidedAt === 'string' ? payload.voidedAt : null;
            const voidReason = typeof payload?.voidReason === 'string' ? payload.voidReason : '';

            const paymentMethod = typeof payload?.paymentMethod === 'string' ? payload.paymentMethod : '';
            const paymentReference = typeof payload?.paymentReference === 'string' ? payload.paymentReference : '';

            const paidByStaffId = typeof payload?.paidByStaffId === 'string' ? payload.paidByStaffId : '';
            const paidByName = typeof payload?.paidByName === 'string' ? payload.paidByName : '';

            return {
              id,
              number,
              tableId,
              tableName,
              orderType,
              takeawayFee,
              createdByStaffId: typeof payload?.createdByStaffId === 'string' ? payload.createdByStaffId : undefined,
              createdByName: typeof payload?.createdByName === 'string' ? payload.createdByName : undefined,
              items: items.map((it) => ({
                productId: String((it as any)?.productId || ''),
                name: String((it as any)?.name || ''),
                unitPrice: Number((it as any)?.unitPrice ?? (it as any)?.price ?? 0) || 0,
                qty: Number((it as any)?.qty ?? 0) || 0,
                voidedQty: typeof (it as any)?.voidedQty === 'number' ? (it as any).voidedQty : 0,
                note: typeof (it as any)?.note === 'string' ? (it as any).note : '',
                voidReason: typeof (it as any)?.voidReason === 'string' ? (it as any).voidReason : undefined,
              })),
              subtotal,
              tax,
              serviceCharge,
              total,
              status,
              createdAt,
              timeLabel: String((r as any)?.timeLabel || (payload as any)?.timeLabel || ''),
              notes: typeof payload?.notes === 'string' ? payload.notes : undefined,
              paidAt: paidAt ? String(paidAt) : undefined,
              paymentMethod: paymentMethod || undefined,
              tenderedAmount: typeof payload?.tenderedAmount === 'number' ? payload.tenderedAmount : undefined,
              paymentReference: paymentReference || undefined,
              paidByStaffId: paidByStaffId || undefined,
              paidByName: paidByName || undefined,
              syncedToServer: true,
              syncedAt: new Date().toISOString(),
              voidedAt: voidedAt ? String(voidedAt) : undefined,
              voidReason: voidReason || undefined,
              customer: payload?.customer && typeof payload.customer === 'object' ? (payload.customer as any) : undefined,
              splits: Array.isArray(payload?.splits) ? (payload.splits as any) : undefined,
              inventoryDeducted: true,
              // keep numerical fields used elsewhere
              tip: Number((r as any)?.tip ?? (payload as any)?.tip ?? tipFromBreakdown ?? 0) || 0,
              discount,
            } as any;
          })
          .filter((o) => o.id);

        let selectedMissingId: string | null = null;

        setState((prev) => {
          const localById = new Map<string, PosOrder>();
          for (const o of prev.orders) localById.set(o.id, o);

          const mergedFromServer = serverOrders.map((so) => {
            const lo = localById.get(so.id);
            if (lo && (lo as any)?.syncedToServer === false) {
              const localStatus = String((lo as any)?.status || '');
              const serverStatus = String((so as any)?.status || '');
              const localTerminal = localStatus === 'Paid' || localStatus === 'Voided' || localStatus === 'Refunded';

              // If local says the order is terminal but the server disagrees, trust the server.
              // This prevents stale optimistic payment updates from blocking payment UI.
              if (localTerminal && serverStatus && serverStatus !== localStatus) return so;
              return lo;
            }
            return so;
          });

          const serverIds = new Set(serverOrders.map((o) => o.id));
          const unsyncedLocal = prev.orders.filter((o) => (o as any)?.syncedToServer === false && !serverIds.has(o.id));
          const mergedOrders = [...mergedFromServer, ...unsyncedLocal];

          const orderById = new Map<string, PosOrder>();
          for (const o of mergedOrders) orderById.set(o.id, o);

          const sel = prev.selectedOrderId ? String(prev.selectedOrderId) : '';
          if (sel && !orderById.has(sel)) selectedMissingId = sel;

          const openOrderByTableId = new Map<string, string>();
          for (const o of mergedOrders) {
            if (!o || typeof o !== 'object') continue;
            const st = String((o as any).status || '');
            if (st === 'Paid' || st === 'Voided' || st === 'Refunded') continue;
            const tableId = String((o as any).tableId || '').trim();
            if (!tableId) continue;
            // Keep the most recently created order as the open one.
            const prevId = openOrderByTableId.get(tableId);
            if (!prevId) {
              openOrderByTableId.set(tableId, o.id);
              continue;
            }
            const prevOrder = orderById.get(prevId);
            const a = String((prevOrder as any)?.createdAt || '');
            const b = String((o as any)?.createdAt || '');
            if (b && (!a || b > a)) openOrderByTableId.set(tableId, o.id);
          }

          const nextTables = prev.tables.map((t) => {
            const tid = String((t as any)?.id || '').trim();
            if (!tid) return t;

            const serverOpenId = openOrderByTableId.get(tid) || null;
            const currentOpenId = (t as any).openOrderId ? String((t as any).openOrderId) : null;
            const openId = serverOpenId || currentOpenId;

            if (!openId) {
              if ((t as any).status === 'Free' && !(t as any).openOrderId) return t;
              return { ...t, status: 'Free', openOrderId: null } as any;
            }

            const o = orderById.get(openId);
            const st = String((o as any)?.status || '');
            if (st === 'Paid' || st === 'Voided' || st === 'Refunded') {
              return { ...t, status: 'Free', openOrderId: null, lastOrderId: openId } as any;
            }
            if (st === 'Served') {
              return { ...t, status: 'Payment', openOrderId: openId } as any;
            }
            return { ...t, status: 'Occupied', openOrderId: openId } as any;
          });

          return { ...prev, orders: mergedOrders, tables: updateTableComputed(nextTables as any, prev.cartByTableId, prev.draftMetaByTableId) };
        });

        // If the user is on an order details screen and the selected order is not in the latest
        // list (limit=200), fetch it explicitly so refresh keeps the page open.
        if (selectedMissingId) {
          try {
            const single = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(selectedMissingId)}`));
            const singleJson = (await single.json().catch(() => null)) as any;
            if (single.ok) {
              const r = singleJson?.order || singleJson;
              if (r && typeof r === 'object') {
                const id = String(r?.id || '');
                const status = String(r?.status || 'Pending') as any;
                const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};

                const orderTypeRaw = String((payload as any)?.orderType ?? (payload as any)?.order_type ?? '').trim();
                const orderType = orderTypeRaw === 'takeaway' ? 'takeaway' : orderTypeRaw === 'dine_in' ? 'dine_in' : undefined;
                const takeawayFee = orderType === 'takeaway' ? Math.max(0, Number((payload as any)?.takeawayFee ?? (payload as any)?.takeaway_fee ?? 0) || 0) : 0;

                const createdAt = typeof r?.createdAt === 'string' && r.createdAt ? r.createdAt : typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString();
                const number = typeof payload?.number === 'string' && payload.number ? payload.number : id;
                const tableId = typeof payload?.tableId === 'string' ? payload.tableId : '';
                const tableName = typeof payload?.tableName === 'string' ? payload.tableName : '';
                const items = Array.isArray(payload?.items) ? (payload.items as any[]) : [];

                const tipFromBreakdown = (Number(payload?.tipAmount ?? 0) || 0) + (Number(payload?.tipPctAmount ?? 0) || 0);
                const tip = Number(r?.tip ?? payload?.tip ?? tipFromBreakdown ?? 0) || 0;

                // Recalculate tax/service based on CURRENT settings (not server values)
                const pricing = readPricingSettings();
                const serverSubtotal = Number(payload?.subtotal ?? 0) || 0;
                const tax = pricing.vatEnabled ? serverSubtotal * (pricing.vatRate / 100) : 0;
                const serviceCharge = pricing.serviceEnabled ? serverSubtotal * (pricing.serviceRate / 100) : 0;
                const total = serverSubtotal + tax + serviceCharge + tip;
                const discount = Number(r?.discount ?? payload?.discount ?? 0) || 0;
                const subtotal = serverSubtotal;

                const paidAt = typeof r?.paidAt === 'string' && r.paidAt ? r.paidAt : typeof payload?.paidAt === 'string' ? payload.paidAt : null;
                const voidedAt = typeof payload?.voidedAt === 'string' ? payload.voidedAt : null;
                const voidReason = typeof payload?.voidReason === 'string' ? payload.voidReason : '';

                const paymentMethod = typeof payload?.paymentMethod === 'string' ? payload.paymentMethod : '';
                const paymentReference = typeof payload?.paymentReference === 'string' ? payload.paymentReference : '';

                const paidByStaffId = typeof payload?.paidByStaffId === 'string' ? payload.paidByStaffId : '';
                const paidByName = typeof payload?.paidByName === 'string' ? payload.paidByName : '';

                const nextOrder: PosOrder = {
                  id,
                  number,
                  tableId,
                  tableName,
                  orderType,
                  takeawayFee,
                  createdByStaffId: typeof payload?.createdByStaffId === 'string' ? payload.createdByStaffId : undefined,
                  createdByName: typeof payload?.createdByName === 'string' ? payload.createdByName : undefined,
                  items: items.map((it) => ({
                    productId: String((it as any)?.productId || ''),
                    name: String((it as any)?.name || ''),
                    unitPrice: Number((it as any)?.unitPrice ?? (it as any)?.price ?? 0) || 0,
                    qty: Number((it as any)?.qty ?? 0) || 0,
                    voidedQty: typeof (it as any)?.voidedQty === 'number' ? (it as any).voidedQty : 0,
                    note: typeof (it as any)?.note === 'string' ? (it as any).note : '',
                    voidReason: typeof (it as any)?.voidReason === 'string' ? (it as any).voidReason : undefined,
                  })),
                  subtotal,
                  tax,
                  serviceCharge,
                  total,
                  status,
                  createdAt,
                  timeLabel: String((r as any)?.timeLabel || (payload as any)?.timeLabel || ''),
                  notes: typeof payload?.notes === 'string' ? payload.notes : undefined,
                  paidAt: paidAt ? String(paidAt) : undefined,
                  paymentMethod: paymentMethod || undefined,
                  tenderedAmount: typeof payload?.tenderedAmount === 'number' ? payload.tenderedAmount : undefined,
                  paymentReference: paymentReference || undefined,
                  paidByStaffId: paidByStaffId || undefined,
                  paidByName: paidByName || undefined,
                  syncedToServer: true,
                  syncedAt: new Date().toISOString(),
                  voidedAt: voidedAt ? String(voidedAt) : undefined,
                  voidReason: voidReason || undefined,
                  customer: payload?.customer && typeof payload.customer === 'object' ? (payload.customer as any) : undefined,
                  splits: Array.isArray(payload?.splits) ? (payload.splits as any) : undefined,
                  inventoryDeducted: true,
                  tip,
                  discount,
                } as any;

                setState((prev) => {
                  const exists = prev.orders.some((o) => o.id === nextOrder.id);
                  if (exists) return prev;
                  return { ...prev, orders: [nextOrder, ...prev.orders] };
                });
              }
            }
          } catch {
            // ignore
          }
        }

        try {
          const scopeKey = getBranchScopeKey();
          if (scopeKey && electronApis.posUpsertOrderBundle && serverOrders.length) {
            for (const o of serverOrders.slice(0, 200)) {
              const bundle = buildLocalOrderBundle({ ...o, syncedToServer: true } as any);
              // eslint-disable-next-line no-await-in-loop
              void electronApis
                .posUpsertOrderBundle({ scopeKey, order: bundle.order, items: bundle.items, splits: bundle.splits, splitItems: bundle.splitItems, payments: bundle.payments })
                .catch(() => {
                  // ignore
                });
            }
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, [isBranchUser, electronApis, buildLocalOrderBundle, persistTablesToElectron]);

  useEffect(() => {
    if (!isBranchUser) return;

    const close = () => {
      try {
        const cur = realtimeRef.current;
        if (cur.retryTimer) window.clearTimeout(cur.retryTimer);
        cur.retryTimer = null;
        if (cur.es) cur.es.close();
        cur.es = null;
      } catch {
        // ignore
      }

      try {
        setRealtimeStatus((s) => ({ ...s, connected: false }));
      } catch {
        // ignore
      }
    };

    const connect = () => {
      try {
        close();

        if (typeof navigator !== 'undefined' && !navigator.onLine) return;

        const sess = readSession<any>();
        const token = typeof sess?.token === 'string' ? sess.token : '';
        const tenantSlug = typeof sess?.tenantSlug === 'string' ? sess.tenantSlug : typeof sess?.tenant?.slug === 'string' ? sess.tenant.slug : '';
        const branchId = getEffectiveBranchIdForApi();

        if (!token || !tenantSlug) return;

        const base = (() => {
          try {
            const w = window as any;
            const cfg = w?.mirachpos?.config;
            const s = typeof cfg?.apiBase === 'string' ? cfg.apiBase.trim() : '';
            if (s) return s.replace(/\/+$/, '');
          } catch {
            // ignore
          }
          try {
            if (typeof window !== 'undefined' && window.location?.protocol === 'file:') return 'https://apa.mirachpos.com';
          } catch {
            // ignore
          }
          return '';
        })();

        const path = `/api/realtime/pos?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(String(tenantSlug).trim().toLowerCase())}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`;
        const url = base ? `${base}${path}` : path;
        const es = new EventSource(url);
        realtimeRef.current.es = es;

        try {
          setRealtimeStatus((s) => ({ ...s, connected: true }));
        } catch {
          // ignore
        }

        const onPos = () => {
          try {
            const now = Date.now();
            if (now - lastRefreshAtRef.current < 1500) return;
            lastRefreshAtRef.current = now;
            void refreshFromServer();
          } catch {
            // ignore
          }
        };

        es.addEventListener('pos', onPos as any);
        es.addEventListener('ready', () => {
          // initial sync
          onPos();
        });

        es.onerror = () => {
          try {
            try {
              setRealtimeStatus({ connected: false, lastErrorAt: new Date().toISOString(), lastError: 'sse_error' });
            } catch {
              // ignore
            }

            try {
              // Helpful for debugging Electron/browser connectivity issues
              // eslint-disable-next-line no-console
              console.warn('[realtime] SSE error; reconnecting...');
            } catch {
              // ignore
            }
            close();
            realtimeRef.current.retryTimer = window.setTimeout(() => {
              connect();
            }, 2500);
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore
      }
    };

    const onOnline = () => connect();
    connect();

    try {
      window.addEventListener('online', onOnline);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener('online', onOnline);
      } catch {
        // ignore
      }
      close();
    };
  }, [isBranchUser, refreshFromServer]);

  useEffect(() => {
    if (!isBranchUser) return;

    const tryRefresh = () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const now = Date.now();
        if (now - lastRefreshAtRef.current < 2500) return;
        lastRefreshAtRef.current = now;
        void refreshFromServer();
      } catch {
        // ignore
      }
    };

    const onOnline = () => tryRefresh();
    const onFocus = () => tryRefresh();
    const onVisibility = () => {
      try {
        if (document.visibilityState === 'visible') tryRefresh();
      } catch {
        // ignore
      }
    };

    try {
      window.addEventListener('online', onOnline);
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    } catch {
      // ignore
    }

    return () => {
      try {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      } catch {
        // ignore
      }
    };
  }, [isBranchUser, refreshFromServer]);

  const persistOrder = useCallback(
    async (order: PosOrder) => {
      if (!isBranchUser) return false;

      const tip = Number((order as any)?.tip ?? 0) || 0;
      const discount = Number((order as any)?.discount ?? 0) || 0;

      const payload = {
        id: order.id,
        status: order.status,
        total: order.total,
        tax: order.tax,
        tip,
        discount,
        payload: {
          number: order.number,
          tableId: order.tableId,
          tableName: order.tableName,
          orderType: (order as any).orderType ?? null,
          takeawayFee: Number((order as any).takeawayFee ?? 0) || 0,
          items: order.items,
          subtotal: order.subtotal,
          tax: order.tax,
          serviceCharge: order.serviceCharge,
          total: order.total,
          createdAt: order.createdAt,
          paidAt: order.paidAt ?? null,
          createdByStaffId: order.createdByStaffId ?? null,
          createdByName: order.createdByName ?? null,
          paidByStaffId: (order as any).paidByStaffId ?? null,
          paidByName: (order as any).paidByName ?? null,
          paymentMethod: (order as any).paymentMethod ?? null,
          tenderedAmount: (order as any).tenderedAmount ?? null,
          paymentReference: (order as any).paymentReference ?? null,
          splits: (order as any).splits ?? null,
          notes: (order as any).notes ?? null,
          customer: (order as any).customer ?? null,
        },
      };

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        void enqueueOutboxHttp({
          url: withBranchQuery('/api/pos/orders'),
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
        });
        return false;
      }
      if (!remoteReady) return false;

      const shouldCreate = order.syncedToServer === false;
      if (shouldCreate) {
        try {
          const postRes = await apiFetch(withBranchQuery('/api/pos/orders'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (postRes.ok) return true;
          // If POST fails with 400/409, order might already exist - try PUT instead
          if (postRes.status === 400 || postRes.status === 409) {
            // Try PUT immediately
            try {
              const putRes = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(order.id)}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (putRes.ok) return true;
            } catch {
              // PUT failed too, fall through to outbox
            }
          }
          // For other errors, enqueue for retry
          void enqueueOutboxHttp({
            url: withBranchQuery('/api/pos/orders'),
            method: 'POST',
            body: payload,
            headers: { 'Content-Type': 'application/json' },
          });
          return false;
        } catch {
          void enqueueOutboxHttp({
            url: withBranchQuery('/api/pos/orders'),
            method: 'POST',
            body: payload,
            headers: { 'Content-Type': 'application/json' },
          });
          return false;
        }
      }
      // For updates (syncedToServer === true), use PUT
      try {
        const putRes = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(order.id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (putRes.ok) return true;
        if (putRes.status !== 404) return false;
      } catch {
        // ignore
      }

      try {
        const putRes = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(order.id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (putRes.ok) return true;
        if (putRes.status !== 404) return false;
      } catch {
        void enqueueOutboxHttp({
          url: withBranchQuery('/api/pos/orders'),
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
        });
        return false;
      }

      try {
        const postRes = await apiFetch(withBranchQuery('/api/pos/orders'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return postRes.ok;
      } catch {
        void enqueueOutboxHttp({
          url: withBranchQuery('/api/pos/orders'),
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
        });
        return false;
      }
    },
    [enqueueOutboxHttp, isBranchUser, remoteReady],
  );

  // On Manager/Waiter login: load the branch-scoped POS state from the API.
  useEffect(() => {
    if (!isBranchUser) return;
    let mounted = true;
    const run = async () => {
      try {
        const scopeKey = getBranchScopeKey();

        // Legacy pos_state JSON hydration removed. Electron offline now hydrates from
        // normalized SQLite tables (products + order bundles).

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          if (!mounted) return;
          setRemoteReady(true);
          return;
        }

        // Use the same routine as the in-app "Refresh" button so full reload and refresh behave identically.
        await refreshFromServer();
        if (!mounted) return;
        setRemoteReady(true);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [isBranchUser, refreshFromServer]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isBranchUser) return;
    const scopeKey = getBranchScopeKey();
    if (!scopeKey) return;
    if (!electronApis.outboxStats) return;

    let mounted = true;
    const run = async () => {
      try {
        const res = await electronApis.outboxStats!({ scopeKey, stuckAfter: 8 });
        if (!mounted) return;
        if (!res || res.ok !== true) return;
        setOutboxStatus({
          total: Number(res.total || 0) || 0,
          ready: Number(res.ready || 0) || 0,
          maxAttempts: Number(res.maxAttempts || 0) || 0,
          nextAttemptAtMin: typeof res.nextAttemptAtMin === 'string' ? res.nextAttemptAtMin : '',
          stuck: Number(res.stuck || 0) || 0,
          stuckAfter: Number(res.stuckAfter || 8) || 8,
        });
      } catch {
        // ignore
      }
    };

    void run();
    const id = window.setInterval(() => {
      void run();
    }, 5000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [isBranchUser, sessionRev, electronApis.outboxStats]);

  useEffect(() => {
    const trySync = async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (!isBranchUser) {
          // Local demo sync: mark locally as synced
          setState((s) => {
            const hasUnsynced = s.orders.some((o) => o.syncedToServer === false);
            if (!hasUnsynced) return s;
            const now = new Date().toISOString();
            return {
              ...s,
              orders: s.orders.map((o) => (o.syncedToServer === false ? { ...o, syncedToServer: true, syncedAt: now } : o)),
            };
          });
          return;
        }

        if (!remoteReady) return;

        const scopeKey = getBranchScopeKey();
        const canOutbox = !!(electronApis.outboxListReady && electronApis.outboxAck && electronApis.outboxBump);

        if (canOutbox && scopeKey) {
          try {
            const pending = await electronApis.outboxListReady!({ scopeKey, limit: 25 });
            if (Array.isArray(pending) && pending.length > 0) {
              const ackIds: string[] = [];
              for (const item of pending) {
                const id = typeof item?.id === 'string' ? item.id : '';
                const payload = item?.payload;
                const kind = typeof item?.kind === 'string' ? String(item.kind) : '';
                if (!id) continue;
                try {
                  let res: Response | null = null;

                  if (kind === 'http') {
                    const url = typeof payload?.url === 'string' ? payload.url : '';
                    const method = typeof payload?.method === 'string' ? payload.method : '';
                    const body = payload?.body;
                    const headers = payload?.headers && typeof payload.headers === 'object' ? payload.headers : {};

                    const hdrs: Record<string, string> = { ...(headers || {}) };
                    const hasBody = body !== undefined;
                    if (hasBody && !hdrs['Content-Type'] && !hdrs['content-type']) hdrs['Content-Type'] = 'application/json';

                    res = await apiFetch(withBranchQuery(url), {
                      method,
                      headers: hdrs,
                      body: hasBody ? JSON.stringify(body ?? null) : undefined,
                    });
                  } else if (kind === 'print.html') {
                    const html = typeof payload?.html === 'string' ? payload.html : '';
                    const deviceName = typeof payload?.deviceName === 'string' ? payload.deviceName : '';
                    if (!electronApis.printersPrintHtml) {
                      const delayMs = bumpDelayMsForAttempts(Number(item?.attempts || 0) || 0);
                      await electronApis.outboxBump!({ id, delayMs });
                      continue;
                    }
                    await electronApis.printersPrintHtml({ html, deviceName, silent: true });
                    ackIds.push(id);
                    continue;
                  } else if (kind === 'pos.state') {
                    // Deprecated legacy behavior.
                    // We no longer sync whole POS JSON state to the server.
                    const delayMs = bumpDelayMsForAttempts(Number(item?.attempts || 0) || 0);
                    await electronApis.outboxBump!({ id, delayMs });
                    continue;
                  } else {
                    const delayMs = bumpDelayMsForAttempts(Number(item?.attempts || 0) || 0);
                    await electronApis.outboxBump!({ id, delayMs });
                    continue;
                  }
                  if (!res.ok) {
                    const delayMs = bumpDelayMsForAttempts(Number(item?.attempts || 0) || 0);
                    await electronApis.outboxBump!({ id, delayMs });
                    continue;
                  }
                  ackIds.push(id);
                } catch {
                  const delayMs = bumpDelayMsForAttempts(Number(item?.attempts || 0) || 0);
                  await electronApis.outboxBump!({ id, delayMs });
                }
              }
              if (ackIds.length > 0) {
                await electronApis.outboxAck!({ ids: ackIds });
              }
            }
          } catch {
            // ignore
          }
        }

        const snapshot = stateRef.current;

        // Persist unsynced orders to DB (so owner dashboard reflects them).
        const unsyncedOrders = snapshot.orders.filter((o) => o.syncedToServer === false).slice(0, 10);
        for (const o of unsyncedOrders) {
          const ok = await persistOrder(o);
          if (!ok) continue;
          const now = new Date().toISOString();
          setState((s) => ({
            ...s,
            orders: s.orders.map((x) => (x.id === o.id ? { ...x, syncedToServer: true, syncedAt: now } : x)),
          }));
        }

        // Note: We no longer persist whole POS JSON state to the server.
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void trySync();
    }, 4000);
    const onOnline = () => {
      void trySync();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, [isBranchUser, remoteReady, persistOrder]);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of state.products) map.set(p.id, p);
    return map;
  }, [state.products]);

  const syncStateNow = useCallback(
    (snapshot: PersistedState) => {
      void (async () => {
        try {
          if (typeof navigator !== 'undefined' && !navigator.onLine) return;
          if (!isBranchUser) return;

          const scopeKey = getBranchScopeKey();
          if (!scopeKey) return;

          // Don't block state persistence on remoteReady; if the server is reachable, persist now.
          // If persistence fails, fall back to Electron outbox.

          // Deprecated: we no longer sync whole POS JSON state to the server.
        } catch {
          // ignore
        }
      })();
    },
    [electronApis, isBranchUser, remoteReady],
  );

  const persistOrderNow = useCallback(
    (orderId: string) => {
      const order = state.orders.find((o) => o.id === orderId);
      if (!order) return;
      void persistOrder(order);
    },
    [persistOrder, state.orders],
  );

  const updateTableComputed = (
    tables: PosTable[],
    cartByTableId: Record<string, PosOrderItem[]>,
    draftMetaByTableId: PersistedState['draftMetaByTableId'],
  ) => {
    return tables.map((t) => {
      const cartItems = cartByTableId[t.id] ?? [];
      const subtotal = calcSubtotal(cartItems);
      const meta = draftMetaByTableId?.[t.id] || {};
      const isTakeaway = meta?.orderType === 'takeaway';
      const takeawayFee = isTakeaway ? Math.max(0, Number(meta?.takeawayFee ?? 0) || 0) : 0;
      return {
        ...t,
        cartItemCount: cartItems.reduce((sum, i) => sum + i.qty, 0),
        currentTotal: calcTotal(subtotal) + takeawayFee,
      };
    });
  };

  const getDraftOrderMeta: PosContextType['getDraftOrderMeta'] = (tableId) => {
    const tid = String(tableId || '').trim();
    if (!tid) return {};
    const meta = state.draftMetaByTableId?.[tid] || {};
    return {
      orderType: meta?.orderType === 'takeaway' ? 'takeaway' : meta?.orderType === 'dine_in' ? 'dine_in' : undefined,
      takeawayFee: meta?.takeawayFee == null ? undefined : Math.max(0, Number(meta.takeawayFee) || 0),
    };
  };

  const setDraftOrderMeta: PosContextType['setDraftOrderMeta'] = (tableId, meta) => {
    const tid = String(tableId || '').trim();
    if (!tid) return;
    const otRaw = meta?.orderType;
    const orderType = otRaw === 'takeaway' || otRaw === 'dine_in' ? otRaw : undefined;
    const takeawayFee = meta?.takeawayFee == null ? undefined : Math.max(0, Number(meta.takeawayFee) || 0);

    setState((s) => {
      const prev = s.draftMetaByTableId?.[tid] || {};
      const nextMeta = { ...prev, ...(orderType ? { orderType } : {}), ...(takeawayFee != null ? { takeawayFee } : {}) };
      const nextDraft = { ...(s.draftMetaByTableId || {}), [tid]: nextMeta };
      return { ...s, draftMetaByTableId: nextDraft, tables: updateTableComputed(s.tables, s.cartByTableId, nextDraft) };
    });
  };

  const addTable = (table: { id?: string; name: string; seats: number; area?: PosTable['area']; shiftType?: 'DAY' | 'NIGHT' | 'ALL'; assignedStaffId?: string | null; assignedStaffName?: string | null }) => {
    const id = table.id || generateId();
    const isUpdate = !!table.id;
    setState((s) => {
      // If updating, replace existing table; otherwise add new
      const existingTables = isUpdate ? s.tables.filter((t) => t.id !== id) : s.tables;
      const nextTables = updateTableComputed(
        [
          {
            id,
            name: table.name,
            area: table.area,
            status: 'Free',
            seats: table.seats,
            openOrderId: null,
            cartItemCount: 0,
            currentTotal: 0,
            assignedStaffId: table.assignedStaffId ?? null,
            assignedStaffName: table.assignedStaffName ?? null,
            shiftType: table.shiftType || 'ALL',
          },
          ...existingTables,
        ],
        s.cartByTableId,
        s.draftMetaByTableId,
      );
      const nextState = { ...s, tables: nextTables };
      return nextState;
    });

    queueMicrotask(() => {
      const url = withBranchQuery('/api/pos/tables');
      const body = { 
        id, 
        name: table.name, 
        seats: table.seats, 
        area: table.area ?? null, 
        shiftType: table.shiftType || 'ALL',
        assignedStaffId: table.assignedStaffId ?? null,
        assignedStaffName: table.assignedStaffName ?? null
      };
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        void enqueueOutboxHttp({ url, method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
        return;
      }

      void apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {
        void enqueueOutboxHttp({ url, method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      });
    });
    return id;
  };

  const deleteTable: PosContextType['deleteTable'] = (tableId) => {
    const id = String(tableId || '').trim();
    if (!id) return;

    queueMicrotask(() => {
      const url = withBranchQuery(`/api/pos/tables/${encodeURIComponent(id)}`);
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        void enqueueOutboxHttp({ url, method: 'DELETE' });
        return;
      }
      void apiFetch(url, { method: 'DELETE' }).catch(() => {
        void enqueueOutboxHttp({ url, method: 'DELETE' });
      });
    });
    setState((s) => {
      if (!s.tables.some((t) => t.id === id)) return s;

      const nextCartByTableId = { ...s.cartByTableId };
      delete nextCartByTableId[id];

      const nextTables = updateTableComputed(
        s.tables.filter((t) => t.id !== id),
        nextCartByTableId,
        s.draftMetaByTableId,
      );

      const nextState = {
        ...s,
        tables: nextTables,
        cartByTableId: nextCartByTableId,
        selectedTableId: s.selectedTableId === id ? null : s.selectedTableId,
      };
      return nextState;
    });
  };

  const setTableAssignment = (tableIds: string[], staffId: string | null, staffNameInput?: string | null) => {
    setState((s) => {
      if (!Array.isArray(tableIds) || tableIds.length === 0) return s;
      const preferred = typeof staffNameInput === 'string' ? staffNameInput.trim() : '';
      const lookedUp = staffId ? resolveStaffName(staffId) : '';
      const resolved = preferred || lookedUp;
      const staffName = staffId && resolved && resolved.toLowerCase() !== 'waiter' ? resolved : null;
      const nextTables = updateTableComputed(
        s.tables.map((t) => (tableIds.includes(t.id) ? { ...t, assignedStaffId: staffId, assignedStaffName: staffId ? staffName : null } : t)),
        s.cartByTableId,
        s.draftMetaByTableId,
      );
      const nextState = { ...s, tables: nextTables };
      return nextState;
    });

    queueMicrotask(() => {
      const staffName = (() => {
        const preferred = typeof staffNameInput === 'string' ? staffNameInput.trim() : '';
        const lookedUp = staffId ? resolveStaffName(staffId) : '';
        const resolved = preferred || lookedUp;
        return staffId && resolved && resolved.toLowerCase() !== 'waiter' ? resolved : null;
      })();

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;

      void Promise.all(
        (Array.isArray(tableIds) ? tableIds : []).map((id) =>
          (async () => {
            const url = withBranchQuery(`/api/pos/tables/${encodeURIComponent(id)}/assign`);
            const body = { assignedStaffId: staffId, assignedStaffName: staffId ? staffName : null };
            if (offline) {
              await enqueueOutboxHttp({ url, method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
              return;
            }
            try {
              const res = await apiFetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error('request_failed');
            } catch {
              await enqueueOutboxHttp({ url, method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
            }
          })(),
        ),
      );
    });
  };

  const selectTable = (tableId: string | null) => {
    setState((s) => ({ ...s, selectedTableId: tableId }));
    try {
      if (!uiScopeKey) return;
      writeUiState(uiScopeKey, { selectedTableId: tableId });
    } catch {
      // ignore
    }
  };

  const selectOrder = (orderId: string | null) => {
    setState((s) => ({ ...s, selectedOrderId: orderId }));
    try {
      if (!uiScopeKey) return;
      writeUiState(uiScopeKey, { selectedOrderId: orderId });
    } catch {
      // ignore
    }
  };

  const getCartItems = (tableId: string) => state.cartByTableId[tableId] ?? [];

  const addToCart = (tableId: string, productId: string) => {
    setState((s) => {
      const product = s.products.find((p) => p.id === productId);
      if (!product || product.stock <= 0) return s;
      if ((product as any)?.available === false) return s;

      const existing = s.cartByTableId[tableId] ?? [];
      const idx = existing.findIndex((i) => i.productId === productId);
      let nextItems: PosOrderItem[];
      if (idx >= 0) {
        nextItems = existing.map((i) =>
          i.productId === productId
            ? {
                ...i,
                qty: i.qty + 1,
                unitPrice: Number(product.price ?? i.unitPrice ?? 0) || 0,
                name: product.name,
              }
            : i,
        );
      } else {
        nextItems = [...existing, { productId, name: product.name, unitPrice: Number(product.price ?? 0) || 0, qty: 1, modifiers: [] }];
      }

      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);

      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const setCartItemNote = (tableId: string, productId: string, note: string) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      const nextItems = existing.map((i) => (i.productId === productId ? { ...i, note } : i));
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const setCartItemModifiers: PosContextType['setCartItemModifiers'] = (tableId, productId, modifiers) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      const nextMods = (Array.isArray(modifiers) ? modifiers : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 200);
      const nextItems = existing.map((i) => (i.productId === productId ? { ...i, modifiers: nextMods } : i));
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const removeFromCart = (tableId: string, productId: string) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      const nextItems = existing.filter((i) => i.productId !== productId);
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const setCartQty = (tableId: string, productId: string, qty: number) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      if (qty <= 0) {
        const nextItems = existing.filter((i) => i.productId !== productId);
        const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
        const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
        return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
      }

      const product = s.products.find((p) => p.id === productId);
      if (!product) return s;
      if ((product as any)?.available === false) {
        const nextItems = existing.filter((i) => i.productId !== productId);
        const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
        const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
        return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
      }

      const nextItems = existing.map((i) =>
        i.productId === productId
          ? {
              ...i,
              qty,
              unitPrice: Number(product.price ?? i.unitPrice ?? 0) || 0,
              name: product.name,
            }
          : i,
      );
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);

      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const clearCart = (tableId: string) => {
    setState((s) => {
      const nextCartByTableId = { ...s.cartByTableId };
      delete nextCartByTableId[tableId];
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const addProduct = (product: { name: string; category: string; price: number; image: string; stock?: number; description?: string }) => {
    const name = product.name.trim();
    const category = product.category.trim();
    const price = product.price;
    const image = product.image.trim();
    const stock = typeof product.stock === 'number' && Number.isFinite(product.stock) && product.stock >= 0 ? product.stock : 0;
    const description = typeof product.description === 'string' ? product.description.trim() : '';
    if (!name || !category || !image) return '';
    if (!Number.isFinite(price) || price <= 0) return '';

    let createdId = '';
    setState((s) => {
      const last = ensureNextProductCode(s.products);
      const next = last + 1;
      writeCounter(PRODUCT_CODE_COUNTER_KEY, next);
      const id = generateId();
      const code = `PRD${next}`;
      createdId = id;
      return {
        ...s,
        products: [{ id, code, name, category, price, image, stock, description: description || undefined }, ...s.products],
      };
    });
    return createdId;
  };

  const updateProductPrice = (productId: string, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    setState((s) => ({
      ...s,
      products: s.products.map((p) => (p.id === productId ? { ...p, price } : p)),
    }));
  };

  const updateProductDetails: PosContextType['updateProductDetails'] = (productId, patch) => {
    setState((s) => {
      const nextProducts = s.products.map((p) => {
        if (p.id !== productId) return p;

        const nextName = typeof patch.name === 'string' ? patch.name.trim() : p.name;
        const nextCategory = typeof patch.category === 'string' ? patch.category.trim() : p.category;
        const nextImage = typeof patch.image === 'string' ? patch.image.trim() : p.image;
        const nextDescription = typeof patch.description === 'string' ? patch.description.trim() : p.description;
        const nextPrice = typeof patch.price === 'number' ? patch.price : p.price;
        const nextStock = typeof patch.stock === 'number' ? patch.stock : p.stock;

        if (!nextName || !nextCategory || !nextImage) return p;
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) return p;
        if (!Number.isFinite(nextStock) || nextStock < 0) return p;

        return {
          ...p,
          name: nextName,
          category: nextCategory,
          image: nextImage,
          description: nextDescription?.trim() ? nextDescription : undefined,
          price: nextPrice,
          stock: nextStock,
        };
      });

      return { ...s, products: nextProducts };
    });
  };

  const deleteProduct: PosContextType['deleteProduct'] = (productId) => {
    setState((s) => {
      const nextProducts = s.products.filter((p) => p.id !== productId);
      const nextCartByTableId: PersistedState['cartByTableId'] = {};
      for (const tableId of Object.keys(s.cartByTableId)) {
        const items = s.cartByTableId[tableId] ?? [];
        nextCartByTableId[tableId] = items.filter((i) => i.productId !== productId);
      }
      const nextTables = updateTableComputed(s.tables, nextCartByTableId, s.draftMetaByTableId);
      return { ...s, products: nextProducts, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const sendOrderToKitchen = (tableId: string, notes?: string) => {
    const orderId = generateId();
    const snap = state;
    const cartItems = snap.cartByTableId[tableId] ?? [];
    if (cartItems.length === 0) return '';

    const table = snap.tables.find((t) => t.id === tableId);
    const tableName = table?.name ?? tableId;
    const createdByStaffId = table?.assignedStaffId ?? undefined;
    const createdByName = (table?.assignedStaffName || undefined) ?? (createdByStaffId ? (resolveStaffName(createdByStaffId) || undefined) : undefined);

    const draftMeta = snap.draftMetaByTableId?.[tableId] || {};
    const orderType = draftMeta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in';
    const takeawayFee = orderType === 'takeaway' ? Math.max(0, Number(draftMeta?.takeawayFee ?? 0) || 0) : 0;

    const subtotal = calcSubtotal(cartItems);
    // Recalculate tax/service based on CURRENT settings (not cached)
    const pricing = readPricingSettings();
    const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
    const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
    const total = subtotal + tax + serviceCharge + takeawayFee;
    const now = new Date();

    const newOrder: PosOrder = {
      id: orderId,
      number: orderNumberFromId(orderId),
      tableId,
      tableName,
      orderType,
      takeawayFee,
      createdByStaffId,
      createdByName,
      items: cartItems,
      subtotal,
      tax,
      serviceCharge,
      total,
      status: 'Served',
      createdAt: now.toISOString(),
      timeLabel: formatTime(now),
      inventoryDeducted: true,
      syncedToServer: false,
      notes: notes?.trim() ? notes.trim() : undefined,
    };

    adjustInventoryByOrder(newOrder, 'deduct');

    void auditLog({
      action: 'order.placed',
      entity_type: 'order',
      entity_id: orderId,
      message: `${newOrder.number} placed for ${tableName}`,
      meta: { tableId, tableName, items: cartItems.length, total: newOrder.total },
    });

    setState((s) => {
      const stillHasCart = (s.cartByTableId[tableId] ?? []).length > 0;
      if (!stillHasCart) return s;

      const nextOrders = [newOrder, ...s.orders];
      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'Kitchen',
          title: `New Order - ${tableName}`,
          message: `${newOrder.number} sent to kitchen (${cartItems.length} items).`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      const nextCartByTableId = { ...s.cartByTableId };
      delete nextCartByTableId[tableId];

      const nextTables = updateTableComputed(
        s.tables.map((t) => (t.id === tableId ? { ...t, status: 'Occupied', openOrderId: orderId } : t)),
        nextCartByTableId,
        s.draftMetaByTableId,
      );

      return {
        ...s,
        orders: nextOrders,
        notifications: nextNotifications,
        cartByTableId: nextCartByTableId,
        tables: nextTables,
        selectedOrderId: orderId,
      };
    });

    try {
      upsertLocalOrderBundle(newOrder);
    } catch {
      // ignore
    }

    // Persist early so subsequent status changes + kitchen print don't race DB insertion.
    void (async () => {
      try {
        const ok = await persistOrder(newOrder);
        if (!ok) return;
        const nowIso = new Date().toISOString();
        setState((s) => ({
          ...s,
          orders: s.orders.map((o) => (o.id === orderId ? { ...o, syncedToServer: true, syncedAt: nowIso } : o)),
        }));
      } catch {
        // ignore
      }
    })();

    try {
      const { autoKitchen, separateDrinkTickets, hasBarRoute, beep } = readKitchenPrintSettings();
      if (autoKitchen) {
        const order = newOrder;
        const allLines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));

        setKitchenPrintStatus({ orderId, status: 'queued', message: 'Queued (retrying)' });
        void (async () => {
          try {
            await persistOrder(order);
          } catch {
            // ignore
          }

          if (separateDrinkTickets && hasBarRoute) {
            const food = allLines.filter((l) => !isDrinkLine(l.name));
            if (food.length > 0) await attemptKitchenAutoPrint({ order, lines: food, title: 'Kitchen Ticket' });
          } else {
            await attemptKitchenAutoPrint({ order, lines: allLines, title: 'Kitchen Ticket' });
          }
          queueKitchenSnapshot(orderId, allLines);
        })();
      }
    } catch {
      // ignore
    }

    void auditLog({
      action: 'order.print.kitchen',
      entity_type: 'order',
      entity_id: orderId,
      message: `Kitchen ticket triggered for ${newOrder.number}`,
      meta: { tableId, tableName },
    });

    return orderId;
  };

  const sendAdditionalOrderToKitchen: PosContextType['sendAdditionalOrderToKitchen'] = (tableId, notes, orderTypeOverride) => {
    const orderId = generateId();
    const snap = state;
    const cartItems = snap.cartByTableId[tableId] ?? [];
    if (cartItems.length === 0) return '';

    const table = snap.tables.find((t) => t.id === tableId);
    const tableName = table?.name ?? tableId;
    const createdByStaffId = table?.assignedStaffId ?? undefined;
    const createdByName = (table?.assignedStaffName || undefined) ?? (createdByStaffId ? (resolveStaffName(createdByStaffId) || undefined) : undefined);

    const draftMeta = snap.draftMetaByTableId?.[tableId] || {};
    const orderType = orderTypeOverride || (draftMeta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in');
    const takeawayFee = orderType === 'takeaway' ? Math.max(0, Number(draftMeta?.takeawayFee ?? 0) || 0) : 0;

    const subtotal = calcSubtotal(cartItems);
    const pricing = readPricingSettings();
    const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
    const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
    const total = subtotal + tax + serviceCharge + takeawayFee;
    const now = new Date();

    const newOrder: PosOrder = {
      id: orderId,
      number: orderNumberFromId(orderId),
      tableId,
      tableName,
      orderType,
      takeawayFee,
      createdByStaffId,
      createdByName,
      items: cartItems,
      subtotal,
      tax,
      serviceCharge,
      total,
      status: 'Served',
      createdAt: now.toISOString(),
      timeLabel: formatTime(now),
      inventoryDeducted: true,
      syncedToServer: false,
      notes: notes?.trim() ? notes.trim() : undefined,
    };

    adjustInventoryByOrder(newOrder, 'deduct');

    void auditLog({
      action: 'order.additional_placed',
      entity_type: 'order',
      entity_id: orderId,
      message: `${newOrder.number} additional order placed for ${tableName}`,
      meta: { tableId, tableName, items: cartItems.length, total: newOrder.total, orderType },
    });

    setState((s) => {
      // Use the captured cartItems, don't check cart again (race condition)
      const nextOrders = [newOrder, ...s.orders];
      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'Kitchen',
          title: `Additional Order - ${tableName}`,
          message: `${newOrder.number} sent to kitchen (${cartItems.length} items).`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      const nextCartByTableId = { ...s.cartByTableId };
      delete nextCartByTableId[tableId];

      const nextTables = updateTableComputed(
        s.tables.map((t) => {
          if (t.id !== tableId) return t;
          const existingIds = t.openOrderIds || (t.openOrderId ? [t.openOrderId] : []);
          return {
            ...t,
            status: 'Occupied',
            openOrderId: orderId,
            openOrderIds: [...existingIds, orderId],
          };
        }),
        nextCartByTableId,
        s.draftMetaByTableId,
      );

      return {
        ...s,
        orders: nextOrders,
        notifications: nextNotifications,
        cartByTableId: nextCartByTableId,
        tables: nextTables,
        selectedOrderId: orderId,
      };
    });

    try {
      upsertLocalOrderBundle(newOrder);
    } catch {
      // ignore
    }

    void (async () => {
      try {
        const ok = await persistOrder(newOrder);
        if (!ok) return;
        const nowIso = new Date().toISOString();
        setState((s) => ({
          ...s,
          orders: s.orders.map((o) => (o.id === orderId ? { ...o, syncedToServer: true, syncedAt: nowIso } : o)),
        }));
      } catch {
        // ignore
      }
    })();

    try {
      const { autoKitchen, separateDrinkTickets, hasBarRoute, beep } = readKitchenPrintSettings();
      if (autoKitchen) {
        const order = newOrder;
        const allLines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));

        setKitchenPrintStatus({ orderId, status: 'queued', message: 'Queued (retrying)' });
        void (async () => {
          try {
            await persistOrder(order);
          } catch {
            // ignore
          }

          if (separateDrinkTickets && hasBarRoute) {
            const food = allLines.filter((l) => !isDrinkLine(l.name));
            if (food.length > 0) await attemptKitchenAutoPrint({ order, lines: food, title: 'Kitchen Ticket (Additional)' });
          } else {
            await attemptKitchenAutoPrint({ order, lines: allLines, title: 'Kitchen Ticket (Additional)' });
          }
          queueKitchenSnapshot(orderId, allLines);
        })();
      }
    } catch {
      // ignore
    }

    void auditLog({
      action: 'order.print.kitchen',
      entity_type: 'order',
      entity_id: orderId,
      message: `Kitchen ticket triggered for additional order ${newOrder.number}`,
      meta: { tableId, tableName, orderType },
    });

    return orderId;
  };

  const printKitchenTicket: PosContextType['printKitchenTicket'] = async (orderId, opts) => {
    const oid = String(orderId || '').trim();
    if (!oid) return;

    const order = stateRef.current.orders.find((o) => o.id === oid);
    if (!order) return;

    const lines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));

    if (opts?.mode === 'dialog') {
      const html = kitchenTicketHtml('Kitchen Ticket', order, lines);
      const ok = openPrintWindow(html);
      if (!ok) {
        const ok2 = printHtmlViaIframe(html);
        if (!ok2) window.print();
      }
      return;
    }

    const { beep } = readKitchenPrintSettings();

    const kitchenDeviceId = (() => {
      try {
        const raw = readBranchSettingsRaw();
        if (!raw) return '';
        const settings = JSON.parse(raw) as BranchSettingsForPrinting;
        return typeof settings?.defaultKitchenPrinterId === 'string' ? settings.defaultKitchenPrinterId : '';
      } catch {
        return '';
      }
    })();

    const usbTarget = loadKitchenPrinterTarget();
    if (usbTarget && usbTarget.connection === 'USB' && usbTarget.printerName) {
      const html = kitchenTicketHtml('Kitchen Ticket', order, lines);
      await printKitchenUsbOrQueue({ orderId: oid, html, deviceName: usbTarget.printerName });
      queueKitchenSnapshot(oid, lines);
      return;
    }

    if (!kitchenDeviceId) {
      const ok = openPrintWindow(kitchenTicketHtml('Kitchen Ticket', order, lines));
      if (!ok) window.print();
      throw new Error('Kitchen printer is not configured');
    }

    try {
      await persistOrder(order);
    } catch {
      // ignore
    }

    try {
      const res = await apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(oid)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: kitchenDeviceId, title: 'Kitchen Ticket', lines, beep }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as any;
        const err = typeof json?.error === 'string' && json.error.trim() ? json.error.trim() : `HTTP ${res.status}`;
        throw new Error(err);
      }
    } catch (e) {
      const ok = openPrintWindow(kitchenTicketHtml('Kitchen Ticket', order, lines));
      if (!ok) window.print();
      throw e;
    }
  };

  const retryKitchenTicket: PosContextType['retryKitchenTicket'] = async (orderId) => {
    const oid = String(orderId || '').trim();
    if (!oid) return;

    const order = stateRef.current.orders.find((o) => o.id === oid);
    if (!order) return;

    const lines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));
    setKitchenPrintStatus({ orderId: oid, status: 'queued', message: 'Queued (retrying)' });
    await attemptKitchenAutoPrint({ order, lines, title: 'Kitchen Ticket' });
  };

  const importDraftToKitchenOrder: PosContextType['importDraftToKitchenOrder'] = (args) => {
    const orderId = generateId();
    const snap = state;
    const items = Array.isArray(args?.items) ? args.items : [];
    if (items.length === 0) return '';

    const fallbackTableId = snap.selectedTableId ?? snap.tables[0]?.id ?? '1';
    const tableId = typeof args?.tableId === 'string' && args.tableId ? args.tableId : fallbackTableId;

    const table = snap.tables.find((t) => t.id === tableId);
    const tableName = table?.name ?? tableId;
    const createdByStaffId = typeof args?.createdByStaffId === 'string' && args.createdByStaffId ? args.createdByStaffId : table?.assignedStaffId ?? undefined;
    const createdByName = (table?.assignedStaffName || undefined) ?? (createdByStaffId ? (resolveStaffName(createdByStaffId) || undefined) : undefined);

    const orderItems: PosOrderItem[] = items
      .map((it) => ({
        productId: String(it.productId || ''),
        name: String(it.name || ''),
        unitPrice: Number(it.unitPrice ?? 0),
        qty: Number(it.qty ?? 0),
        note: typeof it.note === 'string' ? it.note : '',
      }))
      .filter((it) => it.productId && it.name && Number.isFinite(it.unitPrice) && it.unitPrice >= 0 && Number.isFinite(it.qty) && it.qty > 0);

    if (orderItems.length === 0) return '';

    const subtotal = calcSubtotal(orderItems);
    // Recalculate tax/service based on CURRENT settings (not cached)
    const pricing = readPricingSettings();
    const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
    const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
    const total = subtotal + tax + serviceCharge;
    const now = new Date();

    const newOrder: PosOrder = {
      id: orderId,
      number: orderNumberFromId(orderId),
      tableId,
      tableName,
      createdByStaffId,
      createdByName,
      items: orderItems,
      subtotal,
      tax,
      serviceCharge,
      total,
      status: 'Served',
      createdAt: now.toISOString(),
      timeLabel: formatTime(now),
      inventoryDeducted: true,
      syncedToServer: false,
      notes: typeof args?.notes === 'string' && args.notes.trim() ? args.notes.trim() : undefined,
    };

    adjustInventoryByOrder(newOrder, 'deduct');

    void auditLog({
      action: 'draft.imported_to_order',
      entity_type: 'draft',
      entity_id: String(args?.draftId || ''),
      message: `Draft imported into order ${newOrder.number}`,
      meta: { orderId, tableId, tableName, items: orderItems.length, total: newOrder.total },
    });

    setState((s) => {
      const nextOrders = [newOrder, ...s.orders];
      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'Kitchen',
          title: `New Order - ${tableName}`,
          message: `${newOrder.number} sent to kitchen (${orderItems.length} items).`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      const nextTables = updateTableComputed(
        s.tables.map((t) => (t.id === tableId ? { ...t, status: 'Occupied', openOrderId: orderId } : t)),
        s.cartByTableId,
        s.draftMetaByTableId,
      );

      return {
        ...s,
        orders: nextOrders,
        notifications: nextNotifications,
        tables: nextTables,
        selectedOrderId: orderId,
      };
    });

    queueMicrotask(() => {
      try {
        try {
          upsertLocalOrderBundle(newOrder);
        } catch {
          // ignore
        }
        void persistOrder(newOrder);
      } catch {
        // ignore
      }
    });

    try {
      const { autoKitchen, separateDrinkTickets, hasBarRoute, beep } = readKitchenPrintSettings();
      if (autoKitchen) {
        const order = newOrder;
        const allLines = order.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));

        const usbTarget = loadKitchenPrinterTarget();
        if (usbTarget && usbTarget.connection === 'USB' && usbTarget.printerName) {
          const html = kitchenTicketHtml('Kitchen Ticket', order, allLines);
          void printKitchenUsbOrQueue({ orderId, html, deviceName: usbTarget.printerName });
          queueKitchenSnapshot(orderId, allLines);
          return orderId;
        }

        if (separateDrinkTickets && hasBarRoute) {
          const drinks = allLines.filter((l) => isDrinkLine(l.name));
          const food = allLines.filter((l) => !isDrinkLine(l.name));

          const kitchenDeviceId = (() => {
            try {
              const raw = readBranchSettingsRaw();
              if (!raw) return '';
              const settings = JSON.parse(raw) as BranchSettingsForPrinting;
              return typeof settings?.defaultKitchenPrinterId === 'string' ? settings.defaultKitchenPrinterId : '';
            } catch {
              return '';
            }
          })();

          const barDeviceId = (() => {
            try {
              const raw = readBranchSettingsRaw();
              if (!raw) return '';
              const settings = JSON.parse(raw) as BranchSettingsForPrinting;
              return typeof settings?.defaultBarPrinterId === 'string' ? settings.defaultBarPrinterId : '';
            } catch {
              return '';
            }
          })();

          if (food.length > 0) {
            void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId: kitchenDeviceId || undefined, title: 'Kitchen Ticket', lines: food, beep }),
            }).catch(() => {
              const ok = openPrintWindow(kitchenTicketHtml('Kitchen Ticket', order, food));
              if (!ok) {
                setState((s) => ({
                  ...s,
                  notifications: [
                    {
                      id: generateId(),
                      type: 'Kitchen',
                      title: 'Printing blocked',
                      message: 'Popup blocked. Allow popups to print kitchen tickets.',
                      orderId,
                      createdAt: new Date().toISOString(),
                      read: false,
                    },
                    ...s.notifications,
                  ],
                }));
              }
            });
          }

          if (drinks.length > 0) {
            void apiFetch(withBranchQuery(`/api/pos/print/bar/${encodeURIComponent(String(orderId))}`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId: barDeviceId || undefined, title: 'Bar Ticket', lines: drinks, beep }),
            }).catch(() => {
              const ok = openPrintWindow(kitchenTicketHtml('Bar Ticket', order, drinks));
              if (!ok) {
                setState((s) => ({
                  ...s,
                  notifications: [
                    {
                      id: generateId(),
                      type: 'Kitchen',
                      title: 'Printing blocked',
                      message: 'Popup blocked. Allow popups to print kitchen tickets.',
                      orderId,
                      createdAt: new Date().toISOString(),
                      read: false,
                    },
                    ...s.notifications,
                  ],
                }));
              }
            });
          }
        } else {
          const kitchenDeviceId = (() => {
            try {
              const raw = readBranchSettingsRaw();
              if (!raw) return '';
              const settings = JSON.parse(raw) as BranchSettingsForPrinting;
              return typeof settings?.defaultKitchenPrinterId === 'string' ? settings.defaultKitchenPrinterId : '';
            } catch {
              return '';
            }
          })();

          void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: kitchenDeviceId || undefined, title: 'Kitchen Ticket', lines: allLines, beep }),
          }).catch(() => {
            const ok = openPrintWindow(kitchenTicketHtml('Kitchen Ticket', order, allLines));
            if (!ok) {
              setState((s) => ({
                ...s,
                notifications: [
                  {
                    id: generateId(),
                    type: 'Kitchen',
                    title: 'Printing blocked',
                    message: 'Popup blocked. Allow popups to print kitchen tickets.',
                    orderId,
                    createdAt: new Date().toISOString(),
                    read: false,
                  },
                  ...s.notifications,
                ],
              }));
            }
          });
        }
      }
    } catch {
      // ignore
    }

    void auditLog({
      action: 'order.print.kitchen',
      entity_type: 'order',
      entity_id: orderId,
      message: `Kitchen ticket triggered for ${newOrder.number}`,
      meta: { tableId, tableName, source: 'draft_import' },
    });

    return orderId;
  };

  const setPendingOrderItemQty = (orderId: string, productId: string, qty: number) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // Allow editing for Pending or Served (pre-billing states)
      if (order.status !== 'Pending' && order.status !== 'Served') return s;

      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;
        
        // If qty is 0 or less, remove the item completely
        if (qty <= 0) {
          const nextItems = o.items.filter((i) => i.productId !== productId);
          const subtotal = calcSubtotalEffective(nextItems);
          // Recalculate tax/service based on CURRENT settings
          const pricing = readPricingSettings();
          const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
          const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
          const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
          const total = subtotal + tax + serviceCharge + takeawayFee;
          return { ...o, items: nextItems, subtotal, tax, serviceCharge, total, syncedToServer: false };
        }

        const hasLine = o.items.some((i) => i.productId === productId);
        const nextItems = hasLine
          ? o.items.map((i) => (i.productId === productId ? { ...i, qty } : i))
          : (() => {
              const p = s.products.find((x) => x.id === productId);
              if (!p) return o.items;
              return [
                ...o.items,
                {
                  productId,
                  name: p.name,
                  unitPrice: p.price,
                  qty,
                  note: '',
                },
              ];
            })();
        const subtotal = calcSubtotalEffective(nextItems);
        // Recalculate tax/service based on CURRENT settings
        const pricing = readPricingSettings();
        const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
        const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
        const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
        const total = subtotal + tax + serviceCharge + takeawayFee;
        return { ...o, items: nextItems, subtotal, tax, serviceCharge, total, syncedToServer: false };
      });

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) upsertLocalOrderBundle(updatedOrder);
        if (updatedOrder) scheduleKitchenChangesPrint(updatedOrder);
      } catch {
        // ignore
      }
    });
  };

  const swapOrderItem = (orderId: string, oldProductId: string, newProductId: string, newProductName: string, newProductPrice: number) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // Allow editing for Pending or Served (pre-billing states)
      if (order.status !== 'Pending' && order.status !== 'Served') return s;

      const oldItem = order.items.find((i) => i.productId === oldProductId);
      if (!oldItem) return s;

      const now = new Date();
      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;
        
        // Check if new product already exists in order
        const existingNewItem = o.items.find((i) => i.productId === newProductId);
        
        let nextItems;
        if (existingNewItem) {
          // Merge: increase qty of existing new item, remove old item
          nextItems = o.items
            .map((i) => (i.productId === newProductId ? { ...i, qty: i.qty + oldItem.qty } : i))
            .filter((i) => i.productId !== oldProductId);
        } else {
          // Replace: swap old item with new item keeping same qty
          nextItems = o.items.map((i) =>
            i.productId === oldProductId
              ? {
                  ...i,
                  productId: newProductId,
                  name: newProductName,
                  unitPrice: newProductPrice,
                }
              : i
          );
        }
        
        const subtotal = calcSubtotalEffective(nextItems);
        const pricing = readPricingSettings();
        const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
        const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
        const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
        const total = subtotal + tax + serviceCharge + takeawayFee;
        
        return {
          ...o,
          items: nextItems,
          subtotal,
          tax,
          serviceCharge,
          total,
          editedAt: now.toISOString(),
          isEdited: true,
          syncedToServer: false,
        };
      });

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          scheduleKitchenChangesPrint(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.item_swapped',
      entity_type: 'order',
      entity_id: orderId,
      message: `Item swapped: ${oldProductId} → ${newProductId}`,
      meta: { oldProductId, newProductId },
    });
  };

  const setPendingOrderItemNote = (orderId: string, productId: string, note: string) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // Allow editing for Pending or Served (pre-billing states)
      if (order.status !== 'Pending' && order.status !== 'Served') return s;

      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;
        const nextItems = o.items.map((i) => (i.productId === productId ? { ...i, note } : i));
        return { ...o, items: nextItems, syncedToServer: false };
      });

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) upsertLocalOrderBundle(updatedOrder);
        if (updatedOrder) scheduleKitchenChangesPrint(updatedOrder);
      } catch {
        // ignore
      }
    });
  };

  const setOrderStatus = (orderId: string, status: PosOrder['status']) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      if (order.status === 'Paid' || order.status === 'Voided' || order.status === 'Refunded') return s;

      if (order.status === status) return s;

      const allowed: Record<string, PosOrder['status'][]> = {
        // Be tolerant: allow skipping intermediate states so UI can't get "stuck".
        Pending: ['Cooking', 'Ready', 'Served', 'Voided'],
        Cooking: ['Ready', 'Served', 'Voided'],
        Ready: ['Served', 'Voided'],
        Served: ['Paid', 'Voided'],
      };

      const nextAllowed = allowed[order.status] || [];
      if (!nextAllowed.includes(status)) return s;

      const now = new Date();
      const nextOrders = s.orders.map((o) => (o.id === orderId ? { ...o, status, syncedToServer: false } : o));
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'Kitchen',
          title: `Order ${status} - ${order.tableName}`,
          message: `${order.number} is now ${status}.`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId) return t;
        if (status === 'Served') return { ...t, status: 'Payment' };
        if (status === 'Pending') return { ...t, status: 'Occupied' };
        return t;
      });

      return {
        ...s,
        orders: nextOrders,
        notifications: nextNotifications,
        tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
      };
    });

    queueMicrotask(() => {
      try {
        if (!updatedOrder) return;

        try {
          upsertLocalOrderBundle(updatedOrder);
        } catch {
          // ignore
        }

        // Persist status-only updates to avoid backend rejecting full payload updates
        // for non-owner waiter workflows.
        if (updatedOrder.status === 'Cooking' || updatedOrder.status === 'Ready' || updatedOrder.status === 'Served') {
          void (async () => {
            try {
              const res = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(updatedOrder!.id)}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: updatedOrder!.status }),
              });
              // Refresh to sync table status with DB
              void refreshFromServer();
              if (res.ok) {
                // FAST AUTO-PRINT: Fire and forget if enabled
                if (updatedOrder.status === 'Cooking' && state.settings.printerPrefs.autoPrintKitchenTickets && state.settings.defaultKitchenPrinterId) {
                  const allLines = updatedOrder.items.map((i) => ({ name: i.name, qty: i.qty, note: i.note }));
                  setKitchenPrintStatus({ orderId: updatedOrder.id, status: 'queued', message: 'Queued (retrying)' });
                  void attemptKitchenAutoPrint({ order: updatedOrder, lines: allLines, title: 'Kitchen Ticket' });
                }
                return;
              }
              if (res.status === 404) {
                // Fallback: order might not exist yet, attempt full persist.
                await persistOrder(updatedOrder!);
              }
            } catch {
              // ignore
            }
          })();
          return;
        }

        void persistOrder(updatedOrder).then(() => {
          void refreshFromServer();
        });
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.status_changed',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order status changed to ${status}`,
      meta: { status },
    });
  };

  const voidOrder = (orderId: string, reason?: string) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // ANTI-FRAUD: Cannot void Paid, Voided, Refunded, or Billing orders
      if (order.status === 'Paid' || order.status === 'Voided' || order.status === 'Refunded' || order.status === 'Billing') return s;
      if (!reason?.trim()) return s;

      // Restore inventory for voided order
      if (order.inventoryDeducted) {
        adjustInventoryByOrder(order, 'restock');
      }

      const now = new Date();
      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'Voided' as const, voidedAt: now.toISOString(), voidReason: reason.trim(), syncedToServer: false }
          : o,
      );
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId && !(t.openOrderIds?.includes(orderId))) return t;
        const remainingIds = (t.openOrderIds || []).filter((id) => id !== orderId);
        const hasOtherOrders = remainingIds.length > 0;
        return {
          ...t,
          status: hasOtherOrders ? 'Occupied' : 'Free',
          openOrderId: hasOtherOrders ? remainingIds[remainingIds.length - 1] : null,
          openOrderIds: remainingIds,
          lastOrderId: orderId,
        };
      });

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'System',
          title: `Order Voided - ${order.tableName}`,
          message: `${order.number} was voided: ${reason.trim()}`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      return {
        ...s,
        orders: nextOrders,
        tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
        notifications: nextNotifications,
        selectedOrderId: s.selectedOrderId === orderId ? null : s.selectedOrderId,
      };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.voided',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order voided: ${String(reason || '')}`,
      meta: { reason: String(reason || '') },
    });
  };

  const refundOrder = (orderId: string, reason: string, managerPin: string) => {
    let updatedOrder: PosOrder | null = null;
    
    // Verify manager PIN (simple validation - in production this would verify against DB)
    if (!managerPin || managerPin.length < 4) {
      throw new Error('Manager authentication required');
    }

    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      
      // ANTI-FRAUD: Only allow refund for Paid orders
      if (order.status !== 'Paid') {
        throw new Error('Only paid orders can be refunded');
      }
      
      if (!reason?.trim()) {
        throw new Error('Refund reason is required');
      }

      // Restore inventory for refunded order
      if (order.inventoryDeducted) {
        adjustInventoryByOrder(order, 'restock');
      }

      const now = new Date();
      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { 
              ...o, 
              status: 'Refunded' as const, 
              refundedAt: now.toISOString(),
              refundReason: reason.trim(),
              syncedToServer: false 
            }
          : o,
      );
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId && !(t.openOrderIds?.includes(orderId))) return t;
        const remainingIds = (t.openOrderIds || []).filter((id) => id !== orderId);
        const hasOtherOrders = remainingIds.length > 0;
        return {
          ...t,
          status: hasOtherOrders ? 'Occupied' : 'Free',
          openOrderId: hasOtherOrders ? remainingIds[remainingIds.length - 1] : null,
          openOrderIds: remainingIds,
          lastOrderId: orderId,
        };
      });

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'System',
          title: `Order Refunded - ${order.tableName}`,
          message: `${order.number} was refunded: ${reason.trim()}`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      return {
        ...s,
        orders: nextOrders,
        tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
        notifications: nextNotifications,
        selectedOrderId: s.selectedOrderId === orderId ? null : s.selectedOrderId,
      };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.refunded',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order refunded: ${reason}`,
      meta: { reason, managerVerified: true },
    });
  };

  const voidOrderItem = (orderId: string, productId: string, qty: number, reason?: string) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // ANTI-FRAUD: Cannot void items from Paid, Voided, Refunded, or Billing orders
      if (order.status === 'Paid' || order.status === 'Voided' || order.status === 'Refunded' || order.status === 'Billing') return s;
      if (!reason?.trim()) return s;
      if (qty <= 0) return s;

      const before = order.items.find((i) => i.productId === productId);
      const beforeVoided = before?.voidedQty ?? 0;

      const now = new Date();
      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;
        const existing = o.items.find((i) => i.productId === productId);
        if (!existing) return o;

        const currentVoided = existing.voidedQty ?? 0;
        const nextVoided = Math.min(existing.qty, currentVoided + qty);
        const nextItems = o.items.map((i) => (i.productId === productId ? { ...i, voidedQty: nextVoided, voidReason: reason.trim() } : i));

        const subtotal = calcSubtotalEffective(nextItems);
        // Recalculate tax/service based on CURRENT settings
        const pricing = readPricingSettings();
        const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
        const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
        const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
        const total = subtotal + tax + serviceCharge + takeawayFee;

        const nextStatus = nextItems.every((it) => effectiveQty(it) === 0) ? 'Voided' : o.status;
        return {
          ...o,
          items: nextItems,
          subtotal,
          tax,
          serviceCharge,
          total,
          status: nextStatus,
          voidedAt: nextStatus === 'Voided' ? now.toISOString() : (o as any).voidedAt,
          voidReason: nextStatus === 'Voided' ? String(reason || '').trim() || (o as any).voidReason : (o as any).voidReason,
          syncedToServer: false,
        };
      });

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId && !(t.openOrderIds?.includes(orderId))) return t;
        const updated = nextOrders.find((x) => x.id === orderId);
        if (updated?.status === 'Voided') {
          const remainingIds = (t.openOrderIds || []).filter((id) => id !== orderId);
          const hasOtherOrders = remainingIds.length > 0;
          return {
            ...t,
            status: hasOtherOrders ? 'Occupied' : 'Free',
            openOrderId: hasOtherOrders ? remainingIds[remainingIds.length - 1] : null,
            openOrderIds: remainingIds,
          };
        }
        return t;
      });

      const after = nextOrders.find((o) => o.id === orderId);
      const afterLine = after?.items.find((i) => i.productId === productId);
      const afterVoided = afterLine?.voidedQty ?? beforeVoided;
      const delta = Math.max(0, afterVoided - beforeVoided);
      if (delta > 0 && order.inventoryDeducted) {
        restockInventoryForVoidedLineDelta(productId, delta);
      }

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'System',
          title: `Item Voided - ${order.tableName}`,
          message: `${order.number} item voided: ${reason.trim()}`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return {
        ...s,
        orders: nextOrders,
        tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
        notifications: nextNotifications,
      };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.item_voided',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order item voided: ${productId} x${qty}`,
      meta: { productId, qty, reason: String(reason || '') },
    });
  };

  const confirmPayment = (orderId: string, paymentMethod: PaymentMethod, tenderedAmount?: number, splitId?: string, paymentReference?: string, tip?: number) => {
    let updatedOrder: PosOrder | null = null;

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (offline && paymentMethod !== 'Cash') {
      setState((s) => {
        const order = s.orders.find((o) => o.id === orderId);
        if (!order) return s;
        const now = new Date();
        const nextNotifications: PosNotification[] = [
          {
            id: generateId(),
            type: 'Payments',
            title: 'Offline Payment',
            message: 'Offline mode supports Cash only. Please connect to internet for this payment method.',
            orderId,
            createdAt: now.toISOString(),
            read: false,
          },
          ...s.notifications,
        ];
        return { ...s, notifications: nextNotifications };
      });
      return;
    }

    const actor = (() => {
      try {
        const s = readSession<any>();
        const paidByStaffId = typeof s?.staffId === 'string' && s.staffId.trim() ? s.staffId.trim() : '';
        const paidByName = typeof s?.staffName === 'string' && s.staffName.trim() ? s.staffName.trim() : '';
        return { paidByStaffId, paidByName };
      } catch {
        return { paidByStaffId: '', paidByName: '' };
      }
    })();

    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      // Only allow payment in Billing status (NEW unified workflow)
      if (order.status !== 'Billing') return s;

      const now = new Date();

      const hasSplits = Array.isArray(order.splits) && order.splits.length > 0;
      const payingSplit = hasSplits && typeof splitId === 'string' && splitId.length > 0;

      if (payingSplit) {
        const sp = (order.splits || []).find((x) => x && x.id === splitId) || null;
        if (!sp) return s;
        if (sp.status === 'Paid') return s;
      }

      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;

        if (!payingSplit) {
          const nextSplits = Array.isArray(o.splits)
            ? o.splits.map((sp) => ({ ...sp, status: 'Paid' as const, paidAt: now.toISOString(), paymentMethod, tenderedAmount, paymentReference }))
            : o.splits;

          // Clear tax/service and recalculate total to match current settings
          const pricing = readPricingSettings();
          const newTax = pricing.vatEnabled ? (o.subtotal || 0) * (pricing.vatRate / 100) : 0;
          const newService = pricing.serviceEnabled ? (o.subtotal || 0) * (pricing.serviceRate / 100) : 0;
          const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
          const newTotal = (o.subtotal || 0) + newTax + newService + takeawayFee;

          // Include tip in the total if provided
          const tipAmount = Math.max(0, Number(tip || 0) || 0);
          const finalTotal = newTotal + tipAmount;

          return {
            ...o,
            splits: nextSplits as any,
            status: 'Paid',
            paidAt: now.toISOString(),
            paymentMethod,
            tenderedAmount,
            paymentReference,
            paidByStaffId: actor.paidByStaffId || (o as any).paidByStaffId,
            paidByName: actor.paidByName || (o as any).paidByName,
            tax: newTax,
            serviceCharge: newService,
            total: finalTotal,
            tip: tipAmount,
            syncedToServer: false,
          };
        }

        const nextSplits = (o.splits || []).map((sp) =>
          sp.id === splitId
            ? { ...sp, status: 'Paid', paidAt: now.toISOString(), paymentMethod, tenderedAmount, paymentReference }
            : sp,
        );
        const allPaid = nextSplits.length > 0 && nextSplits.every((sp) => sp.status === 'Paid');

        // Clear tax/service and recalculate total to match current settings when fully paid
        const pricing = readPricingSettings();
        const newTax = allPaid && pricing.vatEnabled ? (o.subtotal || 0) * (pricing.vatRate / 100) : (allPaid ? 0 : (o.tax || 0));
        const newService = allPaid && pricing.serviceEnabled ? (o.subtotal || 0) * (pricing.serviceRate / 100) : (allPaid ? 0 : (o.serviceCharge || 0));
        const takeawayFee = Math.max(0, Number((o as any).takeawayFee ?? 0) || 0);
        const newTotal = allPaid ? (o.subtotal || 0) + newTax + newService + takeawayFee : (o.total || 0);

        // Include tip in the total if provided (when fully paid)
        const tipAmount = allPaid ? Math.max(0, Number(tip || 0) || 0) : 0;
        const finalTotal = allPaid ? newTotal + tipAmount : (o.total || 0);

        return {
          ...o,
          splits: nextSplits,
          status: allPaid ? 'Paid' : o.status,
          paidAt: allPaid ? now.toISOString() : o.paidAt,
          paymentMethod: allPaid ? paymentMethod : o.paymentMethod,
          tenderedAmount: allPaid ? tenderedAmount : o.tenderedAmount,
          paymentReference: allPaid ? paymentReference : (o as any).paymentReference,
          paidByStaffId: allPaid ? (actor.paidByStaffId || (o as any).paidByStaffId) : (o as any).paidByStaffId,
          paidByName: allPaid ? (actor.paidByName || (o as any).paidByName) : (o as any).paidByName,
          tax: newTax,
          serviceCharge: newService,
          total: finalTotal,
          tip: allPaid ? tipAmount : (o.tip || 0),
          syncedToServer: false,
        };
      });

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const afterOrder = nextOrders.find((o) => o.id === orderId);
      const shouldCloseTable = afterOrder?.status === 'Paid';

      const nextProducts = shouldCloseTable
        ? s.products.map((p) => {
          const line = order.items.find((i) => i.productId === p.id);
          if (!line) return p;
          const used = effectiveQty(line);
          return { ...p, stock: Math.max(0, p.stock - used) };
        })
        : s.products;

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId && !(t.openOrderIds?.includes(orderId))) return t;
        const remainingIds = (t.openOrderIds || []).filter((id) => id !== orderId);
        const hasOtherOrders = remainingIds.length > 0;
        return {
          ...t,
          status: hasOtherOrders ? 'Occupied' : 'Free',
          openOrderId: hasOtherOrders ? remainingIds[remainingIds.length - 1] : null,
          openOrderIds: remainingIds,
          lastOrderId: orderId,
        };
      });

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'Payments',
          title: payingSplit && !shouldCloseTable ? `Split Paid - ${order.tableName}` : `Payment Confirmed - ${order.tableName}`,
          message: payingSplit && !shouldCloseTable ? `${order.number} split paid via ${paymentMethod}.` : `${order.number} paid via ${paymentMethod}.`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      // After successful payment, log audit
      void auditLog({
        action: 'payment.recorded',
        entity_type: 'order',
        entity_id: orderId,
        message: `Payment recorded via ${paymentMethod}`,
        meta: { paymentMethod, tenderedAmount: tenderedAmount ?? null, splitId: splitId ?? null, paymentReference: paymentReference ?? null },
      });

      return {
        ...s,
        products: nextProducts,
        orders: nextOrders,
        tables: updateTableComputed(nextTables, s.cartByTableId, s.draftMetaByTableId),
        notifications: nextNotifications,
        selectedOrderId: orderId,
      };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          try {
            upsertLocalOrderBundle(updatedOrder);
          } catch {
            // ignore
          }
          void persistOrder(updatedOrder).then(() => {
            // Refresh from server after payment to ensure table status is synced
            void refreshFromServer();
          }).catch(() => {
            // Still try to refresh even if persist failed
            void refreshFromServer();
          });
        }
      } catch {
        // ignore
      }
    });
  };

  const enterBillingMode = (orderId: string) => {
    let updatedOrder: PosOrder | null = null;

    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;

      // Only allow entering billing from Served status
      if (order.status !== 'Served') return s;

      const now = new Date();

      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'Billing' as const, billingStartedAt: now.toISOString(), syncedToServer: false }
          : o,
      );

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.billing_started',
      entity_type: 'order',
      entity_id: orderId,
      message: 'Order entered billing mode',
      meta: { previousStatus: 'Served' },
    });
  };

  const unlockOrder = async (orderId: string, managerPin: string, reason?: string) => {
    let updatedOrder: PosOrder | null = null;
    
    // Verify manager PIN format
    if (!managerPin || managerPin.length < 4) {
      throw new Error('Manager authentication required');
    }

    // Check permission using hasPermission utility
    if (!hasPermission('unlock')) {
      throw new Error('Manager approval required to unlock orders');
    }

    // Validate PIN against session (if PIN is stored in session)
    const session = readSession<any>();
    const storedPin = session?.pin || session?.staffPin;
    if (storedPin && managerPin !== String(storedPin)) {
      throw new Error('Invalid manager PIN');
    }

    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      
      // ANTI-FRAUD: Only allow unlocking from Billing status
      if (order.status !== 'Billing') {
        throw new Error('Only orders in Billing can be unlocked');
      }

      const now = new Date();
      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'Served' as const, billingStartedAt: undefined, syncedToServer: false }
          : o,
      );
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const nextNotifications: PosNotification[] = [
        {
          id: generateId(),
          type: 'System',
          title: `Order Unlocked - ${order.tableName}`,
          message: `${order.number} unlocked by manager${reason ? `: ${reason}` : ''}`,
          orderId,
          createdAt: now.toISOString(),
          read: false,
        },
        ...s.notifications,
      ];

      return {
        ...s,
        orders: nextOrders,
        notifications: nextNotifications,
      };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    // Get current actor info for impersonation audit (use existing session)
    const managerId = session?.staffId || session?.uid || 'unknown';
    const managerName = session?.staffName || session?.email || 'Unknown';

    // Audit with impersonation tracking
    void auditLog({
      action: 'order.unlocked',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order unlocked from Billing by manager: ${managerName}${reason ? ` - ${reason}` : ''}`,
      meta: { 
        reason: String(reason || ''), 
        managerId,
        managerName,
        actingAs: updatedOrder?.createdByStaffId || null,
        previousStatus: 'Billing',
        newStatus: 'Served'
      },
    });
  };

  const setOrderCustomer: PosContextType['setOrderCustomer'] = (orderId, customer) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const nextOrders = s.orders.map((o) => (o.id === orderId ? { ...o, customer: customer || undefined, syncedToServer: false } : o));
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;
      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.customer_set',
      entity_type: 'order',
      entity_id: orderId,
      message: customer ? 'Customer linked to order' : 'Customer removed from order',
      meta: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    });
  };

  const setOrderSplits: PosContextType['setOrderSplits'] = (orderId, splits) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const nextOrders = s.orders.map((o) => (o.id === orderId ? { ...o, splits: splits || undefined, syncedToServer: false } : o));
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;
      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.splits_set',
      entity_type: 'order',
      entity_id: orderId,
      message: splits && splits.length ? `Split bill set (${splits.length} splits)` : 'Split bill cleared',
      meta: splits && splits.length ? { splits: splits.length } : null,
    });
  };

  const setOrderType: PosContextType['setOrderType'] = (orderId, orderType, takeawayFee = 0) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;

      const newTakeawayFee = orderType === 'takeaway' ? Math.max(0, Number(takeawayFee) || 0) : 0;
      const subtotal = Number(order.subtotal ?? calcSubtotalEffective(order.items) ?? 0) || 0;
      const pricing = readPricingSettings();
      const tax = pricing.vatEnabled ? subtotal * (pricing.vatRate / 100) : 0;
      const serviceCharge = pricing.serviceEnabled ? subtotal * (pricing.serviceRate / 100) : 0;
      const total = subtotal + tax + serviceCharge + newTakeawayFee;

      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { ...o, orderType, takeawayFee: newTakeawayFee, subtotal, tax, serviceCharge, total, syncedToServer: false }
          : o,
      );
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;
      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) {
          upsertLocalOrderBundle(updatedOrder);
          void persistOrder(updatedOrder);
        }
      } catch {
        // ignore
      }
    });

    void auditLog({
      action: 'order.type_changed',
      entity_type: 'order',
      entity_id: orderId,
      message: `Order type changed to ${orderType}`,
      meta: { orderType, takeawayFee },
    });
  };

  const markNotificationRead = (notificationId: string, read: boolean) => {
    setState((s) => ({
      ...s,
      notifications: s.notifications.map((n) => (n.id === notificationId ? { ...n, read } : n)),
    }));
  };

  const markAllNotificationsRead = () => {
    setState((s) => ({
      ...s,
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }));
  };

  const resetDemoData = () => {
    setState(seedState());
  };

  // Cash reconciliation functions
  const getShiftCashSummary = () => {
    const cashPayments = state.orders
      .filter((o) => o.status === 'Paid' && o.paymentMethod === 'Cash')
      .map((o) => ({
        orderId: o.id,
        amount: o.total,
        time: o.paidAt || o.createdAt,
      }));
    
    const expectedCash = cashPayments.reduce((sum, p) => sum + p.amount, 0);
    
    return { expectedCash, cashPayments };
  };

  const reconcileCash = async (actualCash: number, managerPin: string) => {
    // Verify manager PIN format
    if (!managerPin || managerPin.length < 4) {
      throw new Error('Manager authentication required for cash reconciliation');
    }

    // Only Branch Manager and above can reconcile
    if (!hasPermission('refund')) {
      throw new Error('Manager approval required for cash reconciliation');
    }

    // Validate PIN against session (if PIN is stored in session)
    const session = readSession<any>();
    const storedPin = session?.pin || session?.staffPin;
    if (storedPin && managerPin !== String(storedPin)) {
      throw new Error('Invalid manager PIN');
    }

    const { expectedCash } = getShiftCashSummary();
    const difference = actualCash - expectedCash;
    
    let status: 'balanced' | 'short' | 'over';
    if (Math.abs(difference) < 0.01) {
      status = 'balanced';
    } else if (difference < 0) {
      status = 'short';
    } else {
      status = 'over';
    }

    // Log the reconciliation (use existing session)
    void auditLog({
      action: 'cash.reconciled',
      entity_type: 'shift',
      entity_id: session?.staffId || 'unknown',
      message: `Cash reconciliation: Expected ETB ${expectedCash.toFixed(2)}, Actual ETB ${actualCash.toFixed(2)}, Difference: ETB ${difference.toFixed(2)}`,
      meta: {
        expectedCash,
        actualCash,
        difference,
        status,
        managerId: session?.staffId,
        managerName: session?.staffName,
      },
    });

    return { difference, status };
  };

  const value: PosContextType = {
    products: state.products,
    tables: state.tables,
    orders: state.orders,
    notifications: state.notifications,
    realtime: realtimeStatus,
    outbox: outboxStatus,
    kitchenPrintByOrderId,
    getUiPref,
    setUiPref,
    selectedTableId: state.selectedTableId,
    selectedOrderId: state.selectedOrderId,
    selectTable,
    selectOrder,
    addTable,
    deleteTable,
    setTableAssignment,
    getCartItems,
    addToCart,
    removeFromCart,
    setCartQty,
    setCartItemNote,
    setCartItemModifiers,
    clearCart,
    getDraftOrderMeta,
    setDraftOrderMeta,
    addProduct,
    updateProductDetails,
    deleteProduct,
    updateProductPrice,
    sendOrderToKitchen,
    sendAdditionalOrderToKitchen,
    printKitchenTicket,
    retryKitchenTicket,
    importDraftToKitchenOrder,
    setPendingOrderItemQty,
    setPendingOrderItemNote,
    swapOrderItem,
    setOrderStatus,
    voidOrder,
    voidOrderItem,
    refundOrder,
    unlockOrder,
    confirmPayment,
    enterBillingMode,
    setOrderCustomer,
    setOrderSplits,
    setOrderType,
    markNotificationRead,
    markAllNotificationsRead,
    resetDemoData,
    refreshFromServer,
    queueOfflineWrite,
    getShiftCashSummary,
    reconcileCash,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export const usePos = () => {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePos must be used within a PosProvider');
  return ctx;
};

export const useSelectedOrder = () => {
  const { orders, selectedOrderId } = usePos();
  return useMemo(() => orders.find((o) => o.id === selectedOrderId) ?? null, [orders, selectedOrderId]);
};

export const useSelectedTable = () => {
  const { tables, selectedTableId } = usePos();
  return useMemo(() => tables.find((t) => t.id === selectedTableId) ?? null, [tables, selectedTableId]);
};

export const useTableOrders = (tableId: string | null) => {
  const { orders, tables } = usePos();
  return useMemo(() => {
    if (!tableId) return [];
    const table = tables.find((t) => t.id === tableId);
    if (!table) return [];
    const orderIds = table.openOrderIds || (table.openOrderId ? [table.openOrderId] : []);
    return orders.filter((o) => orderIds.includes(o.id));
  }, [orders, tables, tableId]);
};
