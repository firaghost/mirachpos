import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Modal } from '../../components/Modal';
import type { InventoryItem, Recipe, Product } from '../../types';
import { Screen } from '../../types';
import { apiFetch } from '../../api';
import { readSession } from '../../session';

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
        status: typeof x?.status === 'string' ? x.status : 'In Stock',
      };
    })
    .filter(Boolean) as InventoryItem[];
};

export const MenuBuilder: React.FC<Props> = ({ onNavigate }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_SELECTED_PRODUCT);
    } catch {
      return null;
    }
  });

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

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<string>('All');
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stockCheckOpen, setStockCheckOpen] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('Coffee');
  const [draftPrice, setDraftPrice] = useState('0');
  const [draftImage, setDraftImage] = useState('https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200');
  const [draftDescription, setDraftDescription] = useState('');

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const loadProductsAndRecipes = async () => {
    setLoading(true);
    try {
      const bid = resolveBranchId();
      const prodQs = new URLSearchParams();
      prodQs.set('limit', '500');
      if (bid) prodQs.set('branchId', bid);
      const invQs = new URLSearchParams();
      invQs.set('limit', '500');
      if (bid) invQs.set('branchId', bid);

      const [prodRes, invRes] = await Promise.all([
        apiFetch(`/api/manager/menu/products?${prodQs.toString()}`),
        apiFetch(`/api/inventory/items?${invQs.toString()}`),
      ]);

      const prodJson = (await prodRes.json().catch(() => null)) as any;
      const invJson = (await invRes.json().catch(() => null)) as any;
      if (!prodRes.ok) throw new Error(prodJson?.error || `HTTP ${prodRes.status}`);
      if (!invRes.ok) throw new Error(invJson?.error || `HTTP ${invRes.status}`);

      const rows = Array.isArray(prodJson?.products) ? (prodJson.products as any[]) : [];
      const nextProducts: Product[] = rows.map((p) => ({
        id: String(p.id || ''),
        code: String(p.code || ''),
        name: String(p.name || ''),
        price: Number(p.price ?? 0) || 0,
        category: String(p.category || 'Uncategorized'),
        image: String(p.image || ''),
        description: typeof p.description === 'string' ? p.description : '',
        stock: Number((p as any)?.stock ?? 500) || 500,
      }));
      setProducts(nextProducts.filter((p) => p.id && p.name));

      const invRows = Array.isArray(invJson?.items) ? (invJson.items as any[]) : [];
      setInventoryItems(mapInventoryItems(invRows));

      const ids = nextProducts.map((p) => p.id).filter(Boolean);
      if (ids.length) {
        const recQs = new URLSearchParams();
        recQs.set('productIds', ids.join(','));
        if (bid) recQs.set('branchId', bid);
        const recRes = await apiFetch(`/api/manager/menu/recipes?${recQs.toString()}`);
        const recJson = (await recRes.json().catch(() => null)) as any;
        if (!recRes.ok) throw new Error(recJson?.error || `HTTP ${recRes.status}`);

        const rows2 = Array.isArray(recJson?.recipes) ? (recJson.recipes as any[]) : [];
        const byId = new Map<string, any>();
        for (const r of rows2) {
          const pid = typeof r?.productId === 'string' ? r.productId : '';
          if (!pid) continue;
          const recipeObj = r?.recipe && typeof r.recipe === 'object' ? r.recipe : r;
          byId.set(pid, recipeObj);
        }

        const nextRecipes: Recipe[] = [];
        for (const p of nextProducts) {
          const rr = byId.get(p.id);
          if (!rr) continue;
          const ingredients = Array.isArray(rr.ingredients) ? rr.ingredients : [];
          nextRecipes.push({ productId: p.id, productName: p.name, ingredients, totalCost: Number(rr.totalCost || 0) || 0 });
        }
        setRecipes(nextRecipes);
      } else {
        setRecipes([]);
      }
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load menu.' });
      setProducts([]);
      setRecipes([]);
      setInventoryItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProductsAndRecipes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (selectedProductId) localStorage.setItem(STORAGE_SELECTED_PRODUCT, selectedProductId);
    } catch {
      // ignore
    }
  }, [selectedProductId]);

  const selectedRecipe = useMemo(() => {
    if (!selectedProduct) return null;
    return recipes.find((r) => r.productId === selectedProduct.id) ?? null;
  }, [recipes, selectedProduct]);

  const selectedMenuSku = selectedProduct ? selectedProduct.id : '';

  const computedTotalCost = useMemo(() => {
    if (!selectedProduct) return 0;
    const ings = selectedRecipe?.ingredients ?? [];
    return ings.reduce((sum, ing) => {
      const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
      const unitCost = inv?.price ?? 0;
      return sum + ing.quantity * unitCost;
    }, 0);
  }, [inventoryItems, selectedProduct, selectedRecipe?.ingredients]);

  const grossMarginPct = useMemo(() => {
    if (!selectedProduct) return 0;
    const sell = selectedProduct.price;
    const cost = computedTotalCost;
    return sell > 0 ? ((sell - cost) / sell) * 100 : 0;
  }, [computedTotalCost, selectedProduct]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(p.category);
    return ['All', ...Array.from(set.values()).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const chipFilteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const matchesChip = chip === 'All' ? true : p.category === chip;
      const matchesQuery = q.length === 0 ? true : p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
      return matchesChip && matchesQuery;
    });
  }, [chip, products, query]);

  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editImage, setEditImage] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [forecastUnits, setForecastUnits] = useState(150);

  useEffect(() => {
    if (!selectedProduct) return;
    setEditName(selectedProduct.name);
    setEditCategory(selectedProduct.category);
    setEditPrice(String(selectedProduct.price));
    setEditImage(selectedProduct.image);
    setEditDescription(selectedProduct.description ?? '');
  }, [selectedProduct]);

  const saveEdits = () => {
    if (!selectedProduct) return;
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    (async () => {
      try {
        const qs = new URLSearchParams();
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/products/${encodeURIComponent(selectedProduct.id)}?${qs.toString()}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName,
            category: editCategory,
            price,
            image: editImage,
            description: editDescription,
          }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setEditOpen(false);
        setFlash({ kind: 'success', message: 'Menu item updated.' });
        await loadProductsAndRecipes();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update item.' });
      }
    })();
  };

  const computeMenuStatus = (productId: string): { label: 'Active' | 'Low Stock' | 'No Recipe'; tone: 'ok' | 'warn' | 'bad' } => {
    const recipe = recipes.find((r) => r.productId === productId);
    const ings = recipe?.ingredients ?? [];
    if (ings.length === 0) return { label: 'No Recipe', tone: 'bad' };

    for (const ing of ings) {
      const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
      if (!inv) return { label: 'Low Stock', tone: 'warn' };
      if (inv.stock <= 0) return { label: 'Low Stock', tone: 'warn' };
      if (inv.stock < inv.minStock) return { label: 'Low Stock', tone: 'warn' };
    }

    return { label: 'Active', tone: 'ok' };
  };

  const confirmDelete = () => {
    if (!selectedProduct) return;
    (async () => {
      try {
        const qs = new URLSearchParams();
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/products/${encodeURIComponent(selectedProduct.id)}?${qs.toString()}`, { method: 'DELETE' });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setDeleteOpen(false);
        if (selectedProductId === selectedProduct.id) setSelectedProductId(null);
        setFlash({ kind: 'success', message: 'Menu item deleted.' });
        await loadProductsAndRecipes();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete item.' });
      }
    })();
  };

  const createMenuItem = () => {
    const price = Number(draftPrice);
    if (!draftName.trim() || !draftCategory.trim() || !draftImage.trim()) return;
    if (!Number.isFinite(price) || price <= 0) return;
    (async () => {
      try {
        const qs = new URLSearchParams();
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/products?${qs.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: draftName,
            category: draftCategory,
            price,
            image: draftImage,
            description: draftDescription,
          }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        const id = String(json?.id || '').trim();
        setNewOpen(false);
        setDraftName('');
        setDraftCategory('Coffee');
        setDraftPrice('0');
        setDraftImage('https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200');
        setDraftDescription('');
        if (id) setSelectedProductId(id);
        setFlash({ kind: 'success', message: 'Menu item created.' });
        await loadProductsAndRecipes();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create item.' });
      }
    })();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden overflow-x-hidden bg-[#221c10] text-white">
      <div className="flex-none border-b border-[#483c23] bg-[#221c10]">
        <Header title="Inventory / Recipes" subtitle="Menu items, recipe usage & analytics" />
      </div>

      <div className="flex-none px-4 pt-3">
        {flash ? (
          <div
            className={`rounded-xl border px-4 py-3 text-xs font-bold ${
              flash.kind === 'success'
                ? 'border-green-500/30 bg-green-500/10 text-green-200'
                : 'border-red-500/30 bg-red-500/10 text-red-200'
            }`}
          >
            {flash.message}
          </div>
        ) : null}
        {loading ? (
          <div className="mt-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-muted font-bold">
            Loading menu data ¦
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden flex overflow-x-hidden min-w-0">
        <aside className="w-full max-w-[380px] flex flex-col border-r border-[#483c23] bg-[#2d2616]/30">
          <div className="p-5 pb-2 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="text-primary/80 font-medium">Inventory</span>
              <span className="text-white/30">/</span>
              <span className="text-white font-medium">Recipes</span>
            </div>

            <div className="flex flex-col gap-1">
              <h1 className="text-white tracking-tight text-2xl font-bold">Menu Items</h1>
              <p className="text-text-muted text-xs">Select an item to view recipe & usage</p>
            </div>

            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-primary/70">search</span>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-[#483c23]/50 text-white placeholder:text-white/30 rounded-lg pl-10 pr-4 py-2.5 text-sm border border-transparent focus:border-primary focus:ring-0 focus:bg-[#483c23] transition-all"
                placeholder="Search by name or code..."
              />
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              {categories.slice(0, 6).map((c) => (
                <button
                  key={c}
                  onClick={() => setChip(c)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold shadow-sm border transition-all ${
                    chip === c
                      ? 'bg-primary text-[#221c10] border-primary'
                      : 'bg-[#483c23] text-white/70 hover:text-white border-transparent hover:border-white/10'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1 min-w-0">
            {chipFilteredProducts.map((p) => {
              const selected = p.id === selectedProductId;
              const status = computeMenuStatus(p.id);
              const pill =
                status.tone === 'ok'
                  ? 'text-green-400 bg-green-400/10 border-green-400/20'
                  : status.tone === 'warn'
                    ? 'text-orange-400 bg-orange-400/10 border-orange-400/20'
                    : 'text-red-400 bg-red-400/10 border-red-400/20';
              const icon = status.tone === 'ok' ? 'check_circle' : status.tone === 'warn' ? 'warning' : 'error';
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className={`group w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer relative overflow-hidden text-left transition-all ${
                    selected ? 'bg-primary/10 border-primary/30' : 'hover:bg-white/5 border-transparent hover:border-white/10'
                  }`}
                >
                  {selected ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" /> : null}
                  <div className="size-12 rounded-lg bg-cover bg-center shrink-0 shadow-inner" style={{ backgroundImage: `url('${p.image}')` }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h4 className="text-white font-semibold text-sm truncate">{p.name}</h4>
                      <span className="text-primary font-bold text-sm">ETB {p.price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-white/50 text-[11px] leading-tight">
                        <span className="font-mono">Code: {p.code}</span>
                        <span className="text-white/30">    </span>
                        <span className="font-mono">SKU: {p.id.slice(0, 8)}</span>
                      </p>
                      <span
                        className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${pill}`}
                      >
                        <span className="material-symbols-outlined text-[10px]">{icon}</span>
                        {status.label}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-[#483c23]">
            <button
              onClick={() => setNewOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 text-white py-2.5 text-sm font-bold transition-all"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              New Menu Item
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 bg-[#221c10] relative overflow-x-hidden min-w-0">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
          {!selectedProduct ? (
            <div className="max-w-5xl w-full mx-auto rounded-xl border border-[#483c23] bg-[#2d2616] p-5 text-white/60">
              Select a menu item to view details.
            </div>
          ) : (
            <div className="max-w-5xl w-full mx-auto flex flex-col gap-5 relative z-0 min-w-0">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-5 border-b border-[#483c23]/50">
                <div className="flex items-start gap-4">
                  <div className="size-20 md:size-24 rounded-2xl bg-cover bg-center shadow-lg border-2 border-[#483c23]" style={{ backgroundImage: `url('${selectedProduct.image}')` }} />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{selectedProduct.name}</h2>
                      <span className="px-2 py-0.5 rounded border border-white/20 text-white/60 text-xs font-mono">{selectedProduct.code}</span>
                    </div>
                    <p className="text-white/60 max-w-md text-sm leading-relaxed">{selectedProduct.description ?? ''}</p>
                    <div className="mt-2 text-white/40 text-xs font-mono">
                      SKU: {selectedMenuSku.slice(0, 12)}
                    </div>
                    <div className="flex gap-4 mt-3">
                      <div className="flex items-center gap-1.5 text-primary text-sm font-medium">
                        <span className="material-symbols-outlined text-lg">category</span>
                        {selectedProduct.category}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 md:gap-3">
                  <button
                    onClick={() => setHistoryOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2d2616] border border-[#483c23] text-white hover:bg-[#483c23] transition-all text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-lg">history</span> History
                  </button>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2d2616] border border-[#483c23] text-white hover:bg-[#483c23] transition-all text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-lg">edit</span> Edit Menu
                  </button>
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2d2616] border border-[#483c23] text-red-200 hover:bg-red-500/10 hover:border-red-400/40 transition-all text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span> Delete
                  </button>
                  <button
                    onClick={() => onNavigate(Screen.MANAGER_RECIPE_BUILDER)}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-[#221c10] font-bold transition-all shadow-lg shadow-primary/20 text-sm"
                  >
                    <span className="material-symbols-outlined text-lg">edit_note</span> Edit Recipe
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-[#2d2616] border border-[#483c23] relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <span className="material-symbols-outlined text-6xl text-white">payments</span>
                  </div>
                  <p className="text-white/50 text-sm font-medium mb-1">Selling Price</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-white">ETB {selectedProduct.price.toFixed(2)}</h3>
                    <span className="text-xs text-white/40">per unit</span>
                  </div>
                  <div className="h-1 w-full bg-white/10 mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-white w-full rounded-full" />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-[#2d2616] border border-[#483c23] relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <span className="material-symbols-outlined text-6xl text-red-400">shopping_cart</span>
                  </div>
                  <p className="text-white/50 text-sm font-medium mb-1">Total COGS</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-white">ETB {computedTotalCost.toFixed(2)}</h3>
                  </div>
                  <div className="h-1 w-full bg-white/10 mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 w-[24%] rounded-full" />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-[#2d2616] to-primary/10 border border-primary/30 relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-20 group-hover:opacity-30 transition-opacity">
                    <span className="material-symbols-outlined text-6xl text-primary">pie_chart</span>
                  </div>
                  <p className="text-primary/80 text-sm font-medium mb-1">Gross Margin</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-primary">{grossMarginPct.toFixed(0)}%</h3>
                    <span className="text-xs text-primary/70">(ETB {(selectedProduct.price - computedTotalCost).toFixed(2)} profit)</span>
                  </div>
                  <div className="h-1 w-full bg-white/10 mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-primary w-[76%] rounded-full shadow-[0_0_10px_rgba(238,173,43,0.5)]" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-w-0">
                <div className="xl:col-span-2 flex flex-col bg-[#2d2616] rounded-xl border border-[#483c23] shadow-sm overflow-hidden min-w-0">
                  <div className="p-5 border-b border-[#483c23] flex justify-between items-center bg-white/5">
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">kitchen</span>
                      Ingredients List
                    </h3>
                    <button
                      onClick={() => onNavigate(Screen.MANAGER_RECIPE_BUILDER)}
                      className="text-xs text-primary hover:text-white font-medium flex items-center gap-1 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      Add Ingredient
                    </button>
                  </div>

                  <div className="max-w-full overflow-hidden">
                    <table className="w-full text-left border-collapse table-fixed">
                      <thead>
                        <tr className="text-xs text-white/40 uppercase tracking-wider border-b border-[#483c23] bg-white/[0.02]">
                          <th className="px-5 py-3 font-semibold w-[42%]">Ingredient</th>
                          <th className="px-4 py-3 font-semibold w-[14%]">Qty</th>
                          <th className="px-4 py-3 font-semibold w-[12%] hidden sm:table-cell">Unit</th>
                          <th className="px-4 py-3 font-semibold w-[18%]">Cost</th>
                          <th className="px-4 py-3 pr-5 font-semibold w-[14%]">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-[#483c23]">
                        {(selectedRecipe?.ingredients?.length ?? 0) === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-white/60">
                              No ingredients yet. Click  Å“Edit Recipe  to add ingredients.
                            </td>
                          </tr>
                        ) : (
                          selectedRecipe!.ingredients.map((ing) => {
                            const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
                            const unitCost = inv?.price ?? 0;
                            const lineCost = ing.quantity * unitCost;
                            const stockState = !inv ? 'missing' : inv.stock <= 0 ? 'zero' : inv.stock < inv.minStock ? 'low' : 'high';
                            const pill =
                              stockState === 'high'
                                ? 'bg-green-400/10 text-green-400 border border-green-400/20'
                                : stockState === 'low'
                                  ? 'bg-orange-400/10 text-orange-400 border border-orange-400/20'
                                  : stockState === 'zero'
                                    ? 'bg-red-400/10 text-red-400 border border-red-400/20'
                                    : 'bg-white/10 text-white/60 border border-white/10';
                            const stockLabel = !inv ? '  ' : inv.stock < inv.minStock ? 'Low' : 'High';
                            return (
                              <tr key={ing.ingredientId} className="group hover:bg-white/[0.02] transition-colors">
                                <td className="px-5 py-4 align-top">
                                  <div className="flex items-center gap-3">
                                    <div className="size-8 rounded bg-white/10 flex items-center justify-center text-white/50">
                                      <span className="material-symbols-outlined text-lg">science</span>
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-medium text-white truncate">{ing.name}</span>
                                      <span className="text-[10px] text-white/40 font-mono truncate">{ing.ingredientId}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-white/80 align-top">
                                  <div className="flex flex-col">
                                    <span className="tabular-nums">{ing.quantity}</span>
                                    <span className="text-[10px] text-white/40 sm:hidden truncate">{inv?.unit ?? ''}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-white/50 hidden sm:table-cell align-top">{inv?.unit ?? ''}</td>
                                <td className="px-4 py-4 font-medium text-white align-top">
                                  <div className="flex flex-col">
                                    <span className="tabular-nums">ETB {lineCost.toFixed(2)}</span>
                                    <span className="text-[10px] text-white/40 tabular-nums">ETB {unitCost.toFixed(2)} / unit</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4 pr-5 align-top">
                                  <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${pill}`}>{stockLabel}</span>
                                </td>
                              </tr>
                            );
                          })
                        )}

                        <tr className="bg-primary/5">
                          <td className="px-5 py-3 font-bold text-white text-right" colSpan={3}>
                            Recipe Total
                          </td>
                          <td className="px-4 py-3 font-bold text-primary text-base" colSpan={2}>
                            ETB {computedTotalCost.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div className="p-6 rounded-xl bg-[#2d2616] border border-[#483c23] flex flex-col gap-4">
                    <h3 className="text-white font-bold text-sm uppercase tracking-wide opacity-80">Cost Composition</h3>

                    {(() => {
                      const ings = selectedRecipe?.ingredients ?? [];
                      const rows = ings
                        .map((ing) => {
                          const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
                          const unitCost = inv?.price ?? 0;
                          const cost = ing.quantity * unitCost;
                          return { id: ing.ingredientId, name: ing.name, cost };
                        })
                        .filter((x) => x.cost > 0)
                        .sort((a, b) => b.cost - a.cost)
                        .slice(0, 3);

                      const total = rows.reduce((s, r) => s + r.cost, 0);
                      const colors = ['#eead2b', '#8a7042', '#483c23'];
                      const parts = rows.map((r, idx) => ({ ...r, pct: total > 0 ? (r.cost / total) * 100 : 0, color: colors[idx] }));
                      const gradientStops = (() => {
                        let acc = 0;
                        const stops: string[] = [];
                        for (const p of parts) {
                          const start = acc;
                          acc += p.pct;
                          stops.push(`${p.color} ${start}% ${acc}%`);
                        }
                        if (acc < 100) stops.push(`#2d2616 ${acc}% 100%`);
                        return stops.join(', ');
                      })();

                      return (
                        <div className="flex items-center gap-6">
                          <div
                            className="shrink-0 flex items-center justify-center relative"
                            style={{
                              width: 120,
                              height: 120,
                              borderRadius: '50%',
                              background: `conic-gradient(${gradientStops})`,
                            }}
                          >
                            <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: '#2d2616' }} />
                          </div>
                          <div className="flex flex-col gap-3 flex-1">
                            {parts.length === 0 ? (
                              <div className="text-white/50 text-sm">No cost data (add ingredients)</div>
                            ) : (
                              parts.map((p) => (
                                <div key={p.id} className="flex items-center justify-between text-xs">
                                  <span className="flex items-center gap-2 text-white/70">
                                    <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} /> {p.name}
                                  </span>
                                  <span className="text-white font-medium">{p.pct.toFixed(0)}%</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="p-6 rounded-xl bg-gradient-to-b from-[#2d2616] to-[#2d2616]/50 border border-[#483c23] flex flex-col gap-4">
                    <div className="flex justify-between items-center mb-1">
                      <h3 className="text-white font-bold text-sm uppercase tracking-wide opacity-80 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-lg">calculate</span>
                        Usage Forecaster
                      </h3>
                      <div className="group relative">
                        <span className="material-symbols-outlined text-white/30 text-sm cursor-help">info</span>
                        <div className="absolute right-0 bottom-full mb-2 w-48 p-2 bg-black/90 text-white text-[10px] rounded hidden group-hover:block z-10">
                          Estimate stock usage based on sales volume.
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-white/60">Projected Sales Volume (units)</label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={String(forecastUnits)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setForecastUnits(Math.max(0, Math.min(500, Math.floor(n))));
                          }}
                          className="flex-1 min-w-[140px] bg-[#483c23] text-white rounded-lg px-3 py-2 text-sm border-none focus:ring-1 focus:ring-primary font-bold text-right"
                          type="number"
                        />
                        <span className="shrink-0 flex items-center px-3 rounded-lg bg-white/5 text-white/40 text-xs">Units</span>
                      </div>
                      <input
                        className="w-full h-1.5 bg-[#483c23] rounded-lg appearance-none cursor-pointer accent-primary mt-2"
                        max={500}
                        min={0}
                        type="range"
                        value={forecastUnits}
                        onChange={(e) => setForecastUnits(Number(e.target.value))}
                      />
                    </div>

                    {(() => {
                      const ings = selectedRecipe?.ingredients ?? [];
                      const totals = ings.map((ing) => {
                        const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
                        const req = ing.quantity * forecastUnits;
                        return { id: ing.ingredientId, name: ing.name, req, unit: inv?.unit ?? '', cost: req * (inv?.price ?? 0) };
                      });
                      const top = totals.sort((a, b) => b.req - a.req).slice(0, 2);
                      const costImpact = totals.reduce((s, t) => s + t.cost, 0);
                      return (
                        <div className="mt-2 pt-4 border-t border-[#483c23] space-y-3">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-white/60">Top Ingredient 1</span>
                            <span className="text-primary font-bold">
                              {top[0] ? `${top[0].req.toFixed(2)} ${top[0].unit}` : '  '}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-white/60">Top Ingredient 2</span>
                            <span className="text-white font-medium">
                              {top[1] ? `${top[1].req.toFixed(2)} ${top[1].unit}` : '  '}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-white/60">Total Cost Impact</span>
                            <span className="text-white font-medium">ETB {costImpact.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    <button
                      onClick={() => setStockCheckOpen(true)}
                      className="mt-2 w-full py-2 rounded border border-primary/30 text-primary hover:bg-primary hover:text-[#221c10] transition-all text-xs font-bold uppercase tracking-wider"
                    >
                      Check Stock Availability
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <Modal
        open={newOpen}
        title="New Menu Item"
        onClose={() => setNewOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setNewOpen(false)} className="flex-1 h-11 rounded-lg bg-[#483c23] hover:bg-[#6b5a36] border border-[#483c23] text-white font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={createMenuItem} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-[#221c10] font-extrabold transition-colors">
              Create
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-white/70">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Category</label>
          <input value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Selling Price (ETB)</label>
          <input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Image URL</label>
          <input value={draftImage} onChange={(e) => setDraftImage(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Description</label>
          <textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} className="min-h-[90px] w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />
        </div>
      </Modal>

      <Modal
        open={editOpen}
        title={selectedProduct ? `Edit Menu: ${selectedProduct.name}` : 'Edit Menu'}
        onClose={() => setEditOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setEditOpen(false)} className="flex-1 h-11 rounded-lg bg-[#483c23] hover:bg-[#6b5a36] border border-[#483c23] text-white font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={saveEdits} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-[#221c10] font-extrabold transition-colors">
              Save
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-white/70">Name</label>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Category</label>
          <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Selling Price (ETB)</label>
          <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Image URL</label>
          <input value={editImage} onChange={(e) => setEditImage(e.target.value)} className="w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />

          <label className="text-sm font-bold text-white/70">Description</label>
          <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-[90px] w-full bg-[#2d2616] border border-[#483c23] rounded-lg px-3 py-2 text-sm text-white" />
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        title="Delete Menu Item"
        onClose={() => setDeleteOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setDeleteOpen(false)} className="flex-1 h-11 rounded-lg bg-[#483c23] hover:bg-[#6b5a36] border border-[#483c23] text-white font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={confirmDelete} className="flex-1 h-11 rounded-lg bg-red-500/90 hover:bg-red-500 text-white font-extrabold transition-colors">
              Delete
            </button>
          </div>
        }
      >
        <div className="text-white/70 text-sm">
          This will permanently delete the menu item and remove its recipe mapping.
        </div>
      </Modal>

      <Modal
        open={historyOpen}
        title="History"
        onClose={() => setHistoryOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setHistoryOpen(false)} className="flex-1 h-11 rounded-lg bg-[#483c23] hover:bg-[#6b5a36] border border-[#483c23] text-white font-semibold transition-colors">
              Close
            </button>
          </div>
        }
      >
        <div className="text-white/70 text-sm space-y-3">
          <div>This section will show recent recipe/menu changes and recent orders for this item.</div>
          <div className="rounded-lg border border-[#483c23] bg-[#2d2616] p-3">
            <div className="text-white/50 text-xs uppercase tracking-wider">Selected Item</div>
            <div className="mt-1 text-white font-semibold">{selectedProduct?.name ?? '  '}</div>
            <div className="text-white/40 text-xs font-mono">Code: {selectedProduct?.code ?? '  '}    SKU: {selectedProduct ? selectedProduct.id.slice(0, 12) : '  '}</div>
          </div>
          <div className="text-white/50 text-xs">(Not yet connected to order logs in this screen.)</div>
        </div>
      </Modal>

      <Modal
        open={stockCheckOpen}
        title="Stock Availability"
        onClose={() => setStockCheckOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setStockCheckOpen(false)} className="flex-1 h-11 rounded-lg bg-[#483c23] hover:bg-[#6b5a36] border border-[#483c23] text-white font-semibold transition-colors">
              Close
            </button>
          </div>
        }
      >
        {(() => {
          const ings = selectedRecipe?.ingredients ?? [];
          const rows = ings.map((ing) => {
            const inv = inventoryItems.find((x) => x.id === ing.ingredientId);
            const required = ing.quantity * forecastUnits;
            const available = inv?.stock ?? 0;
            const ok = inv ? available >= required : false;
            return { id: ing.ingredientId, name: ing.name, unit: inv?.unit ?? '', required, available, ok };
          });
          const missing = rows.filter((r) => !r.ok);
          return (
            <div className="space-y-3">
              <div className="text-white/70 text-sm">
                Projected units:
                <span className="text-white font-semibold"> {forecastUnits}</span>
              </div>

              <div className="rounded-lg border border-[#483c23] overflow-hidden">
                <div className="max-w-full overflow-x-auto">
                  <table className="min-w-[520px] w-full text-left text-sm">
                    <thead className="bg-white/[0.03]">
                      <tr className="text-xs text-white/40 uppercase tracking-wider border-b border-[#483c23]">
                        <th className="px-4 py-2">Ingredient</th>
                        <th className="px-4 py-2">Required</th>
                        <th className="px-4 py-2">Available</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#483c23]">
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-white/60">
                            No recipe ingredients.
                          </td>
                        </tr>
                      ) : (
                        rows.map((r) => (
                          <tr key={r.id} className="hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-white">{r.name}</td>
                            <td className="px-4 py-3 text-white/70">
                              {r.required.toFixed(2)} {r.unit}
                            </td>
                            <td className="px-4 py-3 text-white/70">
                              {r.available.toFixed(2)} {r.unit}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium border ${
                                  r.ok
                                    ? 'text-green-400 bg-green-400/10 border-green-400/20'
                                    : 'text-orange-400 bg-orange-400/10 border-orange-400/20'
                                }`}
                              >
                                <span className="material-symbols-outlined text-[14px]">{r.ok ? 'check' : 'warning'}</span>
                                {r.ok ? 'OK' : 'Short'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {missing.length === 0 ? (
                <div className="text-green-400 text-sm font-semibold">All ingredients have enough stock for this forecast.</div>
              ) : (
                <div className="text-orange-400 text-sm font-semibold">Some ingredients are short for this forecast.</div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};
