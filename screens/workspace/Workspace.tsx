import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Screen } from '../../types';
import { usePos } from '../../PosContext';
import { readSession } from '../../session';
import { apiFetch } from '../../api';

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
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  
  const now = new Date();
  const header = `${escapeHtml(title)}`;
  const table = escapeHtml(order.tableName ?? '');
  const number = escapeHtml(order.number ?? '');
  const time = escapeHtml(order.timeLabel ?? now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
  const placedBy = escapeHtml(order.createdByName ?? order.createdByStaffId ?? 'Staff');
  const notes = order.notes ? `<div class="notes">${escapeHtml(order.notes)}</div>` : '';
  // Add EDITED label if order has been edited
  const editedLabel = order.isEdited ? `<div class="edited-banner">EDITED - Updated at ${escapeHtml(order.editedAt ? new Date(order.editedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))}</div>` : '';
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
        </div>
      </div>
      ${editedLabel}
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
    selectedTableId,
    selectTable,
    selectOrder,
    addToCart,
    getCartItems,
    setCartQty,
    setCartItemNote,
    removeFromCart,
    setTableAssignment,
    sendOrderToKitchen,
    setOrderStatus,
    refreshFromServer,
    printKitchenTicket,
    confirmPayment,
    enterBillingMode,
    getDraftOrderMeta,
    setDraftOrderMeta,
    setPendingOrderItemQty,
    setPendingOrderItemNote,
    swapOrderItem,
    voidOrder,
    refundOrder,
  } = usePos();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [sending, setSending] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
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

  const openOrder = useMemo(() => {
    if (!selectedTable?.openOrderId) return null;
    return orders.find((o) => o.id === selectedTable.openOrderId) ?? null;
  }, [selectedTable, orders]);

  // Unified Workspace State Checks
  const isBilling = openOrder?.status === 'Billing';
  const canEditOrder = openOrder && ['Pending', 'Cooking', 'Ready', 'Served'].includes(openOrder.status);
  const canEnterBilling = openOrder?.status === 'Served';
  const isOrderPaid = openOrder?.status === 'Paid';
  const isOrderTerminal = openOrder && ['Paid', 'Voided', 'Refunded'].includes(openOrder.status);

  const orderMins = useMemo(() => {
    if (!openOrder) return null;
    return minutesSince(openOrder.createdAt);
  }, [openOrder]);

  // Get waiter name for selected table
  const tableWaiterName = useMemo(() => {
    if (!selectedTable?.assignedStaffId) return actor.staffName || 'Unassigned';
    return selectedTable.assignedStaffName || 'Waiter';
  }, [selectedTable, actor.staffName]);

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
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Telebirr' | 'Bank'>('Cash');
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
    // Must be in 'Served' status to enter billing
    if (!canEnterBilling) {
      alert('Order must be marked as Served before payment (Ctrl+P enters billing)');
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
    // Use subtotal (without tax) for payment amount - tax is disabled
    const paymentAmount = openOrder.subtotal || openOrder.total;
    setProcessingPayment(true);
    try {
      const tendered = parseFloat(tenderedAmount) || paymentAmount;
      const tip = parseFloat(tipAmount) || 0;
      confirmPayment(orderId, paymentMethod, tendered, undefined, paymentReference.trim() || undefined, tip);
      setShowPaymentModal(false);
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
    // Refresh after a delay to sync with server
    setTimeout(() => {
      void refreshFromServer();
    }, 300);
  };

  // Determine available actions based on order state
  const canVoid = openOrder && !['Paid', 'Billing', 'Refunded', 'Voided'].includes(openOrder.status);
  const canRefund = openOrder?.status === 'Paid';
  const isOrderLocked = openOrder?.status === 'Paid' || openOrder?.status === 'Refunded' || openOrder?.status === 'Voided';
  
  // Refund state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);

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
      // Refresh after refund
      setTimeout(() => {
        void refreshFromServer();
      }, 300);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setProcessingRefund(false);
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

  return (
    <div className="h-screen w-full flex bg-background text-sm overflow-hidden">
      {/* LEFT - TABLES - Responsive */}
      <div className={cn(
        "border-r bg-card flex flex-col overflow-hidden flex-shrink-0",
        "w-full lg:w-[40%] xl:w-[35%]",
        mobileTab !== 'tables' && 'hidden lg:flex'
      )}>
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between p-3 border-b">
          <span className="font-bold text-lg">Tables</span>
          <span className="text-xs text-muted-foreground">{tables.length} total</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {tables.map((t) => {
              const active = selectedTableId === t.id;
              const order = t.openOrderId ? orders.find(o => o.id === t.openOrderId) : null;
              const isFree = t.openOrderId == null;
              const isOccupied = !isFree;
              const assignedName = t.assignedStaffName || actor.staffName || 'Unassigned';
              // Recalculate total without tax for display
              const displayTotal = isOccupied ? (calcOrderTotalNoTax(order) || t.currentTotal || 0) : 0;

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
                    <div className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap flex-shrink-0',
                      isFree
                        ? 'bg-card text-muted-foreground'
                        : order?.status === 'Billing' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-primary/10 text-primary border border-primary/20'
                    )}>
                      {isFree ? 'Free' : order?.status === 'Billing' ? 'Billing' : order?.status ?? 'Occupied'}
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
          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'h-8 px-3 rounded-full border text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-colors',
                  category === c
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
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

        <ScrollArea className="flex-1 min-h-0 max-h-[50vh] lg:max-h-none">
          {/* Billing State Overlay */}
          {isBilling && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center max-w-md mx-4 shadow-2xl">
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
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {filteredProducts.map((p) => {
              const isDisabled = !selectedTableId || p.stock <= 0 || isBilling || isOrderTerminal;
              const statusLabel = p.stock <= 0 ? 'Sold Out' : isBilling ? 'Billing' : isOrderTerminal ? 'Closed' : 'In Stock';
              const statusClass = p.stock <= 0 || isBilling || isOrderTerminal
                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : 'bg-green-500/20 text-green-400 border-green-500/30';

              return (
                <button
                  key={p.id}
                  disabled={isDisabled}
                  onClick={() => handleAddItem(p.id)}
                  className={cn(
                    'group bg-card rounded-xl overflow-hidden border border-border hover:border-primary transition-all duration-200 text-left flex flex-col relative',
                    isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  <div className="absolute top-2 right-2 z-10">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusClass}`}>{statusLabel}</span>
                  </div>

                  <div className="h-24 w-full bg-cover bg-center group-hover:opacity-90 transition-opacity bg-secondary relative">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-muted">
                        <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="p-2 flex flex-col">
                    <h3 className="font-bold text-foreground text-sm leading-snug mb-0.5 line-clamp-1">{p.name}</h3>
                    <p className="text-muted-foreground text-[10px] line-clamp-1 mb-2">{(p as any).category || 'Item'}</p>
                    <div className="mt-auto flex items-center justify-between">
                      <span className="text-sm font-bold text-primary">ETB {Number(p.price || 0).toFixed(0)}</span>
                      <div
                        className={cn(
                          'size-7 rounded-lg flex items-center justify-center shadow-lg transition-transform',
                          isDisabled ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground shadow-primary/20 group-hover:scale-105'
                        )}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </div>
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
        "hidden sm:flex sm:w-[280px] md:w-[320px] lg:w-[360px]",
        mobileTab === 'cart' && 'flex w-full sm:w-[360px]'
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
                  <span>Order #{selectedTable?.openOrderId ? String(selectedTable.openOrderId).slice(-6) : 'New'}</span>
                  <span className="size-1 rounded-full bg-muted-foreground/50"></span>
                  <span>{selectedTable?.openOrderId ? 'Active' : 'Draft'}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground bg-secondary border border-border shadow-sm px-4 py-1.5 rounded-full font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>{selectedTable?.seats || '-'}</span>
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

          {cartItems.length === 0 && !(editingOrder && openOrder?.items?.length > 0) ? (
            <div className="text-muted-foreground text-sm text-center py-8">
              {editingOrder ? 'No items to edit' : 'No items in cart'}
            </div>
          ) : (
            <>
              {/* Show cart items when not editing, or order items when editing */}
              {(editingOrder && openOrder?.items ? openOrder.items : cartItems).map((item, index, arr) => {
                const isLastItem = arr.length === 1;
                const itemsToRender = editingOrder && openOrder?.items ? openOrder.items : cartItems;
                const canRemove = itemsToRender.length > 1 || item.qty > 1;
                return (
                <div key={item.productId} className="bg-secondary p-2.5 rounded-xl shadow-sm border border-border group relative">
                  <div className="flex gap-3 items-start">
                    <div
                      className="w-12 h-12 rounded-lg bg-cover bg-center flex-none shadow-inner bg-muted"
                      style={{ backgroundImage: `url('${products.find((p) => p.id === item.productId)?.image ?? ''}')` }}
                    />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex justify-between items-start mb-0.5">
                        <p className="font-bold text-foreground truncate text-[15px]">{item.name}</p>
                        <p className="font-bold text-foreground text-[14px]">ETB {(item.unitPrice * item.qty).toFixed(2)}</p>
                      </div>
                      <div className="text-[12px] text-muted-foreground space-y-0.5">
                        <p className="leading-none">{`x${item.qty}`}</p>
                        {item.note?.trim() ? <p className="text-[11px] text-amber-600 font-medium truncate">{item.note.trim()}</p> : null}
                      </div>
                      {/* Note input for cart items */}
                      {!editingOrder && selectedTableId && (
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="Add note (e.g. no sugar)"
                            value={item.note || ''}
                            onChange={(e) => {
                              if (!selectedTableId) return;
                              setCartItemNote(selectedTableId, item.productId, e.target.value);
                            }}
                            className="w-full h-7 bg-card border border-border rounded px-2 text-[11px] text-foreground placeholder:text-muted-foreground/50"
                          />
                        </div>
                      )}
                      {/* Note input for edit mode */}
                      {editingOrder && openOrder && (
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="Add note (e.g. no sugar)"
                            value={item.note || ''}
                            onChange={(e) => {
                              setPendingOrderItemNote(openOrder.id, item.productId, e.target.value);
                            }}
                            className="w-full h-7 bg-card border border-border rounded px-2 text-[11px] text-foreground placeholder:text-muted-foreground/50"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between pl-14">
                    {editingOrder && openOrder ? (
                      // Edit mode: use setPendingOrderItemQty for order items
                      <>
                        <button
                          onClick={() => {
                            if (item.qty > 1) {
                              setPendingOrderItemQty(openOrder.id, item.productId, item.qty - 1);
                            } else if (!canRemove) {
                              alert('Cannot remove last item. Order must have at least 1 item.');
                            } else {
                              setPendingOrderItemQty(openOrder.id, item.productId, 0);
                            }
                          }}
                          className="h-8 w-8 rounded-lg border border-border bg-card text-red-300 hover:text-foreground hover:border-red-400/40 hover:bg-red-900/20 transition-colors flex items-center justify-center disabled:opacity-30"
                          title={item.qty > 1 ? 'Decrease' : canRemove ? 'Remove' : 'Cannot remove last item'}
                          type="button"
                          disabled={!canRemove && item.qty <= 1}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </button>
                        <span className="font-bold text-[13px] text-foreground">{item.qty}</span>
                        <button
                          onClick={() => {
                            setPendingOrderItemQty(openOrder.id, item.productId, item.qty + 1);
                          }}
                          className="h-8 w-8 rounded-lg border border-border bg-card text-primary hover:bg-primary hover:text-primary-foreground transition-colors flex items-center justify-center"
                          title="Increase"
                          type="button"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        {/* Replace/Swap button */}
                        <button
                          onClick={() => {
                            setShowProductSwapModal({ orderId: openOrder.id, productId: item.productId, currentName: item.name });
                          }}
                          className="h-8 px-2 rounded-lg border border-border bg-card text-amber-500 hover:bg-amber-500 hover:text-white transition-colors flex items-center gap-1 text-[11px] font-bold"
                          title="Replace with different product"
                          type="button"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Swap
                        </button>
                      </>
                    ) : (
                      // Normal cart mode: use setCartQty
                      <>
                        <button
                          onClick={() => {
                            if (!selectedTableId) return;
                            const currentCart = getCartItems(selectedTableId);
                            if (currentCart.length === 1 && item.qty === 1) {
                              alert('Cannot remove last item. Order must have at least 1 item.');
                              return;
                            }
                            setCartQty(selectedTableId, item.productId, 0);
                          }}
                          className="h-8 w-8 rounded-lg border border-border bg-card text-red-300 hover:text-foreground hover:border-red-400/40 hover:bg-red-900/20 transition-colors flex items-center justify-center"
                          title="Remove"
                          type="button"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        <div className="flex items-center bg-card rounded-lg border border-border h-8 overflow-hidden">
                          <button
                            onClick={() => {
                              if (!selectedTableId) return;
                              const currentCart = getCartItems(selectedTableId);
                              if (currentCart.length === 1 && item.qty === 1) {
                                alert('Cannot remove last item. Order must have at least 1 item.');
                                return;
                              }
                              setCartQty(selectedTableId, item.productId, Math.max(1, item.qty - 1));
                            }}
                            className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                          </button>
                          <span className="w-7 text-center font-bold text-[13px] text-foreground bg-secondary h-full flex items-center justify-center border-x border-border">{item.qty}</span>
                          <button
                            onClick={() => {
                              if (!selectedTableId) return;
                              setCartQty(selectedTableId, item.productId, item.qty + 1);
                            }}
                            className="w-8 h-full flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </>
          )}
        </ScrollArea>

        <div className="p-3 pb-8 bg-card border-t border-border z-30 flex-shrink-0">
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
          <div className="grid grid-cols-4 gap-2">
            {/* Send Button - Only show when there's a cart (draft) */}
            {!openOrder && (
              <button
                onClick={() => void handleSendOrder()}
                disabled={!selectedTableId || cartItems.length === 0 || sending}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/80 shadow-lg shadow-primary/20 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{sending ? 'Sending...' : 'Send'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Ctrl+S</span>
              </button>
            )}
            
            {/* Pay/Billing Button - Show for Served (enter billing) or Billing (open payment) */}
            {openOrder && (canEnterBilling || isBilling) && !isOrderLocked && (
              <button
                onClick={handlePay}
                disabled={!canEnterBilling && !isBilling}
                title={!openOrder ? 'No order' : (!canEnterBilling && !isBilling) ? 'Order must be Served first' : isBilling ? 'Open payment panel' : 'Enter Billing (Ctrl+P)'}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-primary text-primary rounded-xl hover:bg-primary hover:text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{isBilling ? 'Billing' : 'Pay'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Ctrl+P</span>
              </button>
            )}
            
            {/* Edit Button - Only for Pending or Served orders (pre-billing) */}
            {openOrder && (openOrder.status === 'Pending' || openOrder.status === 'Served') && !isBilling && (
              <button
                onClick={() => setEditingOrder(!editingOrder)}
                className="flex flex-col items-center justify-center py-2 px-1 bg-card border-2 border-amber-500 text-amber-500 rounded-xl hover:bg-amber-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed font-bold"
              >
                <span className="text-base sm:text-lg font-black leading-tight">{editingOrder ? 'Done' : 'Edit'}</span>
                <span className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Order</span>
              </button>
            )}
            
            {/* Cancel/Void Button - Only when order can be voided */}
            {canVoid && (
              <button
                onClick={handleCancelOrder}
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

              {/* Totals - recalculate to exclude tax for old orders */}
              <div className="border-t pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-foreground">{openOrder.subtotal?.toFixed(2) || '0.00'} ETB</span>
                </div>
                {(openOrder.tax > 0 || openOrder.serviceCharge > 0) && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Tax/Service (included in old order)</span>
                    <span>{((openOrder.tax || 0) + (openOrder.serviceCharge || 0)).toFixed(2)} ETB</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span className="text-foreground">Total</span>
                  <span className="text-primary">{openOrder.subtotal?.toFixed(2) || openOrder.total.toFixed(2)} ETB</span>
                </div>
              </div>
            </div>

            {/* Payment Section */}
            <div className="border-t p-4 bg-muted/30">
              <label className="text-sm font-medium mb-2 block text-foreground">Payment Method</label>
              <div className="flex gap-2 mb-4">
                {(['Cash', 'Telebirr', 'Bank'] as const).map((method) => (
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
                    {method}
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

              {paymentMethod === 'Bank' && (
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
                  {parseFloat(tenderedAmount) > (openOrder.subtotal || openOrder.total) && (
                    <div className="flex justify-between text-sm mt-2 p-2 bg-green-100 text-green-800 rounded">
                      <span>Change Due:</span>
                      <span className="font-bold">{(parseFloat(tenderedAmount) - (openOrder.subtotal || openOrder.total)).toFixed(2)} ETB</span>
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
                  disabled={processingPayment || (paymentMethod === 'Cash' && parseFloat(tenderedAmount) < (openOrder.subtotal || openOrder.total))}
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
    </div>
  );
};
