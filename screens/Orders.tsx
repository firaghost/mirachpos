import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { usePos } from '../PosContext';

export const Orders: React.FC = () => {
  const { orders, refreshFromServer } = usePos();
  const [query, setQuery] = useState('');

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      return (
        String(o.number || '')
          .toLowerCase()
          .includes(q) ||
        String(o.tableName || '')
          .toLowerCase()
          .includes(q) ||
        String(o.id || '')
          .toLowerCase()
          .includes(q) ||
        String(o.createdByName || o.createdByStaffId || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [orders, query]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Orders Management" subtitle="Manage and track all kitchen and floor orders" />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
            <div className="flex gap-2">
                <button className="px-4 py-2 bg-primary text-background font-bold rounded-lg text-sm">All Orders</button>
                <button className="px-4 py-2 bg-card text-muted-foreground hover:text-foreground hover:bg-accent font-medium rounded-lg text-sm border border-border">Pending</button>
                <button className="px-4 py-2 bg-card text-muted-foreground hover:text-foreground hover:bg-accent font-medium rounded-lg text-sm border border-border">Completed</button>
            </div>
            <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-muted-foreground text-[18px]">search</span>
                <input 
                    type="text" 
                    placeholder="Search Order ID or Table..." 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-64"
                />
            </div>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-muted/50 border-b border-border">
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Order ID</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Table</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Items</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Staff</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Amount</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Time</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {rows.map((order, i) => (
                        <tr key={i} className="hover:bg-accent/50 transition-colors">
                            <td className="p-4 text-sm font-bold text-foreground">{order.number}</td>
                            <td className="p-4 text-sm text-muted-foreground">{order.tableName}</td>
                            <td className="p-4 text-sm text-foreground truncate max-w-[200px]">{order.items.map((x) => `${x.qty} — ${x.name}`).join(', ')}</td>
                            <td className="p-4 text-sm text-muted-foreground">{order.createdByName ?? (order.createdByStaffId ?? '')}</td>
                            <td className="p-4 text-sm font-mono font-bold text-foreground">ETB {order.total.toFixed(2)}</td>
                            <td className="p-4">
                                <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                                    order.status === 'Cooking' ? 'bg-warning/20 text-warning' :
                                    order.status === 'Ready' ? 'bg-primary/10 text-primary' :
                                    order.status === 'Pending' ? 'bg-gray-500/20 text-gray-400' :
                                    'bg-success/20 text-success'
                                }`}>
                                    {order.status}
                                </span>
                            </td>
                            <td className="p-4 text-xs text-muted-foreground">{order.timeLabel}</td>
                            <td className="p-4 text-right">
                                <button className="p-1 hover:bg-border rounded text-muted-foreground hover:text-foreground">
                                    <span className="material-symbols-outlined text-[18px]">more_vert</span>
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};
