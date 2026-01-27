import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Modal } from '../../components/Modal';
import type { InventoryItem, Product, Recipe } from '../../types';
import { Screen } from '../../types';
import { apiFetch } from '../../api';
import { readSession } from '../../session';
import { usePersistedNullableString } from '../../usePersistedState';
import { formatDeviceDateTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
interface Props {
  onNavigate: (screen: Screen) => void;
}

const STORAGE_SELECTED_PRODUCT = 'mirachpos.inventory.selectedProductId';

const mapInventoryItems = (rows: any[]): InventoryItem[] => {
  return rows
    .map((x) => {
      const id = typeof x?.id === 'string' ? x.id : '';
      const name = typeof x?.name === 'string' ? x.name : '';
      if (!id || !name) return null;
      return {
        id,
        name,
        category: typeof x?.category === 'string' ? x.category : 'Raw Material',
        stock: Number(x?.stock ?? 0) || 0,
        unit: typeof x?.unit === 'string' ? x.unit : '',
        minStock: Number(x?.minStock ?? 0) || 0,
        price: Number(x?.price ?? 0) || 0,
        status: typeof x?.status === 'string' ? x.status : 'Active',
      };
    })
    .filter(Boolean) as InventoryItem[];
};

export const RecipeBuilder: React.FC<Props> = ({ onNavigate }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<'ingredients' | 'history'>('ingredients');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  const [query, setQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState('');
  const [historyEvents, setHistoryEvents] = useState<
    Array<{ id: string; at: string; type: string; summary: string; actorName?: string; actorRole?: string }>
  >([]);

  const [selectedProductId, setSelectedProductId] = usePersistedNullableString(STORAGE_SELECTED_PRODUCT, null);

  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Record<string, boolean>>({});
  const [draftIngredientId, setDraftIngredientId] = useState<string>('');
  const [draftQty, setDraftQty] = useState('0');

  const [actionErr, setActionErr] = useState('');

  const resolveBranchId = () => {
    try {
      const s = readSession<any>();
      const bid = String(s?.branchId || '').trim();
      if (bid && bid !== 'global') return bid;
    } catch {
      // ignore
    }
    try {
      const raw = String(localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '').trim();
      if (raw && raw !== 'global') return raw;
    } catch {
      // ignore
    }
    return '';
  };

  const sessionRole = useMemo(() => {
    try {
      const s = readSession<any>();
      return typeof s?.role === 'string' ? s.role : '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('limit', '500');
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/products?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.products) ? (json.products as any[]) : [];
        const next = rows
          .map((p) => ({
            id: String(p.id || ''),
            code: String(p.code || ''),
            name: String(p.name || ''),
            price: Number(p.price ?? 0) || 0,
            category: String(p.category || 'Uncategorized'),
            image: String(p.image || ''),
            description: typeof p.description === 'string' ? p.description : '',
            stock: Number((p as any)?.stock ?? 500) || 500,
          }))
          .filter((p) => p.id && p.name);
        if (!mounted) return;
        setProducts(next);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    if (draftIngredientId) return;
    const first = inventoryItems[0]?.id;
    if (first) setDraftIngredientId(first);
  }, [addOpen, draftIngredientId, inventoryItems]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const ids = products.map((p) => p.id).filter(Boolean);
        if (ids.length === 0) {
          if (mounted) setRecipes([]);
          return;
        }
        const qs = new URLSearchParams({ productIds: ids.join(',') });
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/recipes?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.recipes) ? (json.recipes as any[]) : [];

        const byProductId = new Map<string, any>();
        for (const r of rows) {
          const pid = typeof r?.productId === 'string' ? r.productId : typeof r?.product_id === 'string' ? r.product_id : '';
          if (!pid) continue;
          const recipeObj = r?.recipe && typeof r.recipe === 'object' ? r.recipe : r;
          byProductId.set(pid, recipeObj);
        }

        const nextRecipes: Recipe[] = [];
        for (const p of products) {
          const rec = byProductId.get(p.id);
          if (!rec) continue;
          const ingredients = Array.isArray(rec.ingredients) ? rec.ingredients : [];
          nextRecipes.push({
            productId: p.id,
            productName: p.name,
            ingredients,
            totalCost: Number(rec.totalCost || 0) || 0,
          });
        }

        if (!mounted) return;
        setRecipes(nextRecipes);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [products]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('limit', '500');
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/inventory/items?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        let rows = Array.isArray(json?.items) ? json.items : [];
        if (!res.ok) rows = [];

        // Fallback (owner sessions) if inventory/items is empty or unavailable.
        if ((!rows.length || !res.ok) && sessionRole === 'Cafe Owner') {
          try {
            const qs2 = new URLSearchParams();
            if (bid) qs2.set('branchId', bid);
            const res2 = await apiFetch(`/api/owner/inventory?${qs2.toString()}`);
            const json2 = (await res2.json().catch(() => null)) as any;
            const items2 = Array.isArray(json2?.items) ? json2.items : [];
            rows = items2.map((it: any) => ({
              id: String(it?.sku || it?.id || ''),
              name: String(it?.name || ''),
              category: String(it?.category || 'Raw Material'),
              stock: Number(it?.globalQty ?? 0) || 0,
              unit: String(it?.unit || ''),
              minStock: Number(it?.minQty ?? 0) || 0,
              price: Number(it?.cost ?? it?.price ?? 0) || 0,
              status: String(it?.status || 'Active'),
            }));
          } catch {
            // ignore
          }
        }

        const next = mapInventoryItems(rows);
        if (!mounted) return;
        setInventoryItems(next);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [sessionRole]);

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);

  // selectedProductId is persisted via usePersistedNullableString

  useEffect(() => {
    if (tab !== 'history') return;
    if (!selectedProduct) {
      setHistoryEvents([]);
      setHistoryErr('');
      return;
    }

    let mounted = true;
    const run = async () => {
      setHistoryLoading(true);
      setHistoryErr('');
      try {
        const qs = new URLSearchParams();
        qs.set('limit', '200');
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/audit/list?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(String(json?.error || json?.message || res.status));

        const rows = Array.isArray(json?.audit) ? (json.audit as any[]) : [];
        const pid = selectedProduct.id;
        const productName = selectedProduct.name;

        const relevant = rows
          .filter((r: any) => {
            const type = String(r?.type || '');
            if (!type.startsWith('menu_')) return false;
            const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};
            const payloadProductId = String((payload as any)?.productId || (payload as any)?.id || '');
            return payloadProductId === pid;
          })
          .slice(0, 30)
          .map((r: any) => ({
            id: String(r?.id || ''),
            at: String(r?.at || ''),
            type: String(r?.type || ''),
            summary: (() => {
              const t = String(r?.type || '');
              const raw = String(r?.summary || '').trim();
              const replaced = raw ? raw.replaceAll(pid, productName) : '';
              if (replaced) return replaced;
              if (t === 'menu_recipe.upserted') return `Updated recipe for: ${productName}`;
              if (t === 'menu_recipe.deleted') return `Deleted recipe for: ${productName}`;
              if (t === 'menu_product.updated') return `Updated menu item: ${productName}`;
              if (t === 'menu_product.created') return `Created menu item: ${productName}`;
              if (t === 'menu_product.deleted') return `Deleted menu item: ${productName}`;
              return t || 'Update';
            })(),
            actorName: typeof r?.actorName === 'string' ? r.actorName : '',
            actorRole: typeof r?.actorRole === 'string' ? r.actorRole : '',
          }))
          .filter((x) => x.id);

        if (!mounted) return;
        setHistoryEvents(relevant);
      } catch (e) {
        if (!mounted) return;
        setHistoryEvents([]);
        setHistoryErr(e instanceof Error ? e.message : 'Failed to load history');
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [selectedProduct, tab]);

  // If the selected product has no recipe due to owner/global vs branch productId mismatch,
  // try to resolve the branch product by matching product code.
  useEffect(() => {
    if (!selectedProduct) return;
    if (recipes.some((r) => r.productId === selectedProduct.id)) return;
    const bid = resolveBranchId();
    if (!bid) return;
    if (!selectedProduct.code) return;

    let mounted = true;
    const run = async () => {
      try {
        const pqs = new URLSearchParams();
        pqs.set('limit', '500');
        pqs.set('branchId', bid);
        const pres = await apiFetch(`/api/manager/menu/products?${pqs.toString()}`);
        const pjson = (await pres.json().catch(() => null)) as any;
        if (!pres.ok) return;
        const prows = Array.isArray(pjson?.products) ? pjson.products : [];
        const match = prows.find((x: any) => String(x?.code || '').trim() === String(selectedProduct.code || '').trim());
        const pid2 = String(match?.id || '').trim();
        if (!pid2 || pid2 === selectedProduct.id) return;

        const rqs = new URLSearchParams();
        rqs.set('productId', pid2);
        rqs.set('branchId', bid);
        const rres = await apiFetch(`/api/manager/menu/recipes?${rqs.toString()}`);
        const rjson = (await rres.json().catch(() => null)) as any;
        if (!rres.ok) return;
        const rows = Array.isArray(rjson?.recipes) ? rjson.recipes : [];
        const row = rows.find((r: any) => String(r?.productId || r?.product_id || '') === pid2) || null;
        const recipeObj = row?.recipe && typeof row.recipe === 'object' ? row.recipe : null;
        if (!recipeObj) return;
        const ingredients = Array.isArray(recipeObj.ingredients) ? recipeObj.ingredients : [];
        const totalCost = Number(recipeObj.totalCost || 0) || 0;
        if (!mounted) return;
        setRecipes((prev) => {
          if (prev.some((x) => x.productId === pid2)) return prev;
          return [...prev, { productId: pid2, productName: selectedProduct.name, ingredients, totalCost }];
        });
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [recipes, selectedProduct]);

  const recipe = useMemo(() => {
    if (!selectedProduct) return null;
    return recipes.find((r) => r.productId === selectedProduct.id) ?? null;
  }, [recipes, selectedProduct]);

  const computedRecipe = useMemo(() => {
    if (!selectedProduct) return null;
    const base: Recipe = recipe ?? { productId: selectedProduct.id, productName: selectedProduct.name, ingredients: [], totalCost: 0 };

    const ingredients = base.ingredients.map((ing) => {
      const item = inventoryItems.find((x) => x.id === ing.ingredientId);
      const unitCost = item?.price ?? 0;
      return { ...ing, cost: ing.quantity * unitCost };
    });

    const totalCost = ingredients.reduce((sum, x) => sum + x.cost, 0);
    return { ...base, ingredients, totalCost };
  }, [inventoryItems, recipe, selectedProduct]);

  const totalCost = computedRecipe?.totalCost ?? 0;

  const upsertRecipe = (next: Recipe) => {
    setActionErr('');
    setRecipes((prev) => {
      const idx = prev.findIndex((r) => r.productId === next.productId);
      if (idx < 0) return [...prev, next];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });

    void (async () => {
      try {
        const qs = new URLSearchParams();
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/recipes/${encodeURIComponent(next.productId)}?${qs.toString()}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipe: {
              ingredients: next.ingredients.map((x) => ({ ...x })),
              totalCost: Number(next.totalCost || 0) || 0,
            },
          }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const msg = String(json?.error || json?.message || res.status || 'save_failed');
          setActionErr(msg);
        }
      } catch {
        setActionErr('Failed to save recipe.');
      }
    })();
  };

  const applyRecipeToMultipleProducts = () => {
    if (!computedRecipe) return;
    const selectedIds = Object.entries(bulkSelectedIds)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter((id) => id !== computedRecipe.productId);

    if (selectedIds.length === 0) {
      setBulkOpen(false);
      return;
    }

    setRecipes((prev) => {
      let next = [...prev];
      for (const pid of selectedIds) {
        const prod = products.find((p) => p.id === pid);
        if (!prod) continue;
        const clone: Recipe = {
          productId: prod.id,
          productName: prod.name,
          ingredients: computedRecipe.ingredients.map((x) => ({ ...x })),
          totalCost: computedRecipe.totalCost,
        };
        const idx = next.findIndex((r) => r.productId === prod.id);
        if (idx < 0) next = [...next, clone];
        else next = next.map((r, i) => (i === idx ? clone : r));
      }
      return next;
    });

    setBulkOpen(false);
  };

  const addIngredient = (opts?: { keepOpen?: boolean }) => {
    if (!computedRecipe) return;
    const qty = Number(draftQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const item = inventoryItems.find((x) => x.id === draftIngredientId);
    if (!item) return;

    const exists = computedRecipe.ingredients.find((x) => x.ingredientId === draftIngredientId);
    if (exists) {
      const next = {
        ...computedRecipe,
        ingredients: computedRecipe.ingredients.map((x) => (x.ingredientId === draftIngredientId ? { ...x, quantity: x.quantity + qty } : x)),
      };
      upsertRecipe(next);
    } else {
      const next = {
        ...computedRecipe,
        ingredients: [...computedRecipe.ingredients, { ingredientId: item.id, name: item.name, quantity: qty, cost: 0 }],
      };
      upsertRecipe(next);
    }

    if (!opts?.keepOpen) setAddOpen(false);
    setDraftQty('0');
  };

  const updateQty = (ingredientId: string, qty: number) => {
    if (!computedRecipe) return;
    if (!Number.isFinite(qty) || qty < 0) return;
    const next = {
      ...computedRecipe,
      ingredients: computedRecipe.ingredients.map((x) => (x.ingredientId === ingredientId ? { ...x, quantity: qty } : x)),
    };
    upsertRecipe(next);
  };

  const removeIngredient = (ingredientId: string) => {
    if (!computedRecipe) return;
    const next = { ...computedRecipe, ingredients: computedRecipe.ingredients.filter((x) => x.ingredientId !== ingredientId) };
    upsertRecipe(next);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <Header title="Recipe Editor" subtitle="Manage ingredients and costing" />

      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-hidden flex">
          <aside className="w-[320px] border-r border-border bg-background hidden lg:flex flex-col">
            <div className="p-5 border-b border-border">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Menu Items</div>
              <div className="relative flex items-center w-full h-10 rounded-lg bg-secondary border border-transparent focus-within:border-primary/50 transition-colors">
                <div className="absolute left-3 text-muted-foreground">
                  <AppIcon name="search" className="text-xl" size={20} />
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-transparent border-none text-foreground placeholder:text-muted-foreground pl-10 pr-4 text-sm focus:ring-0 h-full"
                  placeholder="Search by name or code..."
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {products
                .filter((p) => {
                  const q = query.trim().toLowerCase();
                  if (!q) return true;
                  return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
                })
                .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedProductId(p.id);
                    try {
                      localStorage.setItem(STORAGE_SELECTED_PRODUCT, p.id);
                    } catch {
                      // ignore
                    }
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent transition-colors ${selectedProductId === p.id ? 'bg-primary/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-background border border-border overflow-hidden">
                      <img alt={p.name} src={p.image} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground font-bold truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">Code: {p.code}</div>
                    </div>
                    <div className="text-primary text-sm font-bold">ETB {p.price.toFixed(2)}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-border"></div>
          </aside>

          <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
            {!selectedProduct ? (
              <div className="mx-auto max-w-5xl rounded-xl border border-border bg-card p-6 text-muted-foreground">
                Select a product to view and edit its recipe.
              </div>
            ) : (
              <div className="mx-auto max-w-5xl flex flex-col gap-6">
                {actionErr ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-900/10 p-3 text-sm text-red-200 font-medium">{actionErr}</div>
                ) : null}
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="size-14 rounded-xl bg-background border border-border overflow-hidden">
                      <img alt={selectedProduct.name} src={selectedProduct.image} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl md:text-3xl font-black tracking-tight">{selectedProduct.name}</h2>
                        <span className="text-xs font-mono px-2 py-0.5 rounded border border-border text-muted-foreground">{selectedProduct.code}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground text-sm">Category: {selectedProduct.category}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => onNavigate(Screen.MANAGER_MENU_BUILDER)}
                      className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-bold transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => setTab('history')}
                      className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-bold transition-colors"
                    >
                      History
                    </button>
                    <button
                      onClick={() => {
                        const init: Record<string, boolean> = {};
                        for (const p of products) init[p.id] = false;
                        setBulkSelectedIds(init);
                        setBulkOpen(true);
                      }}
                      className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground text-sm font-bold transition-colors"
                    >
                      Apply to Multiple
                    </button>
                    <button onClick={() => setAddOpen(true)} className="h-10 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-black transition-colors">
                      Add Ingredient
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-card border border-primary/30 rounded-xl p-5 relative overflow-hidden">
                    <div className="absolute right-0 top-0 p-5 opacity-10">
                      <AppIcon name="shopping_cart" className="text-[56px] text-primary" size={56} />
                    </div>
                    <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Total COGS</div>
                    <div className="mt-2 text-foreground text-3xl font-black">ETB {totalCost.toFixed(2)}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-5 border-b border-border flex items-center justify-between">
                    <h3 className="text-foreground text-lg font-black">Ingredients List</h3>
                    <button
                      onClick={() => setAddOpen(true)}
                      className="text-xs font-extrabold text-primary hover:text-foreground uppercase tracking-wide"
                    >
                      + Add Ingredient
                    </button>
                  </div>

                  {tab === 'history' ? (
                    <div className="p-6 text-muted-foreground space-y-3">
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="text-muted-foreground text-xs uppercase tracking-wider font-bold">Selected Item</div>
                        <div className="mt-1 text-foreground font-black text-lg">{selectedProduct?.name ?? '—'}</div>
                        <div className="text-muted-foreground text-xs font-mono">Code: {selectedProduct?.code ?? '—'} • SKU: {selectedProduct ? selectedProduct.id.slice(0, 12) : '—'}</div>
                      </div>

                      {historyLoading ? <div className="text-muted-foreground text-sm">Loading history...</div> : null}
                      {historyErr ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{historyErr}</div> : null}
                      {!historyLoading && !historyErr && historyEvents.length === 0 ? (
                        <div className="text-muted-foreground text-sm">No recent recipe/menu changes for this item.</div>
                      ) : null}

                      {historyEvents.length > 0 ? (
                        <div className="rounded-lg border border-border bg-background overflow-hidden">
                          <div className="px-3 py-2 border-b border-border text-muted-foreground text-xs uppercase tracking-wider font-bold">Recent Changes</div>
                          <div className="divide-y divide-border">
                            {historyEvents.map((e) => (
                              <div key={e.id} className="px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-foreground font-semibold text-sm">{e.summary || e.type}</div>
                                  <div className="text-muted-foreground text-[11px] font-mono">{e.at ? (formatDeviceDateTime(e.at) || '') : ''}</div>
                                </div>
                                <div className="mt-1 text-muted-foreground text-[11px]">{e.actorName ? `${e.actorName}${e.actorRole ? ` (${e.actorRole})` : ''}` : e.actorRole || ''}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-background text-muted-foreground text-xs uppercase font-bold tracking-wider">
                          <tr>
                            <th className="px-6 py-4">Ingredient</th>
                            <th className="px-6 py-4">Qty / Unit</th>
                            <th className="px-6 py-4">Unit Cost</th>
                            <th className="px-6 py-4">Line Cost</th>
                            <th className="px-6 py-4">Stock</th>
                            <th className="px-6 py-4"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-sm">
                          {(computedRecipe?.ingredients ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-muted-foreground">No ingredients yet. Add ingredients to build the recipe.</td>
                            </tr>
                          ) : (
                            (computedRecipe?.ingredients ?? []).map((ing) => {
                              const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
                              const unitCost = inv?.price ?? 0;
                              const stockLabel = inv ? `${inv.stock}${inv.unit}` : '  ';
                              const stockPill = !inv
                                ? 'bg-background text-muted-foreground border border-border'
                                : inv.stock <= 0
                                  ? 'bg-red-500/10 text-red-300 border border-red-500/20'
                                : inv.stock < inv.minStock
                                    ? 'bg-primary/10 text-primary border border-primary/20'
                                    : 'bg-green-500/10 text-green-400 border border-green-500/20';

                              return (
                                <tr key={ing.ingredientId} className="hover:bg-accent transition-colors">
                                  <td className="px-6 py-4">
                                    <div className="text-foreground font-semibold">{ing.name}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">{ing.ingredientId}</div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <input
                                      value={String(ing.quantity)}
                                      onChange={(e) => updateQty(ing.ingredientId, Number(e.target.value))}
                                      className="w-24 h-10 bg-background border border-border rounded-lg px-3 text-foreground"
                                    />
                                  </td>
                                  <td className="px-6 py-4 text-foreground font-mono">ETB {unitCost.toFixed(2)}</td>
                                  <td className="px-6 py-4 text-foreground font-mono font-bold">ETB {ing.cost.toFixed(2)}</td>
                                  <td className="px-6 py-4">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${stockPill}`}>{stockLabel}</span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button onClick={() => removeIngredient(ing.ingredientId)} className="text-red-400 hover:text-foreground text-xs font-bold">
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>

                      <div className="p-5 border-t border-border flex justify-between items-center">
                        <div className="text-muted-foreground text-sm">Recipe Total</div>
                        <div className="text-primary text-xl font-black">ETB {totalCost.toFixed(2)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <Modal
        open={addOpen}
        title="Add Ingredient"
        onClose={() => setAddOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setAddOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold">Cancel</button>
            <button onClick={() => addIngredient({ keepOpen: true })} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-extrabold">Add &amp; Continue</button>
            <button onClick={() => addIngredient()} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold">Add</button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-muted-foreground">Ingredient</label>
          <select value={draftIngredientId} onChange={(e) => setDraftIngredientId(e.target.value)} className="h-11 bg-background border border-border rounded-lg px-3 text-foreground">
            {inventoryItems.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.stock}{x.unit})
              </option>
            ))}
          </select>

          <label className="text-sm font-bold text-muted-foreground">Qty / Unit</label>
          <input value={draftQty} onChange={(e) => setDraftQty(e.target.value)} className="h-11 bg-background border border-border rounded-lg px-3 text-foreground" />
          <div className="text-xs text-muted-foreground">Use the same unit as the inventory item (e.g. kg, L, btl).</div>
        </div>
      </Modal>

      <Modal
        open={bulkOpen}
        title="Apply Recipe to Multiple Products"
        onClose={() => setBulkOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setBulkOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold">
              Cancel
            </button>
            <button onClick={applyRecipeToMultipleProducts} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold">
              Apply
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">Select products that should use the same ingredient recipe.</div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border bg-background">
            {products.map((p) => {
              const disabled = computedRecipe?.productId === p.id;
              const checked = bulkSelectedIds[p.id] ?? false;
              return (
                <label key={p.id} className={`flex items-center gap-3 px-4 py-3 border-b border-border ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-accent'}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) => setBulkSelectedIds((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                  />
                  <div className="flex flex-col">
                    <div className="text-foreground font-bold text-sm">{p.name}</div>
                    <div className="text-muted-foreground text-xs font-mono">Code: {p.code}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
};
