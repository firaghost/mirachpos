import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { usePos } from '../../PosContext';
import { readSession } from '../../session';

type DraftRec = {
  draft_id: string;
  tenant_id: string;
  branch_id: string;
  created_by_staff_id?: string;
  status?: string;
  notes?: string;
  summary?: { items?: number; total?: number };
  items?: Array<{ product_id?: string; name?: string; image?: string; unit_price?: number; qty?: number; note?: string }>;
  submitted_at_local?: string;
  updated_at_server?: string;
  order_id?: string;
  table_id?: string;
  rejected_reason?: string;
};

type SessionInfo = {
  token?: string;
  tenantId?: string;
  branchId?: string;
  staffId?: string;
};

const uid = () => `evt_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

export const DraftInbox: React.FC = () => {
  const { importDraftToKitchenOrder } = usePos();
  const session = useMemo(() => (readSession<SessionInfo>() || {}), []);
  const branchId = typeof session.branchId === 'string' && session.branchId ? session.branchId : 'global';
  const tenantId = typeof session.tenantId === 'string' ? session.tenantId : '';

  const [status, setStatus] = useState<'SUBMITTED' | 'ACCEPTED' | 'REJECTED'>('SUBMITTED');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftRec[]>([]);

  const [rejectTarget, setRejectTarget] = useState<DraftRec | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await apiFetch(`/api/sync/drafts/inbox?branchId=${encodeURIComponent(branchId)}&status=${encodeURIComponent(status)}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const items = Array.isArray(json?.drafts) ? (json.drafts as DraftRec[]) : [];
      setDrafts(items);
    } catch (e) {
      setErr(e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const push = async (events: any[]) => {
    const res = await apiFetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    if (Array.isArray(json?.rejected) && json.rejected.length) {
      throw new Error(json.rejected?.[0]?.reason || 'rejected');
    }
    return json;
  };

  const accept = async (d: DraftRec) => {
    setErr('');
    try {
      const draftId = String(d.draft_id || '');
      if (!draftId) throw new Error('invalid_draft');
      if (!tenantId) throw new Error('missing_tenant');

      const draftItems = Array.isArray(d.items) ? d.items : [];
      if (draftItems.length === 0) throw new Error('draft_has_no_items');

      const localOrderId = importDraftToKitchenOrder({
        draftId,
        createdByStaffId: typeof d.created_by_staff_id === 'string' ? d.created_by_staff_id : undefined,
        notes: typeof d.notes === 'string' ? d.notes : undefined,
        tableId: typeof d.table_id === 'string' ? d.table_id : undefined,
        items: draftItems
          .map((it) => ({
            productId: String(it.product_id || ''),
            name: String(it.name || ''),
            unitPrice: Number(it.unit_price ?? 0),
            qty: Number(it.qty ?? 0),
            note: typeof it.note === 'string' ? it.note : undefined,
          }))
          .filter((it) => it.productId && it.name && Number.isFinite(it.unitPrice) && Number.isFinite(it.qty) && it.qty > 0),
      });

      if (!localOrderId) throw new Error('failed_to_create_local_order');

      await push([
        {
          event_id: uid(),
          tenant_id: tenantId,
          branch_id: branchId,
          device_id: 'desktop_ui',
          client_type: 'desktop',
          aggregate_type: 'order',
          aggregate_id: draftId,
          event_type: 'order.accepted',
          created_at_local: new Date().toISOString(),
          payload: {
            draft_id: draftId,
            order_id: localOrderId,
            table_id: typeof d.table_id === 'string' ? d.table_id : '',
            accepted_by_staff_id: typeof session.staffId === 'string' ? session.staffId : '',
          },
        },
      ]);

      await load();
    } catch (e) {
      setErr(e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Failed to accept');
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    setErr('');
    try {
      const orderId = String(rejectTarget.draft_id || '');
      if (!orderId) throw new Error('invalid_draft');
      if (!tenantId) throw new Error('missing_tenant');

      await push([
        {
          event_id: uid(),
          tenant_id: tenantId,
          branch_id: branchId,
          device_id: 'desktop_ui',
          client_type: 'desktop',
          aggregate_type: 'order',
          aggregate_id: orderId,
          event_type: 'order.rejected',
          created_at_local: new Date().toISOString(),
          payload: {
            draft_id: orderId,
            reason: rejectReason || '',
          },
        },
      ]);

      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (e) {
      setErr(e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Failed to reject');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="px-6 py-5 border-b border-border bg-card flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <div className="text-2xl font-black tracking-tight">Draft Inbox</div>
          <div className="text-xs text-muted-foreground font-semibold">Branch: {branchId}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="h-10 px-3 rounded-lg bg-background border border-border text-foreground"
          >
            <option value="SUBMITTED">Submitted</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button
            onClick={load}
            className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border font-bold"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="px-6 py-4">
        {err ? <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">{err}</div> : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading ¦</div>
        ) : drafts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No drafts.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {drafts.map((d) => (
              <div key={d.draft_id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <div className="text-lg font-black">{d.draft_id}</div>
                    <div className="text-xs text-muted-foreground font-semibold">Created by: {d.created_by_staff_id || ' ”'}</div>
                    {d.submitted_at_local ? <div className="text-xs text-muted-foreground">Submitted: {d.submitted_at_local}</div> : null}
                    <div className="text-xs text-muted-foreground">Updated: {d.updated_at_server || ' ”'}</div>
                  </div>
                  <div className="px-2 py-1 rounded text-xs font-bold uppercase tracking-wider bg-background border border-border text-muted-foreground">
                    {String(d.status || '') || ' ”'}
                  </div>
                </div>

                {d.notes ? (
                  <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
                    <div className="text-[11px] font-bold text-muted-foreground">Notes</div>
                    <div className="text-sm text-foreground whitespace-pre-wrap break-words">{d.notes}</div>
                  </div>
                ) : null}

                {typeof d.summary === 'object' ? (
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <div className="text-muted-foreground font-semibold">Items: {Number(d.summary?.items ?? 0)}</div>
                    <div className="text-foreground font-black">ETB {Number(d.summary?.total ?? 0).toFixed(2)}</div>
                  </div>
                ) : null}

                <div className="mt-3 flex items-center justify-end gap-2">
                  {status === 'SUBMITTED' ? (
                    <>
                      <button
                        onClick={() => setRejectTarget(d)}
                        className="h-9 px-3 rounded-lg bg-transparent border border-destructive/50 text-destructive hover:bg-destructive/10 font-bold"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => accept(d)}
                        className="h-9 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-black"
                      >
                        Accept & Print
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {rejectTarget ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-full max-w-lg rounded-xl bg-card border border-border p-5">
            <div className="text-lg font-black">Reject Draft</div>
            <div className="text-xs text-muted-foreground mt-1">{rejectTarget.draft_id}</div>
            <div className="mt-4">
              <label className="block text-xs font-bold text-muted-foreground mb-2">Reason (optional)</label>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-background border border-border text-foreground"
                placeholder="e.g. Missing items / unclear table"
              />
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="h-10 px-4 rounded-lg bg-transparent border border-border text-muted-foreground hover:text-foreground font-bold"
              >
                Cancel
              </button>
              <button
                onClick={submitReject}
                className="h-10 px-4 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
