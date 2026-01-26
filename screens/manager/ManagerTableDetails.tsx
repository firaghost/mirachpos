import React, { useMemo } from 'react';
import { Header } from '../../components/Header';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { formatDeviceDateTime } from '../../datetime';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const ManagerTableDetails: React.FC<Props> = ({ onNavigate }) => {
  const { tables, orders, selectedTableId, selectOrder } = usePos();

  const table = useMemo(() => tables.find((t) => t.id === selectedTableId) ?? null, [tables, selectedTableId]);

  const openOrder = useMemo(() => {
    if (!table?.openOrderId) return null;
    return orders.find((o) => o.id === table.openOrderId) ?? null;
  }, [orders, table]);

  const lastOrder = useMemo(() => {
    if (!table?.lastOrderId) return null;
    return orders.find((o) => o.id === table.lastOrderId) ?? null;
  }, [orders, table]);

  const derivedLastClosedOrder = useMemo(() => {
    if (!table) return null;
    const closed = orders
      .filter((o) => o.tableId === table.id && (o.status === 'Paid' || o.status === 'Voided'))
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.paidAt ?? a.voidedAt ?? a.createdAt).getTime();
        const bTime = new Date(b.paidAt ?? b.voidedAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
    return closed[0] ?? null;
  }, [orders, table]);

  const order = openOrder ?? lastOrder ?? derivedLastClosedOrder;
  const isVoided = order?.status === 'Voided';

  const assigned = useMemo(() => {
    if (!table) return null;
    const name = (table as any).assignedStaffName;
    if (typeof name === 'string' && name.trim()) return { id: table.assignedStaffId ?? '', name: name.trim() } as any;
    if (!table?.assignedStaffId) return null;
    try {
      const raw = localStorage.getItem('mirachpos.staffNameCache.v1');
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const nm = parsed && typeof parsed === 'object' ? String(parsed[table.assignedStaffId] || '') : '';
      return nm.trim() ? ({ id: table.assignedStaffId, name: nm.trim() } as any) : ({ id: table.assignedStaffId, name: ' ' } as any);
    } catch {
      return { id: table.assignedStaffId, name: ' ' } as any;
    }
  }, [table]);

  const openOrderDetails = () => {
    if (!order) return;
    selectOrder(order.id);
    onNavigate(Screen.MANAGER_ORDER_DETAILS);
  };

  if (!table) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
        <Header title="Table Details" subtitle="No table selected" />
        <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-4xl rounded-xl border border-border bg-card p-6 text-muted-foreground">
            Please select a table from the Floor Map.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <Header title="Table Details" subtitle="Manager view of activity on this table" />

      <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight">{table.name}</h2>
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold border bg-background text-muted-foreground border-border">
                  {table.openOrderId ? table.status : 'Free'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Assigned to: <span className="text-foreground font-bold">{assigned?.name ?? 'Unassigned'}</span>
                <span className="opacity-60"> | </span>
                Seats: <span className="text-foreground font-bold">{table.seats}</span>
                <span className="opacity-60"> | </span>
                View: <span className="text-foreground font-bold">{openOrder ? 'Open Order' : lastOrder ? 'Last Closed Order' : 'No Orders Yet'}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => onNavigate(Screen.MANAGER_FLOOR_MAP)}
                className="h-11 px-5 rounded-lg bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 flex items-center gap-2 text-sm font-semibold"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back
              </button>
              {order ? (
                <button
                  onClick={openOrderDetails}
                  className="h-11 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold text-sm flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                  Open Order Details
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 relative rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-foreground text-lg font-bold">What happened on this table</h3>
                <div className="text-xs text-muted-foreground">Live snapshot</div>
              </div>

              {isVoided ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-[56px] md:text-[92px] font-black tracking-[0.25em] text-red-500/10 rotate-[-18deg]">VOIDED</div>
                </div>
              ) : null}

              {order ? (
                <div className="divide-y divide-border">
                  {order.items.map((it) => {
                    const voidedQty = it.voidedQty ?? 0;
                    const effQty = Math.max(0, it.qty - voidedQty);
                    return (
                      <div key={it.productId} className="p-5 flex items-start justify-between gap-6">
                        <div className="flex flex-col gap-1">
                          <div className={`text-foreground font-semibold ${effQty === 0 ? 'line-through opacity-70' : ''}`}>{it.name}</div>
                          <div className="text-xs text-muted-foreground">ETB {it.unitPrice.toFixed(2)}{effQty}/{it.qty}</div>
                          {it.note?.trim() ? <div className="text-xs text-muted-foreground">Note: {it.note.trim()}</div> : null}
                          {voidedQty > 0 ? (
                            <div className="mt-1 inline-flex items-center gap-2">
                              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-900/20 text-red-300 border border-red-900/40">VOIDED {voidedQty}</span>
                              {it.voidReason ? <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-background text-muted-foreground border border-border">{it.voidReason}</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-foreground font-bold">ETB {(it.unitPrice * effQty).toFixed(2)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-muted-foreground">No open order on this table right now.</div>
              )}

              {isVoided && order?.voidReason ? (
                <div className="px-6 py-4 border-t border-border bg-destructive/10">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-red-400 text-[20px]">block</span>
                    <div className="flex flex-col">
                      <div className="text-sm font-bold text-red-300">Void Reason</div>
                      <div className="text-sm text-muted-foreground">{order.voidReason}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="text-foreground text-lg font-bold">Summary</h3>
              </div>
              {isVoided ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-[44px] md:text-[64px] font-black tracking-[0.25em] text-red-500/10 rotate-[-18deg]">VOIDED</div>
                </div>
              ) : null}
              <div className="p-5 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Table Total</span><span className="text-foreground font-bold">ETB {table.currentTotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Order #</span><span className="text-foreground font-bold">{order?.number ?? ' '}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-foreground font-bold">{order?.status ?? (table.openOrderId ? table.status : 'Free')}</span></div>
                <div className="h-px bg-border my-2"></div>
                {order ? (
                  <>
                    {order ? (
                      <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="text-foreground">{formatDeviceDateTime(order.createdAt)}</span></div>
                    ) : null}
                    {order?.paidAt ? <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="text-foreground">{formatDeviceDateTime(order.paidAt)}</span></div> : null}
                    {order?.voidedAt ? <div className="flex justify-between text-red-300"><span className="font-bold">Voided</span><span className="text-red-300">{formatDeviceDateTime(order.voidedAt)}</span></div> : null}
                    {order.voidReason ? <div className="text-red-200 text-xs">Reason: {order.voidReason}</div> : null}
                    <div className="h-px bg-border my-2"></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="text-foreground font-bold">ETB {order.subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="text-foreground font-bold">ETB {order.tax.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Service</span><span className="text-foreground font-bold">ETB {order.serviceCharge.toFixed(2)}</span></div>
                    {Number((order as any).tip ?? 0) > 0 ? (
                      <div className="flex justify-between"><span className="text-muted-foreground">Tip</span><span className="text-foreground font-bold">ETB {Number((order as any).tip ?? 0).toFixed(2)}</span></div>
                    ) : null}
                    <div className="flex justify-between text-base"><span className="text-muted-foreground font-bold">Total</span><span className="text-foreground font-black">ETB {order.total.toFixed(2)}</span></div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
