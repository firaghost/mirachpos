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

    return {
      ...incoming,
      assignedStaffId: assignedStaffId ?? null,
      assignedStaffName: assignedStaffName ?? null,
    };
  });
};

const mergeBranchState = (current: PersistedState, incoming: any): PersistedState => {
  if (!incoming || typeof incoming !== 'object') return current;

  const incomingTables = (incoming as any).tables;
  const incomingProducts = (incoming as any).products;

  const next: PersistedState = {
    ...current,
    ...incoming,
    version: 1,
  };

  // Avoid wiping tables/products if server/state contains empty arrays (common when state is partially saved).
  if (Array.isArray(incomingProducts) && incomingProducts.length > 0) next.products = incomingProducts as any;
  if (Array.isArray(incomingTables) && incomingTables.length > 0) next.tables = mergeTablesPreservingAssignments(current.tables, incomingTables);
  else next.tables = current.tables;
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
    const t = w.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // ignore
      }
    }, 250);
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
  selectedTableId: string | null;
  selectedOrderId: string | null;
  selectTable: (tableId: string | null) => void;
  selectOrder: (orderId: string | null) => void;
  addTable: (table: { name: string; seats: number; area?: PosTable['area'] }) => string;
  deleteTable: (tableId: string) => void;
  setTableAssignment: (tableIds: string[], staffId: string | null, staffName?: string | null) => void;
  getCartItems: (tableId: string) => PosOrderItem[];
  addToCart: (tableId: string, productId: string) => void;
  removeFromCart: (tableId: string, productId: string) => void;
  setCartQty: (tableId: string, productId: string, qty: number) => void;
  setCartItemNote: (tableId: string, productId: string, note: string) => void;
  clearCart: (tableId: string) => void;
  addProduct: (product: { name: string; category: string; price: number; image: string; stock?: number; description?: string }) => string;
  updateProductDetails: (
    productId: string,
    patch: { name?: string; category?: string; price?: number; image?: string; description?: string; stock?: number },
  ) => void;
  deleteProduct: (productId: string) => void;
  updateProductPrice: (productId: string, price: number) => void;
  sendOrderToKitchen: (tableId: string, notes?: string) => string;
  importDraftToKitchenOrder: (args: {
    draftId: string;
    createdByStaffId?: string;
    notes?: string;
    tableId?: string;
    items: Array<{ productId: string; name: string; unitPrice: number; qty: number; note?: string }>;
  }) => string;
  setPendingOrderItemQty: (orderId: string, productId: string, qty: number) => void;
  setPendingOrderItemNote: (orderId: string, productId: string, note: string) => void;
  setOrderStatus: (orderId: string, status: PosOrder['status']) => void;
  voidOrder: (orderId: string, reason?: string) => void;
  voidOrderItem: (orderId: string, productId: string, qty: number, reason?: string) => void;
  confirmPayment: (orderId: string, paymentMethod: PaymentMethod, tenderedAmount?: number, splitId?: string, paymentReference?: string) => void;
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
  markNotificationRead: (notificationId: string, read: boolean) => void;
  markAllNotificationsRead: () => void;
  resetDemoData: () => void;
  refreshFromServer: () => Promise<void>;
};

type PersistedState = {
  version: number;
  products: Product[];
  tables: PosTable[];
  orders: PosOrder[];
  notifications: PosNotification[];
  cartByTableId: Record<string, PosOrderItem[]>;
  selectedTableId: string | null;
  selectedOrderId: string | null;
};

