import React, { useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { Modal } from '../../components/Modal';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterActiveOrders: React.FC<Props> = ({ onNavigate }) => {
  const { orders, selectOrder, voidOrder, refreshFromServer } = usePos();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Voided'>('All');

  const [actionErr, setActionErr] = useState('');

  const [voidOrderId, setVoidOrderId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const selectedForVoid = useMemo(() => orders.find((o) => o.id === voidOrderId) ?? null, [orders, voidOrderId]);

  const filtered = useMemo(() => {
    const base = orders.filter((o) => o.status !== 'Paid');
    const q = query.trim().toLowerCase();

    return base.filter((o) => {
      const matchesStatus = filter === 'All' ? true : o.status === filter;
      const matchesQuery =
        q.length === 0 ||
        o.number.toLowerCase().includes(q) ||
        o.tableName.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, filter]);

  const counts = useMemo(() => {
    const base = orders.filter((o) => o.status !== 'Paid');
    return {
      Pending: base.filter((o) => o.status === 'Pending').length,
      Cooking: base.filter((o) => o.status === 'Cooking').length,
      Ready: base.filter((o) => o.status === 'Ready').length,
      Served: base.filter((o) => o.status === 'Served').length,
      Voided: base.filter((o) => o.status === 'Voided').length,
    };
  }, [orders]);

  const refresh = async () => {
    setActionErr('');
    try {
      await refreshFromServer();
    } catch {
      setActionErr('Failed to refresh from server.');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c11] text-white">
      <header className="h-auto border-b border-[#483c23] bg-[#2c241b] z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-white tracking-tight text-2xl font-bold leading-tight">Active Orders</h2>
            <p className="text-[#c9b792] text-sm mt-1">View open tickets, mark progress, void, and take payment.</p>
            {actionErr ? <div className="mt-2 text-xs text-red-300 font-semibold">{actionErr}</div> : null}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button
              onClick={() => void refresh()}
              className="h-10 px-4 rounded-lg bg-[#221c11] border border-[#483c23] text-[#c9b792] hover:text-white hover:border-[#eead2b]/40 font-bold flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              Refresh
            </button>
            <div className="relative group w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-[#c9b792] group-focus-within:text-[#eead2b] transition-colors">search</span>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-[#483c23] rounded-lg leading-5 bg-[#3a2e22] text-white placeholder-[#c9b792] focus:outline-none focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] sm:text-sm transition-all"
                placeholder="Search Table # or Order ID"
                type="text"
              />
            </div>
          </div>
        </div>

        <div className="px-6 pb-4 flex gap-2 overflow-x-auto no-scrollbar">
          <button onClick={() => setFilter('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${filter === 'All' ? 'bg-[#eead2b] text-[#221c11] shadow-[#eead2b]/20' : 'bg-[#3a2e22] text-[#c9b792] hover:text-white border border-transparent hover:border-[#eead2b]/30'}`}>All</button>
          <button onClick={() => setFilter('Pending')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Pending' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#3a2e22] text-[#c9b792] hover:text-white border border-transparent hover:border-[#eead2b]/30'}`}>Sent ({counts.Pending})</button>
          <button onClick={() => setFilter('Cooking')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Cooking' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#3a2e22] text-[#c9b792] hover:text-white border border-transparent hover:border-[#eead2b]/30'}`}>Preparing ({counts.Cooking})</button>
          <button onClick={() => setFilter('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Ready' ? 'bg-[#eead2b] text-[#221c11] font-bold' : 'bg-[#3a2e22] text-[#c9b792] hover:text-white border border-transparent hover:border-[#eead2b]/30'}`}>Ready ({counts.Ready})</button>
          <button onClick={() => setFilter('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Voided' ? 'bg-red-500 text-white font-bold' : 'bg-[#3a2e22] text-[#c9b792] hover:text-white border border-transparent hover:border-red-500/30'}`}>Voided ({counts.Voided})</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.length === 0 ? (
            <div className="text-[#c9b792]">No matching orders.</div>
          ) : (
            filtered.map((o) => (
              <div key={o.id} className="bg-[#2c241b] rounded-xl border border-[#483c23] overflow-hidden shadow-sm relative">
                {o.status === 'Voided' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-red-500/20 text-8xl font-black -rotate-12 select-none">VOID</span>
                  </div>
                )}

                <div className="p-4 border-b border-[#483c23] flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">{o.tableName}</span>
                    <span className="text-white font-mono font-bold">{o.number}</span>
                    <span className="text-xs text-[#c9b792]">{o.timeLabel}</span>
                    {(o as any)?.orderType === 'takeaway' ? (
                      <span className="mt-1 inline-flex items-center gap-2 text-xs font-bold text-[#eead2b]">
                        <span className="px-2 py-0.5 rounded-full bg-[#eead2b]/15 border border-[#eead2b]/25">Takeaway</span>
                        {Number((o as any)?.takeawayFee ?? 0) > 0 ? <span className="text-[#c9b792]">Fee ETB {Number((o as any).takeawayFee).toFixed(2)}</span> : null}
                      </span>
                    ) : null}
                    {o.status === 'Voided' && o.voidReason ? (
                      <span className="text-xs text-red-400 font-semibold mt-1">Reason: {o.voidReason}</span>
                    ) : null}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                    o.status === 'Ready' ? 'bg-[#eead2b] text-[#221c11]' :
                    o.status === 'Cooking' ? 'bg-amber-900/40 text-amber-500 border border-amber-900/50' :
                    o.status === 'Pending' ? 'bg-[#3a2e22] text-[#c9b792] border border-[#4d4030]' :
                    o.status === 'Voided' ? 'bg-red-900/20 text-red-400 border border-red-900/30' :
                    'bg-white/10 text-white border border-white/10'
                  }`}>{o.status === 'Pending' ? 'Sent' : o.status}</span>
                </div>

                <div className="p-4">
                  <ul className="space-y-2">
                    {o.items
                      .map((i) => {
                        const eff = Math.max(0, i.qty - (i.voidedQty ?? 0));
                        if (eff <= 0) return null;
                        return (
                          <li key={i.productId} className="flex justify-between items-center text-sm">
                            <span className="text-white font-medium">{eff}x {i.name}</span>
                          </li>
                        );
                      })
                      .filter(Boolean)}
                  </ul>
                </div>

                <div className="p-4 pt-2 border-t border-[#483c23] flex gap-2">
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_REVIEW);
                    }}
                    className="flex-1 bg-[#3a2e22] hover:bg-[#4a3b2b] text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-lg">visibility</span>
                    View
                  </button>
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_PAYMENT);
                    }}
                    disabled={o.status !== 'Served'}
                    className="bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Pay
                  </button>
                  <button
                    onClick={() => {
                      setActionErr('');
                      setVoidOrderId(o.id);
                      setVoidReason('');
                    }}
                    disabled={o.status === 'Voided'}
                    className="bg-red-900/10 hover:bg-red-900/20 text-red-400 font-bold py-2 px-3 rounded-lg text-sm transition-colors border border-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Void Order"
                  >
                    <span className="material-symbols-outlined text-lg">cancel</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      <Modal
        open={voidOrderId != null}
        title={selectedForVoid ? `Void Order (Reason Required): ${selectedForVoid.number}` : 'Void Order (Reason Required)'}
        onClose={() => {
          setVoidOrderId(null);
          setVoidReason('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setVoidOrderId(null);
                setVoidReason('');
              }}
              className="flex-1 h-11 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!selectedForVoid) return;
                if (!voidReason.trim()) return;
                setActionErr('');
                voidOrder(selectedForVoid.id, voidReason);
                setVoidOrderId(null);
                setVoidReason('');
              }}
              className="flex-1 h-11 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!voidReason.trim()}
            >
              Void Order
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-[#c9b792] mb-2">Void reason</label>
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          className="w-full bg-[#3a2e22] border border-[#483c23] rounded-lg p-3 text-sm text-white placeholder-[#c9b792] focus:ring-1 focus:ring-red-400 focus:border-red-400 transition-all resize-none h-28"
          placeholder="Explain why this order is being voided (required)..."
        />
      </Modal>
    </div>
  );
};
