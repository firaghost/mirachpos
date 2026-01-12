import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';

type Branch = { id: string; name: string; status: string };
type Item = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  minQty: number;
  cost: number;
  globalQty: number;
  globalValue: number;
  status: 'In Stock' | 'Low' | 'Critical';
  byBranch: Record<string, number>;
};

type Api = {
  kpis: { totalSkus: number; totalValue: number; lowStockCount: number; criticalCount: number };
  categories: string[];
  branches: Branch[];
  items: Item[];
  meta: { generatedAt: string };
};

const csvEscape = (v: unknown) => {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
};

export const OwnerInventory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Api | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [branchId, setBranchId] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'low' | 'critical' | 'in_stock'>('all');

  const [modal, setModal] = useState<null | 'po' | 'transfer' | 'count' | 'row'>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const [poBranchId, setPoBranchId] = useState('');
  const [poSku, setPoSku] = useState('');
  const [poQty, setPoQty] = useState('');
  const [poNotes, setPoNotes] = useState('');

  const [trFromBranchId, setTrFromBranchId] = useState('');
  const [trToBranchId, setTrToBranchId] = useState('');
  const [trSku, setTrSku] = useState('');
  const [trQty, setTrQty] = useState('');

  const [countBranchId, setCountBranchId] = useState('');
  const [countScope, setCountScope] = useState<'full' | 'category' | 'sku'>('full');
  const [countSku, setCountSku] = useState('');

  const money = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'ETB',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const fmtUpdated = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [],
  );

  const fetchInv = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBanner(null);
    try {
      const qs = new URLSearchParams();
      if (branchId) qs.set('branchId', branchId);
      if (category) qs.set('category', category);
      if (q.trim()) qs.set('q', q.trim());
      const url = qs.toString() ? `/api/owner/inventory?${qs.toString()}` : '/api/owner/inventory';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Api);
    } catch {
      setError('Start the API server (npm run dev:api).');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, category, q]);

  useEffect(() => {
    fetchInv();
  }, [fetchInv]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const branches = data?.branches || [];
  const categories = data?.categories || [];
  const kpis = data?.kpis || { totalSkus: 0, totalValue: 0, lowStockCount: 0, criticalCount: 0 };

  const scopeLabel = useMemo(() => {
    if (!branchId) return 'All Branches';
    return branches.find((b) => b.id === branchId)?.name || branchId;
  }, [branchId, branches]);

  const rows = useMemo(() => {
    const items = data?.items || [];
    if (status === 'all') return items;
    if (status === 'critical') return items.filter((x) => x.status === 'Critical');
    if (status === 'low') return items.filter((x) => x.status === 'Low');
    return items.filter((x) => x.status === 'In Stock');
  }, [data?.items, status]);

  const categoryBars = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of rows) map.set(it.category, (map.get(it.category) || 0) + (Number(it.globalValue) || 0));
    const list = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
    const max = list.reduce((m, r) => Math.max(m, r.value), 0) || 1;
    return list.map((x) => ({ ...x, pct: Math.max(0.08, x.value / max) }));
  }, [rows]);

  const topItem = rows[0]?.name || '—';

  const alerts = useMemo(() => {
    const items = (data?.items || []).filter((x) => x.status !== 'In Stock').slice(0, 3);
    return items.map((it) => {
      const worst = branches
        .map((b) => ({ b, qty: it.byBranch?.[b.id] ?? 0 }))
        .sort((a, b) => a.qty - b.qty)[0];
      return {
        id: it.sku,
        title: `${it.status === 'Critical' ? 'Critical' : 'Low Stock'}: ${it.name}`,
        detail: worst ? `${worst.b.name} has ${worst.qty} ${it.unit}` : 'Branch detail unavailable',
        kind: it.status,
      };
    });
  }, [data?.items, branches]);

  const exportCsv = () => {
    if (!data) return;
    const generatedAt = new Date().toISOString();
    const lines: string[] = [];
    lines.push('Global Inventory Oversight');
    lines.push('');
    lines.push(['GeneratedAt', generatedAt].map(csvEscape).join(','));
    lines.push(['Branch', scopeLabel].map(csvEscape).join(','));
    lines.push(['Category', category || 'All'].map(csvEscape).join(','));
    lines.push(['Status', status].map(csvEscape).join(','));
    lines.push(['Query', q.trim() || ''].map(csvEscape).join(','));
    lines.push('');
    lines.push('KPIs');
    lines.push(['TotalSkus', 'TotalValue', 'LowStockCount', 'CriticalCount'].map(csvEscape).join(','));
    lines.push([kpis.totalSkus, kpis.totalValue, kpis.lowStockCount, kpis.criticalCount].map(csvEscape).join(','));
    lines.push('');
    const branchCols = branches.map((b) => b.name);
    lines.push('Global Master Inventory');
    lines.push(['SKU', 'Item', 'Category', 'Status', 'GlobalQty', 'Unit', 'AvgCost', 'GlobalValue', ...branchCols].map(csvEscape).join(','));
    for (const it of rows) {
      const perBranch = branches.map((b) => it.byBranch?.[b.id] ?? 0);
      lines.push([it.sku, it.name, it.category, it.status, it.globalQty, it.unit, it.cost, it.globalValue, ...perBranch].map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `global-inventory-${branchId || 'all'}-${generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBanner({ kind: 'success', message: 'Export downloaded.' });
  };

  const postBranchEvent = useCallback(async (branchId: string, type: string, payload: Record<string, unknown>) => {
    const res = await apiFetch(`/api/branches/${encodeURIComponent(branchId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  const resetModalState = () => {
    setModalLoading(false);
    setActiveItem(null);
    setPoBranchId('');
    setPoSku('');
    setPoQty('');
    setPoNotes('');
    setTrFromBranchId('');
    setTrToBranchId('');
    setTrSku('');
    setTrQty('');
    setCountBranchId('');
    setCountScope('full');
    setCountSku('');
  };

  const closeModal = () => {
    setModal(null);
    resetModalState();
  };

  const openPo = (prefill?: { sku?: string; branchId?: string }) => {
    setBanner(null);
    setModalLoading(false);
    setActiveItem(null);
    setModal('po');
    setPoSku(prefill?.sku || '');
    setPoBranchId(prefill?.branchId || branchId || '');
    setPoQty('');
    setPoNotes('');
  };

  const openTransfer = (prefill?: { sku?: string }) => {
    setBanner(null);
    setModalLoading(false);
    setActiveItem(null);
    setModal('transfer');
    setTrSku(prefill?.sku || '');
    setTrFromBranchId(branchId || '');
    setTrToBranchId('');
    setTrQty('');
  };

  const openCount = () => {
    setBanner(null);
    setModalLoading(false);
    setActiveItem(null);
    setModal('count');
    setCountBranchId(branchId || '');
    setCountScope('full');
    setCountSku('');
  };

  const openRowActions = (it: Item) => {
    setBanner(null);
    setActiveItem(it);
    setModal('row');
  };

  const submitPo = async () => {
    if (modalLoading) return;
    const bid = poBranchId.trim();
    if (!bid) {
      setBanner({ kind: 'error', message: 'Select a branch for the PO.' });
      return;
    }
    const sku = poSku.trim();
    if (!sku) {
      setBanner({ kind: 'error', message: 'Enter SKU.' });
      return;
    }
    const qty = Number(poQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setBanner({ kind: 'error', message: 'Enter a valid quantity.' });
      return;
    }
    setModalLoading(true);
    try {
      await postBranchEvent(bid, 'po_created', { sku, qty, notes: poNotes.trim() });
      setBanner({ kind: 'success', message: `PO created for ${sku} (${qty}).` });
      closeModal();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create PO.' });
      setModalLoading(false);
    }
  };

  const submitTransfer = async () => {
    if (modalLoading) return;
    const from = trFromBranchId.trim();
    const to = trToBranchId.trim();
    if (!from || !to || from === to) {
      setBanner({ kind: 'error', message: 'Select different From/To branches.' });
      return;
    }
    const sku = trSku.trim();
    if (!sku) {
      setBanner({ kind: 'error', message: 'Enter SKU.' });
      return;
    }
    const qty = Number(trQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setBanner({ kind: 'error', message: 'Enter a valid quantity.' });
      return;
    }
    setModalLoading(true);
    try {
      await postBranchEvent(from, 'transfer_requested', { toBranchId: to, sku, qty });
      setBanner({ kind: 'success', message: `Transfer requested: ${sku} (${qty}).` });
      closeModal();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to request transfer.' });
      setModalLoading(false);
    }
  };

  const submitCount = async () => {
    if (modalLoading) return;
    const bid = countBranchId.trim();
    if (!bid) {
      setBanner({ kind: 'error', message: 'Select a branch for the count.' });
      return;
    }
    const sku = countSku.trim();
    if (countScope === 'sku' && !sku) {
      setBanner({ kind: 'error', message: 'Enter SKU to count.' });
      return;
    }
    setModalLoading(true);
    try {
      await postBranchEvent(bid, 'inventory_count', { scope: countScope, category: category || '', sku });
      setBanner({ kind: 'success', message: 'Inventory count logged.' });
      closeModal();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to log count.' });
      setModalLoading(false);
    }
  };

  const distColors = ['bg-primary', 'bg-white-500', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-teal-500'];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
      <OwnerPageHeader
        title="Global Inventory"
        rightSlot={
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[#393328] rounded-lg h-10 w-40 sm:w-56 md:w-72 px-3 gap-2">
              <span className="material-symbols-outlined text-[#b9b09d]" style={{ fontSize: 20 }}>search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="bg-transparent border-none text-sm text-white placeholder-[#b9b09d] focus:ring-0 w-full p-0"
                placeholder="Search SKU, item"
                type="text"
              />
            </div>
            <button
              onClick={fetchInv}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={exportCsv}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 bg-[#393328] text-white rounded-lg text-sm font-bold hover:bg-[#393328]/80 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={() => openPo()}
              className="flex items-center justify-center gap-2 h-10 px-4 bg-[#eead2b] text-[#181611] rounded-lg text-sm font-bold hover:bg-[#d99a20] transition-colors shadow-[0_0_15px_rgba(238,173,43,0.3)]"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
              <span className="hidden sm:inline">Create PO</span>
            </button>
          </div>
        }
      />
      {banner ? (
        <div
          className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
            banner.kind === 'success'
              ? 'border-green-500/20 bg-green-900/10 text-green-200'
              : 'border-red-500/20 bg-red-900/10 text-red-200'
          }`}
        >
          <div className="text-sm font-medium">{banner.message}</div>
          <button onClick={() => setBanner(null)} className="h-9 px-3 rounded-lg bg-[#2c241e] border border-[#3a3028] text-white hover:border-primary/50">
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-900/10 text-red-200 p-4 flex items-center justify-between gap-4">
          <div className="text-sm">{error}</div>
          <button onClick={fetchInv} className="h-10 px-4 rounded-lg bg-[#2c241e] border border-[#3a3028] text-white hover:border-primary/50">
            Retry
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-6 lg:p-10">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">

          <div className="flex flex-wrap gap-3 items-center pb-2">
            <div className="flex items-center gap-2 bg-[#2c241e] px-3 py-1.5 rounded-lg border border-[#3a3028] text-[#b9b09d] text-sm hover:border-primary/50 transition-colors">
              <span className="material-symbols-outlined text-[18px]">store</span>
              <span>Region: <strong className="text-white">{scopeLabel}</strong></span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-7 bg-transparent text-sm text-[#b9b09d] focus:ring-0 border-none">
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-[#2c241e] px-3 py-1.5 rounded-lg border border-[#3a3028] text-[#b9b09d] text-sm hover:border-primary/50 transition-colors">
              <span className="material-symbols-outlined text-[18px]">category</span>
              <span>Category: <strong className="text-white">{category || 'All'}</strong></span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-7 bg-transparent text-sm text-[#b9b09d] focus:ring-0 border-none">
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="ml-auto text-xs text-primary font-bold">
              {loading ? 'Loading...' : data?.meta?.generatedAt ? `Updated: ${fmtUpdated.format(new Date(data.meta.generatedAt))}` : ''}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-[#2c241e] rounded-xl p-5 border border-[#3a3028] relative overflow-hidden">
              <p className="text-[#b9b09d] text-sm font-medium mb-1">Total Stock Value</p>
              <h3 className="text-2xl font-bold text-white mb-2">{money.format(kpis.totalValue)}</h3>
              <div className="text-[#5ba968] text-xs font-bold bg-[#5ba968]/10 w-fit px-2 py-1 rounded">{kpis.totalSkus} SKUs tracked</div>
            </div>
            <div className="bg-[#2c241e] rounded-xl p-5 border border-[#3a3028] relative overflow-hidden">
              <p className="text-[#b9b09d] text-sm font-medium mb-1">Critical Low Stock</p>
              <h3 className="text-2xl font-bold text-white mb-2">{kpis.criticalCount} Items</h3>
              <div className="text-[#e55d5d] text-xs font-bold bg-[#e55d5d]/10 w-fit px-2 py-1 rounded">Action Required</div>
            </div>
            <div className="bg-[#2c241e] rounded-xl p-5 border border-[#3a3028] relative overflow-hidden">
              <p className="text-[#b9b09d] text-sm font-medium mb-1">Low Stock</p>
              <h3 className="text-2xl font-bold text-white mb-2">{kpis.lowStockCount} Items</h3>
              <div className="text-orange-400 text-xs font-bold bg-orange-400/10 w-fit px-2 py-1 rounded">Below minimum</div>
            </div>
            <div className="bg-[#2c241e] rounded-xl p-5 border border-[#3a3028] relative overflow-hidden">
              <p className="text-[#b9b09d] text-sm font-medium mb-1">Top Value Item</p>
              <h3 className="text-2xl font-bold text-white mb-2 truncate" title={topItem}>{topItem}</h3>
              <div className="text-[#b9b09d] text-xs font-bold bg-white/5 w-fit px-2 py-1 rounded">By valuation</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 bg-[#2c241e] rounded-xl border border-[#3a3028] p-6 flex flex-col min-h-[320px]">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-white text-lg font-bold">Stock Consumption Rate</h3>
                  <p className="text-[#b9b09d] text-sm">Category weighting (proxy by valuation)</p>
                </div>
              </div>
              <div className="flex-1 flex items-end justify-between gap-4 px-2 relative pt-8">
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6 z-0">
                  <div className="w-full h-px bg-[#3a3028]/30"></div>
                  <div className="w-full h-px bg-[#3a3028]/30"></div>
                  <div className="w-full h-px bg-[#3a3028]/30"></div>
                  <div className="w-full h-px bg-[#3a3028]/30"></div>
                  <div className="w-full h-px bg-[#3a3028]/30"></div>
                </div>
                {categoryBars.map((c) => (
                  <div key={c.name} className="flex flex-col items-center gap-2 z-10 w-full group">
                    <div className="relative w-full max-w-[40px] h-56 bg-[#3a3028] rounded-t-sm overflow-hidden flex items-end">
                      <div className="w-full bg-primary/80 group-hover:bg-primary transition-colors" style={{ height: `${Math.round(c.pct * 100)}%` }}></div>
                    </div>
                    <span className="text-xs text-[#b9b09d] truncate max-w-[72px]" title={c.name}>{c.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 bg-[#2c241e] rounded-xl border border-[#3a3028] p-6 flex flex-col">
              <h3 className="text-white text-lg font-bold mb-4">Action Center</h3>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button onClick={() => openTransfer()} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg bg-[#3a3028]/50 hover:bg-[#3a3028] border border-[#3a3028] hover:border-primary/30 transition-all group">
                  <span className="material-symbols-outlined text-primary group-hover:scale-110 transition-transform">swap_horiz</span>
                  <span className="text-xs font-bold text-white">Transfer</span>
                </button>
                <button onClick={openCount} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg bg-[#3a3028]/50 hover:bg-[#3a3028] border border-[#3a3028] hover:border-primary/30 transition-all group">
                  <span className="material-symbols-outlined text-primary group-hover:scale-110 transition-transform">inventory</span>
                  <span className="text-xs font-bold text-white">Count</span>
                </button>
              </div>
              <h4 className="text-[#b9b09d] text-xs font-bold uppercase tracking-wider mb-3">Recent Alerts</h4>
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                {loading ? (
                  <div className="text-sm text-[#b9b09d]">Loading...</div>
                ) : alerts.length ? (
                  alerts.map((a) => (
                    <div key={a.id} className="flex gap-3 items-start p-3 rounded-lg bg-[#221c10]/50 border border-[#3a3028]">
                      <div className={`size-2 mt-1.5 rounded-full shrink-0 ${a.kind === 'Critical' ? 'bg-[#e55d5d]' : 'bg-primary'}`}></div>
                      <div>
                        <p className="text-sm font-bold text-white">{a.title}</p>
                        <p className="text-xs text-[#b9b09d] mt-1">{a.detail}</p>
                        <p className="text-[10px] text-[#b9b09d] mt-2 opacity-60">Just now</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[#b9b09d]">No alerts right now.</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#2c241e] rounded-xl border border-[#3a3028] overflow-hidden flex flex-col shadow-lg">
            <div className="p-4 border-b border-[#3a3028] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-white text-lg font-bold">Global Master Inventory</h3>
                <div className="text-xs text-[#b9b09d] mt-1">
                  Showing <span className="text-white font-bold">{rows.length}</span>
                  {data?.items ? <span> of <span className="text-white font-bold">{data.items.length}</span></span> : null}
                  <span className="mx-2 opacity-50">|</span>
                  <span className="text-[#b9b09d]">Scope:</span> <span className="text-white font-bold">{scopeLabel}</span>
                  <span className="mx-2 opacity-50">|</span>
                  <span className="text-[#b9b09d]">Category:</span> <span className="text-white font-bold">{category || 'All'}</span>
                  <span className="mx-2 opacity-50">|</span>
                  <span className="text-[#b9b09d]">Status:</span> <span className="text-white font-bold">{status === 'all' ? 'All' : status === 'in_stock' ? 'In Stock' : status === 'low' ? 'Low' : 'Critical'}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[#b9b09d] text-[18px]">filter_alt</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="bg-[#221c10] text-[#b9b09d] text-sm rounded-lg pl-9 pr-8 py-2 border border-[#3a3028] focus:border-primary focus:ring-0 outline-none appearance-none cursor-pointer hover:bg-[#3a3028]">
                    <option value="all">Status: All</option>
                    <option value="low">Low Stock</option>
                    <option value="critical">Critical</option>
                    <option value="in_stock">In Stock</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#b9b09d]">
                <thead className="bg-[#3a3028]/50 text-xs uppercase font-bold text-[#b9b09d]">
                  <tr>
                    <th className="px-6 py-4">SKU / Item</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4 text-center">Global Qty</th>
                    <th className="px-6 py-4">Branch Distribution</th>
                    <th className="px-6 py-4 text-right">Avg Cost</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3a3028]">
                  {loading ? (
                    <tr><td className="px-6 py-6" colSpan={7}>Loading...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td className="px-6 py-6" colSpan={7}>No rows.</td></tr>
                  ) : (
                    rows.map((it) => {
                      const total = it.globalQty || 0;
                      const parts = branches
                        .map((b, idx) => ({ id: b.id, name: b.name, qty: it.byBranch?.[b.id] ?? 0, color: distColors[idx % distColors.length] }))
                        .filter((p) => p.qty > 0);
                      return (
                        <tr key={it.sku} className="hover:bg-[#3a3028]/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-bold text-white">{it.name}</p>
                              <p className="text-xs text-[#b9b09d]">#{it.sku}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">{it.category}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="font-bold text-white block">{it.globalQty}</span>
                            <span className="text-xs">{it.unit}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1 w-32 h-2 rounded-full overflow-hidden bg-[#221c10] border border-[#3a3028]">
                              {parts.length ? (
                                parts.map((p) => (
                                  <div key={p.id} className={`h-full ${p.color}`} style={{ width: `${Math.max(2, Math.round((p.qty / (total || 1)) * 100))}%` }} title={`${p.name}: ${p.qty} ${it.unit}`}></div>
                                ))
                              ) : (
                                <div className="h-full bg-[#3a3028]" style={{ width: '100%' }}></div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-white">{money.format(it.cost)}</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                it.status === 'In Stock'
                                  ? 'bg-[#5ba968]/20 text-[#5ba968]'
                                  : it.status === 'Low'
                                    ? 'bg-orange-500/20 text-orange-400'
                                    : 'bg-[#e55d5d]/20 text-[#e55d5d]'
                              }`}
                            >
                              <span className={`size-1.5 rounded-full ${it.status === 'In Stock' ? 'bg-[#5ba968]' : it.status === 'Low' ? 'bg-orange-400' : 'bg-[#e55d5d]'}`}></span>
                              {it.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {it.status === 'Critical' ? (
                              <button
                                onClick={() => openPo({ sku: it.sku })}
                                className="text-primary hover:text-white text-xs font-bold border border-primary/30 hover:border-primary px-2 py-1 rounded transition-colors"
                              >
                                Reorder
                              </button>
                            ) : (
                              <button onClick={() => openRowActions(it)} className="text-[#b9b09d] hover:text-white transition-colors">
                                <span className="material-symbols-outlined">more_vert</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        {modal ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div className="w-full max-w-[520px] rounded-2xl border border-[#3a3028] bg-[#221c10] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-[#3a3028] px-5 py-4">
                <div>
                  <div className="text-white text-lg font-black">
                    {modal === 'po'
                      ? 'Create Purchase Order'
                      : modal === 'transfer'
                        ? 'Request Transfer'
                        : modal === 'count'
                          ? 'Log Inventory Count'
                          : 'Item Actions'}
                  </div>
                  <div className="text-[#b9b09d] text-sm mt-1">
                    {modal === 'row' && activeItem ? `${activeItem.name}    #${activeItem.sku}` : `Scope: ${scopeLabel}`}
                  </div>
                </div>
                <button onClick={closeModal} className="p-1.5 rounded-md hover:bg-[#3a3028] text-[#b9b09d] hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-3">
                {modal === 'po' ? (
                  <>
                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Branch</label>
                    <select value={poBranchId} onChange={(e) => setPoBranchId(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none">
                      <option value="">Select Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">SKU</label>
                    <input value={poSku} onChange={(e) => setPoSku(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="RM-COF-001" />

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Quantity</label>
                    <input value={poQty} onChange={(e) => setPoQty(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="10" />

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Notes</label>
                    <input value={poNotes} onChange={(e) => setPoNotes(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="Optional" />
                  </>
                ) : null}

                {modal === 'transfer' ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">From Branch</label>
                        <select value={trFromBranchId} onChange={(e) => setTrFromBranchId(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none">
                          <option value="">Select</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">To Branch</label>
                        <select value={trToBranchId} onChange={(e) => setTrToBranchId(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none">
                          <option value="">Select</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">SKU</label>
                    <input value={trSku} onChange={(e) => setTrSku(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="RM-COF-001" />

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Quantity</label>
                    <input value={trQty} onChange={(e) => setTrQty(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="5" />
                  </>
                ) : null}

                {modal === 'count' ? (
                  <>
                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Branch</label>
                    <select value={countBranchId} onChange={(e) => setCountBranchId(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none">
                      <option value="">Select Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>

                    <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">Scope</label>
                    <select value={countScope} onChange={(e) => setCountScope(e.target.value as any)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none">
                      <option value="full">Full Count</option>
                      <option value="category">Current Category</option>
                      <option value="sku">Single SKU</option>
                    </select>

                    {countScope === 'sku' ? (
                      <>
                        <label className="text-xs font-bold text-[#b9b09d] uppercase tracking-wider">SKU</label>
                        <input value={countSku} onChange={(e) => setCountSku(e.target.value)} className="h-10 rounded-lg border border-[#3a3028] bg-[#2c241e] text-white px-3 text-sm focus:border-primary focus:outline-none" placeholder="RM-COF-001" />
                      </>
                    ) : null}
                  </>
                ) : null}

                {modal === 'row' && activeItem ? (
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => {
                        closeModal();
                        openPo({ sku: activeItem.sku });
                      }}
                      className="h-10 rounded-lg bg-primary text-[#221c10] font-black hover:bg-primary/90"
                    >
                      Create PO for this SKU
                    </button>
                    <button
                      onClick={() => {
                        const generatedAt = new Date().toISOString();
                        const lines = [
                          'SKU Export',
                          '',
                          ['GeneratedAt', generatedAt].map(csvEscape).join(','),
                          ['SKU', activeItem.sku].map(csvEscape).join(','),
                          ['Name', activeItem.name].map(csvEscape).join(','),
                          ['Category', activeItem.category].map(csvEscape).join(','),
                          '',
                        ];
                        const branchCols = branches.map((b) => b.name);
                        lines.push(['Branch', ...branchCols].map(csvEscape).join(','));
                        lines.push(['Qty', ...branches.map((b) => activeItem.byBranch?.[b.id] ?? 0)].map(csvEscape).join(','));
                        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `sku-${activeItem.sku}-${generatedAt.slice(0, 10)}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        setBanner({ kind: 'success', message: 'SKU export downloaded.' });
                        closeModal();
                      }}
                      className="h-10 rounded-lg bg-[#2c241e] border border-[#3a3028] text-white hover:border-primary/50"
                    >
                      Export this SKU
                    </button>
                    <button
                      onClick={() => {
                        closeModal();
                        openTransfer({ sku: activeItem.sku });
                      }}
                      className="h-10 rounded-lg bg-[#2c241e] border border-[#3a3028] text-white hover:border-primary/50"
                    >
                      Request Transfer
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#3a3028] px-5 py-4">
                <button onClick={closeModal} className="h-10 px-4 rounded-lg bg-[#2c241e] border border-[#3a3028] text-white hover:border-primary/50" disabled={modalLoading}>
                  Cancel
                </button>
                {modal === 'po' ? (
                  <button onClick={submitPo} className="h-10 px-4 rounded-lg bg-primary text-[#221c10] font-black hover:bg-primary/90 disabled:opacity-60" disabled={modalLoading}>
                    {modalLoading ? 'Creating ¦' : 'Create PO'}
                  </button>
                ) : null}
                {modal === 'transfer' ? (
                  <button onClick={submitTransfer} className="h-10 px-4 rounded-lg bg-primary text-[#221c10] font-black hover:bg-primary/90 disabled:opacity-60" disabled={modalLoading}>
                    {modalLoading ? 'Requesting ¦' : 'Request'}
                  </button>
                ) : null}
                {modal === 'count' ? (
                  <button onClick={submitCount} className="h-10 px-4 rounded-lg bg-primary text-[#221c10] font-black hover:bg-primary/90 disabled:opacity-60" disabled={modalLoading}>
                    {modalLoading ? 'Saving ¦' : 'Log Count'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        </div>
      </div>
    </div>
  );
};
