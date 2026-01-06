import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { usePos } from '../PosContext';

export const POS: React.FC = () => {
  const {
    tables,
    products,
    selectedTableId,
    selectTable,
    getCartItems,
    addToCart,
    removeFromCart,
    setCartQty,
    sendOrderToKitchen,
    refreshFromServer,
  } = usePos();

  const [view, setView] = useState<'floor' | 'menu'>('floor');
  const [category, setCategory] = useState<string>('All');

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const selectedTable = useMemo(() => tables.find((t) => t.id === selectedTableId) ?? null, [tables, selectedTableId]);
  const cartItems = useMemo(() => {
    if (!selectedTableId) return [];
    return getCartItems(selectedTableId);
  }, [getCartItems, selectedTableId]);

  const subtotal = useMemo(() => cartItems.reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0), [cartItems]);
  const total = useMemo(() => (selectedTable?.currentTotal != null ? Number(selectedTable.currentTotal) || 0 : subtotal), [selectedTable?.currentTotal, subtotal]);

  const handleTableClick = (tableId: string) => {
    selectTable(tableId);
    setView('menu');
  };

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['All', ...Array.from(set.values()).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (category === 'All') return products;
    return products.filter((p) => String(p.category || '') === category);
  }, [category, products]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={view === 'floor' ? 'Floor Plan - Main Hall' : `Order: ${selectedTable?.name}`} subtitle="Select a table to manage orders" />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Main Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-background">
            
            {/* Floor Plan View */}
            {view === 'floor' && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {tables.map((table) => (
                        <div 
                            key={table.id}
                            onClick={() => handleTableClick(table.id)}
                            className={`
                                relative p-6 rounded-xl border-2 flex flex-col gap-4 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl
                                ${table.status === 'Free' ? 'bg-surface border-border hover:border-text-muted' : ''}
                                ${table.status === 'Occupied' ? 'bg-surface border-primary/50 hover:border-primary' : ''}
                                ${table.status === 'Payment' ? 'bg-surface border-warning animate-pulse' : ''}
                                ${table.status === 'Reserved' ? 'bg-surface-light border-border opacity-70' : ''}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <span className="text-2xl font-black text-white">{table.name}</span>
                                <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                                    table.status === 'Free' ? 'bg-white/10 text-white' :
                                    table.status === 'Occupied' ? 'bg-primary/20 text-primary' :
                                    table.status === 'Payment' ? 'bg-warning/20 text-warning' : 'bg-white/5 text-text-muted'
                                }`}>
                                    {table.status}
                                </span>
                            </div>
                            
                            <div className="flex flex-col gap-1 mt-2">
                                <div className="flex items-center gap-2 text-text-muted text-sm">
                                    <span className="material-symbols-outlined text-[16px]">group</span>
                                    <span>{table.seats} Seats</span>
                                </div>
                                {table.currentTotal ? (
                                    <div className="flex items-center gap-2 text-primary font-mono text-sm font-bold">
                                        <span className="material-symbols-outlined text-[16px]">receipt</span>
                                        <span>ETB {Number(table.currentTotal || 0).toFixed(2)}</span>
                                    </div>
                                ) : null}
                                {table.time ? (
                                    <div className="flex items-center gap-2 text-text-muted text-xs">
                                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                                        <span>{table.time}</span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Menu View */}
            {view === 'menu' && (
                <div className="flex flex-col gap-6">
                    <button
                      onClick={() => {
                        setView('floor');
                        selectTable(null);
                      }}
                      className="flex items-center gap-2 text-text-muted hover:text-white w-fit"
                    >
                        <span className="material-symbols-outlined">arrow_back</span> Back to Floor
                    </button>
                    
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {availableCategories.map((cat) => (
                            <button
                              key={cat}
                              onClick={() => setCategory(cat)}
                              className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${cat === category ? 'bg-primary text-background border-primary' : 'bg-surface border-border text-text-muted hover:text-white hover:border-text-muted'}`}
                            >
                              {cat}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {filteredProducts.map((product) => (
                            <div
                              key={product.id}
                              onClick={() => {
                                if (!selectedTableId) return;
                                addToCart(selectedTableId, product.id);
                              }}
                              className="bg-surface rounded-xl overflow-hidden border border-border group cursor-pointer hover:border-primary transition-colors"
                            >
                                <div className="h-32 bg-surface-light relative">
                                    <img src={product.image} alt={product.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-white text-xs font-bold">
                                        {product.stock} left
                                    </div>
                                </div>
                                <div className="p-4">
                                    <h4 className="font-bold text-white mb-1">{product.name}</h4>
                                    <p className="text-primary font-mono font-bold">ETB {product.price}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* Right Sidebar: Order Summary (Visible only in Menu view) */}
        {view === 'menu' && (
            <div className="w-96 bg-surface border-l border-border flex flex-col shrink-0">
                <div className="p-4 border-b border-border">
                    <h3 className="text-lg font-bold text-white">Current Order</h3>
                    <p className="text-text-muted text-xs">{selectedTable?.name ? `Table: ${selectedTable.name}` : 'No table selected'}</p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                    {cartItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50">
                            <span className="material-symbols-outlined text-6xl mb-2">shopping_cart</span>
                            <p>No items added</p>
                        </div>
                    ) : (
                        cartItems.map((item) => (
                            <div key={item.productId} className="bg-surface-light p-3 rounded-lg border border-border">
                                <div className="flex justify-between items-start gap-3">
                                  <div className="flex flex-col">
                                      <span className="text-white font-medium text-sm">{item.name}</span>
                                      <span className="text-text-muted text-xs">ETB {Number(item.unitPrice || 0).toFixed(2)}</span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (!selectedTableId) return;
                                      removeFromCart(selectedTableId, item.productId);
                                    }}
                                    className="text-text-muted hover:text-white"
                                    aria-label="remove"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                  </button>
                                </div>

                                <div className="mt-3 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => {
                                        if (!selectedTableId) return;
                                        setCartQty(selectedTableId, item.productId, Math.max(1, (item.qty || 0) - 1));
                                      }}
                                      className="h-9 w-9 rounded-lg border border-border hover:bg-border text-white font-bold"
                                    >
                                      âˆ’
                                    </button>
                                    <div className="min-w-[44px] text-center font-mono font-bold text-white">{item.qty}</div>
                                    <button
                                      onClick={() => {
                                        if (!selectedTableId) return;
                                        setCartQty(selectedTableId, item.productId, (item.qty || 0) + 1);
                                      }}
                                      className="h-9 w-9 rounded-lg border border-border hover:bg-border text-white font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <div className="text-white font-mono font-bold">ETB {(Number(item.unitPrice || 0) * (Number(item.qty || 0) || 0)).toFixed(2)}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-6 bg-surface-light border-t border-border">
                    <div className="flex justify-between mb-2 text-text-muted text-sm">
                        <span>Subtotal</span>
                        <span>ETB {subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between mb-4 text-text-muted text-sm">
                        <span>Total</span>
                        <span>ETB {total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between mb-6 text-xl font-bold text-white border-t border-border pt-4">
                        <span className="text-primary">Due</span>
                        <span className="text-primary">ETB {total.toFixed(2)}</span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                         <button
                           onClick={() => {
                             setView('floor');
                             selectTable(null);
                           }}
                           className="py-3 rounded-lg border border-border hover:bg-border text-white font-bold transition-colors"
                         >
                            Draft
                        </button>
                        <button
                          disabled={!selectedTableId || cartItems.length === 0}
                          onClick={() => {
                            if (!selectedTableId) return;
                            sendOrderToKitchen(selectedTableId);
                            setView('floor');
                            selectTable(null);
                          }}
                          className="py-3 rounded-lg bg-primary hover:bg-primary-hover text-background font-bold shadow-lg shadow-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Send to Kitchen
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
