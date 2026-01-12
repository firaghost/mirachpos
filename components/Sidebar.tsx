
import React, { useEffect, useMemo, useState } from 'react';
import { Screen, UserRole } from '../types';
import { useTheme } from '../ThemeContext';
import { usePos } from '../PosContext';
import { canAccessScreenWithPermissions } from '../rbac';
import { apiFetch } from '../api';
import { readSession, updateSession } from '../session';
import { usePersistedState } from '../usePersistedState';
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

  const [collapsed, setCollapsed] = usePersistedState<boolean>('mirachpos.sidebar.collapsed.v1', false, {
    validate: (v): v is boolean => typeof v === 'boolean',
  });

  const [businessName, setBusinessName] = useState<string>('');

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

  const readPermissions = () => {
    try {
      const parsed = readSession<any>();
      return parsed?.permissions || [];
    } catch {
      return [];
    }
  };

  const [permissions, setPermissions] = useState(() => readPermissions());

  const showItem = (screen: Screen) => canAccessScreenWithPermissions(role, screen, subscription, permissions);

  useEffect(() => {
    const onChanged = () => {
      setSubscription(readSubscription());
      setPermissions(readPermissions());
    };
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

  const withBranchQuery = (url: string) => {
    try {
      const s = readSession<any>();
      const tokenBranch = typeof s?.branchId === 'string' ? s.branchId.trim() : '';

      if (tokenBranch && tokenBranch !== 'global') return url;
      if (role !== UserRole.CAFE_OWNER) return url;

      const selected =
        (localStorage.getItem('mirachpos.owner.selectedBranchId.v1') ||
          localStorage.getItem('mirachpos.manager.selectedBranchId.v1') ||
          localStorage.getItem('mirachpos.waiter.selectedBranchId.v1') ||
          '')
          .trim();
      if (!selected || selected === 'global') return url;
      return url.includes('?') ? `${url}&branchId=${encodeURIComponent(selected)}` : `${url}?branchId=${encodeURIComponent(selected)}`;
    } catch {
      return url;
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (role === UserRole.SUPER_ADMIN) return;
      try {
        const res = await apiFetch(withBranchQuery('/api/pos/settings'));
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const bn = typeof json?.business?.businessName === 'string' ? String(json.business.businessName).trim() : '';
        if (!mounted) return;
        setBusinessName(bn);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [role]);

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
    : (businessName && businessName.trim() ? businessName.trim() : tenantName);

  const readyBadge = role === UserRole.WAITER || role === UserRole.WAITER_MANAGER ? orders.filter((o) => o.status === 'Ready').length : 0;
  const unreadBadge = role === UserRole.WAITER || role === UserRole.WAITER_MANAGER ? notifications.filter((n) => !n.read).length : 0;

  const getRoleLabel = () => {
    switch (role) {
      case UserRole.SUPER_ADMIN: return "Super Admin";
      case UserRole.CAFE_OWNER: return "Owner";
      case UserRole.BRANCH_MANAGER: return "Manager";
      case UserRole.WAITER: return "Waiter";
      case UserRole.WAITER_MANAGER: return "Waiter Manager";
      default: return "Staff";
    }
  };

  const NavItem = ({ screen, icon, label, badge }: { screen: Screen; icon: string; label: string, badge?: string }) => {
    const active = currentScreen === screen;
    const canAccess = canAccessScreenWithPermissions(role, screen, subscription, permissions);
    if (!canAccess) return null;

    return (
      <div
        role="button"
        tabIndex={0}
        title={collapsed ? label : undefined}
        onPointerDown={(e) => {
          // Some environments swallow click events inside scroll containers.
          // PointerDown is more reliable and still respects user intent.
          e.preventDefault();
          setScreen(screen);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setScreen(screen);
          }
        }}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg transition-all w-full text-left',
          collapsed ? 'px-3 py-3 justify-center' : 'px-4 py-2.5',
          active
            ? 'bg-[#eead2b] text-[#221c10]'
            : 'text-[#c9b792] hover:bg-[#2c241b] hover:text-white',
          'cursor-pointer select-none'
        )}
      >
        <span className={cn('material-symbols-outlined text-[20px]', active ? 'text-[#221c10]' : 'text-[#c9b792] group-hover:text-white')}>
          {icon}
        </span>
        {!collapsed ? (
          <span className={cn('text-[11px] font-black uppercase tracking-widest flex-1', active ? 'opacity-100' : 'opacity-80')}>
            {label}
          </span>
        ) : null}
        {badge && !collapsed && (
          <Badge className={cn('ml-auto h-5 px-1.5 min-w-[20px] justify-center text-[10px] font-black', active ? 'bg-[#221c10] text-[#eead2b]' : 'bg-[#eead2b] text-[#221c10]')}>
            {badge}
          </Badge>
        )}
        {badge && collapsed ? (
          <div className="absolute -top-1 -right-1">
            <div className="h-4 min-w-4 px-1 rounded-full bg-[#eead2b] text-[#221c10] text-[10px] font-black flex items-center justify-center">
              {badge}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className={cn('space-y-1 mb-6', collapsed ? 'mb-4' : 'mb-6')}>
      {!collapsed ? <p className="px-4 text-[10px] font-black uppercase text-[#8e826f] tracking-[0.22em] opacity-90 mb-2">{title}</p> : null}
      <div className={cn('space-y-1', collapsed ? 'px-0' : '')}>{children}</div>
    </div>
  );

  const ownerActsAsManager = role === UserRole.CAFE_OWNER && !(Array.isArray(subscription?.modules) ? subscription.modules : []).includes('owner_dashboard');

  return (
    <aside className={cn('h-full bg-[#1e1910] border-r border-[#483c23] flex flex-col shrink-0 relative z-[200] pointer-events-auto transition-[width] duration-200', collapsed ? 'w-[76px]' : 'w-64')}>
      <div className={cn('pb-4 relative', collapsed ? 'p-3' : 'p-6')}>
        <div className={cn('flex items-center gap-3', collapsed ? 'justify-center' : 'justify-start')}>
          <div className={cn('flex items-center gap-3 min-w-0', collapsed ? 'justify-center' : '')}>
          <div className="relative">
            {branding.logoUrl ? (
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#221c10] border border-[#483c23] p-1">
                <img src={branding.logoUrl} alt="" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#221c10] border border-[#483c23] p-1">
                <img src="./mirach.png" alt="" className="w-full h-full object-contain" />
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1e1910]" />
          </div>
          {!collapsed ? (
            <div className="flex flex-col min-w-0">
              <h1 className="text-white text-sm font-black leading-tight tracking-tight truncate uppercase">{headerName}</h1>
              <p className="text-[10px] font-bold text-[#c9b792] uppercase tracking-widest mt-1 opacity-70">{getRoleLabel()}</p>
            </div>
          ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={cn(
            'absolute top-6 right-0 translate-x-1/2 size-9 rounded-lg border border-[#483c23] bg-[#2c241b] text-[#c9b792] hover:bg-[#3a2e22] hover:text-white transition-colors flex items-center justify-center shadow-[0_10px_30px_rgba(0,0,0,0.25)] z-[500] pointer-events-auto'
          )}
        >
          <span className="material-symbols-outlined text-[20px]">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </div>

      <ScrollArea className={cn('flex-1 py-4', collapsed ? 'px-2' : 'px-4')}>
        {(role === UserRole.WAITER || role === UserRole.WAITER_MANAGER) && (
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
              <NavItem screen={Screen.SA_INTEGRATIONS} icon="extension" label="Integrations" />
              <NavItem screen={Screen.SA_ADDONS} icon="widgets" label="Add-ons" />
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

      <div className={cn('border-t border-[#483c23] space-y-1', collapsed ? 'p-2' : 'p-4')}>
        {canReturnToSuperadmin && (
          <Button variant="ghost" onClick={returnToSuperadmin} title={collapsed ? 'Back to Admin' : undefined} className={cn('w-full h-10 rounded-lg hover:bg-[#2c241b] hover:text-[#eead2b]', collapsed ? 'justify-center px-0 text-[#eead2b]' : 'justify-start gap-3 px-4 text-[#eead2b]')}>
            <span className="material-symbols-outlined text-[20px]">shield</span>
            {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">Back to Admin</span> : null}
          </Button>
        )}
        <Button variant="ghost" onClick={toggleTheme} title={collapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined} className={cn('w-full h-10 rounded-lg text-[#c9b792] hover:bg-[#2c241b] hover:text-white', collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-4')}>
          <span className="material-symbols-outlined text-[20px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span> : null}
        </Button>
        <Button variant="ghost" onClick={logout} title={collapsed ? 'Sign Out' : undefined} className={cn('w-full h-10 rounded-lg text-red-300 hover:bg-red-500/10 hover:text-red-200', collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-4')}>
          <span className="material-symbols-outlined text-[20px]">logout</span>
          {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">Sign Out</span> : null}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
