
import React, { useMemo, useState } from 'react';
import { Screen } from '../../types';
import { usePos, useSelectedTable } from '../../PosContext';
import { Modal } from '../../components/Modal';

interface Props {
    onNavigate: (screen: Screen) => void;
}

export const WaiterMenu: React.FC<Props> = ({ onNavigate }) => {
  const { products, selectedTableId, getCartItems, addToCart, setCartQty, setCartItemNote, sendOrderToKitchen, selectOrder, getDraftOrderMeta, setDraftOrderMeta } = usePos();
  const selectedTable = useSelectedTable();

  const FALLBACK_IMAGE =
    'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=800';

  const resolveImageSrc = (raw: unknown) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return FALLBACK_IMAGE;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^data:image\//i.test(s)) return s;
    return FALLBACK_IMAGE;
  };

  const categoryIcon = (cat: string) => {
    const c = String(cat || '').toLowerCase();
    if (c === 'all') return 'apps';
    if (/(coffee|cafe|espresso|latte|cappuccino|tea|hot drink|hot drinks)/.test(c)) return 'local_cafe';
    if (/(cold drink|cold drinks|juice|smoothie|soda|soft drink)/.test(c)) return 'local_bar';
    if (/(food|main|mains|meal|lunch|dinner|burger|sandwich|pizza|pasta|rice|grill)/.test(c)) return 'lunch_dining';
    if (/(dessert|desserts|cake|cookie|ice cream|icecream|sweet)/.test(c)) return 'icecream';
    if (/(pastry|pastries|bakery|croissant|bread)/.test(c)) return 'bakery_dining';
    if (/(alcohol|beer|wine|cocktail|bar)/.test(c)) return 'wine_bar';
    if (/(seasonal|special|specials)/.test(c)) return 'auto_awesome';
    return 'category';
  };

  const [actionErr, setActionErr] = useState('');

  const [menuQuery, setMenuQuery] = useState('');
  const [menuCategory, setMenuCategory] = useState<string>('All');

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');

  const tableId = selectedTableId ?? selectedTable?.id ?? '';
  const cartItems = getCartItems(tableId);

  const draftMeta = useMemo(() => (tableId ? getDraftOrderMeta(tableId) : {}), [tableId, getDraftOrderMeta]);
  const draftOrderType = draftMeta?.orderType === 'takeaway' ? 'takeaway' : 'dine_in';
  const takeawayFee = draftOrderType === 'takeaway' ? Math.max(0, Number(draftMeta?.takeawayFee ?? 0) || 0) : 0;

  const subtotal = useMemo(() => cartItems.reduce((sum, i) => sum + i.unitPrice * i.qty, 0), [cartItems]);
  const total = useMemo(() => {
    if (selectedTable && typeof (selectedTable as any).currentTotal === 'number') {
      return Number((selectedTable as any).currentTotal || 0) || 0;
    }
    return subtotal;
  }, [selectedTable, subtotal]);
  const taxAndService = useMemo(() => Math.max(0, total - subtotal - takeawayFee), [subtotal, total, takeawayFee]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['All', ...Array.from(set.values()).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = menuCategory === 'All' ? true : String(p.category || '') === menuCategory;
      const matchesQuery = q.length === 0 ? true : p.name.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [products, menuCategory, menuQuery]);

  const editingItem = useMemo(() => cartItems.find((x) => x.productId === editItemId) ?? null, [cartItems, editItemId]);

  const handleSendOrder = () => {
    setActionErr('');
    if (!tableId || !selectedTable) {
      setActionErr('No table selected.');
      onNavigate(Screen.WAITER_DASHBOARD);
      return;
    }

    if (selectedTable.openOrderId) {
      selectOrder(selectedTable.openOrderId);
      onNavigate(Screen.WAITER_REVIEW);
      return;
    }

    if (cartItems.length === 0) {
      setActionErr('Cart is empty.');
      return;
    }

    const orderId = sendOrderToKitchen(tableId);
    if (!orderId) {
      setActionErr('Failed to send order.');
      return;
    }
    selectOrder(orderId);
    onNavigate(Screen.WAITER_STATUS);
  };

  if (!tableId || !selectedTable) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
        <header className="flex-none flex items-center justify-between whitespace-nowrap bg-[#2c241b] px-6 py-4 z-20 shadow-sm border-b border-[#483c23]/50">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 flex items-center justify-center bg-[#eead2b] text-[#221c11] rounded-xl shadow-md">
              <span className="material-symbols-outlined text-2xl">menu_book</span>
            </div>
            <h2 className="text-white text-2xl font-bold tracking-tight">Order<span className="font-light text-[#eead2b]">Builder</span></h2>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full rounded-xl border border-[#483c23] bg-[#2c241b] p-6">
            <div className="text-lg font-bold">No table selected</div>
            <div className="mt-2 text-sm text-[#c9b792]">Go back to the floor and choose a table to start an order.</div>
            <button
              onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}
              className="mt-5 h-11 px-4 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-extrabold"
            >
              Back to Floor
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
      {/* Top Header */}
      <header className="flex-none flex items-center justify-between whitespace-nowrap bg-[#2c241b] px-6 py-4 z-20 shadow-sm border-b border-[#483c23]/50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3 text-white group cursor-pointer" onClick={() => onNavigate(Screen.WAITER_DASHBOARD)}>
            <div className="w-10 h-10 flex items-center justify-center bg-[#eead2b] text-[#221c11] rounded-xl shadow-md group-hover:bg-[#d49619] transition-colors">
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </div>
            <h2 className="text-white text-2xl font-bold tracking-tight">Order<span className="font-light text-[#eead2b]">Builder</span></h2>
          </div>
          <label className="flex flex-col min-w-80 h-11 hidden md:flex">
            <div className="flex w-full flex-1 items-center rounded-2xl h-full bg-[#1a1612] border border-transparent focus-within:border-[#eead2b]/50 focus-within:shadow-sm transition-all duration-300">
              <div className="text-[#c9b792] flex items-center justify-center pl-4">
                <span className="material-symbols-outlined text-[22px]">search</span>
              </div>
              <input
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                className="flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-2xl bg-transparent border-none focus:ring-0 placeholder:text-[#c9b792]/70 px-3 text-base font-medium text-white"
                placeholder="Search menu..."
              />
            </div>
          </label>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden relative">
        <section className="flex-1 flex overflow-hidden relative bg-[#1a1612]">
          <div className="flex-1 flex flex-col min-w-0 bg-[#1a1612] overflow-hidden">
            <div className="px-6 py-5 flex items-end justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-[#c9b792] text-sm truncate">{menuCategory !== 'All' ? ` / ${menuCategory}` : ''}</p>
                <h1 className="text-2xl font-bold text-white mt-1 truncate">{menuCategory === 'All' ? 'Menu' : menuCategory}</h1>
              </div>
            </div>

            <div className="px-6 pb-4 shrink-0">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {categories.map((cat) => {
                  const active = menuCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setMenuCategory(cat)}
                      type="button"
                      className={`flex-none inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-[#eead2b] border-[#eead2b] text-[#221c11]'
                          : 'bg-[#2c241b] border-[#483c23] text-[#c9b792] hover:text-white hover:border-[#eead2b]'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[18px] ${active ? 'text-[#221c11]' : 'text-[#c9b792]'}`}>{categoryIcon(cat)}</span>
                      <span className="truncate max-w-[10rem]">{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {filteredProducts.map((p) => {
                  const isSoldOut = p.stock <= 0;
                  const isLowStock = !isSoldOut && p.stock <= 5;
                  const statusLabel = isSoldOut ? 'Sold Out' : isLowStock ? 'Low Stock' : 'In Stock';
                  const statusClass = isSoldOut
                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : isLowStock
                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                      : 'bg-green-500/20 text-green-400 border-green-500/30';

                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isSoldOut}
                      className={`group bg-[#2c241b] rounded-xl overflow-hidden border border-[#483c23] hover:border-[#eead2b] transition-all duration-200 text-left flex flex-col relative ${
                        isSoldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                      onClick={() => {
                        if (isSoldOut) return;
                        addToCart(tableId, p.id);
                      }}
                    >
                      <div className="absolute top-2 right-2 z-10">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusClass}`}>{statusLabel}</span>
                      </div>

                      <div className="h-32 w-full bg-cover bg-center group-hover:opacity-90 transition-opacity bg-[#1a1612] relative">
                        <img
                          src={resolveImageSrc(p.image)}
                          alt={p.name}
                          loading="lazy"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
                          }}
                          className={`h-full w-full object-cover ${isSoldOut ? 'grayscale' : ''}`}
                        />
                      </div>

                      <div className="p-3 flex flex-col">
                        <h3 className="font-bold text-white text-base leading-snug mb-1 line-clamp-1">{p.name}</h3>
                        <p className="text-[#c9b792] text-xs line-clamp-2 mb-3">{(p.description || p.category || '').trim() || ' '}</p>
                        <div className="mt-auto flex items-center justify-between">
                          <span className="text-lg font-bold text-[#eead2b]">ETB {p.price.toFixed(2)}</span>
                          <div
                            className={`size-8 rounded-lg flex items-center justify-center shadow-lg transition-transform ${
                              isSoldOut ? 'bg-[#3a2e22] text-[#c9b792]' : 'bg-[#eead2b] text-[#221c11] shadow-[#eead2b]/20 group-hover:scale-105'
                            }`}
                          >
                            <span className="material-symbols-outlined text-xl">add</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Right Sidebar (Cart) */}
        <aside className="w-full md:w-[400px] bg-[#2c241b] border-l border-[#483c23] shadow-xl z-20 flex flex-col h-full flex-none">
          <div className="px-6 py-5 border-b border-[#483c23] bg-[#221c11]/50 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-3">
                <div className="bg-[#eead2b]/10 text-[#eead2b] p-2.5 rounded-xl">
                  <span className="material-symbols-outlined">table_restaurant</span>
                </div>
                <div>
                  <h2 className="font-bold text-xl text-white">{selectedTable.name}</h2>
                  <div className="flex items-center gap-2 text-xs text-[#c9b792] mt-0.5 font-medium">
                    <span>Order #{selectedTable.openOrderId ? String(selectedTable.openOrderId) : 'New'}</span>
                    <span className="size-1 rounded-full bg-[#c9b792]/50"></span>
                    <span>{selectedTable.openOrderId ? 'Active' : 'Draft'}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-white bg-[#1a1612] border border-[#483c23] shadow-sm px-4 py-1.5 rounded-full font-semibold">
                <span className="material-symbols-outlined text-[18px]">group</span>
                <span>{selectedTable.seats}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {actionErr ? <div className="text-sm text-red-300 font-semibold">{actionErr}</div> : null}

            {!selectedTable?.openOrderId ? (
              <div className="bg-[#1a1612] p-4 rounded-2xl border border-[#483c23]">
                <div className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Order Type</div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftOrderMeta(tableId, { orderType: 'dine_in', takeawayFee: 0 })}
                    className={`flex-1 h-10 rounded-xl border text-sm font-bold ${
                      draftOrderType === 'dine_in' ? 'bg-[#eead2b] border-[#eead2b] text-[#221c11]' : 'bg-[#2c241b] border-[#483c23] text-[#c9b792] hover:text-white'
                    }`}
                  >
                    Dine-in
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftOrderMeta(tableId, { orderType: 'takeaway' })}
                    className={`flex-1 h-10 rounded-xl border text-sm font-bold ${
                      draftOrderType === 'takeaway' ? 'bg-[#eead2b] border-[#eead2b] text-[#221c11]' : 'bg-[#2c241b] border-[#483c23] text-[#c9b792] hover:text-white'
                    }`}
                  >
                    Takeaway
                  </button>
                </div>

                {draftOrderType === 'takeaway' ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-sm text-[#c9b792] font-medium">
                      <span>Takeaway Fee</span>
                      <span className="text-white font-bold">ETB {takeawayFee.toFixed(2)}</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={String(takeawayFee)}
                      onChange={(e) => setDraftOrderMeta(tableId, { takeawayFee: Number(e.target.value || 0) || 0 })}
                      className="mt-2 w-full h-10 bg-[#2c241b] border border-[#483c23] rounded-xl px-3 text-sm text-white"
                      placeholder="0.00"
                    />
                    <div className="mt-2 text-[11px] text-[#c9b792]">
                      This fee is added to the total and shown on the receipt.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Cart Item 1 */}
            {cartItems.length === 0 ? (
              <div className="text-[#c9b792] text-sm">No items in cart</div>
            ) : (
              cartItems.map((item) => (
                <div key={item.productId} className="bg-[#1a1612] p-2.5 rounded-xl shadow-sm border border-[#483c23] group relative">
                  <div className="flex gap-3 items-start">
                    <div
                      className="w-12 h-12 rounded-lg bg-cover bg-center flex-none shadow-inner"
                      style={{ backgroundImage: `url('${products.find((p) => p.id === item.productId)?.image ?? ''}')` }}
                    ></div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex justify-between items-start mb-0.5">
                        <p className="font-bold text-white truncate text-[15px]">{item.name}</p>
                        <p className="font-bold text-white text-[14px]">ETB {(item.unitPrice * item.qty).toFixed(2)}</p>
                      </div>
                      <div className="text-[12px] text-[#c9b792] space-y-0.5">
                        <p className="leading-none">{`x${item.qty}`}</p>
                        {item.note?.trim() ? <p className="text-[11px] text-[#c9b792] truncate">{item.note.trim()}</p> : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between pl-14">
                    <button
                      onClick={() => {
                        setEditItemId(item.productId);
                        setEditNote(item.note ?? '');
                      }}
                      className="text-[#eead2b] hover:text-[#d49619] font-semibold text-xs uppercase tracking-wide flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit_note</span> Edit
                    </button>
                    <button
                      onClick={() => setCartQty(tableId, item.productId, 0)}
                      className="h-8 w-8 rounded-lg border border-[#483c23] bg-[#2c241b] text-red-300 hover:text-white hover:border-red-400/40 hover:bg-red-900/20 transition-colors flex items-center justify-center"
                      title="Remove"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                    <div className="flex items-center bg-[#2c241b] rounded-lg border border-[#483c23] h-8 overflow-hidden">
                      <button
                        onClick={() => setCartQty(tableId, item.productId, Math.max(0, item.qty - 1))}
                        className="w-8 h-full flex items-center justify-center text-[#c9b792] hover:text-white hover:bg-[#3a2e22] transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">remove</span>
                      </button>
                      <span className="w-7 text-center font-bold text-[13px] text-white bg-[#1a1612] h-full flex items-center justify-center border-x border-[#483c23]">{item.qty}</span>
                      <button
                        onClick={() => setCartQty(tableId, item.productId, item.qty + 1)}
                        className="w-8 h-full flex items-center justify-center text-[#eead2b] hover:bg-[#eead2b] hover:text-[#221c11] transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-6 bg-[#221c11] border-t border-[#483c23] z-30">
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm text-[#c9b792] font-medium">
                <span>Subtotal</span>
                <span className="text-white">ETB {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#c9b792] font-medium">
                <span>Tax/Service</span>
                <span className="text-white">ETB {taxAndService.toFixed(2)}</span>
              </div>
              {takeawayFee > 0.0001 ? (
                <div className="flex justify-between text-sm text-[#c9b792] font-medium">
                  <span>Takeaway Fee</span>
                  <span className="text-white">ETB {takeawayFee.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-end pt-4 border-t border-dashed border-[#483c23] mt-3">
                <div className="flex flex-col">
                  <span className="text-xs text-[#c9b792] font-bold uppercase tracking-wider">Total Due</span>
                  <span className="font-bold text-3xl text-white">ETB {total.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => onNavigate(Screen.WAITER_DASHBOARD)} className="flex flex-col items-center justify-center py-4 rounded-xl border border-[#483c23] bg-[#2c241b] text-white hover:border-[#eead2b] hover:text-[#eead2b] transition-all font-bold shadow-sm">
                <span className="material-symbols-outlined mb-1">arrow_back</span> Back
              </button>
              <button onClick={handleSendOrder} disabled={cartItems.length === 0} className="flex flex-col items-center justify-center py-4 rounded-xl bg-[#eead2b] text-[#221c11] hover:bg-[#d49619] shadow-lg shadow-[#eead2b]/20 transition-all font-bold transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                <span className="material-symbols-outlined mb-1">room_service</span> Send Order
              </button>
            </div>
          </div>
        </aside>
      </main>

      <Modal
        open={editItemId != null}
        title={editingItem ? `Edit: ${editingItem.name}` : 'Edit Item'}
        onClose={() => {
          setEditItemId(null);
          setEditNote('');
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setEditItemId(null);
                setEditNote('');
              }}
              className="flex-1 h-11 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!editingItem) return;
                setCartItemNote(tableId, editingItem.productId, editNote);
                setEditItemId(null);
                setEditNote('');
              }}
              className="flex-1 h-11 rounded-lg bg-[#eead2b] hover:bg-[#d49619] text-[#221c11] font-bold transition-colors"
            >
              Save
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-[#c9b792] mb-2">Item modifier / note</label>
        <textarea
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          className="w-full bg-[#3a2e22] border border-[#483c23] rounded-lg p-3 text-sm text-white placeholder-[#c9b792] focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] transition-all resize-none h-28"
          placeholder="e.g. No sugar, extra spicy, well-done, allergy notes..."
        />
      </Modal>
    </div>
  );
};
