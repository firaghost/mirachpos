import React, { useMemo, useState } from 'react';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { Modal } from '../../components/Modal';
import { apiFetch } from '../../api';
import { readSession } from '../../session';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const BranchOrderDetails: React.FC<Props> = ({ onNavigate }) => {
  const { orders, selectedOrderId, setOrderStatus, voidOrder, refreshFromServer } = usePos();
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundPin, setRefundPin] = useState('');
  const [refundApprovers, setRefundApprovers] = useState<Array<{ id: string; name: string; roleName: string }>>([]);
  const [refundApproveAsId, setRefundApproveAsId] = useState<string>('');
  const [refundErr, setRefundErr] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);

  const order = useMemo(() => orders.find((o) => o.id === selectedOrderId) ?? null, [orders, selectedOrderId]);

  const isVoided = order?.status === 'Voided';
  const isPaid = order?.status === 'Paid';
  const isRefunded = order?.status === 'Refunded';
  const canMutate = Boolean(order && !isVoided && !isPaid && !isRefunded);

  if (!order) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
        <header className="h-20 border-b border-[#483c23] bg-[#2c241b]/95 backdrop-blur z-10 flex items-center justify-between px-6 md:px-10 shrink-0">
          <div className="flex flex-col">
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Order Details</h2>
            <p className="text-[#c9b792] text-sm mt-1">No order selected.</p>
          </div>
          <button onClick={() => onNavigate(Screen.MANAGER_ORDERS)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] text-white text-sm font-semibold transition-all hover:border-[#c9b792]/30">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              <span>Back</span>
          </button>
        </header>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
      <header className="h-20 border-b border-[#483c23] bg-[#2c241b]/95 backdrop-blur z-10 flex items-center justify-between px-6 md:px-10 shrink-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Order: {order.tableName}</h2>
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
              order.status === 'Paid'
                ? 'bg-green-900/40 text-green-400 border-green-800/50'
                : order.status === 'Voided'
                  ? 'bg-red-900/40 text-red-400 border-red-800/50'
                  : order.status === 'Refunded'
                    ? 'bg-purple-900/40 text-purple-300 border-purple-800/50'
                    : 'bg-white/10 text-[#c9b792] border-white/10'
            }`}>{order.status}</span>
          </div>
          <p className="text-[#c9b792] text-sm mt-1">
            {order.number} {new Date(order.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' })}  <span className="italic">{order.timeLabel}</span>
            {order.createdByName ? <span> Placed by: <span className="text-white font-bold">{order.createdByName}</span></span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canMutate ? (
            <div className="hidden md:flex items-center gap-2 mr-2">
              <button
                disabled={order.status === 'Ready' || order.status === 'Served'}
                onClick={() => setOrderStatus(order.id, 'Ready')}
                className="h-10 px-4 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Mark Ready
              </button>
              <button
                disabled={order.status === 'Served' || order.status === 'Paid'}
                onClick={() => setOrderStatus(order.id, 'Served')}
                className="h-10 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49a26] text-[#221c10] text-sm font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Mark Served
              </button>
              <button
                onClick={() => {
                  setVoidReason('');
                  setVoidOpen(true);
                }}
                className="h-10 px-4 rounded-lg bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-red-300 text-sm font-extrabold"
              >
                Void
              </button>
            </div>
          ) : null}

          {isPaid && !isRefunded ? (
            <button
              onClick={() => {
                setRefundErr('');
                setRefundReason('');
                setRefundPin('');
                setRefundAmount('');

                setRefundApprovers([]);
                setRefundApproveAsId('');
                try {
                  const s = readSession<any>();
                  const selfId = typeof s?.staffId === 'string' ? s.staffId : '';
                  const role = typeof s?.role === 'string' ? s.role : '';
                  if (selfId && (role === 'Branch Manager' || role === 'Cafe Owner')) setRefundApproveAsId(selfId);
                } catch {
                  // ignore
                }

                void (async () => {
                  try {
                    const res = await apiFetch('/api/manager/staff?pageSize=200');
                    const json = (await res.json().catch(() => null)) as any;
                    if (!res.ok) return;
                    const rows = Array.isArray(json?.staff) ? (json.staff as any[]) : [];
                    const approvers = rows
                      .map((r: any) => ({ id: String(r?.id || ''), name: String(r?.name || ''), roleName: String(r?.roleName || r?.role_name || '') }))
                      .filter((r: any) => r.id && r.name && (r.roleName === 'Branch Manager' || r.roleName === 'Cafe Owner'));
                    setRefundApprovers(approvers);
                    if (!refundApproveAsId) {
                      const preferred = approvers.find((a: any) => a.roleName === 'Branch Manager') || approvers[0];
                      if (preferred?.id) setRefundApproveAsId(preferred.id);
                    }
                  } catch {
                    // ignore
                  }
                })();

                setRefundOpen(true);
              }}
              className="hidden md:flex items-center gap-2 h-10 px-4 rounded-lg bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20 text-purple-200 text-sm font-extrabold"
            >
              Refund
            </button>
          ) : null}

          <button onClick={() => onNavigate(Screen.MANAGER_ORDERS)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] text-white text-sm font-semibold transition-all hover:border-[#c9b792]/30">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            <span>Back</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 flex flex-col gap-6">
            <div className="relative bg-[#2c241b] rounded-xl border border-[#483c23] overflow-hidden shadow-sm">
              {isVoided ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-[56px] md:text-[92px] font-black tracking-[0.25em] text-red-500/10 rotate-[-18deg]">VOIDED</div>
                </div>
              ) : null}

              <div className="px-6 py-4 border-b border-[#483c23] flex justify-between items-center bg-[#3a2e22]/30">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#eead2b] text-[20px]">list_alt</span> Order Items
                </h3>
                <div className="text-xs text-[#c9b792]">{order.items.length} lines</div>
              </div>

              <div className="divide-y divide-[#483c23]">
                {order.items.map((it) => {
                  const voidedQty = it.voidedQty ?? 0;
                  const effectiveQty = Math.max(0, it.qty - voidedQty);
                  const lineVoided = effectiveQty === 0 && it.qty > 0;

                  return (
                    <div key={it.productId} className={`px-6 py-4 flex items-start justify-between gap-6 ${lineVoided ? 'opacity-70' : ''}`}>
                      <div className="flex flex-col gap-1">
                        <div className={`text-white font-semibold ${lineVoided ? 'line-through' : ''}`}>{it.name}</div>
                        <div className="text-xs text-[#c9b792]">ETB {it.unitPrice.toFixed(2)} {effectiveQty}/{it.qty}</div>
                        {it.note?.trim() ? <div className="text-xs text-[#c9b792]">Note: {it.note.trim()}</div> : null}
                        {voidedQty > 0 ? (
                          <div className="mt-1 inline-flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-900/20 text-red-300 border border-red-900/40">VOIDED {voidedQty}</span>
                            {it.voidReason ? (
                              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-[#3a2e22] text-[#c9b792] border border-[#483c23]">{it.voidReason}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className={`font-bold ${lineVoided ? 'text-[#c9b792]' : 'text-white'}`}>ETB {(it.unitPrice * effectiveQty).toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>

              {isVoided && order.voidReason ? (
                <div className="px-6 py-4 border-t border-[#483c23] bg-red-900/10">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-red-400 text-[20px]">block</span>
                    <div className="flex flex-col">
                      <div className="text-sm font-bold text-red-300">Void Reason</div>
                      <div className="text-sm text-[#c9b792]">{order.voidReason}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="xl:col-span-1 flex flex-col gap-6">
            <div className="relative bg-[#2c241b] rounded-xl border border-[#483c23] overflow-hidden shadow-sm flex flex-col">
              {isVoided ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-[44px] md:text-[64px] font-black tracking-[0.25em] text-red-500/10 rotate-[-18deg]">VOIDED</div>
                </div>
              ) : null}
              <div className="p-5 flex flex-col gap-3 border-b border-[#483c23]/50">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[#c9b792]">Subtotal</span>
                  <span className="text-white font-medium">ETB {order.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[#c9b792]">Tax (15%)</span>
                  <span className="text-white font-medium">ETB {order.tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[#c9b792]">Service (5%)</span>
                  <span className="text-white font-medium">ETB {order.serviceCharge.toFixed(2)}</span>
                </div>
                {Number((order as any).tip ?? 0) > 0 ? (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#c9b792]">Tip</span>
                    <span className="text-white font-medium">ETB {Number((order as any).tip ?? 0).toFixed(2)}</span>
                  </div>
                ) : null}
              </div>
              <div className="p-5 bg-[#3a2e22]/30">
                <div className="flex justify-between items-end">
                  <span className="text-[#c9b792] font-medium pb-1">Grand Total</span>
                  <span className={`text-3xl font-black ${isVoided ? 'text-red-300' : 'text-[#eead2b]'}`}>ETB {order.total.toFixed(2)}</span>
                </div>
              </div>
              <div className="p-5 border-t border-[#483c23] text-xs text-[#c9b792] space-y-1">
                <div><span className="font-bold">Placed by:</span> {order.createdByName ?? (order.createdByStaffId ?? ' ')}</div>
                {order.notes ? <div><span className="font-bold">Notes:</span> {order.notes}</div> : null}
                {order.paidAt ? <div><span className="font-bold">Paid:</span> {new Date(order.paidAt).toLocaleString()}</div> : null}
                {order.paymentMethod ? <div><span className="font-bold">Method:</span> {order.paymentMethod}</div> : null}
                {order.voidedAt ? <div className="text-red-300"><span className="font-bold">Voided:</span> {new Date(order.voidedAt).toLocaleString()}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={voidOpen}
        title="Void Order"
        onClose={() => {
          setVoidOpen(false);
          setVoidReason('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setVoidOpen(false);
                setVoidReason('');
              }}
              className="h-11 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] border border-[#544b3b] text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              disabled={!voidReason.trim()}
              onClick={() => {
                if (!order) return;
                const r = voidReason.trim();
                if (!r) return;
                voidOrder(order.id, r);
                setVoidOpen(false);
                setVoidReason('');
              }}
              className="h-11 px-4 rounded-lg bg-red-500/15 hover:bg-red-500/20 border border-red-500/25 text-red-200 font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Void Order
            </button>
          </div>
        }
      >
        <div className="text-sm text-[#c9b792]">Enter a reason. This will be saved and shown in reports.</div>
        <div className="mt-4">
          <label className="text-xs font-bold text-[#c9b792]">Reason</label>
          <input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="e.g. CUSTOMER CANCELED"
            className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-red-400/50 focus:border-red-400/50"
          />
        </div>
      </Modal>

      <Modal
        open={refundOpen}
        title="Refund Order"
        onClose={() => {
          if (refundSaving) return;
          setRefundOpen(false);
          setRefundErr('');
          setRefundReason('');
          setRefundPin('');
          setRefundAmount('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (refundSaving) return;
                setRefundOpen(false);
                setRefundErr('');
                setRefundReason('');
                setRefundPin('');
                setRefundAmount('');
              }}
              className="h-11 px-4 rounded-lg bg-[#393328] hover:bg-[#4a4234] border border-[#544b3b] text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              disabled={refundSaving || !refundReason.trim() || !(Number(refundAmount) > 0)}
              onClick={async () => {
                if (!order) return;
                if (refundSaving) return;
                setRefundErr('');

                const amt = Number(refundAmount);
                if (!(amt > 0)) {
                  setRefundErr('Enter a valid refund amount.');
                  return;
                }
                const rsn = refundReason.trim();
                if (!rsn) {
                  setRefundErr('Reason is required.');
                  return;
                }
                if (!refundApproveAsId) {
                  setRefundErr('Select who approves this refund.');
                  return;
                }

                setRefundSaving(true);
                try {
                  const res = await apiFetch(`/api/pos/orders/${encodeURIComponent(order.id)}/refund`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      amount: amt,
                      reason: rsn,
                      pin: refundPin.trim() || undefined,
                      approveAsStaffId: refundApproveAsId,
                    }),
                  });
                  const json = (await res.json().catch(() => null)) as any;
                  if (!res.ok) {
                    const err = String(json?.error || json?.message || 'refund_failed');
                    if (err === 'pin_required') {
                      setRefundErr('Manager PIN required. Enter a Branch Manager or Cafe Owner PIN.');
                    } else if (err === 'approver_required') {
                      setRefundErr('Select who approves this refund.');
                    } else if (err === 'only_paid_orders_can_refund') {
                      setRefundErr('Only paid orders can be refunded.');
                    } else {
                      setRefundErr('Failed to refund order.');
                    }
                    return;
                  }

                  setRefundOpen(false);
                  setRefundErr('');
                  setRefundReason('');
                  setRefundPin('');
                  setRefundAmount('');
                  await refreshFromServer();
                } catch {
                  setRefundErr('Failed to refund order.');
                } finally {
                  setRefundSaving(false);
                }
              }}
              className="h-11 px-4 rounded-lg bg-purple-500/20 hover:bg-purple-500/25 border border-purple-500/30 text-purple-100 font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refundSaving ? 'Refunding...' : 'Refund'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-[#c9b792]">Enter amount and reason. Refunds require manager approval and will be saved in reports and finance ledger.</div>

        {refundErr ? <div className="mt-3 text-sm text-red-300">{refundErr}</div> : null}

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-bold text-[#c9b792]">Approve as</label>
            <select
              value={refundApproveAsId}
              onChange={(e) => setRefundApproveAsId(e.target.value)}
              className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-purple-400/50 focus:border-purple-400/50"
            >
              <option value="">Select approver</option>
              {refundApprovers.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.roleName})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[#c9b792]">Amount (ETB)</label>
            <input
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              inputMode="decimal"
              placeholder=""
              className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-purple-400/50 focus:border-purple-400/50"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#c9b792]">Reason</label>
            <input
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. CUSTOMER RETURN"
              className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-purple-400/50 focus:border-purple-400/50"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#c9b792]">PIN (if required)</label>
            <input
              value={refundPin}
              onChange={(e) => setRefundPin(e.target.value)}
              placeholder="Enter PIN"
              className="mt-2 w-full h-11 bg-[#221c10] border border-[#483c23] rounded-lg px-4 text-white focus:ring-1 focus:ring-purple-400/50 focus:border-purple-400/50"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
