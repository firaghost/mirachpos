import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Orders } from './screens/Orders';
import { OwnerFinance } from './screens/owner/OwnerFinance';
import { ThemeProvider } from './ThemeContext';
import { PosProvider } from './PosContext';
import { apiFetch, logoutAndReload } from './api';

import { AppIcon } from '@/components/ui/app-icon';
import { TrialBanner } from './components/TrialBanner';
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

import { usePosIdleTimeout } from '@/hooks/usePosIdleTimeout';
import { useSessionEventWiring } from '@/hooks/useSessionEventWiring';

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

  useSessionEventWiring({
    initTabSession,
    readSession,
    setUserRole,
    setCurrentScreen,
    loginScreen: Screen.LOGIN,
  });

  usePosIdleTimeout({
    userRole,
    currentScreen: String(currentScreen),
    isPosRole,
    safeSessionTimeoutMs,
    apiFetch,
    logoutAndReload,
  });

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
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [paywallPlans, setPaywallPlans] = useState<
    Array<{ tier: string; modules: string[]; limits: any; pricing: { monthlyEtb: number; yearlyEtb: number } }>
  >([]);
  const [paywallPlansError, setPaywallPlansError] = useState<string | null>(null);

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

  const shouldShowUpgradeModal = Boolean(upgradeModalKey) && !upgradeModalDismissed;

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

  const updaterBadge = (() => {
    if (updaterDismissed) return null;
    const st = updaterState && typeof updaterState === 'object' ? updaterState : null;
    const status = installingUpdate ? 'installing' : String(st?.status || '');
    const percent = (() => {
      try {
        const p = Number(st?.progress?.percent);
        return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null;
      } catch {
        return null;
      }
    })();
    if (status !== 'checking' && status !== 'downloading' && status !== 'installing' && status !== 'downloaded') return null;

    const label =
      status === 'installing'
        ? 'Installing update'
        : status === 'downloading'
          ? percent == null
            ? 'Downloading update'
            : `Downloading ${percent.toFixed(0)}%`
          : status === 'downloaded'
            ? 'Update ready'
            : 'Checking updates';

    const onInstall = async () => {
      try {
        const u = (window as any)?.mirachpos?.updater;
        if (!u) return;
        setInstallingUpdate(true);
        await u.quitAndInstall();
      } catch {
        setInstallingUpdate(false);
      }
    };

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-border bg-card text-muted-foreground shadow-lg">
          {status !== 'downloaded' ? (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-current/20 border-t-current animate-spin" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
          )}
          <span className="text-xs font-bold whitespace-nowrap">{label}</span>
          {status === 'downloaded' ? (
            <button
              type="button"
              onClick={onInstall}
              className="h-7 px-3 rounded-full border text-[11px] font-extrabold"
              style={{ backgroundColor: 'var(--mirach-primary)', borderColor: 'var(--mirach-primary)', color: '#221c11' }}
            >
              Restart
            </button>
          ) : null}
          {status === 'installing' ? (
            <button
              type="button"
              disabled
              className="h-7 px-3 rounded-full border border-border bg-card text-muted-foreground text-[11px] font-extrabold opacity-80"
            >
              Restart
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setUpdaterDismissed(true)}
            className="h-6 w-6 rounded-full border border-current/20 bg-transparent text-current/80 hover:text-current flex items-center justify-center"
            aria-label="Dismiss update status"
          >
            <AppIcon name="close" className="text-[16px]" size={16} />
          </button>
        </div>
      </div>
    );
  })();

  useEffect(() => {
    const onHash = () => {
      const s = readHashScreen();
      if (s) setCurrentScreen(s);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onModuleBlocked = (ev: any) => {
      const d = ev?.detail;
      const error = String(d?.error || '').trim();
      const moduleKey = String(d?.module || '').trim();
      const path = String(d?.path || '').trim();
      if (!error) return;
      setModuleBlocked({ error, module: moduleKey, path });

      if (userRole !== UserRole.CAFE_OWNER) return;

      const tenantId = (() => {
        try {
          const parsed = readSession<any>();
          return String(parsed?.tenantId || '');
        } catch {
          return '';
        }
      })();
      const k = `mirachpos.paywallDismissed.v1:${tenantId}:${error}:${moduleKey || 'any'}`;
      try {
        if (localStorage.getItem(k) === '1') return;
      } catch {
      }
      setPaywallOpen(true);
    };

    const onAccessDenied = (ev: any) => {
      const d = ev?.detail;
      const error = String(d?.error || '').trim();
      const path = String(d?.path || '').trim();
      if (!error) return;
      try {
        const next = homeForRoleWithSubscription(userRole as any, subscription);
        if (next && next !== currentScreen) navigate(next);
      } catch {
      }
      setAccessDenied(null);
    };

    window.addEventListener('mirachpos-module-blocked', onModuleBlocked as any);
    window.addEventListener('mirachpos-access-denied', onAccessDenied as any);
    return () => {
      window.removeEventListener('mirachpos-module-blocked', onModuleBlocked as any);
      window.removeEventListener('mirachpos-access-denied', onAccessDenied as any);
    };
  }, [currentScreen, navigate, subscription, userRole]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!paywallOpen) return;
      if (userRole !== UserRole.CAFE_OWNER) return;
      setPaywallLoading(true);
      setPaywallPlansError(null);
      try {
        const res = await apiFetch('/api/owner/plans');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
        const plans = Array.isArray(json?.plans) ? json.plans : [];
        if (!cancelled) setPaywallPlans(plans);
      } catch (e) {
        if (!cancelled) {
          setPaywallPlans([]);
          setPaywallPlansError(e instanceof Error ? e.message : 'Failed to load plans');
        }
      } finally {
        if (!cancelled) setPaywallLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [paywallOpen, userRole]);

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
    <>
      <TrialBanner />
      <div className="flex h-screen w-full bg-background overflow-hidden transition-colors duration-200">
        <Sidebar
        currentScreen={currentScreen}
        setScreen={navigate}
        role={userRole!}
        logout={handleLogout}
      />

      <main className="flex-1 h-full overflow-hidden bg-background relative transition-colors duration-200 pb-8">
        {null}
        {updaterBadge}

        {paywallOpen && userRole === UserRole.CAFE_OWNER ? (
          <div className="fixed top-0 bottom-0 right-0 left-64 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                const tenantId = (() => {
                  try {
                    const parsed = readSession<any>();
                    return String(parsed?.tenantId || '');
                  } catch {
                    return '';
                  }
                })();
                const error = String(moduleBlocked?.error || '').trim();
                const moduleKey = String(moduleBlocked?.module || '').trim();
                const k = `mirachpos.paywallDismissed.v1:${tenantId}:${error}:${moduleKey || 'any'}`;
                try {
                  localStorage.setItem(k, '1');
                } catch {
                }
                setPaywallOpen(false);
              }}
            />
            <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <div className="text-foreground font-black text-lg">Upgrade to unlock this feature</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {moduleBlocked?.module ? `Requested module: ${moduleBlocked.module}` : 'Premium feature'}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const tenantId = (() => {
                      try {
                        const parsed = readSession<any>();
                        return String(parsed?.tenantId || '');
                      } catch {
                        return '';
                      }
                    })();
                    const error = String(moduleBlocked?.error || '').trim();
                    const moduleKey = String(moduleBlocked?.module || '').trim();
                    const k = `mirachpos.paywallDismissed.v1:${tenantId}:${error}:${moduleKey || 'any'}`;
                    try {
                      localStorage.setItem(k, '1');
                    } catch {
                    }
                    setPaywallOpen(false);
                  }}
                >
                  <AppIcon name="close" />
                </button>
              </div>

              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                  <div className="text-foreground font-extrabold text-sm">What you get with Premium</div>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <AppIcon name="check" className="text-primary text-[18px] mt-0.5" size={18} />
                      <span>Unlock premium modules and advanced reporting.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <AppIcon name="check" className="text-primary text-[18px] mt-0.5" size={18} />
                      <span>Faster operations with multi-branch and staff tools.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <AppIcon name="check" className="text-primary text-[18px] mt-0.5" size={18} />
                      <span>Priority support for billing and setup issues.</span>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="text-foreground font-bold text-xs uppercase tracking-wider">Billing options</div>
                    <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
                      Pay online when available (Chapa / Telebirr) or submit bank transfer proof. Both are supported in Billing.
                    </div>
                  </div>

                  {moduleBlocked?.path ? <div className="mt-4 text-[10px] opacity-75 font-mono text-muted-foreground">{moduleBlocked.path}</div> : null}
                </div>

                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-foreground font-extrabold text-sm">Choose a plan</div>
                    {paywallPlansError ? <div className="text-xs text-destructive">{paywallPlansError}</div> : null}
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {paywallLoading ? (
                      <div className="md:col-span-3 p-6 rounded-xl border border-border bg-muted/30 text-muted-foreground text-sm flex items-center gap-2">
                        <AppIcon name="sync" className="text-[18px] animate-spin" size={18} />
                        Loading plans…
                      </div>
                    ) : paywallPlans.length === 0 ? (
                      <div className="md:col-span-3 p-6 rounded-xl border border-border bg-muted/30 text-muted-foreground text-sm">
                        Plans are not available right now. Open Billing to continue.
                      </div>
                    ) : (
                      paywallPlans.map((p) => (
                        <div key={p.tier} className="rounded-xl border border-border bg-background p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-foreground font-black text-sm uppercase tracking-wide">{p.tier}</div>
                            <div className="text-xs text-muted-foreground">ETB</div>
                          </div>
                          <div className="mt-3">
                            <div className="text-foreground font-extrabold text-xl leading-none">
                              {Number(p?.pricing?.monthlyEtb || 0).toLocaleString()}
                              <span className="text-xs text-muted-foreground font-bold ml-1">/mo</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {Number(p?.pricing?.yearlyEtb || 0).toLocaleString()} / year
                            </div>
                          </div>
                          <div className="mt-4 text-xs text-muted-foreground">
                            {Array.isArray(p.modules) && p.modules.length > 0 ? `${p.modules.length} modules included` : 'Modules included'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="h-11 px-4 rounded-lg border border-border bg-secondary text-muted-foreground text-sm font-bold hover:text-foreground hover:bg-secondary/80"
                      onClick={() => {
                        const tenantId = (() => {
                          try {
                            const parsed = readSession<any>();
                            return String(parsed?.tenantId || '');
                          } catch {
                            return '';
                          }
                        })();
                        const error = String(moduleBlocked?.error || '').trim();
                        const moduleKey = String(moduleBlocked?.module || '').trim();
                        const k = `mirachpos.paywallDismissed.v1:${tenantId}:${error}:${moduleKey || 'any'}`;
                        try {
                          localStorage.setItem(k, '1');
                        } catch {
                        }
                        setPaywallOpen(false);
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
                        setPaywallOpen(false);
                      }}
                    >
                      Go to Billing
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {null}

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
                  <AppIcon name="close" />
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
    </>
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
