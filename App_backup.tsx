
import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Orders } from './screens/Orders';
import { OwnerFinance } from './screens/owner/OwnerFinance';
import { ThemeProvider } from './ThemeContext';
import { PosProvider } from './PosContext';

// Import Cafe Owner Screens
import { OwnerDashboard } from './screens/owner/OwnerDashboard';
import { OwnerInventory } from './screens/owner/OwnerInventory';
import { GlobalReports } from './screens/owner/GlobalReports';
import { OwnerBranches } from './screens/owner/OwnerBranches';
import { OwnerStaffManagement } from './screens/owner/OwnerStaffManagement';

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

// Import Shared / Placeholder Screens
import { Inventory } from './screens/Inventory';
import { Staff } from './screens/Staff';
import { Finance } from './screens/Finance';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';
import { MenuManagement } from './screens/MenuManagement';
import { Guests } from './screens/Guests';
import { TableAssignment } from './screens/TableAssignment';
import { BranchSelect } from './screens/BranchSelect';

// Super Admin Imports
import { SA_Overview } from './screens/superadmin/Overview';
import { SA_Tenants } from './screens/superadmin/Tenants';
import { SA_TenantDetails } from './screens/superadmin/TenantDetails';
import { SA_Onboarding } from './screens/superadmin/Onboarding';
import { SA_Billing } from './screens/superadmin/Billing';
import { SA_SystemHealth } from './screens/superadmin/SystemHealth';
import { SA_Support } from './screens/superadmin/Support';
import { SA_Audit } from './screens/superadmin/Audit';
import { SA_FeatureFlags } from './screens/superadmin/FeatureFlags';
import { SA_Settings } from './screens/superadmin/Settings';

import { Screen, UserRole } from './types';

const AppContent: React.FC = () => {
  const SESSION_KEY = 'mirachpos.session.v1';

  const [currentScreen, setCurrentScreen] = useState<Screen>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return Screen.LOGIN;
      const parsed = JSON.parse(raw) as { screen?: Screen };
      return parsed?.screen ?? Screen.LOGIN;
    } catch {
      return Screen.LOGIN;
    }
  });
  const [userRole, setUserRole] = useState<UserRole | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { role?: UserRole };
      return parsed?.role ?? null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (!userRole) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ role: userRole, screen: currentScreen }));
    } catch {
      // ignore
    }
  }, [currentScreen, userRole]);

  const handleLogin = (role: UserRole) => {
    setUserRole(role);
    // Redirect based on role
    if (role === UserRole.WAITER) {
        setCurrentScreen(Screen.WAITER_DASHBOARD);
    } else if (role === UserRole.SUPER_ADMIN) {
        setCurrentScreen(Screen.SA_OVERVIEW);
    } else if (role === UserRole.CAFE_OWNER) {
        setCurrentScreen(Screen.OWNER_DASHBOARD);
    } else if (role === UserRole.BRANCH_MANAGER) {
        setCurrentScreen(Screen.MANAGER_DASHBOARD);
    } else {
        setCurrentScreen(Screen.DASHBOARD);
    }
  };

  const handleLogout = () => {
    setUserRole(null);
    setCurrentScreen(Screen.LOGIN);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  };

  const navigateBackToTenants = () => {
      setCurrentScreen(Screen.SA_TENANTS);
  };

  if (currentScreen === Screen.LOGIN || !userRole) {
    return <Login onLogin={handleLogin} />;
  }

  if (currentScreen === Screen.BRANCH_SELECT) {
      return <BranchSelect />;
  }

  return (
    <div className="flex h-screen w-full bg-gray-50 dark:bg-[#181611] overflow-hidden transition-colors duration-200">
      <Sidebar 
        currentScreen={currentScreen} 
        setScreen={setCurrentScreen} 
        role={userRole!} 
        logout={handleLogout}
      />
      
      <main className="flex-1 h-full overflow-hidden bg-gray-50 dark:bg-background relative transition-colors duration-200">
        {/* SHARED / OLDER SCREENS */}
        {currentScreen === Screen.DASHBOARD && <Dashboard role={userRole!} />}
        {currentScreen === Screen.POS_FLOOR && <WaiterDashboard onNavigate={setCurrentScreen} />} 
        {currentScreen === Screen.ORDERS && <Orders />} 
        {currentScreen === Screen.TABLE_ASSIGNMENT && <TableAssignment onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.GUESTS && <Guests />}

        {/* WAITER SPECIFIC SCREENS */}
        {currentScreen === Screen.WAITER_DASHBOARD && <WaiterDashboard onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_MENU && <WaiterMenu onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_REVIEW && <WaiterOrderReview onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_PAYMENT && <WaiterPayment onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_RECEIPT && <WaiterReceipt onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_ACTIVE_ORDERS && <WaiterActiveOrders onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_STATUS && <WaiterOrderStatus onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_KDS && <WaiterKDS onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_HISTORY && <WaiterHistory onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_NOTIFICATIONS && <WaiterNotifications onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.WAITER_SYSTEM && <WaiterSystemStatus onNavigate={setCurrentScreen} />}

        {/* CAFE OWNER (GLOBAL) SCREENS */}
        {currentScreen === Screen.OWNER_DASHBOARD && <OwnerDashboard />}
        {currentScreen === Screen.OWNER_FINANCE && <OwnerFinance />}
        {currentScreen === Screen.OWNER_INVENTORY && <OwnerInventory />}
        {currentScreen === Screen.OWNER_REPORTS && <GlobalReports />}
        {currentScreen === Screen.OWNER_BRANCHES && <OwnerBranches />}
        {currentScreen === Screen.OWNER_STAFF && <OwnerStaffManagement />}
        {currentScreen === Screen.OWNER_MENU && <MenuManagement />}
        {currentScreen === Screen.OWNER_SETTINGS && <Settings />}

        {/* BRANCH MANAGER (LOCAL) SCREENS */}
        {currentScreen === Screen.MANAGER_DASHBOARD && <BranchDashboard onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_ORDERS && <BranchOrders onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_ORDER_DETAILS && <BranchOrderDetails onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_FLOOR_MAP && <ManagerFloorMap onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_TABLE_DETAILS && <ManagerTableDetails onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_INVENTORY && <Inventory onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_RECIPE_BUILDER && <RecipeBuilder onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_MENU_BUILDER && <MenuBuilder onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.MANAGER_STAFF && <Staff />}
        {currentScreen === Screen.MANAGER_FINANCE && <Finance />}
        {currentScreen === Screen.MANAGER_REPORTS && <BranchReports />}
        {currentScreen === Screen.MANAGER_SETTINGS && <BranchSettings />}

        {/* SUPER ADMIN SCREENS */}
        {currentScreen === Screen.SA_OVERVIEW && <SA_Overview />}
        {currentScreen === Screen.SA_TENANTS && <SA_Tenants onNavigate={setCurrentScreen} />}
        {currentScreen === Screen.SA_TENANT_DETAILS && <SA_TenantDetails onBack={navigateBackToTenants} />}
        {currentScreen === Screen.SA_ONBOARDING && <SA_Onboarding />}
        {currentScreen === Screen.SA_BILLING && <SA_Billing />}
        {currentScreen === Screen.SA_SYSTEM_HEALTH && <SA_SystemHealth />}
        {currentScreen === Screen.SA_SUPPORT && <SA_Support />}
        {currentScreen === Screen.SA_AUDIT && <SA_Audit />}
        {currentScreen === Screen.SA_FEATURE_FLAGS && <SA_FeatureFlags />}
        {currentScreen === Screen.SA_SETTINGS && <SA_Settings />}
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
