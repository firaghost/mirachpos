import React from 'react';
import { Header } from '../components/Header';
import { STATS, SYSTEM_STATS, RECENT_ORDERS } from '../mockData';
import { UserRole } from '../types';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { AppIcon } from '@/components/ui/app-icon';
const data = [
  { name: '8am', uv: 4000 },
  { name: '10am', uv: 3000 },
  { name: '12pm', uv: 2000 },
  { name: '2pm', uv: 2780 },
  { name: '4pm', uv: 1890 },
  { name: '6pm', uv: 2390 },
  { name: '8pm', uv: 3490 },
];

export const Dashboard: React.FC<{ role: UserRole }> = ({ role }) => {
  const isSuperAdmin = role === UserRole.SUPER_ADMIN;
  const currentStats = isSuperAdmin ? SYSTEM_STATS : STATS;
  const title = isSuperAdmin ? "System Overview" : "Overview";
  const subtitle = isSuperAdmin ? "MirachPos SaaS Administration" : "Today, Oct 24 • Shift 1 (08:00 - 16:00)";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={title} subtitle={subtitle} />
      
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {currentStats.map((stat, idx) => (
                    <div key={idx} className="bg-card p-5 rounded-xl border border-border flex flex-col gap-1 relative overflow-hidden group hover:border-primary/30 transition-colors">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <AppIcon name={stat.icon} className="text-[64px] text-primary" size={64} />
                        </div>
                        <p className="text-muted-foreground text-sm font-medium">{stat.label}</p>
                        <h3 className="text-foreground text-3xl font-bold tracking-tight mt-1">{stat.value}</h3>
                        <div className={`flex items-center gap-1 mt-2 text-xs font-bold ${stat.positive ? 'text-success' : 'text-danger'} bg-${stat.positive ? 'success' : 'danger'}/10 w-fit px-2 py-1 rounded`}>
                            <AppIcon name={stat.positive ? 'trending_up' : 'trending_down'} className="text-[14px]" size={14} />
                            <span>{stat.trend}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts & Activity - Conditionally Rendered */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Main Chart */}
                <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-foreground text-lg font-bold">{isSuperAdmin ? 'System Revenue' : 'Sales Trends (Hourly)'}</h3>
                        <div className="flex bg-muted p-1 rounded-lg">
                            <button className="px-3 py-1 bg-border text-foreground text-xs font-medium rounded shadow-sm">Today</button>
                            <button className="px-3 py-1 text-muted-foreground hover:text-foreground text-xs font-medium rounded transition-colors">Week</button>
                        </div>
                    </div>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="name" stroke="hsl(var(--border))" tick={{fill: 'hsl(var(--muted-foreground))', fontSize: 12}} />
                                <Tooltip 
                                    contentStyle={{backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))'}}
                                    itemStyle={{color: 'hsl(var(--primary))'}}
                                />
                                <Area type="monotone" dataKey="uv" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorUv)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Right Panel: Recent Orders (Cafe) OR System Alerts (Super Admin) */}
                <div className="bg-card rounded-xl border border-border flex flex-col h-full">
                    <div className="p-4 border-b border-border flex items-center justify-between">
                        <h3 className="text-foreground font-bold">{isSuperAdmin ? 'System Alerts' : 'Recent Orders'}</h3>
                        <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                        </span>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto max-h-[350px]">
                        {isSuperAdmin ? (
                             <div className="flex flex-col">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-start gap-3 p-4 border-b border-border/50">
                                        <AppIcon name="warning" className="text-warning mt-1" />
                                        <div>
                                            <p className="text-foreground text-sm font-bold">High Server Load</p>
                                            <p className="text-muted-foreground text-xs">US-East Region database latency spike.</p>
                                            <span className="text-[10px] text-muted-foreground mt-1 block">2 mins ago</span>
                                        </div>
                                    </div>
                                ))}
                             </div>
                        ) : (
                            <div className="flex flex-col">
                                {RECENT_ORDERS.map((order, i) => (
                                    <div key={i} className="flex items-center justify-between p-4 border-b border-border/50 hover:bg-accent transition-colors cursor-pointer">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-primary">
                                                <AppIcon name="restaurant" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-foreground text-sm font-bold">{order.id} <span className="text-muted-foreground font-normal">• {order.table}</span></span>
                                                <span className="text-muted-foreground text-xs truncate max-w-[120px]">{order.items}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-foreground font-mono font-bold text-sm">ETB {order.total}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                                order.status === 'Cooking' ? 'bg-warning/20 text-warning' :
                                                order.status === 'Ready' ? 'bg-primary/10 text-primary' :
                                                'bg-success/20 text-success'
                                            }`}>
                                                {order.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <div className="p-3 border-t border-border text-center">
                        <button className="text-xs text-muted-foreground hover:text-foreground font-bold uppercase tracking-wider">View All</button>
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};
