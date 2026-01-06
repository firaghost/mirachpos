
import React, { useEffect, useMemo, useState } from 'react';
import { Screen, UserRole } from '../types';
import { useTheme } from '../ThemeContext';
import { usePos } from '../PosContext';
import { canAccessScreenWithSubscription } from '../rbac';
import { apiFetch } from '../api';
import { readSession, updateSession } from '../session';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

interface SidebarProps {
  currentScreen: Screen;
  setScreen: (screen: Screen) => void;
  role: UserRole;
  logout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentScreen, setScreen, role, logout }) => {
  const { theme, toggleTheme } = useTheme();
  const { orders, notifications } = usePos();

  const [branding, setBranding] = useState<{ platformName?: string; logoUrl?: string }>(() => {
    try {
      const w = window as any;
      const b = w?.__mirachposBranding;
      return b && typeof b === 'object' ? { platformName: String(b.platformName || ''), logoUrl: String(b.logoUrl || '') } : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const onBranding = (ev: any) => {
      const b = ev?.detail;
      if (!b || typeof b !== 'object') return;
      setBranding({ platformName: String(b.platformName || ''), logoUrl: String(b.logoUrl || '') });
    };
    window.addEventListener('mirachpos-branding-changed', onBranding as any);
    return () => window.removeEventListener('mirachpos-branding-changed', onBranding as any);
  }, []);

  const readSubscription = () => {
    try {
      const parsed = readSession<any>();
      return parsed?.subscription || null;
    } catch {
      return null;
    }
  };

  const [subscription, setSubscription] = useState(() => readSubscription());

  const showItem = (screen: Screen) => canAccessScreenWithSubscription(role, screen, subscription);

  useEffect(() => {
    const onChanged = () => setSubscription(readSubscription());
    window.addEventListener('mirachpos-session-changed', onChanged);
    return () => window.removeEventListener('mirachpos-session-changed', onChanged);
  }, []);

  useEffect(() => {
    let mounted = true;
    const maybeRefreshOwnerSubscription = async () => {
      if (role !== UserRole.CAFE_OWNER) return;
      const tier = String(subscription?.tier || '').trim().toLowerCase();
      const mods = Array.isArray(subscription?.modules) ? subscription.modules : [];
      const missingModules = mods.length === 0;
      const missingOwnerDash = (tier === 'pro' || tier === 'enterprise') && !mods.includes('owner_dashboard');
      if (!missingModules && !missingOwnerDash) return;

      try {
        const res = await apiFetch('/api/owner/subscription');
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as any;
        const nextSub = json?.subscription;
        if (!nextSub || typeof nextSub !== 'object') return;
        if (!mounted) return;
        updateSession({ subscription: nextSub });
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }
    };
    maybeRefreshOwnerSubscription();
    return () => { mounted = false; };
  }, [role, subscription]);

  const tenantName = (() => {
    try {
      const parsed = readSession<any>();
      const name = typeof parsed?.tenant?.name === 'string' ? parsed.tenant.name.trim() : '';
      return name || 'MirachPos';
    } catch {
      return 'MirachPos';
    }
  })();

  const canReturnToSuperadmin = (() => {
    try {
      const parsed = readSession<any>();
      return role !== UserRole.SUPER_ADMIN && typeof parsed?.superadminToken === 'string' && Boolean(parsed.superadminToken.trim());
    } catch {
      return false;
    }
  })();

  const returnToSuperadmin = () => {
    try {
      const parsed = readSession<any>();
      const saToken = typeof parsed?.superadminToken === 'string' ? parsed.superadminToken : '';
      if (!saToken) return;
      updateSession({ role: UserRole.SUPER_ADMIN, token: saToken, screen: Screen.SA_OVERVIEW, branchId: 'global', tenantId: 'tenant_global' });
      window.dispatchEvent(new Event('mirachpos-session-changed'));
      setScreen(Screen.SA_OVERVIEW);
    } catch {
      // ignore
    }
  };

  const headerName = role === UserRole.SUPER_ADMIN
    ? (branding.platformName && branding.platformName.trim() ? branding.platformName.trim() : tenantName)
    : tenantName;

  const readyBadge = role === UserRole.WAITER ? orders.filter((o) => o.status === 'Ready').length : 0;
  const unreadBadge = role === UserRole.WAITER ? notifications.filter((n) => !n.read).length : 0;

  const getRoleLabel = () => {
    switch (role) {
      case UserRole.SUPER_ADMIN: return "Super Admin";
      case UserRole.CAFE_OWNER: return "Owner";
      case UserRole.BRANCH_MANAGER: return "Manager";
      case UserRole.WAITER: return "Waiter";
      default: return "Staff";
    }
  };

  const NavItem = ({ screen, icon, label, badge }: { screen: Screen; icon: string; label: string, badge?: string }) => {
    const active = currentScreen === screen;
    const canAccess = canAccessScreenWithSubscription(role, screen, subscription);
    if (!canAccess) return null;

    return (
      <button
        onClick={() => setScreen(screen)}
        className={cn(
          'group relative flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all w-full text-left',
          active
            ? 'bg-[#eead2b] text-[#221c10]'
            : 'text-[#c9b792] hover:bg-[#2c241b] hover:text-white'
        )}
      >
        <span className={cn('material-symbols-outlined text-[20px]', active ? 'text-[#221c10]' : 'text-[#c9b792] group-hover:text-white')}>
          {icon}
        </span>
        <span className={cn('text-[11px] font-black uppercase tracking-widest flex-1', active ? 'opacity-100' : 'opacity-80')}>
          {label}
        </span>
        {badge && (
          <Badge className={cn('ml-auto h-5 px-1.5 min-w-[20px] justify-center text-[10px] font-black', active ? 'bg-[#221c10] text-[#eead2b]' : 'bg-[#eead2b] text-[#221c10]')}>
            {badge}
          </Badge>
        )}
      </button>
    );
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-1 mb-6">
      <p className="px-4 text-[10px] font-black uppercase text-[#8e826f] tracking-[0.22em] opacity-90 mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );

  const ownerActsAsManager = role === UserRole.CAFE_OWNER && !(Array.isArray(subscription?.modules) ? subscription.modules : []).includes('owner_dashboard');

  return (
    <aside className="w-64 h-full bg-[#1e1910] border-r border-[#483c23] flex flex-col shrink-0 z-50">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            {branding.logoUrl ? (
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#221c10] border border-[#483c23] p-1">
                <img src={branding.logoUrl} alt="" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[#eead2b] flex items-center justify-center text-[#221c10]">
                <span className="material-symbols-outlined text-[22px]">local_cafe</span>
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1e1910]" />
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="text-white text-sm font-black leading-tight tracking-tight truncate uppercase">{headerName}</h1>
            <p className="text-[10px] font-bold text-[#c9b792] uppercase tracking-widest mt-1 opacity-70">{getRoleLabel()}</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-4">
        {role === UserRole.WAITER && (
          <>
            <Section title="Live Operations">
              <NavItem screen={Screen.WAITER_DASHBOARD} icon="grid_view" label="Floor Map" />
              <NavItem screen={Screen.WAITER_MENU} icon="restaurant_menu" label="Digital Menu" />
              <NavItem screen={Screen.WAITER_ACTIVE_ORDERS} icon="receipt_long" label="Active Orders" />
            </Section>

            <Section title="Kitchen">
              <NavItem screen={Screen.WAITER_STATUS} icon="soup_kitchen" label="Service Board" badge={readyBadge > 0 ? String(readyBadge) : undefined} />
              <NavItem screen={Screen.WAITER_KDS} icon="skillet" label="Full KDS View" />
            </Section>

            <Section title="Me & My Shift">
              <NavItem screen={Screen.WAITER_HISTORY} icon="history" label="My History" />
              <NavItem screen={Screen.WAITER_SHIFT_REPORT} icon="assessment" label="Shift Report" />
              <NavItem screen={Screen.WAITER_SCHEDULE} icon="schedule" label="Schedule" />
              <NavItem screen={Screen.WAITER_NOTIFICATIONS} icon="notifications" label="Inbox" badge={unreadBadge > 0 ? String(unreadBadge) : undefined} />
              <NavItem screen={Screen.WAITER_SYSTEM} icon="wifi" label="Connectivity" />
              <NavItem screen={Screen.WAITER_SETTINGS} icon="lock" label="Auth Settings" />
            </Section>
          </>
        )}

        {(role === UserRole.BRANCH_MANAGER || ownerActsAsManager) && (
          <>
            <Section title="Local Branch">
              <NavItem screen={Screen.MANAGER_DASHBOARD} icon="dashboard" label="Console" />
              <NavItem screen={Screen.DESKTOP_DRAFT_INBOX} icon="inbox" label="Drafts" />
              <NavItem screen={Screen.MANAGER_ORDERS} icon="receipt_long" label="Orders List" />
              <NavItem screen={Screen.TABLE_ASSIGNMENT} icon="table_restaurant" label="Tables Map" />
            </Section>

            <Section title="Resources">
              <NavItem screen={Screen.GUESTS} icon="contacts" label="Guest List" />
              <NavItem screen={Screen.MANAGER_CUSTOMERS} icon="person" label="Customers" />
              <NavItem screen={Screen.MANAGER_INVENTORY} icon="inventory" label="Inventory" />
              {showItem(Screen.MANAGER_MENU_BUILDER) && <NavItem screen={Screen.MANAGER_MENU_BUILDER} icon="restaurant_menu" label="Menu Editor" />}
              <NavItem screen={Screen.MANAGER_STAFF} icon="badge" label="My Team" />
              <NavItem screen={Screen.STAFF_SCHEDULE} icon="schedule" label="Roster" />
            </Section>

            <Section title="Performance">
              <NavItem screen={Screen.MANAGER_FINANCE} icon="payments" label="Cash Flow" />
              <NavItem screen={Screen.MANAGER_REPORTS} icon="analytics" label="Analytics" />
              <NavItem screen={Screen.MANAGER_SETTINGS} icon="settings" label="App Config" />
              <NavItem screen={Screen.SUPPORT_REQUEST} icon="support_agent" label="Support" />
            </Section>

            {ownerActsAsManager && (
              <Section title="Ownership">
                <NavItem screen={Screen.OWNER_SETTINGS} icon="settings" label="Settings" />
                <NavItem screen={Screen.OWNER_BILLING} icon="credit_card" label="Billing & Plan" />
                <NavItem screen={Screen.OWNER_AUDIT} icon="fact_check" label="Security Audit" />
              </Section>
            )}
          </>
        )}

        {role === UserRole.CAFE_OWNER && !ownerActsAsManager && (
          <>
            <Section title="HQ Overview">
              <NavItem screen={Screen.OWNER_DASHBOARD} icon="dashboard" label="Global Desk" />
              <NavItem screen={Screen.OWNER_BRANCHES} icon="store" label="My Branches" />
              <NavItem screen={Screen.OWNER_REPORTS} icon="bar_chart" label="Total Stats" />
            </Section>

            <Section title="Enterprise">
              <NavItem screen={Screen.OWNER_INVENTORY} icon="inventory_2" label="Global Stock" />
              <NavItem screen={Screen.OWNER_STAFF} icon="group" label="Global Staff" />
              <NavItem screen={Screen.STAFF_SCHEDULE} icon="calendar_today" label="Schedules" />
              <NavItem screen={Screen.OWNER_FINANCE} icon="payments" label="Audit Finance" />
            </Section>

            <Section title="Platform Management">
              <NavItem screen={Screen.OWNER_MENU} icon="restaurant_menu" label="Master Menu" />
              <NavItem screen={Screen.OWNER_BILLING} icon="credit_card" label="Billing & Subscription" />
              <NavItem screen={Screen.OWNER_SETTINGS} icon="settings" label="Global Config" />
              <NavItem screen={Screen.OWNER_AUDIT} icon="fact_check" label="Global Audit" />
              <NavItem screen={Screen.SUPPORT_REQUEST} icon="support_agent" label="Expert Help" />
            </Section>
          </>
        )}

        {role === UserRole.SUPER_ADMIN && (
          <>
            <Section title="Platform">
              <NavItem screen={Screen.SA_OVERVIEW} icon="space_dashboard" label="Overview" />
              <NavItem screen={Screen.SA_TENANTS} icon="storefront" label="Tenants" />
              <NavItem screen={Screen.SA_ONBOARDING} icon="auto_awesome" label="Onboarding" />
              <NavItem screen={Screen.SA_BILLING} icon="monetization_on" label="Billing & Revenue" />
              <NavItem screen={Screen.SA_PAYMENT_CONFIG} icon="account_balance" label="Payment Config" />
              <NavItem screen={Screen.SA_DEMO_REQUESTS} icon="campaign" label="Demo Requests" />
            </Section>

            <Section title="System">
              <NavItem screen={Screen.SA_SYSTEM_HEALTH} icon="monitor_heart" label="System Health" />
              <NavItem screen={Screen.SA_SUPPORT} icon="contact_support" label="Support Desk" />
              <NavItem screen={Screen.SA_AUDIT} icon="history_edu" label="Audit Logs" />
              {showItem(Screen.SA_FEATURE_FLAGS) && <NavItem screen={Screen.SA_FEATURE_FLAGS} icon="flag" label="Feature Flags" />}
              <NavItem screen={Screen.SA_SETTINGS} icon="admin_panel_settings" label="Platform Settings" />
            </Section>
          </>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-[#483c23] space-y-1">
        {canReturnToSuperadmin && (
          <Button variant="ghost" onClick={returnToSuperadmin} className="w-full justify-start gap-3 h-10 px-4 rounded-lg text-[#eead2b] hover:bg-[#2c241b] hover:text-[#eead2b]">
            <span className="material-symbols-outlined text-[20px]">shield</span>
            <span className="text-[11px] font-black uppercase tracking-widest">Back to Admin</span>
          </Button>
        )}
        <Button variant="ghost" onClick={toggleTheme} className="w-full justify-start gap-3 h-10 px-4 rounded-lg text-[#c9b792] hover:bg-[#2c241b] hover:text-white">
          <span className="material-symbols-outlined text-[20px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          <span className="text-[11px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </Button>
        <Button variant="ghost" onClick={logout} className="w-full justify-start gap-3 h-10 px-4 rounded-lg text-red-300 hover:bg-red-500/10 hover:text-red-200">
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span className="text-[11px] font-black uppercase tracking-widest">Sign Out</span>
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