const STORAGE_KEY = 'mirachpos.state.v1';

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
    if (!raw) return { vatEnabled: true, vatRate: 15, serviceEnabled: false, serviceRate: 10 };
    const parsed = JSON.parse(raw) as BranchSettingsPricing;
    const vatEnabled = parsed?.taxes?.vatEnabled !== false;
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
    return { vatEnabled: true, vatRate: 15, serviceEnabled: false, serviceRate: 10 };
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
    selectedTableId: null,
    selectedOrderId: null,
  };
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
  const lastSentRef = useRef<string>('');

  const getBranchScopeKey = () => {
    try {
      const s = readSession<any>();
      if (!s) return '';
      const tenantId = typeof s?.tenantId === 'string' ? s.tenantId : '';
      const branchId = (() => {
        const b = typeof s?.branchId === 'string' ? s.branchId : '';
        if (b && b.trim()) return b.trim();
        try {
          return (
            localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
            ''
          );
        } catch {
          return '';
        }
      })();
      if (!tenantId || !branchId) return '';
      return `tenant:${tenantId}:branch:${branchId}:pos_state_v1`;
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
      const tokenBranch = fromToken && fromToken.trim() ? fromToken.trim() : '';

      if (role === 'Cafe Owner' || role === 'Waiter Manager') {
        if (tokenBranch && tokenBranch !== 'global') return tokenBranch;
        try {
          const selected =
            localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
            localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
            '';
          return selected ? selected.trim() : '';
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
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      const tokenBranch = typeof s?.branchId === 'string' ? s.branchId : '';
      const needsQueryBranch = (role === 'Cafe Owner' || role === 'Waiter Manager') && (!tokenBranch || !tokenBranch.trim() || tokenBranch.trim() === 'global');
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
    return {
      posUpsertProducts: typeof pos?.upsertProducts === 'function' ? (pos.upsertProducts as (p: any) => Promise<any>) : null,
      posListProducts: typeof pos?.listProducts === 'function' ? (pos.listProducts as (p: any) => Promise<any>) : null,
      posUpsertOrderBundle: typeof pos?.upsertOrderBundle === 'function' ? (pos.upsertOrderBundle as (p: any) => Promise<any>) : null,
      posGetOrderBundle: typeof pos?.getOrderBundle === 'function' ? (pos.getOrderBundle as (p: any) => Promise<any>) : null,
      posListOrders: typeof pos?.listOrders === 'function' ? (pos.listOrders as (p: any) => Promise<any>) : null,
      outboxEnqueue: typeof outbox?.enqueue === 'function' ? (outbox.enqueue as (p: any) => Promise<any>) : null,
      outboxListReady: typeof outbox?.listReady === 'function' ? (outbox.listReady as (p: any) => Promise<any>) : null,
      outboxAck: typeof outbox?.ack === 'function' ? (outbox.ack as (p: any) => Promise<any>) : null,
      outboxBump: typeof outbox?.bump === 'function' ? (outbox.bump as (p: any) => Promise<any>) : null,
    };
  }, []);

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
      }
    },
    [electronApis],
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

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        if (!isBranchUser) return;
        const scopeKey = getBranchScopeKey();
        if (!scopeKey) return;
        if (!electronApis.posListProducts && !electronApis.posListOrders) return;

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

      // 1) Refresh tables from DB
      try {
        const tres = await apiFetch(withBranchQuery('/api/pos/tables'));
        const tjson = (await tres.json().catch(() => null)) as any;
        if (tres.ok) {
          const rows = Array.isArray(tjson?.tables) ? (tjson.tables as any[]) : [];
          const incomingTables = toPosTables(rows);
          setState((s) => ({ ...s, tables: updateTableComputed(incomingTables, s.cartByTableId) }));
        } else {
          // If tables are missing, try initialize then re-fetch.
          await apiFetch(withBranchQuery('/api/pos/initialize'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          const tres2 = await apiFetch(withBranchQuery('/api/pos/tables'));
          const tjson2 = (await tres2.json().catch(() => null)) as any;
          if (tres2.ok) {
            const rows2 = Array.isArray(tjson2?.tables) ? (tjson2.tables as any[]) : [];
            const incomingTables2 = toPosTables(rows2);
            setState((s) => ({ ...s, tables: updateTableComputed(incomingTables2, s.cartByTableId) }));
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
            }))
            .filter((p) => p.id && p.name);
          if (nextProducts.length) setState((prev) => ({ ...prev, products: nextProducts }));

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
        const res = await apiFetch(withBranchQuery('/api/pos/orders?limit=200'));
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as any;
        const rows = Array.isArray(json?.orders) ? (json.orders as any[]) : [];

        const serverOrders: PosOrder[] = rows
          .map((r) => {
            const id = String(r?.id || '');
            const status = String(r?.status || 'Pending') as any;
            const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};

            const createdAt = typeof r?.createdAt === 'string' && r.createdAt ? r.createdAt : typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString();
            const number = typeof payload?.number === 'string' && payload.number ? payload.number : id;
            const tableId = typeof payload?.tableId === 'string' ? payload.tableId : '';
            const tableName = typeof payload?.tableName === 'string' ? payload.tableName : '';
            const items = Array.isArray(payload?.items) ? (payload.items as any[]) : [];

            const tipFromBreakdown =
              (Number(payload?.tipAmount ?? 0) || 0) + (Number(payload?.tipPctAmount ?? 0) || 0);
            const tip = Number(r?.tip ?? payload?.tip ?? tipFromBreakdown ?? 0) || 0;

            const total = Number(r?.total ?? payload?.totalWithTip ?? payload?.paidTotal ?? payload?.total ?? 0) || 0;
            const tax = Number(r?.tax ?? payload?.tax ?? 0) || 0;
            const discount = Number(r?.discount ?? payload?.discount ?? 0) || 0;
            const subtotal = Number(payload?.subtotal ?? Math.max(0, total - tax - tip)) || 0;
            const serviceCharge = Number(payload?.serviceCharge ?? 0) || 0;

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

          return { ...prev, orders: mergedOrders, tables: updateTableComputed(nextTables as any, prev.cartByTableId) };
        });

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
  }, [isBranchUser, electronApis, buildLocalOrderBundle]);

  const persistOrder = useCallback(
    async (order: PosOrder) => {
      if (!isBranchUser) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
      if (!remoteReady) return false;

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
        },
      };

      try {
        const putRes = await apiFetch(withBranchQuery(`/api/pos/orders/${encodeURIComponent(order.id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (putRes.ok) return true;
        if (putRes.status !== 404) return false;
      } catch {
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
        return false;
      }
    },
    [isBranchUser, remoteReady],
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
    const trySync = async () => {
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
                } else if (kind === 'pos.state') {
                  // Deprecated legacy behavior.
                  // We no longer sync whole POS JSON state to the server.
                  await electronApis.outboxBump!({ id, delayMs: 60_000 });
                  continue;
                } else {
                  await electronApis.outboxBump!({ id, delayMs: 30_000 });
                  continue;
                }
                if (!res.ok) {
                  await electronApis.outboxBump!({ id, delayMs: 15000 });
                  continue;
                }
                ackIds.push(id);
              } catch {
                await electronApis.outboxBump!({ id, delayMs: 20000 });
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

      const snapshot = state;

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
  }, [isBranchUser, remoteReady, state]);

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

  const updateTableComputed = (tables: PosTable[], cartByTableId: Record<string, PosOrderItem[]>) => {
    return tables.map((t) => {
      const cartItems = cartByTableId[t.id] ?? [];
      const subtotal = calcSubtotal(cartItems);
      return {
        ...t,
        cartItemCount: cartItems.reduce((sum, i) => sum + i.qty, 0),
        currentTotal: calcTotal(subtotal),
      };
    });
  };

  const addTable = (table: { name: string; seats: number; area?: PosTable['area'] }) => {
    const id = generateId();
    setState((s) => {
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
            assignedStaffId: null,
            assignedStaffName: null,
          },
          ...s.tables,
        ],
        s.cartByTableId,
      );
      const nextState = { ...s, tables: nextTables };
      return nextState;
    });

    queueMicrotask(() => {
      const url = withBranchQuery('/api/pos/tables');
      const body = { id, name: table.name, seats: table.seats, area: table.area ?? null };
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
            const url = withBranchQuery(`/api/pos/tables/${encodeURIComponent(id)}`);
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
  };

  const selectOrder = (orderId: string | null) => {
    setState((s) => ({ ...s, selectedOrderId: orderId }));
  };

  const getCartItems = (tableId: string) => state.cartByTableId[tableId] ?? [];

  const addToCart = (tableId: string, productId: string) => {
    setState((s) => {
      const product = s.products.find((p) => p.id === productId);
      if (!product || product.stock <= 0) return s;

      const existing = s.cartByTableId[tableId] ?? [];
      const idx = existing.findIndex((i) => i.productId === productId);
      let nextItems: PosOrderItem[];
      if (idx >= 0) {
        nextItems = existing.map((i) => (i.productId === productId ? { ...i, qty: i.qty + 1 } : i));
      } else {
        nextItems = [...existing, { productId, name: product.name, unitPrice: product.price, qty: 1 }];
      }

      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);

      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const setCartItemNote = (tableId: string, productId: string, note: string) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      const nextItems = existing.map((i) => (i.productId === productId ? { ...i, note } : i));
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const removeFromCart = (tableId: string, productId: string) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      const nextItems = existing.filter((i) => i.productId !== productId);
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);
      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const setCartQty = (tableId: string, productId: string, qty: number) => {
    setState((s) => {
      const existing = s.cartByTableId[tableId] ?? [];
      if (qty <= 0) {
        const nextItems = existing.filter((i) => i.productId !== productId);
        const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
        const nextTables = updateTableComputed(s.tables, nextCartByTableId);
        return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
      }

      const product = s.products.find((p) => p.id === productId);
      if (!product) return s;

      const nextItems = existing.map((i) => (i.productId === productId ? { ...i, qty } : i));
      const nextCartByTableId = { ...s.cartByTableId, [tableId]: nextItems };
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);

      return { ...s, cartByTableId: nextCartByTableId, tables: nextTables };
    });
  };

  const clearCart = (tableId: string) => {
    setState((s) => {
      const nextCartByTableId = { ...s.cartByTableId };
      delete nextCartByTableId[tableId];
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);
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
      const nextTables = updateTableComputed(s.tables, nextCartByTableId);
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

    const subtotal = calcSubtotal(cartItems);
    const tax = calcTax(subtotal);
    const serviceCharge = calcServiceCharge(subtotal);
    const total = calcTotal(subtotal);
    const now = new Date();

    const newOrder: PosOrder = {
      id: orderId,
      number: orderNumberFromId(orderId),
      tableId,
      tableName,
      createdByStaffId,
      createdByName,
      items: cartItems,
      subtotal,
      tax,
      serviceCharge,
      total,
      status: 'Pending',
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

        // Ensure the order exists in DB before attempting to print (print endpoint loads order from DB).
        void (async () => {
          try {
            await persistOrder(order);
          } catch {
            // ignore
          }

          if (separateDrinkTickets && hasBarRoute) {
            const drinks = allLines.filter((l) => isDrinkLine(l.name));
            const food = allLines.filter((l) => !isDrinkLine(l.name));

            if (food.length > 0) {
              void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines: food, beep }),
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
                body: JSON.stringify({ lines: drinks, beep }),
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
            void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines: allLines, beep }),
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
    const tax = calcTax(subtotal);
    const serviceCharge = calcServiceCharge(subtotal);
    const total = calcTotal(subtotal);
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
      status: 'Pending',
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

        if (separateDrinkTickets && hasBarRoute) {
          const drinks = allLines.filter((l) => isDrinkLine(l.name));
          const food = allLines.filter((l) => !isDrinkLine(l.name));

          if (food.length > 0) {
            void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines: food, beep }),
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
              body: JSON.stringify({ lines: drinks, beep }),
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
          void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(String(orderId))}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines: allLines, beep }),
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
      if (order.status !== 'Pending') return s;
      if (qty <= 0) return s;

      const nextOrders = s.orders.map((o) => {
        if (o.id !== orderId) return o;
        const nextItems = o.items.map((i) => (i.productId === productId ? { ...i, qty } : i));
        const subtotal = calcSubtotalEffective(nextItems);
        const tax = calcTax(subtotal);
        const serviceCharge = calcServiceCharge(subtotal);
        const total = calcTotal(subtotal);
        return { ...o, items: nextItems, subtotal, tax, serviceCharge, total, syncedToServer: false };
      });

      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      return { ...s, orders: nextOrders };
    });

    queueMicrotask(() => {
      try {
        if (updatedOrder) upsertLocalOrderBundle(updatedOrder);
      } catch {
        // ignore
      }
    });
  };

  const setPendingOrderItemNote = (orderId: string, productId: string, note: string) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      if (order.status !== 'Pending') return s;

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
        tables: updateTableComputed(nextTables, s.cartByTableId),
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
                  void apiFetch(withBranchQuery(`/api/pos/print/kitchen/${encodeURIComponent(updatedOrder.id)}`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: state.settings.defaultKitchenPrinterId }),
                  }).catch(() => { });
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
      if (order.status === 'Paid' || order.status === 'Voided' || order.status === 'Refunded') return s;
      if (!reason?.trim()) return s;

      if (order.inventoryDeducted) {
        adjustInventoryByOrder(order, 'restock');
      }

      const now = new Date();
      const nextOrders = s.orders.map((o) =>
        o.id === orderId
          ? { ...o, status: 'Voided', voidedAt: now.toISOString(), voidReason: reason.trim(), syncedToServer: false }
          : o,
      );
      updatedOrder = nextOrders.find((o) => o.id === orderId) || null;

      const nextTables = s.tables.map((t) =>
        t.openOrderId === orderId ? { ...t, status: 'Free', openOrderId: null, lastOrderId: orderId } : t,
      );

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
        tables: updateTableComputed(nextTables, s.cartByTableId),
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

  const voidOrderItem = (orderId: string, productId: string, qty: number, reason?: string) => {
    let updatedOrder: PosOrder | null = null;
    setState((s) => {
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return s;
      if (order.status === 'Paid' || order.status === 'Voided' || order.status === 'Refunded') return s;
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
        const tax = calcTax(subtotal);
        const serviceCharge = calcServiceCharge(subtotal);
        const total = calcTotal(subtotal);

        const nextStatus = nextItems.every((it) => effectiveQty(it) === 0) ? 'Voided' : o.status;
        return {
          ...o,
          items: nextItems,
          subtotal,
          tax,
          serviceCharge,
          total,
          status: nextStatus,
          voidReason: nextStatus === 'Voided' ? reason.trim() : o.voidReason,
          syncedToServer: false,
        };
      });

      const nextTables = s.tables.map((t) => {
        if (t.openOrderId !== orderId) return t;
        const updated = nextOrders.find((x) => x.id === orderId);
        if (updated?.status === 'Voided') return { ...t, status: 'Free', openOrderId: null };
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
        tables: updateTableComputed(nextTables, s.cartByTableId),
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

  const confirmPayment = (orderId: string, paymentMethod: PaymentMethod, tenderedAmount?: number, splitId?: string, paymentReference?: string) => {
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
      if (order.status !== 'Served') return s;

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
            syncedToServer: false,
          };
        }

        const nextSplits = (o.splits || []).map((sp) =>
          sp.id === splitId
            ? { ...sp, status: 'Paid', paidAt: now.toISOString(), paymentMethod, tenderedAmount, paymentReference }
            : sp,
        );
        const allPaid = nextSplits.length > 0 && nextSplits.every((sp) => sp.status === 'Paid');
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

      const nextTables = s.tables.map((t) =>
        t.openOrderId !== orderId
          ? t
          : shouldCloseTable
            ? { ...t, status: 'Free', openOrderId: null, lastOrderId: orderId }
            : t,
      );

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

      return {
        ...s,
        products: nextProducts,
        orders: nextOrders,
        tables: updateTableComputed(nextTables, s.cartByTableId),
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

    void auditLog({
      action: 'payment.recorded',
      entity_type: 'order',
      entity_id: orderId,
      message: `Payment recorded via ${paymentMethod}`,
      meta: { paymentMethod, tenderedAmount: tenderedAmount ?? null, splitId: splitId ?? null, paymentReference: paymentReference ?? null },
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

  const value: PosContextType = {
    products: state.products,
    tables: state.tables,
    orders: state.orders,
    notifications: state.notifications,
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
    clearCart,
    addProduct,
    updateProductDetails,
    deleteProduct,
    updateProductPrice,
    sendOrderToKitchen,
    importDraftToKitchenOrder,
    setPendingOrderItemQty,
    setPendingOrderItemNote,
    setOrderStatus,
    voidOrder,
    voidOrderItem,
    confirmPayment,
    setOrderCustomer,
    setOrderSplits,
    markNotificationRead,
    markAllNotificationsRead,
    resetDemoData,
    refreshFromServer,
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
