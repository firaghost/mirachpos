
import { Screen, UserRole } from './types';

export type SubscriptionInfo = { tier: string; modules: string[] };

export type PermissionList = string[];

export const normalizePermissions = (raw: unknown): PermissionList => {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).map((s) => s.trim()).filter(Boolean);
};

export const hasPermission = (permissions: unknown, required: string): boolean => {
  const perm = String(required || '').trim();
  if (!perm) return true;
  const list = normalizePermissions(permissions);
  return list.includes('*') || list.includes(perm);
};

const defaultModulesForTier = (tier: string): string[] => {
  const t = String(tier || '')
    .trim()
    .toLowerCase();
  if (t === 'trial') return ['settings'];
  if (t === 'basic') return ['pos', 'orders', 'tables', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'settings'];
  if (t === 'pro') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
  if (t === 'enterprise') return ['pos', 'orders', 'tables', 'guests', 'inventory', 'menu', 'staff', 'reports', 'finance', 'branches', 'owner_dashboard', 'settings'];
  return ['settings'];
};

const normalizeModuleKey = (m: unknown): string => {
  const raw = String(m ?? '').trim();
  if (!raw) return '';
  const k = raw.toLowerCase().replace(/\s+/g, '_');
  if (k === 'owner-dashboard' || k === 'ownerdashboard' || k === 'owner_dash') return 'owner_dashboard';
  if (k === 'branch' || k === 'branch_management' || k === 'branch_managements') return 'branches';
  if (k === 'report' || k === 'reporting') return 'reports';
  if (k === 'inventory_management') return 'inventory';
  if (k === 'menu_management') return 'menu';
  if (k === 'guest' || k === 'customer' || k === 'customers') return 'guests';
  return k;
};

const normalizedModules = (subscription: SubscriptionInfo | null | undefined): string[] => {
  const tier = String(subscription?.tier || '').trim();
  const modsRaw = Array.isArray(subscription?.modules) ? subscription!.modules : [];
  const seen = new Set<string>();
  const mods = [] as string[];
  for (const m of modsRaw) {
    const k = normalizeModuleKey(m);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    mods.push(k);
  }
  if (mods.length) return mods;
  if (!tier) return [];
  return defaultModulesForTier(tier);
};

export const homeForRole = (role: UserRole): Screen => {
  if (role === UserRole.WAITER) return Screen.WAITER_DASHBOARD;
  if (role === UserRole.WAITER_MANAGER) return Screen.WAITER_DASHBOARD;
  if (role === UserRole.BRANCH_MANAGER) return Screen.MANAGER_DASHBOARD;
  if (role === UserRole.CAFE_OWNER) return Screen.OWNER_DASHBOARD;
  return Screen.SA_OVERVIEW;
};

export const homeForRoleWithSubscription = (
  role: UserRole,
  subscription: SubscriptionInfo | null | undefined,
): Screen => {
  if (role !== UserRole.CAFE_OWNER) return homeForRole(role);
  const mods = normalizedModules(subscription);
  if (!mods.includes('owner_dashboard')) return Screen.OWNER_BILLING;
  return Screen.OWNER_DASHBOARD;
};

