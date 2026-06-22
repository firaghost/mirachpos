import React, { useMemo, useState } from 'react';

import { usePos } from '../../PosContext';

import { AppIcon } from '@/components/ui/app-icon';
import { cn } from '@/components/lib/utils';

export type CartPanelProps = {
  selectedTableId: string | null;
  onOrderSent?: (orderId: string) => void;
};

export const CartPanel: React.FC<CartPanelProps> = ({ selectedTableId, onOrderSent }) => {
  const {
    tables,
    orders,
    getCartItems,
    setCartQty,
    removeFromCart,
    setCartItemNote,
    getDraftOrderMeta,
    setDraftOrderMeta,
    sendOrderToKitchen,
    printKitchenTicket,
    setOrderStatus,
    refreshFromServer,
  } = usePos();

  const table = useMemo(() => (selectedTableId ? tables.find((t) => t.id === selectedTableId) ?? null : null), [selectedTableId, tables]);

  const cartItems = useMemo(() => {
    if (!selectedTableId) return [];
    return getCartItems(selectedTableId);
  }, [getCartItems, selectedTableId]);

  const draftMeta = useMemo(() => {
    if (!selectedTableId) return {};
    return getDraftOrderMeta(selectedTableId);
  }, [getDraftOrderMeta, selectedTableId]);

  const orderType = draftMeta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in';
  const takeawayFee = orderType === 'takeaway' ? Math.max(0, Number(draftMeta?.takeawayFee ?? 0) || 0) : 0;

  const subtotal = useMemo(() => cartItems.reduce((sum, i) => sum + (Number(i.unitPrice || 0) || 0) * (Number(i.qty || 0) || 0), 0), [cartItems]);
  const total = useMemo(() => subtotal + takeawayFee, [subtotal, takeawayFee]);

  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);

  const canSend = Boolean(selectedTableId) && cartItems.length > 0 && !sending;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-foreground">Cart</div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {table ? table.name : 'Select a table'}
            </div>
          </div>

          {selectedTableId ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  'h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest',
                  orderType === 'dine_in'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                )}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraftOrderMeta(selectedTableId, { ...draftMeta, orderType: 'dine_in' });
                }}
              >
                Dine-in
              </button>
              <button
                type="button"
                className={cn(
                  'h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest',
                  orderType === 'takeaway'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                )}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraftOrderMeta(selectedTableId, { ...draftMeta, orderType: 'takeaway' });
                }}
              >
                Takeaway
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {cartItems.length === 0 ? (
          <div className="text-sm text-muted-foreground">No items.</div>
        ) : (
          cartItems.map((i) => (
            <div key={i.productId} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-foreground font-black text-sm leading-tight">{i.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground font-semibold">ETB {Number(i.unitPrice || 0).toFixed(2)}</div>
                </div>
                <button
                  type="button"
                  className="h-9 w-9 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground flex items-center justify-center"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    if (!selectedTableId) return;
                    removeFromCart(selectedTableId, i.productId);
                  }}
                >
                  <AppIcon name="delete" className="text-[18px]" size={18} />
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="h-9 w-9 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground flex items-center justify-center"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (!selectedTableId) return;
                      setCartQty(selectedTableId, i.productId, (i.qty || 0) - 1);
                    }}
                  >
                    <AppIcon name="remove" className="text-[18px]" size={18} />
                  </button>
                  <div className="min-w-10 text-center text-sm font-black text-foreground">{i.qty}</div>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground flex items-center justify-center"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (!selectedTableId) return;
                      setCartQty(selectedTableId, i.productId, (i.qty || 0) + 1);
                    }}
                  >
                    <AppIcon name="add" className="text-[18px]" size={18} />
                  </button>
                </div>

                <div className="text-sm font-black text-foreground">ETB {((Number(i.unitPrice || 0) || 0) * (Number(i.qty || 0) || 0)).toFixed(2)}</div>
              </div>

              <div className="mt-2">
                <input
                  value={i.note || ''}
                  onChange={(e) => {
                    if (!selectedTableId) return;
                    setCartItemNote(selectedTableId, i.productId, e.target.value);
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none"
                  placeholder="Add note"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold text-muted-foreground">
          <div>Subtotal</div>
          <div className="text-right">ETB {subtotal.toFixed(2)}</div>
          {takeawayFee > 0 ? (
            <>
              <div>Takeaway fee</div>
              <div className="text-right">ETB {takeawayFee.toFixed(2)}</div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total</div>
          <div className="text-xl font-black text-foreground">ETB {total.toFixed(2)}</div>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full min-h-16 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          placeholder="Order notes (optional)"
        />

        <button
          type="button"
          className={cn(
            'h-11 w-full rounded-xl text-sm font-black',
            canSend
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
          disabled={!canSend}
          onPointerDown={(e) => {
            e.preventDefault();
            if (!selectedTableId) return;
            if (!canSend) return;
            setSending(true);
            try {
              const id = sendOrderToKitchen(selectedTableId, notes);
              if (id) {
                // Order is created as Pending by default, no need to override status
                try {
                  const attemptPrint = (attempt: number) => {
                    try {
                      const exists = (orders || []).some((o) => o && o.id === id);
                      if (exists || attempt >= 6) {
                        void printKitchenTicket(id, { mode: 'dialog' });
                        return;
                      }
                      window.setTimeout(() => attemptPrint(attempt + 1), 120);
                    } catch {
                      // ignore
                    }
                  };
                  attemptPrint(0);
                } catch {
                  // ignore
                }
                try {
                  void refreshFromServer();
                } catch {
                  // ignore
                }
              }
              if (id && onOrderSent) onOrderSent(id);
              setNotes('');
            } finally {
              setSending(false);
            }
          }}
        >
          Send Order
        </button>
      </div>
    </div>
  );
};
