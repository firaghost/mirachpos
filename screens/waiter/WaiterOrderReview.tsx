import { AppIcon } from '@/components/ui/app-icon';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos, useSelectedOrder } from '../../PosContext';
import { Modal } from '../../components/Modal';
import { apiFetch } from '../../api';

interface Props {
    onNavigate: (screen: Screen) => void;
}

export const WaiterOrderReview: React.FC<Props> = ({ onNavigate }) => {
  const { voidOrder, voidOrderItem, setPendingOrderItemQty, setPendingOrderItemNote, setOrderCustomer, setOrderSplits, refreshFromServer, queueOfflineWrite } = usePos();
  const order = useSelectedOrder();

  const [editMode, setEditMode] = useState(false);

  const [noteEditProductId, setNoteEditProductId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [voidOrderOpen, setVoidOrderOpen] = useState(false);
  const [voidItemProductId, setVoidItemProductId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [splitBillOpen, setSplitBillOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  const [orderNotesDraft, setOrderNotesDraft] = useState('');

  useEffect(() => {
    setOrderNotesDraft(order?.notes ?? '');
  }, [order?.id]);

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');

  const [splitCount, setSplitCount] = useState(2);
  const [splitAlloc, setSplitAlloc] = useState<Record<string, number[]>>({});

  const genId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string; loyaltyPoints: number; loyaltyBalance: number }>>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);

  const enqueueIfOffline = useCallback(
    async (args: { url: string; method: string; body?: any; headers?: Record<string, string> }) => {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (online) return false;
      await queueOfflineWrite(args);
      return true;
    },
    [queueOfflineWrite],
  );

  const loadCustomers = async (q?: string) => {
    setCustomersLoading(true);
    setCustomersError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '200');
      if (q && q.trim()) qs.set('q', q.trim());
      const res = await apiFetch(`/api/pos/customers?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.customers) ? (json.customers as any[]) : [];
      const normalized = rows
        .map((c) => ({
          id: String(c.id || ''),
          name: String(c.name || ''),
          phone: String(c.phone || ''),
          loyaltyPoints: Number(c.loyaltyPoints ?? c.loyalty_points ?? 0) || 0,
          loyaltyBalance: Number(c.loyaltyBalance ?? c.loyalty_balance ?? 0) || 0,
        }))
        .filter((c) => c.id && c.name);
      setCustomers(normalized);
    } catch (e) {
      setCustomers([]);
      setCustomersError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      setCustomersLoading(false);
    }
  };

  useEffect(() => {
    if (!customerOpen) return;
    void loadCustomers('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerOpen]);
  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q));
  }, [customers, customerQuery]);

  const ensureSplitDraft = () => {
    if (!order) return;
    const next: Record<string, number[]> = {};
    for (const it of order.items) {
      const qty = Number(it.qty) || 0;
      const prev = splitAlloc[it.productId];
      if (Array.isArray(prev) && prev.length === splitCount) {
        const sum = prev.reduce((a, b) => a + (Number(b) || 0), 0);
        if (sum === qty) {
          next[it.productId] = prev.map((x) => Math.max(0, Math.floor(Number(x) || 0)));
          continue;
        }
      }
      const arr = Array(splitCount).fill(0) as number[];
      arr[0] = qty;
      next[it.productId] = arr;
    }
    setSplitAlloc(next);
  };

  const noteItem = useMemo(
    () => order?.items.find((x) => x.productId === noteEditProductId) ?? null,
    [order?.items, noteEditProductId],
  );

  const voidItem = useMemo(
    () => order?.items.find((x) => x.productId === voidItemProductId) ?? null,
    [order?.items, voidItemProductId],
  );

  const isVoided = order?.status === 'Voided';
  const canPay = order?.status === 'Served' && !isVoided && order?.status !== 'Paid';
  const canEditPending = Boolean(order) && editMode && order.status === 'Pending' && !isVoided && order.status !== 'Paid';

  const calcSplitTotals = (alloc: Record<string, number[]>) => {
    if (!order) return [] as any[];
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const splits = Array.from({ length: splitCount }, (_, idx) => ({ idx }));
    const itemLines = order.items.map((it) => {
      const unit = Number(it.unitPrice) || 0;
      const qtys = alloc[it.productId] || Array(splitCount).fill(0);
      return { productId: it.productId, name: it.name, unitPrice: unit, qtys };
    });
    const grandSubtotal = Number(order.subtotal) || 0;
    const grandTax = Number(order.tax) || 0;
    const grandSvc = Number(order.serviceCharge) || 0;

    const taxRate = grandSubtotal > 0 ? grandTax / grandSubtotal : 0;
    const svcRate = grandSubtotal > 0 ? grandSvc / grandSubtotal : 0;

    const raw = splits.map(({ idx }) => {
      let subtotal = 0;
      let tax = 0;
      let serviceCharge = 0;
      const items: Array<{ productId: string; qty: number }> = [];

      for (const l of itemLines) {
        const q = Math.max(0, Math.floor(Number(l.qtys[idx]) || 0));
        if (q <= 0) continue;
        const lineSubtotal = l.unitPrice * q;
        subtotal += lineSubtotal;
        tax += lineSubtotal * taxRate;
        serviceCharge += lineSubtotal * svcRate;
        items.push({ productId: l.productId, qty: q });
      }

      const subtotal2 = round2(subtotal);
      const tax2 = round2(tax);
      const svc2 = round2(serviceCharge);
      const total2 = round2(subtotal2 + tax2 + svc2);
      return { items, subtotal: subtotal2, tax: tax2, serviceCharge: svc2, total: total2 };
    });

    // Ensure rounding sums match order totals (push remainder to last non-empty split)
    const idxLast = (() => {
      for (let i = raw.length - 1; i >= 0; i--) {
        if (raw[i].items.length > 0) return i;
      }
      return raw.length - 1;
    })();

    const sumSubtotal = raw.reduce((a, b) => a + (Number(b.subtotal) || 0), 0);
    const sumTax = raw.reduce((a, b) => a + (Number(b.tax) || 0), 0);
    const sumSvc = raw.reduce((a, b) => a + (Number(b.serviceCharge) || 0), 0);

    const dSubtotal = round2(grandSubtotal - sumSubtotal);
    const dTax = round2(grandTax - sumTax);
    const dSvc = round2(grandSvc - sumSvc);

    if (idxLast >= 0 && raw[idxLast]) {
      raw[idxLast] = {
        ...raw[idxLast],
        subtotal: round2(raw[idxLast].subtotal + dSubtotal),
        tax: round2(raw[idxLast].tax + dTax),
        serviceCharge: round2(raw[idxLast].serviceCharge + dSvc),
        total: round2(raw[idxLast].subtotal + dSubtotal + raw[idxLast].tax + dTax + raw[idxLast].serviceCharge + dSvc),
      };
    }

    return raw;
  };

  const splitPreview = useMemo(() => (order ? calcSplitTotals(splitAlloc) : []), [order?.id, splitAlloc, splitCount]);

  if (!order) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
        <header className="h-20 border-b border-border bg-card/95 backdrop-blur z-10 flex items-center justify-between px-6 md:px-10 shrink-0">
          <div className="flex flex-col">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Review Order</h2>
            <p className="text-muted-foreground text-sm mt-1">No active order selected.</p>
          </div>
          <button
            onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-semibold transition-all hover:border-muted-foreground/30"
          >
            <AppIcon name="arrow_back" className="text-[20px]" size={20} />
            <span>Back</span>
          </button>
        </header>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Top Header */}
      <header className="h-20 border-b border-border bg-card/95 backdrop-blur z-10 flex items-center justify-between px-6 md:px-10 shrink-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Review Order: {order.tableName}</h2>
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/30">{order.status}</span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {order.number}    <span className="italic">{order.timeLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(Screen.WAITER_MENU)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-semibold transition-all hover:border-muted-foreground/30"
          >
            <AppIcon name="arrow_back" className="text-[20px]" size={20} />
            <span>Back</span>
          </button>
        </div>
      </header>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column: Order Items Table */}
          <div className="xl:col-span-2 flex flex-col gap-6">
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-secondary/30">
                <h3 className="text-foreground font-semibold flex items-center gap-2">
                  <AppIcon name="list_alt" className="text-primary text-[20px]" size={20} /> Order Items
                </h3>
                <button
                  onClick={() => setEditMode((v) => !v)}
                  disabled={order.status !== 'Pending' || isVoided || order.status === 'Paid'}
                  className="text-xs font-medium text-primary hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editMode ? 'Exit Edit Mode' : 'Edit Mode'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary text-muted-foreground text-sm uppercase tracking-wider font-medium">
                      <th className="px-6 py-4 font-semibold w-5/12">Item Name</th>
                      <th className="px-6 py-4 font-semibold w-2/12 text-center">Qty</th>
                      <th className="px-6 py-4 font-semibold w-3/12">Modifiers</th>
                      <th className="px-6 py-4 font-semibold w-2/12 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {/* Item 1 */}
                    {order.items.map((item) => {
                      const voidedQty = item.voidedQty ?? 0;
                      const effQty = Math.max(0, item.qty - voidedQty);

                      return (
                      <tr key={item.productId} className={`group hover:bg-secondary/50 transition-colors ${effQty === 0 ? 'opacity-60 line-through' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-foreground font-medium text-base">{item.name}</span>
                            {item.note?.trim() ? <span className="text-muted-foreground text-xs">{item.note.trim()}</span> : <span className="text-muted-foreground text-xs"></span>}
                            <button
                              onClick={() => {
                                setNoteEditProductId(item.productId);
                                setNoteDraft(item.note ?? '');
                              }}
                              disabled={!canEditPending}
                              className="mt-2 text-xs font-medium text-primary hover:text-foreground transition-colors w-fit disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Edit modifier
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-3">
                            <button
                              onClick={() => setPendingOrderItemQty(order.id, item.productId, Math.max(0, item.qty - 1))}
                              disabled={!canEditPending}
                              className="w-6 h-6 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Decrease qty"
                            >
                              <AppIcon name="remove" className="text-[16px]" size={16} />
                            </button>
                            <button
                              onClick={() => {
                                setVoidItemProductId(item.productId);
                                setVoidReason('');
                              }}
                              disabled={isVoided || effQty === 0}
                              className="w-6 h-6 rounded bg-background border border-destructive/50 flex items-center justify-center text-destructive hover:text-foreground hover:border-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Void 1"
                            >
                              <AppIcon name="remove" className="text-[16px]" size={16} />
                            </button>
                            <span className="text-foreground font-mono font-medium text-center">{effQty}/{item.qty}</span>
                            <button
                              onClick={() => setPendingOrderItemQty(order.id, item.productId, item.qty + 1)}
                              disabled={!canEditPending}
                              className="w-6 h-6 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Increase qty"
                            >
                              <AppIcon name="add" className="text-[16px]" size={16} />
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">-</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-foreground font-medium">ETB {(item.unitPrice * effQty).toFixed(2)}</span>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 bg-secondary/30 border-t border-border flex justify-between items-center">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setVoidOrderOpen(true);
                      setVoidReason('');
                    }}
                    disabled={isVoided || order.status === 'Paid'}
                    className="px-3 py-1.5 rounded-lg border border-destructive/50 text-destructive bg-destructive/10 text-sm font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Void Order
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Summary & Actions */}
          <div className="xl:col-span-1 flex flex-col gap-6">
            {/* Notes Card */}
            <div className="bg-card rounded-xl border border-border overflow-hidden p-5 flex flex-col gap-3 shadow-sm">
              <label className="flex items-center gap-2 text-foreground text-sm font-semibold">
                <AppIcon name="edit_note" className="text-primary text-[20px]" size={20} /> Kitchen / Dietary Notes
              </label>
              <textarea
                value={orderNotesDraft}
                onChange={(e) => setOrderNotesDraft(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-none h-32"
                placeholder="Add allergy info, special requests, or preparation notes here..."
              ></textarea>
            </div>

            {/* Financial Summary Card */}
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm flex flex-col">
              <div className="p-5 flex flex-col gap-3 border-b border-border/50">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-foreground font-medium">ETB {order.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="text-foreground font-medium">ETB {order.tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Service Charge</span>
                  <span className="text-foreground font-medium">ETB {order.serviceCharge.toFixed(2)}</span>
                </div>
                {Number((order as any)?.takeawayFee ?? (order as any)?.payload?.takeawayFee ?? 0) > 0 ? (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Takeaway Fee</span>
                    <span className="text-foreground font-medium">ETB {Number((order as any)?.takeawayFee ?? (order as any)?.payload?.takeawayFee ?? 0).toFixed(2)}</span>
                  </div>
                ) : null}
              </div>
              <div className="p-5 bg-secondary/30">
                <div className="flex justify-between items-end">
                  <span className="text-muted-foreground font-medium pb-1">Grand Total</span>
                  <span className="text-3xl font-bold text-primary">ETB {order.total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Primary Action */}
            <div className="flex flex-col gap-3">
              <button disabled={!canPay} onClick={() => onNavigate(Screen.WAITER_PAYMENT)} className="w-full py-4 px-6 bg-primary hover:bg-primary/80 active:scale-[0.98] rounded-xl text-primary-foreground font-extrabold text-lg uppercase tracking-wide shadow-lg shadow-primary/10 transition-all flex items-center justify-center gap-3 group disabled:opacity-50 disabled:cursor-not-allowed">
                <AppIcon name="skillet" className="text-primary-foreground text-[28px] group-hover:animate-pulse" size={28} />
                {canPay ? 'Proceed to Payment' : 'Payment available after Served'}
              </button>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button
                  onClick={() => setSplitBillOpen(true)}
                  className="py-3 px-4 bg-card hover:bg-secondary border border-border rounded-lg text-foreground font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <AppIcon name="call_split" className="text-muted-foreground text-[18px]" size={18} /> Split Bill
                </button>
                <button
                  onClick={() => setCustomerOpen(true)}
                  className="py-3 px-4 bg-card hover:bg-secondary border border-border rounded-lg text-foreground font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <AppIcon name="person_add" className="text-muted-foreground text-[18px]" size={18} /> Customer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={splitBillOpen}
        title="Split Bill"
        onClose={() => setSplitBillOpen(false)}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setSplitBillOpen(false)}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                const totals = calcSplitTotals(splitAlloc);
                const splits = totals
                  .map((t, idx) => ({
                    id: `split_${idx + 1}_${genId()}`,
                    status: 'Unpaid' as const,
                    items: t.items,
                    subtotal: t.subtotal,
                    tax: t.tax,
                    serviceCharge: t.serviceCharge,
                    total: t.total,
                  }))
                  .filter((s) => s.items.length > 0);
                setOrderSplits(order.id, splits.length ? splits : null);
                setSplitBillOpen(false);
              }}
              className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground font-bold transition-colors"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">Choose how many splits and assign item quantities to each split.</div>
            <select
              value={splitCount}
              onChange={(e) => {
                const n = Math.max(2, Math.min(6, Number(e.target.value) || 2));
                setSplitCount(n);
                setSplitAlloc({});
              }}
              className="h-10 bg-background rounded-lg border border-border text-sm font-semibold text-foreground px-3"
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} splits
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={ensureSplitDraft}
            className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground font-bold"
          >
            Reset Allocation
          </button>

          <div className="space-y-3">
            {order.items.map((it) => {
              const qty = Number(it.qty) || 0;
              const alloc = splitAlloc[it.productId] || Array(splitCount).fill(0);
              const sum = alloc.reduce((a, b) => a + (Number(b) || 0), 0);
              return (
                <div key={it.productId} className="border border-border rounded-xl p-4 bg-background">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-foreground">{it.name}</div>
                    <div className="text-xs text-muted-foreground">Qty {qty}    Alloc {sum}/{qty}</div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                    {Array.from({ length: splitCount }, (_, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2">
                        <div className="text-xs text-muted-foreground font-bold">Split {idx + 1}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const next = { ...splitAlloc };
                              const arr = (next[it.productId] || Array(splitCount).fill(0)).slice();
                              arr[idx] = Math.max(0, (Number(arr[idx]) || 0) - 1);
                              next[it.productId] = arr;
                              setSplitAlloc(next);
                            }}
                            className="h-8 w-8 rounded bg-background border border-border text-foreground font-black"
                          >
                            -
                          </button>
                          <div className="w-8 text-center text-sm font-bold text-foreground">{Math.max(0, Math.floor(Number(alloc[idx]) || 0))}</div>
                          <button
                            onClick={() => {
                              const next = { ...splitAlloc };
                              const arr = (next[it.productId] || Array(splitCount).fill(0)).slice();
                              const currentSum = arr.reduce((a, b) => a + (Number(b) || 0), 0);
                              if (currentSum >= qty) return;
                              arr[idx] = Math.max(0, (Number(arr[idx]) || 0) + 1);
                              next[it.productId] = arr;
                              setSplitAlloc(next);
                            }}
                            className="h-8 w-8 rounded bg-background border border-border text-foreground font-black"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border border-border rounded-xl p-4 bg-card">
            <div className="text-sm font-bold text-foreground mb-2">Preview</div>
            <div className="space-y-2">
              {splitPreview.map((sp, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">Split {idx + 1} ({sp.items.reduce((s, x) => s + x.qty, 0)} items)</div>
                  <div className="text-foreground font-extrabold">ETB {sp.total.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={customerOpen}
        title="Customer"
        onClose={() => setCustomerOpen(false)}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setCustomerOpen(false)}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                setOrderCustomer(order.id, null);
                setCustomerOpen(false);
              }}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold transition-colors"
            >
              Remove
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">Select a customer or create a new one and attach to this order.</div>

          {order.customer ? (
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Attached</div>
                  <div className="text-sm font-bold text-foreground">{order.customer.name}</div>
                  <div className="text-xs text-muted-foreground">{order.customer.phone}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Points {order.customer.loyaltyPoints}</div>
                  <div className="text-sm font-extrabold text-primary">ETB {Number(order.customer.loyaltyBalance || 0).toFixed(2)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => {
                    const points = Math.max(0, Number(order.customer?.loyaltyPoints) || 0);
                    if (points < 100) return;
                    const convertable = Math.floor(points / 100) * 100;
                    const addBal = (convertable / 100) * 10; // 100 points => 10 ETB
                    const next = {
                      ...order.customer!,
                      loyaltyPoints: points - convertable,
                      loyaltyBalance: round2((Number(order.customer?.loyaltyBalance) || 0) + addBal),
                    };
                    (async () => {
                      try {
                        const url = `/api/pos/customers/${encodeURIComponent(next.id)}`;
                        const body = { loyaltyPoints: next.loyaltyPoints, loyaltyBalance: next.loyaltyBalance };
                        if (await enqueueIfOffline({ url, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })) return;
                        await apiFetch(url, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        });
                      } catch {
                        // ignore
                      }
                    })();
                    setOrderCustomer(order.id, next);
                  }}
                  className="h-11 px-4 rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground font-extrabold"
                >
                  Convert Points to Balance
                </button>
                <div className="text-xs text-muted-foreground self-center">
                  Rule: 100 points = 10 ETB (converts in blocks of 100)
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <div className="text-xs font-bold text-muted-foreground">Search</div>
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
                placeholder="Name or phone..."
              />
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            {filteredCustomers.length ? (
              filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setOrderCustomer(order.id, c);
                    setCustomerOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 bg-background hover:bg-card border-b border-border last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-foreground">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.phone}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Points {c.loyaltyPoints}</div>
                      <div className="text-sm font-extrabold text-primary">ETB {c.loyaltyBalance.toFixed(2)}</div>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-4 text-sm text-muted-foreground">{customersLoading ? 'Loading ' : customersError ? customersError : 'No customers found.'}</div>
            )}
          </div>

          <div className="border border-border rounded-xl p-4 bg-card">
            <div className="text-sm font-bold text-foreground mb-3">Create Customer</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-bold text-muted-foreground">Name</div>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
                  placeholder="Customer name"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-muted-foreground">Phone</div>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="mt-1 w-full h-11 bg-background border border-border rounded-lg px-4 text-foreground"
                  placeholder="+251..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  const name = customerName.trim();
                  const phone = customerPhone.trim();
                  if (!name || !phone) return;
                  (async () => {
                    try {
                      const body = { name, phone };
                      if (await enqueueIfOffline({ url: '/api/pos/customers', method: 'POST', headers: { 'Content-Type': 'application/json' }, body })) {
                        setCustomerName('');
                        setCustomerPhone('');
                        setCustomerQuery('');
                        setCustomerOpen(false);
                        return;
                      }
                      const res = await apiFetch('/api/pos/customers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                      });
                      const json = (await res.json().catch(() => null)) as any;
                      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                      const id = String(json?.id || '').trim();
                      if (!id) throw new Error('invalid_id');

                      const created = { id, name, phone, loyaltyPoints: 0, loyaltyBalance: 0 };
                      setCustomers((prev) => [created, ...prev]);
                      setOrderCustomer(order.id, created);
                      setCustomerName('');
                      setCustomerPhone('');
                      setCustomerQuery('');
                      setCustomerOpen(false);
                    } catch {
                      // ignore
                    }
                  })();
                }}
                className="h-11 px-4 rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground font-extrabold"
              >
                Create & Attach
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={noteEditProductId != null}
        title={noteItem ? `Edit Modifier: ${noteItem.name}` : 'Edit Modifier'}
        onClose={() => {
          setNoteEditProductId(null);
          setNoteDraft('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setNoteEditProductId(null);
                setNoteDraft('');
              }}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!noteItem) return;
                setPendingOrderItemNote(order.id, noteItem.productId, noteDraft);
                setNoteEditProductId(null);
                setNoteDraft('');
              }}
              className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canEditPending}
            >
              Save
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-muted-foreground mb-2">Item modifier / note</label>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          className="w-full bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-none h-28"
          placeholder="e.g. No sugar, extra spicy, well-done, allergy notes..."
        />
      </Modal>

      <Modal
        open={voidOrderOpen}
        title="Void Order (Reason Required)"
        onClose={() => {
          setVoidOrderOpen(false);
          setVoidReason('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setVoidOrderOpen(false);
                setVoidReason('');
              }}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!voidReason.trim()) return;
                voidOrder(order.id, voidReason);
                setVoidOrderOpen(false);
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

      <Modal
        open={voidItemProductId != null}
        title={voidItem ? `Void Item (Reason Required): ${voidItem.name}` : 'Void Item (Reason Required)'}
        onClose={() => {
          setVoidItemProductId(null);
          setVoidReason('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setVoidItemProductId(null);
                setVoidReason('');
              }}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!voidItem) return;
                if (!voidReason.trim()) return;
                voidOrderItem(order.id, voidItem.productId, 1, voidReason);
                setVoidItemProductId(null);
                setVoidReason('');
              }}
              className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!voidReason.trim()}
            >
              Void 1
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-muted-foreground mb-2">Void reason</label>
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          className="w-full bg-secondary border border-border rounded-lg p-3 text-sm text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-destructive focus:border-destructive transition-all resize-none h-28"
          placeholder="Explain why this item is being voided (required)..."
        />
      </Modal>
    </div>
  );
};
