import React, { useMemo } from 'react';

import { Screen } from '../../types';

import { WaiterDashboard } from './WaiterDashboard';
import { WaiterMenu } from './WaiterMenu';
import { WaiterOrderReview } from './WaiterOrderReview';
import { WaiterPayment } from './WaiterPayment';
import { WaiterReceipt } from './WaiterReceipt';
import { WaiterActiveOrders } from './WaiterActiveOrders';
import { WaiterNotifications } from './WaiterNotifications';
import { WaiterSystemStatus } from './WaiterSystemStatus';
import { WaiterSettings } from './WaiterSettings';
import { KitchenBoard } from './KitchenBoard';
import { ExpoBoard } from './ExpoBoard';
import { WaiterOrderV2 } from '../waiter2/WaiterOrderV2';

import { cn } from '@/components/lib/utils';

type ServicePane = 'floor' | 'order' | 'review' | 'checkout' | 'receipt' | 'kitchen' | 'expo' | 'active';

const screenToPane = (screen: Screen): ServicePane => {
  switch (screen) {
    case Screen.WAITER_DASHBOARD:
    case Screen.POS_FLOOR:
      return 'floor';
    case Screen.WAITER_MENU:
    case Screen.POS_MENU:
      return 'order';
    case Screen.WAITER_REVIEW:
      return 'review';
    case Screen.WAITER_PAYMENT:
      return 'checkout';
    case Screen.WAITER_RECEIPT:
      return 'receipt';
    case Screen.WAITER_ACTIVE_ORDERS:
      return 'active';
    case Screen.WAITER_EXPO:
      return 'expo';
    case Screen.WAITER_STATUS:
    case Screen.WAITER_KDS:
    case Screen.WAITER_KITCHEN:
      return 'kitchen';
    default:
      return 'floor';
  }
};

export type ServiceWorkspaceProps = {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  posUiV2Enabled: boolean;
  expoEnabled: boolean;
  inlineReviewEnabled: boolean;
  inlineActiveEnabled: boolean;
  inlineKitchenEnabled: boolean;
  inlineExpoEnabled: boolean;
  inlineNotificationsEnabled: boolean;
  inlineSystemEnabled: boolean;
  inlineSecurityEnabled: boolean;
};

export const ServiceWorkspace: React.FC<ServiceWorkspaceProps> = ({
  currentScreen,
  onNavigate,
  posUiV2Enabled,
  expoEnabled,
  inlineReviewEnabled,
  inlineActiveEnabled,
  inlineKitchenEnabled,
  inlineExpoEnabled,
  inlineNotificationsEnabled,
  inlineSystemEnabled,
  inlineSecurityEnabled,
}) => {
  const activePane = useMemo(() => {
    if (inlineReviewEnabled && currentScreen === Screen.WAITER_REVIEW) return 'checkout';
    if (inlineActiveEnabled && currentScreen === Screen.WAITER_ACTIVE_ORDERS) return 'floor';
    if (inlineKitchenEnabled && (currentScreen === Screen.WAITER_STATUS || currentScreen === Screen.WAITER_KDS)) return 'kitchen';
    if (inlineKitchenEnabled && inlineExpoEnabled && currentScreen === Screen.WAITER_EXPO) return 'kitchen';
    if (inlineNotificationsEnabled && currentScreen === Screen.WAITER_NOTIFICATIONS) return 'floor';
    if (inlineSystemEnabled && currentScreen === Screen.WAITER_SYSTEM) return 'floor';
    if (inlineSecurityEnabled && currentScreen === Screen.WAITER_SETTINGS) return 'floor';
    return screenToPane(currentScreen);
  }, [
    currentScreen,
    inlineReviewEnabled,
    inlineActiveEnabled,
    inlineKitchenEnabled,
    inlineExpoEnabled,
    inlineNotificationsEnabled,
    inlineSystemEnabled,
    inlineSecurityEnabled,
  ]);

  const reviewOpen = inlineReviewEnabled && currentScreen === Screen.WAITER_REVIEW;
  const activeOpen = inlineActiveEnabled && currentScreen === Screen.WAITER_ACTIVE_ORDERS;
  const alertsOpen = inlineNotificationsEnabled && currentScreen === Screen.WAITER_NOTIFICATIONS;
  const systemOpen = inlineSystemEnabled && currentScreen === Screen.WAITER_SYSTEM;
  const securityOpen = inlineSecurityEnabled && currentScreen === Screen.WAITER_SETTINGS;

  const closeAlertsTo = useMemo(() => {
    if (activePane === 'order') return Screen.WAITER_MENU;
    if (activePane === 'checkout') return Screen.WAITER_PAYMENT;
    if (activePane === 'receipt') return Screen.WAITER_RECEIPT;
    if (activePane === 'kitchen') return Screen.WAITER_KITCHEN;
    return Screen.WAITER_DASHBOARD;
  }, [activePane]);

  const renderPane = () => {
    switch (activePane) {
      case 'floor':
        return (
          <div className="h-full w-full relative">
            <WaiterDashboard onNavigate={onNavigate} />
            {activeOpen ? (
              <div className="absolute inset-0 z-50 flex">
                <div
                  className="absolute inset-0 bg-black/50"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onNavigate(Screen.WAITER_DASHBOARD);
                  }}
                />
                <div className="relative w-[480px] max-w-[85vw] h-full bg-card border-r border-border overflow-auto">
                  <div className="h-12 px-3 border-b border-border flex items-center justify-between">
                    <div className="text-xs font-black uppercase tracking-widest text-foreground">Active Orders</div>
                    <button
                      type="button"
                      className="h-9 px-3 rounded-lg border border-border bg-background text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onNavigate(Screen.WAITER_DASHBOARD);
                      }}
                    >
                      Close
                    </button>
                  </div>
                  <WaiterActiveOrders onNavigate={onNavigate} />
                </div>
              </div>
            ) : null}
          </div>
        );
      case 'order':
        return posUiV2Enabled ? <WaiterOrderV2 onNavigate={onNavigate} /> : <WaiterMenu onNavigate={onNavigate} />;
      case 'review':
        return <WaiterOrderReview onNavigate={onNavigate} />;
      case 'checkout':
        return (
          <div className="h-full w-full flex">
            <div className={cn('flex-1 min-w-0', reviewOpen ? 'border-r border-border' : '')}>
              <WaiterPayment onNavigate={onNavigate} />
            </div>
            {reviewOpen ? (
              <div className="w-[440px] max-w-[45vw] h-full overflow-auto bg-card">
                <WaiterOrderReview onNavigate={onNavigate} />
              </div>
            ) : null}
          </div>
        );
      case 'receipt':
        return <WaiterReceipt onNavigate={onNavigate} />;
      case 'kitchen':
        return <KitchenBoard onNavigate={onNavigate} />;
      case 'expo':
        return expoEnabled ? <ExpoBoard onNavigate={onNavigate} /> : <KitchenBoard onNavigate={onNavigate} />;
      case 'active':
        return <WaiterActiveOrders onNavigate={onNavigate} />;
      default:
        return <WaiterDashboard onNavigate={onNavigate} />;
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

      {systemOpen ? (
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
              <div className="text-xs font-black uppercase tracking-widest text-foreground">Network</div>
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
            <WaiterSystemStatus onNavigate={onNavigate} />
          </div>
        </div>
      ) : null}

      {securityOpen ? (
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
              <div className="text-xs font-black uppercase tracking-widest text-foreground">Security</div>
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
            <WaiterSettings onNavigate={onNavigate} />
          </div>
        </div>
      ) : null}
    </div>
  );
};
