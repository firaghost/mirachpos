import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OwnerPageHeader } from '../components/OwnerPageHeader';
import { apiFetch } from '../api';
import { PortalMenu, type PortalMenuAnchorRect } from '../components/PortalMenu';
import { readSession } from '../session';

type ApiProduct = {
  id: string;
  branchId?: string | null;
  code: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  marginPct: number;
  status: 'Active' | 'Inactive';
  image: string;
  description: string;
  soldUnits: number;
  soldRevenue: number;
  updatedAt: string;
  product_json?: any;
};

type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  price: number;
};

const autoCodeFromName = (name: string) => {
  const s = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  return s.slice(0, 8);
};

type ProductsResp = {
  products: ApiProduct[];
  categories: string[];
  page: number;
  pageSize: number;
  total: number;
};

type MenuKpisResp = {
  kpis: {
    totalItems: number;
    activeItems: number;
    avgMarginPct: number;
    topSeller: { id: string; name: string; revenue: number; units: number };
  };
  categories: string[];
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

const fmtEtb = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'ETB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `ETB ${v.toFixed(2)}`;
  }
};

const exportCsv = (rows: ApiProduct[], filename: string) => {
  const header = ['code', 'name', 'category', 'status', 'price', 'cost', 'marginPct', 'soldUnits', 'soldRevenue'];
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.code,
        r.name,
        r.category,
        r.status,
        r.price,
        r.cost,
        r.marginPct,
        r.soldUnits,
        r.soldRevenue,
      ]
        .map(esc)
        .join(','),
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const StatCard: React.FC<{ label: string; value: string; meta?: string; icon: string }> = ({ label, value, meta, icon }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start justify-between gap-4">
      <div>
        <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider">{label}</div>
        <div className="text-foreground text-2xl font-extrabold mt-2 tabular-nums">{value}</div>
        {meta ? <div className="text-muted-foreground text-xs mt-2">{meta}</div> : null}
      </div>
      <div className="w-11 h-11 rounded-xl border border-border bg-muted text-primary flex items-center justify-center">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; label: string; icon: string; onClick: () => void }> = ({ active, label, icon, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-bold border transition-colors',
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent',
      )}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  );
};

