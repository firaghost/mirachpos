import React, { useEffect, useMemo, useState } from 'react';
import { usePos } from '../../PosContext';
import { Screen } from '../../types';
import { formatDeviceDate, formatDeviceTime } from '../../datetime';

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const BranchOrders: React.FC<Props> = ({ onNavigate }) => {
  const { orders, selectOrder, refreshFromServer } = usePos();
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<'All' | 'Dine-in' | 'Takeaway' | 'Delivery'>('All');
  const [dateMode, setDateMode] = useState<'Today' | 'All' | 'Range'>('Today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const rangeStart = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const rangeEnd = toDate ? new Date(`${toDate}T23:59:59`) : null;

    return orders.filter((o) => {
      const matchesQuery =
        q.length === 0
          ? true
          : o.number.toLowerCase().includes(q) || o.tableName.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || (o.createdByName ?? '').toLowerCase().includes(q);
      const inferredChannel = o.tableName.toLowerCase().includes('takeaway')
        ? 'Takeaway'
        : o.tableName.toLowerCase().includes('delivery')
          ? 'Delivery'
          : 'Dine-in';
      const matchesChannel = channel === 'All' ? true : inferredChannel === channel;

      const createdAt = new Date(o.createdAt);
      const matchesDate =
        dateMode === 'All'
          ? true
          : dateMode === 'Today'
            ? createdAt >= startOfToday && createdAt < endOfToday
            : rangeStart && rangeEnd
              ? createdAt >= rangeStart && createdAt <= rangeEnd
              : true;
      return matchesQuery && matchesChannel && matchesDate;
    });
  }, [query, channel, orders, dateMode, fromDate, toDate]);

  const openOrder = (orderId: string) => {
    selectOrder(orderId);
    onNavigate(Screen.MANAGER_ORDER_DETAILS);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
      <header className="h-16 shrink-0 border-b border-[#483c23] flex items-center justify-between px-8 bg-[#221c10]">
         <div className="flex items-center gap-4">
             <span className="material-symbols-outlined text-primary text-2xl">receipt_long</span>
             <h2 className="text-xl font-bold">Orders Management</h2>
         </div>
         <button onClick={() => onNavigate(Screen.TABLE_ASSIGNMENT)} className="bg-primary text-[#221c10] px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">add</span> New Order
         </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex gap-2">
            <button onClick={() => setDateMode('Today')} className={`px-4 py-2 rounded-lg text-sm border ${dateMode === 'Today' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>Today</button>
            <button onClick={() => setDateMode('All')} className={`px-4 py-2 rounded-lg text-sm border ${dateMode === 'All' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>All</button>
            <button onClick={() => setDateMode('Range')} className={`px-4 py-2 rounded-lg text-sm border ${dateMode === 'Range' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>Range</button>
          </div>

          {dateMode === 'Range' ? (
            <div className="flex items-center gap-2">
              <input value={fromDate} onChange={(e) => setFromDate(e.target.value)} type="date" className="h-10 bg-[#2c2417] border border-[#483c23] rounded-lg px-3 text-sm text-white" />
              <span className="text-[#c9b792] text-sm">to</span>
              <input value={toDate} onChange={(e) => setToDate(e.target.value)} type="date" className="h-10 bg-[#2c2417] border border-[#483c23] rounded-lg px-3 text-sm text-white" />
            </div>
          ) : null}
        </div>

        <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#c9b792]">search</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-[#2c2417] border border-[#483c23] rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="Search Order ID, Table..."/>
            </div>
             <div className="flex gap-2">
                <button onClick={() => setChannel('Dine-in')} className={`px-4 py-2 rounded-lg text-sm border ${channel === 'Dine-in' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>Dine-in</button>
                <button onClick={() => setChannel('Takeaway')} className={`px-4 py-2 rounded-lg text-sm border ${channel === 'Takeaway' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>Takeaway</button>
                <button onClick={() => setChannel('Delivery')} className={`px-4 py-2 rounded-lg text-sm border ${channel === 'Delivery' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>Delivery</button>
                <button onClick={() => setChannel('All')} className={`px-4 py-2 rounded-lg text-sm border ${channel === 'All' ? 'bg-primary text-[#221c10] border-primary font-bold' : 'bg-[#2c2417] border-[#483c23] text-[#c9b792] hover:text-white'}`}>All</button>
            </div>
        </div>

        <div className="bg-[#2c2417] rounded-xl border border-[#483c23] overflow-hidden">
            <table className="w-full text-left text-sm">
                <thead className="bg-[#221c10] text-[#c9b792] text-xs uppercase font-bold border-b border-[#483c23]">
                    <tr>
                        <th className="px-6 py-4">Order #</th>
                        <th className="px-6 py-4">Day</th>
                        <th className="px-6 py-4">Time</th>
                        <th className="px-6 py-4">Table/Channel</th>
                        <th className="px-6 py-4">Placed By</th>
                        <th className="px-6 py-4">Items</th>
                        <th className="px-6 py-4 text-right">Tip</th>
                        <th className="px-6 py-4 text-right">Total</th>
                        <th className="px-6 py-4">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#483c23]">
                     {rows.map((order, i) => (
                        <tr key={i} onClick={() => openOrder(order.id)} className={`hover:bg-[#393328] transition-colors cursor-pointer ${order.status === 'Voided' ? 'bg-red-950/10' : ''}`}>
                            <td className="px-6 py-4 font-mono font-bold">{order.number}</td>
                            <td className="px-6 py-4 text-[#c9b792]">{formatDeviceDate(order.createdAt, { year: 'numeric', month: 'short', day: '2-digit' })}</td>
                            <td className="px-6 py-4 text-[#c9b792]">{formatDeviceTime((order as any).paidAt || order.createdAt, { hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="px-6 py-4">{order.tableName}</td>
                            <td className="px-6 py-4 text-[#c9b792]">{order.createdByName ?? (order.createdByStaffId ?? ' ”')}</td>
                            <td className="px-6 py-4 text-[#c9b792] truncate max-w-[200px]">{order.items.map((x) => `${x.qty} — ${x.name}`).join(', ')}</td>
                            <td className="px-6 py-4 text-right font-bold">ETB {Number((order as any).tip ?? 0).toFixed(2)}</td>
                            <td className="px-6 py-4 text-right font-bold">ETB {order.total.toFixed(2)}</td>
                            <td className="px-6 py-4 relative overflow-hidden">
                                 {order.status === 'Voided' ? (
                                   <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                     <div className="text-[28px] font-black tracking-[0.25em] text-red-500/10 rotate-[-18deg]">VOIDED</div>
                                   </div>
                                 ) : null}
                                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                                     order.status === 'Cooking' ? 'bg-yellow-500/20 text-yellow-500' :
                                     order.status === 'Ready' ? 'bg-white-500/20 text-white-500' :
                                     order.status === 'Served' ? 'bg-green-500/20 text-green-500' :
                                     order.status === 'Paid' ? 'bg-green-500/20 text-green-500' :
                                     order.status === 'Voided' ? 'bg-red-500/25 text-red-300 border border-red-500/30' :
                                     'bg-white/10 text-[#c9b792]'
                                 }`}>
                                     {order.status}
                                 </span>
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
