import React from 'react';
import { Header } from '../components/Header';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const salesData = [
  { name: 'Mon', coffee: 4000, food: 2400 },
  { name: 'Tue', coffee: 3000, food: 1398 },
  { name: 'Wed', coffee: 2000, food: 9800 },
  { name: 'Thu', coffee: 2780, food: 3908 },
  { name: 'Fri', coffee: 1890, food: 4800 },
  { name: 'Sat', coffee: 2390, food: 3800 },
  { name: 'Sun', coffee: 3490, food: 4300 },
];

export const Reports: React.FC = () => {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Analytics & Reports" subtitle="Deep dive into your business performance" />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-6">
            
            <div className="bg-surface p-6 rounded-xl border border-border">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-white text-lg font-bold">Weekly Category Performance</h3>
                    <select className="bg-surface-light border border-border text-white text-sm rounded px-3 py-1">
                        <option>Last 7 Days</option>
                        <option>Last 30 Days</option>
                        <option>This Year</option>
                    </select>
                </div>
                <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={salesData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#483c23" vertical={false} />
                            <XAxis dataKey="name" stroke="#c9b792" tick={{fontSize: 12}} />
                            <YAxis stroke="#c9b792" tick={{fontSize: 12}} />
                            <Tooltip 
                                cursor={{fill: 'rgba(238, 173, 43, 0.1)'}}
                                contentStyle={{backgroundColor: '#221c10', borderColor: '#483c23', color: '#fff'}}
                            />
                            <Legend wrapperStyle={{paddingTop: '20px'}} />
                            <Bar dataKey="coffee" name="Coffee Sales" fill="#eead2b" radius={[4, 4, 0, 0]} barSize={40} />
                            <Bar dataKey="food" name="Food Sales" fill="#fa3f38" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-surface p-6 rounded-xl border border-border">
                    <h3 className="text-white font-bold mb-4">Top Selling Items</h3>
                    <div className="space-y-4">
                        {[
                            {name: 'Macchiato', count: 1240, percent: 85},
                            {name: 'Special Tibs', count: 850, percent: 65},
                            {name: 'Tiramisu', count: 620, percent: 45},
                            {name: 'Spris Juice', count: 420, percent: 30}
                        ].map((item, i) => (
                            <div key={i}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-white">{item.name}</span>
                                    <span className="text-text-muted">{item.count} orders</span>
                                </div>
                                <div className="h-2 bg-surface-light rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{width: `${item.percent}%`}}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-surface p-6 rounded-xl border border-border flex flex-col justify-center items-center text-center">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                        <span className="material-symbols-outlined text-4xl text-primary">download</span>
                    </div>
                    <h3 className="text-white font-bold text-lg mb-2">Export Data</h3>
                    <p className="text-text-muted text-sm mb-6 max-w-xs">Download detailed CSV or PDF reports for tax filing and offline analysis.</p>
                    <div className="flex gap-3">
                        <button className="px-4 py-2 border border-border rounded-lg text-white hover:bg-surface-light transition-colors text-sm font-bold">CSV</button>
                        <button className="px-4 py-2 bg-primary text-background rounded-lg hover:bg-primary-hover transition-colors text-sm font-bold">PDF Report</button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
