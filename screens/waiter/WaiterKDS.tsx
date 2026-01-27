import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { formatDeviceTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterKDS: React.FC<Props> = ({ onNavigate }) => {
  const { orders, setOrderStatus, refreshFromServer } = usePos();
  const [filter, setFilter] = useState<'All' | 'Ready' | 'Preparing' | 'Served' | 'Voided' | 'Completed'>('All');
  const [query, setQuery] = useState('');

  const [actionErr, setActionErr] = useState('');

  const [now, setNow] = useState<Date>(() => new Date());
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = async () => {
    setActionErr('');
    try {
      await refreshFromServer();
    } catch {
      setActionErr('Failed to refresh from server.');
    }
  };

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

  const Timeline: React.FC<{ stage: 'Sent' | 'Prep' | 'Ready' | 'Served' }> = ({ stage }) => {
    const width = stage === 'Served' ? '100%' : stage === 'Ready' ? '75%' : stage === 'Prep' ? '50%' : '25%';
    return (
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between relative mb-2">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-secondary rounded-full z-0"></div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full z-0" style={{ width }}></div>
          <div className="z-10 bg-primary w-2.5 h-2.5 rounded-full ring-4 ring-background"></div>
          <div className={`z-10 ${stage === 'Sent' ? 'bg-secondary' : 'bg-primary'} w-2.5 h-2.5 rounded-full ring-4 ring-background`}></div>
          <div className={`z-10 ${stage === 'Ready' || stage === 'Served' ? 'bg-primary' : stage === 'Prep' ? 'bg-amber-500' : 'bg-secondary'} ${stage === 'Ready' ? 'w-4 h-4 shadow-lg shadow-primary/20' : 'w-2.5 h-2.5'} rounded-full ring-4 ring-background`}></div>
          <div className={`z-10 ${stage === 'Served' ? 'bg-primary' : 'bg-secondary'} w-2.5 h-2.5 rounded-full ring-4 ring-background`}></div>
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-medium">
          <span className={stage === 'Sent' ? 'text-foreground font-bold' : ''}>Sent</span>
          <span className={stage === 'Prep' ? 'text-amber-600 font-bold' : ''}>Prep</span>
          <span className={stage === 'Ready' ? 'text-primary font-bold' : ''}>Ready</span>
          <span className={stage === 'Served' ? 'text-primary font-bold' : ''}>Served</span>
        </div>
      </div>
    );
  };

  const visible = useMemo(() => {
    const base = filter === 'Completed' ? orders.filter((o) => o.status === 'Paid') : orders.filter((o) => o.status !== 'Paid');
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => o.tableName.toLowerCase().includes(q) || o.number.toLowerCase().includes(q));
  }, [orders, query, filter]);

  const readyOrders = useMemo(() => visible.filter((o) => o.status === 'Ready'), [visible]);
  const cookingOrders = useMemo(() => visible.filter((o) => o.status === 'Cooking'), [visible]);
  const pendingOrders = useMemo(() => visible.filter((o) => o.status === 'Pending'), [visible]);
  const servedOrders = useMemo(() => visible.filter((o) => o.status === 'Served'), [visible]);
  const voidedOrders = useMemo(() => visible.filter((o) => o.status === 'Voided'), [visible]);
  const completedOrders = useMemo(() => visible.filter((o) => o.status === 'Paid'), [visible]);

  const readyToRender = useMemo(() => (filter === 'All' || filter === 'Ready' ? readyOrders : []), [filter, readyOrders]);
  const inProgressToRender = useMemo(
    () => (filter === 'All' || filter === 'Preparing' ? [...cookingOrders, ...pendingOrders] : []),
    [filter, cookingOrders, pendingOrders],
  );
  const servedToRender = useMemo(() => (filter === 'All' || filter === 'Served' ? servedOrders : []), [filter, servedOrders]);
  const voidedToRender = useMemo(() => (filter === 'All' || filter === 'Voided' ? voidedOrders : []), [filter, voidedOrders]);
  const completedToRender = useMemo(() => (filter === 'Completed' ? completedOrders : []), [filter, completedOrders]);

  const totalReady = readyOrders.length;
  const totalPreparing = cookingOrders.length + pendingOrders.length;
  const totalServed = servedOrders.length;
  const totalVoided = voidedOrders.length;
  const totalCompleted = completedOrders.length;

  const renderVoidedCard = (o: (typeof orders)[number]) => (
    <article key={o.id} className="flex flex-col bg-card rounded-xl border border-red-500/30 shadow-lg overflow-hidden h-full min-h-[440px] relative opacity-75">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-red-500/25 text-[140px] font-black -rotate-12 select-none">VOID</span>
      </div>

      <div className="p-4 bg-red-900/10 border-b border-red-900/30 flex justify-between items-start">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-foreground text-xl font-bold line-through decoration-2">{o.tableName}</h3>
            <span className="text-muted-foreground text-sm font-mono line-through">{o.number}</span>
          </div>
          <div className="text-xs text-red-400 font-bold uppercase mt-1">Voided</div>
          <div className="text-xs text-muted-foreground font-semibold mt-1">Placed by: <span className="text-foreground/80">{o.createdByName ?? (o.createdByStaffId ?? ' ”')}</span></div>
          {o.voidReason?.trim() ? <div className="mt-2 text-xs font-semibold text-red-300">Reason: {o.voidReason.trim()}</div> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-background px-2 py-1 rounded text-primary font-bold font-mono border border-border">
            <AppIcon name="schedule" className="text-sm" size={14} />
            {o.timeLabel}
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border bg-red-900/20 text-red-300 border-red-900/30 flex items-center gap-1">
            <AppIcon name="cancel" className="text-[14px]" size={14} />
            VOID
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <ul className="flex flex-col gap-4">
          {o.items.map((i) => (
            <li key={i.productId} className="group">
              <div className="flex gap-3 items-start">
                <span className="flex items-center justify-center w-8 h-8 bg-muted/40 text-foreground/60 font-bold rounded shrink-0 line-through">{i.qty}</span>
                <div className="flex flex-col">
                  <span className="text-foreground/60 font-bold text-lg leading-tight line-through">{i.name}</span>
                  {i.note?.trim() ? (
                    <span className="mt-1 inline-flex w-fit max-w-[280px] text-xs font-semibold text-foreground/70 bg-secondary border border-border px-2 py-1 rounded-lg leading-snug line-through">
                      {i.note.trim()}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-4 border-t border-border bg-background">
        <button className="w-full bg-secondary hover:bg-secondary/80 text-foreground font-bold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-border">
          <span>Print</span>
          <AppIcon name="print" />
        </button>
      </div>
    </article>
  );

  const renderActiveCard = (o: (typeof orders)[number]) => (
    <article key={o.id} className={`flex flex-col bg-card rounded-xl border shadow-lg overflow-hidden h-full min-h-[440px] relative transition-all ${
      o.status === 'Ready'
        ? 'border-primary/50 shadow-lg shadow-primary/10'
        : 'border-border'
    } hover:border-primary/40`}>
      <div className={`p-4 flex justify-between items-start border-b ${
        o.status === 'Ready' ? 'bg-primary/10 border-primary/20' : 'bg-secondary/50 border-border'
      }`}>
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-foreground text-xl font-bold">{o.tableName}</h3>
            <span className="text-muted-foreground text-sm font-mono">{o.number}</span>
          </div>
          <div className="text-xs text-muted-foreground font-semibold mt-1">Placed by: <span className="text-foreground">{o.createdByName ?? (o.createdByStaffId ?? ' ”')}</span></div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-background px-2 py-1 rounded text-primary font-bold font-mono border border-border">
            <AppIcon name="schedule" className="text-sm" size={14} />
            {o.timeLabel}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
            o.status === 'Ready' ? 'bg-primary/10 text-primary border-primary/20' :
            o.status === 'Cooking' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
            o.status === 'Pending' ? 'bg-secondary text-muted-foreground border-border' :
            'bg-muted/40 text-muted-foreground border-border'
          }`}>{o.status === 'Pending' ? 'Sent' : o.status}</span>
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto">
        <ul className="flex flex-col gap-4">
          {o.items.map((i) => (
            <li key={i.productId} className="group">
              <div className="flex gap-3 items-start">
                <span className={`flex items-center justify-center w-8 h-8 font-bold rounded shrink-0 border ${
                  o.status === 'Ready' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/40 text-foreground border-border'
                }`}>{i.qty}</span>
                <div className="flex flex-col">
                  <span className="text-foreground font-bold text-lg leading-tight group-hover:text-primary transition-colors">{i.name}</span>
                  {i.note?.trim() ? (
                    <span className="mt-1 inline-flex w-fit max-w-[280px] text-xs font-semibold text-foreground bg-secondary border border-primary/20 px-2 py-1 rounded-lg leading-snug">
                      {i.note.trim()}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Timeline stage={o.status === 'Served' ? 'Served' : o.status === 'Ready' ? 'Ready' : o.status === 'Cooking' ? 'Prep' : 'Sent'} />
      <div className="p-4 border-t border-border bg-background">
        {o.status === 'Pending' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Cooking');
          }} className="w-full bg-secondary hover:bg-secondary/80 active:scale-[0.98] transition-all text-foreground font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-border">
            <span>Start Prep</span>
            <AppIcon name="skillet" />
          </button>
        )}
        {o.status === 'Cooking' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Ready');
          }} className="w-full bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all text-primary-foreground font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg shadow-primary/10">
            <span>Mark Ready</span>
            <AppIcon name="check_circle" />
          </button>
        )}
        {o.status === 'Ready' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Served');
          }} className="w-full bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all text-primary-foreground font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg shadow-primary/10">
            <span>Served</span>
            <AppIcon name="check_circle" />
          </button>
        )}
        {o.status === 'Served' && (
          <button className="w-full bg-secondary text-foreground font-bold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-border">
            <span>Done</span>
            <AppIcon name="check_circle" />
          </button>
        )}
      </div>
    </article>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="h-auto border-b border-border bg-card z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-foreground tracking-tight text-2xl font-bold leading-tight">Kitchen Display</h2>
              {totalReady > 0 ? (
                <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs font-bold border border-primary/20 flex items-center gap-1">
                  <AppIcon name="notifications" className="text-[16px]" size={16} />
                  {totalReady}
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Live Updates
              </span>
              <span className="text-muted-foreground/60">  </span>
              <span>Shift #1024</span>
            </p>
            {actionErr ? <div className="mt-2 text-xs text-destructive font-semibold">{actionErr}</div> : null}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button
              onClick={() => void refresh()}
              className="h-10 px-4 rounded-lg bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 font-bold flex items-center gap-2"
            >
              <AppIcon name="sync" className="text-[18px]" size={18} />
              Refresh
            </button>
            

            <div className="hidden md:flex flex-col items-end justify-center pr-2">
              <span className="text-foreground font-bold text-lg leading-none">{formatDeviceTime(now, { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="relative flex h-2.5 w-2.5">
                  {isOnline ? <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span> : null}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
                </span>
                <span className="text-muted-foreground text-xs font-medium">Network: {isOnline ? 'Online' : 'Offline'}</span>
              </div>
            </div>

            <div className="relative group w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <AppIcon name="search" className="text-muted-foreground group-focus-within:text-primary transition-colors" />
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-border rounded-lg leading-5 bg-secondary text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                placeholder="Search Table # or Order ID"
                type="text"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              <button onClick={() => setFilter('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${filter === 'All' ? 'bg-primary text-foreground shadow-primary/20' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>All</button>
              <button onClick={() => setFilter('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Ready' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Ready ({totalReady})</button>
              <button onClick={() => setFilter('Preparing')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Preparing' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Preparing ({totalPreparing})</button>
              <button onClick={() => setFilter('Served')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Served' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Served ({totalServed})</button>
              <button onClick={() => setFilter('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Voided' ? 'bg-destructive text-destructive-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-destructive/30'}`}>Voided ({totalVoided})</button>
              <button onClick={() => setFilter('Completed')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Completed' ? 'bg-emerald-600 text-emerald-50 font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-emerald-500/30'}`}>Completed ({totalCompleted})</button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <AppIcon name="notifications" className="text-primary" />
            <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">Ready to Serve</h3>
            <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-bold">{readyToRender.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {readyToRender.length === 0 ? <div className="text-muted-foreground">No ready orders.</div> : readyToRender.map((o) => renderActiveCard(o))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <AppIcon name="restaurant" className="text-muted-foreground" />
            <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">In Progress</h3>
            <span className="bg-muted/40 text-muted-foreground px-2 py-0.5 rounded text-xs font-bold">{inProgressToRender.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {inProgressToRender.length === 0 ? <div className="text-muted-foreground">No in-progress orders.</div> : inProgressToRender.map((o) => renderActiveCard(o))}
          </div>
        </div>

        {servedToRender.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <AppIcon name="check_circle" className="text-muted-foreground" />
              <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">Served</h3>
              <span className="bg-muted/40 text-muted-foreground px-2 py-0.5 rounded text-xs font-bold">{servedToRender.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {servedToRender.map((o) => renderActiveCard(o))}
            </div>
          </div>
        )}

        {completedToRender.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <AppIcon name="paid" className="text-emerald-600" />
              <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">Completed</h3>
              <span className="bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded text-xs font-bold">{completedToRender.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {completedToRender.map((o) => renderActiveCard(o))}
            </div>
          </div>
        )}

        {voidedToRender.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <AppIcon name="cancel" className="text-destructive" />
              <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">Voided</h3>
              <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded text-xs font-bold">{voidedToRender.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {voidedToRender.map((o) => renderVoidedCard(o))}
            </div>
          </div>
        )}
      </main>

      <footer className="flex-none px-6 py-4 text-xs text-muted-foreground bg-background border-t border-border flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div>Last updated: {formatDeviceTime(now, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="hidden sm:block text-muted-foreground/60">  </div>
          <div>Terminal: <span className="text-foreground">KDS-01</span></div>
          <div className="hidden sm:block text-muted-foreground/60">  </div>
          <div>Version: <span className="text-foreground">v4.2.0</span></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary"></span>{totalReady} Ready</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span>{totalPreparing} Preparing</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-muted-foreground/60"></span>{totalServed} Served</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400"></span>{totalVoided} Voided</div>
          <div className="hidden md:flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span>Sync: <span className="text-foreground font-bold">{isOnline ? 'Synced (12ms)' : 'Paused'}</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
};
