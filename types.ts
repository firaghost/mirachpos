
export enum UserRole {
  WAITER = 'Waiter',
  WAITER_MANAGER = 'Waiter Manager',
  BRANCH_MANAGER = 'Branch Manager',
  CAFE_OWNER = 'Cafe Owner',
  SUPER_ADMIN = 'Super Admin'
}

export enum Screen {
  LOGIN = 'LOGIN',
  BRANCH_SELECT = 'BRANCH_SELECT',
  OWNER_ONBOARDING = 'OWNER_ONBOARDING',
  SUPPORT_REQUEST = 'SUPPORT_REQUEST',

  DESKTOP_DRAFT_INBOX = 'DESKTOP_DRAFT_INBOX',

  // Shared/General
  DASHBOARD = 'DASHBOARD',
  ORDERS = 'ORDERS',

  // Waiter Specific
  WAITER_DASHBOARD = 'WAITER_DASHBOARD', // Floor View
  WAITER_MENU = 'WAITER_MENU',            // Order Builder
  WAITER_REVIEW = 'WAITER_REVIEW',        // Order Review
  WAITER_PAYMENT = 'WAITER_PAYMENT',      // Payment
  WAITER_RECEIPT = 'WAITER_RECEIPT',      // Receipt / Print
  WAITER_ACTIVE_ORDERS = 'WAITER_ACTIVE_ORDERS', // Active Orders
  WAITER_STATUS = 'WAITER_STATUS',        // Kitchen Status (Simple)
  WAITER_KDS = 'WAITER_KDS',              // Full KDS View
  WAITER_HISTORY = 'WAITER_HISTORY',      // Order History
  WAITER_NOTIFICATIONS = 'WAITER_NOTIFICATIONS',
  WAITER_SYSTEM = 'WAITER_SYSTEM',        // Connectivity
  WAITER_DRAFT_SIM = 'WAITER_DRAFT_SIM',  // Simulate Mobile Draft
  WAITER_SETTINGS = 'WAITER_SETTINGS',
  WAITER_SHIFT_REPORT = 'WAITER_SHIFT_REPORT',
  WAITER_SCHEDULE = 'WAITER_SCHEDULE',

  // Legacy/Shared (Keep for compatibility if needed, otherwise rely on WAITER_*)
  POS_FLOOR = 'POS_FLOOR',
  POS_MENU = 'POS_MENU',
  TABLE_ASSIGNMENT = 'TABLE_ASSIGNMENT',
  GUESTS = 'GUESTS',

  // Cafe Owner (Global) Screens
  OWNER_DASHBOARD = 'OWNER_DASHBOARD',
  OWNER_FINANCE = 'OWNER_FINANCE',
  OWNER_REPORTS = 'OWNER_REPORTS',
  OWNER_INVENTORY = 'OWNER_INVENTORY',
  OWNER_STAFF = 'OWNER_STAFF',
  OWNER_AUDIT = 'OWNER_AUDIT',
  OWNER_SETTINGS = 'OWNER_SETTINGS',
  OWNER_MENU = 'OWNER_MENU',
  OWNER_BRANCHES = 'OWNER_BRANCHES',
  OWNER_BILLING = 'OWNER_BILLING',

  // Branch Manager (Local) Screens
  MANAGER_DASHBOARD = 'MANAGER_DASHBOARD',
  MANAGER_ORDERS = 'MANAGER_ORDERS',
  MANAGER_ORDER_DETAILS = 'MANAGER_ORDER_DETAILS',
  MANAGER_FLOOR_MAP = 'MANAGER_FLOOR_MAP',
  MANAGER_TABLE_DETAILS = 'MANAGER_TABLE_DETAILS',
  MANAGER_CUSTOMERS = 'MANAGER_CUSTOMERS',
  MANAGER_INVENTORY = 'MANAGER_INVENTORY',
  MANAGER_RECIPE_BUILDER = 'MANAGER_RECIPE_BUILDER',
  MANAGER_MENU_BUILDER = 'MANAGER_MENU_BUILDER',
  MANAGER_STAFF = 'MANAGER_STAFF',
  MANAGER_SETTINGS = 'MANAGER_SETTINGS',
  MANAGER_FINANCE = 'MANAGER_FINANCE',
  MANAGER_REPORTS = 'MANAGER_REPORTS',

  STAFF_SCHEDULE = 'STAFF_SCHEDULE',

  // Super Admin Screens
  SA_OVERVIEW = 'SA_OVERVIEW',
  SA_TENANTS = 'SA_TENANTS',
  SA_TENANT_DETAILS = 'SA_TENANT_DETAILS',
  SA_ONBOARDING = 'SA_ONBOARDING',
  SA_BILLING = 'SA_BILLING',
  SA_PAYMENT_CONFIG = 'SA_PAYMENT_CONFIG',
  SA_SYSTEM_HEALTH = 'SA_SYSTEM_HEALTH',
  SA_SUPPORT = 'SA_SUPPORT',
  SA_AUDIT = 'SA_AUDIT',
  SA_FEATURE_FLAGS = 'SA_FEATURE_FLAGS',
  SA_SETTINGS = 'SA_SETTINGS',
  SA_DEMO_REQUESTS = 'SA_DEMO_REQUESTS'
}

export interface Product {
  id: string;
  code: string;
  name: string;
  price: number;
  category: string;
  image: string;
  description?: string;
  stock: number;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
}

export interface Recipe {
  productId: string;
  productName: string;
  ingredients: { ingredientId: string; name: string; quantity: number; cost: number }[];
  totalCost: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  minStock: number;
  price: number;
  status: 'In Stock' | 'Low Stock' | 'Critical';
}

export interface Table {
  id: string;
  name: string;
  area?: 'Main Hall' | 'Patio' | 'Bar Area' | 'Private Room';
  status: 'Free' | 'Occupied' | 'Reserved' | 'Payment';
  seats: number;
  orderTotal?: number;
  time?: string;
}

export type PosOrderStatus = 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Paid' | 'Voided' | 'Refunded';

export interface PosOrderItem {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  voidedQty?: number;
  note?: string;
  voidReason?: string;
}

export interface PosOrder {
  id: string;
  number: string;
  tableId: string;
  tableName: string;
  createdByStaffId?: string;
  createdByName?: string;
  items: PosOrderItem[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  total: number;
  status: PosOrderStatus;
  createdAt: string;
  timeLabel: string;
  inventoryDeducted?: boolean;
  syncedToServer?: boolean;
  syncedAt?: string;
  notes?: string;
  paidAt?: string;
  paymentMethod?: 'Cash' | 'Card' | 'Telebirr' | 'Bank Transfer' | 'Loyalty';
  tenderedAmount?: number;
  paymentReference?: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
    loyaltyPoints: number;
    loyaltyBalance: number;
  };
  splits?: Array<{
    id: string;
    status: 'Unpaid' | 'Paid';
    items: Array<{ productId: string; qty: number }>;
    subtotal: number;
    tax: number;
    serviceCharge: number;
    total: number;
    paidAt?: string;
    paymentMethod?: 'Cash' | 'Card' | 'Telebirr' | 'Bank Transfer' | 'Loyalty';
    tenderedAmount?: number;
    paymentReference?: string;
  }>;
  voidedAt?: string;
  voidReason?: string;
}

export interface PosTable extends Table {
  openOrderId: string | null;
  lastOrderId?: string | null;
  cartItemCount: number;
  currentTotal: number;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
}

export interface Order {
  id: string;
  table: string;
  items: string;
  total: number;
  status: 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Paid' | 'Refunded';
  time: string;
  staff: string;
}