export const MenuManagement: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProductsResp | null>(null);
  const [kpiData, setKpiData] = useState<MenuKpisResp | null>(null);

  const [q, setQ] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [status, setStatus] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedCount = selectedIds.size;
  const isAllOnPageSelected = useMemo(() => {
    const ids = (data?.products || []).map((p) => p.id);
    if (!ids.length) return false;
    for (const id of ids) if (!selectedIds.has(id)) return false;
    return true;
  }, [data?.products, selectedIds]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => data?.products.find((p) => p.id === selectedId) || null, [data?.products, selectedId]);

  const [banner, setBanner] = useState<null | { kind: 'success' | 'error'; message: string }>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editStatus, setEditStatus] = useState<'Active' | 'Inactive'>('Active');
  const [editPrice, setEditPrice] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editImage, setEditImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newCategory, setNewCategory] = useState('Coffee');
  const [newPrice, setNewPrice] = useState('');
  const [newStatus, setNewStatus] = useState<'Active' | 'Inactive'>('Active');
  const [newDesc, setNewDesc] = useState('');
  const [newImage, setNewImage] = useState('');
  const [newImageUploading, setNewImageUploading] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [invItems, setInvItems] = useState<InventoryItem[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [recipeItems, setRecipeItems] = useState<Array<{ ingredientId: string; name?: string; quantity: string }>>([]);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeAddIngredientId, setRecipeAddIngredientId] = useState('');
  const [recipeAddQty, setRecipeAddQty] = useState('1');
  const [recipeLoadedFor, setRecipeLoadedFor] = useState<string>('');
  const [recipeProductId, setRecipeProductId] = useState<string>('');
  const [invLoadedForBranch, setInvLoadedForBranch] = useState<string>('');
  const [invDebug, setInvDebug] = useState<{ url: string; status: string; error: string }>({ url: '', status: 'idle', error: '' });
  const [recipeDebug, setRecipeDebug] = useState<{ url: string; status: string; error: string }>({ url: '', status: 'idle', error: '' });

  const categories = useMemo(() => ['All', ...(data?.categories || [])], [data?.categories]);
  const products = data?.products || [];
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const [tab, setTab] = useState<'catalog' | 'pricing' | 'performance' | 'recipes'>('catalog');

  const getSelectedBranchId = () => {
    try {
      const s = readSession();
      const sid = String((s as any)?.branchId || '').trim();
      if (sid && sid !== 'global') return sid;
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

  const kpis = useMemo(() => {
    const kd = kpiData?.kpis;
    if (kd) {
      return {
        totalItems: kd.totalItems,
        activeItems: kd.activeItems,
        avgMarginPct: kd.avgMarginPct,
        topSellerName: kd.topSeller?.name || '—',
        topSellerRevenue: Number(kd.topSeller?.revenue || 0) || 0,
      };
    }
    const list = products;
    const activeCount = list.filter((p) => p.status === 'Active').length;
    const avgMargin = list.length ? list.reduce((acc, p) => acc + (Number(p.marginPct) || 0), 0) / list.length : 0;
    const top = list.slice().sort((a, b) => (b.soldRevenue || 0) - (a.soldRevenue || 0))[0];
    return {
      totalItems: total,
      activeItems: activeCount,
      avgMarginPct: Number(avgMargin.toFixed(1)),
      topSellerName: top?.name || '—',
      topSellerRevenue: Number(top?.soldRevenue || 0) || 0,
    };
  }, [kpiData?.kpis, products, total]);

  const perfTop = useMemo(() => {
    return products
      .slice()
      .sort((a, b) => (b.soldRevenue || 0) - (a.soldRevenue || 0))
      .slice(0, 6)
      .map((p) => ({ name: p.name, revenue: p.soldRevenue || 0 }));
  }, [products]);

  const perfByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const c = String(p.category || 'Uncategorized');
      m.set(c, (m.get(c) || 0) + (p.soldRevenue || 0));
    }
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [products]);

  const pieColors = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--destructive))', 'hsl(var(--muted-foreground))', 'hsl(var(--ring))'];

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (activeCategory) params.set('category', activeCategory);
      if (status !== 'All') params.set('status', status);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiFetch(`/api/owner/menu/products?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ProductsResp;
      setData(json);
      if (!selectedId && json.products?.[0]?.id) setSelectedId(json.products[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchKpis = async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (activeCategory) params.set('category', activeCategory);
      if (status !== 'All') params.set('status', status);
      const res = await apiFetch(`/api/owner/menu/kpis?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as MenuKpisResp;
      setKpiData(json);
    } catch {
      setKpiData(null);
    }
  };

  const refreshAll = async () => {
    await fetchProducts();
    await fetchKpis();
  };

  useEffect(() => {
    fetchProducts();
    fetchKpis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeCategory, status, page, pageSize]);

  useEffect(() => {
    if (tab !== 'recipes') return;
    const branchId = selected?.branchId ? String(selected.branchId || '').trim() : getSelectedBranchId();
    const invKey = branchId || '__auto__';
    if (invLoading) return;
    if (invLoadedForBranch === invKey) return;
    let mounted = true;
    const run = async () => {
      setInvLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set('limit', '500');
        if (branchId) qs.set('branchId', branchId);
        const url = `/api/inventory/items?${qs.toString()}`;
        setInvDebug({ url, status: 'pending', error: '' });
        const res = await apiFetch(url);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const msg = String(json?.error || json?.message || res.status || 'request_failed');
          setInvDebug({ url, status: String(res.status), error: msg });
          throw new Error(msg);
        }
        setInvDebug({ url, status: String(res.status), error: '' });
        let rows = Array.isArray(json?.items) ? json.items : [];
        if (!rows.length) {
          try {
            const url2 = `/api/owner/inventory?${new URLSearchParams({ branchId: branchId || '' }).toString()}`;
            const res2 = await apiFetch(url2);
            const json2 = (await res2.json().catch(() => null)) as any;
            const items2 = Array.isArray(json2?.items) ? json2.items : [];
            rows = items2.map((it: any) => ({
              id: String(it?.sku || it?.id || ''),
              name: String(it?.name || ''),
              unit: String(it?.unit || ''),
              price: Number(it?.cost ?? it?.price ?? 0) || 0,
              stock: Number(it?.globalQty ?? 0) || 0,
              minStock: Number(it?.minQty ?? 0) || 0,
              status: String(it?.status || ''),
            }));
            if (items2.length) setInvDebug({ url: `${url} (fallback: ${url2})`, status: String(res.status), error: '' });
          } catch {
            // ignore fallback failures
          }
        }
        const next: InventoryItem[] = rows
          .map((x: any) => ({
            id: String(x?.id || ''),
            name: String(x?.name || ''),
            unit: String(x?.unit || ''),
            price: Number(x?.price ?? 0) || 0,
          }))
          .filter((x: InventoryItem) => Boolean(x.id && x.name));
        if (!mounted) return;
        setInvItems(next);
        setInvLoadedForBranch(invKey);
      } catch (e) {
        if (!mounted) return;
        setInvLoadedForBranch(invKey);
        setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load inventory items.' });
      } finally {
        if (mounted) setInvLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [invItems.length, invLoadedForBranch, invLoading, selected?.branchId, selected?.id, tab]);

  useEffect(() => {
    if (tab !== 'recipes') return;
    if (recipeAddIngredientId) return;
    const first = invItems[0]?.id || '';
    if (first) setRecipeAddIngredientId(first);
  }, [invItems, recipeAddIngredientId, tab]);

  useEffect(() => {
    if (!selected) return;
    setEditName(selected.name);
    setEditCode(selected.code);
    setEditCategory(selected.category);
    setEditStatus(selected.status);
    setEditPrice(String(selected.price ?? ''));
    setEditDesc(selected.description || '');
    setEditImage(selected.image || '');
  }, [selected?.id]);

  useEffect(() => {
    if (tab !== 'recipes') return;
    const curRecipe = (selected as any)?.product_json?.recipe;
    const ings = Array.isArray(curRecipe?.ingredients) ? curRecipe.ingredients : [];
    setRecipeItems(
      ings
        .map((x: any) => ({ ingredientId: String(x?.ingredientId || ''), name: typeof x?.name === 'string' ? x.name : '', quantity: String(x?.quantity ?? '1') }))
        .filter((x: any) => x.ingredientId),
    );

    if (!recipeAddIngredientId) {
      const first = invItems[0]?.id || '';
      if (first) setRecipeAddIngredientId(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, tab]);

  useEffect(() => {
    if (tab !== 'recipes') return;
    if (!selected?.id) return;

    const branchId = (selected as any)?.branchId ? String((selected as any).branchId || '').trim() : getSelectedBranchId();
    const key = `${branchId}::${selected.id}`;
    if (recipeLoadedFor === key) return;

    setRecipeProductId(selected.id);

    let mounted = true;
    const run = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('productId', selected.id);
        if (branchId) qs.set('branchId', branchId);
        const url = `/api/manager/menu/recipes?${qs.toString()}`;
        setRecipeDebug({ url, status: 'pending', error: '' });
        const res = await apiFetch(url);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const msg = String(json?.error || json?.message || res.status || 'request_failed');
          setRecipeDebug({ url, status: String(res.status), error: msg });
          throw new Error(msg);
        }
        setRecipeDebug({ url, status: String(res.status), error: '' });
        const rows = Array.isArray(json?.recipes) ? json.recipes : [];
        const row = rows.find((r: any) => String(r?.productId || r?.product_id || '') === selected.id) || null;
        const recipe = row?.recipe && typeof row.recipe === 'object' ? row.recipe : null;
        const ings = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
        let mapped = ings
          .map((x: any) => ({ ingredientId: String(x?.ingredientId || ''), name: typeof x?.name === 'string' ? x.name : '', quantity: String(x?.quantity ?? '0') }))
          .filter((x: any) => x.ingredientId);

        // Fallback: owner may be viewing a global product record, while the recipe was saved against a branch-specific product id.
        // If we got no ingredients, resolve the branch product by matching the product code and re-fetch.
        if (!mapped.length && branchId && selected.code) {
          try {
            const pqs = new URLSearchParams();
            pqs.set('limit', '500');
            pqs.set('branchId', branchId);
            const pres = await apiFetch(`/api/manager/menu/products?${pqs.toString()}`);
            const pjson = (await pres.json().catch(() => null)) as any;
            const prows = Array.isArray(pjson?.products) ? pjson.products : [];
            const match = prows.find((p: any) => String(p?.code || '').trim() && String(p?.code || '').trim() === String(selected.code || '').trim());
            const pid2 = String(match?.id || '').trim();
            if (pid2 && pid2 !== selected.id) {
              const qs2 = new URLSearchParams();
              qs2.set('productId', pid2);
              qs2.set('branchId', branchId);
              const url2 = `/api/manager/menu/recipes?${qs2.toString()}`;
              const res2 = await apiFetch(url2);
              const json2 = (await res2.json().catch(() => null)) as any;
              const rows2 = Array.isArray(json2?.recipes) ? json2.recipes : [];
              const row2 = rows2.find((r: any) => String(r?.productId || r?.product_id || '') === pid2) || null;
              const recipe2 = row2?.recipe && typeof row2.recipe === 'object' ? row2.recipe : null;
              const ings2 = Array.isArray(recipe2?.ingredients) ? recipe2.ingredients : [];
              const mapped2 = ings2
                .map((x: any) => ({ ingredientId: String(x?.ingredientId || ''), name: typeof x?.name === 'string' ? x.name : '', quantity: String(x?.quantity ?? '0') }))
                .filter((x: any) => x.ingredientId);
              if (mapped2.length) {
                mapped = mapped2;
                setRecipeProductId(pid2);
                setRecipeDebug({ url: `${url} (fallback: ${url2})`, status: String(res2.status), error: '' });
              }
            }
          } catch {
            // ignore
          }
        }
        if (!mounted) return;
        setRecipeItems(mapped);
        setRecipeLoadedFor(key);
      } catch (e) {
        if (!mounted) return;
        setRecipeLoadedFor(key);
        setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load recipe.' });
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [recipeLoadedFor, selected?.id, tab]);

  useEffect(() => {
    if (!selected) return;
    if (editCode.trim()) return;
    const next = autoCodeFromName(editName);
    if (next) setEditCode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editName, selected?.id]);

  useEffect(() => {
    setPage(1);
  }, [q, activeCategory, status]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [q, activeCategory, status, page]);

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const ids = (data?.products || []).map((p) => p.id);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'set_status' | 'set_price' | 'adjust_price_pct'>('set_status');
  const [bulkStatus, setBulkStatus] = useState<'Active' | 'Inactive'>('Active');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<PortalMenuAnchorRect | null>(null);

  const submitBulk = async () => {
    if (bulkSaving) return;
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const payload: any = { ids, action: bulkAction };
    if (bulkAction === 'set_status') payload.status = bulkStatus;
    if (bulkAction === 'set_price') {
      const price = Number(bulkValue);
      if (!Number.isFinite(price) || price < 0) {
        setBanner({ kind: 'error', message: 'Invalid bulk price.' });
        return;
      }
      payload.price = price;
    }
    if (bulkAction === 'adjust_price_pct') {
      const pct = Number(bulkValue);
      if (!Number.isFinite(pct) || pct < -90 || pct > 500) {
        setBanner({ kind: 'error', message: 'Invalid percent. Use -90 to 500.' });
        return;
      }
      payload.pct = pct;
    }

    setBulkSaving(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/menu/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setBanner({ kind: 'success', message: `Bulk update applied to ${json?.updated || ids.length} items.` });
      setSelectedIds(new Set());
      setBulkOpen(false);
      setBulkValue('');
      await fetchProducts();
      await fetchKpis();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Bulk update failed.' });
    } finally {
      setBulkSaving(false);
    }
  };

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

  const deleteProduct = async (id: string) => {
    if (!id) return;
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const confirmDeleteProduct = async () => {
    const id = deleteTargetId;
    if (!id) return;
    setBanner(null);
    try {
      const res = await apiFetch(`/api/owner/menu/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setBanner({ kind: 'success', message: 'Product deleted.' });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      await fetchProducts();
      await fetchKpis();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete.' });
    } finally {
      closeDeleteConfirm();
    }
  };

  const recipeTotalCost = useMemo(() => {
    const priceById = new Map(invItems.map((x) => [x.id, x.price] as const));
    return recipeItems.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(priceById.get(r.ingredientId) || 0) || 0), 0);
  }, [invItems, recipeItems]);

  const saveRecipe = async () => {
    if (!selected || recipeSaving) return;
    setRecipeSaving(true);
    setBanner(null);
    try {
      const nameById = new Map(invItems.map((x) => [x.id, x.name] as const));
      const ingredients = recipeItems
        .map((x) => {
          const qty = Number(x.quantity) || 0;
          const n0 = typeof x.name === 'string' ? x.name.trim() : '';
          const n1 = String(nameById.get(x.ingredientId) || '').trim();
          return { ingredientId: x.ingredientId, name: n0 || n1, quantity: qty, cost: 0 };
        })
        .filter((x) => x.ingredientId && x.name && Number.isFinite(x.quantity) && x.quantity > 0);

      const branchId = (selected as any)?.branchId ? String((selected as any).branchId || '').trim() : getSelectedBranchId();
      const qs = new URLSearchParams();
      if (branchId) qs.set('branchId', branchId);

      const pid = recipeProductId || selected.id;

      const res = await apiFetch(`/api/manager/menu/recipes/${encodeURIComponent(pid)}?${qs.toString()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe: { ingredients, totalCost: Number(recipeTotalCost.toFixed(4)) } }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setBanner({ kind: 'success', message: 'Recipe saved.' });
      setRecipeLoadedFor('');
      await fetchProducts();
      await fetchKpis();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save recipe.' });
    } finally {
      setRecipeSaving(false);
    }
  };

  const discardEdits = () => {
    if (!selected) return;
    setBanner(null);
    setEditName(selected.name);
    setEditCode(selected.code);
    setEditCategory(selected.category);
    setEditStatus(selected.status);
    setEditPrice(String(selected.price ?? ''));
    setEditDesc(selected.description || '');
    setEditImage(selected.image || '');
  };

  const saveEdits = async () => {
    if (!selected || saving) return;
    const name = editName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Product name is required.' });
      return;
    }
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price < 0) {
      setBanner({ kind: 'error', message: 'Invalid price.' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await apiFetch(`/api/owner/menu/products/${encodeURIComponent(selected.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: editCode.trim(),
          category: editCategory.trim(),
          status: editStatus,
          price,
          description: editDesc,
          image: editImage,
        }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      setBanner({ kind: 'success', message: 'Product updated.' });
      await fetchProducts();
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setBanner(null);
    setAddOpen(true);
    setAddSaving(false);
    setNewName('');
    setNewCode('');
    setNewCategory(activeCategory || 'Coffee');
    setNewPrice('');
    setNewStatus('Active');
    setNewDesc('');
    setNewImage('');
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddSaving(false);
  };

  const submitAdd = async () => {
    if (addSaving) return;
    const name = newName.trim();
    if (!name) {
      setBanner({ kind: 'error', message: 'Product name is required.' });
      return;
    }
    const price = Number(newPrice);
    if (!Number.isFinite(price) || price < 0) {
      setBanner({ kind: 'error', message: 'Invalid price.' });
      return;
    }
    setAddSaving(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/owner/menu/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: newCode.trim(),
          category: newCategory.trim(),
          status: newStatus,
          price,
          description: newDesc,
          image: newImage,
        }),
      });
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(payload?.error || String(res.status));
      closeAdd();
      setBanner({ kind: 'success', message: 'Product created.' });
      await fetchProducts();
      if (payload?.product?.id) setSelectedId(payload.product.id);
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create.' });
      setAddSaving(false);
    }
  };

  const editPanel = (
    <div className="w-full lg:w-[420px] bg-card border border-border rounded-xl lg:sticky lg:top-6 self-start overflow-hidden">
      <div className="p-6 pb-4 border-b border-border">
        <h3 className="text-foreground font-bold text-lg">Edit Product</h3>
        <p className="text-muted-foreground text-xs">Update product details and pricing.</p>
      </div>

      <div className="p-6 pt-4 flex flex-col gap-4 max-h-[calc(100vh-270px)] overflow-y-auto">

      {!selected ? <div className="text-sm text-muted-foreground">Select a product to edit.</div> : null}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-muted-foreground uppercase">Product Name</label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          disabled={!selected}
          className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted-foreground uppercase">Category</label>
          <select
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            disabled={!selected}
            className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          >
            {(data?.categories?.length ? data.categories : ['Coffee', 'Food', 'Drinks', 'Breakfast']).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted-foreground uppercase">Price (ETB)</label>
          <input
            type="number"
            value={editPrice}
            onChange={(e) => setEditPrice(e.target.value)}
            disabled={!selected}
            className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted-foreground uppercase">Code</label>
          <input
            type="text"
            value={editCode}
            readOnly
            disabled={!selected}
            className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            placeholder="Auto"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted-foreground uppercase">Cost (ETB)</label>
          <input type="text" value={fmtEtb(recipeTotalCost)} readOnly disabled className="bg-background border border-border rounded p-2 text-muted-foreground" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-muted-foreground uppercase">Status</label>
        <select
          value={editStatus}
          onChange={(e) => setEditStatus(e.target.value as any)}
          disabled={!selected}
          className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-muted-foreground uppercase">Description</label>
        <textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          disabled={!selected}
          className="bg-background border border-border rounded p-2 text-foreground h-24 focus:border-primary focus:outline-none resize-none disabled:opacity-50"
        ></textarea>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-muted-foreground uppercase">Image URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={editImage}
            onChange={(e) => setEditImage(e.target.value)}
            disabled={!selected}
            className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none flex-1 disabled:opacity-50"
            placeholder="https://..."
          />
          <label className={cx('p-2 border border-border rounded text-muted-foreground hover:text-foreground cursor-pointer', (!selected || imageUploading) ? 'opacity-50 pointer-events-none' : '')}>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!selected || imageUploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBanner(null);
                setImageUploading(true);
                try {
                  const url = await uploadImage(file);
                  setEditImage(url);
                  setBanner({ kind: 'success', message: 'Image uploaded.' });
                } catch (err) {
                  setBanner({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
                } finally {
                  setImageUploading(false);
                }
              }}
            />
            <span className="material-symbols-outlined">upload</span>
          </label>
        </div>
        {editImage ? (
          <div className="mt-2">
            <img src={editImage} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
          </div>
        ) : null}
      </div>

      </div>

      <div className="p-4 border-t border-border bg-muted/50">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={discardEdits}
            disabled={!selected || saving}
            className="flex-1 py-3 border border-border rounded-lg text-muted-foreground font-bold hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={saveEdits}
            disabled={!selected || saving}
            className="flex-1 py-3 bg-primary text-background rounded-lg font-bold hover:bg-primary-hover transition-colors shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            {saving ? 'Saving ¦' : 'Save Item'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <OwnerPageHeader
        title="Menu Engineering"
        leftSlot={<div className="text-xs text-muted-foreground">Catalog, pricing intelligence, and item performance</div>}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-muted text-foreground text-sm font-bold hover:bg-accent transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                refresh
              </span>
              Refresh
            </button>
            <button
              onClick={() => exportCsv(products, `menu-products-${new Date().toISOString().slice(0, 10)}.csv`)}
              className="hidden sm:flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-muted text-foreground text-sm font-bold hover:bg-accent transition-colors disabled:opacity-60"
              type="button"
              disabled={loading || !products.length}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                download
              </span>
              Export
            </button>
            <button
              onClick={openAdd}
              className="flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary-hover transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                add
              </span>
              <span className="hidden sm:inline">Add Product</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-6 max-w-[1600px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Total Items" value={String(kpis.totalItems)} meta="Across catalog" icon="restaurant_menu" />
            <StatCard label="Active Items" value={String(kpis.activeItems)} meta="Available for sale" icon="check_circle" />
            <StatCard label="Avg Margin" value={`${kpis.avgMarginPct}%`} meta="Based on cost" icon="percent" />
            <StatCard label="Top Seller" value={kpis.topSellerName} meta={kpis.topSellerRevenue ? fmtEtb(kpis.topSellerRevenue) : '—'} icon="trending_up" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TabBtn active={tab === 'catalog'} label="Catalog" icon="inventory_2" onClick={() => setTab('catalog')} />
              <TabBtn active={tab === 'pricing'} label="Pricing" icon="sell" onClick={() => setTab('pricing')} />
              <TabBtn active={tab === 'performance'} label="Performance" icon="bar_chart" onClick={() => setTab('performance')} />
              <TabBtn active={tab === 'recipes'} label="Recipes" icon="restaurant_menu" onClick={() => setTab('recipes')} />
            </div>
          </div>

          {banner ? (
            <div
              className={cx(
                'rounded-xl border p-3 text-sm font-medium',
                banner.kind === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-destructive/10 border-destructive/20 text-destructive',
              )}
            >
              {banner.message}
            </div>
          ) : null}

          {tab === 'catalog' ? (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex gap-2 flex-wrap">
                      {categories.map((cat) => {
                        const active = (cat === 'All' ? '' : cat) === activeCategory;
                        return (
                          <button
                            key={cat}
                            onClick={() => setActiveCategory(cat === 'All' ? '' : cat)}
                            className={cx(
                              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                              active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                            )}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[18px]">search</span>
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search items..."
                        className="bg-background border border-border rounded-lg pl-10 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="All">All</option>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl overflow-hidden flex-1">
                  <div className="overflow-y-auto h-full">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr className="border-b border-border">
                          <th className="p-4 w-[44px]">
                            <input
                              type="checkbox"
                              checked={isAllOnPageSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectAllOnPage();
                              }}
                              className="accent-primary"
                            />
                          </th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Image</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Product Name</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Category</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Price</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Margin</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Sold</th>
                          <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {loading ? (
                          <tr>
                            <td colSpan={8} className="p-6 text-sm text-muted-foreground">
                              Loading ¦
                            </td>
                          </tr>
                        ) : error ? (
                          <tr>
                            <td colSpan={8} className="p-6 text-sm text-red-400">
                              Failed to load: {error}
                            </td>
                          </tr>
                        ) : products.length ? (
                          products.map((prod) => (
                            <tr
                              key={prod.id}
                              className={cx(
                                'hover:bg-accent/50 group cursor-pointer transition-colors',
                                selectedId === prod.id ? 'bg-accent/30' : '',
                              )}
                              onClick={() => {
                                setSelectedId(prod.id);
                                setTab('catalog');
                              }}
                            >
                              <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(prod.id)}
                                  onChange={() => toggleSelectOne(prod.id)}
                                  className="accent-primary"
                                />
                              </td>
                              <td className="p-3">
                                {prod.image ? (
                                  <img src={prod.image} className="w-10 h-10 rounded-md object-cover border border-border" alt="" />
                                ) : (
                                  <div className="w-10 h-10 rounded-md border border-border bg-muted flex items-center justify-center text-muted-foreground">
                                    <span className="material-symbols-outlined text-[18px]">photo</span>
                                  </div>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="text-sm font-bold text-foreground">{prod.name}</div>
                                <div className="text-xs text-muted-foreground font-mono">{prod.code}</div>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">{prod.category}</td>
                              <td className="p-3 text-sm font-mono text-primary font-bold">{fmtEtb(prod.price)}</td>
                              <td className="p-3 text-sm text-muted-foreground">
                                <span className={cx('font-bold', prod.marginPct >= 60 ? 'text-emerald-400' : prod.marginPct >= 30 ? 'text-primary' : 'text-red-400')}>{prod.marginPct}%</span>
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                <div className="font-bold text-foreground">{prod.soldUnits}</div>
                                <div className="text-xs">{fmtEtb(prod.soldRevenue)}</div>
                              </td>
                              <td className="p-3 text-right">
                                <button
                                  className="text-muted-foreground hover:text-foreground"
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setSelectedId(prod.id);
                                    setRowMenuId((prev) => {
                                      const next = prev === prod.id ? null : prod.id;
                                      if (!next) {
                                        setRowMenuAnchor(null);
                                        return null;
                                      }
                                      try {
                                        const rect = (ev.currentTarget as any)?.getBoundingClientRect?.();
                                        if (rect) {
                                          setRowMenuAnchor({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
                                        } else {
                                          setRowMenuAnchor(null);
                                        }
                                      } catch {
                                        setRowMenuAnchor(null);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  <span className="material-symbols-outlined text-[18px]">more_vert</span>
                                </button>
                                <PortalMenu
                                  open={rowMenuId === prod.id}
                                  anchorRect={rowMenuId === prod.id ? rowMenuAnchor : null}
                                  onClose={() => {
                                    setRowMenuId(null);
                                    setRowMenuAnchor(null);
                                  }}
                                  width={220}
                                >
                                  <button
                                    type="button"
                                    className="w-full px-4 py-3 text-left text-sm hover:bg-accent"
                                    onClick={() => {
                                      setSelectedId(prod.id);
                                      setTab('catalog');
                                      setRowMenuId(null);
                                      setRowMenuAnchor(null);
                                    }}
                                  >
                                    Edit details
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full px-4 py-3 text-left text-sm hover:bg-accent"
                                    onClick={() => {
                                      setSelectedId(prod.id);
                                      setTab('recipes');
                                      setRowMenuId(null);
                                      setRowMenuAnchor(null);
                                    }}
                                  >
                                    Manage recipe
                                  </button>
                                  <div className="h-px bg-border" />
                                  <button
                                    type="button"
                                    className="w-full px-4 py-3 text-left text-sm hover:bg-accent text-red-300"
                                    onClick={async () => {
                                      setRowMenuId(null);
                                      setRowMenuAnchor(null);
                                      await deleteProduct(prod.id);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </PortalMenu>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={8} className="p-6 text-sm text-muted-foreground">
                              No products found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedCount ? (
                  <div className="bg-card border border-border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="text-sm text-foreground font-bold">{selectedCount} selected</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setBulkOpen(true);
                          setBulkAction('set_status');
                          setBulkStatus('Active');
                          setBulkValue('');
                        }}
                        className="px-3 h-9 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
                      >
                        Bulk Actions
                      </button>
                      <button type="button" onClick={() => setSelectedIds(new Set())} className="px-3 h-9 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent">
                        Clear
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <div>
                    Showing{' '}
                    <span className="font-bold text-foreground">
                      {total ? (page - 1) * pageSize + 1 : 0}-{total ? Math.min(total, page * pageSize) : 0}
                    </span>{' '}
                    of <span className="font-bold text-foreground">{total}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || loading}
                      className="w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <div className="px-3 py-2 rounded-lg bg-muted border border-border text-foreground font-bold">{page}</div>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={page >= pageCount || loading}
                      className="w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              </div>

              {editPanel}
            </div>
          ) : tab === 'pricing' ? (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 bg-card border border-border rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-foreground text-lg font-extrabold">Pricing Intelligence</div>
                    <div className="text-muted-foreground text-sm mt-1">Review margin and adjust price/cost for better profitability.</div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard label="Avg Margin" value={`${kpis.avgMarginPct}%`} meta="Current page" icon="percent" />
                  <StatCard label="Top Seller" value={kpis.topSellerName} meta={kpis.topSellerRevenue ? fmtEtb(kpis.topSellerRevenue) : '—'} icon="trending_up" />
                  <StatCard label="Active Items" value={String(kpis.activeItems)} meta="Current page" icon="check_circle" />
                </div>

                <div className="mt-6 bg-muted border border-border rounded-xl p-4">
                  <div className="text-sm font-bold text-foreground">Tip</div>
                  <div className="text-xs text-muted-foreground mt-1">Items with low margin are shown in red on the Catalog tab. Increase price or reduce cost to improve margin.</div>
                </div>

                <div className="mt-6">
                  <div className="text-sm font-bold text-foreground">Top items by revenue</div>
                  <div className="text-xs text-muted-foreground mt-1">(from current filters)</div>
                  <div className="mt-3 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={perfTop} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={{ stroke: 'hsl(var(--border))' }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={{ stroke: 'hsl(var(--border))' }} />
                        <Tooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                          itemStyle={{ color: 'hsl(var(--foreground))' }}
                          formatter={(v: any) => fmtEtb(Number(v) || 0)}
                        />
                        <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {editPanel}
            </div>
          ) : tab === 'recipes' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-foreground text-lg font-extrabold">Recipe Builder</div>
                    <div className="text-muted-foreground text-sm mt-1">Attach ingredients to a menu item to compute cost and standardize preparation.</div>
                  </div>
                  <button
                    type="button"
                    onClick={saveRecipe}
                    disabled={!selected || recipeSaving}
                    className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary-hover disabled:opacity-60"
                  >
                    {recipeSaving ? 'Saving ¦' : 'Save Recipe'}
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-muted border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground font-bold uppercase">Total Ingredients</div>
                    <div className="text-foreground text-2xl font-extrabold mt-2">{recipeItems.length}</div>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground font-bold uppercase">Estimated Cost</div>
                    <div className="text-foreground text-2xl font-extrabold mt-2">{fmtEtb(recipeTotalCost)}</div>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground font-bold uppercase">Selected Item</div>
                    <div className="text-foreground font-extrabold mt-2 truncate">{selected?.name || '—'}</div>
                    <div className="text-muted-foreground text-xs font-mono mt-1">{selected?.code || ''}</div>
                  </div>
                </div>

                <div className="mt-6 bg-muted border border-border rounded-xl p-4">
                  <div className="text-sm font-bold text-foreground">Add Ingredient</div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select
                      value={recipeAddIngredientId}
                      onChange={(e) => setRecipeAddIngredientId(e.target.value)}
                      className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      disabled={invLoading}
                    >
                      {invItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={recipeAddQty}
                      onChange={(e) => setRecipeAddQty(e.target.value)}
                      type="number"
                      min={0}
                      step="0.01"
                      className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      placeholder="Qty"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = recipeAddIngredientId.trim();
                        const qty = Number(recipeAddQty);
                        if (!id) return;
                        if (!Number.isFinite(qty) || qty <= 0) {
                          setBanner({ kind: 'error', message: 'Enter a valid quantity.' });
                          return;
                        }
                        const nm = String(invItems.find((x) => x.id === id)?.name || '').trim();
                        setRecipeItems((prev) => {
                          const idx = prev.findIndex((x) => x.ingredientId === id);
                          if (idx >= 0) {
                            const next = prev.slice();
                            next[idx] = { ingredientId: id, name: next[idx].name || nm, quantity: String((Number(next[idx].quantity) || 0) + qty) };
                            return next;
                          }
                          return [...prev, { ingredientId: id, name: nm, quantity: String(qty) }];
                        });
                      }}
                      className="h-10 rounded-lg bg-muted text-foreground text-sm font-bold hover:bg-accent"
                      disabled={invLoading || !invItems.length}
                    >
                      Add
                    </button>
                  </div>
                  {invLoading ? <div className="mt-3 text-xs text-muted-foreground">Loading inventory items ¦</div> : null}
                  {!invLoading && !invItems.length ? (
                    <div className="mt-3 text-xs text-red-300">
                      No inventory items found for this branch.
                    </div>
                  ) : null}
                  {!invLoading ? <div className="mt-2 text-[11px] text-muted-foreground">Branch: {getSelectedBranchId() || 'auto'}</div> : null}
                  <div className="mt-3 rounded-lg border border-border bg-muted p-3 text-[11px] text-muted-foreground">
                    <div className="text-foreground font-bold">Debug</div>
                    <div className="mt-2">
                      <div className="text-foreground font-bold">Inventory</div>
                      <div className="mt-1 break-all">{invDebug.url || '—'}</div>
                      <div className="mt-1">Status: {invDebug.status || '—'}</div>
                      <div className="mt-1">Items: {invItems.length}</div>
                      {invDebug.error ? <div className="mt-1 text-red-300">Error: {invDebug.error}</div> : null}
                    </div>
                    <div className="mt-3">
                      <div className="text-foreground font-bold">Recipe</div>
                      <div className="mt-1 break-all">{recipeDebug.url || '—'}</div>
                      <div className="mt-1">Status: {recipeDebug.status || '—'}</div>
                      <div className="mt-1">Ingredients: {recipeItems.length}</div>
                      {recipeDebug.error ? <div className="mt-1 text-red-300">Error: {recipeDebug.error}</div> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-6 bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/50">
                    <div className="text-sm font-bold text-foreground">Ingredients</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50">
                        <tr className="border-b border-border">
                          <th className="p-3 text-xs font-bold text-muted-foreground uppercase">Ingredient</th>
                          <th className="p-3 text-xs font-bold text-muted-foreground uppercase">Unit Cost</th>
                          <th className="p-3 text-xs font-bold text-muted-foreground uppercase">Qty</th>
                          <th className="p-3 text-xs font-bold text-muted-foreground uppercase">Line Cost</th>
                          <th className="p-3 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {recipeItems.length ? (
                          recipeItems.map((r) => {
                            const it = invItems.find((x) => x.id === r.ingredientId);
                            const unitCost = Number(it?.price || 0) || 0;
                            const qty = Number(r.quantity) || 0;
                            const lineCost = unitCost * qty;
                            return (
                              <tr key={r.ingredientId} className="hover:bg-accent/50">
                                <td className="p-3">
                                  <div className="text-sm font-bold text-foreground">{it?.name || r.name || r.ingredientId}</div>
                                  <div className="text-xs text-muted-foreground">{it?.unit || ''}</div>
                                </td>
                                <td className="p-3 text-sm text-muted-foreground font-mono">{fmtEtb(unitCost)}</td>
                                <td className="p-3">
                                  <input
                                    value={r.quantity}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setRecipeItems((prev) => prev.map((x) => (x.ingredientId === r.ingredientId ? { ...x, quantity: v } : x)));
                                    }}
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none w-28"
                                  />
                                </td>
                                <td className="p-3 text-sm text-muted-foreground font-mono">{fmtEtb(lineCost)}</td>
                                <td className="p-3 text-right">
                                  <button
                                    type="button"
                                    className="px-3 py-2 rounded-lg text-red-300 hover:bg-accent"
                                    onClick={() => setRecipeItems((prev) => prev.filter((x) => x.ingredientId !== r.ingredientId))}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={5} className="p-6 text-sm text-muted-foreground">
                              No ingredients yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {editPanel}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-foreground text-lg font-extrabold">Performance Overview</div>
                    <div className="text-muted-foreground text-sm mt-1">Revenue and category mix based on recorded sales events.</div>
                  </div>
                </div>

                <div className="mt-6 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perfTop} margin={{ top: 12, right: 12, bottom: 12, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={{ stroke: 'hsl(var(--border))' }} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={{ stroke: 'hsl(var(--border))' }} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(v: any) => fmtEtb(Number(v) || 0)}
                      />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-6">
                <div className="text-foreground font-extrabold">Revenue by Category</div>
                <div className="text-muted-foreground text-xs mt-1">Current filters</div>
                <div className="mt-4 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={perfByCategory} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                        {perfByCategory.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(v: any) => fmtEtb(Number(v) || 0)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 space-y-2">
                  {perfByCategory.map((x, i) => (
                    <div key={x.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: pieColors[i % pieColors.length] }}></span>
                        <span className="text-foreground font-bold">{x.name}</span>
                      </div>
                      <span className="text-muted-foreground font-mono">{fmtEtb(x.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {addOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAdd();
          }}
        >
          <div className="w-full max-w-[640px] bg-card border border-border rounded-xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-foreground font-bold text-lg">Add Product</h3>
                <p className="text-muted-foreground text-xs">Create a new menu item.</p>
              </div>
              <button type="button" onClick={closeAdd} className="text-muted-foreground hover:text-foreground">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-bold text-muted-foreground uppercase">Product Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Code</label>
                <input value={newCode} readOnly className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none" placeholder="Auto" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Category</label>
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Price (ETB)</label>
                <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} type="number" className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Cost (ETB)</label>
                <input value={fmtEtb(0)} readOnly disabled className="bg-background border border-border rounded p-2 text-muted-foreground focus:border-primary focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-muted-foreground uppercase">Status</label>
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as any)} className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-bold text-muted-foreground uppercase">Image URL</label>
                <div className="flex gap-2">
                  <input value={newImage} onChange={(e) => setNewImage(e.target.value)} className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none flex-1" placeholder="https://..." />
                  <label className={cx('p-2 border border-border rounded text-muted-foreground hover:text-foreground cursor-pointer', newImageUploading ? 'opacity-50 pointer-events-none' : '')}>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={newImageUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setBanner(null);
                        setNewImageUploading(true);
                        try {
                          const url = await uploadImage(file);
                          setNewImage(url);
                          setBanner({ kind: 'success', message: 'Image uploaded.' });
                        } catch (err) {
                          setBanner({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
                        } finally {
                          setNewImageUploading(false);
                        }
                      }}
                    />
                    <span className="material-symbols-outlined">upload</span>
                  </label>
                </div>
                {newImage ? (
                  <div className="mt-2">
                    <img src={newImage} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-bold text-muted-foreground uppercase">Description</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="bg-background border border-border rounded p-2 text-foreground h-24 focus:border-primary focus:outline-none resize-none"></textarea>
              </div>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button type="button" onClick={closeAdd} className="px-4 py-2 rounded-lg border border-border text-muted-foreground font-bold hover:bg-accent hover:text-foreground" disabled={addSaving}>
                Cancel
              </button>
              <button type="button" onClick={submitAdd} className="px-4 py-2 rounded-lg bg-primary text-background font-bold hover:bg-primary-hover disabled:opacity-60" disabled={addSaving}>
                {addSaving ? 'Creating ¦' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBulkOpen(false);
          }}
        >
          <div className="w-full max-w-[560px] bg-card border border-border rounded-xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-foreground font-bold text-lg">Bulk Actions</h3>
                <p className="text-muted-foreground text-xs">Apply changes to {selectedCount} selected items.</p>
              </div>
              <button type="button" onClick={() => setBulkOpen(false)} className="text-muted-foreground hover:text-foreground">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-xs font-bold text-muted-foreground uppercase">Action</label>
                <select
                  value={bulkAction}
                  onChange={(e) => {
                    setBulkAction(e.target.value as any);
                    setBulkValue('');
                  }}
                  className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="set_status">Set availability</option>
                  <option value="set_price">Set price (ETB)</option>
                  <option value="adjust_price_pct">Adjust price (%)</option>
                </select>
              </div>

              {bulkAction === 'set_status' ? (
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Availability</label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as any)}
                    className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              ) : (
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Value</label>
                  <input
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    type="number"
                    className="bg-background border border-border rounded p-2 text-foreground focus:border-primary focus:outline-none"
                    placeholder={bulkAction.includes('pct') ? 'e.g. 5 or -10' : 'e.g. 250'}
                  />
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {bulkAction === 'adjust_price_pct' ? 'Percent supports negative values. Example: -10 reduces by 10%.' : null}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button type="button" onClick={() => setBulkOpen(false)} className="px-4 py-2 rounded-lg border border-border text-muted-foreground font-bold hover:bg-accent hover:text-foreground" disabled={bulkSaving}>
                Cancel
              </button>
              <button type="button" onClick={submitBulk} className="px-4 py-2 rounded-lg bg-primary text-background font-bold hover:bg-primary-hover disabled:opacity-60" disabled={bulkSaving || !selectedCount}>
                {bulkSaving ? 'Applying ¦' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDeleteConfirm();
          }}
        >
          <div className="w-full max-w-[520px] bg-card border border-border rounded-xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-foreground text-lg font-extrabold">Delete Product</div>
                <div className="text-muted-foreground text-sm mt-1">This cannot be undone.</div>
              </div>
              <button type="button" onClick={closeDeleteConfirm} className="text-muted-foreground hover:text-foreground">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground font-bold hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground font-bold hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
