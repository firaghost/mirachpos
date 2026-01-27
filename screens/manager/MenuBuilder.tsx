import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Modal } from '../../components/Modal';
import type { InventoryItem, Recipe, Product } from '../../types';
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
  const [currency, setCurrency] = useState('ETB');
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string>('');
  const [historyEvents, setHistoryEvents] = useState<
    Array<{ id: string; at: string; type: string; summary: string; actorName?: string; actorRole?: string }>
  >([]);

  const [selectedProductId, setSelectedProductId] = usePersistedNullableString(STORAGE_SELECTED_PRODUCT, null);

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

  const [draftImageUploading, setDraftImageUploading] = useState(false);
  const [editImageUploading, setEditImageUploading] = useState(false);

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);

  useEffect(() => {
    if (!historyOpen) return;
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

        const rows = Array.isArray(json?.audit) ? json.audit : [];
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
          .slice(0, 20)
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
              if (t === 'menu_product.updated') return `Updated menu item: ${productName}`;
              if (t === 'menu_product.created') return `Created menu item: ${productName}`;
              if (t === 'menu_product.deleted') return `Deleted menu item: ${productName}`;
              return t || 'Update';
            })(),
            actorName: typeof r?.actorName === 'string' ? r.actorName : '',
            actorRole: typeof r?.actorRole === 'string' ? r.actorRole : '',
          }));
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
  }, [historyOpen, selectedProduct]);

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

      const prodRes = await apiFetch(`/api/manager/menu/products?${prodQs.toString()}`);
      const prodJson = (await prodRes.json().catch(() => null)) as any;
      if (!prodRes.ok) throw new Error(prodJson?.error || `HTTP ${prodRes.status}`);

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

      // Inventory is optional for this screen (used for cost/stock warnings). Don't fail the whole load.
      try {
        const invRes = await apiFetch(`/api/inventory/items?${invQs.toString()}`);
        const invJson = (await invRes.json().catch(() => null)) as any;
        if (invRes.ok) {
          const invRows = Array.isArray(invJson?.items) ? (invJson.items as any[]) : [];
          setInventoryItems(mapInventoryItems(invRows));
        } else {
          throw new Error(String(invJson?.error || invJson?.message || invRes.status));
        }
      } catch {
        // Fallback for Cafe Owner sessions (when using manager menu builder while owner is logged in)
        try {
          const s = readSession<any>();
          const role = typeof s?.role === 'string' ? s.role : '';
          if (role === 'Cafe Owner') {
            const qs = new URLSearchParams();
            if (bid) qs.set('branchId', bid);
            const res2 = await apiFetch(`/api/owner/inventory?${qs.toString()}`);
            const json2 = (await res2.json().catch(() => null)) as any;
            const rows2 = Array.isArray(json2?.items) ? json2.items : [];
            const mapped = rows2.map((it: any) => ({
              id: String(it?.sku || it?.id || ''),
              name: String(it?.name || ''),
              category: String(it?.category || 'Raw Material'),
              stock: Number(it?.globalQty ?? 0) || 0,
              unit: String(it?.unit || ''),
              minStock: Number(it?.minQty ?? 0) || 0,
              price: Number(it?.cost ?? it?.price ?? 0) || 0,
              status: String(it?.status || 'In Stock'),
            }));
            setInventoryItems(mapInventoryItems(mapped));
          } else {
            setInventoryItems([]);
          }
        } catch {
          setInventoryItems([]);
        }
      }

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
    const loadCurrency = async () => {
      try {
        const bid = resolveBranchId();
        const qs = bid ? `?branchId=${encodeURIComponent(bid)}` : '';
        const res = await apiFetch(`/api/manager/settings${qs}`);
        const json = await res.json().catch(() => null);
        if (res.ok && json?.settings?.general?.currency) {
          setCurrency(json.settings.general.currency);
        }
      } catch {
        // ignore
      }
    };
    void loadCurrency();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selectedProductId is persisted via usePersistedState

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

  const uploadImage = async (file: File) => {
    const readAsDataUrl = (f: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(f);
      });

    const loadImage = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Invalid image.'));
        img.src = src;
      });

    const original = await readAsDataUrl(file);
    const img = await loadImage(original);
    const max = 640;
    const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
    const w = Math.max(1, Math.round((img.width || 1) * scale));
    const h = Math.max(1, Math.round((img.height || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_not_supported');
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/webp', 0.45);

    const res = await apiFetch('/api/owner/uploads/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename: file.name.replace(/\.[^.]+$/, '.webp') }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(json?.error || String(res.status));
    const url = String(json?.url || '').trim();
    if (!url) throw new Error('upload_failed');
    return url;
  };

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
    <div className="flex flex-col h-full overflow-hidden overflow-x-hidden bg-background text-foreground">
      <div className="flex-none border-b border-border bg-background">
        <Header title="Inventory / Recipes" subtitle="Menu items, recipe usage & analytics" />
      </div>

      <div className="flex-none px-4 pt-3">
        {flash ? (
          <div
            className={`rounded-xl border px-4 py-3 text-xs font-bold ${flash.kind === 'success'
                ? 'border-green-500/30 bg-green-500/10 text-green-200'
                : 'border-red-500/30 bg-red-500/10 text-red-200'
              }`}
          >
            {flash.message}
          </div>
        ) : null}
        {loading ? (
          <div className="mt-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground font-bold">
            Loading menu data
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden flex overflow-x-hidden min-w-0">
        <aside className="w-full max-w-[380px] flex flex-col border-r border-border bg-card/30">
          <div className="p-5 pb-2 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="text-primary/80 font-medium">Inventory</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-foreground font-medium">Recipes</span>
            </div>

            <div className="flex flex-col gap-1">
              <h1 className="text-foreground tracking-tight text-2xl font-bold">Menu Items</h1>
              <p className="text-muted-foreground text-xs">Select an item to view recipe & usage</p>
            </div>

            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <AppIcon name="search" className="text-primary/70" />
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-background text-foreground placeholder:text-muted-foreground rounded-lg pl-10 pr-4 py-2.5 text-sm border border-border focus:border-primary focus:ring-0 transition-all"
                placeholder="Search by name or code..."
              />
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              {categories.slice(0, 6).map((c) => (
                <button
                  key={c}
                  onClick={() => setChip(c)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold shadow-sm border transition-all ${chip === c
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary text-muted-foreground hover:text-foreground border-transparent hover:border-border'
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
                  className={`group w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer relative overflow-hidden text-left transition-all ${selected ? 'bg-primary/10 border-primary/30' : 'hover:bg-accent border-transparent hover:border-border'
                    }`}
                >
                  {selected ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" /> : null}
                  <div className="size-12 rounded-lg bg-cover bg-center shrink-0 shadow-inner" style={{ backgroundImage: `url('${p.image}')` }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h4 className="text-foreground font-semibold text-sm truncate">{p.name}</h4>
                      <span className="text-primary font-bold text-sm">{currency} {p.price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-muted-foreground text-[11px] leading-tight">
                        <span className="font-mono">Code: {p.code}</span>
                        <span className="text-muted-foreground">    </span>
                        <span className="font-mono">SKU: {p.id.slice(0, 8)}</span>
                      </p>
                      <span
                        className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${pill}`}
                      >
                        <AppIcon name={icon} className="text-[10px]" size={10} />
                        {status.label}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-border">
            <button
              onClick={() => setNewOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground py-2.5 text-sm font-bold transition-all"
            >
              <AppIcon name="add" className="text-lg" size={18} />
              New Menu Item
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 bg-background relative overflow-x-hidden min-w-0">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
          {!selectedProduct ? (
            <div className="max-w-5xl w-full mx-auto rounded-xl border border-border bg-card p-5 text-muted-foreground">
              Select a menu item to view details.
            </div>
          ) : (
            <div className="max-w-5xl w-full mx-auto flex flex-col gap-5 relative z-0 min-w-0">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-5 border-b border-border/50">
                <div className="flex items-start gap-4">
                  <div className="size-20 md:size-24 rounded-2xl bg-cover bg-center shadow-lg border-2 border-border" style={{ backgroundImage: `url('${selectedProduct.image}')` }} />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">{selectedProduct.name}</h2>
                      <span className="px-2 py-0.5 rounded border border-border text-muted-foreground text-xs font-mono">{selectedProduct.code}</span>
                    </div>
                    <p className="text-muted-foreground max-w-md text-sm leading-relaxed">{selectedProduct.description ?? ''}</p>
                    <div className="mt-2 text-muted-foreground text-xs font-mono">
                      SKU: {selectedMenuSku.slice(0, 12)}
                    </div>
                    <div className="flex gap-4 mt-3">
                      <div className="flex items-center gap-1.5 text-primary text-sm font-medium">
                        <AppIcon name="category" className="text-lg" size={18} />
                        {selectedProduct.category}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 md:gap-3">
                  <button
                    onClick={() => setHistoryOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-foreground hover:bg-accent transition-all text-sm font-medium"
                  >
                    <AppIcon name="history" className="text-lg" size={18} /> History
                  </button>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-foreground hover:bg-accent transition-all text-sm font-medium"
                  >
                    <AppIcon name="edit" className="text-lg" size={18} /> Edit Menu
                  </button>
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-red-200 hover:bg-red-500/10 hover:border-red-400/40 transition-all text-sm font-medium"
                  >
                    <AppIcon name="delete" className="text-lg" size={18} /> Delete
                  </button>
                  <button
                    onClick={() => onNavigate(Screen.MANAGER_RECIPE_BUILDER)}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold transition-all shadow-lg shadow-primary/20 text-sm"
                  >
                    <AppIcon name="edit_note" className="text-lg" size={18} /> Edit Recipe
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-card border border-border relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <AppIcon name="payments" className="text-6xl text-foreground" size={60} />
                  </div>
                  <p className="text-muted-foreground text-sm font-medium mb-1">Selling Price</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-foreground">{currency} {selectedProduct.price.toFixed(2)}</h3>
                    <span className="text-xs text-muted-foreground">per unit</span>
                  </div>
                  <div className="h-1 w-full bg-muted mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-primary w-full rounded-full" />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-border relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <AppIcon name="shopping_cart" className="text-6xl text-red-400" size={60} />
                  </div>
                  <p className="text-muted-foreground text-sm font-medium mb-1">Total COGS</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-foreground">{currency} {computedTotalCost.toFixed(2)}</h3>
                  </div>
                  <div className="h-1 w-full bg-muted mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 w-[24%] rounded-full" />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-primary/30 relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-4 opacity-20 group-hover:opacity-30 transition-opacity">
                    <AppIcon name="pie_chart" className="text-6xl text-primary" size={60} />
                  </div>
                  <p className="text-primary/80 text-sm font-medium mb-1">Gross Margin</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-primary">{grossMarginPct.toFixed(0)}%</h3>
                    <span className="text-xs text-primary/70">({currency} {(selectedProduct.price - computedTotalCost).toFixed(2)} profit)</span>
                  </div>
                  <div className="h-1 w-full bg-muted mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-primary w-[76%] rounded-full shadow-lg shadow-primary/30" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-w-0">
                <div className="xl:col-span-2 flex flex-col bg-card rounded-xl border border-border shadow-sm overflow-hidden min-w-0">
                  <div className="p-5 border-b border-border flex justify-between items-center bg-card/50">
                    <h3 className="text-foreground font-bold text-lg flex items-center gap-2">
                      <AppIcon name="kitchen" className="text-primary" />
                      Ingredients List
                    </h3>
                    <button
                      onClick={() => onNavigate(Screen.MANAGER_RECIPE_BUILDER)}
                      className="text-xs text-primary hover:text-foreground font-medium flex items-center gap-1 transition-colors"
                    >
                      <AppIcon name="add" className="text-sm" size={14} />
                      Add Ingredient
                    </button>
                  </div>

                  <div className="max-w-full overflow-hidden">
                    <table className="w-full text-left border-collapse table-fixed">
                      <thead>
                        <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border bg-background/40">
                          <th className="px-5 py-3 font-semibold w-[42%]">Ingredient</th>
                          <th className="px-4 py-3 font-semibold w-[14%]">Qty</th>
                          <th className="px-4 py-3 font-semibold w-[12%] hidden sm:table-cell">Unit</th>
                          <th className="px-4 py-3 font-semibold w-[18%]">Cost</th>
                          <th className="px-4 py-3 pr-5 font-semibold w-[14%]">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-border">
                        {(selectedRecipe?.ingredients?.length ?? 0) === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-muted-foreground">
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
                                    : 'bg-muted text-muted-foreground border border-border';
                            const stockLabel = !inv ? '  ' : inv.stock < inv.minStock ? 'Low' : 'High';
                            return (
                              <tr key={ing.ingredientId} className="group hover:bg-accent transition-colors">
                                <td className="px-5 py-4 align-top">
                                  <div className="flex items-center gap-3">
                                    <div className="size-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                      <AppIcon name="science" className="text-lg" size={18} />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-medium text-foreground truncate">{ing.name}</span>
                                      <span className="text-[10px] text-muted-foreground font-mono truncate">{ing.ingredientId}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-foreground align-top">
                                  <div className="flex flex-col">
                                    <span className="tabular-nums">{ing.quantity}</span>
                                    <span className="text-[10px] text-muted-foreground sm:hidden truncate">{inv?.unit ?? ''}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-muted-foreground hidden sm:table-cell align-top">{inv?.unit ?? ''}</td>
                                <td className="px-4 py-4 font-medium text-foreground align-top">
                                  <div className="flex flex-col">
                                    <span className="tabular-nums">{currency} {lineCost.toFixed(2)}</span>
                                    <span className="text-[10px] text-muted-foreground tabular-nums">{currency} {unitCost.toFixed(2)} / unit</span>
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
                          <td className="px-5 py-3 font-bold text-foreground text-right" colSpan={3}>
                            Recipe Total
                          </td>
                          <td className="px-4 py-3 font-bold text-primary text-base" colSpan={2}>
                            {currency} {computedTotalCost.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div className="p-6 rounded-xl bg-card border border-border flex flex-col gap-4">
                    <h3 className="text-foreground font-bold text-sm uppercase tracking-wide opacity-80">Cost Composition</h3>

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
                      const colors = ['hsl(var(--primary))', 'hsl(var(--muted-foreground))', 'hsl(var(--border))'];
                      const parts = rows.map((r, idx) => ({ ...r, pct: total > 0 ? (r.cost / total) * 100 : 0, color: colors[idx] }));
                      const gradientStops = (() => {
                        let acc = 0;
                        const stops: string[] = [];
                        for (const p of parts) {
                          const start = acc;
                          acc += p.pct;
                          stops.push(`${p.color} ${start}% ${acc}%`);
                        }
                        if (acc < 100) stops.push(`hsl(var(--card)) ${acc}% 100%`);
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
                            <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: 'hsl(var(--card))' }} />
                          </div>
                          <div className="flex flex-col gap-3 flex-1">
                            {parts.length === 0 ? (
                              <div className="text-muted-foreground text-sm">No cost data (add ingredients)</div>
                            ) : (
                              parts.map((p) => (
                                <div key={p.id} className="flex items-center justify-between text-xs">
                                  <span className="flex items-center gap-2 text-muted-foreground">
                                    <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} /> {p.name}
                                  </span>
                                  <span className="text-foreground font-medium">{p.pct.toFixed(0)}%</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="p-6 rounded-xl bg-card border border-border flex flex-col gap-4">
                    <div className="flex justify-between items-center mb-1">
                      <h3 className="text-foreground font-bold text-sm uppercase tracking-wide opacity-80 flex items-center gap-2">
                        <AppIcon name="calculate" className="text-primary text-lg" size={18} />
                        Usage Forecaster
                      </h3>
                      <div className="group relative">
                        <AppIcon name="info" className="text-muted-foreground text-sm cursor-help" size={14} />
                        <div className="absolute right-0 bottom-full mb-2 w-48 p-2 bg-popover text-popover-foreground border border-border text-[10px] rounded hidden group-hover:block z-10">
                          Estimate stock usage based on sales volume.
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-muted-foreground">Projected Sales Volume (units)</label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={String(forecastUnits)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setForecastUnits(Math.max(0, Math.min(500, Math.floor(n))));
                          }}
                          className="flex-1 min-w-[140px] bg-background text-foreground rounded-lg px-3 py-2 text-sm border border-border focus:ring-1 focus:ring-primary font-bold text-right"
                          type="number"
                        />
                        <span className="shrink-0 flex items-center px-3 rounded-lg bg-secondary text-muted-foreground text-xs">Units</span>
                      </div>
                      <input
                        className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary mt-2"
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
                        <div className="mt-2 pt-4 border-t border-border space-y-3">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Top Ingredient 1</span>
                            <span className="text-primary font-bold">
                              {top[0] ? `${top[0].req.toFixed(2)} ${top[0].unit}` : '  '}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Top Ingredient 2</span>
                            <span className="text-foreground font-medium">
                              {top[1] ? `${top[1].req.toFixed(2)} ${top[1].unit}` : '  '}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Total Cost Impact</span>
                            <span className="text-foreground font-medium">ETB {costImpact.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    <button
                      onClick={() => setStockCheckOpen(true)}
                      className="mt-2 w-full py-2 rounded border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-all text-xs font-bold uppercase tracking-wider"
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
            <button onClick={() => setNewOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={createMenuItem} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors">
              Create
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-muted-foreground">Name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Category</label>
          <input value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Selling Price (ETB)</label>
          <input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Image URL</label>
          <div className="flex gap-2">
            <input value={draftImage} onChange={(e) => setDraftImage(e.target.value)} className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            <label className={`shrink-0 px-3 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors cursor-pointer ${draftImageUploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={draftImageUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setDraftImageUploading(true);
                  try {
                    const url = await uploadImage(file);
                    setDraftImage(url);
                    setFlash({ kind: 'success', message: 'Image uploaded.' });
                  } catch (err) {
                    setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
                  } finally {
                    setDraftImageUploading(false);
                  }
                }}
              />
              Upload
            </label>
          </div>

          {draftImage ? (
            <div className="mt-2">
              <img src={draftImage} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
            </div>
          ) : null}

          <label className="text-sm font-bold text-muted-foreground">Description</label>
          <textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} className="min-h-[90px] w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </div>
      </Modal>

      <Modal
        open={editOpen}
        title={selectedProduct ? `Edit Menu: ${selectedProduct.name}` : 'Edit Menu'}
        onClose={() => setEditOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setEditOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={saveEdits} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors">
              Save
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-bold text-muted-foreground">Name</label>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Category</label>
          <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Selling Price (ETB)</label>
          <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />

          <label className="text-sm font-bold text-muted-foreground">Image URL</label>
          <div className="flex gap-2">
            <input value={editImage} onChange={(e) => setEditImage(e.target.value)} className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            <label className={`shrink-0 px-3 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors cursor-pointer ${editImageUploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={editImageUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setEditImageUploading(true);
                  try {
                    const url = await uploadImage(file);
                    setEditImage(url);
                    setFlash({ kind: 'success', message: 'Image uploaded.' });
                  } catch (err) {
                    setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
                  } finally {
                    setEditImageUploading(false);
                  }
                }}
              />
              Upload
            </label>
          </div>

          {editImage ? (
            <div className="mt-2">
              <img src={editImage} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
            </div>
          ) : null}

          <label className="text-sm font-bold text-muted-foreground">Description</label>
          <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-[90px] w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        title="Delete Menu Item"
        onClose={() => setDeleteOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setDeleteOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">
              Cancel
            </button>
            <button onClick={confirmDelete} className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-extrabold transition-colors">
              Delete
            </button>
          </div>
        }
      >
        <div className="text-muted-foreground text-sm">
          This will permanently delete the menu item and remove its recipe mapping.
        </div>
      </Modal>

      <Modal
        open={historyOpen}
        title="History"
        onClose={() => setHistoryOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setHistoryOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">
              Close
            </button>
          </div>
        }
      >
        <div className="text-muted-foreground text-sm space-y-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-muted-foreground text-xs uppercase tracking-wider">Selected Item</div>
            <div className="mt-1 text-foreground font-semibold">{selectedProduct?.name ?? '  '}</div>
            <div className="text-muted-foreground text-xs font-mono">Code: {selectedProduct?.code ?? '  '}    SKU: {selectedProduct ? selectedProduct.id.slice(0, 12) : '  '}</div>
          </div>
          {historyLoading ? <div className="text-muted-foreground text-xs">Loading history </div> : null}
          {historyErr ? <div className="text-red-300 text-xs">{historyErr}</div> : null}
          {!historyLoading && !historyErr && historyEvents.length === 0 ? (
            <div className="text-muted-foreground text-xs">No recent menu/recipe changes for this item.</div>
          ) : null}

          {historyEvents.length ? (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-muted-foreground text-xs uppercase tracking-wider">Recent Changes</div>
              <div className="divide-y divide-border">
                {historyEvents.map((e) => (
                  <div key={e.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-foreground font-semibold text-xs">{e.summary || e.type}</div>
                      <div className="text-muted-foreground text-[10px] font-mono">{e.at ? (formatDeviceDateTime(e.at) || '') : ''}</div>
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px]">{e.actorName ? `${e.actorName} (${e.actorRole || '  '})` : e.actorRole || ''}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={stockCheckOpen}
        title="Stock Availability"
        onClose={() => setStockCheckOpen(false)}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setStockCheckOpen(false)} className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors">
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
              <div className="text-muted-foreground text-sm">
                Projected units:
                <span className="text-foreground font-semibold"> {forecastUnits}</span>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-w-full overflow-x-auto">
                  <table className="min-w-[520px] w-full text-left text-sm">
                    <thead className="bg-background/40">
                      <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                        <th className="px-4 py-2">Ingredient</th>
                        <th className="px-4 py-2">Required</th>
                        <th className="px-4 py-2">Available</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-muted-foreground">
                            No recipe ingredients.
                          </td>
                        </tr>
                      ) : (
                        rows.map((r) => (
                          <tr key={r.id} className="hover:bg-accent">
                            <td className="px-4 py-3 text-foreground">{r.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {r.required.toFixed(2)} {r.unit}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {r.available.toFixed(2)} {r.unit}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium border ${r.ok
                                    ? 'text-green-400 bg-green-400/10 border-green-400/20'
                                    : 'text-orange-400 bg-orange-400/10 border-orange-400/20'
                                  }`}
                              >
                                <AppIcon name={r.ok ? 'check' : 'warning'} className="text-[14px]" size={14} />
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
