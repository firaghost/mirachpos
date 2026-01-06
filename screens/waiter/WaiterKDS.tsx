
import React, { useEffect, useMemo, useState } from 'react';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterKDS: React.FC<Props> = ({ onNavigate }) => {
  const { orders, setOrderStatus, refreshFromServer } = usePos();
  const [filter, setFilter] = useState<'All' | 'Ready' | 'Preparing' | 'Served' | 'Voided'>('All');
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

  const visible = useMemo(() => {
    const base = orders.filter((o) => o.status !== 'Paid');
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => o.tableName.toLowerCase().includes(q) || o.number.toLowerCase().includes(q));
  }, [orders, query]);

  const readyOrders = useMemo(() => visible.filter((o) => o.status === 'Ready'), [visible]);
  const cookingOrders = useMemo(() => visible.filter((o) => o.status === 'Cooking'), [visible]);
  const pendingOrders = useMemo(() => visible.filter((o) => o.status === 'Pending'), [visible]);
  const servedOrders = useMemo(() => visible.filter((o) => o.status === 'Served'), [visible]);
  const voidedOrders = useMemo(() => visible.filter((o) => o.status === 'Voided'), [visible]);

  const readyToRender = useMemo(() => (filter === 'All' || filter === 'Ready' ? readyOrders : []), [filter, readyOrders]);
  const inProgressToRender = useMemo(
    () => (filter === 'All' || filter === 'Preparing' ? [...cookingOrders, ...pendingOrders] : []),
    [filter, cookingOrders, pendingOrders],
  );
  const servedToRender = useMemo(() => (filter === 'All' || filter === 'Served' ? servedOrders : []), [filter, servedOrders]);
  const voidedToRender = useMemo(() => (filter === 'All' || filter === 'Voided' ? voidedOrders : []), [filter, voidedOrders]);

  const totalReady = readyOrders.length;
  const totalPreparing = cookingOrders.length + pendingOrders.length;
  const totalServed = servedOrders.length;
  const totalVoided = voidedOrders.length;

  const renderVoidedCard = (o: (typeof orders)[number]) => (
    <article key={o.id} className="flex flex-col bg-[#2c241b] rounded-xl border border-red-500/30 shadow-lg overflow-hidden h-full min-h-[440px] relative opacity-75">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-red-500/25 text-[140px] font-black -rotate-12 select-none">VOID</span>
      </div>

      <div className="p-4 bg-red-900/10 border-b border-red-900/30 flex justify-between items-start">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-white text-xl font-bold line-through decoration-2">{o.tableName}</h3>
            <span className="text-[#c8ad93] text-sm font-mono line-through">{o.number}</span>
          </div>
          <div className="text-xs text-red-400 font-bold uppercase mt-1">Voided</div>
          <div className="text-xs text-[#c8ad93] font-semibold mt-1">Placed by: <span className="text-white/80">{o.createdByName ?? (o.createdByStaffId ?? ' ”')}</span></div>
          {o.voidReason?.trim() ? <div className="mt-2 text-xs font-semibold text-red-300">Reason: {o.voidReason.trim()}</div> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-[#221c11] px-2 py-1 rounded text-[#cf7317] font-bold font-mono border border-[#483c23]">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {o.timeLabel}
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border bg-red-900/20 text-red-300 border-red-900/30 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">cancel</span>
            VOID
          </span>
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
                    <span className="mt-1 inline-flex w-fit max-w-[280px] text-xs font-semibold text-white/70 bg-[#3d3226] border border-[#483c23] px-2 py-1 rounded-lg leading-snug line-through">
                      {i.note.trim()}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-4 border-t border-[#483c23] bg-[#221c11]">
        <button className="w-full bg-[#3d3226] hover:bg-[#4d4030] text-white font-bold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-[#483c23]">
          <span>Print</span>
          <span className="material-symbols-outlined">print</span>
        </button>
      </div>
    </article>
  );

  const renderActiveCard = (o: (typeof orders)[number]) => (
    <article key={o.id} className={`flex flex-col bg-[#2c241b] rounded-xl border shadow-lg overflow-hidden h-full min-h-[440px] relative transition-all ${
      o.status === 'Ready'
        ? 'border-[#cf7317]/50 shadow-[0_0_18px_rgba(207,115,23,0.18)]'
        : 'border-[#3d3226]'
    } hover:border-[#cf7317]/40`}>
      <div className={`p-4 flex justify-between items-start border-b ${
        o.status === 'Ready' ? 'bg-[#cf7317]/10 border-[#cf7317]/20' : 'bg-[#3d3226]/50 border-[#3d3226]'
      }`}>
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-white text-xl font-bold">{o.tableName}</h3>
            <span className="text-[#c8ad93] text-sm font-mono">{o.number}</span>
          </div>
          <div className="text-xs text-[#c8ad93] font-semibold mt-1">Placed by: <span className="text-white">{o.createdByName ?? (o.createdByStaffId ?? ' ”')}</span></div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-[#221c11] px-2 py-1 rounded text-[#cf7317] font-bold font-mono border border-[#483c23]">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {o.timeLabel}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
            o.status === 'Ready' ? 'bg-[#cf7317] text-white border-[#cf7317]/30' :
            o.status === 'Cooking' ? 'bg-amber-900/40 text-amber-500 border-amber-900/50' :
            o.status === 'Pending' ? 'bg-[#3d3226] text-[#c8ad93] border-[#4d4030]' :
            'bg-white/10 text-[#c8ad93] border-white/10'
          }`}>{o.status === 'Pending' ? 'Sent' : o.status}</span>
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto">
        <ul className="flex flex-col gap-4">
          {o.items.map((i) => (
            <li key={i.productId} className="group">
              <div className="flex gap-3 items-start">
                <span className={`flex items-center justify-center w-8 h-8 font-bold rounded shrink-0 border ${
                  o.status === 'Ready' ? 'bg-[#cf7317] text-white border-[#cf7317]/30' : 'bg-[#483c23] text-white border-[#483c23]'
                }`}>{i.qty}</span>
                <div className="flex flex-col">
                  <span className="text-white font-bold text-lg leading-tight group-hover:text-[#cf7317] transition-colors">{i.name}</span>
                  {i.note?.trim() ? (
                    <span className="mt-1 inline-flex w-fit max-w-[280px] text-xs font-semibold text-white bg-[#3d3226] border border-[#cf7317]/30 px-2 py-1 rounded-lg leading-snug">
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
      <div className="p-4 border-t border-[#483c23] bg-[#221c11]">
        {o.status === 'Pending' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Cooking');
          }} className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all text-white font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg shadow-blue-600/10">
            <span>Start Prep</span>
            <span className="material-symbols-outlined">skillet</span>
          </button>
        )}
        {o.status === 'Cooking' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Ready');
          }} className="w-full bg-[#cf7317] hover:bg-[#e08428] active:scale-[0.98] transition-all text-white font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg shadow-[#cf7317]/10">
            <span>Mark Ready</span>
            <span className="material-symbols-outlined">check_circle</span>
          </button>
        )}
        {o.status === 'Ready' && (
          <button onClick={() => {
            setActionErr('');
            setOrderStatus(o.id, 'Served');
          }} className="w-full bg-[#cf7317] hover:bg-[#e08428] active:scale-[0.98] transition-all text-white font-extrabold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg shadow-[#cf7317]/10">
            <span>Served</span>
            <span className="material-symbols-outlined">check_circle</span>
          </button>
        )}
        {o.status === 'Served' && (
          <button className="w-full bg-[#3d3226] text-white font-bold text-lg py-4 rounded-lg flex items-center justify-center gap-2 uppercase tracking-wide border border-[#483c23]">
            <span>Done</span>
            <span className="material-symbols-outlined">check_circle</span>
          </button>
        )}
      </div>
    </article>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#211911] text-white">
      <header className="h-auto border-b border-[#3d3226] bg-[#2c241b] z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-white tracking-tight text-2xl font-bold leading-tight">Kitchen Display</h2>
              {totalReady > 0 ? (
                <span className="px-2 py-0.5 rounded bg-[#cf7317]/20 text-[#cf7317] text-xs font-bold border border-[#cf7317]/30 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">notifications</span>
                  {totalReady}
                </span>
              ) : null}
            </div>
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
            <button
              onClick={() => void refresh()}
              className="h-10 px-4 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 font-bold flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              Refresh
            </button>
            

            <div className="hidden md:flex flex-col items-end justify-center pr-2">
              <span className="text-white font-bold text-lg leading-none">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="relative flex h-2.5 w-2.5">
                  {isOnline ? <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span> : null}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
                </span>
                <span className="text-[#c8ad93] text-xs font-medium">Network: {isOnline ? 'Online' : 'Offline'}</span>
              </div>
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
              <button onClick={() => setFilter('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${filter === 'All' ? 'bg-[#cf7317] text-white shadow-[#cf7317]/20' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>All</button>
              <button onClick={() => setFilter('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Ready' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Ready ({totalReady})</button>
              <button onClick={() => setFilter('Preparing')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Preparing' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Preparing ({totalPreparing})</button>
              <button onClick={() => setFilter('Served')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Served' ? 'bg-[#cf7317] text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-[#cf7317]/30'}`}>Served ({totalServed})</button>
              <button onClick={() => setFilter('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Voided' ? 'bg-red-600 text-white font-semibold' : 'bg-[#3d3226] hover:bg-[#4d4030] text-[#c8ad93] hover:text-white border border-transparent hover:border-red-500/30'}`}>Voided ({totalVoided})</button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {readyToRender.length === 0 ? <div className="text-[#c8ad93]">No ready orders.</div> : readyToRender.map((o) => renderActiveCard(o))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-[#c8ad93]">restaurant</span>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">In Progress</h3>
            <span className="bg-white/10 text-[#c8ad93] px-2 py-0.5 rounded text-xs font-bold">{inProgressToRender.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {inProgressToRender.length === 0 ? <div className="text-[#c8ad93]">No in-progress orders.</div> : inProgressToRender.map((o) => renderActiveCard(o))}
          </div>
        </div>

        {servedToRender.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-[#c8ad93]">check_circle</span>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">Served</h3>
              <span className="bg-white/10 text-[#c8ad93] px-2 py-0.5 rounded text-xs font-bold">{servedToRender.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {servedToRender.map((o) => renderActiveCard(o))}
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {voidedToRender.map((o) => renderVoidedCard(o))}
            </div>
          </div>
        )}
      </main>

      <footer className="flex-none px-6 py-4 text-xs text-[#c8ad93] bg-[#211911] border-t border-[#3d3226] flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div>Last updated: {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}</div>
          <div className="hidden sm:block text-[#c8ad93]/60">  </div>
          <div>Terminal: <span className="text-white">KDS-01</span></div>
          <div className="hidden sm:block text-[#c8ad93]/60">  </div>
          <div>Version: <span className="text-white">v4.2.0</span></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#cf7317]"></span>{totalReady} Ready</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500"></span>{totalPreparing} Preparing</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#c8ad93]"></span>{totalServed} Served</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400"></span>{totalVoided} Voided</div>
          <div className="hidden md:flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span>Sync: <span className="text-white font-bold">{isOnline ? 'Synced (12ms)' : 'Paused'}</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
};
