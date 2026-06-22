import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import { Screen, PosOrderItem } from '../../types';
import { usePos } from '../../PosContext';
import { useShift } from '../../src/contexts/ShiftContext';
import { readSession } from '../../session';
import { apiFetch } from '../../api';
import { ShiftIndicator } from '../../components/ShiftIndicator';
import { ShiftManagerModal } from '../../components/ShiftManagerModal';
import { escapeHtml, openPrintWindow } from '../../printUtils';

import { cn } from '@/components/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export type WorkspaceProps = {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  posUiV2Enabled: boolean;
};

const formatTime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Helper to recalculate order total without tax (tax disabled by default)
const calcOrderTotalNoTax = (order: any): number => {
  if (!order) return 0;
  const subtotal = Number(order.subtotal || 0) || 0;
  const takeawayFee = Number((order as any).takeawayFee || 0) || 0;
  // Tax is disabled by default - only calculate if explicitly enabled
  // Since we can't easily access settings here, we use subtotal + takeawayFee
  return subtotal + takeawayFee;
};

// Kitchen ticket HTML generator for full-page print
const kitchenTicketHtml = (title: string, order: any, lines: Array<{ name: string; qty: number; note?: string }>) => {
  const now = new Date();
  const header = `${escapeHtml(title)}`;
  const table = escapeHtml(order.tableName ?? '');
  const number = escapeHtml(order.number ?? '');
  const time = escapeHtml(order.timeLabel ?? now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
  const fullTimestamp = escapeHtml(now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
  const placedBy = escapeHtml(order.createdByName ?? order.createdByStaffId ?? 'Staff');
  const notes = order.notes ? `<div class="notes">${escapeHtml(order.notes)}</div>` : '';
  // Add EDITED label if order has been edited
  const editedLabel = order.isEdited ? `<div class="edited-banner">EDITED - Updated at ${escapeHtml(order.editedAt ? new Date(order.editedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))}</div>` : '';
  const takeawayTag = order.orderType === 'takeaway' ? `<div style="background:#000;color:#fff;padding:8px 12px;font-size:18px;font-weight:900;text-align:center;margin:8px 0;border-radius:4px;letter-spacing:2px;">TAKEAWAY</div>` : '';
  const items = lines
    .map((l) => {
      const note = l.note?.trim() ? `<div class="note">${escapeHtml(l.note)}</div>` : '';
      return `
        <div class="row">
          <div class="qty">${l.qty}x</div>
          <div class="name">${escapeHtml(l.name)}${note}</div>
        </div>
      `;
    })
    .join('');

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${header}</title>
      <style>
        *{box-sizing:border-box;}
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin:0; padding:24px; color:#111;}
        .top{display:flex; justify-content:space-between; align-items:flex-start; gap:12px;}
        .brand{font-size:16px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;}
        .meta{font-size:14px; text-align:right;}
        .by{margin-top:6px; font-size:14px; font-weight:800;}
        .kds{margin-top:12px; font-size:28px; font-weight:900;}
        .hr{border-top:2px dashed #444; margin:16px 0;}
        .row{display:flex; gap:12px; padding:10px 0; border-bottom:1px dashed #bbb;}
        .qty{width:56px; font-size:20px; font-weight:900;}
        .name{flex:1; font-size:18px; font-weight:800;}
        .note{margin-top:4px; font-size:14px; font-weight:600; color:#333;}
        .notes{margin-top:12px; padding:12px; border:1px dashed #777; font-size:14px; font-weight:700;}
        .edited-banner{background:#f59e0b; color:#fff; padding:8px 12px; font-size:14px; font-weight:900; text-align:center; margin:8px 0; border-radius:4px;}
        @media print{body{padding:0} .no-print{display:none}}
      </style>
    </head>
    <body>
      <div class="top">
        <div>
          <div class="brand">${header}</div>
          <div class="kds">${table}    ${number}</div>
          <div class="by">Placed by: ${placedBy}</div>
        </div>
        <div class="meta">
          <div>${time}</div>
          <div style="font-size:12px;color:#555;margin-top:4px;">${fullTimestamp}</div>
        </div>
      </div>
      ${editedLabel}
      ${takeawayTag}
      ${notes}
      <div class="hr"></div>
      ${items}
      <div class="hr"></div>
      <div class="no-print" style="font-size:14px;color:#666;margin-top:20px;">
        <button onclick="window.print()" style="padding:12px 24px;font-size:16px;cursor:pointer;">Print Ticket</button>
        <p>Or press Ctrl+P to print</p>
      </div>
    </body>
  </html>
  `;
};

const minutesSince = (iso?: string) => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  return mins >= 0 ? mins : null;
};

export const Workspace: React.FC<WorkspaceProps> = ({ currentScreen, onNavigate, posUiV2Enabled: _posUiV2Enabled }) => {
  const {
    tables,
    orders,
    products,
    selectTable,
    selectOrder,
    selectedTableId,
    addToCart,
    getCartItems,
    setCartQty,
    setCartItemNote,
    removeFromCart,
    clearCart,
    setTableAssignment,
    sendOrderToKitchen,
    sendAdditionalOrderToKitchen,
    setOrderStatus,
    refreshFromServer,
    printKitchenTicket,
    confirmPayment,
    enterBillingMode,
    getDraftOrderMeta,
    setDraftOrderMeta,
    setPendingOrderItemQty,
    setPendingOrderItemNote,
    addItemsToOrder,
    swapOrderItem,
    voidOrder,
    refundOrder,
    unlockOrder,
    setOrderType,
    getShiftCashSummary,
    reconcileCash,
  } = usePos();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [sending, setSending] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [preEditItems, setPreEditItems] = useState<PosOrderItem[]>([]);
  const [posSettings, setPosSettings] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const staffNameCache = useMemo(() => {
    try {
      const raw = localStorage.getItem('mirachpos.staffNameCache.v1');
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      if (!parsed || typeof parsed !== 'object') return {} as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && typeof v === 'string' && v.trim()) out[k] = v;
      }
      return out;
    } catch {
      return {} as Record<string, string>;
    }
  }, []);

  const actor = useMemo(() => {
    try {
      const s = readSession<any>();
      const staffId = typeof s?.staffId === 'string' ? s.staffId.trim() : '';
      const staffName = typeof s?.staffName === 'string' ? s.staffName.trim() : '';
      return { staffId, staffName };
    } catch {
      return { staffId: '', staffName: '' };
    }
  }, []);

  const selectedTable = useMemo(
    () => (selectedTableId ? tables.find((t) => t.id === selectedTableId) ?? null : null),
    [selectedTableId, tables]
  );

  const cartItems = useMemo(
    () => (selectedTableId ? getCartItems(selectedTableId) : []),
    [getCartItems, selectedTableId]
  );

  // Get ALL orders for this table (for multi-order support) - compute first so openOrder can derive from it
  const tableOrders = useMemo(() => {
    if (!selectedTable) return [];
    const orderIds = selectedTable.openOrderIds || (selectedTable.openOrderId ? [selectedTable.openOrderId] : []);
    const filtered = orders.filter((o) => orderIds.includes(o.id) && o.status !== 'Paid' && o.status !== 'Voided' && o.status !== 'Refunded');
    // Sort newest-first so tableOrders[0] is always the most recently created unpaid order
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedTable, orders]);

  const hasMultipleOrders = tableOrders.length > 1;

  // openOrder derives from tableOrders so it stays in sync with multi-order state (BUG-05/12)
  const openOrder = useMemo(() => {
    if (tableOrders.length > 0) return tableOrders[0];
    if (!selectedTable?.openOrderId) return null;
    return orders.find((o) => o.id === selectedTable.openOrderId) ?? null;
  }, [tableOrders, selectedTable, orders]);

  // Unified Workspace State Checks
  const isBilling = openOrder?.status === 'Billing';
  const canEditOrder = openOrder && ['Pending', 'Cooking', 'Ready'].includes(openOrder.status);
  const canEnterBilling = openOrder?.status === 'Pending' || openOrder?.status === 'Served';
  const isOrderPaid = openOrder?.status === 'Paid';
  const isOrderTerminal = openOrder && ['Paid', 'Voided', 'Refunded'].includes(openOrder.status);

  const orderMins = useMemo(() => {
    if (!openOrder) return null;
    return minutesSince(openOrder.createdAt);
  }, [openOrder]);

  // Get waiter name for selected table
  const tableWaiterName = useMemo(() => {
    const direct = typeof (selectedTable as any)?.assignedStaffName === 'string' ? String((selectedTable as any).assignedStaffName).trim() : '';
    if (direct) return direct;
    const assignedId = typeof (selectedTable as any)?.assignedStaffId === 'string' ? String((selectedTable as any).assignedStaffId).trim() : '';
    if (!assignedId) return 'Unassigned';
    const cached = staffNameCache[assignedId] ? String(staffNameCache[assignedId] || '').trim() : '';
    return cached ? cached : 'Unassigned';
  }, [selectedTable, staffNameCache]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if ((p as any)?.available === false) return false;
      if (p.stock <= 0) return false;
      if (category !== 'All' && String(p.category || '').trim() !== category) return false;
      if (!q) return true;
      return String(p.name || '').toLowerCase().includes(q) || String(p.code || '').toLowerCase().includes(q);
    });
  }, [products, query, category]);

  const subtotal = useMemo(
    () => cartItems.reduce((sum, i) => sum + (Number(i.unitPrice || 0) || 0) * (Number(i.qty || 0) || 0), 0),
    [cartItems]
  );
  const total = subtotal;

  const draftMeta = useMemo(() => (selectedTableId ? getDraftOrderMeta(selectedTableId) : {}), [selectedTableId, getDraftOrderMeta]);
  const draftOrderType = draftMeta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in';
  const takeawayFee = draftOrderType === 'takeaway' ? Math.max(0, Number(draftMeta?.takeawayFee ?? 0) || 0) : 0;
  const finalTotal = total + takeawayFee;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (selectedTableId && cartItems.length > 0 && !sending) {
          void handleSendOrder();
        }
      }
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        if (openOrder) {
          handlePay();
        }
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedTableId, cartItems.length, sending, openOrder]);

  // Auto-focus search when table changes
  useEffect(() => {
    searchRef.current?.focus();
  }, [selectedTableId]);

  const handleSelectTable = (tableId: string) => {
    selectTable(tableId);
    try {
      const table = tables.find((t) => t.id === tableId) ?? null;
      if (table && !table.assignedStaffId && actor.staffId) {
        setTableAssignment([tableId], actor.staffId, actor.staffName || null);
      }
      const openOrderId = table?.openOrderId ? String(table.openOrderId) : '';
      if (openOrderId) {
        selectOrder(openOrderId);
        // Stay on workspace, don't navigate - Pay button will be enabled
      }
    } catch {
      // ignore
    }
  };

  const handleAddItem = (productId: string) => {
    if (!selectedTableId) return;
    addToCart(selectedTableId, productId);
  };

  const [addingOrder, setAddingOrder] = useState(false);

  const handleAddAdditionalOrder = async () => {
    if (!selectedTableId || cartItems.length === 0 || addingOrder) return;
    
    // Capture cart items before any async operations
    const itemsToAdd = [...cartItems];
    const existingOrder = tableOrders[0];
    
    if (existingOrder && existingOrder.status === 'Pending') {
      setAddingOrder(true);
      try {
        // Atomically add all cart items to the existing order in one state update (BUG-09)
        addItemsToOrder(existingOrder.id, itemsToAdd.map(item => ({ productId: item.productId, qty: item.qty, note: item.note })));
        
        // Clear cart immediately using clearCart
        clearCart(selectedTableId);
        
        // Print kitchen ticket for the new items
        setTimeout(() => {
          const lines = itemsToAdd.map((i) => ({ name: i.name, qty: i.qty, note: i.note || '' }));
          const mockOrder = {
            id: existingOrder.id,
            number: existingOrder.number,
            tableName: existingOrder.tableName,
            timeLabel: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            createdByName: existingOrder.createdByName || 'Staff',
            notes: 'ADD - New Items',
            items: itemsToAdd,
          };
          const html = kitchenTicketHtml('Kitchen Ticket (Add)', mockOrder, lines);
          const printWindow = window.open('', 'kitchen_print_add', 'width=600,height=800,scrollbars=yes');
          if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
              try { printWindow.print(); } catch {}
            }, 500);
          }
        }, 100);
        
      } finally {
        setAddingOrder(false);
      }
      return;
    }
    
    // No existing order - create new order
    setAddingOrder(true);
    try {
      sendAdditionalOrderToKitchen(selectedTableId, '', draftOrderType);
    } finally {
      setAddingOrder(false);
    }
  };

  const handleSendOrder = async () => {
    if (!selectedTableId || cartItems.length === 0 || sending) return;
    setSending(true);
    try {
      const id = sendOrderToKitchen(selectedTableId, '');
      if (id) {
        // Print kitchen ticket immediately after sending
        try {
          // Get cart items directly since order might not be in state yet
          const lines = cartItems.map((i) => ({ name: i.name, qty: i.qty, note: i.note || '' }));
          const orderNumber = id.slice(-6).toUpperCase();
          const mockOrder = {
            id,
            number: `#${orderNumber}`,
            tableName: selectedTable?.name || 'Table',
            timeLabel: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            createdByName: selectedTable?.assignedStaffName || actor.staffName || 'Staff',
            notes: '',
            items: cartItems,
          };
          const html = kitchenTicketHtml('Kitchen Ticket', mockOrder, lines);
          // Open as full page window - MUST specify dimensions for popup to work
          const printWindow = window.open('', 'kitchen_print', 'width=600,height=800,scrollbars=yes');
          if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            // Auto-trigger print dialog
            setTimeout(() => {
              try {
                printWindow.print();
              } catch {
                // ignore
              }
            }, 500);
          } else {
            alert('Popup blocked! Please allow popups for this site to print kitchen tickets.');
          }
        } catch {
          // ignore print errors
        }
        // Refresh after a delay to sync with server
        setTimeout(() => {
          void refreshFromServer();
        }, 500);
        // Don't clear table selection so user can pay immediately after sending
        setQuery('');
      }
    } finally {
      setSending(false);
    }
  };

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Telebirr' | 'Bank Transfer'>('Cash');
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [tipAmount, setTipAmount] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);

  // Fetch POS settings for payment QR codes
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/pos/settings');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        if (!mounted) return;
        setPosSettings((json && typeof json === 'object' ? json : null) as any);
      } catch {
        // ignore
      }
    };
    void run();
    return () => { mounted = false; };
  }, []);

  const telebirrQr = useMemo(() => {
    const q = posSettings?.branchPayments?.qrCodes?.telebirr;
    return typeof q === 'string' ? q : '';
  }, [posSettings]);

  const telebirrDetails = useMemo(() => {
    const d = posSettings?.branchPayments?.qrDetails?.telebirr;
    if (!d) return null;
    return {
      accountName: typeof d.accountName === 'string' ? d.accountName : '',
      phone: typeof d.phone === 'string' ? d.phone : '',
      merchantId: typeof d.merchantId === 'string' ? d.merchantId : '',
      note: typeof d.note === 'string' ? d.note : '',
    };
  }, [posSettings]);

  const handleHoldOrder = async () => {
    if (!selectedTableId || cartItems.length === 0) return;
    try {
      // Create order as Pending (held) without printing
      const id = sendOrderToKitchen(selectedTableId, '');
      if (id) {
        // Refresh to show the held order
        setTimeout(() => {
          void refreshFromServer();
        }, 300);
      }
    } catch {
      // ignore
    }
  };

  const handlePay = () => {
    if (!openOrder) {
      alert('No open order to pay for');
      return;
    }
    // Already in billing mode - just open payment modal
    if (isBilling) {
      setShowPaymentModal(true);
      setTenderedAmount(openOrder.total.toFixed(2));
      return;
    }
    // Must be in 'Pending' status to enter billing
    if (!canEnterBilling) {
      alert('Order must be in Pending or Served status before payment');
      return;
    }
    // Enter billing mode first (this changes order status to 'Billing')
    enterBillingMode(openOrder.id);
    // Show payment modal
    setShowPaymentModal(true);
    setTenderedAmount(openOrder.total.toFixed(2));
  };

  const handleClosePayment = () => {
    setShowPaymentModal(false);
    setProcessingPayment(false);
    // If closing payment modal while in Billing state, revert to Served
    if (openOrder?.status === 'Billing') {
      setOrderStatus(openOrder.id, 'Served');
    }
  };

  const handleConfirmPayment = async () => {
    if (!openOrder) return;
    // Capture order ID synchronously to avoid stale closure issues
    const orderId = openOrder.id;
    // Always use the full total (includes any tax/service/takeaway fees) as the payment amount
    const paymentAmount = openOrder.total;
    setProcessingPayment(true);
    try {
      const tendered = parseFloat(tenderedAmount) || paymentAmount;
      const tip = parseFloat(tipAmount) || 0;
      confirmPayment(orderId, paymentMethod, tendered, undefined, paymentReference.trim() || undefined, tip);
      setShowPaymentModal(false);
      setTipAmount('');
      if (selectedTableId) {
        setDraftOrderMeta(selectedTableId, {});
      }
      selectTable(null);
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCancelOrder = () => {
    if (!openOrder) return;
    if (!confirm('Are you sure you want to cancel this order?')) return;
    // Use existing voidOrder pattern from PosContext (handles state + sync)
    voidOrder(openOrder.id, 'Cancelled by user');
    // Clear editing mode if active
    setEditingOrder(false);
    void refreshFromServer();
  };

  // Determine available actions based on order state - check ALL orders
  const hasUnpaidOrders = tableOrders.length > 0;
  const firstUnpaidOrder = tableOrders[0] || null;
  const canVoid = firstUnpaidOrder && !['Paid', 'Billing', 'Refunded', 'Voided'].includes(firstUnpaidOrder.status);
  const canRefund = firstUnpaidOrder?.status === 'Paid';
  const isOrderLocked = firstUnpaidOrder?.status === 'Paid' || firstUnpaidOrder?.status === 'Refunded' || firstUnpaidOrder?.status === 'Voided';
  
  // Refund state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);

  // Unlock order state (for manager override)
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockPin, setUnlockPin] = useState('');
  const [processingUnlock, setProcessingUnlock] = useState(false);

  // Cash reconciliation state
  const [showCashReconcileModal, setShowCashReconcileModal] = useState(false);
  const [actualCashAmount, setActualCashAmount] = useState('');
  const [reconcilePassword, setReconcilePassword] = useState('');
  const [reconcileResult, setReconcileResult] = useState<{ difference: number; status: 'balanced' | 'short' | 'over' } | null>(null);
  const [processingReconcile, setProcessingReconcile] = useState(false);
  
  // Cancel Order Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);

  const handleRefund = async () => {
    if (!openOrder) return;
    if (!refundReason.trim()) {
      alert('Refund reason is required');
      return;
    }
    if (!managerPin || managerPin.length < 4) {
      alert('Manager PIN required for refund');
      return;
    }
    
    setProcessingRefund(true);
    try {
      refundOrder(openOrder.id, refundReason.trim(), managerPin);
      setShowRefundModal(false);
      setRefundReason('');
      setManagerPin('');
      void refreshFromServer();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setProcessingRefund(false);
    }
  };

  const handleUnlockOrder = async () => {
    if (!openOrder) return;
    if (!unlockReason.trim()) {
      alert('Unlock reason is required');
      return;
    }
    if (!unlockPin || unlockPin.length < 4) {
      alert('Manager PIN required to unlock order');
      return;
    }
    
    setProcessingUnlock(true);
    try {
      await unlockOrder(openOrder.id, unlockPin, unlockReason.trim());
      setShowUnlockModal(false);
      setUnlockReason('');
      setUnlockPin('');
      void refreshFromServer();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Unlock failed');
    } finally {
      setProcessingUnlock(false);
    }
  };

  const handleCashReconcile = async () => {
    if (!reconcilePassword || reconcilePassword.length < 4) {
      alert('Manager password required for cash reconciliation');
      return;
    }
    const actualCash = parseFloat(actualCashAmount);
    if (isNaN(actualCash) || actualCash < 0) {
      alert('Please enter a valid cash amount');
      return;
    }
    
    setProcessingReconcile(true);
    try {
      const result = await reconcileCash(actualCash, reconcilePassword);
      setReconcileResult(result);
      // Keep modal open to show result
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cash reconciliation failed');
    } finally {
      setProcessingReconcile(false);
    }
  };

  const getTableStatusColor = (status?: string) => {
    if (status === 'Free') return 'bg-emerald-500';
    if (status === 'Payment') return 'bg-blue-500';
    if (status === 'Reserved') return 'bg-amber-500';
    return 'bg-red-500'; // Occupied/busy
  };

  const getTableStatusBorder = (status?: string) => {
    if (status === 'Free') return 'border-l-4 border-emerald-500';
    if (status === 'Payment') return 'border-l-4 border-blue-500';
    if (status === 'Reserved') return 'border-l-4 border-amber-500';
    return 'border-l-4 border-red-500'; // Occupied
  };

  const getTableStatusBg = (status?: string) => {
    if (status === 'Free') return 'bg-emerald-50';
    if (status === 'Payment') return 'bg-blue-50';
    if (status === 'Reserved') return 'bg-amber-50';
    return 'bg-red-50'; // Occupied
  };

  const getTableStatusLabel = (status?: string) => {
    if (status === 'Free') return 'Free';
    if (status === 'Payment') return 'Payment';
    if (status === 'Reserved') return 'Reserved';
    return 'Occupied';
  };

  // Mobile view state
  const [mobileTab, setMobileTab] = useState<'tables' | 'menu' | 'cart'>('tables');
  
  // Product swap modal state
  const [showProductSwapModal, setShowProductSwapModal] = useState<{ orderId: string; productId: string; currentName: string } | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);

  // Get current shift for display only (don't filter tables)
  const { currentShift, refreshShift } = useShift();
  const currentShiftType = currentShift?.shiftType || 'ALL';

  // Auto-refresh tables when shift changes
  useEffect(() => {
    // When shift changes, refresh tables to get the correct filtered set
    void refreshFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShift?.id, currentShift?.shiftType]);

  // Shift modal handler
  const handleOpenShiftModal = useCallback(() => {
    setShiftModalOpen(true);
  }, []);

  // Show all tables - no shift filtering
  const filteredTables = tables;

  return (
    <div className="h-screen w-full flex bg-background text-sm overflow-hidden">
      {/* LEFT - TABLES - Responsive */}
      <div className={cn(
        "border-r bg-card flex flex-col overflow-hidden flex-shrink-0",
        "w-full lg:w-[28%] xl:w-[25%]",
        mobileTab !== 'tables' && 'hidden lg:flex'
      )}>
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between p-3 border-b">
          <span className="font-bold text-lg">Tables</span>
          <div className="flex items-center gap-2">
            <ShiftIndicator onOpenShiftModal={handleOpenShiftModal} compact />
            <span className="text-xs text-muted-foreground">{filteredTables.length} / {tables.length}</span>
          </div>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex items-center justify-between p-3 border-b">
          <span className="font-bold text-lg">Tables</span>
          <div className="flex items-center gap-2">
            <ShiftIndicator onOpenShiftModal={handleOpenShiftModal} />
            <span className="text-xs text-muted-foreground">{filteredTables.length} showing</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3">
            {filteredTables.map((t) => {
              const active = selectedTableId === t.id;
              const order = t.openOrderId ? orders.find(o => o.id === t.openOrderId) : null;
              const isFree = t.openOrderId == null;
              const isOccupied = !isFree;
              const assignedName = (() => {
                const direct = typeof (t as any).assignedStaffName === 'string' ? String((t as any).assignedStaffName).trim() : '';
                if (direct) return direct;
                const assignedId = typeof (t as any).assignedStaffId === 'string' ? String((t as any).assignedStaffId).trim() : '';
                if (!assignedId) return '';
                const cached = staffNameCache[assignedId] ? String(staffNameCache[assignedId] || '').trim() : '';
                if (cached) return cached;
                return '';
              })();
              // Recalculate total without tax for display
              const displayTotal = isOccupied ? (calcOrderTotalNoTax(order) || t.currentTotal || 0) : 0;
              // Get multiple orders count
              const orderCount = t.openOrderIds?.length || (t.openOrderId ? 1 : 0);

              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTable(t.id)}
                  className={cn(
                    'group relative flex flex-col justify-between p-3 sm:p-4 rounded-xl cursor-pointer transition-all duration-200 min-h-[100px]',
                    isFree
                      ? 'border border-dashed border-border bg-background/50 hover:bg-card hover:border-solid hover:border-primary'
                      : 'border-l-4 border-l-primary border-y border-r border-border bg-card hover:border-primary',
                    active ? 'ring-2 ring-primary scale-[1.02]' : 'hover:-translate-y-1'
                  )}
                >
                  <div className="flex justify-between items-start gap-2 min-w-0">
                    <span className={cn(
                      'text-lg sm:text-xl lg:text-2xl font-black transition-colors truncate flex-1 min-w-0',
                      isFree ? 'text-border group-hover:text-primary' : 'text-foreground opacity-90'
                    )}>
                      {t.name.replace(/^T-?/i, '')}
                    </span>
                    <div className="flex items-center gap-1">
                      {orderCount > 1 && (
                        <div className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold bg-blue-500 text-white whitespace-nowrap">
                          {orderCount} Orders
                        </div>
                      )}
                      <div className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap flex-shrink-0',
                        isFree
                          ? 'bg-card text-muted-foreground'
                          : order?.status === 'Billing' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-primary/10 text-primary border border-primary/20'
                      )}>
                        {isFree ? 'Free' : order?.status === 'Billing' ? 'Billing' : order?.status ?? 'Occupied'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 mt-2 min-w-0">
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <span className="text-[10px] sm:text-xs text-muted-foreground truncate flex-1">{assignedName}</span>
                      <span className="text-[10px] sm:text-xs font-bold text-foreground whitespace-nowrap">{isOccupied ? `${displayTotal.toFixed(0)} ETB` : ''}</span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-border">
                      <span className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {t.seats}
                      </span>
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground truncate">{t.openOrderId ? order?.number : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CENTER - MENU - Responsive */}
      <div className={cn(
        "border-r bg-card flex-col overflow-hidden",
        "hidden lg:flex lg:w-[35%] xl:flex-1",
        mobileTab === 'menu' && 'flex w-full lg:w-[35%]'
      )}>
        <div className="p-3 border-b space-y-3">
          {/* Category Filter - Wrap layout */}
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'h-9 px-4 rounded-full border text-xs font-bold uppercase tracking-wide transition-colors',
                  category === c
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-muted'
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <Input
            ref={searchRef}
            placeholder="Search... (Ctrl+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <ScrollArea className={cn("flex-1 min-h-0 max-h-[50vh] lg:max-h-none", isBilling && "overflow-hidden")}>
          {/* Billing State Overlay - Fixed at top when billing */}
          {isBilling && (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/80 backdrop-blur-sm pt-20">
              <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center max-w-md mx-4 shadow-2xl sticky top-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">Billing Mode Active</h3>
                <p className="text-muted-foreground mb-4">Order is locked for payment processing.<br/>Menu items cannot be modified.</p>
                <div className="text-sm text-primary font-medium">
                  Press Ctrl+P or click Pay to open payment panel
                </div>
              </div>
            </div>
          )}
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {filteredProducts.map((p) => {
              // Disable menu if: no table, out of stock, billing mode, terminal status, or existing order not in edit
              const isExistingOrderLocked = openOrder && !editingOrder && openOrder.status !== 'Pending';
              const isDisabled = !selectedTableId || p.stock <= 0 || isBilling || isOrderTerminal || isExistingOrderLocked;
              const isLowStock = p.stock > 0 && p.stock <= 5;

              const imgUrl = (p as any).image;
              const hasImage = imgUrl && typeof imgUrl === 'string' && imgUrl.trim().length > 0;

              return (
                <button
                  key={p.id}
                  disabled={isDisabled}
                  onClick={() => handleAddItem(p.id)}
                  className={cn(
                    'group relative flex flex-col justify-between bg-card rounded-xl border-2 border-border hover:border-primary hover:shadow-md transition-all duration-100 text-left overflow-hidden',
                    isDisabled ? 'opacity-50 cursor-not-allowed bg-muted' : 'cursor-pointer active:scale-95'
                  )}
                >
                  {/* Top: Product image (if exists) + Stock warning */}
                  <div className="flex items-center justify-between px-3 pt-2 pb-1 min-h-[40px]">
                    {hasImage ? (
                      <img
                        src={imgUrl}
                        alt=""
                        className="w-8 h-8 rounded-md object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8" />
                    )}
                    {(p.stock <= 0 || isLowStock) && (
                      <span className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                        p.stock <= 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                      )}>
                        {p.stock <= 0 ? 'OUT' : p.stock}
                      </span>
                    )}
                  </div>

                  {/* Middle: Product name with tooltip for long names */}
                  <div className="px-3 flex-1 min-h-[2.8rem] flex items-center">
                    <h3
                      className="font-semibold text-foreground text-sm leading-snug line-clamp-2 text-pretty"
                      title={p.name}
                    >
                      {p.name}
                    </h3>
                  </div>

                  {/* Bottom: Price bar */}
                  <div className="mt-auto bg-primary/10 px-3 py-2 flex items-baseline justify-center gap-1">
                    <span className="text-lg font-bold text-primary tracking-tight">
                      {Number(p.price || 0).toFixed(0)}
                    </span>
                    <span className="text-xs font-medium text-primary/60 uppercase">ETB</span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* RIGHT - CART - Responsive */}
      <div className={cn(
        "flex-col bg-card overflow-hidden flex-shrink-0 h-full",
        "hidden sm:flex sm:w-[280px] md:w-[320px] lg:w-[340px] xl:w-[360px]",
        mobileTab === 'cart' && 'flex w-full sm:w-[340px]'
      )}>
        {/* Mobile header */}
        <div className="sm:hidden flex items-center justify-between p-3 border-b flex-shrink-0">
          <span className="font-bold text-lg">Cart</span>
          <button 
            onClick={() => setMobileTab('tables')}
            className="text-xs text-primary font-medium"
          >
            Back to Tables
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border bg-card/50 flex-shrink-0">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary p-2.5 rounded-xl">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground">{selectedTable ? selectedTable.name : 'Select Table'}</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 font-medium">
                  {tableOrders.length > 0 ? (
                    <>
                      <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">{tableOrders.length} Orders</span>
                      <span className="size-1 rounded-full bg-muted-foreground/50"></span>
                      <span>{tableOrders.map(o => o.status).join(', ')}</span>
                    </>
                  ) : cartItems.length > 0 ? (
                    <span className="text-blue-600">New Order (Draft)</span>
                  ) : (
                    <span>No Active Order</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Cash Reconcile Button - DISABLED for now
              <button
                onClick={() => setShowCashReconcileModal(true)}
                className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-1 rounded-md hover:bg-primary/20 transition-colors border border-primary/20"
                title="End of Shift Cash Reconciliation"
              >
                 Reconcile
              </button>
              */}
              <div className="flex items-center gap-2 text-sm text-foreground bg-secondary border border-border shadow-sm px-4 py-1.5 rounded-full font-semibold">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>{selectedTable?.seats || '-'}</span>
              </div>
            </div>
          </div>
          {isBilling && (
            <div className="mx-4 mt-4 p-3 bg-primary/10 border border-primary/30 rounded-xl">
              <div className="flex items-center gap-2 text-primary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="font-bold text-sm">BILLING MODE</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Order locked. Payment ready.</p>
            </div>
          )}
          {orderMins != null && (
            <Badge variant="secondary" className="text-xs font-mono">
              {formatTime(orderMins)}
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 p-4 space-y-5">
          {!selectedTable?.openOrderId && selectedTable && (
            <div className="bg-secondary p-4 rounded-2xl border border-border">
              <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Order Type</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraftOrderMeta(selectedTableId!, { orderType: 'dine_in', takeawayFee: 0 })}
                  className={cn(
                    'flex-1 h-10 rounded-xl border text-sm font-bold',
                    draftOrderType === 'dine_in'
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-card border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  Dine-in
                </button>
                <button
                  type="button"
                  onClick={() => setDraftOrderMeta(selectedTableId!, { orderType: 'takeaway' })}
                  className={cn(
                    'flex-1 h-10 rounded-xl border text-sm font-bold',
                    draftOrderType === 'takeaway'
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-card border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  Takeaway
                </button>
              </div>

              {draftOrderType === 'takeaway' && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm text-muted-foreground font-medium">
                    <span>Takeaway Fee</span>
                    <span className="text-foreground font-bold">ETB {takeawayFee.toFixed(2)}</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={String(takeawayFee)}
                    onChange={(e) => setDraftOrderMeta(selectedTableId!, { takeawayFee: Number(e.target.value || 0) || 0 })}
                    className="mt-2 w-full h-10 bg-card border border-border rounded-xl px-3 text-sm text-foreground"
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          )}

          {cartItems.length === 0 && tableOrders.length === 0 ? (
            <div className="text-muted-foreground text-sm text-center py-8">
              No orders or items
            </div>
          ) : (
            <>
              {/* Show all table orders */}
              {tableOrders.length > 0 && (
                <div className="space-y-4">
                  {tableOrders.map((order, orderIndex) => (
                <div key={`${order.id}-${order.items.length}-${order.total}`} className="mb-6 border border-border rounded-xl p-3 bg-secondary/50">
                  {/* Order Header */}
                  <div className="flex justify-between items-center mb-3 pb-2 border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground">Order {orderIndex + 1}</span>
                      <span className="text-[10px] text-muted-foreground">{order.number}</span>
                      {order.orderType === 'takeaway' && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                          Takeaway {order.takeawayFee ? `(+${order.takeawayFee.toFixed(0)} ETB)` : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-bold",
                        order.status === 'Served' && "bg-green-100 text-green-700",
                        order.status === 'Billing' && "bg-amber-100 text-amber-700",
                        order.status === 'Pending' && "bg-blue-100 text-blue-700",
                        order.status === 'Cooking' && "bg-orange-100 text-orange-700",
                        order.status === 'Ready' && "bg-purple-100 text-purple-700"
                      )}>
                        {order.status}
                      </span>
                      <span className="text-xs font-bold text-foreground">ETB {order.total.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Order Type Selector - Only when editing this specific order */}
                  {editingOrder && order.status === 'Pending' && (
                    <div className="mb-3 p-2 bg-amber-50 rounded-lg border border-amber-200">
                      <div className="text-[10px] text-amber-700 font-bold uppercase tracking-wider mb-2">Order Type</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setOrderType(order.id, 'dine_in', 0)}
                          className={cn(
                            'flex-1 h-8 rounded-lg border text-xs font-bold',
                            order.orderType === 'dine_in' || !order.orderType
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-card border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Dine-in
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrderType(order.id, 'takeaway', order.takeawayFee || 50)}
                          className={cn(
                            'flex-1 h-8 rounded-lg border text-xs font-bold',
                            order.orderType === 'takeaway'
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-card border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Takeaway
                        </button>
                      </div>
                      {order.orderType === 'takeaway' && (
                        <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-blue-700 font-medium">Takeaway Fee</span>
                            <span className="text-foreground font-bold">ETB {(order.takeawayFee || 0).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Change fee:</span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={order.takeawayFee || 0}
                              onChange={(e) => {
                                const newFee = Math.max(0, Number(e.target.value) || 0);
                                setOrderType(order.id, 'takeaway', newFee);
                              }}
                              className="w-20 h-6 text-xs px-2 border border-blue-200 rounded bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order Items */}
                  <div className="space-y-2">
                    {order.items.map((item) => (
                      <div key={`${order.id}-${item.productId}`} className="flex gap-2 items-start bg-card p-2 rounded-lg">
                        <div
                          className="w-10 h-10 rounded bg-cover bg-center flex-none bg-muted"
                          style={{ backgroundImage: `url('${products.find((p) => p.id === item.productId)?.image ?? ''}')` }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                            <p className="font-medium text-foreground text-sm">ETB {(item.unitPrice * item.qty).toFixed(0)}</p>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-xs text-muted-foreground">Qty: {item.qty}</span>
                            {item.note?.trim() && (
                              <span className="text-[10px] text-amber-600 truncate">{item.note.trim()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

              {/* Show cart items for new/additional order */}
              {cartItems.length > 0 && (
                <div className="mb-6 border border-dashed border-blue-300 rounded-xl p-3 bg-blue-50/50">
                  <div className="flex justify-between items-center mb-3 pb-2 border-b border-blue-200">
                    <span className="text-xs font-bold text-blue-700">New Order (Cart)</span>
                    <span className="text-xs text-blue-600">{cartItems.length} items</span>
                  </div>
                  <div className="space-y-2">
                    {cartItems.map((item) => (
                      <div key={`cart-${item.productId}`} className="flex gap-2 items-start bg-white p-2 rounded-lg border border-blue-100">
                        <div
                          className="w-10 h-10 rounded bg-cover bg-center flex-none bg-muted"
                          style={{ backgroundImage: `url('${products.find((p) => p.id === item.productId)?.image ?? ''}')` }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                            <p className="font-medium text-foreground text-sm">ETB {(item.unitPrice * item.qty).toFixed(0)}</p>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  if (!selectedTableId) return;
                                  setCartQty(selectedTableId, item.productId, Math.max(0, item.qty - 1));
                                }}
                                className="w-5 h-5 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-xs"
                              >
                                -
                              </button>
                              <span className="text-xs text-muted-foreground w-4 text-center">{item.qty}</span>
                              <button
                                onClick={() => {
                                  if (!selectedTableId) return;
                                  setCartQty(selectedTableId, item.productId, item.qty + 1);
                                }}
                                className="w-5 h-5 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-xs"
                              >
                                +
                              </button>
                            </div>
                            {item.note?.trim() && (
                              <span className="text-[10px] text-amber-600 truncate">{item.note.trim()}</span>
                            )}
                          </div>
                          <input
                            type="text"
                            placeholder="Add note"
                            value={item.note || ''}
                            onChange={(e) => {
                              if (!selectedTableId) return;
                              setCartItemNote(selectedTableId, item.productId, e.target.value);
                            }}
                            className="mt-1 w-full h-6 bg-white border border-blue-200 rounded px-2 text-[10px] text-foreground"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </ScrollArea>

        <div className="p-3 pb-8 bg-card border-t border-border z-30 flex-shrink-0">
          {/* Show totals for all orders */}
          {tableOrders.length > 0 && (
            <div className="space-y-2 mb-4">
              {tableOrders.map((order, idx) => (
                <div key={order.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Order {idx + 1} {order.orderType === 'takeaway' && '(Takeaway)'}
                  </span>
                  <span className="text-foreground font-medium">ETB {order.total.toFixed(0)}</span>
                </div>
              ))}
              {cartItems.length > 0 && (
                <div className="flex justify-between text-sm text-blue-600">
                  <span>New Order (Cart)</span>
                  <span className="font-medium">ETB {subtotal.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between items-end pt-3 border-t border-dashed border-border mt-2">
                <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">
                  {tableOrders.length > 1 ? `${tableOrders.length} Orders Total` : 'Total Due'}
                </span>
                <span className="font-bold text-2xl text-foreground">
                  ETB {tableOrders.reduce((sum, o) => sum + o.total, 0).toFixed(0)}
                </span>
              </div>
            </div>
          )}

          {/* Show cart-only total if no orders yet */}
          {tableOrders.length === 0 && cartItems.length > 0 && (
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-muted-foreground font-medium">
                <span>Subtotal</span>
                <span className="text-foreground">ETB {subtotal.toFixed(2)}</span>
              </div>
              {takeawayFee > 0.0001 && (
                <div className="flex justify-between text-sm text-muted-foreground font-medium">
                  <span>Takeaway Fee</span>
                  <span className="text-foreground">ETB {takeawayFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-end pt-3 border-t border-dashed border-border mt-2">
                <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Total Due</span>
                <span className="font-bold text-2xl text-foreground">ETB {finalTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            {/* Send Button - Only show when there's a cart (draft) and no existing orders */}
            {tableOrders.length === 0 && cartItems.length > 0 && (
              <button
                onClick={() => void handleSendOrder()}
                disabled={!selectedTableId || cartItems.length === 0 || sending}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/80 shadow-lg shadow-primary/20 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{sending ? 'Sending...' : 'Send'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Ctrl+S</span>
              </button>
            )}

            {/* Add Order Button - Single click: adds items, prints ticket, clears cart */}
            {tableOrders.length > 0 && cartItems.length > 0 && !editingOrder && (
              <button
                onClick={() => void handleAddAdditionalOrder()}
                disabled={!selectedTableId || cartItems.length === 0 || addingOrder}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{addingOrder ? 'Adding...' : 'Add Order'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">+{cartItems.length} items</span>
              </button>
            )}

            {/* Add to Current Order Button - Show when EDITING and cart has items */}
            {editingOrder && firstUnpaidOrder && cartItems.length > 0 && (
              <button
                onClick={() => {
                  // Capture cart items immediately before any operations
                  const itemsToAdd = [...cartItems];
                  
                  // Add cart items to the existing order being edited
                  itemsToAdd.forEach(item => {
                    setPendingOrderItemQty(firstUnpaidOrder.id, item.productId, 
                      (firstUnpaidOrder.items.find(i => i.productId === item.productId)?.qty || 0) + item.qty
                    );
                    if (item.note) {
                      setPendingOrderItemNote(firstUnpaidOrder.id, item.productId, item.note);
                    }
                  });
                  // Clear cart using clearCart for atomic operation
                  clearCart(selectedTableId!);
                  
                  // Print kitchen ticket for the new items
                  const lines = itemsToAdd.map((i) => ({ name: i.name, qty: i.qty, note: i.note || '' }));
                  const mockOrder = {
                    id: firstUnpaidOrder.id,
                    number: firstUnpaidOrder.number,
                    tableName: firstUnpaidOrder.tableName,
                    timeLabel: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                    createdByName: firstUnpaidOrder.createdByName || 'Staff',
                    notes: 'ADD - New Items',
                    items: itemsToAdd,
                  };
                  const html = kitchenTicketHtml('Kitchen Ticket (Add)', mockOrder, lines);
                  const printWindow = window.open('', 'kitchen_print_add', 'width=600,height=800,scrollbars=yes');
                  if (printWindow) {
                    printWindow.document.write(html);
                    printWindow.document.close();
                    printWindow.focus();
                    setTimeout(() => {
                      try { printWindow.print(); } catch {}
                    }, 500);
                  }
                  
                  // Exit edit mode
                  setEditingOrder(false);
                  setPreEditItems([]);
                }}
                disabled={!selectedTableId || cartItems.length === 0}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Add to Order</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">+{cartItems.length} items</span>
              </button>
            )}
            
            {/* Pay All Button - Show when there are multiple pending orders */}
            {tableOrders.length > 1 && tableOrders.every(o => o.status === 'Pending' || o.status === 'Served' || o.status === 'Billing') && (
              <button
                onClick={() => {
                  // Enter billing for all orders and open payment
                  tableOrders.forEach(o => {
                    if (o.status === 'Pending' || o.status === 'Served') enterBillingMode(o.id);
                  });
                  setShowPaymentModal(true);
                  setTenderedAmount(tableOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2));
                }}
                className="flex flex-col items-center justify-center py-2 px-1 bg-primary text-white rounded-xl hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Pay All</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">{tableOrders.length} orders</span>
              </button>
            )}
            
            {/* Pay Single Order Button - Show when there's only one order */}
            {tableOrders.length === 1 && firstUnpaidOrder && (firstUnpaidOrder.status === 'Pending' || firstUnpaidOrder.status === 'Served' || firstUnpaidOrder.status === 'Billing') && (
              <button
                onClick={() => {
                  if (firstUnpaidOrder.status === 'Pending' || firstUnpaidOrder.status === 'Served') {
                    enterBillingMode(firstUnpaidOrder.id);
                  }
                  setShowPaymentModal(true);
                  setTenderedAmount(firstUnpaidOrder.total.toFixed(2));
                }}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-primary text-primary rounded-xl hover:bg-primary hover:text-primary-foreground font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{firstUnpaidOrder.status === 'Billing' ? 'Billing' : 'Pay'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Ctrl+P</span>
              </button>
            )}

            {/* Edit Button - Only for editing existing order items */}
            {firstUnpaidOrder && (firstUnpaidOrder.status === 'Pending' || firstUnpaidOrder.status === 'Served') && cartItems.length === 0 && (
              <button
                onClick={() => {
                  if (editingOrder) {
                    // Exiting edit mode - auto-save changes and print delta
                    const currentItems = firstUnpaidOrder.items;
                    const originalItems = preEditItems;
                    const deltaItems = currentItems.map(item => {
                      const original = originalItems.find(o => o.productId === item.productId);
                      const originalQty = original ? original.qty : 0;
                      const diffQty = item.qty - originalQty;
                      if (diffQty > 0) {
                        return { ...item, qty: diffQty, note: item.note || original?.note };
                      }
                      return null;
                    }).filter(Boolean) as PosOrderItem[];
                    
                    if (deltaItems.length > 0) {
                      const lines = deltaItems.map((i) => ({ name: i.name, qty: i.qty, note: i.note || '' }));
                      const mockOrder = {
                        id: firstUnpaidOrder.id,
                        number: firstUnpaidOrder.number,
                        tableName: firstUnpaidOrder.tableName,
                        timeLabel: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                        createdByName: firstUnpaidOrder.createdByName || 'Staff',
                        notes: 'EDIT - Additional Items',
                        items: deltaItems,
                      };
                      const html = kitchenTicketHtml('Kitchen Ticket (Edit)', mockOrder, lines);
                      const printWindow = window.open('', 'kitchen_print_edit', 'width=600,height=800,scrollbars=yes');
                      if (printWindow) {
                        printWindow.document.write(html);
                        printWindow.document.close();
                        printWindow.focus();
                        setTimeout(() => {
                          try { printWindow.print(); } catch {}
                        }, 500);
                      }
                    }
                    setEditingOrder(false);
                    setPreEditItems([]);
                  } else {
                    // Entering edit mode
                    setEditingOrder(true);
                    setPreEditItems(firstUnpaidOrder.items.map(i => ({ ...i })));
                  }
                }}
                className={cn(
                  'flex flex-col items-center justify-center py-2 px-1 border-2 rounded-xl font-bold transition-all',
                  editingOrder
                    ? 'bg-green-500 text-white border-green-500 hover:bg-green-600'
                    : 'bg-card border-amber-500 text-amber-500 hover:bg-amber-500 hover:text-white'
                )}
              >
                <span className="text-base sm:text-lg font-black leading-tight">{editingOrder ? 'Done' : 'Edit'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">{editingOrder ? 'Save' : 'Order'}</span>
              </button>
            )}
            
            {/* Cancel/Void Button - Only when order can be voided */}
            {canVoid && firstUnpaidOrder && (
              <button
                onClick={() => {
                  if (tableOrders.length > 1) {
                    setShowCancelModal(true);
                  } else {
                    if (!confirm('Are you sure you want to cancel this order?')) return;
                    voidOrder(firstUnpaidOrder.id, 'Cancelled by user');
                    setEditingOrder(false);
                    void refreshFromServer();
                  }
                }}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-destructive text-destructive rounded-xl hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50 disabled:cursor-not-allowed font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Cancel</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Order</span>
              </button>
            )}
            
            {/* Refund Button - Only for Paid orders */}
            {canRefund && (
              <button
                onClick={() => setShowRefundModal(true)}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-orange-500 text-orange-500 rounded-xl hover:bg-orange-500 hover:text-white font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Refund</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Mgr</span>
              </button>
            )}
            
            {/* Unlock Button - DISABLED for now
            {isBilling && (
              <button
                onClick={() => setShowUnlockModal(true)}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-purple-500 text-purple-500 rounded-xl hover:bg-purple-500 hover:text-white font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Unlock</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Mgr</span>
              </button>
            )}
            */}
            
            {/* Print Receipt Button - For Paid orders */}
            {openOrder?.status === 'Paid' && (
              <button
                onClick={() => alert('Print receipt - implement with your print utility')}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-green-500 text-green-500 rounded-xl hover:bg-green-500 hover:text-white font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">Print</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Receipt</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around p-2">
        <button
          onClick={() => setMobileTab('tables')}
          className={cn(
            'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors',
            mobileTab === 'tables' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          )}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h18v18H3V3zm16 16V5H5v14h14z" />
          </svg>
          <span className="text-[10px] font-medium">Tables</span>
        </button>
        <button
          onClick={() => setMobileTab('menu')}
          disabled={!selectedTableId}
          className={cn(
            'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors',
            mobileTab === 'menu' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            !selectedTableId && 'opacity-50 cursor-not-allowed'
          )}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-[10px] font-medium">Menu</span>
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          disabled={!selectedTableId}
          className={cn(
            'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors relative',
            mobileTab === 'cart' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            !selectedTableId && 'opacity-50 cursor-not-allowed'
          )}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className="text-[10px] font-medium">Cart</span>
          {cartItems.length > 0 && (
            <span className="absolute -top-1 right-2 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {cartItems.length}
            </span>
          )}
        </button>
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && openOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Process Payment</h2>
                <p className="text-sm opacity-90">{openOrder.number} • {openOrder.tableName}</p>
              </div>
              <button
                onClick={handleClosePayment}
                className="text-primary-foreground hover:opacity-80 text-2xl leading-none"
                disabled={processingPayment}
              >
                ×
              </button>
            </div>

            {/* Order Items */}
            <div className="flex-1 overflow-auto p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Order Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  {openOrder.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center px-3 py-2 border-b last:border-0 bg-muted/30">
                      <div>
                        <span className="font-medium text-foreground">{item.name}</span>
                        <span className="text-muted-foreground ml-2">×{item.qty}</span>
                      </div>
                      <span className="font-medium text-foreground">{(item.unitPrice * item.qty).toFixed(2)} ETB</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t pt-3 space-y-1">
                {openOrder.subtotal != null && openOrder.subtotal !== openOrder.total && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-foreground">{openOrder.subtotal.toFixed(2)} ETB</span>
                  </div>
                )}
                {(openOrder.tax > 0 || openOrder.serviceCharge > 0) && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Tax/Service</span>
                    <span>{((openOrder.tax || 0) + (openOrder.serviceCharge || 0)).toFixed(2)} ETB</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span className="text-foreground">Total</span>
                  <span className="text-primary">{openOrder.total.toFixed(2)} ETB</span>
                </div>
              </div>
            </div>

            {/* Payment Section */}
            <div className="border-t p-4 bg-muted/30">
              <label className="text-sm font-medium mb-2 block text-foreground">Payment Method</label>
              <div className="flex gap-2 mb-4">
                {(['Cash', 'Telebirr', 'Bank Transfer'] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={cn(
                      'flex-1 py-3 px-2 rounded-lg border-2 text-sm font-semibold transition-all',
                      paymentMethod === method
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:border-primary'
                    )}
                  >
                    {method === 'Bank Transfer' ? 'Bank' : method}
                  </button>
                ))}
              </div>

              {paymentMethod === 'Telebirr' && (
                <div className="mb-4 space-y-3">
                  {telebirrQr ? (
                    <div className="bg-card p-4 rounded-xl border border-border">
                      <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">Scan to Pay</div>
                      <div className="flex items-center justify-center">
                        <img src={telebirrQr} alt="Telebirr QR" className="w-full max-w-[200px] object-contain rounded-lg border border-border bg-white p-2" />
                      </div>
                      {telebirrDetails && (
                        <div className="mt-3 space-y-1 text-xs">
                          {telebirrDetails.accountName && <div className="flex justify-between"><span className="text-muted-foreground">Account:</span><span className="font-semibold">{telebirrDetails.accountName}</span></div>}
                          {telebirrDetails.phone && <div className="flex justify-between"><span className="text-muted-foreground">Phone:</span><span className="font-semibold">{telebirrDetails.phone}</span></div>}
                          {telebirrDetails.merchantId && <div className="flex justify-between"><span className="text-muted-foreground">Merchant ID:</span><span className="font-semibold">{telebirrDetails.merchantId}</span></div>}
                        </div>
                      )}
                    </div>
                  ) : null}
                  
                  {/* TIP Section */}
                  <div className="bg-card p-4 rounded-xl border border-border">
                    <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Tip Amount (ETB)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      placeholder="0.00"
                      className="mt-2 w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Enter tip amount to be recorded for the assigned waiter</p>
                    {parseFloat(tipAmount) > 0 && (
                      <div className="mt-2 p-2 bg-primary/10 rounded text-xs text-primary font-medium">
                        Tip: ETB {parseFloat(tipAmount).toFixed(2)} will be recorded for {selectedTable?.assignedStaffName || 'waiter'}
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-card p-4 rounded-xl border border-border">
                    <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Transaction Reference</label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="Enter Telebirr transaction ID"
                      className="mt-2 w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Enter the transaction reference from the customer's Telebirr payment</p>
                  </div>
                </div>
              )}

              {paymentMethod === 'Bank Transfer' && (
                <div className="mb-4 space-y-3">
                  {/* TIP Section */}
                  <div className="bg-card p-4 rounded-xl border border-border">
                    <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Tip Amount (ETB)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      placeholder="0.00"
                      className="mt-2 w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Enter tip amount to be recorded for the assigned waiter</p>
                    {parseFloat(tipAmount) > 0 && (
                      <div className="mt-2 p-2 bg-primary/10 rounded text-xs text-primary font-medium">
                        Tip: ETB {parseFloat(tipAmount).toFixed(2)} will be recorded for {selectedTable?.assignedStaffName || 'waiter'}
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-card p-4 rounded-xl border border-border">
                    <label className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Bank Transaction Reference</label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="Enter bank transaction reference"
                      className="mt-2 w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Enter the transaction reference from the bank transfer</p>
                  </div>
                </div>
              )}

              {paymentMethod === 'Cash' && (
                <div className="mb-4">
                  <label className="text-sm font-medium mb-2 block text-foreground">Amount Tendered</label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={tenderedAmount}
                      onChange={(e) => setTenderedAmount(e.target.value)}
                      className="text-xl h-12 pl-4"
                      placeholder="0.00"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">ETB</span>
                  </div>
                  {parseFloat(tenderedAmount) > openOrder.total && (
                    <div className="flex justify-between text-sm mt-2 p-2 bg-green-100 text-green-800 rounded">
                      <span>Change Due:</span>
                      <span className="font-bold">{(parseFloat(tenderedAmount) - openOrder.total).toFixed(2)} ETB</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12 font-semibold"
                  onClick={handleClosePayment}
                  disabled={processingPayment}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirmPayment}
                  disabled={processingPayment || (paymentMethod === 'Cash' && parseFloat(tenderedAmount) < openOrder.total)}
                >
                  {processingPayment ? 'Processing...' : `Confirm ${paymentMethod}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* REFUND MODAL */}
      {showRefundModal && openOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-orange-500 text-white p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Refund Order</h2>
                <p className="text-sm opacity-90">{openOrder.number} • Manager Required</p>
              </div>
              <button
                onClick={() => setShowRefundModal(false)}
                className="text-white hover:opacity-80 text-2xl leading-none"
                disabled={processingRefund}
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-800">
                  <strong>Warning:</strong> This will reverse the payment and restore inventory. This action cannot be undone.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block text-foreground">Refund Reason *</label>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Enter reason for refund..."
                  className="w-full h-24 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block text-foreground">Manager PIN *</label>
                <input
                  type="password"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  placeholder="Enter 4+ digit PIN"
                  className="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12 font-semibold"
                  onClick={() => setShowRefundModal(false)}
                  disabled={processingRefund}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 font-semibold bg-orange-500 text-white hover:bg-orange-600"
                  onClick={handleRefund}
                  disabled={processingRefund || !refundReason.trim() || managerPin.length < 4}
                >
                  {processingRefund ? 'Processing...' : 'Confirm Refund'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT SWAP MODAL */}
      {showProductSwapModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-amber-500 text-white p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Replace Item</h2>
                <p className="text-sm opacity-90">Swap {showProductSwapModal.currentName} with another product</p>
              </div>
              <button
                onClick={() => setShowProductSwapModal(null)}
                className="text-white hover:opacity-80 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Product List */}
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                {products.filter(p => p.id !== showProductSwapModal.productId && p.stock > 0).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (!openOrder) return;
                      // Use swapOrderItem from context
                      swapOrderItem(showProductSwapModal.orderId, showProductSwapModal.productId, p.id, p.name, p.price);
                      setShowProductSwapModal(null);
                    }}
                    className="flex items-center gap-2 p-3 rounded-xl border border-border bg-card hover:border-amber-500 hover:bg-amber-50 transition-all text-left"
                  >
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">ETB {p.price.toFixed(0)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-t">
              <Button
                variant="outline"
                className="w-full h-12 font-semibold"
                onClick={() => setShowProductSwapModal(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL ORDER MODAL */}
      {showCancelModal && tableOrders.length > 1 && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-destructive text-destructive-foreground p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Select Order to Cancel</h2>
                <p className="text-sm opacity-90">Table has multiple orders</p>
              </div>
              <button
                onClick={() => setShowCancelModal(false)}
                className="text-destructive-foreground hover:opacity-80 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3 max-h-[60vh]">
              {tableOrders.map((order, idx) => (
                <div key={order.id} className="border border-border rounded-lg p-3 hover:border-destructive/50 transition-colors bg-background">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-bold">Order {idx + 1} {order.orderType === 'takeaway' && <span className="text-xs bg-muted px-1 py-0.5 rounded ml-1">Takeaway</span>}</h3>
                      <p className="text-xs text-muted-foreground">{order.items.length} items • {order.timeLabel}</p>
                    </div>
                    <span className="font-bold">ETB {order.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (!confirm(`Are you sure you want to cancel Order ${idx + 1}?`)) return;
                        voidOrder(order.id, 'Cancelled by user');
                        setShowCancelModal(false);
                        setEditingOrder(false);
                        void refreshFromServer();
                      }}
                    >
                      Cancel This Order
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t bg-muted/30">
              <Button
                variant="outline"
                className="w-full h-12 font-semibold"
                onClick={() => setShowCancelModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* UNLOCK ORDER MODAL */}
      {showUnlockModal && openOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Unlock Order</h2>
                <p className="text-sm opacity-90">{openOrder.number} • Manager Override Required</p>
              </div>
              <button
                onClick={() => setShowUnlockModal(false)}
                className="text-primary-foreground hover:opacity-80 text-2xl leading-none"
                disabled={processingUnlock}
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                <p className="text-sm text-primary">
                  <strong>Manager Override:</strong> This will unlock the order from Billing mode back to Served, allowing modifications. Use with caution.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block text-foreground">Unlock Reason *</label>
                <textarea
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="Enter reason for unlocking..."
                  className="w-full h-24 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block text-foreground">Manager PIN *</label>
                <input
                  type="password"
                  value={unlockPin}
                  onChange={(e) => setUnlockPin(e.target.value)}
                  placeholder="Enter 4+ digit PIN"
                  className="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12 font-semibold"
                  onClick={() => setShowUnlockModal(false)}
                  disabled={processingUnlock}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleUnlockOrder}
                  disabled={processingUnlock || !unlockReason.trim() || unlockPin.length < 4}
                >
                  {processingUnlock ? 'Processing...' : 'Unlock Order'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CASH RECONCILIATION MODAL */}
      {showCashReconcileModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">Cash Reconciliation</h2>
                <p className="text-sm opacity-90">End of Shift • Manager Required</p>
              </div>
              <button
                onClick={() => {
                  setShowCashReconcileModal(false);
                  setReconcileResult(null);
                }}
                className="text-primary-foreground hover:opacity-80 text-2xl leading-none"
                disabled={processingReconcile}
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              {!reconcileResult ? (
                <>
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                    <p className="text-sm text-primary">
                      <strong>Expected Cash:</strong> ETB {getShiftCashSummary().expectedCash.toFixed(2)}
                    </p>
                    <p className="text-xs text-primary/70 mt-1">
                      Based on {getShiftCashSummary().cashPayments.length} cash payment(s)
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block text-foreground">Actual Cash in Drawer *</label>
                    <input
                      type="number"
                      value={actualCashAmount}
                      onChange={(e) => setActualCashAmount(e.target.value)}
                      placeholder="Enter actual cash amount"
                      className="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block text-foreground">Manager Password *</label>
                    <input
                      type="password"
                      value={reconcilePassword}
                      onChange={(e) => setReconcilePassword(e.target.value)}
                      placeholder="Enter manager password"
                      className="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm text-foreground"
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 font-semibold"
                      onClick={() => setShowCashReconcileModal(false)}
                      disabled={processingReconcile}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 h-12 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={handleCashReconcile}
                      disabled={processingReconcile || !actualCashAmount || reconcilePassword.length < 4}
                    >
                      {processingReconcile ? 'Processing...' : 'Reconcile'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className={cn(
                    "rounded-lg p-4 text-center",
                    reconcileResult.status === 'balanced' && "bg-green-50 border border-green-200",
                    reconcileResult.status === 'short' && "bg-red-50 border border-red-200",
                    reconcileResult.status === 'over' && "bg-amber-50 border border-amber-200"
                  )}>
                    <p className={cn(
                      "text-2xl font-bold",
                      reconcileResult.status === 'balanced' && "text-green-700",
                      reconcileResult.status === 'short' && "text-red-700",
                      reconcileResult.status === 'over' && "text-amber-700"
                    )}>
                      {reconcileResult.status === 'balanced' && '✓ Cash Balanced'}
                      {reconcileResult.status === 'short' && '⚠ Cash Short'}
                      {reconcileResult.status === 'over' && '⚠ Cash Over'}
                    </p>
                    <p className="text-lg mt-2 text-foreground">
                      Difference: ETB {reconcileResult.difference.toFixed(2)}
                    </p>
                    {reconcileResult.status !== 'balanced' && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {reconcileResult.status === 'short' 
                          ? 'Cash is less than expected. Please double-check.'
                          : 'Cash is more than expected. Please verify.'}
                      </p>
                    )}
                  </div>

                  <Button
                    className="w-full h-12 font-semibold"
                    onClick={() => {
                      setShowCashReconcileModal(false);
                      setReconcileResult(null);
                      setActualCashAmount('');
                      setReconcilePassword('');
                    }}
                  >
                    Close
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <ShiftManagerModal isOpen={shiftModalOpen} onClose={() => setShiftModalOpen(false)} />
    </div>
  );
};
