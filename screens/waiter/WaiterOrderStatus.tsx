
import React, { useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';

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
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-[#3d3226] rounded-full z-0"></div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-[#cf7317] rounded-full z-0" style={{ width }}></div>
          <div className="z-10 bg-[#cf7317] w-2.5 h-2.5 rounded-full ring-4 ring-[#2c241b]"></div>
          <div className={`z-10 ${stage === 'Sent' ? 'bg-[#3d3226]' : 'bg-[#cf7317]'} w-2.5 h-2.5 rounded-full ring-4 ring-[#2c241b]`}></div>
          <div className={`z-10 ${stage === 'Ready' || stage === 'Served' ? 'bg-[#cf7317]' : stage === 'Prep' ? 'bg-amber-600' : 'bg-[#3d3226]'} ${stage === 'Ready' ? 'w-4 h-4 shadow-lg shadow-[#cf7317]/50' : 'w-2.5 h-2.5'} rounded-full ring-4 ring-[#2c241b]`}></div>
          <div className={`z-10 ${stage === 'Served' ? 'bg-[#cf7317]' : 'bg-[#3d3226]'} w-2.5 h-2.5 rounded-full ring-4 ring-[#2c241b]`}></div>
        </div>
        <div className="flex justify-between text-[10px] text-[#c8ad93] uppercase font-medium">
          <span className={stage === 'Sent' ? 'text-gray-300 font-bold' : ''}>Sent</span>
          <span className={stage === 'Prep' ? 'text-amber-500 font-bold' : ''}>Prep</span>
          <span className={stage === 'Ready' ? 'text-[#cf7317] font-bold' : ''}>Ready</span>
          <span className={stage === 'Served' ? 'text-[#cf7317] font-bold' : ''}>Served</span>
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
    <div className="flex flex-col h-full overflow-hidden bg-[#211911] text-white">
      <header className="h-auto border-b border-[#3d3226] bg-[#2c241b] z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-white tracking-tight text-2xl font-bold leading-tight">Kitchen Display</h2>
            <p className="text-[#c8ad93] text-sm mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Live Updates
              </span>
              <span className="text-[#c8ad93]/60">  </span>
              <span>Shift #1024</span>
            </p>
            {actionErr ? <div className="mt-2 text-xs text-red-300 font-semibold">{actionErr}</div> : null}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="flex gap-2">
              <button
                onClick={() => void refresh()}
                className="h-10 px-4 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 font-bold flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">sync</span>
                Refresh
              </button>
              <button onClick={() => onNavigate(Screen.WAITER_KDS)} className="h-10 px-4 rounded-lg bg-[#cf7317] hover:bg-[#e08428] text-white font-extrabold transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">skillet</span>
                Full KDS
              </button>
              <button onClick={() => onNavigate(Screen.WAITER_NOTIFICATIONS)} className="h-10 px-4 rounded-lg bg-[#3d3226] hover:bg-[#4d4030] border border-[#3d3226] text-white font-semibold transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">notifications</span>
                Alerts
              </button>
            </div>
            <div className="relative group w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-[#c8ad93] group-focus-within:text-[#cf7317] transition-colors">search</span>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-[#3d3226] rounded-lg leading-5 bg-[#3d3226] text-white placeholder-[#c8ad93] focus:outline-none focus:ring-1 focus:ring-[#cf7317] focus:border-[#cf7317] sm:text-sm transition-all"
                placeholder="Search Table # or Order ID"
                type="text"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              <button onClick={() => setChip('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${chip === 'All' ? 'bg-[#cf7317] text-white shadow-[#cf7317]/20' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>All</button>
              <button onClick={() => setChip('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Ready' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Ready ({totalReady})</button>
              <button onClick={() => setChip('Preparing')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Preparing' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Preparing ({totalPreparing})</button>
              <button onClick={() => setChip('Served')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Served' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Served ({totalServed})</button>
              <button onClick={() => setChip('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${chip === 'Voided' ? 'bg-red-600 text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-red-500/30'}`}>Voided ({totalVoided})</button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-[#cf7317]">notifications</span>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Ready to Serve</h3>
            <span className="bg-[#cf7317]/20 text-[#cf7317] px-2 py-0.5 rounded text-xs font-bold">{readyToRender.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {readyToRender.map((o) => (
              <div key={o.id} className="bg-[#2c241b] rounded-xl border border-[#cf7317]/40 shadow-[0_0_15px_rgba(207,115,23,0.15)] flex flex-col overflow-hidden group hover:border-[#cf7317]/60 transition-all">
                <div className="p-4 bg-[#cf7317]/10 border-b border-[#cf7317]/20 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-[#2c241b] flex items-center justify-center border border-[#cf7317]/30">
                      <span className="text-xl font-bold text-white">{o.tableName.replace(/^T-?/i, '')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-[#cf7317] font-bold uppercase tracking-wider">{o.tableName}</span>
                      <span className="text-xs text-[#c8ad93]">{o.number}    {o.timeLabel}</span>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#cf7317] text-white text-xs font-bold shadow-sm uppercase tracking-wide animate-pulse">Ready</span>
                </div>
                <div className="p-4 flex-1">
                  <ul className="space-y-2">
                    {o.items
                      .map((i) => {
                        const eff = Math.max(0, i.qty - (i.voidedQty ?? 0));
                        if (eff <= 0) return null;
                        return (
                          <li key={i.productId} className="flex justify-between items-center text-sm text-white font-medium">
                            <span className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#cf7317] mt-2"></span>
                              <span className="flex flex-col">
                                <span>{eff}x {i.name}</span>
                                {i.note?.trim() ? (
                                  <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-[#f3e2c8] bg-[#3d3226] border border-[#483c23] px-2 py-1 rounded-lg leading-snug">
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
                <div className="p-4 pt-2 mt-2 border-t border-[#483c23] flex gap-2">
                  <button
                    onClick={() => {
                      setActionErr('');
                      setOrderStatus(o.id, 'Served');
                    }}
                    className="flex-1 bg-[#cf7317] hover:bg-[#e08428] text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-lg">check_circle</span> Mark Served
                  </button>
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_RECEIPT);
                    }}
                    className="bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white p-2 rounded-lg transition-colors"
                    title="Print Receipt"
                  >
                    <span className="material-symbols-outlined">print</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-[#c8ad93]">restaurant</span>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">In Progress</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {inProgressToRender.map((o) => (
              <div key={o.id} className="bg-[#2c241b] rounded-xl border border-[#3d3226] flex flex-col overflow-hidden group hover:border-[#cf7317]/30 transition-all">
                <div className="p-4 bg-[#3d3226]/50 border-b border-[#3d3226] flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-[#3a2e22] flex items-center justify-center text-[#c9b792]">
                      <span className="text-xl font-bold">{o.tableName.replace(/^T-?/i, '')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-[#c8ad93] font-bold uppercase tracking-wider group-hover:text-[#cf7317] transition-colors">{o.tableName}</span>
                      <span className="text-xs text-[#c9b792]/70">{o.number}    {o.timeLabel}</span>
                    </div>
                  </div>
                  {o.status === 'Cooking' ? (
                    <span className="px-3 py-1 rounded-full bg-amber-900/40 text-amber-500 border border-amber-900/50 text-xs font-bold uppercase tracking-wide">Preparing</span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-[#3d3226] text-[#c8ad93] border border-[#4d4030] text-xs font-bold uppercase tracking-wide">Sent</span>
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
                              <span className="text-[#c8ad93] group-hover:text-white transition-colors font-medium">{eff}x {i.name}</span>
                              {i.note?.trim() ? (
                                <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-[#f3e2c8] bg-[#3d3226] border border-[#483c23] px-2 py-1 rounded-lg leading-snug">
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
              <span className="material-symbols-outlined text-[#c8ad93]">check_circle</span>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">Served</h3>
              <span className="bg-white/10 text-[#c8ad93] px-2 py-0.5 rounded text-xs font-bold">{servedToRender.length}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {servedToRender.map((o) => (
                <div key={o.id} className="bg-[#2c241b] rounded-xl border border-[#3d3226] flex flex-col overflow-hidden opacity-70">
                  <div className="p-4 bg-[#3d3226]/30 border-b border-[#3d3226] flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-[#3a2e22] flex items-center justify-center text-[#c9b792]">
                        <span className="text-xl font-bold">{o.tableName.replace(/^T-?/i, '')}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-[#c8ad93] font-bold uppercase tracking-wider">{o.tableName}</span>
                        <span className="text-xs text-[#c9b792]/70">{o.number}    {o.timeLabel}</span>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-white/10 text-[#c8ad93] border border-white/10 text-xs font-bold uppercase tracking-wide">Served</span>
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
                                <span className="text-[#c8ad93] font-medium">{eff}x {i.name}</span>
                                {i.note?.trim() ? (
                                  <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-[#f3e2c8] bg-[#3d3226] border border-[#483c23] px-2 py-1 rounded-lg leading-snug">
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

                  <div className="p-4 pt-2 mt-2 border-t border-[#483c23] flex gap-2">
                    <button
                      onClick={() => {
                        selectOrder(o.id);
                        onNavigate(Screen.WAITER_RECEIPT);
                      }}
                      className="flex-1 bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-lg">print</span>
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
              <span className="material-symbols-outlined text-red-400">cancel</span>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">Voided</h3>
              <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-bold">{voidedToRender.length}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {voidedToRender.map((o) => (
                <div key={o.id} className="bg-[#2c241b] rounded-xl border border-red-500/30 shadow-lg overflow-hidden h-full min-h-[320px] relative opacity-70">
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-red-500/20 text-9xl font-bold -rotate-12 select-none">VOID</span>
                  </div>

                  <div className="p-4 bg-[#3a2e1e] flex justify-between items-start border-b border-[#3d3226]">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-white text-xl font-bold line-through decoration-2">{o.tableName}</h3>
                        <span className="text-[#c8ad93] text-sm font-mono">{o.number}</span>
                      </div>
                      <span className="text-xs text-red-400 font-bold uppercase">Voided</span>
                      {o.voidReason?.trim() ? (
                        <div className="mt-2 text-xs font-semibold text-red-300">Reason: {o.voidReason.trim()}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded text-red-300 font-bold font-mono border border-red-900/30">
                      <span className="material-symbols-outlined text-sm">cancel</span>
                      VOID
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto">
                    <ul className="flex flex-col gap-4">
                      {o.items.map((i) => (
                        <li key={i.productId} className="group">
                          <div className="flex gap-3 items-start">
                            <span className="flex items-center justify-center w-8 h-8 bg-[#483c23] text-white/60 font-bold rounded shrink-0 line-through">{i.qty}</span>
                            <div className="flex flex-col">
                              <span className="text-white/60 font-bold text-lg leading-tight line-through">{i.name}</span>
                              {i.note?.trim() ? (
                                <span className="mt-1 inline-flex w-fit max-w-[260px] text-xs font-semibold text-white/70 bg-[#3d3226] border border-[#483c23] px-2 py-1 rounded-lg leading-snug line-through">
                                  {i.note.trim()}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 border-t border-[#3d3226] bg-[#221c11]">
                    <button
                      onClick={() => {
                        selectOrder(o.id);
                        onNavigate(Screen.WAITER_RECEIPT);
                      }}
                      className="w-full bg-[#3d3226] hover:bg-[#4d4030] text-white font-bold text-sm py-3 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-[#483c23]"
                    >
                      <span>Print</span>
                      <span className="material-symbols-outlined">print</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="flex-none px-6 py-4 text-xs text-[#c8ad93] bg-[#211911] border-t border-[#3d3226] flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div>Last updated: {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}</div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#cf7317]"></span>{totalReady} Ready</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span>{totalPreparing} Preparing</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#5b6470]"></span>{totalSent} Sent</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#c8ad93]"></span>{totalServed} Served</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400"></span>{totalVoided} Voided</div>
        </div>
      </footer>
    </div>
  );
};
