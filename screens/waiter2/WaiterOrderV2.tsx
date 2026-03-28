import React, { useEffect, useMemo, useRef, useState } from 'react';

import { AppIcon } from '@/components/ui/app-icon';
import { apiFetch } from '../../api';
import { usePos, useSelectedTable } from '../../PosContext';
import { readSession } from '../../session';
import { Screen } from '../../types';

type ModifierGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: Array<{ id: string; name: string; priceDelta: number }>;
};

type Evaluated = {
  violations: any[];
  pricing: { subtotal: number; total: number } | null;
  pricingLines: Array<{ productId: string; qty: number; unitPrice: number; totalPrice: number }>;
  constraints: Record<string, Record<string, { min?: number; max?: number }>> | null;
  bundleApplied: any | null;
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const WaiterOrderV2: React.FC<Props> = ({ onNavigate }) => {
  const {
    products,
    tables,
    selectedTableId,
    selectTable,
    getCartItems,
    addToCart,
    clearCart,
    setCartQty,
    setCartItemNote,
    setCartItemModifiers,
    sendOrderToKitchen,
    getDraftOrderMeta,
  } = usePos();
  const selectedTable = useSelectedTable();

  const tableId = selectedTableId || selectedTable?.id || '';
  const cartItems = useMemo(() => (tableId ? getCartItems(tableId) : []), [getCartItems, tableId]);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  const [evalState, setEvalState] = useState<Evaluated>({
    violations: [],
    pricing: null,
    pricingLines: [],
    constraints: null,
    bundleApplied: null,
  });
  const [evaluating, setEvaluating] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string>('');
  const [editNote, setEditNote] = useState('');
  const [editModifiers, setEditModifiers] = useState<string[]>([]);
  const [editModifierGroups, setEditModifierGroups] = useState<ModifierGroup[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [addingProductId, setAddingProductId] = useState<string>('');

  const [clock, setClock] = useState(() => new Date());

  const staffName = useMemo(() => {
    try {
      const s = readSession<any>();
      const nm = String(s?.staffName || '').trim();
      return nm || String(s?.staffId || '').trim() || 'Server';
    } catch {
      return 'Server';
    }
  }, []);

  const modifierGroupNameByProductIdRef = useRef<Map<string, Map<string, string>>>(new Map());
  const modifierLabelByProductIdRef = useRef<Map<string, Map<string, string>>>(new Map());

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'All' && String(p.category || '') !== category) return false;
      if (!q) return true;
      const name = String(p.name || '').toLowerCase();
      const code = String(p.code || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [products, query, category]);

  const countsByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const token of editModifiers) {
      const gid = String(token.split(':')[0] || '').trim();
      if (!gid) continue;
      map.set(gid, (map.get(gid) || 0) + 1);
    }
    return map;
  }, [editModifiers]);

  const modifierValidity = useMemo(() => {
    return editModifierGroups.map((g) => {
      const c = countsByGroupId.get(g.id) || 0;
      const min = Number(g.min || 0) || 0;
      const max = Number(g.max || 0) || 0;
      const okMin = min <= 0 || c >= min;
      const okMax = max <= 0 || c <= max;
      return { groupId: g.id, ok: okMin && okMax, count: c, min, max };
    });
  }, [editModifierGroups, countsByGroupId]);

  const canSaveModifiers = useMemo(() => modifierValidity.every((v) => v.ok), [modifierValidity]);

  const formatViolation = (v: any) => {
    const type = String(v?.type || '').trim();
    if (type === 'unavailable') {
      const pid = String(v?.productId || '').trim();
      const name = products.find((p) => p.id === pid)?.name;
      const reason = String(v?.reason || 'unavailable').trim();
      return `${name || pid || 'Item'} is unavailable (${reason}).`;
    }
    if (type === 'modifier_min') {
      const pid = String(v?.productId || '').trim();
      const name = products.find((p) => p.id === pid)?.name;
      const groupId = String(v?.groupId || '').trim();
      const min = Number(v?.min ?? 0) || 0;
      const groupName = modifierGroupNameByProductIdRef.current.get(pid)?.get(groupId);
      return `${name || pid || 'Item'}: select at least ${min} from ${groupName || groupId || 'required group'}.`;
    }
    if (type === 'modifier_max') {
      const pid = String(v?.productId || '').trim();
      const name = products.find((p) => p.id === pid)?.name;
      const groupId = String(v?.groupId || '').trim();
      const max = Number(v?.max ?? 0) || 0;
      const groupName = modifierGroupNameByProductIdRef.current.get(pid)?.get(groupId);
      return `${name || pid || 'Item'}: select at most ${max} from ${groupName || groupId || 'a group'}.`;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return 'Cart rule violation.';
    }
  };

  const fallbackSubtotal = useMemo(() => {
    return cartItems.reduce((sum, it) => {
      const unit = Number(products.find((p) => p.id === it.productId)?.price || 0) || 0;
      const qty = Number(it.qty || 0) || 0;
      return sum + unit * qty;
    }, 0);
  }, [cartItems, products]);

  const displayedSubtotal = evalState.pricing ? Number(evalState.pricing.subtotal || 0) || 0 : fallbackSubtotal;
  const displayedTotal = evalState.pricing ? Number(evalState.pricing.total ?? evalState.pricing.subtotal ?? 0) || 0 : fallbackSubtotal;

  const openModifiersForProduct = async ({ productId, preferDrawer = true }: { productId: string; preferDrawer?: boolean }) => {
    if (!tableId) return;

    const it = cartItems.find((x) => x.productId === productId) || null;
    setEditProductId(productId);
    setEditNote(String(it?.note || ''));
    setEditModifiers(Array.isArray(it?.modifiers) ? it!.modifiers!.slice() : []);

    setEditLoading(true);
    try {
      const res = await apiFetch(`/api/pos/menu/products/${encodeURIComponent(productId)}/modifier-groups`);
      const json = (await res.json().catch(() => null)) as any;
      const groups = Array.isArray(json?.groups) ? (json.groups as any[]) : [];
      const mapped = groups
        .map((g) => ({
          id: String(g?.id || ''),
          name: String(g?.name || ''),
          min: Number(g?.min ?? 0) || 0,
          max: Number(g?.max ?? 0) || 0,
          options: Array.isArray(g?.options)
            ? (g.options as any[])
                .map((o) => ({ id: String(o?.id || ''), name: String(o?.name || ''), priceDelta: Number(o?.priceDelta ?? 0) || 0 }))
                .filter((o) => o.id && o.name)
            : [],
        }))
        .filter((g) => g.id && g.name);

      const byGroupId = new Map<string, string>();
      const byToken = new Map<string, string>();
      for (const g of mapped) byGroupId.set(g.id, g.name);
      for (const g of mapped) {
        for (const o of g.options) byToken.set(`${g.id}:${o.id}`, o.name);
      }
      modifierGroupNameByProductIdRef.current.set(productId, byGroupId);
      modifierLabelByProductIdRef.current.set(productId, byToken);

      setEditModifierGroups(mapped);

      if (preferDrawer && mapped.length) setDrawerOpen(true);
    } finally {
      setEditLoading(false);
    }
  };

  const addProduct = async (productId: string) => {
    if (!tableId) return;
    if (addingProductId === productId) return;
    const exists = cartItems.some((x) => x.productId === productId);
    if (exists) {
      await openModifiersForProduct({ productId, preferDrawer: true });
      return;
    }

    setAddingProductId(productId);
    try {
      addToCart(tableId, productId);
      await openModifiersForProduct({ productId, preferDrawer: true });
    } finally {
      setAddingProductId('');
    }
  };

  const toggleModifier = (groupId: string, optionId: string) => {
    const token = `${groupId}:${optionId}`;
    setEditModifiers((prev) => {
      const group = editModifierGroups.find((g) => g.id === groupId) || null;
      const max = group ? Number(group.max ?? 0) || 0 : 0;
      if (prev.includes(token)) return prev.filter((x) => x !== token);
      const withoutGroup = prev.filter((x) => !x.startsWith(`${groupId}:`));
      const groupSelectedCount = prev.filter((x) => x.startsWith(`${groupId}:`)).length;
      if (max === 1) return [...withoutGroup, token];
      if (max > 0 && groupSelectedCount >= max) return prev;
      return [...prev, token];
    });
  };

  const saveEdits = () => {
    if (!tableId || !editProductId) return;
    setCartItemNote(tableId, editProductId, editNote);
    setCartItemModifiers(tableId, editProductId, editModifiers);
    setDrawerOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!tableId) return;

      const payloadItems = cartItems.map((x) => ({ productId: x.productId, qty: x.qty, modifiers: Array.isArray(x.modifiers) ? x.modifiers : [] }));
      if (!payloadItems.length) {
        setEvalState({ violations: [], pricing: { subtotal: 0, total: 0 }, pricingLines: [], constraints: null, bundleApplied: null });
        return;
      }

      setEvaluating(true);
      try {
        const meta = getDraftOrderMeta(tableId);
        const orderType = meta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in';
        const res = await apiFetch('/api/pos/menu/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ at: new Date().toISOString(), orderType, cart: { items: payloadItems } }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        if (!res.ok) {
          const violations = Array.isArray(json?.violations) ? json.violations : [];
          setEvalState({ violations, pricing: null, pricingLines: [], constraints: null, bundleApplied: null });
          return;
        }

        const pricingLines = Array.isArray(json?.pricing?.lines)
          ? (json.pricing.lines as any[])
              .map((x) => ({
                productId: String(x?.productId || ''),
                qty: Number(x?.qty ?? 0) || 0,
                unitPrice: Number(x?.unitPrice ?? 0) || 0,
                totalPrice: Number(x?.totalPrice ?? 0) || 0,
              }))
              .filter((x) => x.productId)
          : [];

        setEvalState({
          violations: Array.isArray(json?.violations) ? json.violations : [],
          pricing: json?.pricing && typeof json.pricing === 'object' ? { subtotal: Number(json.pricing.subtotal || 0) || 0, total: Number(json.pricing.total || 0) || 0 } : null,
          pricingLines,
          constraints: json?.constraints && typeof json.constraints === 'object' ? json.constraints : null,
          bundleApplied: json?.bundleApplied || null,
        });
      } catch {
        if (!cancelled) setEvalState((s) => ({ ...s }));
      } finally {
        if (!cancelled) setEvaluating(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [cartItems, getDraftOrderMeta, tableId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.getElementById('waiter2-search') as HTMLInputElement | null;
        if (el && document.activeElement !== el) {
          e.preventDefault();
          el.focus();
        }
      }
      if (e.key === 'Escape') {
        if (drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const primaryDisabled = evaluating || (evalState.violations || []).length > 0;

  const onSend = async () => {
    if (!tableId) return;
    if (primaryDisabled) return;
    await sendOrderToKitchen(tableId);
  };

  const onClearTicket = () => {
    if (!tableId) return;
    clearCart(tableId);
    setDrawerOpen(false);
    setEditProductId('');
    setEditNote('');
    setEditModifiers([]);
    setEditModifierGroups([]);
  };

  const violationBanner = (evalState.violations || []).slice(0, 2);

  const lineTotalsByProductId = useMemo(() => {
    const map = new Map<string, { unitPrice: number; totalPrice: number; qty: number }>();
    for (const l of evalState.pricingLines || []) {
      map.set(String(l.productId), {
        unitPrice: Number(l.unitPrice || 0) || 0,
        totalPrice: Number(l.totalPrice || 0) || 0,
        qty: Number(l.qty || 0) || 0,
      });
    }
    return map;
  }, [evalState.pricingLines]);

  const renderModifierChips = (productId: string, tokensRaw: unknown) => {
    const tokens = Array.isArray(tokensRaw) ? (tokensRaw as any[]).map(String).filter(Boolean) : [];
    if (!tokens.length) return null;
    const byToken = modifierLabelByProductIdRef.current.get(productId);
    const labels = tokens.map((t) => byToken?.get(t) || t.split(':')[1] || t).filter(Boolean);
    const shown = labels.slice(0, 3);
    const more = Math.max(0, labels.length - shown.length);

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {shown.map((lb, idx) => (
          <span key={`${productId}:${idx}`} className="inline-flex items-center h-6 px-2.5 rounded-full bg-background border border-border text-[11px] font-black text-muted-foreground">
            {lb}
          </span>
        ))}
        {more > 0 ? (
          <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-muted border border-border text-[11px] font-black text-muted-foreground">
            +{more}
          </span>
        ) : null}
      </div>
    );
  };

  const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });

  return (
    <div className="bg-background dark:bg-slate-950 text-foreground antialiased overflow-hidden h-full">
      <header className="h-[56px] bg-background border-b border-border flex items-center px-6 fixed top-0 w-full z-50">
        <div className="flex items-center gap-4 w-1/4 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}
            className="h-10 w-10 rounded-full bg-accent hover:bg-accent/80 flex items-center justify-center"
            aria-label="Back to floor"
          >
            <AppIcon name="arrow_back" size={18} />
          </button>

          <div className="bg-primary/20 text-foreground px-4 py-1 rounded-full font-black text-sm truncate">
            {selectedTable?.name || 'Table'}
          </div>

          {selectedTable?.status ? (
            <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-black uppercase tracking-wide">
              {String(selectedTable.status)}
            </div>
          ) : null}

          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
            Server: <span className="text-foreground font-bold">{staffName}</span>
          </div>
        </div>

        <div className="flex-1 px-8">
          <div className="relative max-w-2xl mx-auto">
            <AppIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input
              id="waiter2-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-muted border-none rounded-full py-2 pl-12 pr-4 focus:ring-2 focus:ring-primary text-sm"
              placeholder="Quick search menu items (code or name)… ( / )"
              type="text"
              aria-label="Quick search menu items"
            />
          </div>
          {evaluating ? <div className="mt-2 text-center text-[11px] font-bold text-muted-foreground">Evaluating…</div> : null}
        </div>

        <div className="w-1/4 flex justify-end items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{fmtTime(clock)}</p>
            <p className="text-xs font-semibold">{fmtDate(clock)}</p>
          </div>
          <button type="button" className="w-10 h-10 rounded-full bg-muted flex items-center justify-center" aria-label="Notifications">
            <AppIcon name="notifications" className="text-muted-foreground" size={18} />
          </button>
        </div>
      </header>

      <main className="pt-[56px] h-full flex">
        {/* LEFT - TABLE SELECTION */}
        <aside className="w-[280px] flex-none flex flex-col bg-muted/30 border-r border-border">
          <div className="p-4 border-b border-border bg-card">
            <div className="text-xs font-black uppercase tracking-widest text-foreground">Tables</div>
            <div className="mt-2 text-[10px] text-muted-foreground">{tables.length} tables</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tables.map((t) => {
              const active = selectedTableId === t.id;
              const hasOrder = t.openOrderId || t.status !== 'Free';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTable(t.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    active
                      ? 'bg-primary/10 border-primary ring-1 ring-primary'
                      : hasOrder
                      ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                      : 'bg-background border-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-sm text-foreground">{t.name}</div>
                    <div className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                      hasOrder ? 'bg-amber-500/20 text-amber-600' : 'bg-green-500/20 text-green-600'
                    }`}>
                      {t.status}
                    </div>
                  </div>
                  <div className="mt-1 flex justify-between items-center text-[11px] text-muted-foreground">
                    <span>{t.seats} seats</span>
                    {t.currentTotal > 0 && (
                      <span className="font-bold text-foreground">ETB {t.currentTotal.toFixed(2)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CENTER - MENU */}
        <section className="flex-1 min-w-0 flex flex-col border-r border-border">
          <nav className="sticky top-0 z-40 bg-background px-6 py-4 flex gap-3 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={
                  category === c
                    ? 'bg-primary text-primary-foreground px-6 py-2 rounded-full font-black whitespace-nowrap shadow-lg shadow-primary/20'
                    : 'bg-muted hover:bg-muted/70 px-6 py-2 rounded-full font-semibold whitespace-nowrap transition-colors'
                }
                aria-label={`Category ${c}`}
              >
                {c}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((p) => {
                const img = typeof (p as any).image === 'string' ? String((p as any).image).trim() : '';
                const soldOut = Number((p as any)?.stock ?? 1) === 0;
                const adding = addingProductId === p.id;

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (soldOut) return;
                      void addProduct(p.id);
                    }}
                    className={
                      soldOut
                        ? 'bg-background p-4 rounded-xl border border-border shadow-sm transition-all relative opacity-50'
                        : 'bg-background p-4 rounded-xl border border-border shadow-sm hover:shadow-md transition-all relative cursor-pointer'
                    }
                    aria-label={`Add ${p.name}`}
                  >
                    <div className="h-32 w-full rounded-lg mb-4 bg-muted overflow-hidden">
                      {img ? <img className="w-full h-full object-cover" src={img} alt={p.name} /> : null}
                    </div>
                    <h3 className="font-black text-foreground mb-1 truncate">{p.name}</h3>
                    <p className="text-primary font-extrabold text-lg">ETB {Number(p.price || 0).toFixed(2)}</p>

                    {!soldOut ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void addProduct(p.id);
                        }}
                        disabled={adding}
                        className="absolute bottom-4 right-4 bg-primary text-primary-foreground w-10 h-10 rounded-full flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-transform disabled:opacity-60 disabled:hover:scale-100 disabled:active:scale-100"
                        aria-label={`Add ${p.name}`}
                      >
                        {adding ? <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" /> : <AppIcon name="add" size={18} />}
                      </button>
                    ) : null}

                    {soldOut ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
                        <span className="bg-background text-foreground font-black px-4 py-1 rounded-full text-xs">SOLD OUT</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!filteredProducts.length ? <div className="mt-8 text-sm text-muted-foreground">No items match your search.</div> : null}
          </div>
        </section>

        <aside className="w-[420px] 2xl:w-[460px] flex-none flex flex-col bg-background shadow-2xl z-30 relative">
          <div className="p-6 border-b border-border flex justify-between items-end">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-foreground truncate">Current Ticket</h2>
              <p className="text-xs text-muted-foreground truncate">{selectedTable?.name ? `For ${selectedTable.name}` : ''}</p>
              {evalState.bundleApplied ? <p className="text-xs text-muted-foreground font-semibold truncate">Bundle: {String(evalState.bundleApplied?.name || 'Applied')}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClearTicket}
              className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              aria-label="Clear ticket"
              disabled={!tableId || cartItems.length === 0}
            >
              <AppIcon name="delete_sweep" size={18} />
            </button>
          </div>

          {violationBanner.length ? (
            <div className="px-6 pt-4">
              <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/30">
                {violationBanner.map((v, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const pid = String((v as any)?.productId || '').trim();
                      if (pid) void openModifiersForProduct({ productId: pid, preferDrawer: true });
                    }}
                    className="block w-full text-left text-xs font-black text-destructive py-1"
                    aria-label="Fix cart violation"
                  >
                    {formatViolation(v)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {cartItems.map((it) => {
              const active = it.productId === editProductId && drawerOpen;
              const pricing = lineTotalsByProductId.get(it.productId) || null;
              const fallbackUnit = Number(products.find((p) => p.id === it.productId)?.price || 0) || 0;
              const fallbackTotal = fallbackUnit * (Number(it.qty || 0) || 0);
              const total = pricing ? Number(pricing.totalPrice || 0) || 0 : fallbackTotal;
              return (
                <div
                  key={it.productId}
                  className={
                    active
                      ? 'flex items-start gap-4 p-3 rounded-2xl bg-primary/10 border border-primary/40 ring-2 ring-primary/20'
                      : 'flex items-start gap-4 p-3 rounded-2xl bg-muted/40 border border-transparent hover:border-primary/30 transition-all'
                  }
                >
                  <div className="flex flex-col items-center gap-1 bg-background p-1 rounded-full shadow-sm">
                    <button
                      type="button"
                      onClick={() => setCartQty(tableId, it.productId, Math.min(999, (it.qty || 0) + 1))}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted"
                      aria-label={`Increase quantity for ${it.name}`}
                    >
                      <AppIcon name="add" size={16} />
                    </button>
                    <span className="font-black text-sm">{it.qty}</span>
                    <button
                      type="button"
                      onClick={() => setCartQty(tableId, it.productId, Math.max(0, (it.qty || 0) - 1))}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted"
                      aria-label={`Decrease quantity for ${it.name}`}
                    >
                      <AppIcon name="remove" size={16} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => void openModifiersForProduct({ productId: it.productId, preferDrawer: true })}
                    className="flex-1 text-left min-w-0"
                    aria-label={`Edit ${it.name}`}
                  >
                    <div className="flex justify-between gap-3">
                      <h4 className="font-black text-foreground truncate">{it.name}</h4>
                      <p className="font-black whitespace-nowrap">ETB {Number(total).toFixed(2)}</p>
                    </div>

                    <div className="text-xs text-muted-foreground mt-1">
                      {it.note ? it.note : ''}
                    </div>

                    {renderModifierChips(it.productId, it.modifiers)}
                  </button>
                </div>
              );
            })}

            {!cartItems.length ? <div className="text-sm text-muted-foreground">Cart is empty.</div> : null}
          </div>

          <div className="p-6 bg-muted/40 border-t border-border">
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">ETB {Number(displayedSubtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="font-black text-lg">Total</span>
                <span className="text-2xl font-extrabold text-primary">ETB {Number(displayedTotal).toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => onNavigate(Screen.WAITER_PAYMENT)}
                disabled={!cartItems.length}
                className="bg-background border-2 border-border font-black py-4 rounded-xl hover:bg-muted transition-colors disabled:opacity-50"
              >
                PAY NOW
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={primaryDisabled || !cartItems.length}
                className="bg-primary text-primary-foreground font-extrabold py-4 rounded-xl shadow-lg shadow-primary/30 hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                SEND TO KITCHEN
              </button>
            </div>
          </div>

          {drawerOpen ? (
            <>
              <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setDrawerOpen(false)} />
              <div className="absolute inset-y-0 right-0 w-[520px] max-w-[92vw] bg-background shadow-[-20px_0_40px_rgba(0,0,0,0.1)] border-l border-border z-50 flex flex-col">
                <div className="p-6 border-b border-border flex items-center justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-black truncate">{products.find((p) => p.id === editProductId)?.name || 'Customize'}</h3>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Customize Item</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"
                    aria-label="Close modifier drawer"
                  >
                    <AppIcon name="close" size={18} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-28">
                  {editLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

                  {editModifierGroups.map((g) => {
                    const v = modifierValidity.find((x) => x.groupId === g.id);
                    const min = Number(g.min || 0) || 0;
                    const max = Number(g.max || 0) || 0;
                    const rangeLabel = min > 0 && max > 0 ? `${min}–${max}` : min > 0 ? `${min}+` : max > 0 ? `0–${max}` : '';
                    const optionsAsGrid = g.options.length > 6;

                    return (
                      <div key={g.id}>
                        <div className="flex items-baseline justify-between gap-3">
                          <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground">{g.name}</label>
                          {rangeLabel ? <div className="text-xs text-muted-foreground font-semibold">Choose {rangeLabel}</div> : null}
                        </div>
                        {v && !v.ok ? (
                          <div className="text-xs text-destructive font-black mt-2">Select {rangeLabel || 'required'} (selected {v.count}).</div>
                        ) : null}

                        <div className={optionsAsGrid ? 'mt-4 grid grid-cols-2 gap-2' : 'mt-4 flex flex-wrap gap-2'}>
                          {g.options.map((o) => {
                            const token = `${g.id}:${o.id}`;
                            const active = editModifiers.includes(token);
                            return (
                              <button
                                key={o.id}
                                type="button"
                                onClick={() => toggleModifier(g.id, o.id)}
                                className={
                                  optionsAsGrid
                                    ? active
                                      ? 'px-4 py-3 rounded-xl border-2 border-primary bg-primary text-primary-foreground font-black text-xs flex justify-between items-center'
                                      : 'px-4 py-3 rounded-xl border-2 border-border bg-background font-black text-xs flex justify-between items-center hover:bg-muted'
                                    : active
                                      ? 'px-5 py-2.5 rounded-full border-2 border-primary bg-primary/10 text-primary font-black text-sm'
                                      : 'px-5 py-2.5 rounded-full border-2 border-border font-black text-sm hover:bg-muted'
                                }
                                aria-label={`${g.name}: ${o.name}${active ? ' selected' : ''}`}
                              >
                                <span className="truncate">{o.name}</span>
                                {Number(o.priceDelta || 0) !== 0 ? <span className="ml-2 whitespace-nowrap">+ETB {Number(o.priceDelta || 0).toFixed(2)}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground mb-4">Special Notes</label>
                    <textarea
                      className="w-full bg-muted border-2 border-border rounded-2xl p-4 text-sm focus:ring-primary focus:border-primary"
                      placeholder="Enter special requests here…"
                      rows={3}
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      aria-label="Special notes"
                    />
                  </div>
                </div>

                <div className="sticky bottom-0 p-6 bg-muted/40 border-t border-border">
                  <button
                    type="button"
                    onClick={saveEdits}
                    disabled={!canSaveModifiers}
                    className="w-full bg-primary text-primary-foreground font-extrabold py-5 rounded-xl shadow-lg shadow-primary/30 text-lg uppercase tracking-tight disabled:opacity-50"
                  >
                    Apply Changes
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </aside>
      </main>
    </div>
  );
};
