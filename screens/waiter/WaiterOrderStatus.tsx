import React, { useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { formatDeviceTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterOrderStatus: React.FC<Props> = ({ onNavigate }) => {
  const { orders, setOrderStatus, selectOrder, refreshFromServer } = usePos();

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'All' | 'Ready' | 'Preparing' | 'Served' | 'Voided'>('All');
  const [actionErr, setActionErr] = useState('');

  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const base = orders.filter((o) => o.status !== 'Paid');
    return base.filter((o) => {
      if (q.length === 0) return true;
      return o.tableName.toLowerCase().includes(q) || o.number.toLowerCase().includes(q);
    });
  }, [orders, q]);

  const readyOrders = useMemo(() => visible.filter((o) => o.status === 'Ready'), [visible]);
  const cookingOrders = useMemo(() => visible.filter((o) => o.status === 'Cooking'), [visible]);
  const pendingOrders = useMemo(() => visible.filter((o) => o.status === 'Pending'), [visible]);
  const servedOrders = useMemo(() => visible.filter((o) => o.status === 'Served'), [visible]);
  const voidedOrders = useMemo(() => visible.filter((o) => o.status === 'Voided'), [visible]);

  const readyToRender = useMemo(() => {
    if (chip === 'All' || chip === 'Ready') return readyOrders;
    return [];
  }, [chip, readyOrders]);

  const inProgressToRender = useMemo(() => {
    if (chip === 'All' || chip === 'Preparing') return [...cookingOrders, ...pendingOrders];
    return [];
  }, [chip, cookingOrders, pendingOrders]);

  const servedToRender = useMemo(() => {
    if (chip === 'All' || chip === 'Served') return servedOrders;
    return [];
  }, [chip, servedOrders]);

  const voidedToRender = useMemo(() => {
    if (chip === 'All' || chip === 'Voided') return voidedOrders;
    return [];
  }, [chip, voidedOrders]);

  const totalReady = readyOrders.length;
  const totalPreparing = cookingOrders.length;
  const totalSent = pendingOrders.length;
  const totalServed = servedOrders.length;
  const totalVoided = voidedOrders.length;

  const Timeline: React.FC<{ stage: 'Sent' | 'Prep' | 'Ready' | 'Served' }> = ({ stage }) => {
    const width = stage === 'Served' ? '100%' : stage === 'Ready' ? '75%' : stage === 'Prep' ? '50%' : '25%';
    return (
      <div className="px-4 pb-2">
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

  const refresh = async () => {
    setActionErr('');
    try {
      await refreshFromServer();
    } catch {
      setActionErr('Failed to refresh from server.');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="h-auto border-b border-border bg-card z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-foreground tracking-tight text-2xl font-bold leading-tight">Kitchen Display</h2>
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
            <div className="flex gap-2">
              <button
                onClick={() => void refresh()}
                className="h-10 px-4 rounded-lg bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 font-bold flex items-center gap-2"
              >
                <AppIcon name="sync" className="text-[18px]" size={18} />
                Refresh
              </button>
              <button onClick={() => onNavigate(Screen.WAITER_KDS)} className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors flex items-center gap-2">
                <AppIcon name="skillet" className="text-[18px]" size={18} />
                Full KDS
              </button>
              <button onClick={() => onNavigate(Screen.WAITER_NOTIFICATIONS)} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors flex items-center gap-2">
                <AppIcon name="notifications" className="text-[18px]" size={18} />
                Alerts
              </button>
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
              <button onClick={() => setChip('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${chip === 'All' ? 'bg-primary text-foreground shadow-primary/20' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>All</button>
              <button onClick={() => setChip('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Ready' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Ready ({totalReady})</button>
              <button onClick={() => setChip('Preparing')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Preparing' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Preparing ({totalPreparing})</button>
              <button onClick={() => setChip('Served')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Served' ? 'bg-primary text-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Served ({totalServed})</button>
              <button onClick={() => setChip('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Voided' ? 'bg-destructive text-destructive-foreground font-semibold' : 'bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-transparent hover:border-destructive/30'}`}>Voided ({totalVoided})</button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {readyToRender.map((o) => (
              <div key={o.id} className="bg-card rounded-xl border border-primary/30 shadow-lg shadow-primary/10 flex flex-col overflow-hidden group hover:border-primary/50 transition-all">
                <div className="p-4 bg-primary/10 border-b border-primary/20 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-card flex items-center justify-center border border-primary/20">
                      <span className="text-xl font-bold text-foreground">{o.tableName.replace(/^T-?/i, '')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-primary font-bold uppercase tracking-wider">{o.tableName}</span>
                      <span className="text-xs text-muted-foreground">{o.number}    {o.timeLabel}</span>
                      {(o as any)?.orderType === 'takeaway' ? <span className="text-[10px] text-muted-foreground font-bold">TAKEAWAY</span> : null}
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm uppercase tracking-wide animate-pulse">Ready</span>
                </div>
                <div className="p-4 flex-1">
                  <ul className="space-y-2">
                    {o.items
                      .map((i) => {
                        const eff = Math.max(0, i.qty - (i.voidedQty ?? 0));
                        if (eff <= 0) return null;
                        return (
                          <li key={i.productId} className="flex justify-between items-center text-sm text-foreground font-medium">
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2"></span>
                              <span className="flex flex-col">
                                <span>{eff}x {i.name}</span>
                                {i.note?.trim() ? (
                                  <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-foreground bg-secondary border border-border px-2 py-1 rounded-lg leading-snug">
                                    {i.note.trim()}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          </li>
                        );
                      })
                      .filter(Boolean)}
                  </ul>
                </div>
                <Timeline stage="Ready" />
                <div className="p-4 pt-2 mt-2 border-t border-border flex gap-2">
                  <button
                    onClick={() => {
                      setActionErr('');
                      setOrderStatus(o.id, 'Served');
                    }}
                    className="flex-1 bg-primary hover:bg-primary/80 text-foreground font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AppIcon name="check_circle" className="text-lg" size={18} /> Mark Served
                  </button>
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_RECEIPT);
                    }}
                    className="bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground p-2 rounded-lg transition-colors"
                    title="Print Receipt"
                  >
                    <AppIcon name="print" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <AppIcon name="restaurant" className="text-muted-foreground" />
            <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">In Progress</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {inProgressToRender.map((o) => (
              <div key={o.id} className="bg-card rounded-xl border border-border flex flex-col overflow-hidden group hover:border-primary/30 transition-all">
                <div className="p-4 bg-secondary/50 border-b border-border flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                      <span className="text-xl font-bold">{o.tableName.replace(/^T-?/i, '')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider group-hover:text-primary transition-colors">{o.tableName}</span>
                      <span className="text-xs text-muted-foreground/70">{o.number}    {o.timeLabel}</span>
                      {(o as any)?.orderType === 'takeaway' ? <span className="text-[10px] text-muted-foreground font-bold">TAKEAWAY</span> : null}
                    </div>
                  </div>
                  {o.status === 'Cooking' ? (
                    <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-bold uppercase tracking-wide">Preparing</span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-secondary text-muted-foreground border border-border text-xs font-bold uppercase tracking-wide">Sent</span>
                  )}
                </div>

                <div className="p-4 flex-1">
                  <ul className="space-y-2">
                    {o.items
                      .map((i) => {
                        const eff = Math.max(0, i.qty - (i.voidedQty ?? 0));
                        if (eff <= 0) return null;
                        return (
                          <li key={i.productId} className="flex justify-between items-center text-sm">
                            <span className="flex flex-col">
                              <span className="text-muted-foreground group-hover:text-foreground transition-colors font-medium">{eff}x {i.name}</span>
                              {i.note?.trim() ? (
                                <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-foreground bg-secondary border border-border px-2 py-1 rounded-lg leading-snug">
                                  {i.note.trim()}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })
                      .filter(Boolean)}
                  </ul>
                </div>

                <Timeline stage={o.status === 'Cooking' ? 'Prep' : 'Sent'} />
              </div>
            ))}
          </div>
        </div>

        {servedToRender.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <AppIcon name="check_circle" className="text-muted-foreground" />
              <h3 className="text-lg font-bold text-foreground uppercase tracking-wider">Served</h3>
              <span className="bg-muted/40 text-muted-foreground px-2 py-0.5 rounded text-xs font-bold">{servedToRender.length}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {servedToRender.map((o) => (
                <div key={o.id} className="bg-card rounded-xl border border-border flex flex-col overflow-hidden opacity-70">
                  <div className="p-4 bg-secondary/30 border-b border-border flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                        <span className="text-xl font-bold">{o.tableName.replace(/^T-?/i, '')}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{o.tableName}</span>
                        <span className="text-xs text-muted-foreground/70">{o.number}    {o.timeLabel}</span>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-muted/40 text-muted-foreground border border-border text-xs font-bold uppercase tracking-wide">Served</span>
                  </div>

                  <div className="p-4 flex-1">
                    <ul className="space-y-2">
                      {o.items
                        .map((i) => {
                          const eff = Math.max(0, i.qty - (i.voidedQty ?? 0));
                          if (eff <= 0) return null;
                          return (
                            <li key={i.productId} className="flex justify-between items-center text-sm">
                              <span className="flex flex-col">
                                <span className="text-muted-foreground font-medium">{eff}x {i.name}</span>
                                {i.note?.trim() ? (
                                  <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-foreground bg-secondary border border-border px-2 py-1 rounded-lg leading-snug">
                                    {i.note.trim()}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })
                        .filter(Boolean)}
                    </ul>
                  </div>

                  <Timeline stage="Served" />

                  <div className="p-4 pt-2 mt-2 border-t border-border flex gap-2">
                    <button
                      onClick={() => {
                        selectOrder(o.id);
                        onNavigate(Screen.WAITER_RECEIPT);
                      }}
                      className="flex-1 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <AppIcon name="print" className="text-lg" size={18} />
                      Print
                    </button>
                  </div>
                </div>
              ))}
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

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {voidedToRender.map((o) => (
                <div key={o.id} className="bg-card rounded-xl border border-red-500/30 shadow-lg overflow-hidden h-full min-h-[320px] relative opacity-70">
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-red-500/20 text-9xl font-bold -rotate-12 select-none">VOID</span>
                  </div>

                  <div className="p-4 bg-destructive/10 flex justify-between items-start border-b border-border">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-foreground text-xl font-bold line-through decoration-2">{o.tableName}</h3>
                        <span className="text-muted-foreground text-sm font-mono">{o.number}</span>
                      </div>
                      <span className="text-xs text-destructive font-bold uppercase">Voided</span>
                      {o.voidReason?.trim() ? (
                        <div className="mt-2 text-xs font-semibold text-destructive/80">Reason: {o.voidReason.trim()}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 bg-destructive/10 px-2 py-1 rounded text-destructive font-bold font-mono border border-destructive/20">
                      <AppIcon name="cancel" className="text-sm" size={14} />
                      VOID
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
                                <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-foreground/70 bg-secondary border border-border px-2 py-1 rounded-lg leading-snug line-through">
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
                    <button
                      onClick={() => {
                        selectOrder(o.id);
                        onNavigate(Screen.WAITER_RECEIPT);
                      }}
                      className="w-full bg-secondary hover:bg-secondary/80 text-foreground font-bold text-sm py-3 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-border"
                    >
                      <span>Print</span>
                      <AppIcon name="print" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="flex-none px-6 py-4 text-xs text-muted-foreground bg-background border-t border-border flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div>Last updated: {formatDeviceTime(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary"></span>{totalReady} Ready</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span>{totalPreparing} Preparing</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-muted-foreground/60"></span>{totalSent} Sent</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-muted-foreground/60"></span>{totalServed} Served</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-destructive"></span>{totalVoided} Voided</div>
        </div>
      </footer>
    </div>
  );
};
