import { AppIcon } from '@/components/ui/app-icon';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

  const [poBadgeCount, setPoBadgeCount] = useState(0);

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

  const readFeatures = () => {
    try {
      const parsed = readSession<any>();
      const list = Array.isArray(parsed?.features) ? parsed.features : [];
      return list.map(String).filter(Boolean);
    } catch {
      return [];
    }
  };

  const [features, setFeatures] = useState<string[]>(() => readFeatures());

  const showItem = (screen: Screen) => canAccessScreenWithPermissions(role, screen, subscription, permissions);

  const waiterFeatureMode = useMemo(() => features.some((f) => String(f).startsWith('waiter_')), [features]);

  const showWaiterFeature = useCallback(
    (featureKey: string) => {
      if (!waiterFeatureMode) return true;
      return features.includes(featureKey);
    },
    [features, waiterFeatureMode]
  );

  useEffect(() => {
    const onChanged = () => {
      setSubscription(readSubscription());
      setPermissions(readPermissions());
      setFeatures(readFeatures());
    };
    window.addEventListener('mirachpos-session-changed', onChanged);
    return () => window.removeEventListener('mirachpos-session-changed', onChanged);
  }, []);

  const expoEnabled = features.includes('kds_expo');

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
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          'cursor-pointer select-none'
        )}
      >
        <AppIcon
          name={icon}
          className={cn('text-[20px]', active ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground')}
        />

        {!collapsed ? (
          <span className={cn('text-[11px] font-black uppercase tracking-widest flex-1', active ? 'opacity-100' : 'opacity-80')}>
            {label}
          </span>
        ) : null}
        {badge && !collapsed && (
          <Badge className={cn('ml-auto h-5 px-1.5 min-w-[20px] justify-center text-[10px] font-black', active ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground')}>
            {badge}
          </Badge>
        )}
        {badge && collapsed ? (
          <div className="absolute -top-1 -right-1">
            <div className="h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
              {badge}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className={cn('space-y-1 mb-6', collapsed ? 'mb-4' : 'mb-6')}>
      {!collapsed ? <p className="px-4 text-[10px] font-black uppercase text-muted-foreground tracking-[0.22em] opacity-90 mb-2">{title}</p> : null}
      <div className={cn('space-y-1', collapsed ? 'px-0' : '')}>{children}</div>
    </div>
  );

  const ownerActsAsManager = role === UserRole.CAFE_OWNER && !(Array.isArray(subscription?.modules) ? subscription.modules : []).includes('owner_dashboard');

  const managerBranchId = (() => {
    try {
      const parsed = readSession<any>();
      const bid = typeof parsed?.branchId === 'string' ? parsed.branchId.trim() : '';
      return bid && bid !== 'global' ? bid : '';
    } catch {
      return '';
    }
  })();

  const poLastSeenKey = useMemo(() => {
    if (!managerBranchId) return '';
    return `mirachpos.manager.po.lastSeen.${managerBranchId}.v1`;
  }, [managerBranchId]);

  const readPoLastSeen = useCallback((): number => {
    try {
      if (!poLastSeenKey) return 0;
      const raw = localStorage.getItem(poLastSeenKey);
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [poLastSeenKey]);

  const writePoLastSeen = useCallback((ts: number) => {
    try {
      if (!poLastSeenKey) return;
      localStorage.setItem(poLastSeenKey, String(ts));
    } catch {
      // ignore
    }
  }, [poLastSeenKey]);

  const refreshPoBadge = useCallback(async () => {
    const isManagerContext = role === UserRole.BRANCH_MANAGER || ownerActsAsManager;
    if (!isManagerContext) {
      setPoBadgeCount(0);
      return;
    }
    if (!managerBranchId) {
      setPoBadgeCount(0);
      return;
    }

    // If manager is already on inventory, mark as seen.
    if (currentScreen === Screen.MANAGER_INVENTORY) {
      writePoLastSeen(Date.now());
      setPoBadgeCount(0);
      return;
    }

    try {
      const qs = new URLSearchParams({ limit: '200', branchId: managerBranchId });
      const res = await apiFetch(`/api/manager/purchase-orders?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setPoBadgeCount(0);
        return;
      }
      const rows = Array.isArray(json?.purchaseOrders) ? (json.purchaseOrders as any[]) : [];
      const lastSeen = readPoLastSeen();
      const count = rows.filter((p) => {
        const status = String(p?.status || '');
        if (status !== 'Sent' && status !== 'Partially Received') return false;
        const t = p?.sentAt || p?.updatedAt || p?.createdAt;
        const ts = t ? new Date(String(t)).getTime() : 0;
        return Number.isFinite(ts) && ts > lastSeen;
      }).length;
      setPoBadgeCount(count);
    } catch {
      setPoBadgeCount(0);
    }
  }, [currentScreen, managerBranchId, ownerActsAsManager, readPoLastSeen, role, writePoLastSeen]);

  useEffect(() => {
    void refreshPoBadge();
  }, [refreshPoBadge]);

  useEffect(() => {
    const isManagerContext = role === UserRole.BRANCH_MANAGER || ownerActsAsManager;
    if (!isManagerContext) return;
    const t = window.setInterval(() => {
      void refreshPoBadge();
    }, 20000);
    return () => window.clearInterval(t);
  }, [ownerActsAsManager, refreshPoBadge, role]);

  return (
    <aside className={cn('h-full bg-card border-r border-border flex flex-col shrink-0 relative z-[200] pointer-events-auto transition-[width] duration-200', collapsed ? 'w-[76px]' : 'w-64')}>
      <div className={cn('pb-4 relative', collapsed ? 'p-3' : 'p-6')}>
        <div className={cn('flex items-center gap-3', collapsed ? 'justify-center' : 'justify-start')}>
          <div className={cn('flex items-center gap-3 min-w-0', collapsed ? 'justify-center' : '')}>
          {!collapsed ? (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-foreground text-sm font-black leading-tight tracking-tight truncate uppercase">{headerName}</h1>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1 opacity-70">{getRoleLabel()}</p>
            </div>
          ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={cn(
            'absolute top-6 right-0 translate-x-1/2 size-9 rounded-lg border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-center shadow-[0_10px_30px_rgba(0,0,0,0.25)] z-[500] pointer-events-auto'
          )}
        >
          <AppIcon name={collapsed ? 'chevron_right' : 'chevron_left'} className="text-[20px]" size={20} />
        </button>
      </div>

      <ScrollArea className={cn('flex-1 py-4', collapsed ? 'px-2' : 'px-4')}>
        {(role === UserRole.WAITER || role === UserRole.WAITER_MANAGER) && (
          <>
            <Section title="Live Operations">
              <NavItem screen={Screen.WAITER_WORKSPACE} icon="grid_view" label="Workspace" />
            </Section>

            <Section title="Kitchen">
              {showWaiterFeature('waiter_kds') ? (
                <NavItem screen={Screen.WAITER_KITCHEN} icon="soup_kitchen" label="Kitchen Board" badge={readyBadge > 0 ? String(readyBadge) : undefined} />
              ) : null}
              {expoEnabled && showWaiterFeature('waiter_kds_expo') ? <NavItem screen={Screen.WAITER_EXPO} icon="restaurant" label="Expo" /> : null}
            </Section>

            <Section title="Me & My Shift">
              {showWaiterFeature('waiter_history') ? <NavItem screen={Screen.WAITER_HISTORY} icon="history" label="Order History" /> : null}
              {showWaiterFeature('waiter_shift_report') ? <NavItem screen={Screen.WAITER_SHIFT_REPORT} icon="assessment" label="Shift Report" /> : null}
              {showWaiterFeature('waiter_account') ? <NavItem screen={Screen.WAITER_SCHEDULE} icon="schedule" label="Schedule" /> : null}
              {showWaiterFeature('waiter_notifications') ? <NavItem screen={Screen.WAITER_NOTIFICATIONS} icon="notifications" label="Notifications" badge={unreadBadge > 0 ? String(unreadBadge) : undefined} /> : null}
            </Section>
          </>
        )}

        {(role === UserRole.BRANCH_MANAGER || ownerActsAsManager) && (
          <>
            <Section title="Local Branch">
              <NavItem screen={Screen.MANAGER_DASHBOARD} icon="dashboard" label="Dashboard" />
              <NavItem screen={Screen.DESKTOP_DRAFT_INBOX} icon="inbox" label="Draft Orders" />
              <NavItem screen={Screen.MANAGER_ORDERS} icon="receipt_long" label="Orders" />
            </Section>

            <Section title="Resources">
              <NavItem screen={Screen.MANAGER_CUSTOMERS} icon="person" label="Customers" />
              <NavItem screen={Screen.MANAGER_INVENTORY} icon="inventory" label="Inventory" badge={poBadgeCount > 0 ? String(poBadgeCount) : undefined} />
              {showItem(Screen.MANAGER_MENU_BUILDER) && <NavItem screen={Screen.MANAGER_MENU_BUILDER} icon="restaurant_menu" label="Menu Management" />}
              <NavItem screen={Screen.MANAGER_STAFF} icon="badge" label="Staff" />
              <NavItem screen={Screen.STAFF_SCHEDULE} icon="schedule" label="Staff Schedule" />
            </Section>

            <Section title="Performance">
              <NavItem screen={Screen.MANAGER_FINANCE} icon="payments" label="Finance" />
              <NavItem screen={Screen.MANAGER_REPORTS} icon="analytics" label="Reports" />
              <NavItem screen={Screen.MANAGER_SETTINGS} icon="settings" label="Settings" />
              <NavItem screen={Screen.SUPPORT_REQUEST} icon="support_agent" label="Support" />
            </Section>

            {ownerActsAsManager && (
              <Section title="Ownership">
                <NavItem screen={Screen.OWNER_INVENTORY} icon="inventory_2" label="Inventory" />
                <NavItem screen={Screen.OWNER_SETTINGS} icon="settings" label="Settings" />
                <NavItem screen={Screen.OWNER_BILLING} icon="credit_card" label="Billing" />
                <NavItem screen={Screen.OWNER_AUDIT} icon="fact_check" label="Audit Log" />
              </Section>
            )}
          </>
        )}

        {role === UserRole.CAFE_OWNER && !ownerActsAsManager && (
          <>
            <Section title="HQ Overview">
              <NavItem screen={Screen.OWNER_DASHBOARD} icon="dashboard" label="Dashboard" />
              <NavItem screen={Screen.OWNER_BRANCHES} icon="store" label="Branches" />
              <NavItem screen={Screen.OWNER_REPORTS} icon="bar_chart" label="Reports" />
            </Section>

            <Section title="Enterprise">
              <NavItem screen={Screen.OWNER_INVENTORY} icon="inventory_2" label="Inventory" />
              <NavItem screen={Screen.OWNER_STAFF} icon="group" label="Staff" />
              <NavItem screen={Screen.STAFF_SCHEDULE} icon="calendar_today" label="Staff Schedule" />
              <NavItem screen={Screen.OWNER_FINANCE} icon="payments" label="Finance" />
            </Section>

            <Section title="Platform Management">
              <NavItem screen={Screen.OWNER_MENU} icon="restaurant_menu" label="Menu Management" />
              <NavItem screen={Screen.OWNER_BILLING} icon="credit_card" label="Billing" />
              <NavItem screen={Screen.OWNER_SETTINGS} icon="settings" label="Settings" />
              <NavItem screen={Screen.OWNER_AUDIT} icon="fact_check" label="Audit Log" />
              <NavItem screen={Screen.SUPPORT_REQUEST} icon="support_agent" label="Support" />
            </Section>
          </>
        )}

        {role === UserRole.SUPER_ADMIN && (
          <>
            <Section title="Platform">
              <NavItem screen={Screen.SA_OVERVIEW} icon="space_dashboard" label="Overview" />
              <NavItem screen={Screen.SA_TENANTS} icon="storefront" label="Tenants" />
              <NavItem screen={Screen.SA_ONBOARDING} icon="auto_awesome" label="Onboarding" />
              <NavItem screen={Screen.SA_BILLING} icon="monetization_on" label="Billing" />
              <NavItem screen={Screen.SA_PAYMENT_CONFIG} icon="account_balance" label="Payment Settings" />
              <NavItem screen={Screen.SA_INTEGRATIONS} icon="extension" label="Integrations" />
              <NavItem screen={Screen.SA_ADDONS} icon="widgets" label="Add-ons" />
              <NavItem screen={Screen.SA_DEMO_REQUESTS} icon="campaign" label="Demo Requests" />
            </Section>

            <Section title="System">
              <NavItem screen={Screen.SA_SYSTEM_HEALTH} icon="monitor_heart" label="System Health" />
              <NavItem screen={Screen.SA_SUPPORT} icon="contact_support" label="Support" />
              <NavItem screen={Screen.SA_AUDIT} icon="history_edu" label="Audit Logs" />
              {showItem(Screen.SA_FEATURE_FLAGS) && <NavItem screen={Screen.SA_FEATURE_FLAGS} icon="flag" label="Feature Flags" />}
              <NavItem screen={Screen.SA_SETTINGS} icon="admin_panel_settings" label="Platform Settings" />
            </Section>
          </>
        )}
      </ScrollArea>

      <div className={cn('border-t border-border space-y-1', collapsed ? 'p-2' : 'p-4')}>
        {canReturnToSuperadmin && (
          <Button variant="ghost" onClick={returnToSuperadmin} title={collapsed ? 'Back to Admin' : undefined} className={cn('w-full h-10 rounded-lg hover:bg-accent hover:text-primary', collapsed ? 'justify-center px-0 text-primary' : 'justify-start gap-3 px-4 text-primary')}>
            <AppIcon name="shield" className="text-[20px]" size={20} />
            {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">Back to Admin</span> : null}
          </Button>
        )}
        <Button variant="ghost" onClick={toggleTheme} title={collapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined} className={cn('w-full h-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground', collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-4')}>
          <AppIcon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[20px]" size={20} />
          {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span> : null}
        </Button>
        <Button variant="ghost" onClick={logout} title={collapsed ? 'Sign Out' : undefined} className={cn('w-full h-10 rounded-lg text-red-300 hover:bg-red-500/10 hover:text-red-200', collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-4')}>
          <AppIcon name="logout" className="text-[20px]" size={20} />
          {!collapsed ? <span className="text-[11px] font-black uppercase tracking-widest">Sign Out</span> : null}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
