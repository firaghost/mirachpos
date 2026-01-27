import React, { useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { Modal } from '../../components/Modal';

import { AppIcon } from '@/components/ui/app-icon';
interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterActiveOrders: React.FC<Props> = ({ onNavigate }) => {
  const { orders, selectOrder, voidOrder, refreshFromServer, getUiPref, setUiPref } = usePos();
  const [query, setQuery] = useState(() => getUiPref<string>('waiter.activeOrders.query', ''));
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Voided'>(() =>
    getUiPref<'All' | 'Pending' | 'Cooking' | 'Ready' | 'Served' | 'Voided'>('waiter.activeOrders.filter', 'All'),
  );

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

  React.useEffect(() => {
    setUiPref('waiter.activeOrders.query', query);
  }, [query, setUiPref]);

  React.useEffect(() => {
    setUiPref('waiter.activeOrders.filter', filter);
  }, [filter, setUiPref]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="h-auto border-b border-border bg-card z-20 shadow-md">
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-foreground tracking-tight text-2xl font-bold leading-tight">Active Orders</h2>
            <p className="text-muted-foreground text-sm mt-1">View open tickets, mark progress, void, and take payment.</p>
            {actionErr ? <div className="mt-2 text-xs text-destructive font-semibold">{actionErr}</div> : null}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button
              onClick={() => void refresh()}
              className="h-10 px-4 rounded-lg bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 font-bold flex items-center justify-center gap-2"
            >
              <AppIcon name="sync" className="text-[18px]" size={18} />
              Refresh
            </button>
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
          </div>
        </div>

        <div className="px-6 pb-4 flex gap-2 overflow-x-auto no-scrollbar">
          <button onClick={() => setFilter('All')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold shadow-lg transition-colors ${filter === 'All' ? 'bg-primary text-primary-foreground shadow-primary/20' : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>All</button>
          <button onClick={() => setFilter('Pending')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Pending' ? 'bg-primary text-primary-foreground font-bold' : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Sent ({counts.Pending})</button>
          <button onClick={() => setFilter('Cooking')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Cooking' ? 'bg-primary text-primary-foreground font-bold' : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Preparing ({counts.Cooking})</button>
          <button onClick={() => setFilter('Ready')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Ready' ? 'bg-primary text-primary-foreground font-bold' : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-primary/30'}`}>Ready ({counts.Ready})</button>
          <button onClick={() => setFilter('Voided')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${filter === 'Voided' ? 'bg-destructive text-destructive-foreground font-bold' : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-destructive/30'}`}>Voided ({counts.Voided})</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground">No matching orders.</div>
          ) : (
            filtered.map((o) => (
              <div key={o.id} className="bg-card rounded-xl border border-border overflow-hidden shadow-sm relative">
                {o.status === 'Voided' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-destructive/20 text-8xl font-black -rotate-12 select-none">VOID</span>
                  </div>
                )}

                <div className="p-4 border-b border-border flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{o.tableName}</span>
                    <span className="text-foreground font-mono font-bold">{o.number}</span>
                    <span className="text-xs text-muted-foreground">{o.timeLabel}</span>
                    {(o as any)?.orderType === 'takeaway' ? (
                      <span className="mt-1 inline-flex items-center gap-2 text-xs font-bold text-primary">
                        <span className="px-2 py-0.5 rounded-full bg-primary/15 border border-primary/25">Takeaway</span>
                        {Number((o as any)?.takeawayFee ?? 0) > 0 ? <span className="text-muted-foreground">Fee ETB {Number((o as any).takeawayFee).toFixed(2)}</span> : null}
                      </span>
                    ) : null}
                    {o.status === 'Voided' && o.voidReason ? (
                      <span className="text-xs text-destructive font-semibold mt-1">Reason: {o.voidReason}</span>
                    ) : null}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                    o.status === 'Ready' ? 'bg-primary text-primary-foreground' :
                    o.status === 'Cooking' ? 'bg-amber-900/40 text-amber-500 border border-amber-900/50' :
                    o.status === 'Pending' ? 'bg-secondary text-muted-foreground border border-border' :
                    o.status === 'Voided' ? 'bg-destructive/10 text-destructive border border-destructive/30' :
                    'bg-muted/40 text-foreground border border-border'
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
                            <span className="text-foreground font-medium">{eff}x {i.name}</span>
                          </li>
                        );
                      })
                      .filter(Boolean)}
                  </ul>
                </div>

                <div className="p-4 pt-2 border-t border-border flex gap-2">
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_REVIEW);
                    }}
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-foreground font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <AppIcon name="visibility" className="text-lg" size={18} />
                    View
                  </button>
                  <button
                    onClick={() => {
                      setActionErr('');
                      selectOrder(o.id);
                      onNavigate(Screen.WAITER_PAYMENT);
                    }}
                    disabled={o.status !== 'Served'}
                    className="bg-primary hover:bg-primary/80 text-primary-foreground font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="bg-destructive/10 hover:bg-destructive/20 text-destructive font-bold py-2 px-3 rounded-lg text-sm transition-colors border border-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Void Order"
                  >
                    <AppIcon name="cancel" className="text-lg" size={18} />
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
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
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
              className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!voidReason.trim()}
            >
              Void Order
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-muted-foreground mb-2">Void reason</label>
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          className="w-full bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-destructive focus:border-destructive transition-all resize-none h-28"
          placeholder="Explain why this order is being voided (required)..."
        />
      </Modal>
    </div>
  );
};
