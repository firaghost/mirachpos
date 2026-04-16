import React, { useMemo } from 'react';

import { Screen } from '../../types';

import { WaiterNotifications } from './WaiterNotifications';
import { KitchenBoard } from './KitchenBoard';
import { ExpoBoard } from './ExpoBoard';

type ServicePane = 'floor' | 'kitchen' | 'expo' | 'notifications';

const screenToPane = (screen: Screen): ServicePane => {
  switch (screen) {
    case Screen.WAITER_WORKSPACE:
      return 'floor';
    case Screen.WAITER_EXPO:
      return 'expo';
    case Screen.WAITER_KDS:
    case Screen.WAITER_KITCHEN:
      return 'kitchen';
    case Screen.WAITER_NOTIFICATIONS:
      return 'notifications';
    default:
      return 'floor';
  }
};

export type ServiceWorkspaceProps = {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  expoEnabled?: boolean;
  inlineNotificationsEnabled?: boolean;
};

export const ServiceWorkspace: React.FC<ServiceWorkspaceProps> = ({
  currentScreen,
  onNavigate,
  expoEnabled = false,
  inlineNotificationsEnabled = false,
}) => {
  const activePane = useMemo(() => {
    return screenToPane(currentScreen);
  }, [currentScreen]);

  const alertsOpen = inlineNotificationsEnabled && currentScreen === Screen.WAITER_NOTIFICATIONS;

  const closeAlertsTo = useMemo(() => {
    if (activePane === 'kitchen') return Screen.WAITER_KITCHEN;
    return Screen.WAITER_WORKSPACE;
  }, [activePane]);

  const renderPane = () => {
    switch (activePane) {
      case 'kitchen':
        return <KitchenBoard onNavigate={onNavigate} />;
      case 'expo':
        return expoEnabled ? <ExpoBoard onNavigate={onNavigate} /> : <KitchenBoard onNavigate={onNavigate} />;
      case 'notifications':
        return (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            Notifications Panel
          </div>
        );
      case 'floor':
      default:
        return (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            Waiter Workspace - Use POS for order management
          </div>
        );
    }
  };

  return (
    <div className="h-full w-full relative">
      <div className="h-full w-full overflow-auto">{renderPane()}</div>

      {alertsOpen ? (
        <div className="absolute inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onPointerDown={(e) => {
              e.preventDefault();
              onNavigate(closeAlertsTo);
            }}
          />
          <div className="relative w-[420px] max-w-[90vw] h-full bg-card border-l border-border overflow-auto">
            <div className="h-12 px-3 border-b border-border flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-widest text-foreground">Alerts</div>
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-border bg-background text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onNavigate(closeAlertsTo);
                }}
              >
                Close
              </button>
            </div>
            <WaiterNotifications onNavigate={onNavigate} />
          </div>
        </div>
      ) : null}
    </div>
  );
};
