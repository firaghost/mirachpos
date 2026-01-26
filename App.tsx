import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Orders } from './screens/Orders';
import { OwnerFinance } from './screens/owner/OwnerFinance';
import { ThemeProvider } from './ThemeContext';
import { PosProvider } from './PosContext';
import { apiFetch, logoutAndReload } from './api';

// Import Cafe Owner Screens
import { OwnerDashboard } from './screens/owner/OwnerDashboard';
import { OwnerInventory } from './screens/owner/OwnerInventory';
import { GlobalReports } from './screens/owner/GlobalReports';
import { OwnerBranches } from './screens/owner/OwnerBranches';
import { OwnerStaffManagement } from './screens/owner/OwnerStaffManagement';
import { OwnerOnboarding } from './screens/owner/OwnerOnboarding';
import { OwnerAudit } from './screens/owner/OwnerAudit';
import { OwnerBilling } from './screens/owner/OwnerBilling';

// Import Branch Manager Screens
import { BranchDashboard } from './screens/manager/BranchDashboard';
import { BranchOrders } from './screens/manager/BranchOrders';
import { BranchOrderDetails } from './screens/manager/BranchOrderDetails';
import { ManagerFloorMap } from './screens/manager/ManagerFloorMap';
import { ManagerTableDetails } from './screens/manager/ManagerTableDetails';
import { BranchSettings } from './screens/manager/BranchSettings';
import { BranchReports } from './screens/manager/BranchReports';
import { RecipeBuilder } from './screens/manager/RecipeBuilder';
import { MenuBuilder } from './screens/manager/MenuBuilder';
import { ManagerCustomers } from './screens/manager/ManagerCustomers';

// Import Waiter Screens
import { WaiterDashboard } from './screens/waiter/WaiterDashboard';
import { WaiterMenu } from './screens/waiter/WaiterMenu';
import { WaiterOrderReview } from './screens/waiter/WaiterOrderReview';
import { WaiterPayment } from './screens/waiter/WaiterPayment';
import { WaiterReceipt } from './screens/waiter/WaiterReceipt';
import { WaiterActiveOrders } from './screens/waiter/WaiterActiveOrders';
import { WaiterOrderStatus } from './screens/waiter/WaiterOrderStatus';
import { WaiterKDS } from './screens/waiter/WaiterKDS';
import { WaiterHistory } from './screens/waiter/WaiterHistory';
import { WaiterNotifications } from './screens/waiter/WaiterNotifications';
import { WaiterSystemStatus } from './screens/waiter/WaiterSystemStatus';
import { WaiterSettings } from './screens/waiter/WaiterSettings';
import { WaiterShiftReport } from './screens/waiter/WaiterShiftReport';

// Import Shared / Placeholder Screens
import { Inventory } from './screens/Inventory';
import { Staff } from './screens/Staff';
import { Finance } from './screens/Finance';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';
import { ManagerTeam } from './screens/manager/ManagerTeam';
import { MenuManagement } from './screens/MenuManagement';
import { Guests } from './screens/Guests';
import { ShiftSchedule } from './screens/ShiftSchedule';
import { TableAssignment } from './screens/TableAssignment';
import { BranchSelect } from './screens/BranchSelect';

import { SupportRequest } from './screens/support/SupportRequest';

import { DraftInbox } from './screens/desktop/DraftInbox';

// Super Admin Imports
import { SA_Overview } from './screens/superadmin/Overview';
import { SA_Tenants } from './screens/superadmin/Tenants';
import { SA_TenantDetails } from './screens/superadmin/TenantDetails';
import { SA_OnboardingDesign } from './screens/superadmin/OnboardingDesign';
import { SA_Billing } from './screens/superadmin/Billing';
import { SA_SystemHealth } from './screens/superadmin/SystemHealth';
import { SA_Support } from './screens/superadmin/Support';
import { SA_Audit } from './screens/superadmin/Audit';
import { SA_FeatureFlags } from './screens/superadmin/FeatureFlags';
import { SA_Settings } from './screens/superadmin/Settings';
import { SA_DemoRequests } from './screens/superadmin/DemoRequests';
import { PaymentConfig } from './screens/superadmin/PaymentConfig';
import { SuperAdminLogin } from './screens/superadmin/SuperAdminLogin';
import { SA_Integrations } from './screens/superadmin/Integrations';
import { SA_Addons } from './screens/superadmin/Addons';

