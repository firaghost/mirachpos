import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { readSession } from '../../session';

type SessionInfo = {
  tenantId?: string;
  branchId?: string;
  staffId?: string;
};

type LocalDraft = {
  id: string;
  createdAtLocal: string;
  note: string;
  items: Array<{ productId: string; name: string; unitPrice: number; qty: number; image?: string }>;
  status: 'LOCAL' | 'SYNCED' | 'FAILED';
  lastError?: string;
};

const DRAFTS_KEY = 'mirachpos.mobileDrafts.v1';

const uid = (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

const loadLocalDrafts = (): LocalDraft[] => {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : [];
    return Array.isArray(parsed) ? (parsed as LocalDraft[]) : [];
  } catch {
    return [];
  }
};

const saveLocalDrafts = (drafts: LocalDraft[]) => {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // ignore
  }
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterDraftSim: React.FC<Props> = ({ onNavigate }) => {
  const { products } = usePos();
  const session = useMemo(() => (readSession<SessionInfo>() || {}), []);
  const tenantId = typeof session.tenantId === 'string' ? session.tenantId : '';
  const branchId = typeof session.branchId === 'string' && session.branchId ? session.branchId : 'global';
  const staffId = typeof session.staffId === 'string' ? session.staffId : '';

  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [drafts, setDrafts] = useState<LocalDraft[]>(() => loadLocalDrafts());
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Record<string, { qty: number }>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<null | { kind: 'success' | 'error'; message: string }>(null);

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

  useEffect(() => {
    saveLocalDrafts(drafts);
  }, [drafts]);

  const mkEvt = (draftId: string, eventType: string, createdAtLocal: string, payload: any) => ({
    event_id: uid('evt'),
    tenant_id: tenantId,
    branch_id: branchId,
    device_id: 'mobile_sim',
    client_type: 'mobile',
    aggregate_type: 'order',
    aggregate_id: draftId,
    event_type: eventType,
    created_at_local: createdAtLocal,
    payload: { draft_id: draftId, ...(payload || {}) },
  });

  const createLocalDraft = () => {
    setBanner(null);
    if (!tenantId) {
      setBanner({ kind: 'error', message: 'Missing tenantId in session. Please log out and log back in.' });
      return;
    }

    const itemList = (Object.entries(items) as Array<[string, { qty: number }]>)
      .map(([productId, v]) => {
        const p = products.find((x) => x.id === productId);
        if (!p) return null;
        const qty = Number(v?.qty ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) return null;
        return { productId, name: p.name, unitPrice: Number(p.price ?? 0), qty, image: p.image };
      })
      .filter(Boolean) as LocalDraft['items'];

    if (itemList.length === 0) {
      setBanner({ kind: 'error', message: 'Add at least one item before saving the draft.' });
      return;
    }

    const d: LocalDraft = {
      id: uid('draft'),
      createdAtLocal: new Date().toISOString(),
      note: note.trim(),
      items: itemList,
      status: 'LOCAL',
    };
    setDrafts((prev) => [d, ...prev]);
    setNote('');
    setItems({});
    setQuery('');
    setBanner({ kind: 'success', message: 'Draft saved locally. You can sync when online.' });
  };

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

  const syncOne = async (d: LocalDraft) => {
    if (!tenantId) throw new Error('missing_tenant');

    const createdAt = d.createdAtLocal;
    const events: any[] = [mkEvt(d.id, 'order.draft_created', createdAt, { created_by_staff_id: staffId })];
    if (d.note && d.note.trim()) events.push(mkEvt(d.id, 'order.draft_notes_set', createdAt, { notes: d.note.trim() }));
    for (const it of Array.isArray(d.items) ? d.items : []) {
      const qty = Number(it?.qty ?? 0);
      if (!it?.productId || !Number.isFinite(qty) || qty <= 0) continue;
      events.push(
        mkEvt(d.id, 'order.draft_item_upserted', createdAt, {
          product_id: it.productId,
          name: it.name,
          image: typeof it.image === 'string' ? it.image : '',
          unit_price: Number(it.unitPrice ?? 0),
          qty,
        }),
      );
    }
    events.push(mkEvt(d.id, 'order.draft_submitted', new Date().toISOString(), { submitted_at_local: new Date().toISOString() }));
    await push(events);
  };

  const syncAll = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      if (!isOnline) throw new Error('offline');

      const pending = drafts.filter((d) => d.status !== 'SYNCED');
      if (pending.length === 0) {
        setBanner({ kind: 'success', message: 'No pending drafts to sync.' });
        setBusy(false);
        return;
      }

      const next = [...drafts];
      for (let i = 0; i < next.length; i++) {
        const d = next[i];
        if (d.status === 'SYNCED') continue;
        try {
          await syncOne(d);
          next[i] = { ...d, status: 'SYNCED', lastError: '' };
        } catch (e) {
          const msg = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'sync_failed';
          next[i] = { ...d, status: 'FAILED', lastError: msg };
        }
      }

      setDrafts(next);
      setBanner({ kind: 'success', message: 'Sync complete. Check Desktop Draft Inbox.' });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'sync_failed';
      setBanner({ kind: 'error', message: msg === 'offline' ? 'You are offline. Connect to internet and try again.' : msg });
    } finally {
      setBusy(false);
    }
  };

  const clearSynced = () => {
    setDrafts((prev) => prev.filter((d) => d.status !== 'SYNCED'));
    setBanner({ kind: 'success', message: 'Cleared synced drafts from local list.' });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#211911] text-white">
      <header className="flex items-center justify-between border-b border-[#3d3226] px-6 py-4 bg-[#2c241b]">
        <div className="flex flex-col">
          <div className="text-white text-lg font-bold leading-tight">Simulate Mobile Draft</div>
          <div className="text-[#c8ad93] text-xs">Network: {isOnline ? 'Online' : 'Offline'}    Branch: {branchId}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}
            className="h-9 px-4 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 text-sm font-semibold"
          >
            Back
          </button>
          <button
            disabled={busy}
            onClick={syncAll}
            className="h-9 px-4 rounded-lg bg-[#cf7317] hover:bg-[#e08428] text-white text-sm font-extrabold disabled:opacity-60"
          >
            {busy ? 'Syncing ¦' : 'Sync Now'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl flex flex-col gap-5">
          {banner ? (
            <div
              className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
                banner.kind === 'success' ? 'border-emerald-500/20 bg-emerald-900/10 text-emerald-200' : 'border-red-500/20 bg-red-900/10 text-red-200'
              }`}
            >
              <div className="text-sm font-medium">{banner.message}</div>
              <button onClick={() => setBanner(null)} className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 text-white">
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="rounded-xl border border-[#3d3226] bg-[#2c241b] p-5">
            <div className="text-sm font-bold">Create draft (offline-safe)</div>
            <div className="text-xs text-[#c8ad93] mt-1">This simulates mobile draft creation. It does not create a normal POS order.</div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 rounded-lg bg-[#211911] border border-[#3d3226] px-4 text-sm text-white"
                placeholder="Search products to add..."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(products || [])
                  .filter((p) => {
                    const q = query.trim().toLowerCase();
                    if (!q) return true;
                    return String(p.name || '').toLowerCase().includes(q);
                  })
                  .slice(0, 12)
                  .map((p) => {
                    const qty = Number(items[p.id]?.qty ?? 0);
                    return (
                      <div key={p.id} className="rounded-lg border border-[#3d3226] bg-[#211911] p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold truncate">{p.name}</div>
                          <div className="text-xs text-[#c8ad93]">ETB {Number(p.price ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              setItems((prev) => {
                                const cur = Number(prev[p.id]?.qty ?? 0);
                                const nextQty = Math.max(0, cur - 1);
                                const next = { ...prev };
                                if (nextQty <= 0) delete next[p.id];
                                else next[p.id] = { qty: nextQty };
                                return next;
                              })
                            }
                            className="w-9 h-9 rounded-lg bg-transparent border border-[#3d3226] text-[#c8ad93] hover:text-white"
                          >
                            -
                          </button>
                          <div className="w-10 text-center text-sm font-bold">{qty}</div>
                          <button
                            onClick={() =>
                              setItems((prev) => {
                                const cur = Number(prev[p.id]?.qty ?? 0);
                                const nextQty = cur + 1;
                                return { ...prev, [p.id]: { qty: nextQty } };
                              })
                            }
                            className="w-9 h-9 rounded-lg bg-[#eead2b] text-[#221c11] font-extrabold hover:bg-[#d49619]"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[90px] rounded-lg bg-[#211911] border border-[#3d3226] px-4 py-3 text-sm text-white"
                placeholder="Optional note (e.g. table, customer, extra instructions)"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[#c8ad93]">Tenant: {tenantId || '  '}    Staff: {staffId || '  '}</div>
                <button
                  onClick={createLocalDraft}
                  className="h-10 px-5 rounded-lg bg-[#eead2b] text-[#221c11] hover:bg-[#d49619] font-extrabold"
                >
                  Save Draft Locally
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#3d3226] bg-[#2c241b] overflow-hidden">
            <div className="p-5 border-b border-[#3d3226] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">Local drafts</div>
                <div className="text-xs text-[#c8ad93]">Unsynced drafts will appear here until you sync them.</div>
              </div>
              <button
                onClick={clearSynced}
                className="h-9 px-3 rounded-lg bg-[#211911] border border-[#3d3226] text-[#c8ad93] hover:text-white hover:border-[#cf7317]/30 text-xs font-bold"
              >
                Clear Synced
              </button>
            </div>

            {drafts.length === 0 ? (
              <div className="p-6 text-sm text-[#c8ad93]">No local drafts yet.</div>
            ) : (
              <div className="divide-y divide-[#3d3226]">
                {drafts.map((d) => (
                  <div key={d.id} className="p-5 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-white font-bold truncate">{d.id}</div>
                      <div className="text-xs text-[#c8ad93] mt-1">Created: {d.createdAtLocal}</div>
                      {d.note ? <div className="text-xs text-[#c8ad93] mt-2 whitespace-pre-wrap">Note: {d.note}</div> : null}
                      {d.status === 'FAILED' && d.lastError ? (
                        <div className="text-xs text-red-200 mt-2">Last error: {d.lastError}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      <div
                        className={`px-3 py-1 rounded-full text-xs font-bold border ${
                          d.status === 'SYNCED'
                            ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20'
                            : d.status === 'FAILED'
                              ? 'bg-red-500/10 text-red-200 border-red-500/20'
                              : 'bg-white/10 text-[#c8ad93] border-white/10'
                        }`}
                      >
                        {d.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
