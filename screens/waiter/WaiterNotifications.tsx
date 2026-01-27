import { AppIcon } from '@/components/ui/app-icon';

import React, { useEffect, useMemo, useState } from 'react';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterNotifications: React.FC<Props> = ({ onNavigate }) => {
  const { notifications, markAllNotificationsRead, markNotificationRead, selectOrder, refreshFromServer } = usePos();
  const [filter, setFilter] = useState<'All' | 'Kitchen' | 'Payments' | 'System'>('All');

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const formatRelative = (iso: string) => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} hr ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'Yesterday';
    return `${diffD} days ago`;
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const filtered = useMemo(() => {
    if (filter === 'All') return notifications;
    return notifications.filter((n) => n.type === filter);
  }, [filter, notifications]);

  const { today, yesterday, older } = useMemo(() => {
    const now = new Date();
    const y = new Date();
    y.setDate(now.getDate() - 1);

    const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const t: typeof sorted = [];
    const yd: typeof sorted = [];
    const o: typeof sorted = [];
    for (const n of sorted) {
      const d = new Date(n.createdAt);
      if (isSameDay(d, now)) t.push(n);
      else if (isSameDay(d, y)) yd.push(n);
      else o.push(n);
    }
    return { today: t, yesterday: yd, older: o };
  }, [filtered]);

  const Chip = ({ value, label, icon }: { value: typeof filter; label: string; icon: string }) => (
    <button
      onClick={() => setFilter(value)}
      className={`flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-lg px-4 text-sm transition-colors border ${
        filter === value
          ? 'bg-primary text-foreground border-primary/40'
          : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
      }`}
    >
      <AppIcon name={icon} className="text-[18px]" size={18} />
      <span className={filter === value ? 'font-bold' : 'font-semibold'}>{label}</span>
    </button>
  );

  const iconFor = (type: string) => (type === 'Kitchen' ? 'soup_kitchen' : type === 'Payments' ? 'payments' : 'wifi');
  const iconBgFor = (type: string) =>
    type === 'Kitchen' ? 'bg-primary/20 text-primary' : type === 'Payments' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400';
  const accentFor = (type: string) =>
    type === 'Kitchen' ? 'border-[#cf7317]' : type === 'Payments' ? 'border-green-500' : 'border-orange-500';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
            <div>
              <h1 className="text-foreground text-3xl font-bold tracking-tight">Notifications</h1>
              <p className="text-muted-foreground text-sm mt-1">Stay updated on orders, payments, and kitchen alerts.</p>
            </div>
            <button
              onClick={markAllNotificationsRead}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card text-foreground text-sm font-semibold hover:bg-card/80 border border-border"
            >
              <AppIcon name="done_all" className="text-[18px]" size={18} />
              Mark all as read
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto py-6 no-scrollbar">
            <Chip value="All" label="All" icon="filter_list" />
            <Chip value="Kitchen" label="Kitchen" icon="soup_kitchen" />
            <Chip value="Payments" label="Payments" icon="payments" />
            <Chip value="System" label="System" icon="settings" />
          </div>

          <div className="flex flex-col gap-8">
            <div>
              <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-4">Today</div>
              <div className="flex flex-col gap-3">
                {today.length === 0 ? (
                  <div className="text-muted-foreground text-sm">No notifications today.</div>
                ) : (
                  today.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markNotificationRead(n.id, true)}
                      className={`group relative flex items-start gap-4 bg-card p-4 rounded-xl border-l-4 shadow-sm transition-all cursor-pointer hover:bg-card/80 ${accentFor(n.type)} ${
                        n.read ? 'opacity-70' : ''
                      }`}
                    >
                      <div className={`mt-1 flex items-center justify-center rounded-full shrink-0 size-10 ${iconBgFor(n.type)}`}>
                        <AppIcon name={iconFor(n.type)} className="icon-filled" />
                      </div>

                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-3">
                          <p className="text-foreground text-base font-semibold leading-tight truncate">{n.title}</p>
                          <div className="flex items-center gap-3 shrink-0">
                            {!n.read ? (
                              <span className="inline-flex items-center rounded-full bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary border border-primary/30">
                                New
                              </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(n.createdAt)}</span>
                          </div>
                        </div>
                        <p className="text-muted-foreground text-sm mt-1 leading-normal">{n.message}</p>

                        <div className="mt-3 flex items-center gap-4">
                          {n.type === 'Kitchen' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markNotificationRead(n.id, true);
                                if (n.orderId) {
                                  selectOrder(n.orderId);
                                  onNavigate(Screen.WAITER_REVIEW);
                                }
                              }}
                              className="text-xs font-bold text-primary hover:text-foreground uppercase tracking-wide"
                            >
                              View order
                            </button>
                          ) : null}

                          {n.type === 'Payments' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markNotificationRead(n.id, true);
                                if (n.orderId) {
                                  selectOrder(n.orderId);
                                  onNavigate(Screen.WAITER_RECEIPT);
                                }
                              }}
                              className="text-xs font-bold text-green-400 hover:text-foreground uppercase tracking-wide"
                            >
                              View receipt
                            </button>
                          ) : null}

                          {n.type === 'System' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markNotificationRead(n.id, true);
                                onNavigate(Screen.WAITER_SYSTEM);
                              }}
                              className="text-xs font-bold text-orange-300 hover:text-foreground uppercase tracking-wide"
                            >
                              View system
                            </button>
                          ) : null}

                          {n.read ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markNotificationRead(n.id, false);
                              }}
                              className="text-xs font-bold text-muted-foreground hover:text-foreground"
                            >
                              Mark unread
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {yesterday.length > 0 ? (
              <div>
                <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-4">Yesterday</div>
                <div className="flex flex-col gap-3">
                  {yesterday.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markNotificationRead(n.id, true)}
                      className={`group relative flex items-start gap-4 bg-card p-4 rounded-xl border-l-4 shadow-sm transition-all cursor-pointer hover:bg-card/80 ${accentFor(n.type)} opacity-70`}
                    >
                      <div className={`mt-1 flex items-center justify-center rounded-full shrink-0 size-10 ${iconBgFor(n.type)}`}>
                        <AppIcon name={iconFor(n.type)} className="icon-filled" />
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-3">
                          <p className="text-foreground text-base font-semibold leading-tight truncate">{n.title}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(n.createdAt)}</span>
                        </div>
                        <p className="text-muted-foreground text-sm mt-1 leading-normal">{n.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {older.length > 0 ? (
              <div>
                <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-4">Earlier</div>
                <div className="flex flex-col gap-3">
                  {older.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markNotificationRead(n.id, true)}
                      className={`group relative flex items-start gap-4 bg-card p-4 rounded-xl border-l-4 shadow-sm transition-all cursor-pointer hover:bg-card/80 ${accentFor(n.type)} opacity-70`}
                    >
                      <div className={`mt-1 flex items-center justify-center rounded-full shrink-0 size-10 ${iconBgFor(n.type)}`}>
                        <AppIcon name={iconFor(n.type)} className="icon-filled" />
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-3">
                          <p className="text-foreground text-base font-semibold leading-tight truncate">{n.title}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(n.createdAt)}</span>
                        </div>
                        <p className="text-muted-foreground text-sm mt-1 leading-normal">{n.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {today.length === 0 && yesterday.length === 0 && older.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm mt-12">You're all caught up!</div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
};
