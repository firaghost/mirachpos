
import React, { useMemo, useState } from 'react';
import { Screen, UserRole } from '../types';
import { useTheme } from '../ThemeContext';
import { usePos } from '../PosContext';

interface SidebarProps {
  currentScreen: Screen;
  setScreen: (screen: Screen) => void;
  role: UserRole;
  logout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentScreen, setScreen, role, logout }) => {
  const { theme, toggleTheme } = useTheme();
  const { orders, notifications } = usePos();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const readyBadge = role === UserRole.WAITER ? orders.filter((o) => o.status === 'Ready').length : 0;
  const unreadBadge = role === UserRole.WAITER ? notifications.filter((n) => !n.read).length : 0;
  
  const NavItem = ({ screen, icon, label, badge }: { screen: Screen; icon: string; label: string, badge?: string }) => (
    <button
      onClick={() => setScreen(screen)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative ${
        currentScreen === screen
          ? 'bg-primary/10 border-l-2 border-primary text-primary dark:text-white'
          : 'text-slate-500 dark:text-[#c9b792] hover:bg-slate-200 dark:hover:bg-[#2c2417] hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      <span className={`material-symbols-outlined ${currentScreen === screen ? 'fill-current' : ''}`}>
        {icon}
      </span>
      <span className={`text-sm font-medium ${currentScreen === screen ? 'font-bold' : ''}`}>
        {label}
      </span>
      {badge && (
          <span className="absolute right-2 top-2.5 bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              {badge}
          </span>
      )}
    </button>
  );

  const getRoleLabel = () => {
      switch(role) {
          case UserRole.SUPER_ADMIN: return "Super Admin";
          case UserRole.CAFE_OWNER: return "Owner";
          case UserRole.BRANCH_MANAGER: return "Manager";
          case UserRole.WAITER: return "Waiter";
          default: return "Staff";
      }
  }

  const openManagerSettingsTab = (tab: string) => {
    try {
      window.location.hash = tab;
    } catch {
      // ignore
    }
    setScreen(Screen.MANAGER_SETTINGS);
  };

  const managerSettingsTabs = useMemo(
    () => [
      { key: 'hardware', label: 'Printers & Hardware', icon: 'print' },
      { key: 'general', label: 'General Preferences', icon: 'tune' },
      { key: 'branch', label: 'Branch Info', icon: 'store' },
      { key: 'hours', label: 'Operating Hours', icon: 'schedule' },
      { key: 'taxes', label: 'Taxes & Service', icon: 'percent' },
    ],
    [],
  );

  return (
    <aside className="w-64 h-full bg-white dark:bg-[#1e1910] border-r border-slate-200 dark:border-[#483c23] flex flex-col shrink-0 transition-all duration-300 z-50">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-[#8a6213] flex items-center justify-center text-white shadow-lg shadow-primary/20">
          <span className="material-symbols-outlined text-[24px]">local_cafe</span>
        </div>
        <div className="flex flex-col">
          <h1 className="text-slate-900 dark:text-white text-lg font-bold leading-none tracking-tight">MirachPos</h1>
          <p className="text-slate-500 dark:text-[#c9b792] text-xs font-medium uppercase tracking-wider mt-1">{getRoleLabel()}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-2 flex flex-col gap-1 overflow-y-auto custom-scrollbar">
        
        {/* WAITER MENU */}
        {role === UserRole.WAITER && (
             <>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Floor</div>
                <NavItem screen={Screen.WAITER_DASHBOARD} icon="grid_view" label="Floor View" />
                <NavItem screen={Screen.WAITER_MENU} icon="restaurant_menu" label="Order Builder" />
                <NavItem screen={Screen.WAITER_ACTIVE_ORDERS} icon="receipt_long" label="Active Orders" />
                <div className="my-2 border-t border-slate-200 dark:border-[#483c23]/50"></div>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Kitchen</div>
                <NavItem screen={Screen.WAITER_STATUS} icon="soup_kitchen" label="Ready to Serve" badge={readyBadge > 0 ? String(readyBadge) : undefined} />
                <NavItem screen={Screen.WAITER_KDS} icon="skillet" label="Full KDS View" />
                <div className="my-2 border-t border-slate-200 dark:border-[#483c23]/50"></div>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Data</div>
                <NavItem screen={Screen.WAITER_HISTORY} icon="history" label="Order History" />
                <NavItem screen={Screen.WAITER_NOTIFICATIONS} icon="notifications" label="Notifications" badge={unreadBadge > 0 ? String(unreadBadge) : undefined} />
                <NavItem screen={Screen.WAITER_SYSTEM} icon="wifi" label="System Status" />
            </>
        )}

        {/* BRANCH MANAGER MENU */}
        {role === UserRole.BRANCH_MANAGER && (
            <>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Branch Operations</div>
                <NavItem screen={Screen.MANAGER_DASHBOARD} icon="dashboard" label="Dashboard" />
                <NavItem screen={Screen.MANAGER_ORDERS} icon="receipt_long" label="Orders" />
                <NavItem screen={Screen.TABLE_ASSIGNMENT} icon="table_restaurant" label="Floor & Tables" />
                <NavItem screen={Screen.GUESTS} icon="contacts" label="Guests & Allowances" />
                <NavItem screen={Screen.MANAGER_INVENTORY} icon="inventory" label="Inventory" />
                <NavItem screen={Screen.MANAGER_MENU_BUILDER} icon="restaurant_menu" label="Menu Builder" />
                <NavItem screen={Screen.MANAGER_STAFF} icon="badge" label="Staff Roster" />
                <NavItem screen={Screen.MANAGER_FINANCE} icon="payments" label="Daily Finance" />
                <NavItem screen={Screen.MANAGER_REPORTS} icon="analytics" label="Branch Reports" />
                <div className="my-2 border-t border-slate-200 dark:border-[#483c23]/50"></div>
                <button
                  onClick={() => {
                    setScreen(Screen.MANAGER_SETTINGS);
                    setSettingsOpen((v) => !v);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative ${
                    currentScreen === Screen.MANAGER_SETTINGS
                      ? 'bg-primary/10 border-l-2 border-primary text-primary dark:text-white'
                      : 'text-slate-500 dark:text-[#c9b792] hover:bg-slate-200 dark:hover:bg-[#2c2417] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className={`material-symbols-outlined ${currentScreen === Screen.MANAGER_SETTINGS ? 'fill-current' : ''}`}>settings</span>
                  <span className={`text-sm font-medium ${currentScreen === Screen.MANAGER_SETTINGS ? 'font-bold' : ''}`}>Branch Settings</span>
                  <span className="ml-auto material-symbols-outlined text-[18px] opacity-70">{settingsOpen ? 'expand_less' : 'expand_more'}</span>
                </button>

                {(settingsOpen || currentScreen === Screen.MANAGER_SETTINGS) && (
                  <div className="ml-3 pl-3 border-l border-slate-200 dark:border-[#483c23]/70 flex flex-col gap-1">
                    {managerSettingsTabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => openManagerSettingsTab(t.key)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-500 dark:text-[#c9b792] hover:bg-slate-200 dark:hover:bg-[#2c2417] hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px] opacity-80">{t.icon}</span>
                        <span className="text-xs font-semibold">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
            </>
        )}

        {/* CAFE OWNER (GLOBAL) MENU */}
        {role === UserRole.CAFE_OWNER && (
            <>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Global View</div>
                <NavItem screen={Screen.OWNER_DASHBOARD} icon="dashboard" label="Dashboard" />
                <NavItem screen={Screen.OWNER_BRANCHES} icon="store" label="Branch Management" />
                <NavItem screen={Screen.OWNER_REPORTS} icon="bar_chart" label="Global Reports" />
                <NavItem screen={Screen.OWNER_INVENTORY} icon="inventory_2" label="Global Inventory" />
                <NavItem screen={Screen.OWNER_STAFF} icon="group" label="Staff Management" />
                <NavItem screen={Screen.OWNER_FINANCE} icon="payments" label="Finance" />
                <div className="my-2 border-t border-slate-200 dark:border-[#483c23]/50"></div>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Configuration</div>
                <NavItem screen={Screen.OWNER_MENU} icon="restaurant_menu" label="Menu Engineering" />
                <NavItem screen={Screen.OWNER_SETTINGS} icon="settings" label="Settings" />
            </>
        )}

        {/* SUPER ADMIN MENU */}
        {role === UserRole.SUPER_ADMIN && (
            <>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">Platform</div>
                <NavItem screen={Screen.SA_OVERVIEW} icon="dashboard" label="Overview" />
                <NavItem screen={Screen.SA_TENANTS} icon="storefront" label="Tenants" />
                <NavItem screen={Screen.SA_ONBOARDING} icon="content_copy" label="Onboarding" />
                <NavItem screen={Screen.SA_BILLING} icon="credit_card" label="Billing & Revenue" />
                <div className="my-2 border-t border-slate-200 dark:border-[#483c23]/50"></div>
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 dark:text-[#c9b792] uppercase tracking-wider opacity-70">System</div>
                <NavItem screen={Screen.SA_SYSTEM_HEALTH} icon="monitor_heart" label="System Health" />
                <NavItem screen={Screen.SA_SUPPORT} icon="support_agent" label="Support Desk" />
                <NavItem screen={Screen.SA_AUDIT} icon="fact_check" label="Audit Logs" />
                <NavItem screen={Screen.SA_FEATURE_FLAGS} icon="flag" label="Feature Flags" />
                <NavItem screen={Screen.SA_SETTINGS} icon="settings" label="Platform Settings" />
            </>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-[#483c23] flex flex-col gap-2">
        <button 
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-500 dark:text-[#c9b792] hover:bg-slate-100 dark:hover:bg-[#2c2417] hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          <span className="text-sm font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
        <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="text-sm font-medium">Log Out</span>
        </button>
      </div>
    </aside>
  );
};
