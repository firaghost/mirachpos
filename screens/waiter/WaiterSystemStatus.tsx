import React, { useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { apiFetch } from '../../api';
import { usePos } from '../../PosContext';
import { formatDeviceDateTime } from '../../datetime';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterSystemStatus: React.FC<Props> = ({ onNavigate }) => {
  const { orders, notifications, refreshFromServer, markNotificationRead, realtime, outbox } = usePos();

  const [actionErr, setActionErr] = useState('');

  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const pendingUploads = useMemo(() => orders.filter((o) => o.syncedToServer !== true).length, [orders]);
  const syncedToday = useMemo(() => {
    const now = new Date();
    return orders.filter((o) => {
      if (o.syncedToServer !== true) return false;
      if (!o.syncedAt) return false;
      const d = new Date(o.syncedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }).length;
  }, [orders]);
  const conflicts = useMemo(() => notifications.filter((n) => n.type === 'System' && !n.read).length, [notifications]);

  const systemUnread = useMemo(() => {
    return notifications
      .filter((n) => n.type === 'System' && !n.read)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }, [notifications]);

  const queue = useMemo(() => {
    return orders
      .filter((o) => o.syncedToServer !== true)
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        title: `${o.tableName} - ${o.number}`,
        summary: o.items.map((i) => `${i.qty}x ${i.name}`).join(', '),
        time: o.timeLabel,
        status: 'Pending',
      }));
  }, [orders]);

  const pendingProgress = Math.min(100, (pendingUploads / Math.max(1, pendingUploads + syncedToday)) * 100);
  const syncedProgress = Math.min(100, (syncedToday / Math.max(1, pendingUploads + syncedToday)) * 100);
  const conflictsProgress = Math.min(100, conflicts > 0 ? 100 : 0);

  const statusLabel = (s: string) => (s === 'Pending' ? (isOnline ? 'Pending' : 'Pending (Offline)') : s);
  const statusPill = (s: string) =>
    s === 'Pending'
      ? 'bg-[#cf7317]/10 text-[#cf7317] border border-[#cf7317]/20'
      : 'bg-white/10 text-[#c8ad93] border border-white/10';

  const markAllSystemRead = () => {
    try {
      for (const n of notifications) {
        if (n.type !== 'System') continue;
        if (n.read) continue;
        markNotificationRead(n.id, true);
      }
    } catch {
      // ignore
    }
  };

  const refresh = async () => {
    setActionErr('');
    try {
      await refreshFromServer();
    } catch {
      setActionErr('Failed to refresh from server.');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#211911] text-white">
      <header className="flex items-center justify-between border-b border-[#3d3226] px-6 py-4 bg-[#2c241b] z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-[#211911] border border-[#3d3226] text-[#cf7317]">
            <span className="material-symbols-outlined">wifi</span>
          </div>
          <div className="flex flex-col">
            <h2 className="text-white text-lg font-bold leading-tight">Connectivity & Sync</h2>
            <p className="text-[#c8ad93] text-xs">
              Network: {isOnline ? 'Online' : 'Offline'}    Local storage: Enabled    Realtime: {realtime?.connected ? 'Connected' : 'Disconnected'}
            </p>
            <p className="text-[#c8ad93] text-xs">
              Outbox: {outbox?.total || 0} total    Ready: {outbox?.ready || 0}    Max attempts: {outbox?.maxAttempts || 0}
              {outbox?.stuck ? `    Stuck: ${outbox.stuck} (>=${outbox.stuckAfter || 8})` : ''}
            </p>
            {outbox?.nextAttemptAtMin ? <p className="text-[#c8ad93] text-xs">Next retry: {formatDeviceDateTime(outbox.nextAttemptAtMin)}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void refresh()}
            className="h-9 px-4 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 flex items-center gap-2 text-sm font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            Refresh
          </button>
          <div className="size-9 rounded-full bg-[#211911] border border-[#3d3226] flex items-center justify-center text-[#c8ad93]">
            <span className="material-symbols-outlined text-[18px]">person</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <div className="text-[#c8ad93] text-sm">
            <span className="opacity-70">Dashboard</span> <span className="opacity-50">/</span> <span className="text-white font-semibold">System Status</span>
          </div>

          {actionErr ? <div className="text-xs text-red-300 font-semibold">{actionErr}</div> : null}

          <div className="w-full">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 rounded-xl border border-[#3d3226] bg-[#2c241b] p-6 relative overflow-hidden">
              <div className="flex items-start gap-4 z-10">
                <div className={`p-3 rounded-full shrink-0 ${isOnline ? 'bg-green-500/10 text-green-400' : 'bg-[#cf7317]/10 text-[#cf7317]'}`}>
                  <span className="material-symbols-outlined text-3xl">{isOnline ? 'wifi' : 'wifi_off'}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-white text-lg font-bold leading-tight flex items-center gap-2">
                    {isOnline ? 'Online & Syncing' : 'Offline Mode Active'}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold border ${
                      isOnline ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-[#cf7317]/10 text-[#cf7317] border-[#cf7317]/20'
                    }`}>{isOnline ? 'Connected' : 'Local Storage Only'}</span>
                  </h3>
                  <p className="text-[#c8ad93] text-sm max-w-xl leading-relaxed">
                    {isOnline
                      ? `Connection looks good. ${pendingUploads} transactions are in progress.`
                      : `You are currently working offline. ${pendingUploads} transactions are saved locally and will sync automatically when connection is restored. No data will be lost.`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
                  void refresh();
                }}
                className="flex shrink-0 min-w-[180px] cursor-pointer items-center justify-center rounded-lg h-11 px-6 bg-[#cf7317] hover:bg-[#e08428] text-white text-sm font-extrabold shadow-lg shadow-[#cf7317]/20 transition-all z-10"
              >
                Attempt Reconnect
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-4 rounded-xl p-5 border border-[#3d3226] bg-[#2c241b]">
              <div className="flex justify-between items-start">
                <p className="text-[#c8ad93] text-sm font-semibold">Pending Uploads</p>
                <span className="material-symbols-outlined text-[#cf7317]">cloud_upload</span>
              </div>
              <p className="text-white text-3xl font-bold tracking-tight">{pendingUploads} <span className="text-base font-normal text-[#c8ad93]">Items</span></p>
              <div className="h-1.5 w-full bg-[#211911] rounded-full overflow-hidden border border-[#3d3226]">
                <div className="h-full bg-[#cf7317]" style={{ width: `${pendingProgress}%` }}></div>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-xl p-5 border border-[#3d3226] bg-[#2c241b]">
              <div className="flex justify-between items-start">
                <p className="text-[#c8ad93] text-sm font-semibold">Synced Today</p>
                <span className="material-symbols-outlined text-green-500">check_circle</span>
              </div>
              <p className="text-white text-3xl font-bold tracking-tight">{syncedToday} <span className="text-base font-normal text-[#c8ad93]">Orders</span></p>
              <div className="h-1.5 w-full bg-[#211911] rounded-full overflow-hidden border border-[#3d3226]">
                <div className="h-full bg-green-500" style={{ width: `${syncedProgress}%` }}></div>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-xl p-5 border border-orange-500/30 bg-[#2c241b]">
              <div className="flex justify-between items-start">
                <p className="text-orange-200 text-sm font-semibold">Conflicts Detected</p>
                <span className="material-symbols-outlined text-orange-500">warning</span>
              </div>
              <p className="text-white text-3xl font-bold tracking-tight">{conflicts} <span className="text-base font-normal text-[#c8ad93]">Alert</span></p>
              <div className="h-1.5 w-full bg-[#211911] rounded-full overflow-hidden border border-[#3d3226]">
                <div className="h-full bg-orange-500" style={{ width: `${conflictsProgress}%` }}></div>
              </div>
              {conflicts > 0 ? <div className="text-xs text-orange-200/80">Requires manual review</div> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col rounded-xl border border-[#483c23] bg-[#2c241b] overflow-hidden">
              <div className="p-5 border-b border-[#3d3226] flex justify-between items-center">
                <h3 className="text-white text-lg font-bold">Sync Queue</h3>
                <button
                  onClick={() => onNavigate(Screen.WAITER_HISTORY)}
                  className="text-xs font-extrabold text-[#cf7317] hover:text-white uppercase tracking-wide"
                >
                  View all history
                </button>
              </div>
              <div className="flex flex-col">
                {queue.length === 0 ? (
                  <div className="p-6 text-[#c8ad93] text-sm">Sync queue is empty.</div>
                ) : (
                  queue.map((q) => (
                    <div key={q.id} className="flex items-center gap-4 p-4 border-b border-[#3d3226] hover:bg-white/5 transition-colors">
                      <div className="size-10 rounded-full bg-[#211911] border border-[#3d3226] flex items-center justify-center text-[#c8ad93]"><span className="material-symbols-outlined">restaurant</span></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1"><h4 className="text-white font-semibold truncate">{q.title}</h4><span className="text-xs text-[#c8ad93]">{q.time}</span></div>
                        <p className="text-[#c8ad93] text-sm truncate">{q.summary}</p>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1 ${statusPill(q.status)}`}>{statusLabel(q.status)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <div className="rounded-xl border border-orange-500/30 bg-[#2c241b] overflow-hidden">
                <div className="p-5 border-b border-[#3d3226] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-orange-500">warning</span>
                    <h3 className="text-white text-sm font-bold">System Alerts</h3>
                  </div>
                  <button
                    onClick={() => {
                      setActionErr('');
                      markAllSystemRead();
                    }}
                    className="h-9 px-3 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] font-bold hover:text-white hover:border-[#cf7317]/30"
                  >
                    Mark read
                  </button>
                </div>
                <div className="p-5">
                  {systemUnread.length === 0 ? (
                    <div className="text-sm text-[#c8ad93]">No unread system alerts.</div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {systemUnread.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => markNotificationRead(n.id, true)}
                          className="text-left rounded-lg border border-[#3d3226] bg-[#211911] p-3 hover:bg-white/5"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-white text-sm font-bold truncate">{n.title}</div>
                            <div className="text-[11px] text-[#c8ad93] whitespace-nowrap">{formatDeviceDateTime(n.createdAt)}</div>
                          </div>
                          <div className="mt-1 text-sm text-[#c8ad93]">{n.message}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[#3d3226] bg-[#2c241b] p-5">
                <h3 className="text-white text-sm font-bold mb-4">Device Diagnostics</h3>
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#c8ad93] text-lg">database</span><span className="text-[#c8ad93] text-sm">Local Storage</span></div>
                    <span className="text-green-500 text-xs font-bold bg-green-500/10 px-2 py-0.5 rounded">Healthy</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#c8ad93] text-lg">print</span><span className="text-[#c8ad93] text-sm">Printer Link</span></div>
                    <span className="text-green-500 text-xs font-bold bg-green-500/10 px-2 py-0.5 rounded">Connected</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#c8ad93] text-lg">router</span><span className="text-[#c8ad93] text-sm">Gateway</span></div>
                    <span className="text-red-400 text-xs font-bold bg-red-500/10 px-2 py-0.5 rounded">{isOnline ? 'Reachable' : 'Unreachable'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
