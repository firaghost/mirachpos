import React from 'react';
import { Header } from '../components/Header';
import { TENANTS_LIST } from '../mockData';

export const Tenants: React.FC = () => {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Tenant Management" subtitle="Super Admin • Manage SaaS Clients" />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center bg-muted/40">
                <h3 className="text-foreground font-bold">Registered Businesses</h3>
                <button className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded hover:bg-primary/90">Create Tenant</button>
            </div>
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-border">
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Business Name</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Subscription Plan</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Branches</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Next Billing</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                        <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {TENANTS_LIST.map((tenant, i) => (
                        <tr key={i} className="hover:bg-accent/50 transition-colors">
                            <td className="p-4">
                                <span className="font-bold text-foreground block">{tenant.name}</span>
                                <span className="text-xs text-muted-foreground">{tenant.id}</span>
                            </td>
                            <td className="p-4 text-sm text-muted-foreground">{tenant.plan}</td>
                            <td className="p-4 text-sm text-foreground font-mono">{tenant.branches}</td>
                            <td className="p-4 text-sm text-muted-foreground">{tenant.nextBilling}</td>
                            <td className="p-4">
                                <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                                    tenant.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'
                                }`}>
                                    {tenant.status}
                                </span>
                            </td>
                            <td className="p-4 text-right">
                                <button className="text-sm font-bold text-primary hover:underline">Manage</button>
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