import { Screen, UserRole } from './types';

import { clearSession, initTabSession, readSession, updateSession } from './session';
import { writeSession } from './session';

import { canAccessScreenWithPermissions, canAccessScreenWithSubscription, homeForRoleWithSubscription } from './rbac';

const LAST_SCREEN_KEY = 'mirachpos.lastScreen.v1';

const isPosRole = (role: string | null) => role === UserRole.WAITER || role === UserRole.WAITER_MANAGER || role === UserRole.BRANCH_MANAGER;

const parseScreen = (raw: unknown): Screen | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const values = Object.values(Screen) as string[];
  return values.includes(s) ? (s as Screen) : null;
};

const readSessionPermissions = () => {
  try {
    const parsed = readSession<any>();
    return Array.isArray(parsed?.permissions) ? parsed.permissions : [];
  } catch {
    return [];
  }
};

const readHashScreen = (): Screen | null => {
  try {
    const h = String(window.location?.hash || '');
    if (!h.startsWith('#')) return null;
    return parseScreen(h.slice(1));
  } catch {
    return null;
  }
};

const writeHashScreen = (screen: Screen) => {
  try {
    const next = `#${String(screen)}`;
    if (window.location.hash !== next) window.location.hash = next;
  } catch {
    // ignore
  }
};

const readLastScreen = (): Screen | null => {
  try {
    return parseScreen(localStorage.getItem(LAST_SCREEN_KEY));
  } catch {
    return null;
  }
};

const safeSessionTimeoutMs = (mins: unknown) => {
  const n = Number(mins);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(1440, Math.trunc(n)));
  return clamped > 0 ? clamped * 60 * 1000 : 0;
};

const writeLastScreen = (screen: Screen) => {
  try {
    localStorage.setItem(LAST_SCREEN_KEY, String(screen));
  } catch {
    // ignore
  }
};

