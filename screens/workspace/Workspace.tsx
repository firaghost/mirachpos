import React, { useEffect, useMemo, useState } from 'react';

import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { readSession } from '../../session';

import { FloorPanel } from './FloorPanel';
import { MenuPanel } from './MenuPanel';
import { CartPanel } from './CartPanel';
import { ActiveOrdersPanel } from './ActiveOrdersPanel';

import { cn } from '@/components/lib/utils';

type WorkspaceView = 'floor' | 'menu' | 'cart' | 'active';

export type WorkspaceProps = {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  posUiV2Enabled: boolean;
};

export const Workspace: React.FC<WorkspaceProps> = ({ currentScreen, onNavigate, posUiV2Enabled: _posUiV2Enabled }) => {
  const { selectedTableId, selectTable, addToCart, setTableAssignment, tables, selectOrder, orders } = usePos();

  const features = useMemo(() => {
    try {
      const parsed = readSession<any>();
      return Array.isArray(parsed?.features) ? parsed.features.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }, []);

  const waiterFeatureMode = useMemo(() => features.some((f) => String(f).startsWith('waiter_')), [features]);
  const hasFeature = (key: string) => (!waiterFeatureMode ? true : features.includes(key));

  const actor = useMemo(() => {
    try {
      const s = readSession<any>();
      const staffId = typeof s?.staffId === 'string' ? s.staffId.trim() : '';
      const staffName = typeof s?.staffName === 'string' ? s.staffName.trim() : '';
      return { staffId, staffName };
    } catch {
      return { staffId: '', staffName: '' };
    }
  }, []);

  const tabs = useMemo(() => {
    const out: Array<{ key: WorkspaceView; label: string }> = [];
    if (hasFeature('waiter_floor')) out.push({ key: 'floor', label: 'Floor' });
    if (hasFeature('waiter_menu')) out.push({ key: 'menu', label: 'Menu' });
    if (hasFeature('waiter_cart')) out.push({ key: 'cart', label: 'Cart' });
    if (hasFeature('waiter_orders_active')) out.push({ key: 'active', label: 'Active' });
    return out;
  }, [waiterFeatureMode, features]);

  const defaultView = useMemo<WorkspaceView>(() => {
    if (currentScreen === Screen.WAITER_ACTIVE_ORDERS && hasFeature('waiter_orders_active')) return 'active';
    if ((currentScreen === Screen.WAITER_MENU || currentScreen === Screen.POS_MENU) && hasFeature('waiter_menu')) return 'menu';
    if (hasFeature('waiter_floor')) return 'floor';
    return tabs[0]?.key ?? 'floor';
  }, [currentScreen, tabs, waiterFeatureMode, features]);

  const [view, setView] = useState<WorkspaceView>(defaultView);

  useEffect(() => {
    setView(defaultView);
  }, [defaultView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(defaultView);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [defaultView]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)_420px_360px]">
        <div className={cn('min-h-0 border-r border-border bg-background', view !== 'floor' ? 'lg:block hidden' : '')}>
          <FloorPanel
            onSelectTable={(tableId) => {
              selectTable(tableId);
              onNavigate(Screen.WAITER_DASHBOARD);

              try {
                const table = tables.find((t) => t.id === tableId) ?? null;
                if (table && !table.assignedStaffId && actor.staffId) {
                  setTableAssignment([tableId], actor.staffId, actor.staffName || null);
                }

                const openOrderId = table?.openOrderId ? String(table.openOrderId) : '';
                if (openOrderId) {
                  selectOrder(openOrderId);
                  const o = orders.find((x) => x.id === openOrderId) ?? null;
                  const orderStatus = o ? String(o.status || '').trim() : '';
                  const tableStatus = table ? String((table as any).status || '').trim() : '';
                  if (orderStatus === 'Served' || tableStatus === 'Payment') {
                    onNavigate(Screen.WAITER_PAYMENT);
                    return;
                  }
                  onNavigate(Screen.WAITER_REVIEW);
                  return;
                }
              } catch {
                // ignore
              }

              if (hasFeature('waiter_menu')) setView('menu');
              else if (hasFeature('waiter_cart')) setView('cart');
            }}
          />
        </div>

        <div className={cn('min-h-0 bg-background', view !== 'menu' ? 'lg:block hidden' : '')}>
          <MenuPanel
            selectedTableId={selectedTableId}
            onAddItem={(productId) => {
              if (!selectedTableId) return;
              addToCart(selectedTableId, productId);
              if (hasFeature('waiter_cart')) setView('cart');
            }}
          />
        </div>

        <div className={cn('min-h-0 border-l border-border bg-background', view !== 'cart' ? 'lg:block hidden' : '')}>
          <CartPanel
            selectedTableId={selectedTableId}
            onOrderSent={(orderId) => {
              try {
                if (orderId) selectOrder(orderId);
              } catch {
                // ignore
              }
              if (hasFeature('waiter_orders_active')) {
                setView('active');
                onNavigate(Screen.WAITER_ACTIVE_ORDERS);
                return;
              }
              if (hasFeature('waiter_floor')) {
                setView('floor');
                onNavigate(Screen.WAITER_DASHBOARD);
              }
            }}
          />
        </div>

        <div className={cn('min-h-0 border-l border-border bg-background', view !== 'active' ? 'lg:block hidden' : '')}>
          <ActiveOrdersPanel
            onNavigate={onNavigate}
            onFocusTable={(tableId) => {
              selectTable(tableId);
              if (hasFeature('waiter_floor')) setView('floor');
            }}
          />
        </div>
      </div>

      <div className="lg:hidden border-t border-border bg-card p-2">
        <div className={cn('grid gap-2', tabs.length === 4 ? 'grid-cols-4' : tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={cn(
                'h-11 rounded-xl border text-xs font-black uppercase tracking-widest',
                view === t.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                setView(t.key);
                if (t.key === 'floor') onNavigate(Screen.WAITER_DASHBOARD);
                if (t.key === 'menu') onNavigate(Screen.WAITER_MENU);
                if (t.key === 'active') onNavigate(Screen.WAITER_ACTIVE_ORDERS);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
