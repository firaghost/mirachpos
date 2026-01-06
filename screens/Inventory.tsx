import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import { Screen } from '../types';
import type { Product, Recipe } from '../types';
import { apiFetch, serverNowMs } from '../api';

interface Props {
  onNavigate: (screen: Screen) => void;
}

const STORAGE_SELECTED_PRODUCT = 'mirachpos.inventory.selectedProductId';

type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  minStock: number;
  price: number;
  status: string;
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  status: string;
  notes: string;
  updatedAt: string;
};

type AuditRow = {
  id: string;
  type: string;
  summary: string;
  actorName: string;
  actorRole: string;
  at: string;
};

export const Inventory: React.FC<Props> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'stock' | 'recipes' | 'suppliers' | 'audit'>('stock');
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierEditId, setSupplierEditId] = useState<string | null>(null);
  const [supplierDeleteId, setSupplierDeleteId] = useState<string | null>(null);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_SELECTED_PRODUCT);
    } catch {
      return null;
    }
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [draftStock, setDraftStock] = useState('');
  const [draftUnit, setDraftUnit] = useState('');
  const [draftMinStock, setDraftMinStock] = useState('');
  const [draftPrice, setDraftPrice] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const editing = useMemo(() => items.find((x) => x.id === editId) ?? null, [items, editId]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/inventory/items');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.items) ? (json.items as InventoryItemRow[]) : [];
        if (!mounted) return;
        setItems(rows);
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
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/manager/menu/products?limit=500');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.products) ? (json.products as any[]) : [];
        const next: Product[] = rows
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
    let mounted = true;
    const run = async () => {
      try {
        const ids = products.map((p) => p.id).filter(Boolean);
        if (ids.length === 0) {
          if (mounted) setRecipes([]);
          return;
        }
        const qs = new URLSearchParams({ productIds: ids.join(',') });
        const res = await apiFetch(`/api/manager/menu/recipes?${qs.toString()}`);
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.recipes) ? (json.recipes as any[]) : [];
        const byId = new Map<string, any>();
        for (const r of rows) {
          const pid = typeof r?.productId === 'string' ? r.productId : typeof r?.product_id === 'string' ? r.product_id : '';
          if (!pid) continue;
          const recipeObj = r?.recipe && typeof r.recipe === 'object' ? r.recipe : r;
          byId.set(pid, recipeObj);
        }
        const nextRecipes: Recipe[] = [];
        for (const p of products) {
          const rr = byId.get(p.id);
          if (!rr) continue;
          const ingredients = Array.isArray(rr.ingredients) ? rr.ingredients : [];
          nextRecipes.push({ productId: p.id, productName: p.name, ingredients, totalCost: Number(rr.totalCost || 0) || 0 });
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

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);
  const selectedRecipe = useMemo(() => {
    if (!selectedProduct) return null;
    return recipes.find((r) => r.productId === selectedProduct.id) ?? null;
  }, [recipes, selectedProduct]);

  const formatRelativeTime = (iso: string) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '';
    const diffMs = serverNowMs() - t;
    const sec = Math.floor(diffMs / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (sec < 10) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    if (min < 60) return `${min}m ago`;
    if (hr < 24) return `${hr}h ago`;
    return `${day}d ago`;
  };

  const auditTypeLabel = (raw: string) => {
    switch (raw) {
      case 'inventory_item.created':
        return 'Inventory Item Created';
      case 'inventory_item.updated':
        return 'Inventory Item Updated';
      case 'inventory_item.deleted':
        return 'Inventory Item Deleted';
      case 'menu_product.created':
        return 'Menu Item Created';
      case 'menu_product.updated':
        return 'Menu Item Updated';
      case 'menu_product.deleted':
        return 'Menu Item Deleted';
      case 'menu_recipe.upserted':
        return 'Recipe Updated';
      case 'menu_recipe.deleted':
        return 'Recipe Deleted';
      default:
        return raw || 'Event';
    }
  };

  const stats = useMemo(() => {
    const totalItems = items.length;
    const lowStockAlerts = items.filter((x) => x.stock <= 0 || x.stock < x.minStock).length;
    const inventoryValue = items.reduce((sum, x) => sum + (Number(x.stock) || 0) * (Number(x.price) || 0), 0);
    return { totalItems, lowStockAlerts, inventoryValue };
  }, [items]);

  const computedRecipe = useMemo(() => {
    if (!selectedProduct) return null;
    const base: Recipe = selectedRecipe ?? { productId: selectedProduct.id, productName: selectedProduct.name, ingredients: [], totalCost: 0 };
    const ingredients = base.ingredients.map((ing) => {
      const item = items.find((x) => x.id === ing.ingredientId);
      const unitCost = item?.price ?? 0;
      return { ...ing, cost: ing.quantity * unitCost };
    });
    const totalCost = ingredients.reduce((sum, x) => sum + x.cost, 0);
    return { ...base, ingredients, totalCost };
  }, [items, selectedProduct, selectedRecipe]);

  const openAdd = () => {
    setEditId('__new__');
    setDraftName('');
    setDraftCategory('Raw Material');
    setDraftStock('0');
    setDraftUnit('kg');
    setDraftMinStock('0');
    setDraftPrice('0');
  };

  const openEdit = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setEditId(it.id);
    setDraftName(it.name);
    setDraftCategory(it.category);
    setDraftStock(String(it.stock));
    setDraftUnit(it.unit);
    setDraftMinStock(String(it.minStock));
    setDraftPrice(String(it.price));
  };

  const closeModal = () => {
    setEditId(null);
    setDraftName('');
    setDraftCategory('');
    setDraftStock('');
    setDraftUnit('');
    setDraftMinStock('');
    setDraftPrice('');
  };

  const closeDelete = () => setDeleteId(null);

  const loadSuppliers = async () => {
    try {
      const res = await apiFetch('/api/manager/suppliers?limit=500');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.suppliers) ? (json.suppliers as any[]) : [];
      const next: SupplierRow[] = rows
        .map((s) => ({
          id: String(s.id || ''),
          name: String(s.name || ''),
          phone: String(s.phone || ''),
          email: String(s.email || ''),
          address: String(s.address || ''),
          status: String(s.status || 'Active'),
          notes: String(s.notes || ''),
          updatedAt: String(s.updatedAt || ''),
        }))
        .filter((s) => s.id && s.name);
      setSuppliers(next);
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load suppliers.' });
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await apiFetch('/api/manager/audit/list?limit=100');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.audit) ? (json.audit as any[]) : [];
      const next: AuditRow[] = rows.map((x) => ({
        id: String(x.id || ''),
        type: String(x.type || ''),
        summary: String(x.summary || ''),
        actorName: String(x.actorName || ''),
        actorRole: String(x.actorRole || ''),
        at: String(x.at || ''),
      }));
      setAudit(next.filter((x) => x.id));
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load audit log.' });
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'suppliers') void loadSuppliers();
    if (activeTab === 'audit') void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openNewSupplier = () => {
    setSupplierEditId('__new__');
    setSupplierName('');
    setSupplierPhone('');
    setSupplierEmail('');
    setSupplierAddress('');
    setSupplierNotes('');
  };

  const openEditSupplier = (id: string) => {
    const s = suppliers.find((x) => x.id === id);
    if (!s) return;
    setSupplierEditId(id);
    setSupplierName(s.name);
    setSupplierPhone(s.phone);
    setSupplierEmail(s.email);
    setSupplierAddress(s.address);
    setSupplierNotes(s.notes);
  };

  const closeSupplierModal = () => {
    setSupplierEditId(null);
    setSupplierName('');
    setSupplierPhone('');
    setSupplierEmail('');
    setSupplierAddress('');
    setSupplierNotes('');
  };

  const saveSupplier = () => {
    if (!supplierName.trim()) return;
    setSupplierBusy(true);
    void (async () => {
      try {
        const body = {
          name: supplierName.trim(),
          phone: supplierPhone.trim(),
          email: supplierEmail.trim(),
          address: supplierAddress.trim(),
          notes: supplierNotes.trim(),
        };
        if (supplierEditId === '__new__') {
          const res = await apiFetch('/api/manager/suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
          setFlash({ kind: 'success', message: 'Supplier created.' });
        } else if (supplierEditId) {
          const res = await apiFetch(`/api/manager/suppliers/${encodeURIComponent(supplierEditId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
          setFlash({ kind: 'success', message: 'Supplier updated.' });
        }
        closeSupplierModal();
        await loadSuppliers();
      } catch (e) {
        setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save supplier.' });
      } finally {
        setSupplierBusy(false);
      }
    })();
  };

  const saveModal = () => {
    const stock = Number.parseFloat(draftStock);
    const minStock = Number.parseFloat(draftMinStock);
    const price = Number.parseFloat(draftPrice);
    if (!draftName.trim()) return;
    if (!Number.isFinite(stock) || !Number.isFinite(minStock) || !Number.isFinite(price)) return;

    const status = stock < minStock ? (stock <= 0 ? 'Critical' : 'Low Stock') : 'In Stock';

    void (async () => {
      try {
        if (editId === '__new__') {
          const id = `INV${Date.now()}`;
          const res = await apiFetch('/api/inventory/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name: draftName.trim(), category: draftCategory, stock, unit: draftUnit, minStock, price }),
          });
          if (!res.ok) return;
        } else {
          const res = await apiFetch(`/api/inventory/items/${encodeURIComponent(String(editId))}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: draftName.trim(), category: draftCategory, stock, unit: draftUnit, minStock, price }),
          });
          if (!res.ok) return;
        }

        const res2 = await apiFetch('/api/inventory/items');
        const json2 = (await res2.json().catch(() => null)) as any;
        if (!res2.ok) return;
        const rows2 = Array.isArray(json2?.items) ? (json2.items as InventoryItemRow[]) : [];
        setItems(rows2);
        closeModal();
      } catch {
        // ignore
      }
    })();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Inventory & Recipe Management" subtitle="Track stock levels, define recipes and manage costing" />
      
      <div className="flex-1 overflow-y-auto p-6">

        {flash ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-bold mb-5 ${
              flash.kind === 'success'
                ? 'bg-emerald-900/10 border-emerald-800 text-emerald-200'
                : 'bg-red-900/10 border-red-800 text-red-200'
            }`}
          >
            {flash.message}
          </div>
        ) : null}
        
        {/* Navigation Tabs */}
        <div className="flex gap-4 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab('stock')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'stock' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}
          >
            Current Stock
          </button>
          <button
            onClick={() => setActiveTab('recipes')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'recipes' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}
          >
            Recipe Mapping
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'suppliers' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}
          >
            Suppliers
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'audit' ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}
          >
            Audit Log
          </button>
        </div>

        {/* STOCK TAB */}
        {activeTab === 'stock' && (
            <div className="animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-surface p-4 rounded-lg border border-border">
                        <p className="text-text-muted text-xs font-medium">Total Items</p>
                        <h3 className="text-2xl font-bold text-white">{stats.totalItems}</h3>
                    </div>
                    <div className="bg-surface p-4 rounded-lg border border-border">
                        <p className="text-text-muted text-xs font-medium">Low Stock Alerts</p>
                        <h3 className="text-2xl font-bold text-danger">{stats.lowStockAlerts}</h3>
                    </div>
                    <div className="bg-surface p-4 rounded-lg border border-border">
                        <p className="text-text-muted text-xs font-medium">Inventory Value</p>
                        <h3 className="text-2xl font-bold text-white">ETB {stats.inventoryValue.toFixed(0)}</h3>
                    </div>
                    <button onClick={openAdd} className="bg-primary hover:bg-primary-hover text-background font-bold rounded-lg flex flex-col items-center justify-center transition-colors">
                        <span className="material-symbols-outlined mb-1">add_circle</span>
                        <span>Add Stock Item</span>
                    </button>
                </div>

                <div className="bg-surface rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-surface-light border-b border-border">
                                <th className="p-4 text-xs font-bold text-text-muted uppercase">Item Name</th>
                                <th className="p-4 text-xs font-bold text-text-muted uppercase">Category</th>
                                <th className="p-4 text-xs font-bold text-text-muted uppercase">Stock Level</th>
                                <th className="p-4 text-xs font-bold text-text-muted uppercase">Unit Price</th>
                                <th className="p-4 text-xs font-bold text-text-muted uppercase">Status</th>
                                <th className="p-4 text-xs font-bold text-text-muted uppercase text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.map((item) => (
                                <tr key={item.id} className="hover:bg-surface-light/50 transition-colors">
                                    <td className="p-4">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-white">{item.name}</span>
                                            <span className="text-xs text-text-muted">{item.id}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-text-muted">{item.category}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-24 h-2 bg-surface-light rounded-full overflow-hidden border border-border">
                                                <div 
                                                    className={`h-full rounded-full ${
                                                        item.stock < item.minStock ? 'bg-danger' : 'bg-success'
                                                    }`} 
                                                    style={{ width: `${Math.min((item.stock / (item.minStock * 2)) * 100, 100)}%` }}
                                                ></div>
                                            </div>
                                            <span className="text-sm font-bold text-white">{item.stock} {item.unit}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm font-mono text-white">ETB {item.price}</td>
                                    <td className="p-4">
                                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                                            item.status === 'Critical' ? 'bg-danger/20 text-danger' :
                                            item.status === 'Low Stock' ? 'bg-warning/20 text-warning' :
                                            'bg-success/20 text-success'
                                        }`}>
                                            {item.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                          <button onClick={() => openEdit(item.id)} className="text-primary hover:text-primary-hover text-sm font-bold">Edit</button>
                                          <button
                                            onClick={() => setDeleteId(item.id)}
                                            className="text-red-400 hover:text-red-300 text-sm font-bold"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* RECIPE MAPPING TAB */}
        {activeTab === 'recipes' && (
          <div className="animate-fade-in flex flex-col lg:flex-row gap-6">
            <div className="flex-1 bg-surface rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border bg-surface-light flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <h3 className="text-white font-bold text-lg">Menu Products</h3>
                  <p className="text-text-muted text-sm">Select a product to preview its recipe deduction and costing.</p>
                </div>
                <button
                  onClick={() => {
                    if (!selectedProductId) return;
                    onNavigate(Screen.MANAGER_MENU_BUILDER);
                  }}
                  className="px-4 py-2 bg-primary text-background font-bold rounded-lg flex items-center gap-2 disabled:opacity-50"
                  disabled={!selectedProductId}
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span> Edit Recipe
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-light/60 text-text-muted text-xs uppercase font-bold tracking-wider">
                    <tr>
                      <th className="p-4">Product</th>
                      <th className="p-4">Category</th>
                      <th className="p-4">Selling Price</th>
                      <th className="p-4">COGS</th>
                      <th className="p-4">Recipe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {products.map((p) => {
                      const rec = recipes.find((r) => r.productId === p.id) ?? null;
                      const hasRecipe = rec != null && rec.ingredients.length > 0;
                      const selected = selectedProductId === p.id;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => {
                            setSelectedProductId(p.id);
                            try {
                              localStorage.setItem(STORAGE_SELECTED_PRODUCT, p.id);
                            } catch {
                              // ignore
                            }
                          }}
                          className={`group hover:bg-surface-light/50 transition-colors cursor-pointer border-l-4 ${selected ? 'bg-primary/10 border-l-primary' : 'border-l-transparent'}`}
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="size-9 rounded-lg bg-background border border-border overflow-hidden">
                                <img alt={p.name} src={p.image} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-white">{p.name}</span>
                                <span className="text-xs text-text-muted">Code: {p.code}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-sm text-text-muted">{p.category}</td>
                          <td className="p-4 text-sm font-mono text-white">ETB {p.price.toFixed(2)}</td>
                          <td className="p-4 text-sm font-mono text-white">ETB {(rec?.totalCost ?? 0).toFixed(2)}</td>
                          <td className="p-4">
                            <span
                              className={`text-xs px-2 py-1 rounded-full font-bold ${hasRecipe ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}
                            >
                              {hasRecipe ? 'Mapped' : 'No Recipe'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="w-full lg:w-[380px] bg-surface rounded-xl border border-border overflow-hidden flex flex-col">
              <div className="p-4 bg-surface-light border-b border-border flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-text-muted font-bold mb-1">Recipe View</p>
                  <h3 className="text-white font-black text-xl">{selectedProduct?.name ?? 'Select a product'}</h3>
                  <p className="text-text-muted text-sm">{selectedProduct ? 'Composite Product    1 Unit Sales' : 'Click a product to inspect deduction.'}</p>
                </div>
                <button
                  onClick={() => setSelectedProductId(null)}
                  className="text-text-muted hover:text-white p-1"
                  title="Close"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {!selectedProduct ? (
                  <div className="text-text-muted text-sm">No product selected.</div>
                ) : (
                  <>
                    <div className="flex flex-col items-center gap-2 mb-6">
                      <div className="w-full p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-4">
                        <div className="size-12 rounded-lg bg-background border border-border overflow-hidden">
                          <img alt={selectedProduct.name} src={selectedProduct.image} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="text-white font-bold">{selectedProduct.name}</p>
                          <p className="text-xs text-primary font-medium">Sales Price: ETB {selectedProduct.price.toFixed(2)}</p>
                        </div>
                        <div className="ml-auto bg-primary/20 text-primary px-2 py-1 rounded text-xs font-bold">- 1 Unit</div>
                      </div>
                      <div className="h-8 w-0.5 bg-border"></div>
                      <div className="text-xs text-text-muted bg-background px-2 py-0.5 rounded border border-border -my-3">Consumes</div>
                      <div className="h-6 w-0.5 bg-border"></div>

                      <div className="w-full flex flex-col gap-2">
                        {(computedRecipe?.ingredients ?? []).length === 0 ? (
                          <div className="p-3 rounded-lg border border-border bg-surface-light text-text-muted text-sm">
                            No recipe set. Click  œEdit Recipe  to add ingredients.
                          </div>
                        ) : (
                          (computedRecipe?.ingredients ?? []).map((ing) => {
                            const inv = items.find((x) => x.id === ing.ingredientId);
                            const stockLabel = inv ? `${inv.stock}${inv.unit}` : ' ”';
                            return (
                              <div key={ing.ingredientId} className="p-3 rounded-lg border border-border bg-surface-light flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="size-8 rounded-full bg-surface flex items-center justify-center">
                                    <span className="material-symbols-outlined text-sm text-text-muted">inventory_2</span>
                                  </div>
                                  <div>
                                    <p className="text-sm text-white font-medium">{ing.name}</p>
                                    <p className="text-[10px] text-text-muted">Current Stock: {stockLabel}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-danger font-bold text-sm">- {ing.quantity}</p>
                                  <p className="text-[10px] text-text-muted">Cost: ETB {ing.cost.toFixed(2)}</p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-surface-light/30 border border-primary/20">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-text-muted">Total Cost</span>
                        <span className="text-sm font-medium text-white">ETB {(computedRecipe?.totalCost ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-text-muted">Gross Margin</span>
                        <span className="text-sm font-medium text-success">
                          {selectedProduct.price > 0
                            ? (((selectedProduct.price - (computedRecipe?.totalCost ?? 0)) / selectedProduct.price) * 100).toFixed(1)
                            : '0'}
                          %
                        </span>
                      </div>
                      <div className="h-px bg-border/50 my-2"></div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-primary uppercase">Net Profit</span>
                        <span className="text-lg font-bold text-white">ETB {(selectedProduct.price - (computedRecipe?.totalCost ?? 0)).toFixed(2)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-4 border-t border-border bg-surface">
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (!selectedProductId) return;
                      onNavigate(Screen.MANAGER_MENU_BUILDER);
                    }}
                    className="flex-1 py-2 rounded-lg border border-border text-text-muted text-xs font-medium hover:text-white hover:bg-surface-light transition-colors disabled:opacity-50"
                    disabled={!selectedProductId}
                  >
                    Edit Recipe
                  </button>
                  <button className="flex-1 py-2 rounded-lg border border-border text-text-muted text-xs font-medium hover:text-white hover:bg-surface-light transition-colors">
                    View History
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUPPLIERS TAB (Placeholder for visual completeness) */}
        {activeTab === 'suppliers' && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-bold text-lg">Suppliers</h3>
                <p className="text-text-muted text-sm">Manage your suppliers for inventory purchasing.</p>
              </div>
              <button
                onClick={openNewSupplier}
                className="px-4 py-2 bg-primary text-background font-bold rounded-lg flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> Add Supplier
              </button>
            </div>

            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-light border-b border-border">
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Name</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Phone</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Email</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Address</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Status</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-text-muted text-sm">
                        No suppliers yet.
                      </td>
                    </tr>
                  ) : (
                    suppliers.map((s) => (
                      <tr key={s.id} className="hover:bg-surface-light/50 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-white">{s.name}</span>
                            <span className="text-xs text-text-muted">{s.id}</span>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-text-muted">{s.phone || ' ”'}</td>
                        <td className="p-4 text-sm text-text-muted">{s.email || ' ”'}</td>
                        <td className="p-4 text-sm text-text-muted">{s.address || ' ”'}</td>
                        <td className="p-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${s.status === 'Active' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button onClick={() => openEditSupplier(s.id)} className="text-primary hover:text-primary-hover text-sm font-bold">Edit</button>
                            <button
                              onClick={() => setSupplierDeleteId(s.id)}
                              className="text-red-400 hover:text-red-300 text-sm font-bold"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AUDIT TAB (Placeholder) */}
        {activeTab === 'audit' && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-bold text-lg">Audit Log</h3>
                <p className="text-text-muted text-sm">Recent inventory and recipe changes for this branch.</p>
              </div>
              <button
                onClick={() => void loadAudit()}
                className="px-4 py-2 bg-surface border border-border text-white hover:bg-surface-light rounded-lg text-sm font-bold"
                disabled={auditLoading}
              >
                {auditLoading ? 'Loading ¦' : 'Refresh'}
              </button>
            </div>

            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-light border-b border-border">
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">When</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Type</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Summary</th>
                    <th className="p-4 text-xs font-bold text-text-muted uppercase">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-text-muted text-sm">
                        {auditLoading ? 'Loading audit ¦' : 'No audit events yet.'}
                      </td>
                    </tr>
                  ) : (
                    audit.map((a) => (
                      <tr key={a.id} className="hover:bg-surface-light/50 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-text-muted font-mono">{a.at ? formatRelativeTime(a.at) : ' ”'}</span>
                            <span className="text-[11px] text-text-muted/70 font-mono">{a.at ? new Date(a.at).toLocaleString() : ''}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-white font-semibold">{auditTypeLabel(a.type)}</span>
                            <span className="text-[11px] text-text-muted font-mono">{a.type || ' ”'}</span>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-white">{a.summary || ' ”'}</td>
                        <td className="p-4 text-sm text-text-muted">{a.actorName ? `${a.actorName}${a.actorRole ? ` (${a.actorRole})` : ''}` : a.actorRole || ' ”'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Modal
          open={supplierEditId != null}
          title={supplierEditId === '__new__' ? 'Add Supplier' : 'Edit Supplier'}
          onClose={closeSupplierModal}
          footer={
            <div className="flex gap-3">
              <button
                onClick={closeSupplierModal}
                className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
                disabled={supplierBusy}
              >
                Cancel
              </button>
              <button
                onClick={saveSupplier}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary-hover text-background font-extrabold transition-colors disabled:opacity-60"
                disabled={supplierBusy}
              >
                {supplierBusy ? 'Saving ¦' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-text-muted">Name</label>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <label className="text-sm font-bold text-text-muted">Phone</label>
            <input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <label className="text-sm font-bold text-text-muted">Email</label>
            <input value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <label className="text-sm font-bold text-text-muted">Address</label>
            <input value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <label className="text-sm font-bold text-text-muted">Notes</label>
            <textarea value={supplierNotes} onChange={(e) => setSupplierNotes(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white min-h-[90px]" />
          </div>
        </Modal>

        <Modal
          open={supplierDeleteId != null}
          title="Delete Supplier"
          onClose={() => setSupplierDeleteId(null)}
          footer={
            <div className="flex gap-3">
              <button
                onClick={() => setSupplierDeleteId(null)}
                className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
                disabled={supplierBusy}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!supplierDeleteId) return;
                  const id = supplierDeleteId;
                  setSupplierBusy(true);
                  void (async () => {
                    try {
                      const res = await apiFetch(`/api/manager/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
                      const json = (await res.json().catch(() => null)) as any;
                      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                      setSupplierDeleteId(null);
                      setFlash({ kind: 'success', message: 'Supplier deleted.' });
                      await loadSuppliers();
                    } catch (e) {
                      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete supplier.' });
                    } finally {
                      setSupplierBusy(false);
                    }
                  })();
                }}
                className="flex-1 h-11 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold transition-colors disabled:opacity-60"
                disabled={supplierBusy}
              >
                {supplierBusy ? 'Deleting ¦' : 'Delete'}
              </button>
            </div>
          }
        >
          <div className="text-sm text-text-muted">This will permanently remove the supplier.</div>
        </Modal>

        <Modal
          open={editId != null}
          title={editId === '__new__' ? 'Add Stock Item' : editing ? `Edit: ${editing.name}` : 'Edit Item'}
          onClose={closeModal}
          footer={
            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors">Cancel</button>
              <button onClick={saveModal} className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary-hover text-background font-extrabold transition-colors">Save</button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-text-muted">Name</label>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <label className="text-sm font-bold text-text-muted">Category</label>
            <input value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-bold text-text-muted">Stock</label>
                <input value={draftStock} onChange={(e) => setDraftStock(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-sm font-bold text-text-muted">Unit</label>
                <input value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-bold text-text-muted">Min Stock</label>
                <input value={draftMinStock} onChange={(e) => setDraftMinStock(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-sm font-bold text-text-muted">Unit Price</label>
                <input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} className="mt-2 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
          </div>
        </Modal>

        <Modal
          open={deleteId != null}
          title={deleteId ? `Delete ${deleteId}?` : 'Delete Item'}
          onClose={closeDelete}
          footer={
            <div className="flex gap-3">
              <button
                onClick={closeDelete}
                className="flex-1 h-11 rounded-lg bg-surface-light hover:bg-border border border-border text-white font-semibold transition-colors"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!deleteId) return;
                  const id = deleteId;
                  setBusy(true);
                  (async () => {
                    try {
                      const res = await apiFetch(`/api/inventory/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
                      const json = (await res.json().catch(() => null)) as any;
                      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                      setItems((prev) => prev.filter((x) => x.id !== id));
                      setDeleteId(null);
                      setFlash({ kind: 'success', message: 'Item deleted.' });
                    } catch (e) {
                      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete item.' });
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
                className="flex-1 h-11 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold transition-colors disabled:opacity-60"
                disabled={busy}
              >
                {busy ? 'Deleting ¦' : 'Delete'}
              </button>
            </div>
          }
        >
          <div className="text-sm text-text-muted">This will permanently remove the inventory item.</div>
        </Modal>

      </div>
    </div>
  );
};