const AppContent: React.FC = () => {
  useEffect(() => {
    const onError = (ev: any) => {
      try {
        const msg = String(ev?.message || ev?.error?.message || '');
        if (msg.includes('cssRules') && msg.includes('putRootVars')) {
          if (typeof ev?.preventDefault === 'function') ev.preventDefault();
          return;
        }
      } catch {
        // ignore
      }
    };
    const onRejection = (ev: any) => {
      try {
        const msg = String(ev?.reason?.message || ev?.reason || '');
        if (msg.includes('cssRules') && msg.includes('putRootVars')) {
          if (typeof ev?.preventDefault === 'function') ev.preventDefault();
          return;
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('error', onError as any);
    window.addEventListener('unhandledrejection', onRejection as any);
    initTabSession();
    const onStorage = () => {
      try {
        const s = readSession<any>();
        if (!s?.token) {
          setUserRole(null);
          setCurrentScreen(Screen.LOGIN);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mirachpos-session-changed', onStorage as any);
    return () => {
      window.removeEventListener('error', onError as any);
      window.removeEventListener('unhandledrejection', onRejection as any);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mirachpos-session-changed', onStorage as any);
    };
  }, []);

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search || '');
      const flag = qs.get('autologin');
      if (flag !== '1') return;

      const token = String(qs.get('token') || '').trim();
      const tenantSlug = String(qs.get('tenant') || '').trim().toLowerCase();
      const tenantId = String(qs.get('tenantId') || '').trim();
      const staffId = String(qs.get('staffId') || '').trim();
      const staffName = String(qs.get('staffName') || '').trim();
      const roleRaw = String(qs.get('role') || '').trim();
      const branchId = String(qs.get('branchId') || 'global').trim() || 'global';
      const permissionsRaw = String(qs.get('permissions') || '').trim();

      if (!token || !tenantSlug || !tenantId || !roleRaw) return;

      const mappedRole =
        roleRaw === UserRole.WAITER
          ? UserRole.WAITER
          : roleRaw === UserRole.WAITER_MANAGER
            ? UserRole.WAITER_MANAGER
            : roleRaw === UserRole.BRANCH_MANAGER
              ? UserRole.BRANCH_MANAGER
              : roleRaw === UserRole.SUPER_ADMIN
                ? UserRole.SUPER_ADMIN
                : roleRaw === UserRole.CAFE_OWNER
                  ? UserRole.CAFE_OWNER
                  : (roleRaw as any);

      const initialScreen = (() => {
        if (mappedRole === UserRole.WAITER) return Screen.WAITER_DASHBOARD;
        if (mappedRole === UserRole.WAITER_MANAGER) return Screen.WAITER_DASHBOARD;
        if (mappedRole === UserRole.BRANCH_MANAGER) return Screen.MANAGER_DASHBOARD;
        if (mappedRole === UserRole.SUPER_ADMIN) return Screen.SA_OVERVIEW;
        if (mappedRole === UserRole.CAFE_OWNER) return Screen.OWNER_DASHBOARD;
        return Screen.DASHBOARD;
      })();

      const permissions = (() => {
        if (!permissionsRaw) return [] as string[];
        return permissionsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
      })();

      writeSession({
        token,
        role: mappedRole,
        tenantId,
        tenantSlug,
        tenant: { id: tenantId, slug: tenantSlug, name: '' },
        staffId,
        staffName,
        branchId,
        permissions,
        subscription: null,
        billing: null,
        screen: initialScreen,
      });

      // Important: the session-changed listener is registered later, so update local React state too.
      setUserRole(mappedRole);
      setCurrentScreen(initialScreen);
      setPermissions(permissions);

      try {
        localStorage.setItem('mirachpos.lastWorkspace.v1', tenantSlug);
      } catch {
        // ignore
      }

      try {
        if (mappedRole === UserRole.BRANCH_MANAGER) {
          localStorage.setItem('mirachpos.manager.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.WAITER) {
          localStorage.setItem('mirachpos.waiter.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.WAITER_MANAGER) {
          localStorage.setItem('mirachpos.waiter.selectedBranchId.v1', branchId);
        }
        if (mappedRole === UserRole.CAFE_OWNER && branchId && branchId !== 'global') {
          localStorage.setItem('mirachpos.owner.selectedBranchId.v1', branchId);
        }
      } catch {
        // ignore
      }

      try {
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, '', cleanUrl);
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, []);

  const readSessionSubscription = () => {
    try {
      const parsed = readSession<any>();
      return parsed?.subscription || null;
    } catch {
      return null;
    }
  };

  const readSessionBilling = () => {
    try {
      const parsed = readSession<any>();
      return parsed?.billing || null;
    } catch {
      return null;
    }
  };

  const [subscription, setSubscription] = useState(() => readSessionSubscription());
  const [billing, setBilling] = useState(() => readSessionBilling());
  const [permissions, setPermissions] = useState(() => readSessionPermissions());

  const [currentScreen, setCurrentScreen] = useState<Screen>(() => {
    try {
      const parsed = readSession<any>();
      const fromHash = readHashScreen();
      const fromLast = readLastScreen();
      const fromSession = parseScreen(parsed?.screen) ?? Screen.LOGIN;
      const restored = fromHash || fromLast || fromSession;
      return restored;
    } catch {
      return Screen.LOGIN;
    }
  });

  const [ownerOnboardingComplete, setOwnerOnboardingComplete] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(() => {
    try {
      const parsed = readSession<any>();
      return (parsed?.role as UserRole) ?? null;
    } catch {
      return null;
    }
  });

  // POS security: idle session timeout (waiter/manager only)
  const [posTimeoutMs, setPosTimeoutMs] = useState(0);
  const [lastActivityMs, setLastActivityMs] = useState(() => Date.now());

  useEffect(() => {
    if (!userRole || !isPosRole(userRole)) {
      setPosTimeoutMs(0);
      return;
    }

    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/pos/settings');
        const json = (await res.json().catch(() => null)) as any;
        if (!mounted) return;
        if (!res.ok) return;
        const mins = json?.security?.sessionTimeoutMins;
        setPosTimeoutMs(safeSessionTimeoutMs(mins));
      } catch {
        if (!mounted) return;
        setPosTimeoutMs(0);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [userRole]);

  useEffect(() => {
    if (!posTimeoutMs || !userRole || !isPosRole(userRole)) return;

    const bump = () => setLastActivityMs(Date.now());
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener('pointerdown', bump, opts);
    window.addEventListener('keydown', bump, opts);
    window.addEventListener('scroll', bump, opts);
    window.addEventListener('touchstart', bump, opts);

    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('scroll', bump);
      window.removeEventListener('touchstart', bump);
    };
  }, [posTimeoutMs, userRole]);

  useEffect(() => {
    if (!posTimeoutMs || !userRole || !isPosRole(userRole)) return;

    const t = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityMs;
      if (idleMs >= posTimeoutMs) {
        logoutAndReload();
      }
    }, 15000);

    return () => window.clearInterval(t);
  }, [lastActivityMs, posTimeoutMs, userRole]);

  useEffect(() => {
    // Any navigation counts as activity.
    setLastActivityMs(Date.now());
  }, [currentScreen]);

  useEffect(() => {
    try {
      if (!userRole) return;
      const parsed = readSession<any>();
      const sessRole = (parsed?.role as UserRole) ?? null;
      const sessScreen = (parsed?.screen as Screen) ?? null;

      // Avoid clobbering external session updates (e.g. impersonation) with stale React state.
      if (sessRole && sessRole !== userRole) return;
      if (sessScreen && sessScreen !== currentScreen) return;

      updateSession({ role: userRole, screen: currentScreen });

      // Persist for reload restoration.
      if (currentScreen !== Screen.LOGIN) {
        writeLastScreen(currentScreen);
        writeHashScreen(currentScreen);
      }
    } catch {
      // ignore
    }
  }, [currentScreen, userRole]);

  const navigate = (screen: Screen) => {
    setCurrentScreen(screen);
    try {
      writeLastScreen(screen);
      writeHashScreen(screen);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onChanged = () => {
      setSubscription(readSessionSubscription());
      setBilling(readSessionBilling());
      setPermissions(readSessionPermissions());
      try {
        const parsed = readSession<any>();
        const nextRole = (parsed?.role as UserRole) ?? null;
        const nextScreen = parseScreen(parsed?.screen) ?? Screen.LOGIN;
        setUserRole(nextRole);
        // Prefer URL hash / last screen on refresh, but allow explicit session changes (impersonation).
        const fromHash = readHashScreen();
        const fromLast = readLastScreen();
        setCurrentScreen(fromHash || fromLast || nextScreen);
      } catch {
        // ignore
      }
    };
    window.addEventListener('mirachpos-session-changed', onChanged);
    return () => window.removeEventListener('mirachpos-session-changed', onChanged);
  }, []);

  const [upgradeModalDismissed, setUpgradeModalDismissed] = useState(false);
  const [moduleBlocked, setModuleBlocked] = useState<{ error: string; module: string; path: string } | null>(null);
  const [accessDenied, setAccessDenied] = useState<{ error: string; path: string } | null>(null);
  const [updaterState, setUpdaterState] = useState<any>(null);
  const [updaterDismissed, setUpdaterDismissed] = useState(false);
  const upgradeModalKey = (() => {
    if (userRole !== UserRole.CAFE_OWNER) return '';
    if (currentScreen === Screen.LOGIN) return '';
    const st = String((billing as any)?.status || '').toLowerCase().replace(/\s+/g, '_');
    if (st !== 'past_due' && st !== 'canceled' && st !== 'pending_verify' && st !== 'verification_needed') return '';
    const tenantId = (() => {
      try {
        const parsed = readSession<any>();
        return String(parsed?.tenantId || '');
      } catch {
        return '';
      }
    })();
    const nextBillAt = String((billing as any)?.nextBillAt || '');
    return `mirachpos.upgradeModalDismissed.v1:${tenantId}:${st}:${nextBillAt}`;
  })();

  useEffect(() => {
    if (!upgradeModalKey) {
      setUpgradeModalDismissed(false);
      return;
    }
    try {
      setUpgradeModalDismissed(localStorage.getItem(upgradeModalKey) === '1');
    } catch {
      setUpgradeModalDismissed(false);
    }
  }, [upgradeModalKey]);

  useEffect(() => {
    const u = (window as any)?.mirachpos?.updater;
    if (!u) return;

    let unsub: any = null;
    try {
      unsub = u.onState((st: any) => {
        setUpdaterState(st || null);
        if (st?.status === 'available' || st?.status === 'downloading' || st?.status === 'downloaded') {
          setUpdaterDismissed(false);
        }
      });
    } catch {
      // ignore
    }

    try {
      Promise.resolve(u.getState()).then((st: any) => setUpdaterState(st || null));
    } catch {
      // ignore
    }

    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const onBlocked = (ev: any) => {
      const d = ev?.detail && typeof ev.detail === 'object' ? ev.detail : null;
      const error = typeof d?.error === 'string' ? d.error : '';
      const moduleKey = typeof d?.module === 'string' ? d.module : '';
      const path = typeof d?.path === 'string' ? d.path : '';
      if (!error) return;
      setModuleBlocked({ error, module: moduleKey, path });

      // For subscription-wide lockouts (trial ended / canceled / pending verification),
      // route the user to Billing immediately so the app never feels "empty".
      try {
        if (error === 'subscription_inactive' || error === 'subscription_pending_verify') {
          navigate(Screen.OWNER_BILLING);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('mirachpos-module-blocked', onBlocked as any);
    return () => window.removeEventListener('mirachpos-module-blocked', onBlocked as any);
  }, []);

  useEffect(() => {
    const onDenied = (ev: any) => {
      const d = ev?.detail && typeof ev.detail === 'object' ? ev.detail : null;
      const error = typeof d?.error === 'string' ? d.error : '';
      const path = typeof d?.path === 'string' ? d.path : '';
      if (!error) return;
      setAccessDenied({ error, path });
    };
    window.addEventListener('mirachpos-access-denied', onDenied as any);
    return () => window.removeEventListener('mirachpos-access-denied', onDenied as any);
  }, []);

  const shouldShowUpgradeModal = Boolean(upgradeModalKey) && !upgradeModalDismissed;

  useEffect(() => {
    const onHash = () => {
      const s = readHashScreen();
      if (s) setCurrentScreen(s);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!userRole) return;
      if (userRole !== UserRole.CAFE_OWNER) {
        if (!cancelled) setOwnerOnboardingComplete(true);
        return;
      }
      try {
        const token = (readSession<any>() as any)?.token || '';
        if (!token) {
          if (!cancelled) setOwnerOnboardingComplete(null);
          return;
        }
        const res = await apiFetch('/api/owner/onboarding', { auth: true });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!cancelled) setOwnerOnboardingComplete(Boolean(json?.onboarding?.completed));
      } catch {
        if (!cancelled) setOwnerOnboardingComplete(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [userRole]);

  const handleLogin = (role: UserRole) => {
    setUserRole(role);
    // Redirect based on role
    if (role === UserRole.WAITER || role === UserRole.WAITER_MANAGER) {
      navigate(Screen.WAITER_DASHBOARD);
    } else if (role === UserRole.SUPER_ADMIN) {
      navigate(Screen.SA_OVERVIEW);
    } else if (role === UserRole.CAFE_OWNER) {
      const sess = readSession<any>() as any;
      const sub = sess?.subscription ?? subscription;
      navigate(homeForRoleWithSubscription(role, sub));
    } else if (role === UserRole.BRANCH_MANAGER) {
      navigate(Screen.MANAGER_DASHBOARD);
    } else {
      navigate(Screen.DASHBOARD);
    }
  };

  const handleLogout = () => {
    setUserRole(null);
    navigate(Screen.LOGIN);
    clearSession();
  };

  const navigateBackToTenants = () => {
    navigate(Screen.SA_TENANTS);
  };

  useEffect(() => {
    if (!userRole) return;
    if (currentScreen === Screen.LOGIN) return;
    // Avoid redirecting to home while subscription is still loading (prevents refresh jumping).
    if (userRole === UserRole.CAFE_OWNER && subscription == null) return;
    if (!canAccessScreenWithPermissions(userRole, currentScreen, subscription, permissions)) {
      navigate(homeForRoleWithSubscription(userRole, subscription));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScreen, userRole, ownerOnboardingComplete, subscription, permissions]);

  if (currentScreen === Screen.LOGIN || !userRole) {
    const path = (() => {
      try {
        return String(window.location?.pathname || '/');
      } catch {
        return '/';
      }
    })();

    const isProd = Boolean((import.meta as any)?.env?.PROD);
    const secretSaPath = String((import.meta as any)?.env?.VITE_SUPERADMIN_LOGIN_PATH || '').trim();

    const saPaths = (() => {
      if (isProd) return secretSaPath ? [secretSaPath] : [];
      return Array.from(
        new Set(
          [secretSaPath, secretSaPath ? '' : '/_sa_/']
            .map((s) => String(s || '').trim())
            .filter(Boolean),
        ),
      );
    })();

    if (saPaths.some((p) => path.startsWith(p))) {
      return <SuperAdminLogin onLogin={handleLogin} />;
    }

    return <Login onLogin={handleLogin} />;
  }

  if (currentScreen === Screen.BRANCH_SELECT) {
    return <BranchSelect />;
  }

  if (currentScreen === Screen.OWNER_ONBOARDING) {
    return <OwnerOnboarding onNavigate={navigate} onCompleted={() => setOwnerOnboardingComplete(true)} />;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden transition-colors duration-200">
      <Sidebar
        currentScreen={currentScreen}
        setScreen={navigate}
        role={userRole!}
        logout={handleLogout}
      />

      <main className="flex-1 h-full overflow-hidden bg-background relative transition-colors duration-200 pb-8">
        {null}

        {moduleBlocked ? (
          <div className="absolute top-0 left-0 right-0 z-[110] p-3">
            <div className="mx-auto max-w-5xl rounded-xl border border-border bg-card text-muted-foreground px-4 py-3 flex items-start justify-between gap-4 shadow-xl">
              <div className="flex flex-col">
                <div className="text-foreground font-extrabold text-sm">
                  {moduleBlocked.error === 'module_not_enabled'
                    ? `Module disabled${moduleBlocked.module ? `: ${moduleBlocked.module}` : ''}`
                    : moduleBlocked.error === 'subscription_pending_verify'
                      ? 'Subscription pending verification'
                      : moduleBlocked.error === 'subscription_inactive'
                        ? 'Subscription inactive'
                        : 'Access blocked'}
                </div>
                <div className="text-xs mt-1">
                  {moduleBlocked.error === 'module_not_enabled'
                    ? 'This feature is not enabled for your tenant. Update modules or upgrade your plan.'
                    : moduleBlocked.error === 'subscription_pending_verify'
                      ? 'Your upgrade request is awaiting verification. Premium modules are temporarily locked.'
                      : moduleBlocked.error === 'subscription_inactive'
                        ? 'Your subscription is due or canceled. Renew to restore access.'
                        : 'This action is blocked by your subscription/entitlements.'}
                </div>
                {moduleBlocked.path ? <div className="text-[10px] mt-1 opacity-75 font-mono">{moduleBlocked.path}</div> : null}
              </div>

              <div className="flex items-center gap-2">
                {userRole === UserRole.CAFE_OWNER ? (
                  <button
                    type="button"
                    className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-black hover:bg-primary/90"
                    onClick={() => {
                      if (moduleBlocked.error === 'module_not_enabled') navigate(Screen.OWNER_SETTINGS);
                      else navigate(Screen.OWNER_BILLING);
                      setModuleBlocked(null);
                    }}
                  >
                    {moduleBlocked.error === 'module_not_enabled' ? 'Open Modules' : 'Upgrade / Renew'}
                  </button>
                ) : null}

                <button
                  type="button"
                  className="h-9 px-3 rounded-lg border border-border bg-secondary text-muted-foreground text-xs font-bold hover:text-foreground hover:bg-secondary/80"
                  onClick={() => setModuleBlocked(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {accessDenied ? (
          <div className="absolute top-0 left-0 right-0 z-[109] p-3">
            <div className="mx-auto max-w-5xl rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 flex items-start justify-between gap-4 shadow-xl">
              <div className="flex flex-col">
                <div className="text-foreground font-extrabold text-sm">Access denied</div>
                <div className="text-xs mt-1">You do not have permission to perform this action.</div>
                {accessDenied.path ? <div className="text-[10px] mt-1 opacity-75 font-mono">{accessDenied.path}</div> : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-9 px-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs font-bold hover:bg-destructive/20"
                  onClick={() => setAccessDenied(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {shouldShowUpgradeModal ? (
          <div className="fixed top-0 bottom-0 right-0 left-64 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                try {
                  if (upgradeModalKey) localStorage.setItem(upgradeModalKey, '1');
                } catch {
                }
                setUpgradeModalDismissed(true);
              }}
            />
            <div className="relative w-full max-w-[640px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <div className="text-foreground font-black text-lg">Unlock Premium Features</div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    try {
                      if (upgradeModalKey) localStorage.setItem(upgradeModalKey, '1');
                    } catch {
                    }
                    setUpgradeModalDismissed(true);
                  }}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-6">
                <div className="text-muted-foreground text-sm leading-relaxed">
                  {(() => {
                    const st = String((billing as any)?.status || '').toLowerCase().replace(/\s+/g, '_');
                    if (st === 'pending_verify' || st === 'verification_needed') return 'Your upgrade request is awaiting verification. Premium modules are temporarily locked until payment is confirmed.';
                    return 'Your subscription is due. You were downgraded to Basic and premium modules are locked. Renew now to restore premium features.';
                  })()}
                </div>
                <div className="mt-5 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    className="h-11 px-4 rounded-lg border border-border bg-secondary text-muted-foreground text-sm font-bold hover:text-foreground hover:bg-secondary/80"
                    onClick={() => {
                      try {
                        if (upgradeModalKey) localStorage.setItem(upgradeModalKey, '1');
                      } catch {
                      }
                      setUpgradeModalDismissed(true);
                    }}
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-black hover:bg-primary/90"
                    onClick={() => {
                      try {
                        localStorage.setItem('mirachpos.settings.initialTab.v1', 'subscription');
                      } catch {
                      }
                      navigate(Screen.OWNER_BILLING);
                      try {
                        if (upgradeModalKey) localStorage.setItem(upgradeModalKey, '1');
                      } catch {
                      }
                      setUpgradeModalDismissed(true);
                    }}
                  >
                    Upgrade / Renew
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {/* SHARED / OLDER SCREENS */}
        {currentScreen === Screen.DASHBOARD && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Dashboard role={userRole!} />}
        {currentScreen === Screen.POS_FLOOR && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterDashboard onNavigate={navigate} />}
        {currentScreen === Screen.ORDERS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Orders />}
        {currentScreen === Screen.TABLE_ASSIGNMENT && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <TableAssignment onNavigate={navigate} />}
        {currentScreen === Screen.GUESTS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Guests />}

        {/* WAITER SPECIFIC SCREENS */}
        {currentScreen === Screen.WAITER_DASHBOARD && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterDashboard onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_MENU && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterMenu onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_REVIEW && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterOrderReview onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_PAYMENT && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterPayment onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_RECEIPT && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterReceipt onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_ACTIVE_ORDERS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterActiveOrders onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_STATUS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterOrderStatus onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_KDS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterKDS onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_HISTORY && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterHistory onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_NOTIFICATIONS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterNotifications onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_SYSTEM && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterSystemStatus onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_SETTINGS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterSettings onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_SHIFT_REPORT && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <WaiterShiftReport onNavigate={navigate} />}
        {currentScreen === Screen.WAITER_SCHEDULE && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ShiftSchedule readOnly />}

        {/* CAFE OWNER (GLOBAL) SCREENS */}
        {currentScreen === Screen.OWNER_DASHBOARD && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerDashboard />}
        {currentScreen === Screen.OWNER_FINANCE && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerFinance />}
        {currentScreen === Screen.OWNER_INVENTORY && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerInventory />}
        {currentScreen === Screen.OWNER_REPORTS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <GlobalReports />}
        {currentScreen === Screen.OWNER_BRANCHES && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerBranches />}
        {currentScreen === Screen.OWNER_STAFF && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerStaffManagement />}
        {currentScreen === Screen.OWNER_AUDIT && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerAudit />}
        {currentScreen === Screen.OWNER_MENU && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <MenuManagement />}
        {currentScreen === Screen.OWNER_SETTINGS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Settings />}
        {currentScreen === Screen.OWNER_BILLING && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <OwnerBilling />}
        {currentScreen === Screen.SUPPORT_REQUEST && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SupportRequest />}

        {currentScreen === Screen.STAFF_SCHEDULE && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ShiftSchedule />}

        {/* BRANCH MANAGER (LOCAL) SCREENS */}
        {currentScreen === Screen.MANAGER_DASHBOARD && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <BranchDashboard onNavigate={navigate} />}
        {currentScreen === Screen.DESKTOP_DRAFT_INBOX && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <DraftInbox />}
        {currentScreen === Screen.MANAGER_ORDERS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <BranchOrders onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_ORDER_DETAILS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <BranchOrderDetails onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_FLOOR_MAP && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ManagerFloorMap onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_TABLE_DETAILS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ManagerTableDetails onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_CUSTOMERS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ManagerCustomers />}
        {currentScreen === Screen.MANAGER_INVENTORY && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Inventory onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_RECIPE_BUILDER && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <RecipeBuilder onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_MENU_BUILDER && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <MenuBuilder onNavigate={navigate} />}
        {currentScreen === Screen.MANAGER_STAFF && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <ManagerTeam />}
        {currentScreen === Screen.MANAGER_FINANCE && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <Finance />}
        {currentScreen === Screen.MANAGER_REPORTS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <BranchReports />}
        {currentScreen === Screen.MANAGER_SETTINGS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <BranchSettings />}
        {currentScreen === Screen.SUPPORT_REQUEST && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SupportRequest />}

        {/* SUPER ADMIN SCREENS */}
        {currentScreen === Screen.SA_OVERVIEW && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SA_Overview onNavigate={navigate} />}
        {currentScreen === Screen.SA_TENANTS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SA_Tenants onNavigate={navigate} />}
        {currentScreen === Screen.SA_TENANT_DETAILS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && (
          <SA_TenantDetails onBack={navigateBackToTenants} onNavigate={navigate} />
        )}
        {currentScreen === Screen.SA_DEMO_REQUESTS && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SA_DemoRequests />}
        {currentScreen === Screen.SA_ONBOARDING && canAccessScreenWithPermissions(userRole!, currentScreen, subscription, permissions) && <SA_OnboardingDesign onNavigate={navigate} />}
        {currentScreen === Screen.SA_BILLING && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Billing />}
        {currentScreen === Screen.SA_PAYMENT_CONFIG && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <PaymentConfig />}
        {currentScreen === Screen.SA_SYSTEM_HEALTH && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_SystemHealth />}
        {currentScreen === Screen.SA_SUPPORT && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Support />}
        {currentScreen === Screen.SA_AUDIT && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Audit />}
        {currentScreen === Screen.SA_FEATURE_FLAGS && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_FeatureFlags />}
        {currentScreen === Screen.SA_INTEGRATIONS && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Integrations />}
        {currentScreen === Screen.SA_ADDONS && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Addons />}
        {currentScreen === Screen.SA_SETTINGS && canAccessScreenWithSubscription(userRole!, currentScreen, subscription) && <SA_Settings />}
        {userRole ? (
          <div className="fixed bottom-0 left-64 right-0 h-8 border-t border-border bg-card text-muted-foreground text-xs flex items-center justify-center z-40">
            Powered by <span className="text-foreground font-bold ml-1">MirachPos</span>
          </div>
        ) : null}
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <PosProvider>
        <AppContent />
      </PosProvider>
    </ThemeProvider>
  );
};

export default App;
