import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import { Screen } from '../types';
import type { Product, Recipe } from '../types';
import { apiFetch, serverNowMs } from '../api';
import { usePersistedState } from '../usePersistedState';
import { readSession } from '../session';
import { hasPermission } from '../rbac';
import { formatDeviceDateTime } from '../datetime';

interface Props {
  onNavigate: (screen: Screen) => void;
}

const STORAGE_SELECTED_PRODUCT = 'mirachpos.inventory.selectedProductId';
const STORAGE_ACTIVE_TAB = 'mirachpos.inventory.activeTab.v1';

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

type PurchaseOrderRow = {
  id: string;
  supplierId: string;
  referenceNo: string;
  status: string;
  total: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  receivedAt: string | null;
};

type PurchaseOrderItemRow = {
  id: string;
  purchaseOrderId: string;
  inventoryItemId: string;
  name: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  lineTotal: number;
};

export const Inventory: React.FC<Props> = ({ onNavigate }) => {
  const permissions = (() => {
    try {
      const s = readSession<any>();
      return Array.isArray(s?.permissions) ? s.permissions : [];
    } catch {
      return [];
    }
  })();
  const canUpdateInventory = hasPermission(permissions, 'inventory.update');

  const [activeTab, setActiveTab] = usePersistedState<'stock' | 'recipes' | 'suppliers' | 'audit'>(STORAGE_ACTIVE_TAB, 'stock', {
    validate: (v): v is 'stock' | 'recipes' | 'suppliers' | 'audit' => v === 'stock' || v === 'recipes' || v === 'suppliers' || v === 'audit',
    serialize: (v) => v,
    deserialize: (raw) => raw,
  });
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

  const [poSupplierId, setPoSupplierId] = useState<string | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [poRows, setPoRows] = useState<PurchaseOrderRow[]>([]);

  const [poCreateOpen, setPoCreateOpen] = useState(false);
  const [poRef, setPoRef] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [poDraftItems, setPoDraftItems] = useState<Array<{ inventoryItemId: string; qtyOrdered: string; unitCost: string }>>([]);
  const [poActionBusy, setPoActionBusy] = useState(false);

  const [poDetailOpen, setPoDetailOpen] = useState(false);
  const [poDetailId, setPoDetailId] = useState<string | null>(null);
  const [poDetailLoading, setPoDetailLoading] = useState(false);
  const [poDetailError, setPoDetailError] = useState<string | null>(null);
  const [poDetail, setPoDetail] = useState<PurchaseOrderRow | null>(null);
  const [poDetailItems, setPoDetailItems] = useState<PurchaseOrderItemRow[]>([]);
  const [poReceiveNote, setPoReceiveNote] = useState('');
  const [poReceiveDraft, setPoReceiveDraft] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<AuditRow[]>([]);
  const [selectedProductId, setSelectedProductId] = usePersistedState<string | null>(STORAGE_SELECTED_PRODUCT, null, {
    validate: (v): v is string | null => v === null || typeof v === 'string',
    serialize: (v) => v ?? '',
    deserialize: (raw) => (raw ? raw : null),
    removeWhen: (v) => v == null || !String(v).trim(),
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

  function resolveBranchId() {
    try {
      const session = readSession<any>();
      const bid = String(session?.branchId || '').trim();
      if (bid && bid !== 'global') return bid;
      const role = String(session?.role || '');
      if (role === 'Cafe Owner') {
        const raw = String(localStorage.getItem('mirachpos.owner.selectedBranchId.v1') || '').trim();
        if (raw && raw !== 'global') return raw;
      }
    } catch {
      // ignore
    }
    return '';
  }

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
        const qs = new URLSearchParams();
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/inventory/items${qs.toString() ? `?${qs.toString()}` : ''}`);
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

  const loadPurchaseOrders = async (supplierId: string) => {
    setPoLoading(true);
    setPoError(null);
    try {
      const qs = new URLSearchParams({ limit: '100', supplierId });
      const bid = resolveBranchId();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/purchase-orders?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || json?.message || res.status));
      const rows = Array.isArray(json?.purchaseOrders) ? (json.purchaseOrders as any[]) : [];
      const next: PurchaseOrderRow[] = rows
        .map((p) => ({
          id: String(p?.id || ''),
          supplierId: String(p?.supplierId || ''),
          referenceNo: String(p?.referenceNo || ''),
          status: String(p?.status || ''),
          total: Number(p?.total ?? 0) || 0,
          notes: String(p?.notes || ''),
          createdAt: String(p?.createdAt || ''),
          updatedAt: String(p?.updatedAt || ''),
          sentAt: p?.sentAt ? String(p.sentAt) : null,
          receivedAt: p?.receivedAt ? String(p.receivedAt) : null,
        }))
        .filter((x) => x.id);
      setPoRows(next);
    } catch (e) {
      setPoRows([]);
      setPoError(e instanceof Error ? e.message : 'Failed to load purchase orders.');
    } finally {
      setPoLoading(false);
    }
  };

  const openSupplierPOs = (supplierId: string) => {
    setPoSupplierId(supplierId);
    setPoRows([]);
    setPoError(null);
    void loadPurchaseOrders(supplierId);
  };

  const closeSupplierPOs = () => {
    setPoSupplierId(null);
    setPoRows([]);
    setPoError(null);
  };

  const openCreatePO = () => {
    if (!poSupplierId) return;
    setPoCreateOpen(true);
    setPoRef('');
    setPoNotes('');
    const firstInv = items[0]?.id ? String(items[0].id) : '';
    setPoDraftItems(firstInv ? [{ inventoryItemId: firstInv, qtyOrdered: '1', unitCost: String(items[0]?.price ?? 0) }] : []);
  };

  const addPoLine = () => {
    const firstInv = items[0]?.id ? String(items[0].id) : '';
    if (!firstInv) return;
    setPoDraftItems((cur) => [...cur, { inventoryItemId: firstInv, qtyOrdered: '1', unitCost: String(items.find((x) => x.id === firstInv)?.price ?? 0) }]);
  };

  const removePoLine = (idx: number) => {
    setPoDraftItems((cur) => cur.filter((_, i) => i !== idx));
  };

  const savePO = async (status: 'Draft' | 'Sent') => {
    if (!poSupplierId) return;
    if (poActionBusy) return;
    setPoActionBusy(true);
    try {
      const payloadItems = poDraftItems
        .map((l) => {
          const inventoryItemId = String(l.inventoryItemId || '').trim();
          const inv = items.find((x) => x.id === inventoryItemId);
          const qtyOrdered = Number(l.qtyOrdered);
          const unitCost = Number(l.unitCost);
          return {
            inventoryItemId,
            name: String(inv?.name || ''),
            unit: String(inv?.unit || ''),
            qtyOrdered: Number.isFinite(qtyOrdered) ? qtyOrdered : 0,
            unitCost: Number.isFinite(unitCost) ? unitCost : 0,
          };
        })
        .filter((x) => x.inventoryItemId && x.name && x.qtyOrdered > 0);

      if (payloadItems.length === 0) throw new Error('Add at least one PO line item.');

      const body = {
        supplierId: poSupplierId,
        referenceNo: poRef.trim(),
        notes: poNotes.trim(),
        status,
        items: payloadItems,
      };

      const res = await apiFetch('/api/manager/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || json?.message || res.status));

      const createdRef = typeof json?.referenceNo === 'string' ? json.referenceNo : '';
      const refLabel = (createdRef || poRef.trim() || '').trim();
      setPoCreateOpen(false);
      setFlash({
        kind: 'success',
        message: status === 'Sent'
          ? `Purchase order sent${refLabel ? ` (${refLabel})` : ''}.`
          : `Purchase order created${refLabel ? ` (${refLabel})` : ''}.`,
      });
      await loadPurchaseOrders(poSupplierId);
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create purchase order.' });
    } finally {
      setPoActionBusy(false);
    }
  };

  const loadPODetail = async (id: string) => {
    setPoDetailLoading(true);
    setPoDetailError(null);
    try {
      const qs = new URLSearchParams();
      const bid = resolveBranchId();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/purchase-orders/${encodeURIComponent(id)}${qs.toString() ? `?${qs.toString()}` : ''}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || json?.message || res.status));

      const po = json?.purchaseOrder || null;
      const mappedPo: PurchaseOrderRow | null = po
        ? {
            id: String(po?.id || ''),
            supplierId: String(po?.supplierId || ''),
            referenceNo: String(po?.referenceNo || ''),
            status: String(po?.status || ''),
            total: Number(po?.total ?? 0) || 0,
            notes: String(po?.notes || ''),
            createdAt: String(po?.createdAt || ''),
            updatedAt: String(po?.updatedAt || ''),
            sentAt: po?.sentAt ? String(po.sentAt) : null,
            receivedAt: po?.receivedAt ? String(po.receivedAt) : null,
          }
        : null;

      const items0 = Array.isArray(json?.items) ? (json.items as any[]) : [];
      const mappedItems: PurchaseOrderItemRow[] = items0
        .map((it) => ({
          id: String(it?.id || ''),
          purchaseOrderId: String(it?.purchaseOrderId || it?.purchase_order_id || ''),
          inventoryItemId: String(it?.inventoryItemId || it?.inventory_item_id || ''),
          name: String(it?.name || ''),
          unit: String(it?.unit || ''),
          qtyOrdered: Number(it?.qtyOrdered ?? it?.qty_ordered ?? 0) || 0,
          qtyReceived: Number(it?.qtyReceived ?? it?.qty_received ?? 0) || 0,
          unitCost: Number(it?.unitCost ?? it?.unit_cost ?? 0) || 0,
          lineTotal: Number(it?.lineTotal ?? it?.line_total ?? 0) || 0,
        }))
        .filter((x) => x.id);

      setPoDetail(mappedPo);
      setPoDetailItems(mappedItems);
      setPoReceiveDraft({});
      setPoReceiveNote('');
    } catch (e) {
      setPoDetail(null);
      setPoDetailItems([]);
      setPoDetailError(e instanceof Error ? e.message : 'Failed to load purchase order.');
    } finally {
      setPoDetailLoading(false);
    }
  };

  const openPODetail = (id: string) => {
    setPoDetailOpen(true);
    setPoDetailId(id);
    void loadPODetail(id);
  };

  const closePODetail = () => {
    setPoDetailOpen(false);
    setPoDetailId(null);
    setPoDetail(null);
    setPoDetailItems([]);
    setPoReceiveDraft({});
    setPoReceiveNote('');
    setPoDetailError(null);
  };

  const markPOSent = async () => {
    if (!poDetailId || !poDetail) return;
    if (poActionBusy) return;
    setPoActionBusy(true);
    try {
      const bid = resolveBranchId();
      const qs = new URLSearchParams();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/purchase-orders/${encodeURIComponent(poDetailId)}${qs.toString() ? `?${qs.toString()}` : ''}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Sent' }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(json?.error || json?.message || res.status));
      await loadPODetail(poDetailId);
      if (poSupplierId) await loadPurchaseOrders(poSupplierId);
      setFlash({ kind: 'success', message: 'PO marked as Sent.' });
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to update PO.' });
    } finally {
      setPoActionBusy(false);
    }
  };

  const receivePO = async () => {
    if (!poDetailId) return;
    if (poActionBusy) return;
    setPoActionBusy(true);
    try {
      const itemsToReceive = poDetailItems
        .map((it) => {
          const raw = String(poReceiveDraft[it.id] || '').trim();
          const qty = Number(raw);
          return { inventoryItemId: it.inventoryItemId, qtyReceivedDelta: Number.isFinite(qty) ? qty : 0 };
        })
        .filter((x) => x.inventoryItemId && x.qtyReceivedDelta > 0);

      if (itemsToReceive.length === 0) throw new Error('Enter at least one receive quantity.');

      const bid = resolveBranchId();
      const qs = new URLSearchParams();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/purchase-orders/${encodeURIComponent(poDetailId)}/receive${qs.toString() ? `?${qs.toString()}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToReceive, note: poReceiveNote.trim() }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        const code = String(json?.error || json?.message || res.status);
        if (code === 'po_not_sent') throw new Error('Send the PO before receiving stock.');
        if (code === 'po_already_received') throw new Error('This PO is already fully received.');
        throw new Error(code);
      }

      // Refresh PO + inventory list so stock reflects receiving.
      await loadPODetail(poDetailId);
      try {
        const qsInv = new URLSearchParams();
        const b = resolveBranchId();
        if (b) qsInv.set('branchId', b);
        const invRes = await apiFetch(`/api/inventory/items${qsInv.toString() ? `?${qsInv.toString()}` : ''}`);
        const invJson = (await invRes.json().catch(() => null)) as any;
        if (invRes.ok) {
          const invRows = Array.isArray(invJson?.items) ? (invJson.items as InventoryItemRow[]) : [];
          setItems(invRows);
        }
      } catch {
        // ignore
      }
      if (poSupplierId) await loadPurchaseOrders(poSupplierId);
      setFlash({ kind: 'success', message: 'Stock received and inventory updated.' });
    } catch (e) {
      setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to receive stock.' });
    } finally {
      setPoActionBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const qs = new URLSearchParams({ limit: '500' });
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
        const res = await apiFetch(`/api/manager/menu/products?${qs.toString()}`);
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
        const bid = resolveBranchId();
        if (bid) qs.set('branchId', bid);
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
    if (!canUpdateInventory) {
      setFlash({ kind: 'error', message: 'Access denied: missing permission inventory.update' });
      return;
    }
    setEditId('__new__');
    setDraftName('');
    setDraftCategory('Raw Material');
    setDraftStock('0');
    setDraftUnit('kg');
    setDraftMinStock('0');
    setDraftPrice('0');
  };

  const openEdit = (id: string) => {
    if (!canUpdateInventory) {
      setFlash({ kind: 'error', message: 'Access denied: missing permission inventory.update' });
      return;
    }
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
      const qs = new URLSearchParams({ limit: '500' });
      const bid = resolveBranchId();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/suppliers?${qs.toString()}`);
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
      const qs = new URLSearchParams({ limit: '100' });
      const bid = resolveBranchId();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/audit/list?${qs.toString()}`);
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

  const loadRecipeHistory = async () => {
    if (!selectedProduct) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      const bid = resolveBranchId();
      if (bid) qs.set('branchId', bid);
      const res = await apiFetch(`/api/manager/audit/list?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.audit) ? (json.audit as any[]) : [];

      const pid = selectedProduct.id;
      const filtered: AuditRow[] = rows
        .filter((x: any) => {
          const type = String(x?.type || '');
          if (type !== 'menu_recipe.upserted' && type !== 'menu_recipe.deleted') return false;
          const payload = x?.payload && typeof x.payload === 'object' ? x.payload : null;
          const payloadPid = payload && typeof (payload as any)?.productId === 'string' ? String((payload as any).productId) : '';
          return payloadPid === pid;
        })
        .map((x: any) => ({
          id: String(x.id || ''),
          type: String(x.type || ''),
          summary: String(x.summary || ''),
          actorName: String(x.actorName || ''),
          actorRole: String(x.actorRole || ''),
          at: String(x.at || ''),
        }))
        .filter((x) => x.id);

      setHistoryRows(filtered);
    } catch (e) {
      setHistoryRows([]);
      setHistoryError(e instanceof Error ? e.message : 'Failed to load recipe history.');
    } finally {
      setHistoryLoading(false);
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
    if (!canUpdateInventory) {
      setFlash({ kind: 'error', message: 'Access denied: missing permission inventory.update' });
      return;
    }
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
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      <header className="h-16 shrink-0 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-8 z-10">
        <div>
          <h2 className="text-foreground text-xl font-bold">Inventory &amp; Recipe Management</h2>
          <p className="text-muted-foreground text-xs">Track stock levels, define recipes and manage costing</p>
        </div>
      </header>
      
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
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'stock' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Current Stock
          </button>
          <button
            onClick={() => setActiveTab('recipes')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'recipes' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Recipe Mapping
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'suppliers' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Suppliers
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-2 text-sm font-bold transition-all ${activeTab === 'audit' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Audit Log
          </button>
        </div>

        {/* STOCK TAB */}
        {activeTab === 'stock' && (
            <div className="animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <p className="text-muted-foreground text-xs font-medium">Total Items</p>
                        <h3 className="text-2xl font-bold text-foreground">{stats.totalItems}</h3>
                    </div>
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <p className="text-muted-foreground text-xs font-medium">Low Stock Alerts</p>
                        <h3 className="text-2xl font-bold text-rose-300">{stats.lowStockAlerts}</h3>
                    </div>
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <p className="text-muted-foreground text-xs font-medium">Inventory Value</p>
                        <h3 className="text-2xl font-bold text-foreground">ETB {stats.inventoryValue.toFixed(0)}</h3>
                    </div>
                    <button
                      onClick={openAdd}
                      disabled={!canUpdateInventory}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg flex flex-col items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <span className="material-symbols-outlined mb-1">add_circle</span>
                        <span>Add Stock Item</span>
                    </button>
                </div>

                <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-background border-b border-border">
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Item Name</th>
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Category</th>
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Stock Level</th>
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Unit Price</th>
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                                <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.map((item) => (
                                <tr key={item.id} className="hover:bg-accent transition-colors">
                                    <td className="p-4">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-foreground">{item.name}</span>
                                            <span className="text-xs text-muted-foreground">{item.id}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-muted-foreground">{item.category}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden border border-border">
                                                <div 
                                                    className={`h-full rounded-full ${
                                                        item.stock <= 0 ? 'bg-rose-500' : item.stock < item.minStock ? 'bg-amber-400' : 'bg-emerald-500'
                                                    }`} 
                                                    style={{
                                                      width: `${Math.min(
                                                        100,
                                                        item.stock <= 0
                                                          ? 0
                                                          : item.stock < item.minStock
                                                            ? (item.stock / Math.max(item.minStock, 1)) * 100
                                                            : 100,
                                                      )}%`,
                                                    }}
                                                ></div>
                                            </div>
                                            <span className="text-sm font-bold text-foreground">{item.stock} {item.unit}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm font-mono text-foreground">ETB {item.price}</td>
                                    <td className="p-4">
                                        <span
                                          className={`inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full font-bold border ${
                                            item.status === 'Critical'
                                              ? 'bg-rose-500/10 text-rose-200 border-rose-500/30'
                                              : item.status === 'Low Stock'
                                                ? 'bg-amber-400/10 text-amber-200 border-amber-400/30'
                                                : 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                                          }`}
                                        >
                                          <span
                                            className={`size-1.5 rounded-full ${
                                              item.status === 'Critical' ? 'bg-rose-500' : item.status === 'Low Stock' ? 'bg-amber-400' : 'bg-emerald-500'
                                            }`}
                                          />
                                          {item.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                          <button
                                            onClick={() => openEdit(item.id)}
                                            disabled={!canUpdateInventory}
                                            className="text-primary hover:text-primary/90 text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => {
                                              if (!canUpdateInventory) {
                                                setFlash({ kind: 'error', message: 'Access denied: missing permission inventory.update' });
                                                return;
                                              }
                                              setDeleteId(item.id);
                                            }}
                                            disabled={!canUpdateInventory}
                                            className="text-red-400 hover:text-red-300 text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
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

        <Modal
          open={poSupplierId != null}
          title="Purchase Orders"
          onClose={closeSupplierPOs}
          footer={
            <div className="flex gap-3">
              <button
                onClick={closeSupplierPOs}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={openCreatePO}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={!poSupplierId}
              >
                Create PO
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {poError ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{poError}</div> : null}
            {poLoading ? <div className="text-sm text-muted-foreground">Loading purchase orders...</div> : null}

            {!poLoading && poRows.length === 0 ? <div className="text-sm text-muted-foreground">No purchase orders yet.</div> : null}

            {!poLoading && poRows.length > 0 ? (
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="divide-y divide-border">
                  {poRows.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openPODetail(p.id)}
                      className="w-full text-left p-3 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-foreground font-bold truncate">{p.referenceNo ? `PO • ${p.referenceNo}` : `PO • ${p.id}`}</div>
                          <div className="text-xs text-muted-foreground truncate">{p.notes || '—'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm text-foreground font-mono">ETB {Number(p.total || 0).toFixed(2)}</div>
                          <div className="mt-1">
                            <span
                              className={`inline-flex items-center gap-2 text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                                p.status === 'Draft'
                                  ? 'bg-secondary text-muted-foreground border-border'
                                  : p.status === 'Sent'
                                    ? 'bg-primary/10 text-primary border-primary/25'
                                    : p.status === 'Partially Received'
                                      ? 'bg-amber-400/10 text-amber-200 border-amber-400/30'
                                      : p.status === 'Received'
                                        ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                                        : 'bg-secondary/60 text-muted-foreground border-border'
                              }`}
                            >
                              {p.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>

        <Modal
          open={poCreateOpen}
          title="Create Purchase Order"
          onClose={() => setPoCreateOpen(false)}
          footer={
            <div className="flex gap-3">
              <button
                onClick={() => setPoCreateOpen(false)}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                disabled={poActionBusy}
              >
                Cancel
              </button>
              <button
                onClick={() => void savePO('Draft')}
                className="flex-1 h-11 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground font-bold transition-colors disabled:opacity-60"
                disabled={poActionBusy || poDraftItems.length === 0}
              >
                {poActionBusy ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={() => void savePO('Sent')}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={poActionBusy || poDraftItems.length === 0}
              >
                {poActionBusy ? 'Sending...' : 'Send'}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-muted-foreground">Reference #</label>
            <input
              value={poRef}
              onChange={(e) => setPoRef(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
              placeholder="Leave blank to auto-generate (e.g., PO-000123)"
            />

            <label className="text-sm font-bold text-muted-foreground">Notes</label>
            <textarea
              value={poNotes}
              onChange={(e) => setPoNotes(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 min-h-[80px]"
              placeholder="Optional"
            />

            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-foreground">Items</div>
              <button
                onClick={addPoLine}
                className="text-xs font-bold text-primary hover:text-primary/90"
                disabled={items.length === 0}
              >
                + Add Line
              </button>
            </div>

            {items.length === 0 ? <div className="text-sm text-muted-foreground">No inventory items available.</div> : null}

            <div className="flex flex-col gap-2">
              {poDraftItems.map((l, idx) => (
                <div key={`${l.inventoryItemId}-${idx}`} className="p-3 rounded-xl border border-border bg-background">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-muted-foreground font-bold">Inventory Item</label>
                      <select
                        value={l.inventoryItemId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPoDraftItems((cur) =>
                            cur.map((x, i) =>
                              i === idx ? { ...x, inventoryItemId: v, unitCost: String(items.find((it) => it.id === v)?.price ?? x.unitCost) } : x,
                            ),
                          );
                        }}
                        className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                      >
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-muted-foreground font-bold">Qty Ordered</label>
                      <input
                        value={l.qtyOrdered}
                        onChange={(e) => setPoDraftItems((cur) => cur.map((x, i) => (i === idx ? { ...x, qtyOrdered: e.target.value } : x)))}
                        className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-muted-foreground font-bold">Unit Cost (ETB)</label>
                      <input
                        value={l.unitCost}
                        onChange={(e) => setPoDraftItems((cur) => cur.map((x, i) => (i === idx ? { ...x, unitCost: e.target.value } : x)))}
                        className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-muted-foreground">
                      Line Total: ETB {(() => {
                        const q = Number(l.qtyOrdered);
                        const c = Number(l.unitCost);
                        return (Number.isFinite(q) && Number.isFinite(c) ? q * c : 0).toFixed(2);
                      })()}
                    </div>
                    <button onClick={() => removePoLine(idx)} className="text-xs font-bold text-red-300 hover:text-red-200">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>

        <Modal
          open={poDetailOpen}
          title="Purchase Order"
          onClose={closePODetail}
          footer={
            <div className="flex gap-3">
              <button
                onClick={closePODetail}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                disabled={poActionBusy}
              >
                Close
              </button>
              <button
                onClick={() => void loadPODetail(String(poDetailId || ''))}
                className="flex-1 h-11 rounded-lg border border-border bg-background hover:bg-accent text-muted-foreground font-bold transition-colors disabled:opacity-60"
                disabled={poActionBusy || !poDetailId}
              >
                Refresh
              </button>
              <button
                onClick={() => void markPOSent()}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={poActionBusy || !poDetailId || !poDetail || poDetail.status !== 'Draft'}
              >
                Mark Sent
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {poDetailError ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{poDetailError}</div> : null}
            {poDetailLoading ? <div className="text-sm text-muted-foreground">Loading purchase order...</div> : null}

            {poDetail ? (
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-foreground">{poDetail.referenceNo ? `Ref: ${poDetail.referenceNo}` : `ID: ${poDetail.id}`}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>Status:</span>
                      <span
                        className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                          poDetail.status === 'Draft'
                            ? 'bg-secondary text-muted-foreground border-border'
                            : poDetail.status === 'Sent'
                              ? 'bg-primary/10 text-primary border-primary/25'
                              : poDetail.status === 'Partially Received'
                                ? 'bg-amber-400/10 text-amber-200 border-amber-400/30'
                                : poDetail.status === 'Received'
                                  ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                                  : 'bg-secondary/60 text-muted-foreground border-border'
                        }`}
                      >
                        {poDetail.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">Total: ETB {Number(poDetail.total || 0).toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted-foreground font-mono">Created {poDetail.createdAt ? formatRelativeTime(poDetail.createdAt) : ''}</div>
                    <div className="text-[11px] text-muted-foreground/70 font-mono">{poDetail.createdAt ? (formatDeviceDateTime(poDetail.createdAt) || '') : ''}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Notes: {poDetail.notes || '—'}</div>
                {poDetail.sentAt ? (
                  <div className="mt-2 text-[11px] text-muted-foreground/70 font-mono">Sent at: {formatDeviceDateTime(poDetail.sentAt) || ''}</div>
                ) : null}
                {poDetail.receivedAt ? (
                  <div className="mt-1 text-[11px] text-emerald-200/80 font-mono">Received at: {formatDeviceDateTime(poDetail.receivedAt) || ''}</div>
                ) : null}
              </div>
            ) : null}

            {poDetail && poDetailItems.length > 0 ? (
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="divide-y divide-border">
                  {poDetailItems.map((it) => {
                    const remaining = Math.max(0, Number(it.qtyOrdered || 0) - Number(it.qtyReceived || 0));
                    return (
                      <div key={it.id} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-foreground font-bold truncate">{it.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Ordered: {Number(it.qtyOrdered || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} {it.unit || ''} • Received:{' '}
                              {Number(it.qtyReceived || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} {it.unit || ''} • Remaining:{' '}
                              {remaining.toLocaleString(undefined, { maximumFractionDigits: 3 })} {it.unit || ''}
                            </div>
                            <div className="text-[11px] text-muted-foreground/70 font-mono">ETB {Number(it.unitCost || 0).toFixed(2)} / unit</div>
                          </div>

                          <div className="w-28">
                            <label className="text-[10px] text-muted-foreground font-bold">Receive Now</label>
                            <input
                              value={poReceiveDraft[it.id] ?? ''}
                              onChange={(e) => setPoReceiveDraft((cur) => ({ ...cur, [it.id]: e.target.value }))}
                              className="mt-1 w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                              placeholder="0"
                              disabled={poActionBusy || remaining <= 0 || poDetail.status === 'Draft' || poDetail.status === 'Received'}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {poDetail ? (
              <>
                {poDetail.status === 'Draft' ? (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
                    Send the PO first. Receiving is enabled only after the PO is sent.
                  </div>
                ) : poDetail.status === 'Received' ? (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    This PO is fully received. Inventory was updated.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-foreground">Receive Stock</div>
                      <button
                        onClick={() => {
                          const next: Record<string, string> = {};
                          for (const it of poDetailItems) {
                            const remaining = Math.max(0, Number(it.qtyOrdered || 0) - Number(it.qtyReceived || 0));
                            if (remaining > 0) next[it.id] = String(remaining);
                          }
                          setPoReceiveDraft(next);
                        }}
                        className="text-xs font-bold text-primary hover:text-primary/90"
                        disabled={poActionBusy}
                      >
                        Receive All Remaining
                      </button>
                    </div>

                    <label className="text-sm font-bold text-muted-foreground">Receiving Note (optional)</label>
                    <textarea
                      value={poReceiveNote}
                      onChange={(e) => setPoReceiveNote(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 min-h-[70px]"
                      placeholder="e.g. Delivered partially, missing onions"
                      disabled={poActionBusy}
                    />
                    <button
                      onClick={() => void receivePO()}
                      className="h-11 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-emerald-950 font-extrabold transition-colors disabled:opacity-60"
                      disabled={poActionBusy || !poDetailId}
                    >
                      {poActionBusy ? 'Receiving...' : 'Receive Stock'}
                    </button>
                    <div className="text-[11px] text-muted-foreground/70">
                      Receiving updates inventory stock immediately. You can receive partially multiple times until fully received.
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        </Modal>

        {/* RECIPE MAPPING TAB */}
        {activeTab === 'recipes' && (
          <div className="animate-fade-in flex flex-col lg:flex-row gap-6">
            <div className="flex-1 bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border bg-background flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <h3 className="text-foreground font-bold text-lg">Menu Products</h3>
                  <p className="text-muted-foreground text-sm">Select a product to preview its recipe deduction and costing.</p>
                </div>
                <button
                  onClick={() => {
                    if (!selectedProductId) return;
                    try {
                      localStorage.setItem(STORAGE_SELECTED_PRODUCT, selectedProductId);
                    } catch {
                      // ignore
                    }
                    onNavigate(Screen.MANAGER_RECIPE_BUILDER);
                  }}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg flex items-center gap-2 disabled:opacity-50"
                  disabled={!selectedProductId}
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span> Edit Recipe
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-background text-muted-foreground text-xs uppercase font-bold tracking-wider border-b border-border">
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
                          className={`group hover:bg-accent transition-colors cursor-pointer border-l-4 ${selected ? 'bg-primary/10 border-l-primary' : 'border-l-transparent'}`}
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="size-9 rounded-lg bg-background border border-border overflow-hidden">
                                <img alt={p.name} src={p.image} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-foreground">{p.name}</span>
                                <span className="text-xs text-muted-foreground">Code: {p.code}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">{p.category}</td>
                          <td className="p-4 text-sm font-mono text-foreground">ETB {p.price.toFixed(2)}</td>
                          <td className="p-4 text-sm font-mono text-foreground">ETB {(rec?.totalCost ?? 0).toFixed(2)}</td>
                          <td className="p-4">
                            <span
                              className={`text-xs px-2 py-1 rounded-full font-bold border ${
                                hasRecipe ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25' : 'bg-amber-400/10 text-amber-200 border-amber-400/30'
                              }`}
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

            <div className="w-full lg:w-[380px] bg-card rounded-xl border border-border overflow-hidden flex flex-col">
              <div className="p-4 bg-background border-b border-border flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Recipe View</p>
                  <h3 className="text-foreground font-black text-xl">{selectedProduct?.name ?? 'Select a product'}</h3>
                  <p className="text-muted-foreground text-sm">{selectedProduct ? 'Composite Product • 1 Unit Sales' : 'Click a product to inspect deduction.'}</p>
                </div>
                <button
                  onClick={() => setSelectedProductId(null)}
                  className="text-muted-foreground hover:text-foreground p-1"
                  title="Close"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {!selectedProduct ? (
                  <div className="text-muted-foreground text-sm">No product selected.</div>
                ) : (
                  <>
                    <div className="flex flex-col items-center gap-2 mb-6">
                      <div className="w-full p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-4">
                        <div className="size-12 rounded-lg bg-background border border-border overflow-hidden">
                          <img alt={selectedProduct.name} src={selectedProduct.image} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="text-foreground font-bold">{selectedProduct.name}</p>
                          <p className="text-xs text-primary font-medium">Sales Price: ETB {selectedProduct.price.toFixed(2)}</p>
                        </div>
                        <div className="ml-auto bg-primary/20 text-primary px-2 py-1 rounded text-xs font-bold">- 1 Unit</div>
                      </div>
                      <div className="h-8 w-0.5 bg-border"></div>
                      <div className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded border border-border -my-3">Consumes</div>
                      <div className="h-6 w-0.5 bg-border"></div>

                      <div className="w-full flex flex-col gap-2">
                        {(computedRecipe?.ingredients ?? []).length === 0 ? (
                          <div className="p-3 rounded-lg border border-border bg-background text-muted-foreground text-sm">
                            No recipe set. Click "Edit Recipe" to add ingredients.
                          </div>
                        ) : (
                          (computedRecipe?.ingredients ?? []).map((ing) => {
                            const inv = items.find((x) => x.id === ing.ingredientId);
                            const stockLabel = inv ? `${inv.stock} ${inv.unit}`.trim() : '';
                            const stock = Number(inv?.stock ?? 0) || 0;
                            const min = Number(inv?.minStock ?? 0) || 0;
                            const missing = !inv;
                            const critical = !missing && stock <= 0;
                            const low = !missing && !critical && stock < min;
                            const unit = String(inv?.unit || '').trim();
                            const qty = Number(ing.quantity ?? 0) || 0;
                            const qtyLabel = `${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
                            return (
                              <div
                                key={ing.ingredientId}
                                className={`p-3 rounded-lg border bg-background flex items-center justify-between ${
                                  missing
                                    ? 'border-amber-400/30'
                                    : critical
                                      ? 'border-rose-500/30'
                                      : low
                                        ? 'border-amber-400/30'
                                        : 'border-border'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`size-8 rounded-full border flex items-center justify-center ${
                                      critical
                                        ? 'bg-rose-500/10 border-rose-500/30'
                                        : low || missing
                                          ? 'bg-amber-400/10 border-amber-400/30'
                                          : 'bg-secondary border-border'
                                    }`}
                                  >
                                    <span
                                      className={`material-symbols-outlined text-sm ${
                                        critical ? 'text-rose-300' : low || missing ? 'text-amber-200' : 'text-muted-foreground'
                                      }`}
                                    >
                                      inventory_2
                                    </span>
                                  </div>
                                  <div>
                                    <p className="text-sm text-foreground font-medium">{ing.name}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {missing ? 'Missing inventory item' : stockLabel ? `Current Stock: ${stockLabel}` : ''}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-rose-200 font-bold text-sm">- {qtyLabel}</p>
                                  <p className="text-[10px] text-muted-foreground">Cost: ETB {ing.cost.toFixed(2)}</p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-background border border-primary/20">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-muted-foreground">Total Cost</span>
                        <span className="text-sm font-medium text-foreground">ETB {(computedRecipe?.totalCost ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-muted-foreground">Gross Margin</span>
                        <span className="text-sm font-medium text-success">
                          {selectedProduct.price > 0
                            ? (((selectedProduct.price - (computedRecipe?.totalCost ?? 0)) / selectedProduct.price) * 100).toFixed(1)
                            : '0.0'}
                          %
                        </span>
                      </div>
                      <div className="h-px bg-border my-2"></div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-primary uppercase">Net Profit</span>
                        <span className="text-lg font-bold text-foreground">ETB {(selectedProduct.price - (computedRecipe?.totalCost ?? 0)).toFixed(2)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-4 border-t border-border bg-card">
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (!selectedProductId) return;
                      try {
                        localStorage.setItem(STORAGE_SELECTED_PRODUCT, selectedProductId);
                      } catch {
                        // ignore
                      }
                      onNavigate(Screen.MANAGER_RECIPE_BUILDER);
                    }}
                    className="flex-1 py-2 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    disabled={!selectedProductId}
                  >
                    Edit Recipe
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedProduct) return;
                      setHistoryOpen(true);
                      void loadRecipeHistory();
                    }}
                    className="flex-1 py-2 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    disabled={!selectedProduct}
                  >
                    Recipe History
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <Modal
          open={historyOpen}
          title="Recipe History"
          onClose={() => setHistoryOpen(false)}
          footer={
            <div className="flex gap-3">
              <button
                onClick={() => setHistoryOpen(false)}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => void loadRecipeHistory()}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={historyLoading || !selectedProduct}
              >
                {historyLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="text-sm text-foreground font-bold">{selectedProduct?.name || '—'}</div>
            {historyError ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{historyError}</div> : null}
            {historyLoading ? <div className="text-sm text-muted-foreground">Loading history...</div> : null}
            {!historyLoading && !historyError && historyRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No recipe changes recorded yet.</div>
            ) : null}
            {!historyLoading && historyRows.length > 0 ? (
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="divide-y divide-border">
                  {historyRows.map((h) => (
                    <div key={h.id} className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-foreground font-semibold truncate">{auditTypeLabel(h.type)}</div>
                          <div className="text-xs text-muted-foreground truncate">{h.summary}</div>
                          <div className="text-[11px] text-muted-foreground/70 mt-1">{h.actorName ? `${h.actorName}${h.actorRole ? ` (${h.actorRole})` : ''}` : h.actorRole || ''}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground font-mono">{h.at ? formatRelativeTime(h.at) : ''}</div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono">{h.at ? (formatDeviceDateTime(h.at) || '') : ''}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>

        {/* SUPPLIERS TAB (Placeholder for visual completeness) */}
        {activeTab === 'suppliers' && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-foreground font-bold text-lg">Suppliers</h3>
                <p className="text-muted-foreground text-sm">Manage your suppliers for inventory purchasing.</p>
              </div>
              <button
                onClick={openNewSupplier}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> Add Supplier
              </button>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-background border-b border-border">
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Name</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Phone</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Email</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Address</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-muted-foreground text-sm">
                        No suppliers yet.
                      </td>
                    </tr>
                  ) : (
                    suppliers.map((s) => (
                      <tr key={s.id} className="hover:bg-accent transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground">{s.name}</span>
                            <span className="text-xs text-muted-foreground">{s.id}</span>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">{s.phone || '—'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{s.email || '—'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{s.address || '—'}</td>
                        <td className="p-4">
                          <span
                            className={`text-xs px-2 py-1 rounded-full font-bold border ${
                              s.status === 'Active'
                                ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                                : 'bg-amber-400/10 text-amber-200 border-amber-400/30'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => openSupplierPOs(s.id)}
                              className="text-muted-foreground hover:text-foreground text-sm font-bold"
                            >
                              POs
                            </button>
                            <button onClick={() => openEditSupplier(s.id)} className="text-primary hover:text-primary/90 text-sm font-bold">Edit</button>
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
                <h3 className="text-foreground font-bold text-lg">Audit Log</h3>
                <p className="text-muted-foreground text-sm">Recent inventory and recipe changes for this branch.</p>
              </div>
              <button
                onClick={() => void loadAudit()}
                className="px-4 py-2 bg-card border border-border text-foreground hover:bg-accent rounded-lg text-sm font-bold"
                disabled={auditLoading}
              >
                {auditLoading ? 'Loading ¦' : 'Refresh'}
              </button>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-background border-b border-border">
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">When</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Type</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Summary</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-muted-foreground text-sm">
                        {auditLoading ? 'Loading audit ¦' : 'No audit events yet.'}
                      </td>
                    </tr>
                  ) : (
                    audit.map((a) => (
                      <tr key={a.id} className="hover:bg-accent transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-muted-foreground font-mono">{a.at ? formatRelativeTime(a.at) : ' ”'}</span>
                            <span className="text-[11px] text-muted-foreground/70 font-mono">{a.at ? (formatDeviceDateTime(a.at) || '') : ''}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-foreground font-semibold">{auditTypeLabel(a.type)}</span>
                            <span className="text-[11px] text-muted-foreground font-mono">{a.type || ' ”'}</span>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-foreground">{a.summary || ' ”'}</td>
                        <td className="p-4 text-sm text-muted-foreground">{a.actorName ? `${a.actorName}${a.actorRole ? ` (${a.actorRole})` : ''}` : a.actorRole || ' ”'}</td>
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
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                disabled={supplierBusy}
              >
                Cancel
              </button>
              <button
                onClick={saveSupplier}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={supplierBusy}
              >
                {supplierBusy ? 'Saving ¦' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-muted-foreground">Name</label>
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <label className="text-sm font-bold text-muted-foreground">Phone</label>
            <input
              value={supplierPhone}
              onChange={(e) => setSupplierPhone(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <label className="text-sm font-bold text-muted-foreground">Email</label>
            <input
              value={supplierEmail}
              onChange={(e) => setSupplierEmail(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <label className="text-sm font-bold text-muted-foreground">Address</label>
            <input
              value={supplierAddress}
              onChange={(e) => setSupplierAddress(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <label className="text-sm font-bold text-muted-foreground">Notes</label>
            <textarea
              value={supplierNotes}
              onChange={(e) => setSupplierNotes(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 min-h-[90px]"
            />
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
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
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
                className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={supplierBusy}
              >
                {supplierBusy ? 'Deleting ¦' : 'Delete'}
              </button>
            </div>
          }
        >
          <div className="text-sm text-muted-foreground">This will permanently remove the supplier.</div>
        </Modal>

        <Modal
          open={editId != null}
          title={editId === '__new__' ? 'Add Stock Item' : editing ? `Edit: ${editing.name}` : 'Edit Item'}
          onClose={closeModal}
          footer={
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveModal}
                disabled={!canUpdateInventory}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-muted-foreground">Name</label>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <label className="text-sm font-bold text-muted-foreground">Category</label>
            <input
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-bold text-muted-foreground">Stock</label>
                <input
                  value={draftStock}
                  onChange={(e) => setDraftStock(e.target.value)}
                  className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-muted-foreground">Unit</label>
                <input
                  value={draftUnit}
                  onChange={(e) => setDraftUnit(e.target.value)}
                  className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-bold text-muted-foreground">Min Stock</label>
                <input
                  value={draftMinStock}
                  onChange={(e) => setDraftMinStock(e.target.value)}
                  className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-muted-foreground">Unit Price</label>
                <input
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                  className="mt-2 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
                />
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
                className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!deleteId) return;
                  if (!canUpdateInventory) {
                    setFlash({ kind: 'error', message: 'Access denied: missing permission inventory.update' });
                    return;
                  }
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
                className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-extrabold transition-colors disabled:opacity-60"
                disabled={busy || !canUpdateInventory}
              >
                {busy ? 'Deleting ¦' : 'Delete'}
              </button>
            </div>
          }
        >
          <div className="text-sm text-muted-foreground">This will permanently remove the inventory item.</div>
        </Modal>

      </div>
    </div>
  );
};