export const canAccessScreen = (role: UserRole, screen: Screen): boolean => {
  if (screen === Screen.LOGIN) return true;
  if (screen === Screen.BRANCH_SELECT) return role === UserRole.CAFE_OWNER || role === UserRole.SUPER_ADMIN;

  if (role === UserRole.WAITER || role === UserRole.WAITER_MANAGER) {
    return (
      screen === Screen.WAITER_DASHBOARD ||
      screen === Screen.WAITER_MENU ||
      screen === Screen.WAITER_REVIEW ||
      screen === Screen.WAITER_PAYMENT ||
      screen === Screen.WAITER_RECEIPT ||
      screen === Screen.WAITER_ACTIVE_ORDERS ||
      screen === Screen.WAITER_STATUS ||
      screen === Screen.WAITER_KDS ||
      screen === Screen.WAITER_HISTORY ||
      screen === Screen.WAITER_NOTIFICATIONS ||
      screen === Screen.WAITER_SYSTEM ||
      screen === Screen.WAITER_SETTINGS ||
      screen === Screen.WAITER_SHIFT_REPORT ||
      screen === Screen.WAITER_SCHEDULE ||
      screen === Screen.POS_FLOOR ||
      screen === Screen.POS_MENU
    );
  }

  if (role === UserRole.BRANCH_MANAGER) {
    return (
      screen === Screen.MANAGER_DASHBOARD ||
      screen === Screen.DESKTOP_DRAFT_INBOX ||
      screen === Screen.MANAGER_ORDERS ||
      screen === Screen.MANAGER_ORDER_DETAILS ||
      screen === Screen.MANAGER_FLOOR_MAP ||
      screen === Screen.MANAGER_TABLE_DETAILS ||
      screen === Screen.MANAGER_CUSTOMERS ||
      screen === Screen.MANAGER_INVENTORY ||
      screen === Screen.MANAGER_RECIPE_BUILDER ||
      screen === Screen.MANAGER_MENU_BUILDER ||
      screen === Screen.MANAGER_STAFF ||
      screen === Screen.STAFF_SCHEDULE ||
      screen === Screen.MANAGER_SETTINGS ||
      screen === Screen.MANAGER_FINANCE ||
      screen === Screen.MANAGER_REPORTS ||
      screen === Screen.WAITER_SETTINGS ||
      screen === Screen.TABLE_ASSIGNMENT ||
      screen === Screen.GUESTS ||
      screen === Screen.SUPPORT_REQUEST
    );
  }

  if (role === UserRole.CAFE_OWNER) {
    return (
      screen === Screen.OWNER_ONBOARDING ||
      screen === Screen.OWNER_DASHBOARD ||
      screen === Screen.DESKTOP_DRAFT_INBOX ||
      screen === Screen.OWNER_FINANCE ||
      screen === Screen.OWNER_REPORTS ||
      screen === Screen.OWNER_INVENTORY ||
      screen === Screen.OWNER_STAFF ||
      screen === Screen.OWNER_AUDIT ||
      screen === Screen.STAFF_SCHEDULE ||
      screen === Screen.OWNER_SETTINGS ||
      screen === Screen.OWNER_MENU ||
      screen === Screen.OWNER_BRANCHES ||
      screen === Screen.SUPPORT_REQUEST ||
      screen === Screen.MANAGER_DASHBOARD ||
      screen === Screen.MANAGER_ORDERS ||
      screen === Screen.MANAGER_ORDER_DETAILS ||
      screen === Screen.MANAGER_FLOOR_MAP ||
      screen === Screen.MANAGER_TABLE_DETAILS ||
      screen === Screen.MANAGER_CUSTOMERS ||
      screen === Screen.MANAGER_INVENTORY ||
      screen === Screen.MANAGER_RECIPE_BUILDER ||
      screen === Screen.MANAGER_MENU_BUILDER ||
      screen === Screen.MANAGER_STAFF ||
      screen === Screen.MANAGER_SETTINGS ||
      screen === Screen.MANAGER_FINANCE ||
      screen === Screen.MANAGER_REPORTS ||
      screen === Screen.WAITER_SETTINGS ||
      screen === Screen.TABLE_ASSIGNMENT ||
      screen === Screen.GUESTS ||
      screen === Screen.OWNER_BILLING
    );
  }

  return (
    screen === Screen.SA_OVERVIEW ||
    screen === Screen.SA_TENANTS ||
    screen === Screen.SA_TENANT_DETAILS ||
    screen === Screen.SA_ONBOARDING ||
    screen === Screen.SA_BILLING ||
    screen === Screen.SA_PAYMENT_CONFIG ||
    screen === Screen.SA_INTEGRATIONS ||
    screen === Screen.SA_ADDONS ||
    screen === Screen.SA_SYSTEM_HEALTH ||
    screen === Screen.SA_SUPPORT ||
    screen === Screen.SA_AUDIT ||
    screen === Screen.SA_FEATURE_FLAGS ||
    screen === Screen.SA_SETTINGS ||
    screen === Screen.SA_DEMO_REQUESTS
  );
};

const screenRequiredModule = (screen: Screen): string | null => {
  switch (screen) {
    case Screen.OWNER_ONBOARDING:
      return null;

    case Screen.SUPPORT_REQUEST:
      return null;

    case Screen.BRANCH_SELECT:
      return 'branches';

    case Screen.WAITER_DASHBOARD:
    case Screen.WAITER_MENU:
    case Screen.WAITER_REVIEW:
    case Screen.WAITER_PAYMENT:
    case Screen.WAITER_RECEIPT:
    case Screen.WAITER_ACTIVE_ORDERS:
    case Screen.WAITER_STATUS:
    case Screen.WAITER_KDS:
    case Screen.WAITER_HISTORY:
    case Screen.WAITER_NOTIFICATIONS:
    case Screen.WAITER_SYSTEM:
    case Screen.WAITER_SETTINGS:
    case Screen.WAITER_SHIFT_REPORT:
    case Screen.WAITER_SCHEDULE:
    case Screen.POS_FLOOR:
    case Screen.POS_MENU:
      return 'pos';

    case Screen.MANAGER_ORDERS:
    case Screen.MANAGER_ORDER_DETAILS:
    case Screen.DESKTOP_DRAFT_INBOX:
      return 'orders';

    case Screen.MANAGER_FLOOR_MAP:
    case Screen.MANAGER_TABLE_DETAILS:
    case Screen.TABLE_ASSIGNMENT:
      return 'tables';

    case Screen.GUESTS:
      return 'guests';

    case Screen.OWNER_DASHBOARD:
      return 'owner_dashboard';

    case Screen.OWNER_AUDIT:
      return null;

    case Screen.OWNER_BRANCHES:
      return 'branches';

    case Screen.MANAGER_REPORTS:
      return 'reports';

    case Screen.OWNER_REPORTS:
      return null;

    case Screen.MANAGER_INVENTORY:
    case Screen.OWNER_INVENTORY:
      return 'inventory';

    case Screen.MANAGER_STAFF:
    case Screen.OWNER_STAFF:
    case Screen.STAFF_SCHEDULE:
      return 'staff';

    case Screen.MANAGER_SETTINGS:
    case Screen.OWNER_SETTINGS:
    case Screen.OWNER_BILLING:
      return null;

    case Screen.MANAGER_MENU_BUILDER:
    case Screen.OWNER_MENU:
      return 'menu';

    case Screen.MANAGER_FINANCE:
    case Screen.OWNER_FINANCE:
      return 'finance';

    default:
      return null;
  }
};

export const canAccessScreenWithSubscription = (
  role: UserRole,
  screen: Screen,
  subscription: SubscriptionInfo | null | undefined,
): boolean => {
  if (!canAccessScreen(role, screen)) return false;
  if (role === UserRole.SUPER_ADMIN) return true;
  // Only Cafe Owner screens are module-gated by subscription.
  // Waiter/Branch Manager should never be blocked by missing subscription payload.
  if (role !== UserRole.CAFE_OWNER) return true;
  const required = screenRequiredModule(screen);
  if (!required) return true;
  const mods = normalizedModules(subscription);
  return mods.includes(required);
};

const screenRequiredPermission = (screen: Screen): string | null => {
  switch (screen) {
    // Waiter core
    case Screen.WAITER_DASHBOARD:
    case Screen.WAITER_MENU:
    case Screen.WAITER_REVIEW:
    case Screen.WAITER_PAYMENT:
    case Screen.WAITER_RECEIPT:
    case Screen.WAITER_ACTIVE_ORDERS:
    case Screen.WAITER_STATUS:
    case Screen.WAITER_KDS:
    case Screen.WAITER_HISTORY:
    case Screen.WAITER_NOTIFICATIONS:
    case Screen.WAITER_SYSTEM:
    case Screen.WAITER_SETTINGS:
    case Screen.WAITER_SHIFT_REPORT:
    case Screen.WAITER_SCHEDULE:
    case Screen.POS_FLOOR:
    case Screen.POS_MENU:
      return 'orders.read';

    // Manager
    case Screen.MANAGER_ORDERS:
    case Screen.MANAGER_ORDER_DETAILS:
    case Screen.DESKTOP_DRAFT_INBOX:
      return 'orders.read';
    case Screen.MANAGER_REPORTS:
      return 'reports.read';
    case Screen.MANAGER_FINANCE:
      return 'finance.read';
    case Screen.MANAGER_INVENTORY:
      return 'inventory.read';
    case Screen.MANAGER_STAFF:
    case Screen.STAFF_SCHEDULE:
      return 'staff.read';
    case Screen.MANAGER_SETTINGS:
      return 'manager.settings.read';
    case Screen.MANAGER_CUSTOMERS:
    case Screen.GUESTS:
      return 'orders.read';

    // Owner
    case Screen.OWNER_DASHBOARD:
    case Screen.OWNER_REPORTS:
      return 'reports.read';
    case Screen.OWNER_FINANCE:
      return 'finance.read';
    case Screen.OWNER_INVENTORY:
      return 'inventory.read';
    case Screen.OWNER_STAFF:
      return 'staff.read';
    case Screen.OWNER_AUDIT:
    case Screen.OWNER_SETTINGS:
    case Screen.OWNER_BILLING:
      return 'settings.manage';
    case Screen.OWNER_MENU:
      return 'menu.manage';
    case Screen.OWNER_BRANCHES:
      return 'branches.read';

    default:
      return null;
  }
};

export const canAccessScreenWithPermissions = (
  role: UserRole,
  screen: Screen,
  subscription: SubscriptionInfo | null | undefined,
  permissions: unknown,
): boolean => {
  if (!canAccessScreenWithSubscription(role, screen, subscription)) return false;
  const required = screenRequiredPermission(screen);
  if (!required) return true;
  return hasPermission(permissions, required);
};
